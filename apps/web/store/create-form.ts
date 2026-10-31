import type { Lang, SongModel } from "@mellodifai/shared";
import { create } from "zustand";
import { persist } from "zustand/middleware";

export type VideoMode = "off" | "lyric" | "ai" | "slideshow" | "footage";
export type Aspect = "9:16" | "1:1" | "16:9";
export type CardId = "lyrics" | "styles" | "video" | "more";

export type CreateFormState = {
  mode: "simple" | "advanced";
  model: SongModel;
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
  video: { mode: VideoMode; aspect: Aspect; overlay: boolean };
  open: Record<CardId, boolean>;
};

type Actions = {
  set: (patch: Partial<CreateFormState>) => void;
  setVideo: (patch: Partial<CreateFormState["video"]>) => void;
  toggleCard: (card: CardId) => void;
  resetMore: () => void;
  clear: () => void;
};

export const MORE_DEFAULTS = {
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
    languages: [lang],
    prompt: "",
    lyrics: "",
    styles: "",
    title: "",
    ...MORE_DEFAULTS,
    video: { mode: "lyric", aspect: "16:9", overlay: true },
    open: { lyrics: true, styles: true, video: true, more: false },
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
    !form.lyrics.trim() &&
    !form.styles.trim() &&
    !form.title.trim() &&
    !form.prompt.trim()
  )
    return "needAdvanced";
  return null;
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
      clear: () =>
        set((s) => ({
          ...initialForm(s.languages[0]),
          mode: s.mode,
          model: s.model,
          languages: s.languages,
          open: s.open,
        })),
    }),
    { name: "mellodifai-create-form", version: 1 },
  ),
);
