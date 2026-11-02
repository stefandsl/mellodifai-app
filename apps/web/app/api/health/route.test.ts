// @vitest-environment node
import { unstable_doesMiddlewareMatch } from "next/experimental/testing/server";
import { beforeEach, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ call: vi.fn(), read: vi.fn() }));
vi.mock("@/lib/db/ops-client", () => ({ callOps: mocks.call }));
vi.mock("node:fs/promises", () => ({ readFile: mocks.read }));

import { config } from "../../../proxy";
import { GET } from "./route";

beforeEach(() => {
  vi.resetAllMocks();
  mocks.read.mockResolvedValue("m1-test\n");
  mocks.call.mockResolvedValue({
    ok: true,
    data: {
      db: "ok",
      ops: "ok",
      worker_heartbeat_age_s: 15,
      queue_depth: 3,
      schema: "20261102000028",
      at: "private probe timestamp",
    },
  });
});
it.each(["x-mdf-remote", "cf-connecting-ip", "cf-ray"])(
  "remote callers get only web with %s even if the database is down",
  async (header) => {
    mocks.call.mockRejectedValue(new Error("private failure"));
    const response = await GET(
      new Request("http://localhost/api/health", {
        headers: { [header]: "1" },
      }),
    );
    expect(await response.json()).toEqual({ web: "ok" });
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(mocks.call).not.toHaveBeenCalled();
    expect(mocks.read).not.toHaveBeenCalled();
  },
);
it("local callers get ops write/read health and applied migration without a cookie", async () => {
  const response = await GET(new Request("http://localhost/api/health"));
  expect(response.status).toBe(200);
  expect(await response.json()).toEqual({
    web: "ok",
    db: "ok",
    ops: "ok",
    worker_heartbeat_age_s: 15,
    queue_depth: 3,
    schema: "20261102000028",
    version: "m1-test",
  });
  expect(mocks.call).toHaveBeenCalledWith("health", []);
  expect(response.headers.get("cache-control")).toBe("no-store");
});
it("preserves a missing heartbeat and falls back to dev version", async () => {
  mocks.read.mockRejectedValue(new Error("missing"));
  mocks.call.mockResolvedValue({
    ok: true,
    data: {
      db: "ok",
      ops: "ok",
      worker_heartbeat_age_s: null,
      queue_depth: 0,
      schema: "20261102000028",
    },
  });
  expect(
    await (await GET(new Request("http://localhost/api/health"))).json(),
  ).toMatchObject({ worker_heartbeat_age_s: null, version: "dev" });
});
it("reports ops failure without leaking database errors", async () => {
  mocks.call.mockResolvedValue({
    ok: false,
    code: "internal",
    message: "private credentials",
  });
  const response = await GET(new Request("http://localhost/api/health"));
  expect(response.status).toBe(503);
  expect(await response.json()).toEqual({
    web: "ok",
    db: "error",
    ops: "error",
    worker_heartbeat_age_s: null,
    queue_depth: null,
    schema: null,
    version: "m1-test",
  });
});
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
