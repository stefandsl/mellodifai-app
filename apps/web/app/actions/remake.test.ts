// @vitest-environment node
import { remakeLyricsText } from "@mellodifai/shared";
import { beforeEach, describe, expect, it, vi } from "vitest";
import FIXTURE from "../../../../packages/remake/test/fixtures/remake-lyrics.it.json";

const mocks = vi.hoisted(() => ({
  rpc: vi.fn(),
  ops: vi.fn(),
  lyrics: null as unknown,
}));
vi.mock("@/lib/ops/context", () => ({
  sessionCtx: async () => ({ actor_kind: "session", user_id: "owner" }),
}));
vi.mock("@/lib/db/ops-client", () => ({ callOps: mocks.ops }));
vi.mock("next/headers", () => ({ headers: async () => new Headers() }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/auth", () => ({
  actionProfile: async () => ({
    supabase: {
      from: () => ({
        select: () => ({
          eq: () => ({
            single: async () => ({
              data: { lyrics: mocks.lyrics },
              error: null,
            }),
          }),
        }),
      }),
    },
    user: { id: "owner" },
  }),
}));

import { tokenOps } from "@/lib/ops/registry";
import {
  acceptRemake,
  cancelRemake,
  dismissRemake,
  editRemake,
  regenerateRemakeSection,
  retryRemake,
  startRemake,
} from "./remake";

const ID = "11111111-1111-4111-8111-111111111111";

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, "error").mockImplementation(() => {});
  mocks.lyrics = structuredClone(FIXTURE);
  mocks.rpc.mockImplementation(async () => ({ data: ID, error: null }));
  mocks.ops.mockImplementation(async (name: string, args: unknown[]) => {
    if (name === "idem_begin") return { ok: true, data: { status: "new" } };
    const names: Record<string, string[]> = {
      remake_start: ["p_url", "p_video_id", "p_lang", "p_country"],
      remake_edit: ["p_remake", "p_revision", "p_lines", "p_title"],
      remake_regenerate_section: ["p_remake", "p_revision", "p_section"],
      remake_accept: [
        "p_remake",
        "p_revision",
        "p_pack",
        "p_settings",
        "p_vocal_gender",
      ],
      remake_cancel: ["p_remake"],
      remake_dismiss: ["p_remake"],
      remake_retry: ["p_remake"],
    };
    const result = await mocks.rpc(
      name,
      Object.fromEntries(names[name].map((key, i) => [key, args[i + 1]])),
    );
    return result.error
      ? { ok: false, code: "conflict", message: result.error.message }
      : {
          ok: true,
          data:
            name === "remake_edit"
              ? { revision: result.data }
              : { id: result.data },
        };
  });
});

describe("startRemake", () => {
  it("refuses a link that is not a YouTube video before the database", async () => {
    for (const url of ["https://vimeo.com/1", "watch?v=short", "ciao"])
      expect(await startRemake({ url, lang: "it" })).toEqual({
        ok: false,
        error: "invalidUrl",
      });
    expect(mocks.rpc).not.toHaveBeenCalled();
    expect(
      await startRemake({ url: "https://youtu.be/49rDdMbXd_w", lang: "xx" }),
    ).toEqual({ ok: false, error: "invalidUrl" });
  });

  it("sends the video id, the language and the country", async () => {
    expect(
      await startRemake({
        url: "youtube.com/watch?v=49rDdMbXd_w",
        lang: "en",
        country: "GB",
      }),
    ).toEqual({ ok: true, id: ID });
    expect(mocks.rpc).toHaveBeenCalledWith("remake_start", {
      p_url: "https://youtube.com/watch?v=49rDdMbXd_w",
      p_video_id: "49rDdMbXd_w",
      p_lang: "en",
      p_country: "GB",
    });
    await startRemake({ url: "49rDdMbXd_w", lang: "it" });
    expect(mocks.rpc.mock.calls[1]?.[1]).toMatchObject({
      p_url: "https://www.youtube.com/watch?v=49rDdMbXd_w",
    });
  });

  it("turns database refusals into codes the panel can explain", async () => {
    for (const [message, error] of [
      ["a remake is already running", "busy"],
      ["daily remake limit reached", "limit"],
      ["invalid youtube link", "invalidUrl"],
      ["boom", "failed"],
    ] as const) {
      mocks.rpc.mockResolvedValueOnce({ data: null, error: { message } });
      expect(
        await startRemake({ url: "https://youtu.be/49rDdMbXd_w", lang: "it" }),
      ).toMatchObject({ ok: false, error });
    }
  });
});

describe("review actions", () => {
  it("edits with the revision the person saw and reports a conflict", async () => {
    mocks.rpc.mockResolvedValueOnce({ data: 4, error: null });
    expect(
      await editRemake({
        remakeId: ID,
        revision: 3,
        lines: [{ index: 8, text: "  il mondo corre " }],
      }),
    ).toEqual({ ok: true, revision: 4 });
    expect(mocks.rpc).toHaveBeenCalledWith("remake_edit", {
      p_remake: ID,
      p_revision: 3,
      p_lines: [{ index: 8, text: "il mondo corre" }],
      p_title: null,
    });
    mocks.rpc.mockResolvedValueOnce({
      data: null,
      error: { message: "conflict: the lyrics changed meanwhile" },
    });
    expect(
      await editRemake({
        remakeId: ID,
        revision: 2,
        lines: [{ index: 8, text: "x" }],
      }),
    ).toMatchObject({ ok: false, error: "conflict" });
    expect(
      await editRemake({
        remakeId: ID,
        revision: 2,
        lines: [{ index: 8, text: "two\nlines" }],
      }),
    ).toMatchObject({ ok: false });
  });

  it("regenerates a section", async () => {
    mocks.rpc.mockResolvedValueOnce({
      data: null,
      error: { message: "wait for the running step" },
    });
    expect(
      await regenerateRemakeSection({
        remakeId: ID,
        revision: 3,
        section: "chorus-1",
      }),
    ).toMatchObject({ ok: false, error: "wait" });
  });

  it("accepts with the exact reviewed text and never a source audio", async () => {
    expect(
      await acceptRemake({
        remakeId: ID,
        revision: 3,
        title: "Mille volti",
        style: "rock, 79 bpm",
        vocalGender: "f",
        settings: {
          engine: "kie",
          model: "V6",
          bpm: 79,
          keyscale: "D minor",
          source: {
            mode: "cover",
            takeId: "22222222-2222-4222-8222-222222222222",
            title: "t",
          },
        },
      }),
    ).toEqual({ ok: true, id: ID });
    const [name, args] = mocks.rpc.mock.calls[0] ?? [];
    expect(name).toBe("remake_accept");
    expect(args).toMatchObject({
      p_remake: ID,
      p_revision: 3,
      p_vocal_gender: "f",
      p_pack: {
        title: "Mille volti",
        style: "rock, 79 bpm",
        lyrics: remakeLyricsText(FIXTURE as never),
        settings: { model: "V6", vocalGender: "f", duration: null },
      },
      p_settings: { engine: "kie", bpm: 79, title: "Mille volti" },
    });
    expect(args?.p_settings).not.toHaveProperty("source");
    mocks.rpc.mockResolvedValueOnce({
      data: null,
      error: { message: "originality gate not passed" },
    });
    expect(
      await acceptRemake({
        remakeId: ID,
        revision: 3,
        title: "Mille volti",
        style: "rock",
        vocalGender: null,
        settings: { engine: "kie", model: "V6" },
      }),
    ).toMatchObject({ ok: false, error: "gate" });
  });
});

it.each([
  [cancelRemake, "remake_cancel"],
  [dismissRemake, "remake_dismiss"],
  [retryRemake, "remake_retry"],
] as const)("routes lifecycle writes through ops: %s", async (action, name) => {
  expect(await action({ remakeId: ID })).toEqual({ ok: true });
  expect(mocks.ops).toHaveBeenCalledWith(name, [
    expect.objectContaining({
      actor_kind: "session",
      idempotency_key: expect.any(String),
    }),
    ID,
  ]);
});

it("an agent's remake_accept hands the database what the create panel's accept does", async () => {
  const settings = {
    engine: "kie",
    model: "V5",
    bpm: 79,
    keyscale: "D minor",
    exclude: "rap",
    weirdness: 0.2,
    duration: 180,
    source: {
      mode: "cover",
      takeId: "22222222-2222-4222-8222-222222222222",
      title: "t",
    },
  };
  for (const vocalGender of ["f", null] as const) {
    mocks.ops.mockClear();
    expect(
      await acceptRemake({
        remakeId: ID,
        revision: 3,
        title: "Mille volti",
        style: "rock, 79 bpm",
        vocalGender,
        settings,
      }),
    ).toEqual({ ok: true, id: ID });
    const cookie = mocks.ops.mock.calls
      .find(([name]) => name === "remake_accept")?.[1]
      .slice(1);
    expect(cookie).toHaveLength(5);
    // The token path gets the text from remake_get instead of reading the stored lyrics.
    expect(
      tokenOps.remake_accept.args({
        remake_id: ID,
        revision: 3,
        lyrics_text: remakeLyricsText(FIXTURE as never),
        title: "Mille volti",
        style: "rock, 79 bpm",
        vocal_gender: vocalGender,
        settings,
      }),
    ).toEqual(cookie);
  }
});
