import { defineConfig, devices } from "@playwright/test";
import { localSupabaseUrl } from "./e2e/local-env";

// Refuses the live stack before anything starts (e2e/local-env.ts). The app under test is its own
// dev server on E2E_PORT (3310 by default), never the owner's app on 3210 (launcher), which talks to the live stack.
const supabaseUrl = localSupabaseUrl();
const supabaseAnonKey = process.env.SUPABASE_ANON_KEY ?? "";
const port = Number(process.env.E2E_PORT ?? 3310);
const base = `http://127.0.0.1:${port}`;

export default defineConfig({
  testDir: "./e2e",
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
    command: `pnpm --filter @mellodifai/web dev --hostname 127.0.0.1 --port ${port}`,
    url: base,
    timeout: 120_000,
    reuseExistingServer: false,
    env: {
      ...process.env,
      NEXT_PUBLIC_SUPABASE_URL: supabaseUrl,
      NEXT_PUBLIC_SUPABASE_ANON_KEY: supabaseAnonKey,
      NEXT_PUBLIC_SITE_URL: base,
    },
  },
});
