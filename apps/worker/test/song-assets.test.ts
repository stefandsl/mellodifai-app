import { spawnSync } from "node:child_process";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { runtimeRoot } from "@mellodifai/remake";
import { afterEach, expect, it } from "vitest";
import { songStoryboard } from "../src/stages/storyboard.js";
import { WorkspaceFactory } from "../src/workspace.js";

const roots: string[] = [];
afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});

it("builds each song's scenes from its own timed lines, title, language and mood", () => {
  const timing = {
    duration: 12,
    lines: [
      {
        section: "Verse",
        text: "Luce sul porto",
        words: [{ start: 0.5, end: 2 }],
      },
      {
        section: "Chorus",
        text: "Ritorna il sole",
        words: [{ start: 6, end: 8 }],
      },
    ],
  };
  const first = songStoryboard(timing, "Luce sul porto", "it", "triste");
  const second = songStoryboard(
    {
      ...timing,
      lines: timing.lines.map((line) => ({
        ...line,
        text: "Pioggia di novembre",
      })),
    },
    "Pioggia di novembre",
    "fr",
    "energica",
  );
  expect(first.storyboard).toMatchObject({
    title: "Luce sul porto",
    lang: "it",
    shots: [
      { lines: [0], start: 0, end: 6, mood: "ink" },
      { lines: [1], start: 6, end: 12, mood: "ink" },
    ],
  });
  expect(second.storyboard).toMatchObject({
    title: "Pioggia di novembre",
    lang: "fr",
    shots: [{ mood: "alert" }, { mood: "alert" }],
  });
  expect(first.storyboard).not.toEqual(second.storyboard);
  expect(JSON.stringify(first.storyboard)).not.toMatch(
    /AIMELODIA|STEFANDSL|OKBOT/u,
  );
  expect(first.sections).toEqual([
    { title: "Verse", start: 0, shots: [{ start: 0, text: "Luce sul porto" }] },
    {
      title: "Chorus",
      start: 6,
      shots: [{ start: 6, text: "Ritorna il sole" }],
    },
  ]);
});

it("keeps local render artifacts separate across attempts", async () => {
  const scratch = join(runtimeRoot(), "tmp");
  await mkdir(scratch, { recursive: true });
  const root = await mkdtemp(join(scratch, "song-assets-"));
  roots.push(root);
  const previous = process.env.WORKER_FAKE;
  process.env.WORKER_FAKE = "1";
  try {
    const factory = new WorkspaceFactory(root);
    const first = await factory.forVersion("project", "it", false, 1);
    const second = await factory.forVersion("project", "it", false, 2);
    expect(first.renderDir).not.toBe(second.renderDir);
    expect(first.versionsDir).toBe(second.versionsDir);
  } finally {
    if (previous === undefined) delete process.env.WORKER_FAKE;
    else process.env.WORKER_FAKE = previous;
  }
});

it("keeps thumbnail text readable, contrasted and inside the 90 percent safe box at 320 px", () => {
  const script = fileURLToPath(
    new URL("../src/stages/thumbnail.py", import.meta.url),
  );
  for (const title of [
    "Luce sul porto",
    "Pioggia di novembre",
    "A very long song title about the dawn after the last autumn storm",
    "Tokyo 東京 😀",
    "Voice 👩‍🎤",
    "--Night",
  ]) {
    const output = spawnSync(
      "python",
      [script, `--title=${title}`, "--lang", "en", "--check"],
      { encoding: "utf8" },
    );
    expect(output.status, output.stderr).toBe(0);
    const plan = JSON.parse(output.stdout) as {
      size: number;
      bounds: number[];
      contrast: number;
      fonts: string[];
    };
    expect(plan.size / 4).toBeGreaterThanOrEqual(16);
    expect(plan.contrast).toBeGreaterThanOrEqual(4.5);
    expect(plan.bounds[0]).toBeGreaterThanOrEqual(64);
    expect(plan.bounds[1]).toBeGreaterThanOrEqual(36);
    expect(plan.bounds[2]).toBeLessThanOrEqual(1216);
    expect(plan.bounds[3]).toBeLessThanOrEqual(684);
    if (title === "Tokyo 東京 😀") {
      expect(plan.fonts).toContain("meiryob.ttc");
      expect(plan.fonts).toContain("seguiemj.ttf");
    }
    if (title === "Voice 👩‍🎤") expect(plan.fonts).toContain("seguiemj.ttf");
  }
});

it("rejects thumbnail characters without a real glyph", () => {
  const script = fileURLToPath(
    new URL("../src/stages/thumbnail.py", import.meta.url),
  );
  const output = spawnSync(
    "python",
    [script, "--title=Unknown \u{10fffd}", "--lang", "en", "--check"],
    { encoding: "utf8" },
  );
  expect(output.status).not.toBe(0);
  expect(output.stderr).toContain("No thumbnail font covers U+10FFFD");
});
