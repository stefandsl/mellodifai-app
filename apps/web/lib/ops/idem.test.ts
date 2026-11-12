// @vitest-environment node
import { beforeEach, expect, it, vi } from "vitest";
import { z } from "zod";
import { runTokenOp } from "./bearer";
import { requestHash } from "./run";
import { newPat } from "./tokens";

const mocks = vi.hoisted(() => ({ callOps: vi.fn() }));
vi.mock("@/lib/db/ops-client", () => ({ callOps: mocks.callOps }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
const def = {
  name: "song_create",
  fn: "song_create",
  scope: "spend" as const,
  input: z.object({ title: z.string().trim() }),
  args: (v: { title: string }) => [v],
  output: z.object({ jobs: z.array(z.string()) }),
  key: true,
  mutating: true,
  reservesPaidWork: true,
  revalidate: () => [],
};
function request() {
  return new Request("http://127.0.0.1:3219/api/v1/songs", {
    method: "POST",
    headers: {
      authorization: `Bearer ${newPat().token}`,
      "Idempotency-Key": "parallel-key",
    },
  });
}
beforeEach(() => vi.resetAllMocks());

it("parallel same-key POSTs create one job", async () => {
  let opened = false;
  let jobs = 0;
  let release!: () => void;
  const work = new Promise<void>((resolve) => {
    release = resolve;
  });
  let started!: () => void;
  const dispatched = new Promise<void>((resolve) => {
    started = resolve;
  });
  mocks.callOps.mockImplementation(async (name) => {
    if (name === "idem_begin") {
      if (opened)
        return {
          ok: false,
          code: "in_progress",
          message: "Request in progress",
          retry_after: 2,
        };
      opened = true;
      return { ok: true, data: { status: "new" } };
    }
    jobs++;
    started();
    await work;
    return { ok: true, data: { jobs: ["one"] } };
  });
  const req = request();
  const first = runTokenOp(def, req, { title: " Song " });
  try {
    await dispatched;
    const second = await runTokenOp(def, req, { title: " Song " });
    expect(second.status).toBe(409);
    expect(await second.json()).toMatchObject({
      error: { code: "in_progress", retry_after: 2 },
    });
    expect(jobs).toBe(1);
  } finally {
    release();
  }
  expect(await (await first).json()).toEqual({ data: { jobs: ["one"] } });
  const beginCtx = mocks.callOps.mock.calls[0][1][0];
  expect(beginCtx.request_hash).toBe(requestHash(def.name, { title: "Song" }));
  expect(mocks.callOps).toHaveBeenCalledWith("song_create", [
    beginCtx,
    { title: "Song" },
  ]);
});

it("replay returns the stored response", async () => {
  mocks.callOps.mockResolvedValue({
    ok: true,
    data: {
      status: "replay",
      response: { ok: true, data: { jobs: ["stored"] } },
    },
  });
  expect(
    await (await runTokenOp(def, request(), { title: "Song" })).json(),
  ).toEqual({ data: { jobs: ["stored"] } });
  expect(mocks.callOps).toHaveBeenCalledTimes(1);
});

it("different input for the same key preserves idempotency_mismatch", async () => {
  mocks.callOps.mockResolvedValue({
    ok: false,
    code: "idempotency_mismatch",
    message: "Different request",
  });
  const response = await runTokenOp(def, request(), { title: "Other" });
  expect(response.status).toBe(409);
  expect(await response.json()).toEqual({
    error: { code: "idempotency_mismatch", message: "Different request" },
  });
  expect(mocks.callOps).toHaveBeenCalledTimes(1);
});

it("invalid input never opens a key", async () => {
  expect((await runTokenOp(def, request(), {})).status).toBe(422);
  expect(mocks.callOps).not.toHaveBeenCalled();
});
