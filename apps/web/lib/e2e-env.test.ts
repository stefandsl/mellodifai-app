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
it.each(["http://127.0.0.1:54321", "http://localhost:54321"])(
  "accepts %s",
  (url) => {
    expect(localSupabaseUrl(url)).toBe(`${url}/`);
  },
);
