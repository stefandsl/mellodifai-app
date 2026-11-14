// The free stages of the music-video line (rung 1): cut plan, shot list, previz props, the
// black-picture audio wrappers a lip-sync model takes, the assembly with the song master and
// its sync check. Pure planning plus ffmpeg; no paid call, no database.
//
// musicVideoPlanStage is the on-demand job stage music_video_plan (migration 20261114190001).
import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import {
  type CutPlan,
  type CutPlanCheck,
  type CutPlanInput,
  type CutPlanLine,
  checkCutPlan,
  type Lang,
  LyricPackSchema,
  type MvPlan,
  type PlanOptions,
  planCuts,
  planFromShotList,
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
// exactly the segment's frames: the lip-sync model reads a video better than an mp3. The cut
// is on the frame grid (the picture changes there), not on the segment's label in seconds.
export function blackVideoArgs(
  master: string,
  segment: Pick<Segment, "start" | "end" | "startFrame" | "endFrame">,
  out: string,
  fps = 30,
): string[] {
  const frames = segment.endFrame - segment.startFrame;
  const seconds = (frames / fps).toFixed(6);
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
    (segment.startFrame / fps).toFixed(6),
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
    "-frames:v",
    String(frames),
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

// A generated clip made to fit its segment exactly: the segment's frame count from its first
// frame, at the previz's size and rate (letterboxed if the aspect differs), no sound (the master
// is the sound), encoded like the previz clips so the assembly can join them.
export function fitClipArgs(
  input: string,
  frames: number,
  out: string,
  fps = 30,
): string[] {
  const [w, h] = WRAP_SIZE.split("x");
  return [
    "-hide_banner",
    "-loglevel",
    "error",
    "-y",
    "-i",
    input,
    "-an",
    "-vf",
    `fps=${fps},scale=${w}:${h}:force_original_aspect_ratio=decrease,pad=${w}:${h}:(ow-iw)/2:(oh-ih)/2,setsar=1`,
    "-frames:v",
    String(frames),
    "-c:v",
    "libx264",
    "-profile:v",
    "high",
    "-crf",
    "16",
    "-pix_fmt",
    "yuvj420p",
    "-video_track_timescale",
    "90000",
    "-movflags",
    "+faststart",
    out,
  ];
}

// Scene changes of a clip: ffmpeg logs one showinfo line per frame whose scene score passes the
// threshold (read the times with parseSceneCuts from shared).
export const SCENE_THRESHOLD = 0.3;
export function sceneCutArgs(input: string, threshold = SCENE_THRESHOLD) {
  return [
    "-hide_banner",
    "-nostats",
    "-i",
    input,
    "-an",
    "-vf",
    `select='gt(scene,${threshold})',showinfo`,
    "-f",
    "null",
    "-",
  ];
}

// The clips listed in order, each replaced by its generated clip where there is one.
export function withReplacements(
  clips: string[],
  replacements: ReadonlyMap<number, string>,
): string[] {
  for (const index of replacements.keys())
    if (!Number.isInteger(index) || index < 0 || index >= clips.length)
      throw new Error(`no segment ${index} to replace`);
  return clips.map((clip, i) => replacements.get(i) ?? clip);
}

// The previz clips joined with the full song master as the sound. Re-encoding joins clips that
// were encoded apart (generated shots next to previz clips) into one clean stream.
export function assembleArgs(
  list: string,
  master: string,
  out: string,
  options: { reencode?: boolean } = {},
): string[] {
  const video = options.reencode
    ? ["-c:v", "libx264", "-crf", "18", "-pix_fmt", "yuv420p"]
    : ["-c:v", "copy"];
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
    ...video,
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

// The language a video prompt names ("sings exactly these Italian lyrics").
export const LANGUAGE_NAMES: Record<Lang, string> = {
  it: "Italian",
  ru: "Russian",
  ro: "Romanian",
  ja: "Japanese",
  en: "English",
  es: "Spanish",
  de: "German",
  zh: "Chinese",
  pt: "Portuguese",
  ko: "Korean",
  fr: "French",
};

export type Run = (
  command: string,
  args: string[],
  outputs: string[],
) => Promise<unknown>;

// Writes one black-picture wrapper per sung segment into `dir`/audio and returns the plan. The
// cut plan and shot list are kept as the storyboard (storyboardPlan), not as loose files.
export async function writeMusicVideoPlan(
  timing: SongTiming,
  options: { genre: string; master: string; dir: string; run: Run },
) {
  const plan = musicVideoPlan(timing, { genre: options.genre });
  await mkdir(join(options.dir, "audio"), { recursive: true });
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

// The storyboard plan of a planned song.
export function storyboardPlan(
  plan: { cutPlan: CutPlan; shotList: ShotList },
  options: PlanOptions,
): MvPlan {
  return planFromShotList(plan.cutPlan, plan.shotList, options);
}

// On demand on a timed song: the storyboard in the database and the audio wrappers in the
// render folder.
export const musicVideoPlanStage: StageHandler = async (context) => {
  const lang = language(context);
  const timing = await readJson<SongTiming>(
    join(context.ws.publicDir, "data", lang, "timing.json"),
  );
  const pack = LyricPackSchema.parse(context.version.lyric_pack);
  const dir = join(context.ws.renderDir, "music-video");
  const plan = await writeMusicVideoPlan(timing, {
    genre: genreOf(pack.style),
    master: join(context.ws.publicDir, "audio", `${lang}.wav`),
    dir,
    run: (command, args, outputs) =>
      context.engine.run(command, args, { cwd: ENGINE_ROOT, outputs }),
  });
  await context.db.musicVideo.savePlan(
    context.version.id,
    storyboardPlan(plan, {
      title: pack.title.trim() || "Untitled",
      language: LANGUAGE_NAMES[lang],
    }),
  );
  const { check } = plan;
  await context.log(
    `Music video plan: ${check.segments} segments, ${check.minS}-${check.maxS} s, ${check.wordsCut} words cut`,
  );
  return {};
};
