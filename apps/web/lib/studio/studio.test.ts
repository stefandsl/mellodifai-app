import { SongSettingsSchema } from "@mellodifai/shared";
import { beforeEach, describe, expect, it } from "vitest";
import { CreateSongInput } from "@/app/actions/schemas";
import { payloadFor } from "@/components/studio/create/create-panel";
import { clipBadge } from "@/components/studio/feed/clip-card";
import {
  dayLabel,
  type Filter,
  MATCH,
} from "@/components/studio/feed/workspace-feed";
import {
  blocker,
  initialForm,
  sanitizeDraft,
  useCreateForm,
} from "@/store/create-form";
import { usePlayer } from "@/store/player";
import { artFor, loadClips } from "./clips";

const TAKE_SCORES = {
  fidelity: 0.91,
  duration: 212,
  endDropDb: 30,
  weakSections: [],
  truncated: false,
};

describe("create form", () => {
  it("maps the form to kie settings: percent to 0-1, Auto duration to null", () => {
    const form = {
      ...initialForm("it"),
      mode: "advanced" as const,
      lyrics: "[Verse 1]\nCiao",
      title: " Lunedi ",
      weirdness: 72,
      styleInfluence: 30,
      variety: 4,
    };
    const payload = payloadFor(form);
    expect(payload.settings).toEqual({
      model: "V6",
      title: "Lunedi",
      weirdness: 0.72,
      styleWeight: 0.3,
      variety: 4,
      duration: null,
      video: "lyric",
      engine: "kie",
    });
    expect(SongSettingsSchema.parse(payload.settings)).toEqual(
      payload.settings,
    );
    expect(CreateSongInput.parse(payload).mode).toBe("advanced");
    expect(
      payloadFor({ ...form, durationMode: "custom", duration: 95 }).settings
        .duration,
    ).toBe(95);
    expect(
      payloadFor({ ...form, video: { ...form.video, mode: "off" } }).settings
        .video,
    ).toBe("off");
  });

  it("sends a local engine without the kie-only controls", () => {
    const form = {
      ...initialForm("it"),
      mode: "advanced" as const,
      lyrics: "[Verse 1]\nCiao",
      title: "Lunedi",
      exclude: "metal",
      weirdness: 72,
      styleInfluence: 30,
      variety: 4,
      model: "V6_WILD" as const,
      durationMode: "custom" as const,
      duration: 95,
    };
    // ACE-Step keeps the chosen duration.
    const ace = payloadFor({ ...form, engine: "ace-step" });
    expect(ace.settings).toEqual({
      title: "Lunedi",
      duration: 95,
      video: "lyric",
      engine: "ace-step",
    });
    expect(CreateSongInput.parse(ace).settings.engine).toBe("ace-step");
    // YuE2 decides its own length, so no duration travels.
    expect(payloadFor({ ...form, engine: "yue2" }).settings).toEqual({
      title: "Lunedi",
      duration: null,
      video: "lyric",
      engine: "yue2",
    });
  });

  it("sends tempo, key and time signature only when they are not Auto", () => {
    const base = {
      ...initialForm("it"),
      mode: "advanced" as const,
      styles: "pop",
    };
    for (const key of ["bpm", "keyscale", "timeSignature"])
      expect(payloadFor(base).settings).not.toHaveProperty(key);
    const chosen = payloadFor({
      ...base,
      bpm: 96,
      keyscale: "D minor",
      timeSignature: "3",
    });
    expect(chosen.settings).toMatchObject({
      bpm: 96,
      keyscale: "D minor",
      timeSignature: "3",
    });
    // The tempo slider's minimum is Auto.
    expect(payloadFor({ ...base, bpm: 40 }).settings).not.toHaveProperty("bpm");
    // Every engine takes them: kie and YuE2 as tags, ACE-Step as encoder inputs.
    for (const engine of ["kie", "yue2", "ace-step"] as const)
      expect(payloadFor({ ...base, engine, bpm: 96 }).settings).toMatchObject({
        bpm: 96,
      });
    expect(SongSettingsSchema.parse(chosen.settings)).toMatchObject(
      chosen.settings,
    );
  });

  it("sends a fixed seed to local engines only", () => {
    const base = {
      ...initialForm("it"),
      mode: "advanced" as const,
      styles: "pop",
      seedMode: "fixed" as const,
      seed: 4242,
    };
    expect(payloadFor({ ...base, engine: "ace-step" }).settings.seed).toBe(
      4242,
    );
    expect(payloadFor({ ...base, engine: "yue2" }).settings.seed).toBe(4242);
    expect(payloadFor({ ...base, engine: "kie" }).settings).not.toHaveProperty(
      "seed",
    );
    expect(
      payloadFor({ ...base, engine: "ace-step", seedMode: "random" }).settings,
    ).not.toHaveProperty("seed");
  });

  it("sends steps and guidance for ACE-Step when they differ from the defaults", () => {
    const base = {
      ...initialForm("it"),
      mode: "advanced" as const,
      styles: "pop",
      engine: "ace-step" as const,
    };
    expect(payloadFor(base).settings).not.toHaveProperty("steps");
    expect(payloadFor(base).settings).not.toHaveProperty("guidance");
    expect(
      payloadFor({ ...base, steps: 50, guidance: 9.5 }).settings,
    ).toMatchObject({ steps: 50, guidance: 9.5 });
    expect(
      payloadFor({ ...base, engine: "yue2", steps: 50 }).settings,
    ).not.toHaveProperty("steps");
    expect(
      payloadFor({ ...base, engine: "kie", guidance: 9 }).settings,
    ).not.toHaveProperty("guidance");
  });

  it("repairs a saved draft: ranges, unknown keys and signatures", () => {
    const fixed = sanitizeDraft({
      songCount: 9,
      lyricsHeight: 5,
      bpm: 999,
      keyscale: "H major",
      timeSignature: "7" as never,
      seed: -4,
      seedMode: "weird" as never,
      steps: 1,
      guidance: 99,
    });
    expect(fixed).toMatchObject({
      songCount: 4,
      lyricsHeight: 120,
      bpm: 240,
      keyscale: "auto",
      timeSignature: "auto",
      seed: 0,
      seedMode: "random",
      steps: 10,
      guidance: 15,
    });
    // A draft saved before these controls existed gets the defaults.
    expect(sanitizeDraft({ prompt: "ciao" })).toMatchObject({
      prompt: "ciao",
      songCount: 1,
      steps: 30,
      guidance: 7,
      keyscale: "auto",
    });
  });

  it("keeps the song count and the lyrics height when the form is cleared", () => {
    useCreateForm.setState({
      ...initialForm("it"),
      songCount: 3,
      lyricsHeight: 400,
      bpm: 100,
      seed: 5,
    });
    useCreateForm.getState().clear();
    expect(useCreateForm.getState()).toMatchObject({
      songCount: 3,
      lyricsHeight: 400,
      bpm: 40,
      seed: 0,
    });
  });

  it("blocks Create with the reason the panel shows", () => {
    const base = initialForm("it");
    expect(blocker(base)).toBe("needPrompt");
    expect(blocker({ ...base, prompt: "una canzone" })).toBeNull();
    expect(blocker({ ...base, mode: "advanced" })).toBe("needAdvanced");
    expect(blocker({ ...base, mode: "advanced", styles: "pop" })).toBeNull();
    expect(blocker({ ...base, prompt: "x", languages: [] })).toBe(
      "needLanguage",
    );
    expect(blocker({ ...base, prompt: "x".repeat(501) })).toBe("tooLong");
  });

  it("clear keeps mode, model, engine and languages but empties the fields", () => {
    useCreateForm.getState().set({
      mode: "advanced",
      engine: "ace-step",
      model: "V6_WILD",
      languages: ["en", "it"],
      lyrics: "testo",
      weirdness: 90,
    });
    useCreateForm.getState().clear();
    const state = useCreateForm.getState();
    expect(state).toMatchObject({
      mode: "advanced",
      engine: "ace-step",
      model: "V6_WILD",
      languages: ["en", "it"],
      lyrics: "",
      weirdness: 50,
    });
  });
});

describe("feed", () => {
  it("labels today, yesterday and older days in the interface language", () => {
    const now = new Date(2026, 9, 31, 12);
    expect(dayLabel(new Date(2026, 9, 31, 1).toISOString(), "it", now)).toBe(
      "Oggi",
    );
    expect(dayLabel(new Date(2026, 9, 30, 23).toISOString(), "en", now)).toBe(
      "Yesterday",
    );
    expect(dayLabel(new Date(2026, 9, 15).toISOString(), "en", now)).toBe(
      "Thursday, Oct 15",
    );
  });

  it("badges a song with the engine that made it", () => {
    expect(clipBadge({ model: "V6", settings: {} })).toBe("v6");
    expect(clipBadge({ model: "V6", settings: { engine: "ace-step" } })).toBe(
      "ACE-Step",
    );
    expect(clipBadge({ model: "V6", settings: { engine: "yue2" } })).toBe(
      "YuE2",
    );
  });

  it("filters the feed by like, creation state and audio only", () => {
    const base = {
      reaction: "none",
      status: "approved",
      audioUrl: null,
      videoUrl: null,
    } as const;
    const clipsIn = [
      { ...base, id: "a", reaction: "like" },
      { ...base, id: "b", status: "song_queued" },
      { ...base, id: "c", status: "audio_ready", audioUrl: "x" },
    ] as never[];
    const ids = (filter: Filter) =>
      clipsIn.filter(MATCH[filter]).map((clip: { id: string }) => clip.id);
    expect(ids("liked")).toEqual(["a"]);
    expect(ids("creating")).toEqual(["b"]);
    expect(ids("audioOnly")).toEqual(["c"]);
  });

  it("gives each song a stable artwork", () => {
    expect(artFor("abc")).toBe(artFor("abc"));
    expect(artFor("abc")).not.toBe(artFor("abd"));
  });

  it("loads clips with the chosen take audio, the current master render and its cover", async () => {
    const rows: Record<string, unknown[]> = {
      versions: [
        {
          id: "v1",
          lang: "it",
          status: "approved",
          created_at: "2026-10-31T10:00:00Z",
          updated_at: "2026-10-31T11:00:00Z",
          lyric_pack: { title: "Lunedi", style: "italo pop", lyrics: "x" },
          liked: true,
          disliked: false,
          play_count: 7,
          trashed_at: null,
          display_title: null,
          chosen_take_id: "t2",
          generation_count: 1,
          render_attempt: 2,
          projects: {
            id: "p1",
            topic: "lunedi",
            style: null,
            brief: null,
            song_settings: { model: "V6_WILD" },
          },
        },
        {
          id: "v2",
          lang: "fr",
          status: "approved",
          created_at: "2026-10-30T10:00:00Z",
          updated_at: "2026-10-30T11:00:00Z",
          lyric_pack: { title: "CBP" },
          liked: false,
          disliked: true,
          play_count: 0,
          trashed_at: null,
          display_title: "  Il mio CBP ".trim(),
          chosen_take_id: "t3",
          generation_count: 1,
          render_attempt: 1,
          projects: {
            id: "p2",
            topic: "cbp",
            style: null,
            brief: null,
            song_settings: {},
          },
        },
      ],
      takes: [
        {
          id: "t1",
          version_id: "v1",
          audio_preview_path: "a/t1.mp3",
          generation: 1,
          take_number: 1,
          scores: TAKE_SCORES,
        },
        {
          id: "t2",
          version_id: "v1",
          audio_preview_path: "a/t2.mp3",
          cover_path: "a/cover-1-2.jpg",
          generation: 1,
          take_number: 2,
          // Scoring has not landed yet.
          scores: {},
        },
        // Imported songs keep a take row without a preview file.
        {
          id: "t3",
          version_id: "v2",
          audio_preview_path: null,
          generation: 1,
          take_number: 1,
          // The stems of a take come back as their creation time only.
          stems_at: "2026-11-01T10:00:00Z",
        },
      ],
      // Newest first, as asked: the running job is the one for the chosen take.
      jobs: [
        { id: "j2", version_id: "v1", status: "running", take_id: "t2" },
        { id: "j1", version_id: "v1", status: "failed", take_id: "t1" },
      ],
      renders: [
        {
          version_id: "v1",
          kind: "master",
          preview_path: "r/new.mp4",
          render_attempt: 2,
          created_at: "2",
        },
        {
          version_id: "v1",
          kind: "master",
          preview_path: "r/old.mp4",
          render_attempt: 1,
          created_at: "1",
        },
        {
          version_id: "v2",
          kind: "master",
          preview_path: "q/fr/video-720p.mp4",
          render_attempt: 1,
          created_at: "3",
        },
      ],
    };
    const stored = new Set([
      "a/t1.mp3",
      "a/t2.mp3",
      "r/new.mp4",
      "r/old.mp4",
      "r/thumbnail.png",
      "a/cover-1-2.jpg",
      "q/fr/video-720p.mp4",
      "q/fr/thumbnail-1280x720.png",
    ]);
    // A query builder is awaitable at any point of its chain.
    const trashFilters: string[] = [];
    const query = (table: string) => {
      const chain = Object.assign(
        Promise.resolve({ data: rows[table] ?? [] }),
        {
          select: () => chain,
          order: () => chain,
          limit: () => chain,
          in: () => chain,
          eq: () => chain,
          is: (column: string) => {
            trashFilters.push(`is ${column}`);
            return chain;
          },
          not: (column: string) => {
            trashFilters.push(`not ${column}`);
            return chain;
          },
        },
      );
      return chain;
    };
    const supabase = {
      from: query,
      rpc: async (name: string) => ({
        data:
          name === "my_queue_positions"
            ? [{ version_id: "v2", queue_position: 3 }]
            : null,
      }),
      storage: {
        from: () => ({
          createSignedUrls: async (paths: string[]) => ({
            data: paths.map((path) =>
              stored.has(path)
                ? { path, signedUrl: `https://s/${path}`, error: null }
                : { path, signedUrl: null, error: "Object not found" },
            ),
          }),
        }),
      },
    };
    const [clip, imported] = await loadClips(supabase as never);
    // The feed asks for songs that are not in the trash.
    expect(trashFilters).toEqual(["is trashed_at"]);
    expect(clip).toMatchObject({
      id: "v1",
      title: "Lunedi",
      style: "italo pop",
      model: "V6_WILD",
      audioUrl: "https://s/a/t2.mp3",
      videoUrl: "https://s/r/new.mp4",
      hookUrl: null,
      href: "/projects/p1?lang=it",
    });
    // Stored scores are exposed per take; an empty jsonb means "not scored yet".
    expect(clip?.takes.map((take) => take.scores)).toEqual([TAKE_SCORES, null]);
    // The chosen take's Suno artwork wins over the video thumbnail.
    expect(clip?.art).toContain('url("https://s/a/cover-1-2.jpg")');
    expect(clip?.art).not.toContain("thumbnail.png");
    expect(imported).toMatchObject({
      audioUrl: "https://s/q/fr/video-720p.mp4",
      videoUrl: "https://s/q/fr/video-720p.mp4",
    });
    // Likes, plays and the queue position come with the clip; a rename wins over the pack title.
    expect(clip).toMatchObject({
      reaction: "like",
      playCount: 7,
      trashedAt: null,
      queuePosition: null,
      stems: {
        takeId: "t2",
        status: "running",
        jobId: "j2",
        queuePosition: null,
      },
    });
    // Stems saved on the chosen take are ready, with or without a job.
    expect(imported?.stems).toEqual({
      takeId: "t3",
      status: "done",
      jobId: null,
      queuePosition: null,
    });
    expect(imported).toMatchObject({
      title: "Il mio CBP",
      reaction: "dislike",
      playCount: 0,
      queuePosition: 3,
    });
    // The trash view asks for the other half and needs no queue positions.
    trashFilters.length = 0;
    await loadClips(supabase as never, 50, { trash: true });
    expect(trashFilters).toEqual(["not trashed_at"]);
    expect(imported?.art).toContain(
      'url("https://s/q/fr/thumbnail-1280x720.png")',
    );
  });

  it("narrows the query to given songs and to liked songs, newest like first", async () => {
    const calls: string[] = [];
    const supabase = {
      from: () => {
        // biome-ignore lint/suspicious/noExplicitAny: a chainable test double refers to itself.
        const chain: any = Object.assign(Promise.resolve({ data: [] }), {
          select: () => chain,
          order: (column: string, options: { nullsFirst?: boolean }) => {
            calls.push(`order ${column} nullsFirst=${options.nullsFirst}`);
            return chain;
          },
          limit: () => chain,
          in: (column: string, values: string[]) => {
            calls.push(`in ${column} ${values.join(",")}`);
            return chain;
          },
          eq: (column: string, value: unknown) => {
            calls.push(`eq ${column} ${String(value)}`);
            return chain;
          },
          is: () => chain,
          not: () => chain,
        });
        return chain;
      },
      rpc: async () => ({ data: null }),
    };
    await loadClips(supabase as never, 10, { ids: ["a", "b"] });
    expect(calls).toContain("in id a,b");
    calls.length = 0;
    await loadClips(supabase as never, 10, { liked: true });
    expect(calls).toEqual([
      "eq liked true",
      "order liked_at nullsFirst=false",
      "order created_at nullsFirst=undefined",
    ]);
    // An empty list of ids is an empty playlist: no query at all.
    calls.length = 0;
    expect(await loadClips(supabase as never, 10, { ids: [] })).toEqual([]);
    expect(calls).toEqual([]);
  });
});

describe("player", () => {
  beforeEach(() =>
    usePlayer.setState({ queue: [], index: -1, playing: false, time: 0 }),
  );
  const track = (id: string) => ({
    id,
    title: id,
    subtitle: "",
    audioUrl: `https://s/${id}.mp3`,
    videoUrl: null,
    href: "/",
    art: "",
    reaction: "none" as const,
  });

  it("plays a track within its list and wraps to the next one", () => {
    const list = [track("a"), track("b")];
    usePlayer.getState().play(list[1] as never, list);
    expect(usePlayer.getState()).toMatchObject({ index: 1, playing: true });
    usePlayer.getState().next();
    expect(usePlayer.getState().index).toBe(0);
  });

  it("restarts the song on previous after three seconds", () => {
    usePlayer.getState().play(track("a"), [track("a"), track("b")]);
    usePlayer.setState({ time: 10 });
    usePlayer.getState().prev();
    expect(usePlayer.getState()).toMatchObject({ index: 0, time: 0 });
  });

  it("drops songs that left the library, even the one playing", () => {
    const list = ["a", "b", "c"].map(track);
    usePlayer.getState().play(list[1] as never, list);
    usePlayer.getState().drop(["c"]);
    expect(usePlayer.getState()).toMatchObject({ index: 1, playing: true });
    expect(usePlayer.getState().queue.map((t) => t.id)).toEqual(["a", "b"]);
    usePlayer.getState().drop(["a"]);
    expect(usePlayer.getState().index).toBe(0);
    // The playing song goes: playback stops and nothing else is touched.
    usePlayer.getState().drop(["b"]);
    expect(usePlayer.getState()).toMatchObject({
      queue: [],
      index: -1,
      playing: false,
    });
  });

  it("stops at the end of the queue unless repeat is on", () => {
    usePlayer.getState().play(track("a"));
    usePlayer.getState().ended();
    expect(usePlayer.getState().playing).toBe(false);
  });
});
