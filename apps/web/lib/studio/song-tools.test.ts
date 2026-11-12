import { Film } from "lucide-react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Clip } from "./clips";
import { registerSongTool, type SongTool, songToolsFor } from "./song-tools";

vi.mock("./reuse-prompt", () => ({ reusePrompt: vi.fn() }));

// A song without takes: none of the audio tools (rewrite, cover, reference) applies.
const clip = {
  id: "a",
  status: "approved",
  takes: [],
  trashedAt: null,
} as unknown as Clip;
const extra = (patch: Partial<SongTool> = {}): SongTool => ({
  id: "video-studio",
  label: "clip.share",
  icon: Film,
  order: 100,
  run: () => {},
  ...patch,
});
const removers: (() => void)[] = [];
afterEach(() => {
  for (const remove of removers.splice(0)) remove();
});

describe("song tools", () => {
  it("starts with only what is built: reusing the prompt", () => {
    expect(songToolsFor(clip).map((tool) => tool.id)).toEqual(["reuse-prompt"]);
  });

  it("shows a feature's tool once it registers, in order, and drops it when removed", () => {
    removers.push(registerSongTool(extra({ id: "late", order: 300 })));
    const remove = registerSongTool(extra({ id: "early", order: 50 }));
    removers.push(remove);
    expect(songToolsFor(clip).map((tool) => tool.id)).toEqual([
      "reuse-prompt",
      "early",
      "late",
    ]);
    remove();
    expect(songToolsFor(clip).map((tool) => tool.id)).toEqual([
      "reuse-prompt",
      "late",
    ]);
  });

  it("hides a tool for songs it does not apply to", () => {
    removers.push(
      registerSongTool(
        extra({
          id: "needs-audio",
          available: (c) => c.status === "audio_ready",
        }),
      ),
    );
    expect(songToolsFor(clip).map((tool) => tool.id)).not.toContain(
      "needs-audio",
    );
    expect(
      songToolsFor({ ...clip, status: "audio_ready" }).map((tool) => tool.id),
    ).toContain("needs-audio");
  });

  it("replaces a tool registered twice under the same id", () => {
    removers.push(registerSongTool(extra({ id: "dup", order: 120 })));
    const second = extra({ id: "dup", order: 110 });
    removers.push(registerSongTool(second));
    expect(songToolsFor(clip).filter((tool) => tool.id === "dup")).toEqual([
      second,
    ]);
  });
});
