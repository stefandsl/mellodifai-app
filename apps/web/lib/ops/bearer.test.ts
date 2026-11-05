// @vitest-environment node
import { createHash } from "node:crypto";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { z } from "zod";
import { bearerCtx, runTokenOp, runTokenOperation } from "./bearer";
import { newPat } from "./tokens";

const mocks = vi.hoisted(() => ({ sql: vi.fn(), callOps: vi.fn() }));
vi.mock("@/lib/db/ops-client", () => ({
  opsSql: () => ({ unsafe: mocks.sql }),
  callOps: mocks.callOps,
}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

const def = {
  name: "lyrics_back",
  fn: "lyrics_back",
  input: z.object({}),
  args: () => [],
  output: z.object({ status: z.string() }),
  scope: "create" as const,
  key: true,
  mutating: true,
  revalidate: () => [],
};
const request = (path: string, token?: string) =>
  new Request(`http://127.0.0.1:3219${path}`, {
    method: "POST",
    headers: {
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      "Idempotency-Key": "test-key-123",
    },
  });
beforeEach(() => {
  vi.resetAllMocks();
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-11-06T00:00:00Z"));
  vi.stubEnv("SITE_URL", "http://127.0.0.1:3210");
  mocks.callOps.mockImplementation(async (name) => ({
    ok: true,
    data: name === "idem_begin" ? { status: "new" } : { status: "done" },
  }));
  mocks.sql.mockResolvedValue([
    { result: { user_id: "user", token_id: "grant" } },
  ]);
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
});

it("PAT format and hint", () => {
  const first = newPat();
  expect(/^mdf_pat_[0-9A-Za-z]{43}$/.test(first.token)).toBe(true);
  expect(first.hint === `mdf_pat_...${first.token.slice(-4)}`).toBe(true);
  expect(
    first.hash === createHash("sha256").update(first.token).digest("hex"),
  ).toBe(true);
  expect(first.token === newPat().token).toBe(false);
});

it("a cookie on /api/v1 is ignored (401)", async () => {
  const req = request("/api/v1/songs");
  req.headers.set("cookie", "sb-access-token=cookie-session");
  const response = await runTokenOp(def, req, {});
  expect(response.status).toBe(401);
  expect(await response.json()).toMatchObject({
    error: { code: "unauthorized" },
  });
  expect(mocks.callOps).not.toHaveBeenCalled();
  expect(mocks.sql).not.toHaveBeenCalled();
});

it("hashes PATs and propagates trusted remote markers without cookies", async () => {
  const req = request("/api/v1/songs", "mdf_pat_test");
  req.headers.set("cf-ray", "remote");
  const ctx = await bearerCtx(req, ["pat"]);
  expect(ctx).toMatchObject({
    actor_kind: "pat",
    remote: true,
    token_hash: createHash("sha256").update("mdf_pat_test").digest("hex"),
  });
  expect(ctx).not.toHaveProperty("user_id");
  expect(mocks.sql).not.toHaveBeenCalled();
});

it("resolves OAuth on every call using the canonical public MCP resource", async () => {
  const req = request("/api/mcp", "opaque-access");
  const ctx = await bearerCtx(req, ["pat", "oauth"]);
  if (!ctx) throw new Error("Expected bearer context");
  expect(ctx).toMatchObject({
    actor_kind: "oauth",
    user_id: "user",
    token_id: "grant",
    resource: "http://127.0.0.1:3212/api/mcp",
  });
  expect(mocks.sql).toHaveBeenCalledWith(
    "select ops.resolve_access_token($1, $2) as result",
    [
      createHash("sha256").update("opaque-access").digest("hex"),
      "http://127.0.0.1:3212/api/mcp",
    ],
  );
  mocks.sql.mockRejectedValueOnce(new Error("private refusal"));
  expect(await bearerCtx(req, ["pat", "oauth"])).toBeNull();
});

it("OAuth cannot authenticate /api/v1 and a PAT cannot bypass the allow list", async () => {
  expect(
    (await runTokenOp(def, request("/api/v1/songs", "opaque"), {})).status,
  ).toBe(401);
  expect(
    await bearerCtx(request("/api/mcp", "mdf_pat_test"), ["oauth"]),
  ).toBeNull();
  expect(mocks.sql).not.toHaveBeenCalled();
});

it.each(["Basic abc", "Bearer", "Bearer one two"])(
  "rejects malformed authorization: %s",
  async (value) => {
    const req = request("/api/v1/songs");
    req.headers.set("authorization", value);
    expect(await bearerCtx(req, ["pat", "oauth"])).toBeNull();
  },
);

it("a missing Idempotency-Key on a key op is validation", async () => {
  const req = request("/api/v1/songs", newPat().token);
  req.headers.delete("Idempotency-Key");
  const response = await runTokenOp(def, req, {});
  expect(response.status).toBe(422);
  expect(await response.json()).toMatchObject({
    error: { code: "validation" },
  });
  expect(mocks.callOps).not.toHaveBeenCalled();
});

it("the 11th write in a minute is rate_limited with retry_after", async () => {
  const req = request("/api/v1/songs", newPat().token);
  for (let i = 0; i < 10; i++)
    expect((await runTokenOp(def, req, {})).status).toBe(200);
  vi.advanceTimersByTime(1000);
  const response = await runTokenOp(def, req, {});
  expect(response.status).toBe(429);
  expect(await response.json()).toMatchObject({
    error: { code: "rate_limited", retry_after: 59 },
  });
  expect(response.headers.get("Retry-After")).toBe("59");
  vi.advanceTimersByTime(59_000);
  expect((await runTokenOp(def, req, {})).status).toBe(200);
});

it("read polling has its own 60-per-minute window", async () => {
  const req = request("/api/v1/jobs/one", newPat().token);
  const read = { ...def, key: false, mutating: false, scope: "read" as const };
  for (let i = 0; i < 60; i++)
    expect((await runTokenOp(read, req, {})).status).toBe(200);
  expect((await runTokenOp(read, req, {})).status).toBe(429);
  expect((await runTokenOp(def, req, {})).status).toBe(200);
});

it("MCP callbacks share the token runner and reject session contexts", async () => {
  const req = request("/api/mcp", newPat().token);
  const ctx = await bearerCtx(req, ["pat", "oauth"]);
  if (!ctx) throw new Error("Expected bearer context");
  expect(
    await runTokenOperation(
      def,
      { ...ctx, idempotency_key: "mcp-key-123" },
      {},
    ),
  ).toEqual({ ok: true, data: { status: "done" } });
  expect(
    await runTokenOperation(
      def,
      { actor_kind: "session", remote: false, request_id: "one" },
      {},
    ),
  ).toMatchObject({ ok: false, code: "unauthorized" });
});

it("MCP unauthorized responses advertise the canonical resource metadata", async () => {
  const response = await runTokenOp(def, request("/api/mcp"), {});
  expect(response.status).toBe(401);
  expect(response.headers.get("WWW-Authenticate")).toBe(
    'Bearer resource_metadata="http://127.0.0.1:3212/.well-known/oauth-protected-resource/api/mcp"',
  );
});

it("production OAuth uses the public production resource", async () => {
  vi.stubEnv("SITE_URL", "https://app.mellodifai.com");
  const ctx = await bearerCtx(request("/api/mcp", "opaque"), ["oauth"]);
  expect(ctx?.resource).toBe("https://app.mellodifai.com/api/mcp");
});

it("an unconfigured OAuth origin returns an internal envelope without leaking config", async () => {
  vi.stubEnv("SITE_URL", "");
  const response = await runTokenOp(def, request("/api/mcp"), {});
  expect(response.status).toBe(500);
  expect(await response.json()).toEqual({
    error: { code: "internal", message: "Internal error" },
  });
});

it.each(["short", "a".repeat(101)])(
  "rejects invalid idempotency key length",
  async (key) => {
    const req = request("/api/v1/songs", newPat().token);
    req.headers.set("Idempotency-Key", key);
    expect((await runTokenOp(def, req, {})).status).toBe(422);
    expect(mocks.callOps).not.toHaveBeenCalled();
  },
);

it("reserving operations have a 20-per-hour window", async () => {
  const req = request("/api/v1/songs", newPat().token);
  const paid = { ...def, scope: "spend" as const, reservesPaidWork: true };
  for (let i = 0; i < 20; i++) {
    if (i === 10) vi.advanceTimersByTime(60_000);
    expect((await runTokenOp(paid, req, {})).status).toBe(200);
  }
  vi.advanceTimersByTime(60_000);
  const response = await runTokenOp(paid, req, {});
  expect(response.status).toBe(429);
  expect(await response.json()).toMatchObject({ error: { retry_after: 3480 } });
});
