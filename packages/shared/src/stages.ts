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
  // On demand: renders an audio-reactive visualizer video of the chosen take (Video Studio).
  "visualizer",
  // On demand: makes alternatives of a part of a take with new lyrics ("Riscrivi una parte").
  "replace_section",
  // Turns an uploaded or imported recording into the song's take ("Importa da Suno").
  "import_audio",
  // "Rifai da YouTube" (design 8.4, task 27): R1 ingest, R2 analyse, R3 rewrite lyrics, run on
  // the remake's version while it is analysing. remake_rewrite also writes one section again
  // or checks the person's edits during the review.
  "remake_ingest",
  "remake_analyse",
  "remake_rewrite",
  // The create panel's AI lyric buttons: a job without a song (jobs.version_id is null).
  "lyrics_assist",
  // On demand: local Whisper word timing for a playable take.
  "align_lyrics",
] as const;

export type Stage = (typeof STAGES)[number];

// Default class; local generation/replacement uses GPU instead of the network.
export const STAGE_RESOURCE_CLASS: Record<Stage, "gpu" | "cpu" | "net"> = {
  draft_lyrics: "net",
  generate_song: "net",
  timing: "net",
  storyboard: "cpu",
  render_master: "gpu",
  render_hook: "gpu",
  qa: "cpu",
  art: "cpu",
  publish: "net",
  set_privacy: "net",
  import_legacy: "cpu",
  stems: "gpu",
  visualizer: "gpu",
  replace_section: "net",
  import_audio: "net",
  remake_ingest: "net",
  remake_analyse: "net",
  remake_rewrite: "net",
  lyrics_assist: "net",
};

export const REMAKE_JOB_STAGES: readonly Stage[] = [
  "remake_ingest",
  "remake_analyse",
  "remake_rewrite",
];
// Stages whose jobs belong to no song.
export const SONGLESS_STAGES: readonly Stage[] = ["lyrics_assist"];

// Stages the owner asks for on a finished song. They never change the song status, not even
// when they fail, so a failed separation, visualizer render or rewrite leaves the song as it was.
export const ON_DEMAND_STAGES: readonly Stage[] = [
  "stems",
  "visualizer",
  "replace_section",
  "align_lyrics",
];
export function isOnDemandStage(stage: Stage): boolean {
  return ON_DEMAND_STAGES.includes(stage);
}

// A job whose failure leaves the song's status as it is: the on-demand stages, and a remake
// review step (one section written again, or the person's edits checked), which must not throw
// the whole remake away.
export function keepsStatusOnFailure(job: {
  stage: Stage;
  payload?: Record<string, unknown> | null;
}): boolean {
  if (isOnDemandStage(job.stage)) return true;
  const mode = job.payload?.mode;
  return (
    job.stage === "remake_rewrite" && (mode === "section" || mode === "check")
  );
}
