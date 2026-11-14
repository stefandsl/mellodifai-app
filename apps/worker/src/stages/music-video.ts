// The free stages of the music-video line (rung 1): cut plan, shot list, previz props, the
// black-picture audio wrappers a lip-sync model takes, the assembly with the song master and
// its sync check. Pure planning plus ffmpeg; no paid call, no database.
//
// Not yet a registered job stage: a new stage name needs a jobs_stage_check migration (rung 2).
// The handler below runs on a song's workspace once it is registered.
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import {
  type CutPlan,
  type CutPlanCheck,
  type CutPlanInput,
  type CutPlanLine,
  checkCutPlan,
  LyricPackSchema,
  planCuts,
  planShots,
  type Segment,
  type Shot,
  type ShotList,
  type SongSection,
} from "@mellodifai/shared";
import type { StageHandler } from "../loop.js";
import { ENGINE_ROOT, language, readJson } from "./utils.js";

// The timing.json the timing stage writes (beat-this beats and downbeats, word timings,
// sections, a loudness envelope at `fps` values per second).
export type SongTiming = {
  duration: number;
  fps?: number;
  beats?: number[];
  downbeats?: number[];
  energy?: number[];
  sections?: (SongSection & { tag?: string })[];
  lines: CutPlanLine[];
};

export function cutInputFromTiming(timing: SongTiming): CutPlanInput {
  if (!timing.downbeats?.length)
    throw new Error("The song's timing has no downbeats for the cut plan");
  return {
    duration: timing.duration,
    lines: timing.lines,
    sections: (timing.sections ?? []).map(({ name, start, end }) => ({
      name,
      start,
      end,
    })),
    downbeats: timing.downbeats,
    beats: timing.beats ?? [],
  };
}

// The genre words of a Suno style: its first clause ("Italo-disco revival nu-disco, ...").
export function genreOf(style: string): string {
  return (style.split(/[,.;\n]/u)[0] ?? "").trim().slice(0, 80) || "pop";
}

export function musicVideoPlan(
  timing: SongTiming,
  options: { genre: string; fps?: number },
): { cutPlan: CutPlan; shotList: ShotList; check: CutPlanCheck } {
  const input = cutInputFromTiming(timing);
  const cutPlan = planCuts(input, { fps: options.fps ?? 30 });
  const check = checkCutPlan(cutPlan, input);
  if (!check.ok)
    throw new Error(
      `The cut plan failed its check: ${check.reasons.join("; ")}`,
    );
  const shotList = planShots(cutPlan, {
    genre: options.genre,
    ...(timing.energy?.length
      ? { energy: { values: timing.energy, fps: timing.fps ?? 30 } }
      : {}),
  });
  return { cutPlan, shotList, check };
}

// What the Previz composition (packages/visualizer) needs for one shot: beats and words in
// seconds from the start of the shot.
export function previzProps(shot: Shot, timing: SongTiming) {
  const from = shot.start;
  const inShot = (t: number) => t >= shot.start && t < shot.end;
  const words = timing.lines.flatMap((line, lineIndex) =>
    line.words
      .filter((w) => inShot(w.start))
      .map((w) => ({
        text: (w.w ?? w.word ?? "").trim(),
        start: w.start - from,
        end: w.end - from,
        line: lineIndex,
      })),
  );
  return {
    shot,
    frames: shot.endFrame - shot.startFrame,
    beats: (timing.beats ?? []).filter(inShot).map((b) => b - from),
    words,
  };
}

export const WRAP_SIZE = "1280x720";

// ffmpeg arguments that turn a segment of the master into an mp4 with a black picture of
// exactly the segment's length: the lip-sync model reads a video better than an mp3.
export function blackVideoArgs(
  master: string,
  segment: Pick<Segment, "start" | "end">,
  out: string,
  fps = 30,
): string[] {
  const seconds = (segment.end - segment.start).toFixed(6);
  return [
    "-hide_banner",
    "-loglevel",
    "error",
    "-y",
    "-f",
    "lavfi",
    "-i",
    `color=c=black:s=${WRAP_SIZE}:r=${fps}`,
    "-ss",
    segment.start.toFixed(6),
    "-t",
    seconds,
    "-i",
    master,
    "-map",
    "0:v",
    "-map",
    "1:a",
    "-t",
    seconds,
    "-c:v",
    "libx264",
    "-tune",
    "stillimage",
    "-pix_fmt",
    "yuv420p",
    "-c:a",
    "aac",
    "-b:a",
    "192k",
    "-movflags",
    "+faststart",
    out,
  ];
}

export function wrapperName(segment: Pick<Segment, "index">) {
  return `segment-${String(segment.index + 1).padStart(2, "0")}-audio.mp4`;
}

// The concat demuxer list of the previz clips, in order.
export function concatList(files: string[]): string {
  return `${files.map((f) => `file '${f.replace(/\\/gu, "/").replace(/'/gu, "'\\''")}'`).join("\n")}\n`;
}

// The previz clips joined without re-encoding, with the full song master as the sound.
export function assembleArgs(
  list: string,
  master: string,
  out: string,
): string[] {
  return [
    "-hide_banner",
    "-loglevel",
    "error",
    "-y",
    "-f",
    "concat",
    "-safe",
    "0",
    "-i",
    list,
    "-i",
    master,
    "-map",
    "0:v",
    "-map",
    "1:a",
    "-c:v",
    "copy",
    "-c:a",
    "aac",
    "-b:a",
    "256k",
    "-movflags",
    "+faststart",
    out,
  ];
}

export type SyncCheck = {
  ok: boolean;
  fps: number;
  videoFrames: number;
  plannedFrames: number;
  videoSeconds: number;
  audioSeconds: number;
  // Video minus audio, in frames.
  driftFrames: number;
  boundaries: { segment: number; planned: number; actual: number }[];
  reasons: string[];
};

// Video and audio lengths agree within one frame, and each clip starts on its planned frame.
export function syncCheck(
  plan: Pick<CutPlan, "fps" | "frames" | "segments">,
  measured: {
    videoFrames: number;
    videoSeconds: number;
    audioSeconds: number;
    clipFrames: number[];
  },
): SyncCheck {
  const reasons: string[] = [];
  const driftFrames =
    (measured.videoSeconds - measured.audioSeconds) * plan.fps;
  if (Math.abs(driftFrames) > 1)
    reasons.push(
      `video and audio differ by ${driftFrames.toFixed(2)} frames (more than 1)`,
    );
  if (measured.videoFrames !== plan.frames)
    reasons.push(
      `the video has ${measured.videoFrames} frames, the plan ${plan.frames}`,
    );
  if (measured.clipFrames.length !== plan.segments.length)
    reasons.push(
      `${measured.clipFrames.length} clips for ${plan.segments.length} segments`,
    );
  let at = 0;
  const boundaries = plan.segments.map((segment, i) => {
    const row = {
      segment: segment.index,
      planned: segment.startFrame,
      actual: at,
    };
    if (row.actual !== row.planned)
      reasons.push(
        `segment ${segment.index} starts on frame ${row.actual}, planned ${row.planned}`,
      );
    at += measured.clipFrames[i] ?? 0;
    return row;
  });
  return {
    ok: reasons.length === 0,
    fps: plan.fps,
    videoFrames: measured.videoFrames,
    plannedFrames: plan.frames,
    videoSeconds: measured.videoSeconds,
    audioSeconds: measured.audioSeconds,
    driftFrames: Math.round(driftFrames * 1000) / 1000,
    boundaries,
    reasons,
  };
}

export type Run = (
  command: string,
  args: string[],
  outputs: string[],
) => Promise<unknown>;

// Writes cutplan.json, shotlist.json and one black-picture wrapper per sung segment into `dir`.
export async function writeMusicVideoPlan(
  timing: SongTiming,
  options: { genre: string; master: string; dir: string; run: Run },
) {
  const plan = musicVideoPlan(timing, { genre: options.genre });
  await mkdir(join(options.dir, "audio"), { recursive: true });
  await writeFile(
    join(options.dir, "cutplan.json"),
    `${JSON.stringify(plan.cutPlan, null, 2)}\n`,
  );
  await writeFile(
    join(options.dir, "shotlist.json"),
    `${JSON.stringify(plan.shotList, null, 2)}\n`,
  );
  const wrappers: string[] = [];
  for (const segment of plan.cutPlan.segments.filter((s) => s.sung)) {
    const out = join(options.dir, "audio", wrapperName(segment));
    await options.run(
      "ffmpeg",
      blackVideoArgs(options.master, segment, out, plan.cutPlan.fps),
      [out],
    );
    wrappers.push(out);
  }
  return { ...plan, wrappers };
}

// On demand on a timed song: the plan files and the audio wrappers in the render folder.
export const musicVideoPlanStage: StageHandler = async (context) => {
  const lang = language(context);
  const timing = await readJson<SongTiming>(
    join(context.ws.publicDir, "data", lang, "timing.json"),
  );
  const pack = LyricPackSchema.parse(context.version.lyric_pack);
  const dir = join(context.ws.renderDir, "music-video");
  const { check } = await writeMusicVideoPlan(timing, {
    genre: genreOf(pack.style),
    master: join(context.ws.publicDir, "audio", `${lang}.wav`),
    dir,
    run: (command, args, outputs) =>
      context.engine.run(command, args, { cwd: ENGINE_ROOT, outputs }),
  });
  await context.log(
    `Music video plan: ${check.segments} segments, ${check.minS}-${check.maxS} s, ${check.wordsCut} words cut`,
  );
  return {};
};
