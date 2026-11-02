// @vitest-environment node
import { join } from "node:path";
import { unstable_doesMiddlewareMatch } from "next/experimental/testing/server";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ client: vi.fn(), read: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({ createClient: mocks.client }));
vi.mock("node:fs/promises", () => ({ readFile: mocks.read }));

import { config } from "../../../proxy";
import { GET } from "./route";

afterEach(() => vi.restoreAllMocks());

const worker = { data: { last_seen: "2026-11-03T00:00:00Z" }, error: null };
let from: ReturnType<typeof vi.fn>;
beforeEach(() => {
  vi.resetAllMocks();
  vi.spyOn(Date, "now").mockReturnValue(Date.parse("2026-11-03T00:00:15Z"));
  mocks.read.mockResolvedValue("m1-test\n");
  from = vi.fn((table: string) => ({
    select: vi.fn(() =>
      table === "workers"
        ? {
            order: vi.fn(() => ({
              limit: vi.fn(() => ({
                maybeSingle: vi.fn().mockResolvedValue(worker),
              })),
            })),
          }
        : { eq: vi.fn().mockResolvedValue({ count: 3, error: null }) },
    ),
  }));
  mocks.client.mockResolvedValue({ from });
});

it.each(["x-mdf-remote", "cf-connecting-ip", "cf-ray"])(
  "remote callers get only web with %s even if the database is down",
  async (header) => {
    mocks.client.mockRejectedValue(new Error("private failure"));
    const response = await GET(
      new Request("http://localhost/api/health", {
        headers: { [header]: "1" },
      }),
    );
    expect(await response.json()).toEqual({ web: "ok" });
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(mocks.client).not.toHaveBeenCalled();
    expect(mocks.read).not.toHaveBeenCalled();
  },
);

it("local callers get authenticated detail and explicitly unknown schema until Task 14", async () => {
  const response = await GET(new Request("http://localhost/api/health"));
  expect(await response.json()).toEqual({
    web: "ok",
    db: "ok",
    worker_heartbeat_age_s: 15,
    queue_depth: 3,
    version: "m1-test",
    schema: null,
  });
  expect(from.mock.calls.map(([table]) => table)).toEqual(["workers", "jobs"]);
  expect(mocks.read).toHaveBeenCalledWith(
    join(process.cwd(), ".next", "mdf-version"),
    "utf8",
  );
  expect(response.headers.get("cache-control")).toBe("no-store");
});

it("does not invent a worker heartbeat when no worker is visible", async () => {
  mocks.client.mockResolvedValue({
    from: () => ({
      select: () => ({
        order: () => ({
          limit: () => ({
            maybeSingle: async () => ({ data: null, error: null }),
          }),
        }),
        eq: async () => ({ count: 0, error: null }),
      }),
    }),
  });
  mocks.read.mockRejectedValue(new Error("missing"));
  const response = await GET(new Request("http://localhost/api/health"));
  expect(await response.json()).toMatchObject({
    db: "ok",
    worker_heartbeat_age_s: null,
    queue_depth: 0,
    version: "dev",
  });
});

it.each(["query", "transport"])(
  "reports %s failure without leaking database errors",
  async (failure) => {
    if (failure === "transport")
      mocks.client.mockRejectedValue(new Error("private credentials"));
    else
      mocks.client.mockResolvedValue({
        from: () => ({
          select: () => ({
            order: () => ({
              limit: () => ({
                maybeSingle: async () => ({
                  data: null,
                  error: { message: "private credentials" },
                }),
              }),
            }),
            eq: async () => ({
              count: null,
              error: { message: "private credentials" },
            }),
          }),
        }),
      });
    const response = await GET(new Request("http://localhost/api/health"));
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({
      web: "ok",
      db: "error",
      worker_heartbeat_age_s: null,
      queue_depth: null,
      schema: null,
      version: "m1-test",
    });
  },
);

it("health bypasses the auth proxy", () => {
  expect(
    unstable_doesMiddlewareMatch({
      config,
      nextConfig: {},
      url: "/api/health",
    }),
  ).toBe(false);
  expect(
    unstable_doesMiddlewareMatch({ config, nextConfig: {}, url: "/library" }),
  ).toBe(true);
});
