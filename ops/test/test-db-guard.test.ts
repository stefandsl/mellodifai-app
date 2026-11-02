import { describe, expect, it } from "vitest";
import { assertTestStack } from "../test-db-guard.js";

const e2e = {
  TEST_DB_URL: "postgresql://postgres:fixture@127.0.0.1:45622/postgres",
  SUPABASE_URL: "http://127.0.0.1:45621",
};

describe("assertTestStack", () => {
  it("refuses 54321 and 54322 outside CI", () => {
    for (const name of ["TEST_DB_URL", "SUPABASE_URL"]) {
      for (const port of [54321, 54322]) {
        const url = new URL(e2e[name as keyof typeof e2e]);
        url.port = String(port);
        expect(() => assertTestStack({ ...e2e, [name]: url.href })).toThrow();
      }
    }
  });

  it("accepts 45621", () => {
    expect(() => assertTestStack(e2e)).not.toThrow();
  });

  it("accepts 54321 when CI=true", () => {
    expect(() =>
      assertTestStack({
        CI: "true",
        TEST_DB_URL: "postgresql://postgres:fixture@127.0.0.1:54322/postgres",
        SUPABASE_URL: "http://127.0.0.1:54321",
      }),
    ).not.toThrow();
  });

  it("refuses a non-loopback host", () => {
    for (const name of ["TEST_DB_URL", "SUPABASE_URL"]) {
      for (const CI of [undefined, "true"]) {
        const url = new URL(e2e[name as keyof typeof e2e]);
        url.hostname = "example.com";
        expect(() =>
          assertTestStack({ ...e2e, CI, [name]: url.href }),
        ).toThrow();
      }
    }
  });

  it("refuses missing, malformed and wrong-protocol URLs without exposing credentials", () => {
    for (const name of ["TEST_DB_URL", "SUPABASE_URL"]) {
      for (const value of [
        undefined,
        "secret-fixture",
        "file:///secret-fixture",
      ]) {
        expect(() => assertTestStack({ ...e2e, [name]: value })).toThrow(name);
        expect(() => assertTestStack({ ...e2e, [name]: value })).not.toThrow(
          "secret-fixture",
        );
      }
    }
  });

  it("accepts localhost and IPv6 loopback", () => {
    for (const host of ["localhost", "[::1]"]) {
      expect(() =>
        assertTestStack({
          TEST_DB_URL: `postgres://postgres:fixture@${host}:45622/postgres`,
          SUPABASE_URL: `http://${host}:45621`,
        }),
      ).not.toThrow();
    }
  });
});
