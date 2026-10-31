import { expect, it } from "vitest";

import { nextStages, stageAllowed } from "./status.js";

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
