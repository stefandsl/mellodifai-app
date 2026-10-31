import { NextRequest } from "next/server";
import { beforeEach, expect, it, vi } from "vitest";

const getUser = vi.hoisted(() => vi.fn());
vi.mock("@supabase/ssr", () => ({
  createServerClient: () => ({ auth: { getUser } }),
}));

import { proxy } from "./proxy";

beforeEach(() => {
  getUser.mockReset();
  getUser.mockResolvedValue({ data: { user: null } });
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
