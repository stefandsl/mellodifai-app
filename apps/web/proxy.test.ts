import { NextRequest } from "next/server";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

const getUser = vi.hoisted(() => vi.fn());
const maybeSingle = vi.hoisted(() => vi.fn());
vi.mock("@supabase/ssr", () => ({
  createServerClient: () => ({
    auth: { getUser },
    from: () => ({ select: () => ({ eq: () => ({ maybeSingle }) }) }),
  }),
}));

import { proxy } from "./proxy";

beforeEach(() => {
  vi.stubEnv("NODE_ENV", "development");
  getUser.mockReset();
  getUser.mockResolvedValue({ data: { user: null } });
  maybeSingle.mockResolvedValue({ data: { id: "profile" } });
});
afterEach(() => vi.unstubAllEnvs());
it.each([
  ["POST", "/projects/new?code=action"],
  ["GET", "/api?code=api"],
  ["GET", "/api/example?code=api"],
  ["GET", "/_next/data?code=data"],
])("does not intercept %s %s", async (method, path) => {
  const response = await proxy(
    new NextRequest(new URL(path, "http://localhost:3000"), { method }),
  );
  expect(response.headers.get("location")).toBeNull();
});

it.each(["/", "/login", "/library", "/projects/new"])(
  "forwards an auth code arriving at %s to the callback on the same host",
  async (path) => {
    const url = new URL(path, "http://127.0.0.1:3000");
    url.searchParams.set("code", "test+code/with=symbols");
    url.searchParams.set("next", "https://example.com");
    const response = await proxy(
      new NextRequest(url, {
        headers: {
          host: "localhost:3000",
          "x-forwarded-host": "127.0.0.1:3000",
        },
      }),
    );
    expect(response.headers.get("location")).toMatch(
      /^http:\/\/127\.0\.0\.1:3000\//u,
    );
    const target = new URL(response.headers.get("location") ?? url, url);
    expect(target.origin).toBe(url.origin);
    expect(target.pathname).toBe("/auth/confirm");
    expect(target.searchParams.get("code")).toBe("test+code/with=symbols");
    expect(target.searchParams.has("next")).toBe(false);
    expect(getUser).not.toHaveBeenCalled();
  },
);

it("redirects a password or magic-link session without an allowlisted profile", async () => {
  getUser.mockResolvedValue({ data: { user: { id: "session-user" } } });
  maybeSingle.mockResolvedValue({ data: null });
  const response = await proxy(
    new NextRequest("http://127.0.0.1:3000/library"),
  );
  expect(
    new URL(response.headers.get("location") ?? "http://bad").pathname,
  ).toBe("/login");
});

it.each(["/auth/confirm?code=valid", "/library", "/?code="])(
  "continues normal session handling for %s without a redirect loop",
  async (path) => {
    const response = await proxy(
      new NextRequest(new URL(path, "http://127.0.0.1:3000")),
    );
    expect(response.headers.get("location")).toBeNull();
    expect(getUser).toHaveBeenCalledOnce();
  },
);
