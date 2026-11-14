import { describe, expect, it } from "vitest";
import { assertTestStack, assertTestWebStack } from "../test-db-guard.js";

const e2e = {
  TEST_DB_URL: "postgresql://postgres:fixture@127.0.0.1:45622/postgres",
  SUPABASE_URL: "http://127.0.0.1:45621",
};

describe("assertTestWebStack", () => {
  const web = "postgresql://mdf_web:fixture@127.0.0.1:45622/postgres";
  it("accepts the web role on the guarded database", () => {
    expect(() =>
      assertTestWebStack({ ...e2e, MDF_WEB_DATABASE_URL: web }),
    ).not.toThrow();
  });
  it.each([
    undefined,
    "not-a-url",
    web.replace("45622", "54322"),
    web.replace("45622", "55322"),
    web.replace("45622", "46322"),
    web.replace("127.0.0.1", "example.com"),
    web.replace("/postgres", "/other"),
    `${web}?host=example.com`,
    `${web}?port=54322`,
    `${web}?database=other`,
  ])("refuses a missing or mismatched actual web connection", (url) => {
    expect(() =>
      assertTestWebStack({ ...e2e, MDF_WEB_DATABASE_URL: url }),
    ).toThrow();
    expect(() =>
      assertTestWebStack({ ...e2e, MDF_WEB_DATABASE_URL: url }),
    ).not.toThrow("fixture");
  });
  it("requires the API and database to belong to the same port block", () => {
    expect(() =>
      assertTestWebStack({
        ...e2e,
        SUPABASE_URL: "http://127.0.0.1:55321",
        MDF_WEB_DATABASE_URL: web,
      }),
    ).toThrow();
  });
});

describe("assertTestStack", () => {
  it.each(["?port=44322", "?host=example.com", "#port=44322"])(
    "refuses database URL suffix %s before connecting",
    (suffix) => {
      expect(() =>
        assertTestStack({
          ...e2e,
          TEST_DB_URL: `${e2e.TEST_DB_URL}${suffix}`,
        }),
      ).toThrow("TEST_DB_URL");
    },
  );

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

it("refuses new production ports even in CI", () => {
  for (const port of [44321, 44322]) {
    for (const name of ["TEST_DB_URL", "SUPABASE_URL"]) {
      const url = new URL(e2e[name as keyof typeof e2e]);
      url.port = String(port);
      expect(() =>
        assertTestStack({ ...e2e, CI: "true", [name]: url.href }),
      ).toThrow();
    }
  }
});

it("refuses the development stack even in CI", () => {
  for (const port of [55321, 55322]) {
    for (const name of ["TEST_DB_URL", "SUPABASE_URL"]) {
      const url = new URL(e2e[name as keyof typeof e2e]);
      url.port = String(port);
      expect(() =>
        assertTestStack({ ...e2e, CI: "true", [name]: url.href }),
      ).toThrow("non-test stack");
    }
  }
});
