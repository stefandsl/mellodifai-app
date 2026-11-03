// @vitest-environment node
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
const ID = "00000000-0000-4000-8000-000000000001";
const OTHER = "00000000-0000-4000-8000-000000000002";
const DATA: Record<string, unknown> = {
  song_create: { jobs: [], project_id: ID },
  admin_project_create: { jobs: [], project_id: ID },
  song_import: { jobs: [], project_id: ID },
  playlist_create: { jobs: [], playlist_id: ID },
  songs_trash: { jobs: [], count: 2 },
  songs_restore: { jobs: [], count: 2 },
  playlist_add: { jobs: [], count: 2 },
  playlist_remove: { jobs: [], count: 2 },
  section_edit_request: { jobs: [], edit_id: ID },
  section_edit_keep: { jobs: [], take_id: ID },
  take_save_edit: { jobs: [], take_id: ID },
  lyrics_back: { jobs: [], version_id: ID, status: "draft" },
  video_approve: { jobs: [], version_id: ID, status: "ready" },
  admin_confirm_publication: { jobs: [], job_id: ID },
};
beforeEach(() => {
  vi.clearAllMocks();
  mocks.headers.mockResolvedValue(new Headers());
  mocks.callOps.mockImplementation(async (fn: string) =>
    fn === "idem_begin"
      ? { ok: true, data: { status: "new" } }
      : { ok: true, data: DATA[fn] ?? { jobs: [] } },
  );
});
function called(fn: string, ...args: unknown[]) {
  expect(mocks.callOps).toHaveBeenCalledWith(fn, [
    expect.objectContaining({
      actor_kind: "session",
      user_id: "owner",
      session_id: "session",
    }),
    ...args,
  ]);
}

import { requestStems, saveEditedTake } from "./audio-tools";

it("requests stems through the wrapper", async () => {
  expect(await requestStems({ versionId: ID })).toEqual({ ok: true });
  called("stems_request", ID);
});
it("saves an edited take through the wrapper and checks the path", async () => {
  const path = `edits/${ID}/${OTHER}/${ID}.mp3`;
  expect(await saveEditedTake({ versionId: ID, path })).toEqual({
    ok: true,
    id: ID,
  });
  called("take_save_edit", ID, path);
  mocks.callOps.mockClear();
  expect(
    await saveEditedTake({ versionId: ID, path: "../bad.mp3" }),
  ).toMatchObject({ ok: false, code: "validation" });
  expect(mocks.callOps).not.toHaveBeenCalled();
});
