import { join } from "node:path";
import { defineConfig, devices } from "@playwright/test";
import { assertTestWebStack } from "../../ops/test-db-guard";
import { localSupabaseUrl } from "./e2e/local-env";

// The public site on three browser engines. The site needs no sign-in, so only the web server
// runs (on E2E_PORT, the same guarded test stack as e2e/, never the owner's server on 3000).
const supabaseUrl = localSupabaseUrl();
const port = Number(process.env.E2E_PORT ?? 3210);
if (!Number.isInteger(port) || port < 1024 || port > 65535)
  throw new Error("Invalid E2E server port");
if (process.env.WORKER_FAKE !== "1")
  throw new Error("E2E requires WORKER_FAKE=1");
assertTestWebStack(process.env);
const runtime =
  process.env.RUNNER_TEMP || process.env.MELLODIFAI_ROOT || "E:/mellodifai";

export default defineConfig({
  testDir: "./e2e/site",
  outputDir: join(runtime, "test-results/web-site"),
  timeout: 90_000,
  expect: { timeout: 15_000 },
  fullyParallel: false,
  workers: 2,
  // SITE_BASE_URL: judge a server that already runs (a lab build), without starting one.
  use: {
    baseURL: process.env.SITE_BASE_URL ?? `http://127.0.0.1:${port}`,
    trace: "off",
  },
  projects: [
    { name: "chromium", use: { ...devices["Desktop Chrome"] } },
    { name: "firefox", use: { ...devices["Desktop Firefox"] } },
    { name: "webkit", use: { ...devices["Desktop Safari"] } },
  ],
  webServer: process.env.SITE_BASE_URL
    ? undefined
    : {
        command: `pnpm --workspace-root ops e2e-server.ts ${port}`,
        url: `http://127.0.0.1:${port}/`,
        timeout: 240_000,
        reuseExistingServer: false,
        env: {
          ...process.env,
          TEMP: runtime,
          TMP: runtime,
          TMPDIR: runtime,
          NEXT_PUBLIC_SUPABASE_URL: supabaseUrl,
          NEXT_PUBLIC_SUPABASE_ANON_KEY: process.env.SUPABASE_ANON_KEY ?? "",
          SUPABASE_INTERNAL_URL: supabaseUrl,
          MDF_WEB_DATABASE_URL: process.env.MDF_WEB_DATABASE_URL ?? "",
          SITE_URL: `http://127.0.0.1:${port}`,
        },
      },
});
