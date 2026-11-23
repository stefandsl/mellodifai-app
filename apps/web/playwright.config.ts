import { join } from "node:path";
import { defineConfig, devices } from "@playwright/test";
import { AUTH_ORIGINS } from "../../ops/lib/auth-origins";
import { assertTestWebStack } from "../../ops/test-db-guard";
import { localSupabaseUrl } from "./e2e/local-env";

// Refuses the live stack before anything starts (e2e/local-env.ts). The app under test is its own
// dev server on E2E_PORT (3210), never the owner's server on 3000, which talks to the live stack.
const supabaseUrl = localSupabaseUrl();
const supabaseAnonKey = process.env.SUPABASE_ANON_KEY ?? "";
const port = Number(process.env.E2E_PORT ?? 3210);
const base = `http://127.0.0.1:${port}`;
const authPort = Number(process.env.E2E_AUTH_PORT ?? 3211);
const stack = new URL(supabaseUrl).port === "45621" ? "e2e" : "ci";
const edge = new URL(AUTH_ORIGINS[stack].issuer);
for (const value of [port, authPort, Number(edge.port)]) {
  if (!Number.isInteger(value) || value < 1024 || value > 65535)
    throw new Error("Invalid E2E server port");
}
if (new Set([port, authPort, Number(edge.port)]).size !== 3)
  throw new Error("E2E servers require three distinct ports");
if (process.env.WORKER_FAKE !== "1")
  throw new Error("E2E requires WORKER_FAKE=1");
const runtime =
  process.env.RUNNER_TEMP || process.env.MELLODIFAI_ROOT || "E:/mellodifai";
// The provisioned runtime directory already exists, including RUNNER_TEMP in CI.
const serverEnv = {
  ...process.env,
  TEMP: runtime,
  TMP: runtime,
  TMPDIR: runtime,
};
// The same root ops/rotate-auth-keys.ts writes to: RUNNER_TEMP only for the ci
// stack, the runtime root for e2e (a CI job running e2e has both set).
const authRoot =
  stack === "ci"
    ? process.env.RUNNER_TEMP || ""
    : process.env.MELLODIFAI_ROOT || "E:/mellodifai";
const authSecrets = join(authRoot, "secrets/auth", stack).replaceAll(
  "\\",
  "/",
);
// Both service roles must target the same guarded stack before any server starts.
assertTestWebStack(process.env);
assertTestWebStack({
  ...process.env,
  MDF_WEB_DATABASE_URL: process.env.MDF_AUTH_DATABASE_URL,
});

export default defineConfig({
  testDir: "./e2e",
  // The public site has its own three-engine config (playwright.site.config.ts).
  testIgnore: ["site/**"],
  outputDir: join(
    process.env.RUNNER_TEMP ?? process.env.MELLODIFAI_ROOT ?? "E:/mellodifai",
    "test-results/web",
  ),
  globalSetup: "./e2e/global-setup.ts",
  timeout: 60_000,
  expect: { timeout: 60_000 },
  fullyParallel: false,
  workers: 1,
  use: {
    baseURL: base,
    // Sign-in URLs and session cookies are credentials.
    trace: "off",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: [
    {
      command: `pnpm --filter @mellodifai/auth exec node --env-file="${authSecrets}/auth.env" --import tsx src/main.ts`,
      url: `http://127.0.0.1:${authPort}/oauth/.well-known/openid-configuration`,
      timeout: 60_000,
      reuseExistingServer: false,
      env: {
        ...serverEnv,
        HOST: "127.0.0.1",
        PORT: String(authPort),
        MDF_AUTH_ISSUER: AUTH_ORIGINS[stack].issuer,
        MDF_AUTH_DATABASE_URL: process.env.MDF_AUTH_DATABASE_URL ?? "",
        MDF_AUTH_JWKS_PATH: `${authSecrets}/jwks.json`,
      },
    },
    {
      command: `pnpm --workspace-root ops edge-proxy.ts --mode local --listen ${edge.port} --next ${base} --auth http://127.0.0.1:${authPort}`,
      url: `${edge.origin}/.well-known/oauth-authorization-server/oauth`,
      timeout: 60_000,
      reuseExistingServer: false,
      env: serverEnv,
    },
    {
      command: `pnpm --workspace-root ops e2e-server.ts ${port}`,
      url: base,
      timeout: 240_000,
      reuseExistingServer: false,
      env: {
        ...serverEnv,
        NEXT_PUBLIC_SUPABASE_URL: supabaseUrl,
        NEXT_PUBLIC_SUPABASE_ANON_KEY: supabaseAnonKey,
        SUPABASE_INTERNAL_URL: supabaseUrl,
        MDF_WEB_DATABASE_URL: process.env.MDF_WEB_DATABASE_URL ?? "",
        // The shared origin configuration binds discovery and bearer audiences.
        SITE_URL: AUTH_ORIGINS[stack].siteUrl,
      },
    },
  ],
});
