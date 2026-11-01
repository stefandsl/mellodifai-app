import { describe, expect, it } from "vitest";

import {
  audible,
  FULL_MIX,
  isFullMix,
  isOnly,
  type Mix,
  only,
  remaining,
  rowPress,
  toggleMute,
  toggleSolo,
} from "./stem-mix";

describe("stem mix", () => {
  it("plays every stem by default and none that is muted", () => {
    expect(audible(FULL_MIX, "vocals")).toBe(true);
    const mix = toggleMute(FULL_MIX, "vocals");
    expect(audible(mix, "vocals")).toBe(false);
    expect(audible(mix, "drums")).toBe(true);
    expect(toggleMute(mix, "vocals")).toEqual(FULL_MIX);
  });

  it("lets solo win: only soloed stems are heard, two at once if asked", () => {
    let mix: Mix = toggleMute(FULL_MIX, "drums");
    mix = toggleSolo(mix, "bass");
    mix = toggleSolo(mix, "drums");
    expect(audible(mix, "bass")).toBe(true);
    expect(audible(mix, "drums")).toBe(true);
    expect(audible(mix, "vocals")).toBe(false);
    expect(audible(mix, "other")).toBe(false);
    expect(isFullMix(mix)).toBe(false);
  });

  it("makes a row's play button play that stem alone, and pause it the second time", () => {
    const first = rowPress(FULL_MIX, false, "drums");
    expect(first).toEqual({ mix: only("drums"), playing: true });
    expect(isOnly(first.mix, "drums")).toBe(true);
    expect(rowPress(first.mix, true, "drums")).toEqual({
      mix: first.mix,
      playing: false,
    });
    // Another row switches to that stem, still playing.
    expect(rowPress(first.mix, true, "bass")).toEqual({
      mix: only("bass"),
      playing: true,
    });
    // Paused on the same stem: play it again.
    expect(rowPress(first.mix, false, "drums").playing).toBe(true);
    // Playing the full mix: the row's button plays its stem alone.
    expect(rowPress(FULL_MIX, true, "vocals")).toEqual({
      mix: only("vocals"),
      playing: true,
    });
  });

  it("estimates the time left once there is enough to go on", () => {
    expect(remaining(5, 50)).toBeNull();
    expect(remaining(30, 5)).toBeNull();
    expect(remaining(30, 100)).toBeNull();
    expect(remaining(30, 25)).toBe(90);
  });
});
