import type { Stage } from "./stages.js";

export type JobStatus = "queued" | "running" | "done" | "failed" | "cancelled";

export type VersionStatus =
  // A "Rifai da YouTube" remake: R1 to R3 run and the person reviews the new lyrics in the
  // create panel; accepting moves the song to song_queued (migration 20261102000026).
  | "analysing"
  | "drafting"
  | "lyrics_review"
  | "song_queued"
  | "takes_review"
  // A take was kept without a video; make_video can still start one.
  | "audio_ready"
  | "producing"
  | "video_review"
  | "approved"
  | "publishing"
  | "published"
  | "failed";

const STATUS_STAGES: Record<VersionStatus, Stage[]> = {
  analysing: ["remake_ingest", "remake_analyse", "remake_rewrite"],
  drafting: ["draft_lyrics"],
  lyrics_review: [],
  song_queued: ["generate_song"],
  takes_review: [],
  audio_ready: [],
  producing: [
    "timing",
    "storyboard",
    "render_master",
    "render_hook",
    "qa",
    "art",
  ],
  video_review: [],
  approved: ["publish"],
  publishing: ["set_privacy"],
  published: [],
  failed: [],
};

export function nextStages(status: VersionStatus): Stage[] {
  return [...STATUS_STAGES[status]];
}

// Statuses in which the song has a chosen take to separate; the same list as the SQL function
// stems_allowed_status (migration 20261101000020). A song being produced keeps its take, so
// stems can run between two video stages (the worker runs one job at a time).
export const STEMS_STATUSES: readonly VersionStatus[] = [
  "audio_ready",
  "producing",
  "video_review",
  "approved",
  "publishing",
  "published",
];

// Statuses in which an edit from the audio editor may become the chosen take: the song is not
// being produced or published right now. The same list as save_edited_take (migration
// 20261101000020).
export const EDIT_STATUSES: readonly VersionStatus[] = [
  "audio_ready",
  "video_review",
  "approved",
  "published",
];

// Statuses in which a part of a take may be rewritten: the takes are heard (takes_review) or the
// song is not being produced or published. The same list as request_section_edit (migration
// 20261101000023).
export const REWRITE_STATUSES: readonly VersionStatus[] = [
  "takes_review",
  ...EDIT_STATUSES,
];

// Statuses in which a song's lyric video was rendered, so its timing exists for the music-video
// plan; the same list as request_music_video_plan (migration 20261114190001).
export const MUSIC_VIDEO_PLAN_STATUSES: readonly VersionStatus[] = [
  "video_review",
  "approved",
  "publishing",
  "published",
];

export function stageAllowed(status: VersionStatus, stage: Stage): boolean {
  if (stage === "music_video_plan")
    return MUSIC_VIDEO_PLAN_STATUSES.includes(status);
  // A visualizer renders the same chosen take the stems separate (request_visualizer).
  if (stage === "align_lyrics")
    return status === "takes_review" || STEMS_STATUSES.includes(status);
  if (stage === "stems" || stage === "visualizer")
    return STEMS_STATUSES.includes(status);
  if (stage === "replace_section") return REWRITE_STATUSES.includes(status);
  const allowed: Record<VersionStatus, readonly Stage[]> = {
    analysing: ["remake_ingest", "remake_analyse", "remake_rewrite"],
    drafting: ["draft_lyrics"],
    lyrics_review: ["draft_lyrics"],
    song_queued: ["generate_song", "import_audio"],
    takes_review: [],
    audio_ready: [],
    producing: [
      "timing",
      "storyboard",
      "render_master",
      "render_hook",
      "qa",
      "art",
    ],
    video_review: [],
    approved: ["publish", "set_privacy"],
    publishing: ["publish", "set_privacy"],
    published: ["set_privacy"],
    failed: [],
  };
  return allowed[status].includes(stage);
}

export const STAGE_STATUS: Partial<Record<Stage, VersionStatus>> = {
  draft_lyrics: "lyrics_review",
  generate_song: "takes_review",
  import_audio: "audio_ready",
  timing: "producing",
  art: "video_review",
  publish: "approved",
};
export function privacyVersionStatus(privacy: string): VersionStatus {
  return privacy === "public" || privacy === "scheduled"
    ? "published"
    : "approved";
}
