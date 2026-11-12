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
  audio_keep: { jobs: [], version_id: ID },
  take_choose: { jobs: [], version_id: ID },
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
  lyrics_back: { version_id: ID, status: "draft" },
  video_approve: { version_id: ID, status: "ready" },
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

import {
  approveVideo,
  backToLyrics,
  generateAgain,
  keepAudio,
  pickTake,
  resolveKieSubmission,
  resolveUpload,
  setPrivacy,
  uploadPrivate,
} from "./checkpoints";
import { createProject } from "./project";
import { chooseTake } from "./songs-from-songs";

it("routes all similarly named take actions to the correct wrappers", async () => {
  expect(await pickTake({ versionId: ID, takeId: OTHER })).toEqual({
    ok: true,
  });
  called("take_pick", ID, OTHER);
  expect(await keepAudio({ versionId: ID, takeId: OTHER })).toEqual({
    ok: true,
  });
  called("audio_keep", ID, OTHER);
  expect(await chooseTake({ versionId: ID, takeId: OTHER })).toEqual({
    ok: true,
  });
  called("take_choose", ID, OTHER);
});

it("accepts the version and status response of non-enqueueing wrappers", async () => {
  expect(await approveVideo({ versionId: ID })).toEqual({ ok: true });
  called("video_approve", ID);
  expect(await backToLyrics({ versionId: ID })).toEqual({ ok: true });
  called("lyrics_back", ID);
});
it("routes admin work to admin wrappers", async () => {
  await resolveKieSubmission({
    versionId: ID,
    charged: true,
    taskId: "task-1",
  });
  called("admin_resolve_kie_submission", ID, true, "task-1", null);
  await resolveUpload({ publicationId: ID, uploaded: true, videoId: "abc" });
  called("admin_resolve_upload", ID, true, "abc");
  await approveVideo({ versionId: ID, overrideReason: "Reviewed" });
  called("admin_video_approve_override", ID, "Reviewed");
  await setPrivacy({ publicationId: ID, privacy: "public" });
  called("admin_confirm_publication", ID, "public", null);
  await uploadPrivate({
    renderId: ID,
    metadata: { title: "Title", description: "", tags: "", chapters: "" },
  });
  expect(
    mocks.callOps.mock.calls.some(([fn]) => fn === "admin_enqueue_publish"),
  ).toBe(true);
  expect(
    await createProject({
      topic: "Song",
      style: "Pop",
      vocalGender: "f",
      languages: ["en", "en"],
    }),
  ).toEqual({ ok: true, id: ID });
  called("admin_project_create", "Song", "", ["en"], "Pop", "", "f");
});
it("keeps validation and coded error shapes", async () => {
  expect(await generateAgain({ versionId: ID, generation: 0 })).toMatchObject({
    ok: false,
    code: "validation",
  });
  expect(mocks.callOps).not.toHaveBeenCalled();
  mocks.callOps.mockImplementation(async (fn: string) =>
    fn === "idem_begin"
      ? { ok: true, data: { status: "new" } }
      : { ok: false, code: "conflict", message: "private detail" },
  );
  expect(await pickTake({ versionId: ID, takeId: OTHER })).toMatchObject({
    ok: false,
    code: "conflict",
  });
});
