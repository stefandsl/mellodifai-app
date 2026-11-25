import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { runtimePath, stackDir } from "../lib/envs.js";
import { writePrivate } from "../lib/private-file.js";
import { realRunner } from "../lib/run.js";
import { serviceCommand } from "../lib/services.js";
import {
  loadSmtpEnvironment,
  PRODUCTION_SMTP,
  refreshProductionSmtp,
  SMTP_SETUP_NOTICE,
  smtpEnvironment,
} from "../lib/smtp.js";

let root = "";
let path = "";
beforeEach(() => {
  const base = runtimePath(process.env.RUNNER_TEMP ?? "E:/mellodifai/tmp");
  mkdirSync(base, { recursive: true });
  root = mkdtempSync(join(base, "smtp-test-"));
  path = join(root, "secrets/smtp.env");
  vi.stubEnv("MELLODIFAI_ROOT", root);
  vi.stubEnv("MDF_SMTP_PASS", "ambient-must-not-be-used");
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  if (root) rmSync(root, { recursive: true, force: true });
});

it.each([
  undefined,
  "OTHER_KEY=fake-other",
  "MDF_SMTP_PASS=",
  'MDF_SMTP_PASS="line1\nline2"',
])(
  "missing file/key or invalid value disables SMTP with one safe line (%s)",
  async (content) => {
    if (content !== undefined) await writePrivate(path, content);
    const log = vi.fn();
    expect(await loadSmtpEnvironment("prod", log)).toEqual({
      MDF_SMTP_PASS: "",
    });
    expect(log.mock.calls).toEqual([[SMTP_SETUP_NOTICE]]);
    expect(process.env.MDF_SMTP_PASS).toBe("ambient-must-not-be-used");
  },
);

it("loads only the file key without logging or changing the parent environment", async () => {
  const value = "fake-resend-$dollar#hash=equals";
  await writePrivate(
    path,
    `# owner file\r\nOTHER_KEY=private-other\r\nMDF_SMTP_PASS='${value}'\r\n`,
  );
  const log = vi.fn();
  const stdout = vi.spyOn(process.stdout, "write");
  const stderr = vi.spyOn(process.stderr, "write");
  expect(await loadSmtpEnvironment("prod", log)).toEqual({
    MDF_SMTP_PASS: value,
  });
  expect(log).not.toHaveBeenCalled();
  expect(stdout).not.toHaveBeenCalled();
  expect(stderr).not.toHaveBeenCalled();
  expect(process.env.MDF_SMTP_PASS).toBe("ambient-must-not-be-used");
});

it.each(["dev", "e2e", "ci"] as const)(
  "%s never reads the production secret",
  async (env) => {
    await writePrivate(path, "MDF_SMTP_PASS=fake-production");
    const runner = vi.fn();
    const log = vi.fn();
    expect(await loadSmtpEnvironment(env, log, runner)).toEqual({
      MDF_SMTP_PASS: "",
    });
    expect(runner).not.toHaveBeenCalled();
    expect(log).not.toHaveBeenCalled();
  },
);

it.skipIf(process.platform !== "win32")(
  "refuses a readable file with broad ACLs without logging its value",
  async () => {
    await writePrivate(path, "MDF_SMTP_PASS=fake-secret-never-log");
    expect(
      (await realRunner("icacls", [path, "/grant", "*S-1-1-0:R"])).code,
    ).toBe(0);
    const log = vi.fn();
    expect(await loadSmtpEnvironment("prod", log)).toEqual({
      MDF_SMTP_PASS: "",
    });
    expect(log.mock.calls).toEqual([[SMTP_SETUP_NOTICE]]);
  },
);

it("requires password references and never persists credentials during logon refresh", () => {
  expect(() =>
    smtpEnvironment({ ...PRODUCTION_SMTP, pass: "fake-plaintext" }),
  ).toThrow(/environment reference/);
  const dir = stackDir("prod");
  mkdirSync(dir, { recursive: true });
  const compose = {
    services: {
      auth: {
        image: "test",
        environment: { KEEP: "unchanged", GOTRUE_SMTP_HOST: "old" },
      },
      db: { image: "test", environment: { KEEP: "db" } },
    },
    volumes: { legacy_db: { external: true } },
  };
  const file = join(dir, "compose.json");
  writeFileSync(file, JSON.stringify(compose));
  refreshProductionSmtp();
  refreshProductionSmtp();
  const content = readFileSync(file, "utf8");
  const updated = JSON.parse(content);
  expect(updated.services.auth.environment).toEqual({
    ...smtpEnvironment(PRODUCTION_SMTP),
    KEEP: "unchanged",
  });
  expect(updated.services.db).toEqual(compose.services.db);
  expect(updated.volumes).toEqual(compose.volumes);
  expect(content).not.toContain("ambient-must-not-be-used");
});

it("Docker interpolation disables SMTP without a key and passes a file value only to auth", async () => {
  const file = join(root, "compose.json");
  writeFileSync(
    file,
    JSON.stringify({
      services: {
        auth: {
          image: "alpine:3",
          environment: smtpEnvironment(PRODUCTION_SMTP),
        },
        other: { image: "alpine:3", environment: { KEEP: "unchanged" } },
      },
    }),
  );
  for (const value of ["", "fake-$dollar#hash=equals"]) {
    const result = await realRunner(
      "docker",
      ["compose", "-p", "smtp-test", "-f", file, "config", "--format", "json"],
      { env: { MDF_SMTP_PASS: value } },
    );
    expect(result.code).toBe(0);
    expect(result.stderr).not.toContain("MDF_SMTP_PASS");
    const services = JSON.parse(result.stdout).services;
    expect(services.auth.environment.GOTRUE_SMTP_HOST).toBe(
      value ? "smtp.resend.com" : "",
    );
    // Compose config escapes dollars for a reusable Compose document.
    expect(
      services.auth.environment.GOTRUE_SMTP_PASS.replaceAll("$$", "$"),
    ).toBe(value);
    expect(services.auth.environment.GOTRUE_SMTP_ADMIN_EMAIL).toBe(
      value ? "no-reply@mellodifai.com" : "",
    );
    expect(services.other.environment).toEqual({ KEEP: "unchanged" });
  }
}, 120_000);

it("forwards only the fixed SMTP diagnostic through service recovery", async () => {
  // This exercises the subprocess adapter; native services now call runStack
  // in process to retain the exclusive lease.
  vi.stubEnv("MELLODIFAI_RUNTIME", "docker");
  const log = vi.spyOn(console, "warn").mockImplementation(() => {});
  await serviceCommand(
    async () => ({
      code: 0,
      stdout: "private-output",
      stderr: `fake-secret\n${SMTP_SETUP_NOTICE}\n`,
    }),
    "start",
    "supabase",
  );
  expect(log.mock.calls).toEqual([[SMTP_SETUP_NOTICE]]);
});
