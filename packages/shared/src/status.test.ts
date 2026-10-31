import { expect, it } from "vitest";

import { nextStages } from "./status.js";

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
