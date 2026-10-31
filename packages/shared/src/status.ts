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

export function stageAllowed(status: VersionStatus, stage: Stage): boolean {
  const allowed: Record<VersionStatus, readonly Stage[]> = {
    drafting: ["draft_lyrics"],
    lyrics_review: ["draft_lyrics"],
    song_queued: ["generate_song"],
    takes_review: ["timing"],
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
  timing: "producing",
  art: "video_review",
  publish: "approved",
};
export function privacyVersionStatus(privacy: string): VersionStatus {
  return privacy === "public" || privacy === "scheduled"
    ? "published"
    : "approved";
}
