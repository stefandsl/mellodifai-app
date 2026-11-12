import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { applyRolePasswords } from "../lib/roles.js";
import { type Runner, realRunner, recordingRunner } from "../lib/run.js";
import {
  reapplyDbPasswords,
  rewriteEnvUrl,
  rotateDbPasswords,
} from "../rotate-db-passwords.js";

vi.mock("../lib/roles.js", async (original) => ({
  ...(await original<object>()),
  applyRolePasswords: vi.fn(async () => ({
    set: ["mdf_web", "mdf_auth"],
    absent: [],
  })),
}));
vi.mock("../lib/stack-secrets.js", () => ({
  loadStackSecrets: vi.fn(async () => ({ postgres: "old" })),
}));
vi.mock("../lib/compose.js", () => ({
  composeEnvironment: vi.fn((_env, secrets) => ({
    POSTGRES_PASSWORD: secrets.postgres,
  })),
}));

const roles = [
  "authenticator",
  "pgbouncer",
  "postgres",
  "supabase_admin",
  "supabase_auth_admin",
  "supabase_etl_admin",
  "supabase_functions_admin",
  "supabase_read_only_user",
  "supabase_replication_admin",
  "supabase_storage_admin",
  "mdf_web",
  "mdf_auth",
  "extra_login",
];
let root: string;
beforeEach(() => {
  const base = join(
    process.env.RUNNER_TEMP ?? process.env.MELLODIFAI_ROOT ?? "E:/mellodifai",
    "tmp",
  );
  mkdirSync(base, { recursive: true });
  root = mkdtempSync(join(base, "task8-"));
  vi.stubEnv("MELLODIFAI_ROOT", root);
  mkdirSync(join(root, "secrets/supabase"), { recursive: true });
  writeFileSync(join(root, "secrets/supabase/signing_keys.json"), "[]");
  writeFileSync(join(root, "secrets/supabase/stack-secrets.json"), "{}");
  vi.clearAllMocks();
});
afterEach(() => {
  vi.unstubAllEnvs();
  rmSync(root, { recursive: true, force: true });
});
function fixture() {
  const record = recordingRunner();
  const inputs: string[] = [];
  const runner: Runner = async (cmd, args, opts) => {
    await record(cmd, args, opts);
    inputs.push(opts?.input ?? "");
    return {
      code: 0,
      stderr: "",
      stdout: opts?.input?.startsWith("select rolname") ? roles.join("\n") : "",
    };
  };
  return { record, inputs, runner };
}
it("rotates every login role from spike 2 plus mdf_web and mdf_auth", async () => {
  const { record, inputs, runner } = fixture();
  await rotateDbPasswords("prod", runner);
  const saved = JSON.parse(
    readFileSync(join(root, "secrets/supabase/db-passwords.json"), "utf8"),
  );
  expect(Object.keys(saved).sort()).toEqual([...roles].sort());
  for (const role of roles) {
    expect(saved[role]).toMatch(/^[a-f0-9]{64}$/);
    if (!role.startsWith("mdf_"))
      expect(inputs.join("\n")).toContain(`alter role "${role}"`);
    expect(JSON.stringify(record.calls)).not.toContain(saved[role]);
  }
  expect(saved.authenticator).toBe(saved.postgres);
  expect(saved.supabase_etl_admin).not.toBe(saved.postgres);
  expect(applyRolePasswords).toHaveBeenCalledWith(expect.any(String), {
    mdf_web: saved.mdf_web,
    mdf_auth: saved.mdf_auth,
  });
  expect(
    record.calls.some(
      (c) => c.args.includes("up") && c.args.includes("--wait"),
    ),
  ).toBe(true);
  await reapplyDbPasswords("prod", runner);
  expect(
    JSON.parse(
      readFileSync(join(root, "secrets/supabase/db-passwords.json"), "utf8"),
    ),
  ).toEqual(saved);
});
it("rewrites MDF_WEB_DATABASE_URL in apps/web/.env.local and MDF_AUTH_DATABASE_URL in apps/auth/.env.local without printing them (Nit 6)", async () => {
  const spy = vi.spyOn(console, "log").mockImplementation(() => {});
  await rotateDbPasswords("prod", fixture().runner);
  for (const app of ["web", "auth"]) {
    const file = join(root, "deploy/apps", app, ".env.local");
    const name = `MDF_${app.toUpperCase()}_DATABASE_URL`;
    expect(readFileSync(file, "utf8")).toContain(
      `${name}="postgresql://mdf_${app}:`,
    );
    writeFileSync(
      file,
      `# keep\nOTHER=value\n${name}=old\nexport ${name}=duplicate\n`,
    );
    await rewriteEnvUrl(
      file,
      name,
      "postgresql://mdf_web:test@127.0.0.1:44322/postgres",
    );
    const updated = readFileSync(file, "utf8");
    expect(updated).toContain("# keep\nOTHER=value\n");
    expect(updated.match(new RegExp(name, "g"))).toHaveLength(1);
  }
  expect(spy).not.toHaveBeenCalled();
  spy.mockRestore();
});
it("refuses reapplication with unrecorded login roles before altering anything", async () => {
  const f = fixture();
  await rotateDbPasswords("prod", f.runner);
  const file = join(root, "secrets/supabase/db-passwords.json");
  const saved = JSON.parse(readFileSync(file, "utf8"));
  delete saved.extra_login;
  writeFileSync(file, JSON.stringify(saved));
  f.inputs.length = 0;
  await expect(reapplyDbPasswords("prod", f.runner)).rejects.toThrow(
    /inventory/,
  );
  expect(f.inputs.some((s) => s.includes("alter role"))).toBe(false);
});

it("stores production credentials with owner-only permissions", async () => {
  await rotateDbPasswords("prod", fixture().runner);
  const file = join(root, "secrets/supabase/db-passwords.json");
  if (process.platform === "win32") {
    const acl = await realRunner("icacls", [file]);
    expect(acl.code).toBe(0);
    expect(acl.stdout).toContain(`${process.env.USERNAME}:(F)`);
    expect(acl.stdout.match(/\(F\)/g)).toHaveLength(1);
    expect(acl.stdout).not.toMatch(/\(I\)|\(RX\)|\(M\)|\(R\)/);
  } else expect(statSync(file).mode & 0o777).toBe(0o600);
});

it("retains the new store after a failed service restart for safe reapplication", async () => {
  const f = fixture();
  const fail: Runner = async (cmd, args, opts) =>
    args.includes("up")
      ? { code: 1, stdout: "", stderr: "private credential" }
      : f.runner(cmd, args, opts);
  await expect(rotateDbPasswords("prod", fail)).rejects.toThrow(
    "Database service re-template failed",
  );
  const file = join(root, "secrets/supabase/db-passwords.json");
  const saved = readFileSync(file, "utf8");
  await reapplyDbPasswords("prod", f.runner);
  expect(readFileSync(file, "utf8")).toBe(saved);
});

it("refuses to write runtime app secrets on C", async () => {
  await expect(
    rewriteEnvUrl(
      "C:/task8/.env.local",
      "MDF_WEB_DATABASE_URL",
      "postgresql://mdf_web:test@127.0.0.1/postgres",
    ),
  ).rejects.toThrow(/outside C/);
});

it("does not rotate or save credentials until both application roles exist", async () => {
  const record = recordingRunner([
    {
      code: 0,
      stderr: "",
      stdout: roles.filter((role) => !role.startsWith("mdf_")).join("\n"),
    },
  ]);
  await expect(rotateDbPasswords("prod", record)).rejects.toThrow(
    /roles are absent/,
  );
  expect(record.calls).toHaveLength(1);
  expect(existsSync(join(root, "secrets/supabase/db-passwords.json"))).toBe(
    false,
  );
});

it("preserves the app env read permissions installed for its service account", async () => {
  const file = join(root, "deploy/apps/web/.env.local");
  await rewriteEnvUrl(
    file,
    "MDF_WEB_DATABASE_URL",
    "postgresql://mdf_web:first@127.0.0.1/postgres",
  );
  if (process.platform === "win32") {
    expect(
      (await realRunner("icacls", [file, "/grant", "*S-1-5-19:R"])).code,
    ).toBe(0);
    const before = await realRunner("icacls", [file]);
    await rewriteEnvUrl(
      file,
      "MDF_WEB_DATABASE_URL",
      "postgresql://mdf_web:next@127.0.0.1/postgres",
    );
    expect((await realRunner("icacls", [file])).stdout).toBe(before.stdout);
  } else {
    chmodSync(file, 0o640);
    await rewriteEnvUrl(
      file,
      "MDF_WEB_DATABASE_URL",
      "postgresql://mdf_web:next@127.0.0.1/postgres",
    );
    expect(statSync(file).mode & 0o777).toBe(0o640);
  }
});
