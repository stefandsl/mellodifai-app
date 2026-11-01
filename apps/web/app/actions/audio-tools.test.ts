import { beforeEach, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  rpc: vi.fn(async (_name: string, _args: unknown) => ({
    data: "result-id" as unknown,
    error: null as unknown,
  })),
}));
vi.mock("@/lib/auth", () => ({
  actionProfile: async () => ({
    supabase: {
      rpc: mocks.rpc,
      from: () => ({
        select: () => ({
          eq: () => ({
            single: async () => ({ data: { project_id: "p1" }, error: null }),
          }),
        }),
      }),
    },
  }),
}));
vi.mock("@/lib/locale", () => ({ getLocale: async () => "it" }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

import { revalidatePath } from "next/cache";
import { requestStems, saveEditedTake } from "./audio-tools";

const SONG = "e645d82e-ca43-4e86-98ae-8b4e9634ce59";
const OWNER = "5a184949-56e4-421e-80b5-ecff0cba2c60";
const FILE = "0d4ba501-5609-446d-b2cc-f42cd0199ec1";

beforeEach(() => vi.clearAllMocks());

it("asks for the stems of a song and returns the job", async () => {
  expect(await requestStems({ versionId: SONG })).toEqual({
    ok: true,
    id: "result-id",
  });
  expect(mocks.rpc).toHaveBeenCalledWith("request_stems", { p_version: SONG });
  expect(revalidatePath).toHaveBeenCalledWith("/stems/[id]", "page");
});

it("records an edited upload under the owner's edits folder only", async () => {
  const path = `edits/${OWNER}/${SONG}/${FILE}.mp3`;
  expect(await saveEditedTake({ versionId: SONG, path })).toMatchObject({
    ok: true,
  });
  expect(mocks.rpc).toHaveBeenCalledWith("save_edited_take", {
    p_version: SONG,
    p_path: path,
  });
  for (const bad of [
    `previews/${OWNER}/${SONG}/${FILE}.mp3`,
    `edits/${OWNER}/${SONG}/${FILE}.wav`,
    `edits/${OWNER}/../${FILE}.mp3`,
    `edits/${OWNER}/${SONG}/../${FILE}.mp3`,
    `edits/${OWNER}/${SONG}/take-1.mp3`,
    "",
  ]) {
    mocks.rpc.mockClear();
    expect((await saveEditedTake({ versionId: SONG, path: bad })).ok, bad).toBe(
      false,
    );
    expect(mocks.rpc).not.toHaveBeenCalled();
  }
});

it("reports a refusal from the database as a failed action", async () => {
  mocks.rpc.mockResolvedValueOnce({
    data: null,
    error: { message: "chosen take required" },
  });
  expect((await requestStems({ versionId: SONG })).ok).toBe(false);
});
