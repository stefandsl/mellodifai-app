import { SongSettingsSchema } from "@mellodifai/shared";
import { beforeEach, describe, expect, it } from "vitest";
import { CreateSongInput } from "@/app/actions/schemas";
import { payloadFor } from "@/components/studio/create/create-panel";
import { dayLabel } from "@/components/studio/feed/workspace-feed";
import { blocker, initialForm, useCreateForm } from "@/store/create-form";
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
        },
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
    const query = (table: string) => {
      const chain = Object.assign(
        Promise.resolve({ data: rows[table] ?? [] }),
        {
          select: () => chain,
          order: () => chain,
          limit: () => chain,
          in: () => chain,
        },
      );
      return chain;
    };
    const supabase = {
      from: query,
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
    expect(imported?.art).toContain(
      'url("https://s/q/fr/thumbnail-1280x720.png")',
    );
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

  it("stops at the end of the queue unless repeat is on", () => {
    usePlayer.getState().play(track("a"));
    usePlayer.getState().ended();
    expect(usePlayer.getState().playing).toBe(false);
  });
});
