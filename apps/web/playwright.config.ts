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
const stack = process.env.CI === "true" ? "ci" : "e2e";
const runtime =
  process.env.RUNNER_TEMP || process.env.MELLODIFAI_ROOT || "E:/mellodifai";
// The provisioned runtime directory already exists, including RUNNER_TEMP in CI.
const serverEnv = {
  ...process.env,
  TEMP: runtime,
  TMP: runtime,
  TMPDIR: runtime,
};
const authSecrets = join(runtime, "secrets/auth", stack).replaceAll("\\", "/");
// Both service roles must target the same guarded stack before any server starts.
assertTestWebStack(process.env);
assertTestWebStack({
  ...process.env,
  MDF_WEB_DATABASE_URL: process.env.MDF_AUTH_DATABASE_URL,
});

export default defineConfig({
  testDir: "./e2e",
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
      command: `pnpm --workspace-root ops e2e-server.ts ${port}`,
      url: base,
      timeout: 240_000,
      reuseExistingServer: false,
      env: {
        ...serverEnv,
        NEXT_PUBLIC_SUPABASE_URL: supabaseUrl,
        NEXT_PUBLIC_SUPABASE_ANON_KEY: supabaseAnonKey,
        SUPABASE_INTERNAL_URL: process.env.SUPABASE_INTERNAL_URL ?? supabaseUrl,
        MDF_WEB_DATABASE_URL: process.env.MDF_WEB_DATABASE_URL ?? "",
        // The canonical resource remains on 3212 even with the local 3219 override.
        SITE_URL: AUTH_ORIGINS[stack].siteUrl,
      },
    },
    {
      command: `pnpm --filter @mellodifai/auth exec node --env-file="${authSecrets}/auth.env" --import tsx src/main.ts`,
      url: "http://127.0.0.1:3211/oauth/.well-known/openid-configuration",
      timeout: 60_000,
      reuseExistingServer: false,
      env: {
        ...serverEnv,
        HOST: "127.0.0.1",
        PORT: "3211",
        MDF_AUTH_ISSUER: AUTH_ORIGINS[stack].issuer,
        MDF_AUTH_DATABASE_URL: process.env.MDF_AUTH_DATABASE_URL ?? "",
        MDF_AUTH_JWKS_PATH: `${authSecrets}/jwks.json`,
      },
    },
    {
      command: `pnpm --workspace-root ops edge-proxy.ts --mode local --listen 3212 --next ${base} --auth http://127.0.0.1:3211`,
      url: "http://127.0.0.1:3212/.well-known/oauth-authorization-server/oauth",
      timeout: 60_000,
      reuseExistingServer: false,
      env: serverEnv,
    },
  ],
});
