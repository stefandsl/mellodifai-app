import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import { ENV_TABLE, type StackEnv, stackDir } from "../../lib/envs.js";
import { parseGatewayConfig } from "../../lib/native/gateway.js";
import { nativeLayout } from "../../lib/native/layout.js";
import {
  gatewayArgs,
  gatewayConfig,
  nativePlan,
} from "../../lib/native/plan.js";
import {
  assertNativeCommand,
  assertProductionInitialization,
  runNativeCommand,
} from "../../lib/native/stack.js";
import { renderConfig } from "../../lib/render.js";
import { fixture } from "./fixtures.js";

afterEach(() => vi.unstubAllEnvs());
const secrets = {
  postgres: "fake",
  jwt: "fake",
  realtime: "fake",
  crypto: "fake",
  dashboard: "fake",
  analytics: "fake",
  anon: "a".repeat(40),
  service: "s".repeat(40),
};
it.each(["dev", "e2e", "ci", "prod"] as StackEnv[])(
  "keeps every %s listener in its environment block and builds valid gateway config",
  (env) => {
    const root = fixture();
    vi.stubEnv("MELLODIFAI_ROOT", root);
    vi.stubEnv("RUNNER_TEMP", join(root, "runner"));
    mkdirSync(join(stackDir(env), "compose/templates"), { recursive: true });
    writeFileSync(
      join(stackDir(env), "compose/templates/magic_link.html"),
      "<p>test</p>",
    );
    const layout = nativeLayout(env);
    const values = ENV_TABLE[env];
    expect(layout.ports).toEqual({
      api: values.ports.api,
      db: values.ports.db,
      auth: values.listeners.shadow,
      rest: values.listeners.inspector,
      storage: values.listeners.pooler,
      templates: values.ports.api + 4,
      mailHttp: values.ports.inbucket,
      mailSmtp: values.ports.inbucket === null ? null : values.ports.analytics,
    });
    mkdirSync(dirname(values.signingKeysPath), { recursive: true });
    writeFileSync(values.signingKeysPath, "[]");
    const base = Math.floor(values.ports.api / 10) * 10;
    for (const port of Object.values(layout.ports).filter((p) => p !== null)) {
      expect(port).toBeGreaterThanOrEqual(base);
      expect(port).toBeLessThan(base + 10);
    }
    const config = gatewayConfig(env, layout, secrets);
    expect(parseGatewayConfig(config)).toMatchObject(config);
    if (env === "prod")
      expect(layout.root).toBe(join(root, "stacks/prod/native"));
    const opsDir = resolve(".");
    const tools = {
      pgBin: join(root, "pg/bin"),
      postgrest: join(root, "rest.exe"),
      auth: join(root, "auth.exe"),
      node: process.execPath,
      storageDir: join(root, "storage-source"),
      mailpit: join(root, "mailpit.exe"),
    };
    const toml = renderConfig(
      readFileSync(
        new URL("../../../supabase/config.toml", import.meta.url),
        "utf8",
      ),
      env,
      layout.root,
    );
    const specs = nativePlan({
      env,
      layout,
      tools,
      toml,
      secrets,
      logins: {
        supabase_auth_admin: "fake",
        supabase_storage_admin: "fake",
        authenticator: "fake",
      },
      smtp: { MDF_SMTP_PASS: "fake" },
      tsx: { node: process.execPath, cli: "unused" },
      opsDir,
    });
    const find = (id: string) => specs.find((s) => s.id === id);
    expect(find("auth")?.env.GOTRUE_API_PORT).toBe(String(layout.ports.auth));
    expect(find("auth")?.env.GOTRUE_DB_MAX_POOL_SIZE).toBe("10");
    expect(find("auth")?.env.GOTRUE_DB_MAX_IDLE_POOL_SIZE).toBe("5");
    expect(find("rest")?.env.PGRST_SERVER_PORT).toBe(String(layout.ports.rest));
    expect(find("storage")?.env.SERVER_PORT).toBe(String(layout.ports.storage));
    expect(find("storage")?.env.FILE_STORAGE_BACKEND_PATH).toBe(layout.objects);
    expect(find("gateway")?.args).toEqual(gatewayArgs(opsDir));
    expect(find("gateway")?.ipc).toBe(true);
    for (const spec of specs)
      expect(Number(new URL(spec.ready).port)).toBeGreaterThanOrEqual(base);
  },
);
it("refuses empty production boot before any tools or secrets, and refuses reset", async () => {
  const root = fixture();
  vi.stubEnv("MELLODIFAI_ROOT", root);
  const layout = nativeLayout("prod");
  expect(() => assertProductionInitialization("prod", layout, {})).toThrow(
    "--init-production",
  );
  expect(() =>
    assertProductionInitialization("prod", layout, { initProduction: true }),
  ).not.toThrow();
  expect(() => assertNativeCommand("reset", "prod", {})).toThrow(
    "Production reset is refused",
  );
  const writeEnvFile = vi.fn();
  await expect(
    runNativeCommand("start", "prod", {}, { writeEnvFile }),
  ).rejects.toThrow("--init-production");
  expect(writeEnvFile).not.toHaveBeenCalled();
});
