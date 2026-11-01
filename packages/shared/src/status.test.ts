import { expect, it } from "vitest";

import { isOnDemandStage, STAGES } from "./stages.js";
import {
  EDIT_STATUSES,
  nextStages,
  STAGE_STATUS,
  STEMS_STATUSES,
  stageAllowed,
} from "./status.js";

it("requires a committed pick before timing can run", () => {
  expect(stageAllowed("takes_review", "timing")).toBe(false);
  expect(stageAllowed("producing", "timing")).toBe(true);
});

it("returns the producing stages in pipeline order", () => {
  expect(nextStages("producing")).toEqual([
    "timing",
    "storyboard",
    "render_master",
    "render_hook",
    "qa",
    "art",
  ]);
});

it("allows stems only where the song has a chosen take, and never changes the status", () => {
  for (const status of STEMS_STATUSES)
    expect(stageAllowed(status, "stems")).toBe(true);
  for (const status of [
    "drafting",
    "lyrics_review",
    "song_queued",
    "takes_review",
    "failed",
  ] as const)
    expect(stageAllowed(status, "stems")).toBe(false);
  expect(STAGE_STATUS.stems).toBeUndefined();
  expect(isOnDemandStage("stems")).toBe(true);
  expect(isOnDemandStage("timing")).toBe(false);
  expect(STAGES).toContain("stems");
  // stems is never part of a pipeline step.
  for (const status of STEMS_STATUSES)
    expect(nextStages(status)).not.toContain("stems");
});

it("allows an edit only in statuses where the song is not being produced", () => {
  expect([...EDIT_STATUSES]).toEqual([
    "audio_ready",
    "video_review",
    "approved",
    "published",
  ]);
  for (const status of EDIT_STATUSES) expect(STEMS_STATUSES).toContain(status);
});
