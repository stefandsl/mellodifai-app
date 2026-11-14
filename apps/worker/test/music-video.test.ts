import { execFileSync, spawnSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  CutPlanSchema,
  parseSceneCuts,
  ShotListSchema,
} from "@mellodifai/shared";
import { afterEach, describe, expect, it } from "vitest";
import type { StageContext } from "../src/loop.js";
import {
  assembleArgs,
  blackVideoArgs,
  concatList,
  cutInputFromTiming,
  fitClipArgs,
  genreOf,
  musicVideoPlan,
  musicVideoPlanStage,
  previzProps,
  type SongTiming,
  sceneCutArgs,
  syncCheck,
  withReplacements,
  writeMusicVideoPlan,
} from "../src/stages/music-video.js";

const roots: string[] = [];
afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});

async function scratch() {
  const base =
    process.platform === "win32" ? "E:/mellodifai/runtime/tmp" : tmpdir();
  await mkdir(base, { recursive: true });
  const root = await mkdtemp(join(base, "music-video-tests-"));
  roots.push(root);
  return root;
}

// 40 s at 120 BPM: 8 s of intro, then two-bar lines of three words, then a quiet ending.
function timing(): SongTiming {
  const beats = Array.from({ length: 80 }, (_, i) => i * 0.5);
  const lines = [];
  for (let t = 8; t < 32; t += 4)
    lines.push({
      section: t < 20 ? "Verse 1" : "Chorus",
      text: `a${t} b${t} c${t}`,
      words: [
        { w: `a${t}`, start: t + 0.05, end: t + 0.9 },
        { w: `b${t}`, start: t + 1.0, end: t + 1.9 },
        { w: `c${t}`, start: t + 2.1, end: t + 3.3 },
      ],
    });
  return {
    duration: 40,
    fps: 10,
    beats,
    downbeats: beats.filter((_, i) => i % 4 === 0),
    energy: Array.from({ length: 400 }, (_, i) =>
      i >= 200 && i < 320 ? 0.9 : 0.2,
    ),
    sections: [
      { name: "Intro", start: 0, end: 8 },
      { name: "Verse 1", start: 8, end: 20 },
      { name: "Chorus", start: 20, end: 32 },
      { name: "Outro", start: 32, end: 40 },
    ],
    lines,
  };
}

function ffprobe(file: string, entries: string, stream?: string): string {
  return execFileSync(
    "ffprobe",
    [
      "-v",
      "error",
      ...(stream ? ["-select_streams", stream] : []),
      "-count_packets",
      "-show_entries",
      entries,
      "-of",
      "default=noprint_wrappers=1:nokey=1",
      file,
    ],
    { encoding: "utf8", windowsHide: true },
  )
    .trim()
    .replace(/\r\n/gu, "\n");
}

describe("music video plan", () => {
  it("plans valid cut and shot lists from a timing file", () => {
    const { cutPlan, shotList, check } = musicVideoPlan(timing(), {
      genre: "nu-disco",
    });
    expect(CutPlanSchema.parse(cutPlan)).toEqual(cutPlan);
    expect(ShotListSchema.parse(shotList)).toEqual(shotList);
    expect(check.ok).toBe(true);
    expect(check.wordsCut).toBe(0);
    expect(shotList.shots).toHaveLength(cutPlan.segments.length);
    expect(cutPlan.segments.some((s) => !s.sung)).toBe(true);
  });

  it("needs downbeats and reads the genre from the style", () => {
    expect(() => cutInputFromTiming({ ...timing(), downbeats: [] })).toThrow(
      /downbeats/u,
    );
    expect(genreOf("Italo-disco revival nu-disco, Italian female lead")).toBe(
      "Italo-disco revival nu-disco",
    );
    expect(genreOf("")).toBe("pop");
  });

  it("gives the previz beats and words relative to the shot", () => {
    const t = timing();
    const { shotList } = musicVideoPlan(t, { genre: "nu-disco" });
    const sung = shotList.shots.find((s) => s.kind !== "instrumental-broll");
    if (!sung) throw new Error("no sung shot");
    const props = previzProps(sung, t);
    expect(props.frames).toBe(sung.endFrame - sung.startFrame);
    expect(props.words.length).toBeGreaterThan(0);
    for (const w of props.words) {
      expect(w.start).toBeGreaterThanOrEqual(0);
      expect(w.end).toBeLessThanOrEqual(sung.end - sung.start);
    }
    expect(props.words.map((w) => w.text).join(" ")).toBe(
      sung.lyrics.replace(/\n/gu, " "),
    );
    expect(props.beats.every((b) => b >= 0 && b < sung.end - sung.start)).toBe(
      true,
    );
  });

  it("wraps each sung segment as a black video of exactly its length", async () => {
    const root = await scratch();
    const master = join(root, "master.wav");
    execFileSync(
      "ffmpeg",
      [
        "-v",
        "error",
        "-y",
        "-f",
        "lavfi",
        "-i",
        "sine=frequency=440:sample_rate=44100:duration=40",
        master,
      ],
      { windowsHide: true },
    );
    const dir = join(root, "plan");
    const result = await writeMusicVideoPlan(timing(), {
      genre: "nu-disco",
      master,
      dir,
      run: async (command, args) =>
        execFileSync(command, args, { windowsHide: true }),
    });
    const sung = result.cutPlan.segments.filter((s) => s.sung);
    expect(result.wrappers).toHaveLength(sung.length);
    for (const [i, file] of result.wrappers.entries()) {
      const segment = sung[i];
      if (!segment) throw new Error("missing segment");
      const video = Number(ffprobe(file, "stream=duration", "v:0"));
      const audio = Number(ffprobe(file, "stream=duration", "a:0"));
      const frames = Number(ffprobe(file, "stream=nb_read_packets", "v:0"));
      expect(Math.abs(video - segment.duration)).toBeLessThanOrEqual(1 / 30);
      expect(Math.abs(audio - segment.duration)).toBeLessThanOrEqual(1 / 30);
      expect(frames).toBe(Math.round(segment.duration * 30));
      expect(ffprobe(file, "stream=width,height", "v:0")).toBe("1280\n720");
    }
    const saved = JSON.parse(await readFile(join(dir, "cutplan.json"), "utf8"));
    expect(saved).toEqual(result.cutPlan);
  }, 60_000);

  it("cuts the wrapper on the segment's frames, not its time in seconds", () => {
    // Rung 1's segment 7: 74.94-84.29 s, frames 2248-2529 (74.9333-84.3 s, 281 frames). The
    // wrapper made from the seconds was 280 frames long.
    const args = blackVideoArgs(
      "m.wav",
      { start: 74.94, end: 84.29, startFrame: 2248, endFrame: 2529 },
      "o.mp4",
    );
    expect(args[args.indexOf("-ss") + 1]).toBe("74.933333");
    expect(args[args.indexOf("-t") + 1]).toBe("9.366667");
    expect(args[args.indexOf("-frames:v") + 1]).toBe("281");
  });

  it("builds ffmpeg arguments for the wrapper and the assembly", () => {
    const args = blackVideoArgs(
      "m.wav",
      { start: 12.5, end: 24.25, startFrame: 375, endFrame: 728 },
      "o.mp4",
    );
    expect(args[args.indexOf("-ss") + 1]).toBe("12.500000");
    expect(args.filter((a) => a === "-t")).toHaveLength(2);
    expect(args[args.indexOf("-t") + 1]).toBe("11.766667");
    expect(args).toContain("color=c=black:s=1280x720:r=30");
    expect(args.at(-1)).toBe("o.mp4");
    const assemble = assembleArgs("list.txt", "m.wav", "out.mp4");
    expect(
      assemble.slice(assemble.indexOf("-f"), assemble.indexOf("-f") + 2),
    ).toEqual(["-f", "concat"]);
    expect(assemble).toContain("copy");
    expect(concatList(["C:\\a\\it's.mp4", "b.mp4"])).toBe(
      "file 'C:/a/it'\\''s.mp4'\nfile 'b.mp4'\n",
    );
  });
});

describe("sync check", () => {
  const plan = {
    fps: 30,
    frames: 900,
    segments: [
      { index: 0, startFrame: 0 },
      { index: 1, startFrame: 360 },
      { index: 2, startFrame: 600 },
    ],
  } as unknown as Parameters<typeof syncCheck>[0];

  it("passes when lengths agree within a frame and clips land on their frames", () => {
    const check = syncCheck(plan, {
      videoFrames: 900,
      videoSeconds: 30,
      audioSeconds: 30.02,
      clipFrames: [360, 240, 300],
    });
    expect(check.reasons).toEqual([]);
    expect(check.ok).toBe(true);
    expect(check.boundaries.map((b) => b.actual)).toEqual([0, 360, 600]);
  });

  it("fails on drift over a frame and on a clip one frame short", () => {
    const drift = syncCheck(plan, {
      videoFrames: 900,
      videoSeconds: 30,
      audioSeconds: 30.05,
      clipFrames: [360, 240, 300],
    });
    expect(drift.ok).toBe(false);
    const short = syncCheck(plan, {
      videoFrames: 899,
      videoSeconds: 29.967,
      audioSeconds: 29.967,
      clipFrames: [359, 240, 300],
    });
    expect(short.ok).toBe(false);
    expect(short.reasons.join(" ")).toMatch(/segment 1 starts on frame 359/u);
  });
});

describe("music video plan stage", () => {
  it("writes the plan into the render folder and wraps sung audio with ffmpeg", async () => {
    const root = await scratch();
    const ws = {
      root,
      versionsDir: join(root, "versions", "it"),
      outDir: join(root, "out", "it"),
      publicDir: join(root, "public"),
      renderDir: join(root, "render", "1"),
    };
    await mkdir(join(ws.publicDir, "data", "it"), { recursive: true });
    await writeFile(
      join(ws.publicDir, "data", "it", "timing.json"),
      JSON.stringify(timing()),
    );
    const calls: { command: string; args: string[] }[] = [];
    const logs: string[] = [];
    const context = {
      ws,
      version: {
        lang: "it",
        lyric_pack: {
          title: "Prova",
          lyrics: "",
          style: "Italo-disco revival nu-disco, warm alto",
          exclude: "",
          settings: { model: "V5" },
          displayMap: {},
          l10n: {},
        },
      },
      engine: {
        run: async (command: string, args: string[]) => {
          calls.push({ command, args });
          return { code: 0 };
        },
      },
      log: async (line: string) => {
        logs.push(line);
      },
    } as unknown as StageContext;
    await expect(musicVideoPlanStage(context)).resolves.toEqual({});
    const shots = ShotListSchema.parse(
      JSON.parse(
        await readFile(
          join(ws.renderDir, "music-video", "shotlist.json"),
          "utf8",
        ),
      ),
    );
    expect(shots.genre).toBe("Italo-disco revival nu-disco");
    const sung = shots.shots.filter((s) => s.kind !== "instrumental-broll");
    expect(calls).toHaveLength(sung.length);
    expect(calls.every((c) => c.command === "ffmpeg")).toBe(true);
    expect(calls[0]?.args).toContain(join(ws.publicDir, "audio", "it.wav"));
    expect(logs[0]).toMatch(/0 words cut/u);
  });
});

describe("generated shots in the edit", () => {
  function make(file: string, filter: string, seconds: number, size: string) {
    execFileSync(
      "ffmpeg",
      [
        "-v",
        "error",
        "-y",
        "-f",
        "lavfi",
        "-i",
        `${filter}${filter.includes("=") ? ":" : "="}s=${size}:r=24:d=${seconds}`,
        "-f",
        "lavfi",
        "-i",
        `sine=frequency=330:duration=${seconds}`,
        "-shortest",
        "-c:v",
        "libx264",
        "-pix_fmt",
        "yuv420p",
        file,
      ],
      { windowsHide: true },
    );
  }

  it("fits a 24 fps 480p draft to the segment's frames at 1280x720, 30 fps, silent", async () => {
    const root = await scratch();
    const draft = join(root, "draft.mp4");
    make(draft, "testsrc2", 12, "854x480");
    const out = join(root, "fit.mp4");
    execFileSync("ffmpeg", fitClipArgs(draft, 351, out), { windowsHide: true });
    expect(ffprobe(out, "stream=nb_read_packets", "v:0")).toBe("351");
    expect(ffprobe(out, "stream=width,height", "v:0")).toBe("1280\n720");
    expect(ffprobe(out, "stream=r_frame_rate", "v:0")).toBe("30/1");
    expect(ffprobe(out, "stream=index")).toBe("0");
  }, 60_000);

  it("counts no scene change in one shot and each cut in a cut clip", async () => {
    const root = await scratch();
    const one = join(root, "one.mp4");
    make(one, "testsrc2", 4, "640x360");
    const parts = ["red", "blue", "green"].map((c, i) => {
      const f = join(root, `${c}.mp4`);
      make(f, i % 2 ? "testsrc" : `color=c=${c}`, 1.5, "640x360");
      return f;
    });
    const list = join(root, "list.txt");
    await writeFile(list, concatList(parts));
    const cut = join(root, "cut.mp4");
    execFileSync(
      "ffmpeg",
      [
        "-v",
        "error",
        "-y",
        "-f",
        "concat",
        "-safe",
        "0",
        "-i",
        list,
        "-c",
        "copy",
        cut,
      ],
      { windowsHide: true },
    );
    const cuts = (file: string) =>
      parseSceneCuts(
        String(
          spawnSync("ffmpeg", sceneCutArgs(file), {
            encoding: "utf8",
            windowsHide: true,
          }).stderr,
        ),
      );
    expect(cuts(one)).toEqual([]);
    expect(cuts(cut)).toHaveLength(2);
  }, 60_000);

  it("replaces only the chosen segments and re-encodes the join on request", () => {
    expect(withReplacements(["a", "b", "c"], new Map([[1, "B"]]))).toEqual([
      "a",
      "B",
      "c",
    ]);
    expect(() => withReplacements(["a"], new Map([[3, "x"]]))).toThrow(
      /no segment 3/u,
    );
    const args = assembleArgs("l.txt", "m.wav", "o.mp4", { reencode: true });
    expect(args).toContain("libx264");
    expect(args).not.toContain("copy");
  });
});
