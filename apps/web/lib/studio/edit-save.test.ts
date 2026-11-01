import { beforeEach, describe, expect, it, vi } from "vitest";

import { saveEdit } from "./edit-save";

const mock = vi.hoisted(() => ({
  saveEditedTake: vi.fn(async (_input: unknown) => ({ ok: true as boolean })),
}));
vi.mock("@/app/actions/audio-tools", () => ({
  saveEditedTake: mock.saveEditedTake,
}));

const OWNER = "5a184949-56e4-421e-80b5-ecff0cba2c60";
const SONG = "e645d82e-ca43-4e86-98ae-8b4e9634ce59";

function client({
  user = OWNER as string | null,
  uploadError = null as unknown,
} = {}) {
  const upload = vi.fn(
    async (_path: string, _file: Blob, _options: unknown) => ({
      error: uploadError,
    }),
  );
  const remove = vi.fn(async (_paths: string[]) => ({ error: null }));
  return {
    upload,
    remove,
    supabase: {
      auth: {
        getUser: async () => ({ data: { user: user ? { id: user } : null } }),
      },
      storage: { from: () => ({ upload, remove }) },
    },
  };
}

beforeEach(() => vi.clearAllMocks());

describe("saveEdit", () => {
  it("uploads the MP3 to the owner's edits folder, then records it as the chosen take", async () => {
    const { supabase, upload, remove } = client();
    const steps: string[] = [];
    const file = new Blob(["mp3"], { type: "audio/mpeg" });
    const result = await saveEdit(supabase as never, SONG, file, (step) =>
      steps.push(step),
    );
    expect(result).toEqual({ ok: true });
    const [path, sent, options] = upload.mock.calls[0] ?? [];
    expect(path).toMatch(
      new RegExp(`^edits/${OWNER}/${SONG}/[0-9a-f-]{36}\\.mp3$`, "u"),
    );
    expect(sent).toBe(file);
    expect(options).toEqual({ contentType: "audio/mpeg", upsert: false });
    expect(mock.saveEditedTake).toHaveBeenCalledWith({ versionId: SONG, path });
    expect(steps).toEqual(["uploading", "saving"]);
    expect(remove).not.toHaveBeenCalled();
  });

  it("removes the upload again when the song refuses it", async () => {
    mock.saveEditedTake.mockResolvedValueOnce({ ok: false });
    const { supabase, upload, remove } = client();
    expect(await saveEdit(supabase as never, SONG, new Blob())).toEqual({
      ok: false,
    });
    expect(remove).toHaveBeenCalledWith([upload.mock.calls[0]?.[0]]);
  });

  it("stops before recording when the upload fails or nobody is signed in", async () => {
    const failed = client({ uploadError: { message: "too big" } });
    expect(await saveEdit(failed.supabase as never, SONG, new Blob())).toEqual({
      ok: false,
    });
    const anonymous = client({ user: null });
    expect(
      await saveEdit(anonymous.supabase as never, SONG, new Blob()),
    ).toEqual({ ok: false });
    expect(anonymous.upload).not.toHaveBeenCalled();
    expect(mock.saveEditedTake).not.toHaveBeenCalled();
  });
});
