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

import { createSong } from "./create-song";

const input = {
  mode: "simple",
  prompt: "Canzone",
  lyrics: "",
  styles: "",
  languages: ["it"],
  count: 3,
  vocalGender: "f",
  settings: { engine: "kie" },
};
it("creates the whole batch through one capped wrapper and returns the count", async () => {
  expect(await createSong(input)).toEqual({ ok: true, id: ID, count: 3 });
  called(
    "song_create",
    expect.objectContaining({ count: 3, prompt: "Canzone" }),
  );
  expect(
    mocks.callOps.mock.calls.filter(([fn]) => fn === "song_create"),
  ).toHaveLength(1);
});
it("rejects invalid counts before dispatch", async () => {
  expect(await createSong({ ...input, count: 5 })).toMatchObject({
    ok: false,
    code: "validation",
  });
  expect(mocks.callOps).not.toHaveBeenCalled();
});
