// @vitest-environment node
import { OPS_ERROR_CODES, t } from "@mellodifai/shared";
import { beforeEach, expect, it, vi } from "vitest";
import { z } from "zod";

const mocks = vi.hoisted(() => ({
  headers: vi.fn(async () => new Headers()),
  claims: vi.fn(async () => ({
    data: { claims: { sub: "user", session_id: "session" } },
    error: null,
  })),
  callOps: vi.fn(),
  revalidatePath: vi.fn(),
}));
vi.mock("next/headers", () => ({ headers: mocks.headers }));
vi.mock("next/cache", () => ({ revalidatePath: mocks.revalidatePath }));
vi.mock("@/lib/supabase/server", () => ({
  getSessionClaims: async () => {
    const { data } = await mocks.claims();
    return data.claims;
  },
}));
vi.mock("@/lib/db/ops-client", () => ({ callOps: mocks.callOps }));
vi.mock("@/lib/locale", () => ({ getLocale: async () => "it" }));

const def = {
  name: "example",
  fn: "example",
  input: z.object({ value: z.string() }),
  args: (input: { value: string }) => [input.value],
  output: z.object({ id: z.string() }),
  scope: "create" as const,
  key: false,
  mutating: true,
  revalidate: (data: { id: string }) => [`/projects/${data.id}`],
};

beforeEach(() => {
  vi.clearAllMocks();
  mocks.revalidatePath.mockReset();
  mocks.headers.mockResolvedValue(new Headers());
  mocks.callOps.mockResolvedValue({ ok: true, data: { id: "project" } });
});

it.each(["jsonb", "positional"])(
  "maps %s RPC arguments explicitly and hashes validated input",
  async (kind) => {
    const { runOp, requestHash } = await import("./run");
    const input = { title: "Song", settings: { engine: "kie" } };
    const ctx = {
      actor_kind: "session" as const,
      remote: false,
      request_id: "request",
    };
    const args =
      kind === "jsonb"
        ? (value: typeof input) => [value]
        : (value: typeof input) => [value.settings, value.title];
    const operation = {
      ...def,
      name: "song_create",
      fn: "song_create",
      input: z.object({
        title: z.string(),
        settings: z.object({ engine: z.string() }),
      }),
      args,
    };
    expect(
      await runOp(operation, ctx, { ...input, ignored: true }),
    ).toMatchObject({ ok: true });
    expect(mocks.callOps).toHaveBeenCalledWith("song_create", [
      { ...ctx, request_hash: requestHash("song_create", input) },
      ...args(input),
    ]);
  },
);

it.each(["paths", "cache"])(
  "preserves committed success when %s revalidation throws",
  async (kind) => {
    const { runOp } = await import("./run");
    const failure = () => {
      throw new Error("private cache detail");
    };
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    if (kind === "cache") mocks.revalidatePath.mockImplementation(failure);
    try {
      expect(
        await runOp(
          { ...def, revalidate: kind === "paths" ? failure : def.revalidate },
          { actor_kind: "session", remote: false, request_id: "request" },
          { value: "ok" },
        ),
      ).toEqual({ ok: true, data: { id: "project" } });
      expect(mocks.callOps).toHaveBeenCalledOnce();
      expect(JSON.stringify(log.mock.calls)).not.toContain(
        "private cache detail",
      );
    } finally {
      log.mockRestore();
    }
  },
);

it("runAction refuses remote requests with forbidden_scope before database work", async () => {
  mocks.headers.mockResolvedValue(new Headers({ "x-mdf-remote": "1" }));
  const { runAction } = await import("@/lib/run-action");
  expect(await runAction(def, { value: "test" })).toEqual({
    ok: false,
    code: "forbidden_scope",
    error: t("it", "error.forbidden_scope"),
  });
  expect(mocks.callOps).not.toHaveBeenCalled();
});

it("the temporary runAction(work) overload also refuses remote requests", async () => {
  mocks.headers.mockResolvedValue(new Headers({ "x-mdf-remote": "1" }));
  const work = vi.fn(async () => ({}));
  const { runAction } = await import("@/lib/run-action");
  expect(await runAction(work)).toMatchObject({
    ok: false,
    code: "forbidden_scope",
  });
  expect(work).not.toHaveBeenCalled();
});

it("requestHash ignores object key order", async () => {
  const { requestHash } = await import("./run");
  expect(requestHash("example", { b: 2, a: { y: 2, x: 1 } })).toBe(
    requestHash("example", { a: { x: 1, y: 2 }, b: 2 }),
  );
});

it("sessionCtx takes identity from claims and remote status from headers", async () => {
  mocks.headers.mockResolvedValue(new Headers({ "cf-ray": "edge" }));
  const { sessionCtx } = await import("./context");
  expect(await sessionCtx()).toMatchObject({
    actor_kind: "session",
    user_id: "user",
    session_id: "session",
    remote: true,
    request_id: expect.any(String),
  });
  expect(mocks.claims).toHaveBeenCalledOnce();
});

it("error codes map to their error.<code> messages", async () => {
  const { runAction } = await import("@/lib/run-action");
  for (const code of OPS_ERROR_CODES) {
    mocks.callOps.mockResolvedValueOnce({
      ok: false,
      code,
      message: "private database detail",
    });
    expect(await runAction(def, { value: "test" })).toEqual({
      ok: false,
      code,
      error: t("it", `error.${code}`),
    });
  }
});

it("runAction returns the project id from an ops result", async () => {
  mocks.callOps.mockResolvedValueOnce({
    ok: true,
    data: { project_id: "project" },
  });
  const { runAction } = await import("@/lib/run-action");
  expect(
    await runAction(
      {
        ...def,
        output: z.object({ project_id: z.string() }),
        revalidate: (_data: { project_id: string }) => [],
      },
      { value: "test" },
    ),
  ).toEqual({ ok: true, id: "project" });
});

it("runOp validates both boundaries and revalidates successful mutations", async () => {
  const { runOp } = await import("./run");
  const ctx = {
    actor_kind: "session" as const,
    user_id: "user",
    session_id: "session",
    remote: false,
    request_id: "request",
  };
  expect(await runOp(def, ctx, { value: 1 })).toMatchObject({
    ok: false,
    code: "validation",
  });
  expect(mocks.callOps).not.toHaveBeenCalled();
  expect(await runOp(def, ctx, { value: "ok" })).toEqual({
    ok: true,
    data: { id: "project" },
  });
  expect(mocks.revalidatePath).toHaveBeenCalledWith("/projects/project");
  expect(mocks.revalidatePath).toHaveBeenCalledWith("/library");
  expect(mocks.revalidatePath).toHaveBeenCalledWith("/editor/[id]", "page");
});

const keyedCtx = {
  actor_kind: "pat" as const,
  remote: true,
  request_id: "request",
  idempotency_key: "test-key-123",
};

it("waits for committed key opening before calling the mutation", async () => {
  const { runOp } = await import("./run");
  let finish!: (value: unknown) => void;
  mocks.callOps.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  const pending = runOp({ ...def, key: true }, keyedCtx, { value: "ok" });
  expect(mocks.callOps).toHaveBeenCalledOnce();
  expect(mocks.callOps.mock.calls[0][0]).toBe("idem_begin");
  finish({ ok: true, data: { status: "new" } });
  expect(await pending).toMatchObject({ ok: true });
  expect(mocks.callOps).toHaveBeenCalledTimes(2);
});

it.each([{ status: "unknown" }, { status: "replay", response: null }])(
  "refuses malformed begin responses without executing: %j",
  async (data) => {
    const { runOp } = await import("./run");
    mocks.callOps.mockResolvedValueOnce({ ok: true, data });
    expect(
      await runOp({ ...def, key: true }, keyedCtx, { value: "ok" }),
    ).toMatchObject({ ok: false, code: "internal" });
    expect(mocks.callOps).toHaveBeenCalledOnce();
  },
);

it("opens a key before running the mutation with the same validated hash", async () => {
  const { runOp, requestHash } = await import("./run");
  mocks.callOps.mockResolvedValueOnce({ ok: true, data: { status: "new" } });
  expect(
    await runOp({ ...def, key: true }, keyedCtx, {
      value: "ok",
      ignored: true,
    }),
  ).toEqual({ ok: true, data: { id: "project" } });
  const ctx = {
    ...keyedCtx,
    request_hash: requestHash(def.name, { value: "ok" }),
  };
  expect(mocks.callOps.mock.calls).toEqual([
    ["idem_begin", [ctx, keyedCtx.idempotency_key, ctx.request_hash]],
    [def.fn, [ctx, "ok"]],
  ]);
});

it("replays the stored response without rerunning the mutation", async () => {
  const { runOp } = await import("./run");
  mocks.callOps.mockResolvedValueOnce({
    ok: true,
    data: { status: "replay", response: { ok: true, data: { id: "stored" } } },
  });
  expect(await runOp({ ...def, key: true }, keyedCtx, { value: "ok" })).toEqual(
    { ok: true, data: { id: "stored" } },
  );
  expect(mocks.callOps).toHaveBeenCalledOnce();
});

it.each(["in_progress", "idempotency_mismatch", "unauthorized", "internal"])(
  "returns %s from idem_begin without running the operation",
  async (code) => {
    const { runOp } = await import("./run");
    const error = {
      ok: false,
      code,
      message: "Refused",
      ...(code === "in_progress" ? { retry_after: 2 } : {}),
    };
    mocks.callOps.mockResolvedValueOnce(error);
    expect(
      await runOp({ ...def, key: true }, keyedCtx, { value: "ok" }),
    ).toEqual({ ...error, idempotency_key: keyedCtx.idempotency_key });
    expect(mocks.callOps).toHaveBeenCalledOnce();
  },
);

it.each([undefined, "short", "x".repeat(101)])(
  "refuses an invalid token key before RPCs: %s",
  async (key) => {
    const { runOp } = await import("./run");
    expect(
      await runOp(
        { ...def, key: true },
        { ...keyedCtx, idempotency_key: key },
        { value: "ok" },
      ),
    ).toMatchObject({ ok: false, code: "validation" });
    expect(mocks.callOps).not.toHaveBeenCalled();
  },
);

it("assigns a key to a session mutation that has none", async () => {
  const { runOp } = await import("./run");
  mocks.callOps.mockResolvedValueOnce({ ok: true, data: { status: "new" } });
  await runOp(
    { ...def, key: true },
    { actor_kind: "session", remote: false, request_id: "request" },
    { value: "ok" },
  );
  expect(mocks.callOps.mock.calls[0][0]).toBe("idem_begin");
  expect(mocks.callOps.mock.calls[0][1][1]).toMatch(/^[0-9a-f-]{36}$/);
});

it.each([false, true])(
  "preserves committed success when output validation throws=%s",
  async (throws) => {
    const { runOp } = await import("./run");
    const result = { ok: true, data: { unexpected: "private detail" } };
    mocks.callOps.mockResolvedValueOnce(result);
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    const output = throws
      ? z.any().transform(() => {
          throw new Error("private detail");
        })
      : def.output;
    try {
      expect(
        await runOp({ ...def, output }, keyedCtx, { value: "ok" }),
      ).toEqual({ ok: true, committed: true });
      expect(log).toHaveBeenCalled();
      expect(JSON.stringify(log.mock.calls)).not.toContain("private detail");
      expect(mocks.revalidatePath).not.toHaveBeenCalled();
    } finally {
      log.mockRestore();
    }
  },
);

it("still rejects invalid read output", async () => {
  const { runOp } = await import("./run");
  mocks.callOps.mockResolvedValueOnce({ ok: true, data: {} });
  expect(
    await runOp({ ...def, mutating: false }, keyedCtx, { value: "ok" }),
  ).toMatchObject({ ok: false, code: "internal" });
});

it("returns only a committed marker for invalid mutation output through actions", async () => {
  const { remoteAction } = await import("@/lib/run-action");
  mocks.callOps.mockResolvedValueOnce({
    ok: true,
    data: { secret: "private" },
  });
  expect(await remoteAction(def, { value: "ok" })).toEqual({
    ok: true,
    committed: true,
  });
});

it("retains the generated key on uncertain spend and reuses it for replay", async () => {
  const { remoteAction } = await import("@/lib/run-action");
  const operation = { ...def, key: true, scope: "spend" as const };
  mocks.callOps.mockResolvedValueOnce({ ok: true, data: { status: "new" } });
  mocks.callOps.mockResolvedValueOnce({
    ok: false,
    code: "internal",
    message: "Internal error",
    details: { reason: "completion_unknown" },
  });
  const result = await remoteAction(operation, { value: "ok" });
  expect(result).toMatchObject({
    ok: false,
    code: "ambiguous_spend",
    idempotencyKey: expect.any(String),
  });
  if (result.ok || !result.idempotencyKey)
    throw new Error("Missing recovery key");
  const key = result.idempotencyKey;
  expect(mocks.callOps.mock.calls[1][1][0].idempotency_key).toBe(key);
  mocks.callOps.mockResolvedValueOnce({
    ok: true,
    data: {
      status: "replay",
      response: { ok: true, data: { id: "original" } },
    },
  });
  expect(
    await remoteAction(operation, { value: "ok" }, { idempotencyKey: key }),
  ).toEqual({ ok: true, id: "original" });
  expect(mocks.callOps).toHaveBeenCalledTimes(3);
  expect(mocks.callOps.mock.calls[2][1][1]).toBe(key);
});

it("does not label a definite database rejection as ambiguous spend", async () => {
  const { runOp } = await import("./run");
  mocks.callOps.mockResolvedValueOnce({ ok: true, data: { status: "new" } });
  mocks.callOps.mockResolvedValueOnce({
    ok: false,
    code: "cap_exceeded",
    message: "Limit",
  });
  expect(
    await runOp({ ...def, key: true, scope: "spend" }, keyedCtx, {
      value: "ok",
    }),
  ).toMatchObject({ ok: false, code: "cap_exceeded" });
});

it("retains the supplied key when a dispatched spend throws", async () => {
  const { runOp } = await import("./run");
  mocks.callOps.mockResolvedValueOnce({ ok: true, data: { status: "new" } });
  mocks.callOps.mockRejectedValueOnce(new Error("private transport details"));
  expect(
    await runOp({ ...def, key: true, scope: "spend" }, keyedCtx, {
      value: "ok",
    }),
  ).toEqual({
    ok: false,
    code: "ambiguous_spend",
    message:
      "Completion unknown. Do not automatically retry. Retain the original idempotency key.",
    idempotency_key: keyedCtx.idempotency_key,
  });
});

it("keeps the recovery key on in-progress action responses", async () => {
  const { runAction } = await import("@/lib/run-action");
  mocks.callOps.mockResolvedValueOnce({
    ok: false,
    code: "in_progress",
    message: "Wait",
    retry_after: 2,
  });
  expect(
    await runAction(
      { ...def, key: true, scope: "spend" },
      { value: "ok" },
      { idempotencyKey: keyedCtx.idempotency_key },
    ),
  ).toMatchObject({
    ok: false,
    code: "in_progress",
    idempotencyKey: keyedCtx.idempotency_key,
  });
  expect(mocks.callOps).toHaveBeenCalledOnce();
  expect(mocks.callOps.mock.calls[0][1][1]).toBe(keyedCtx.idempotency_key);
});

it("does not report ambiguous spend when key opening fails before dispatch", async () => {
  const { runOp } = await import("./run");
  mocks.callOps.mockResolvedValueOnce({
    ok: false,
    code: "internal",
    message: "Internal error",
    details: { reason: "completion_unknown" },
  });
  expect(
    await runOp({ ...def, key: true, scope: "spend" }, keyedCtx, {
      value: "ok",
    }),
  ).toMatchObject({
    ok: false,
    code: "internal",
    idempotency_key: keyedCtx.idempotency_key,
  });
  expect(mocks.callOps).toHaveBeenCalledOnce();
});
