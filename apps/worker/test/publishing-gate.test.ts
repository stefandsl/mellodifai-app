import { afterEach, describe, expect, it, vi } from "vitest";
import type { StageContext } from "../src/loop.js";
import { startPublishing } from "../src/main.js";
import type { DispatchDb } from "../src/publishing/dispatcher.js";
import {
  PUBLISHING_OFF,
  publishingOn,
  withPublishingGate,
} from "../src/publishing/gate.js";
import { FakeYouTubeClient } from "../src/publishing/youtube.js";
import { stages } from "../src/stages/index.js";

describe("publishing switched off (desktop app without its own engine)", () => {
  afterEach(() => vi.useRealTimers());

  it("reads WORKER_PUBLISHING=off and nothing else as off", () => {
    expect(publishingOn({ WORKER_PUBLISHING: "off" })).toBe(false);
    expect(publishingOn({})).toBe(true);
    expect(publishingOn({ WORKER_PUBLISHING: "on" })).toBe(true);
  });

  it("fails the upload and privacy stages at once, before any engine or YouTube call", async () => {
    const run = vi.fn();
    const context = {
      engine: { run, withWorkspace: () => ({ run }) },
    } as unknown as StageContext;
    const gated = withPublishingGate(stages, false);
    await expect(gated.publish?.(context)).rejects.toThrow(PUBLISHING_OFF);
    await expect(gated.set_privacy?.(context)).rejects.toThrow(PUBLISHING_OFF);
    expect(run).not.toHaveBeenCalled();
    // Every other stage is the real one.
    expect(gated.draft_lyrics).toBe(stages.draft_lyrics);
    expect(withPublishingGate(stages, true)).toBe(stages);
  });

  it("never runs the publishing clock", async () => {
    vi.useFakeTimers();
    const touched: string[] = [];
    const db = new Proxy(
      {},
      {
        get: (_, name) => {
          touched.push(String(name));
          return async () => [];
        },
      },
    ) as DispatchDb;
    const youtube = new FakeYouTubeClient();
    const lines: string[] = [];
    const stop = startPublishing({
      db,
      youtube,
      workerId: "w",
      loop: { healthy: () => true },
      report: (line) => lines.push(line),
      intervalMs: 1000,
      enabled: false,
    });
    await vi.advanceTimersByTimeAsync(5000);
    stop();
    expect(touched).toEqual([]);
    expect(youtube.calls).toEqual([]);
    expect(lines.join("\n")).toContain("publishing off");
  });
});
