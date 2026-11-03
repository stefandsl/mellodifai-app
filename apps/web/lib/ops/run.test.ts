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
  output: z.object({ id: z.string() }),
  scope: "create" as const,
  key: false,
  mutating: true,
  revalidate: (data: { id: string }) => [`/projects/${data.id}`],
};

beforeEach(() => {
  vi.clearAllMocks();
  mocks.headers.mockResolvedValue(new Headers());
  mocks.callOps.mockResolvedValue({ ok: true, data: { id: "project" } });
});

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
  mocks.callOps.mockResolvedValueOnce({ ok: true, data: { wrong: true } });
  expect(await runOp(def, ctx, { value: "ok" })).toMatchObject({
    ok: false,
    code: "internal",
  });
});
