import { expect, it } from "vitest";
import { localSupabaseUrl } from "../e2e/local-env";

it.each([
  "https://production.supabase.co",
  "http://localhost.evil.test",
  "http://127.0.0.2",
  "invalid",
  "",
  "ftp://localhost",
])("rejects nonlocal E2E URL %s", (url) => {
  expect(() => localSupabaseUrl(url)).toThrow("local SUPABASE_URL");
});
it.each(["http://127.0.0.1:45621", "http://localhost:45621"])(
  "accepts the separate e2e stack %s",
  (url) => {
    expect(localSupabaseUrl(url, {})).toBe(`${url}/`);
  },
);
// The live stack's worker runs paid engines: a full-flow test there spent 12 kie credits
// (2026-11-01). It is refused unless explicitly allowed.
it.each(["http://127.0.0.1:54321", "http://localhost:54321"])(
  "refuses the live stack %s by default",
  (url) => {
    expect(() => localSupabaseUrl(url, {})).toThrow("live Supabase stack");
    expect(localSupabaseUrl(url, { E2E_ALLOW_LIVE_STACK: "1" })).toBe(
      `${url}/`,
    );
  },
);
