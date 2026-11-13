import { beforeEach as beforeDockerCase, vi as legacyRuntime } from "vitest";

beforeDockerCase(() => legacyRuntime.stubEnv("MELLODIFAI_RUNTIME", "docker"));

import { generateKeyPairSync, randomUUID } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { parse } from "smol-toml";
import { afterEach, expect, it, vi } from "vitest";
import { composeEnvironment } from "../lib/compose.js";
import { renderConfig } from "../lib/render.js";
import type { Runner } from "../lib/run.js";
import { loadStackSecrets } from "../lib/stack-secrets.js";
import { rotateSupabaseKeys } from "../rotate-supabase-keys.js";

let root = "";
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  if (root) rmSync(root, { recursive: true, force: true });
  root = "";
});

function fixture() {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => new Response(null, { status: 200 })),
  );
  const base = process.env.RUNNER_TEMP ?? "E:/mellodifai/tmp";
  mkdirSync(base, { recursive: true });
  root = mkdtempSync(join(base, "task34-"));
  vi.stubEnv("MELLODIFAI_ROOT", root);
  const secretDir = join(root, "secrets/supabase");
  mkdirSync(secretDir, { recursive: true });
  mkdirSync(join(root, "stacks/prod/supabase"), { recursive: true });
  mkdirSync(join(root, "deploy/apps/web"), { recursive: true });
  mkdirSync(join(root, "deploy/apps/worker"), { recursive: true });
  writeFileSync(join(root, "stacks/prod/compose.json"), "{}");
  writeFileSync(
    join(root, "stacks/prod/supabase/config.toml"),
    renderConfig(
      readFileSync(
        new URL("../../supabase/config.toml", import.meta.url),
        "utf8",
      ),
      "prod",
      join(root, "stacks/prod"),
    ),
  );
  writeFileSync(join(root, "secrets/supabase/signing_keys.json"), "[]");
  writeFileSync(
    join(secretDir, "stack-secrets.json"),
    JSON.stringify({
      postgres: "postgres-test",
      jwt: "old-jwt",
      anon: "old-anon",
      service: "old-service",
      realtime: "realtime-test",
      crypto: "crypto-test",
      dashboard: "dashboard-test",
      analytics: "analytics-test",
    }),
  );
  writeFileSync(
    join(secretDir, "db-passwords.json"),
    '{"postgres":"postgres-test"}',
  );
  writeFileSync(
    join(root, "deploy/apps/web/.env.local"),
    "KEEP=web\nNEXT_PUBLIC_SUPABASE_ANON_KEY=old-anon\n",
  );
  writeFileSync(
    join(root, "deploy/apps/worker/.env.local"),
    "KEEP=worker\nSUPABASE_SERVICE_ROLE_KEY=old-service\n",
  );
  const { privateKey } = generateKeyPairSync("ec", { namedCurve: "P-256" });
  const key = {
    ...privateKey.export({ format: "jwk" }),
    kid: randomUUID(),
    alg: "ES256",
    use: "sig",
    key_ops: ["sign", "verify"],
  };
  const calls: Array<{ cmd: string; args: string[] }> = [];
  const runner: Runner = async (cmd, args) => {
    calls.push({ cmd, args });
    if (args.includes("signing-key"))
      writeFileSync(
        join(secretDir, "signing_keys.json"),
        JSON.stringify([key]),
      );
    return {
      code: 0,
      stdout: "",
      stderr: "",
    };
  };
  return { key, calls, runner };
}

it("writes keys only under secrets and never prints them", async () => {
  const { key, calls, runner } = fixture();
  const out = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
  const err = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
  await rotateSupabaseKeys(runner);
  const saved = JSON.parse(
    readFileSync(join(root, "secrets/supabase/stack-secrets.json"), "utf8"),
  );
  expect(
    JSON.parse(
      readFileSync(join(root, "secrets/supabase/signing_keys.json"), "utf8"),
    ),
  ).toEqual([key]);
  expect(readFileSync(join(root, "secrets/supabase/jwt-secret"), "utf8")).toBe(
    saved.jwt,
  );
  expect(saved.jwt).not.toBe("old-jwt");
  expect(saved.anon).not.toBe("old-anon");
  expect(saved.service).not.toBe("old-service");
  expect(
    readFileSync(join(root, "deploy/apps/web/.env.local"), "utf8"),
  ).toContain(`KEEP=web\nNEXT_PUBLIC_SUPABASE_ANON_KEY=${saved.anon}\n`);
  expect(
    readFileSync(join(root, "deploy/apps/worker/.env.local"), "utf8"),
  ).toContain(`KEEP=worker\nSUPABASE_SERVICE_ROLE_KEY=${saved.service}\n`);
  expect(existsSync(join(root, "stacks/prod/signing_keys.json"))).toBe(false);
  expect(existsSync(join(root, "stacks/prod/jwt-secret"))).toBe(false);
  expect(JSON.stringify(calls)).not.toContain(saved.jwt);
  expect(JSON.stringify(calls)).not.toContain(saved.service);
  expect(out).not.toHaveBeenCalled();
  expect(err).not.toHaveBeenCalled();
  expect(calls.some(({ args }) => args.includes("up"))).toBe(true);
  const environment = composeEnvironment(
    "prod",
    await loadStackSecrets("prod"),
  );
  expect(environment.MDF_SUPABASE_JWT_SECRET).toBe(saved.jwt);
});

it("refuses an empty canonical worker file before changing secrets or stopping services", async () => {
  const { calls, runner } = fixture();
  writeFileSync(join(root, "deploy/apps/worker/.env.local"), "");
  await expect(rotateSupabaseKeys(runner)).rejects.toThrow(/environment/i);
  expect(calls).toHaveLength(0);
  expect(
    readFileSync(join(root, "secrets/supabase/signing_keys.json"), "utf8"),
  ).toBe("[]");
});

it.each([false, true])(
  "passes off-C temp and cache paths to every service subprocess (rollback: %s)",
  async (rollback) => {
    const { runner } = fixture();
    const services: Array<{
      action: string;
      env: Record<string, string> | undefined;
    }> = [];
    let failed = false;
    const recorded: Runner = async (cmd, args, opts) => {
      const reply = await runner(cmd, args, opts);
      const action = args.find((arg) => arg === "__start" || arg === "__stop");
      if (action) services.push({ action, env: opts?.env });
      if (rollback && action === "__start" && !failed) {
        failed = true;
        return { code: 1, stdout: "", stderr: "" };
      }
      return reply;
    };
    if (rollback)
      await expect(rotateSupabaseKeys(recorded)).rejects.toThrow(/restored/i);
    else await rotateSupabaseKeys(recorded);
    expect(services.map(({ action }) => action)).toEqual(
      rollback
        ? [
            "__stop",
            "__stop",
            "__start",
            "__stop",
            "__stop",
            "__start",
            "__start",
          ]
        : ["__stop", "__stop", "__start", "__start"],
    );
    for (const { env } of services)
      expect(env).toEqual({
        MELLODIFAI_ROOT: root,
        TEMP: join(root, "tmp"),
        TMP: join(root, "tmp"),
        TMPDIR: join(root, "tmp"),
        npm_config_cache: join(root, "cache/npm"),
        npm_config_store_dir: join(root, "cache/pnpm"),
      });
  },
);

it.each(["up", "build", "__start"])(
  "restores keys, application env and services after a failed %s",
  async (failure) => {
    const { runner, calls } = fixture();
    const keyFile = join(root, "secrets/supabase/signing_keys.json");
    let failed = false;
    const faulty: Runner = async (cmd, args, opts) => {
      const reply = await runner(cmd, args, opts);
      if (
        !failed &&
        args.some(
          (arg) =>
            arg === failure || (failure === "build" && arg.endsWith(" build")),
        )
      ) {
        failed = true;
        return { code: 1, stdout: "private output", stderr: "private error" };
      }
      return reply;
    };
    await expect(rotateSupabaseKeys(faulty)).rejects.toThrow(/restored/i);
    expect(failed).toBe(true);
    expect(readFileSync(keyFile, "utf8")).toBe("[]");
    expect(existsSync(join(root, "secrets/supabase/jwt-secret"))).toBe(false);
    expect(
      readFileSync(join(root, "deploy/apps/web/.env.local"), "utf8"),
    ).toContain("=old-anon");
    expect(
      readFileSync(join(root, "deploy/apps/worker/.env.local"), "utf8"),
    ).toContain("=old-service");
    expect(
      calls.filter(({ args }) => args.includes("up")).length,
    ).toBeGreaterThanOrEqual(2);
    expect(
      readdirSync(join(root, "secrets/supabase")).some((file) =>
        file.endsWith(".backup"),
      ),
    ).toBe(false);
  },
);

it("the rendered prod config holds env(MDF_SUPABASE_JWT_SECRET), not a value", () => {
  fixture();
  const base = readFileSync(
    join(process.cwd(), "../supabase/config.toml"),
    "utf8",
  );
  const rendered = parse(renderConfig(base, "prod", join(root, "stacks/prod")));
  expect((rendered.auth as { jwt_secret: string }).jwt_secret).toBe(
    "env(MDF_SUPABASE_JWT_SECRET)",
  );
  expect(JSON.stringify(rendered)).not.toContain("old-jwt");
});

it("keeps a private recovery backup when restart and rollback both fail", async () => {
  const { runner } = fixture();
  const faulty: Runner = async (cmd, args, opts) => {
    const reply = await runner(cmd, args, opts);
    return args.includes("up")
      ? { code: 1, stdout: "private", stderr: "private" }
      : reply;
  };
  await expect(rotateSupabaseKeys(faulty)).rejects.toThrow(/recovery failed/);
  const backups = readdirSync(join(root, "secrets/supabase")).filter((file) =>
    file.endsWith(".backup"),
  );
  expect(backups).toHaveLength(1);
  const backup = JSON.parse(
    readFileSync(join(root, "secrets/supabase", backups[0] as string), "utf8"),
  );
  expect(backup[join(root, "secrets/supabase/signing_keys.json")]).toBe("[]");
});

it("refuses a rendered config pointing at another signing key before invoking the CLI", async () => {
  const { runner, calls } = fixture();
  const file = join(root, "stacks/prod/supabase/config.toml");
  writeFileSync(
    file,
    readFileSync(file, "utf8").replace("signing_keys.json", "other-key.json"),
  );
  await expect(rotateSupabaseKeys(runner)).rejects.toThrow(/config/i);
  expect(calls).toHaveLength(0);
});
