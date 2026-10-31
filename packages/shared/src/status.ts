import type { Stage } from "./stages.js";

export type JobStatus = "queued" | "running" | "done" | "failed" | "cancelled";

export type VersionStatus =
  | "drafting"
  | "lyrics_review"
  | "song_queued"
  | "takes_review"
  | "producing"
  | "video_review"
  | "approved"
  | "publishing"
  | "published"
  | "failed";

const STATUS_STAGES: Record<VersionStatus, Stage[]> = {
  drafting: ["draft_lyrics"],
  lyrics_review: [],
  song_queued: ["generate_song"],
  takes_review: [],
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
