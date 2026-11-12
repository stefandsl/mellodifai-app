// @vitest-environment node
import { beforeEach, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  ops: vi.fn(),
  headers: vi.fn(async () => new Headers()),
}));
vi.mock("next/headers", () => ({ headers: mocks.headers }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/ops/context", () => ({
  sessionCtx: async () => ({ actor_kind: "session", user_id: "owner" }),
}));
vi.mock("@/lib/db/ops-client", () => ({ callOps: mocks.ops }));

import { cancelLyricsAssist, requestLyricsAssist } from "./lyrics-assist";

const ID = "11111111-1111-4111-8111-111111111111";
beforeEach(() => {
  vi.clearAllMocks();
  mocks.ops.mockImplementation(async (name: string) => ({
    ok: true,
    data: name === "idem_begin" ? { status: "new" } : { id: ID },
  }));
});

it("requests and cancels through ops with verified context", async () => {
  expect(
    await requestLyricsAssist({ mode: "write", lang: "it", title: "Test" }),
  ).toEqual({ ok: true, id: ID });
  expect(mocks.ops).toHaveBeenCalledWith("lyrics_assist_request", [
    expect.objectContaining({
      actor_kind: "session",
      idempotency_key: expect.any(String),
    }),
    "write",
    "it",
    expect.objectContaining({ title: "Test" }),
  ]);
  expect(await cancelLyricsAssist(ID)).toEqual({ ok: true });
  expect(mocks.ops).toHaveBeenCalledWith("lyrics_assist_cancel", [
    expect.any(Object),
    ID,
  ]);
});

it("refuses remote and invalid requests before any database call", async () => {
  mocks.headers.mockResolvedValueOnce(new Headers({ "x-mdf-remote": "1" }));
  expect(
    await requestLyricsAssist({ mode: "write", lang: "it", title: "Test" }),
  ).toEqual({ ok: false, error: "failed" });
  expect(await requestLyricsAssist({})).toEqual({
    ok: false,
    error: "invalid",
  });
  expect(await cancelLyricsAssist("bad")).toEqual({ ok: false });
  expect(mocks.ops).not.toHaveBeenCalled();
});

it("preserves actionable refusal codes and the uncertain paid request key", async () => {
  mocks.ops.mockImplementation(async (name: string) =>
    name === "idem_begin"
      ? { ok: true, data: { status: "new" } }
      : {
          ok: false,
          code: "rate_limited",
          message: "Daily limit",
          details: { action_error: "limit" },
        },
  );
  expect(
    await requestLyricsAssist({ mode: "write", lang: "it", title: "Test" }),
  ).toMatchObject({
    ok: false,
    error: "limit",
    idempotencyKey: expect.any(String),
  });
  mocks.ops.mockImplementation(async (name: string) => {
    if (name === "idem_begin") return { ok: true, data: { status: "new" } };
    throw new Error("connection lost");
  });
  expect(
    await requestLyricsAssist({ mode: "write", lang: "it", title: "Test" }),
  ).toMatchObject({
    ok: false,
    error: "failed",
    idempotencyKey: expect.any(String),
  });
});
