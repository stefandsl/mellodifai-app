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
  // On demand: separates the chosen take into vocals, drums, bass and other.
  "stems",
] as const;

export type Stage = (typeof STAGES)[number];

// Stages the owner asks for on a finished song. They never change the song status, not even
// when they fail, so a failed separation leaves the song as it was.
export const ON_DEMAND_STAGES: readonly Stage[] = ["stems"];
export function isOnDemandStage(stage: Stage): boolean {
  return ON_DEMAND_STAGES.includes(stage);
}
