// @vitest-environment node
import { unstable_doesMiddlewareMatch } from "next/experimental/testing/server";
import { NextRequest } from "next/server";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

const getUser = vi.hoisted(() => vi.fn());
vi.mock("@supabase/ssr", () => ({
  createServerClient: () => ({ auth: { getUser } }),
}));

import { config, proxy } from "./proxy";

beforeEach(() => {
  vi.stubEnv("SITE_URL", "https://app.mellodifai.com");
  getUser.mockReset();
  getUser.mockResolvedValue({ data: { user: null } });
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
    expect(target.searchParams.get("next")).toBe("/create");
    expect(getUser).not.toHaveBeenCalled();
  },
);

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
it.each([
  "/api/v1",
  "/api/v1/projects",
  "/api/mcp",
  "/.well-known/oauth-protected-resource",
  "/api/health",
  "/api/transcribe",
])("does not buffer or authenticate %s in the proxy", (url) => {
  expect(unstable_doesMiddlewareMatch({ config, nextConfig: {}, url })).toBe(
    false,
  );
});
it.each(["/login", "/create", "/auth/confirm", "/api/v10"])(
  "keeps the session proxy on %s",
  (url) => {
    expect(unstable_doesMiddlewareMatch({ config, nextConfig: {}, url })).toBe(
      true,
    );
  },
);
