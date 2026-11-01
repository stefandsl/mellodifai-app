import { describe, expect, it } from "vitest";

import type { Clip } from "./clips";
import { canEdit, canSeparate, editorAudio, loadStemsPage } from "./stems";

const clip = (patch: Partial<Clip> = {}): Clip =>
  ({
    id: "v1",
    status: "audio_ready",
    trashedAt: null,
    chosenTakeId: "t1",
    audioUrl: "https://s/t1.mp3",
    takes: [
      { id: "t1", number: 1, audioUrl: "https://s/t1.mp3", scores: null },
    ],
    ...patch,
  }) as Clip;

describe("which songs the audio tools apply to", () => {
  it("separates the chosen take of every song that has one with audio", () => {
    for (const status of [
      "audio_ready",
      "producing",
      "video_review",
      "approved",
      "publishing",
      "published",
    ] as const)
      expect(canSeparate(clip({ status })), status).toBe(true);
    for (const status of [
      "drafting",
      "lyrics_review",
      "song_queued",
      "takes_review",
      "failed",
    ] as const)
      expect(canSeparate(clip({ status })), status).toBe(false);
  });

  it("edits only while nothing is being made with the song", () => {
    expect(canEdit(clip())).toBe(true);
    expect(canEdit(clip({ status: "published" }))).toBe(true);
    expect(canEdit(clip({ status: "producing" }))).toBe(false);
    expect(canEdit(clip({ status: "publishing" }))).toBe(false);
    expect(editorAudio(clip())).toBe("https://s/t1.mp3");
    expect(editorAudio(clip({ status: "producing" }))).toBeNull();
  });

  it("needs a chosen take with audio, outside the trash", () => {
    expect(canSeparate(clip({ chosenTakeId: null }))).toBe(false);
    expect(
      canSeparate(
        clip({
          takes: [{ id: "t1", number: 1, audioUrl: null, scores: null }],
        }),
      ),
    ).toBe(false);
    expect(canEdit(clip({ trashedAt: "2026-11-01" }))).toBe(false);
    // A chosen take of an older generation: the song's own audio is that take.
    expect(editorAudio(clip({ takes: [] }))).toBe("https://s/t1.mp3");
    expect(canSeparate(clip({ takes: [], audioUrl: null }))).toBe(false);
  });
});

// A database double: each table answers with its rows, whatever the filters.
function database({
  stems,
  job = null,
  signed = true,
}: {
  stems: unknown;
  job?: Record<string, unknown> | null;
  signed?: boolean;
}) {
  const calls: string[] = [];
  const rows: Record<string, unknown> = {
    versions: [
      {
        id: "v1",
        lang: "it",
        status: "audio_ready",
        created_at: "",
        updated_at: "",
        lyric_pack: { title: "Lunedì" },
        chosen_take_id: "t1",
        generation_count: 1,
        render_attempt: 1,
        liked: false,
        disliked: false,
        play_count: 0,
        trashed_at: null,
        display_title: null,
        lyric_jury: null,
        projects: { id: "p1", topic: "x", song_settings: {} },
      },
    ],
    takes: [
      {
        id: "t1",
        version_id: "v1",
        audio_preview_path: "a/t1.mp3",
        generation: 1,
        take_number: 1,
        stems,
      },
    ],
    renders: [],
    jobs: job ? [job] : [],
    job_events: [
      { id: 3, message: "Stems: 50%", progress: 50, at: "3" },
      { id: 2, message: "Separating", progress: null, at: "2" },
    ],
  };
  const query = (table: string) => {
    const answer = () => ({ data: rows[table] ?? [] });
    const chain = Object.assign(Promise.resolve(answer()), {
      maybeSingle: async () => ({
        data: (rows[table] as unknown[])?.[0] ?? null,
      }),
    }) as unknown as Record<string, unknown>;
    for (const name of ["select", "order", "limit", "in", "is", "not"])
      chain[name] = () => chain;
    chain.eq = (column: string, value: string) => {
      calls.push(`${table}.${column}=${value}`);
      return chain;
    };
    return chain;
  };
  return {
    calls,
    client: {
      from: query,
      rpc: async (name: string) => ({
        data:
          name === "my_stems_queue"
            ? [{ version_id: "v1", queue_position: 3 }]
            : [],
      }),
      storage: {
        from: () => ({
          createSignedUrls: async (paths: string[]) => ({
            data: paths.map((path) => ({
              path,
              signedUrl:
                signed || !path.includes("bass") ? `https://s/${path}` : null,
            })),
          }),
        }),
      },
    },
  };
}

const STEMS = {
  duration: 281.04,
  seconds: 68.4,
  tracks: {
    vocals: { path: "s/vocals.mp3", peaks: [0.5, "x", 1] },
    drums: { path: "s/drums.mp3", peaks: [0.1] },
    bass: { path: "s/bass.mp3" },
    other: { path: "s/other.mp3", peaks: [] },
  },
};

describe("loadStemsPage", () => {
  it("returns the four signed tracks in page order with their waveforms", async () => {
    const { client } = database({ stems: STEMS });
    const page = await loadStemsPage(client as never, "v1");
    expect(page?.tracks).toEqual([
      { name: "vocals", url: "https://s/s/vocals.mp3", peaks: [0.5, 1] },
      { name: "drums", url: "https://s/s/drums.mp3", peaks: [0.1] },
      { name: "bass", url: "https://s/s/bass.mp3", peaks: [] },
      { name: "other", url: "https://s/s/other.mp3", peaks: [] },
    ]);
    expect(page).toMatchObject({
      takeId: "t1",
      duration: 281.04,
      seconds: 68.4,
      job: null,
      events: [],
    });
  });

  it("has no tracks while a stem is missing or cannot be signed", async () => {
    const partial = {
      tracks: { ...STEMS.tracks, other: { path: "" } },
    };
    expect(
      (await loadStemsPage(database({ stems: partial }).client as never, "v1"))
        ?.tracks,
    ).toBeNull();
    expect(
      (
        await loadStemsPage(
          database({ stems: STEMS, signed: false }).client as never,
          "v1",
        )
      )?.tracks,
    ).toBeNull();
  });

  it("finds the job of the chosen take with its log, oldest first, and its place in the queue", async () => {
    const { client, calls } = database({
      stems: null,
      job: {
        id: "j1",
        status: "running",
        error: null,
        created_at: "1",
        started_at: "2",
        finished_at: null,
      },
    });
    const page = await loadStemsPage(client as never, "v1");
    expect(calls).toContain("jobs.idempotency_key=stems:v1:t1");
    expect(calls).toContain("job_events.job_id=j1");
    expect(page).toMatchObject({
      tracks: null,
      job: { id: "j1", status: "running", startedAt: "2" },
      queuePosition: 3,
    });
    expect(page?.events.map((event) => event.id)).toEqual([2, 3]);
  });

  it("returns nothing for a song that is not the caller's", async () => {
    const { client } = database({ stems: null });
    (client as { from: unknown }).from = () => {
      const chain = Promise.resolve({ data: [] }) as unknown as Record<
        string,
        unknown
      >;
      for (const name of ["select", "order", "limit", "in", "is", "eq"])
        chain[name] = () => chain;
      return chain;
    };
    expect(await loadStemsPage(client as never, "v1")).toBeNull();
  });
});
