// @vitest-environment node
import { defaultVisualizerParams } from "@mellodifai/shared";
import { beforeEach, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  callOps: vi.fn(),
  headers: vi.fn(async () => new Headers()),
}));
vi.mock("next/headers", () => ({ headers: mocks.headers }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/locale", () => ({ getLocale: async () => "it" }));
vi.mock("@/lib/supabase/server", () => ({
  getSessionClaims: async () => ({ sub: "owner", session_id: "session" }),
}));
vi.mock("@/lib/db/ops-client", () => ({ callOps: mocks.callOps }));

import { keepAudioWithVisualizer, requestVisualizer } from "./visualizer";

const ID = "00000000-0000-4000-8000-000000000001";
const JOB = "00000000-0000-4000-8000-000000000002";
const params = defaultVisualizerParams();

beforeEach(() => {
  vi.clearAllMocks();
  mocks.headers.mockResolvedValue(new Headers());
  mocks.callOps.mockImplementation(async (fn: string) =>
    fn === "idem_begin"
      ? { ok: true, data: { status: "new" } }
      : fn === "audio_keep"
        ? { ok: true, data: { jobs: [], version_id: ID } }
        : {
            ok: true,
            data: {
              jobs: [{ job_id: JOB, version_id: ID, stage: "visualizer" }],
            },
          },
  );
});

it("requests a visualizer through its wrapper", async () => {
  expect(await requestVisualizer({ versionId: ID, params })).toEqual({
    ok: true,
    id: JOB,
  });
  expect(mocks.callOps).toHaveBeenCalledWith("visualizer_request", [
    expect.any(Object),
    ID,
    params,
  ]);
});

it("keeps audio before the visualizer request and validates the whole input first", async () => {
  expect(
    await keepAudioWithVisualizer({ versionId: ID, takeId: ID, params }),
  ).toEqual({ ok: true, id: JOB });
  expect(
    mocks.callOps.mock.calls
      .filter(([fn]) => fn !== "idem_begin")
      .map(([fn]) => fn),
  ).toEqual(["audio_keep", "visualizer_request"]);
  mocks.callOps.mockClear();
  expect(
    await keepAudioWithVisualizer({ versionId: ID, takeId: ID, params: {} }),
  ).toMatchObject({ ok: false, code: "validation" });
  expect(mocks.callOps).not.toHaveBeenCalled();
});
