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
// (2026-11-01). The exception is only for an isolated CI runner.
it.each([
  "http://127.0.0.1:54321",
  "http://localhost:54321",
  "http://127.0.0.1:54322",
])("refuses the live stack %s by default", (url) => {
  expect(() => localSupabaseUrl(url, {})).toThrow("live Supabase stack");
  expect(() => localSupabaseUrl(url, { E2E_ALLOW_LIVE_STACK: "1" })).toThrow(
    "live Supabase stack",
  );
  expect(() => localSupabaseUrl(url, { CI: "true" })).toThrow(
    "live Supabase stack",
  );
  expect(localSupabaseUrl(url, { CI: "true", E2E_ALLOW_LIVE_STACK: "1" })).toBe(
    `${url}/`,
  );
});

it.each([44321, 44322, 46321, 46322])(
  "refuses the owner's production or desktop port %s even with both CI flags",
  (port) => {
    expect(() =>
      localSupabaseUrl(`http://127.0.0.1:${port}`, {
        CI: "true",
        E2E_ALLOW_LIVE_STACK: "1",
      }),
    ).toThrow("live Supabase stack");
  },
);
