// @vitest-environment node
import { afterEach, expect, it, vi } from "vitest";
import { AUTH_ORIGINS } from "../../../ops/lib/auth-origins";
import { emailRedirect, redirectUrl, safeNext } from "./redirect-url";

afterEach(() => vi.unstubAllEnvs());

it("a local origin outside additional_redirect_urls is refused (Major 18)", () => {
  for (const origin of [
    "http://localhost:3000",
    "https://evil.test",
    "http://localhost:3001.evil.test",
    "http://localhost:3001/path",
  ]) {
    expect(() =>
      emailRedirect(origin, AUTH_ORIGINS.dev, false, "/create"),
    ).toThrow();
  }
});

it.each(["localhost", "127.0.0.1"])("%s:3001 is accepted on dev", (host) => {
  expect(
    emailRedirect(`http://${host}:3001`, AUTH_ORIGINS.dev, false, "/library"),
  ).toBe(`http://${host}:3001/auth/confirm?next=%2Flibrary`);
});

it("remote requests always use SITE_URL", () => {
  expect(
    emailRedirect(
      "https://evil.test",
      AUTH_ORIGINS.prod,
      true,
      "/consent?uid=flow",
    ),
  ).toBe(
    "https://app.mellodifai.com/auth/confirm?next=%2Fconsent%3Fuid%3Dflow",
  );
});

it("remote next accepts only /consent?uid=", () => {
  expect(safeNext("/consent?uid=flow", true)).toBe("/consent?uid=flow");
  for (const next of [
    "/create",
    "/consent",
    "/consent?uid=",
    "/consent?uid=a&uid=b",
    "/consent?uid=a&next=b",
    "/consent?uid=a#fragment",
    "/other/../consent?uid=a",
  ]) {
    expect(safeNext(next, true)).toBe("/login");
  }
});

it.each([
  "https://evil.test",
  "//evil.test",
  "/\\evil.test",
  "/%5cevil.test",
  "/%2fevil.test",
  "/%0aevil",
  "/%",
  " create",
])("refuses unsafe next %s", (next) => {
  expect(safeNext(next, false)).toBe("/create");
  expect(safeNext(next, true)).toBe("/login");
});

it("local next accepts app paths and queries", () => {
  expect(safeNext("/library?search=hello%20world#songs", false)).toBe(
    "/library?search=hello%20world#songs",
  );
});

it("redirects preserve approved local hosts and pin remote hosts", () => {
  vi.stubEnv("SITE_URL", AUTH_ORIGINS.prod.siteUrl);
  const local = new Request("http://internal/", {
    headers: { host: "localhost:3000" },
  });
  expect(redirectUrl(local, "/create").href).toBe(
    "http://localhost:3000/create",
  );
  const remote = new Request("http://internal/", {
    headers: { host: "evil.test", "x-mdf-remote": "1" },
  });
  expect(redirectUrl(remote, "/login").href).toBe(
    "https://app.mellodifai.com/login",
  );
  expect(() =>
    redirectUrl(new Request("http://evil.test/"), "/create"),
  ).toThrow();
});
