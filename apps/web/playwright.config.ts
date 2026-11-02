import { join } from "node:path";
import { defineConfig, devices } from "@playwright/test";
import { localSupabaseUrl } from "./e2e/local-env";

// Refuses the live stack before anything starts (e2e/local-env.ts). The app under test is its own
// dev server on E2E_PORT (3210), never the owner's server on 3000, which talks to the live stack.
const supabaseUrl = localSupabaseUrl();
const supabaseAnonKey = process.env.SUPABASE_ANON_KEY ?? "";
const port = Number(process.env.E2E_PORT ?? 3210);
const base = `http://127.0.0.1:${port}`;

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
    trace: "retain-on-failure",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: {
    command: `pnpm --filter @mellodifai/web exec next dev -H 127.0.0.1 -p ${port}`,
    url: base,
    timeout: 120_000,
    reuseExistingServer: false,
    env: {
      ...process.env,
      NEXT_PUBLIC_SUPABASE_URL: supabaseUrl,
      NEXT_PUBLIC_SUPABASE_ANON_KEY: supabaseAnonKey,
      SUPABASE_INTERNAL_URL: process.env.SUPABASE_INTERNAL_URL ?? supabaseUrl,
      MDF_WEB_DATABASE_URL: process.env.MDF_WEB_DATABASE_URL ?? "",
      SITE_URL: process.env.SITE_URL ?? base,
      NEXT_PUBLIC_SITE_URL: base,
    },
  },
});
