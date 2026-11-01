import {
  ACE_GUIDANCE,
  ACE_STEPS,
  BPM_RANGE,
  type Lang,
  MAX_SONGS_PER_CLICK,
  SEED_MAX,
  SONG_KEYS,
  SOURCE_MODES,
  type SongEngine,
  type SongModel,
  type SourceMode,
  TIME_SIGNATURES,
  type TimeSignature,
} from "@mellodifai/shared";
import { create } from "zustand";
import { persist } from "zustand/middleware";

export type VideoMode =
  | "off"
  | "lyric"
  | "visualizer"
  | "ai"
  | "slideshow"
  | "footage";
export type Aspect = "9:16" | "1:1" | "16:9";
export type CardId = "lyrics" | "styles" | "video" | "music" | "more" | "audio";

// The audio a new song starts from (T12): an upload of the owner's or a take of one of the
// owner's songs, used as a cover, a reference or to extend.
export type CreateAudio = {
  mode: SourceMode;
  upload?: string;
  takeId?: string;
  versionId?: string;
  // What the card shows and plays.
  title: string;
  url: string;
  duration?: number;
  // Extend only: seconds into the source; absent = at its end.
  continueAt?: number;
};

export type CreateFormState = {
  mode: "simple" | "advanced";
  model: SongModel;
  // kie is Suno; the others run on the PC and are for the admin only.
  engine: SongEngine;
  languages: Lang[];
  prompt: string;
  lyrics: string;
  styles: string;
  exclude: string;
  vocalGender: "m" | "f" | null;
  durationMode: "auto" | "custom";
  duration: number;
  weirdness: number;
  styleInfluence: number;
  variety: number;
  title: string;
  // Tempo at its minimum, "auto" key and signature: the engine decides.
  bpm: number;
  keyscale: "auto" | string;
  timeSignature: "auto" | TimeSignature;
  // Local engines: a random seed per song, or one the person fixed.
  seedMode: "random" | "fixed";
  seed: number;
  // ACE-Step "Esperto".
  steps: number;
  guidance: number;
  // How many songs one click makes (1 to 4); remembered.
  songCount: number;
  // Height in pixels of the lyrics box, remembered.
  lyricsHeight: number;
  video: { mode: VideoMode; aspect: Aspect; overlay: boolean };
  open: Record<CardId, boolean>;
  audio: CreateAudio | null;
  // The mode the audio card shows before any audio is chosen.
  audioMode: SourceMode;
};

type Actions = {
  set: (patch: Partial<CreateFormState>) => void;
  setVideo: (patch: Partial<CreateFormState["video"]>) => void;
  toggleCard: (card: CardId) => void;
  resetMore: () => void;
  resetMusic: () => void;
  clear: () => void;
};

export const LYRICS_HEIGHT = { min: 120, max: 720, default: 224 } as const;

export const MUSIC_DEFAULTS = {
  bpm: BPM_RANGE.min,
  keyscale: "auto",
  timeSignature: "auto",
} satisfies Partial<CreateFormState>;

export const MORE_DEFAULTS = {
  seedMode: "random",
  seed: 0,
  steps: ACE_STEPS.default,
  guidance: ACE_GUIDANCE.default,
  exclude: "",
  vocalGender: null,
  durationMode: "auto",
  duration: 180,
  weirdness: 50,
  styleInfluence: 50,
  variety: 2,
} satisfies Partial<CreateFormState>;

export function initialForm(lang: Lang = "it"): CreateFormState {
  return {
    mode: "simple",
    model: "V6",
    engine: "kie",
    languages: [lang],
    prompt: "",
    lyrics: "",
    styles: "",
    title: "",
    songCount: 1,
    lyricsHeight: LYRICS_HEIGHT.default,
    ...MUSIC_DEFAULTS,
    ...MORE_DEFAULTS,
    video: { mode: "lyric", aspect: "16:9", overlay: true },
    open: {
      lyrics: true,
      styles: true,
      video: true,
      music: true,
      more: false,
      audio: true,
    },
    audio: null,
    audioMode: "cover",
  };
}

export const LIMITS = {
  prompt: 500,
  lyrics: 5000,
  styles: 1000,
  exclude: 1000,
  title: 80,
} as const;

export function hasContent(form: CreateFormState): boolean {
  return Boolean(
    form.prompt.trim() ||
      form.lyrics.trim() ||
      form.styles.trim() ||
      form.title.trim() ||
      form.exclude.trim(),
  );
}

export type Blocker =
  | "needPrompt"
  | "needAdvanced"
  | "needLanguage"
  | "tooLong";

// What stops a Create click, if anything (the panel shows it above the button).
export function blocker(form: CreateFormState): Blocker | null {
  if (form.languages.length === 0) return "needLanguage";
  if (
    form.prompt.length > LIMITS.prompt ||
    form.lyrics.length > LIMITS.lyrics ||
    form.styles.length > LIMITS.styles ||
    form.exclude.length > LIMITS.exclude ||
    form.title.length > LIMITS.title
  )
    return "tooLong";
  if (form.mode === "simple" && !form.prompt.trim()) return "needPrompt";
  if (
    form.mode === "advanced" &&
    // A song made from audio needs nothing else: the audio is its content.
    !form.audio &&
    !form.lyrics.trim() &&
    !form.styles.trim() &&
    !form.title.trim() &&
    !form.prompt.trim()
  )
    return "needAdvanced";
  return null;
}

function within(value: unknown, min: number, max: number, fallback: number) {
  return typeof value === "number" && Number.isFinite(value)
    ? Math.min(max, Math.max(min, Math.round(value)))
    : fallback;
}

// A saved draft may be older, hand-edited or from another version: every control that has a
// range is brought back into it, and an unknown key or signature goes back to Auto.
// A remembered audio source is kept only when it still reads as one.
function cleanAudio(raw: unknown): CreateAudio | null {
  if (!raw || typeof raw !== "object") return null;
  const audio = raw as Partial<CreateAudio>;
  if (!SOURCE_MODES.includes(audio.mode as SourceMode)) return null;
  if (typeof audio.url !== "string" || typeof audio.title !== "string")
    return null;
  if (Boolean(audio.upload) === Boolean(audio.takeId)) return null;
  return audio as CreateAudio;
}

export function sanitizeDraft(saved: Partial<CreateFormState>) {
  const keys: readonly string[] = SONG_KEYS;
  const signatures: readonly string[] = TIME_SIGNATURES;
  const defaults = initialForm();
  const guidance =
    typeof saved.guidance === "number" && Number.isFinite(saved.guidance)
      ? Math.round(
          Math.min(
            ACE_GUIDANCE.max,
            Math.max(ACE_GUIDANCE.min, saved.guidance),
          ) / ACE_GUIDANCE.step,
        ) * ACE_GUIDANCE.step
      : defaults.guidance;
  return {
    ...saved,
    // A draft saved before a card existed has no entry for it.
    open: { ...defaults.open, ...saved.open },
    audio: cleanAudio(saved.audio),
    audioMode: SOURCE_MODES.includes(saved.audioMode as SourceMode)
      ? (saved.audioMode as SourceMode)
      : "cover",
    songCount: within(saved.songCount, 1, MAX_SONGS_PER_CLICK, 1),
    lyricsHeight: within(
      saved.lyricsHeight,
      LYRICS_HEIGHT.min,
      LYRICS_HEIGHT.max,
      defaults.lyricsHeight,
    ),
    bpm: within(saved.bpm, BPM_RANGE.min, BPM_RANGE.max, defaults.bpm),
    keyscale:
      saved.keyscale && keys.includes(saved.keyscale) ? saved.keyscale : "auto",
    timeSignature:
      saved.timeSignature && signatures.includes(saved.timeSignature)
        ? saved.timeSignature
        : "auto",
    seedMode:
      saved.seedMode === "fixed" ? ("fixed" as const) : ("random" as const),
    seed: within(saved.seed, 0, SEED_MAX, 0),
    steps: within(saved.steps, ACE_STEPS.min, ACE_STEPS.max, defaults.steps),
    guidance,
  };
}

export const useCreateForm = create<CreateFormState & Actions>()(
  persist(
    (set) => ({
      ...initialForm(),
      set: (patch) => set(patch),
      setVideo: (patch) => set((s) => ({ video: { ...s.video, ...patch } })),
      toggleCard: (card) =>
        set((s) => ({ open: { ...s.open, [card]: !s.open[card] } })),
      resetMore: () => set(MORE_DEFAULTS),
      resetMusic: () => set(MUSIC_DEFAULTS),
      clear: () =>
        set((s) => ({
          ...initialForm(s.languages[0]),
          mode: s.mode,
          model: s.model,
          engine: s.engine,
          languages: s.languages,
          songCount: s.songCount,
          lyricsHeight: s.lyricsHeight,
          open: s.open,
          audio: null,
        })),
    }),
    // The saved draft is loaded after hydration (CreatePanel), so the first client render
    // matches the server's default form.
    {
      name: "mellodifai-create-form",
      version: 1,
      skipHydration: true,
      merge: (saved, current) => ({
        ...current,
        ...sanitizeDraft((saved ?? {}) as Partial<CreateFormState>),
      }),
    },
  ),
);
