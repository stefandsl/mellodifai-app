export const LANGS = [
  "it",
  "ru",
  "ro",
  "ja",
  "en",
  "es",
  "de",
  "zh",
  "pt",
  "ko",
  "fr",
] as const;

export type Lang = (typeof LANGS)[number];

export const STAGES = [
  "draft_lyrics",
  "generate_song",
  "timing",
  "storyboard",
  "render_master",
  "render_hook",
  "qa",
  "art",
  "publish",
  "set_privacy",
  "import_legacy",
] as const;

export type Stage = (typeof STAGES)[number];
