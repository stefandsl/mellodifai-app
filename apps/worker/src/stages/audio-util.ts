import { dirname } from "node:path";
import type { StageContext } from "../loop.js";
import { ENGINE_ROOT } from "./utils.js";

const QUIET = ["-hide_banner", "-loglevel", "error", "-y"];

// Collects what a child prints (ffprobe on stdout, ffmpeg's filters on stderr) without logging it.
function quiet(context: StageContext, sink: (line: string) => void) {
  return context.engine.withWorkspace(
    context.ws.root,
    async (line) => sink(line),
    context.signal,
  );
}

export async function probeSeconds(
  context: StageContext,
  file: string,
): Promise<number> {
  let out = "";
  await quiet(context, (line) => {
    out += line;
  }).run(
    "ffprobe",
    [
      "-v",
      "error",
      "-show_entries",
      "format=duration",
      "-of",
      "default=noprint_wrappers=1:nokey=1",
      file,
    ],
    { cwd: dirname(file) },
  );
  const seconds = Number(out.trim());
  return Number.isFinite(seconds) && seconds > 0 ? seconds : 0;
}

// The mean level of a stretch of a file in dB (ffmpeg volumedetect), or null when unreadable.
export async function meanVolume(
  context: StageContext,
  file: string,
  from: number,
  to: number,
): Promise<number | null> {
  let found: number | null = null;
  const read = (line: string) => {
    const match = /mean_volume:\s*(-?[\d.]+) dB/u.exec(line);
    if (match?.[1]) found = Number(match[1]);
  };
  await context.engine
    .withWorkspace(context.ws.root, async (line) => read(line), context.signal)
    .run(
      "ffmpeg",
      [
        "-hide_banner",
        "-nostats",
        "-ss",
        from.toFixed(2),
        "-t",
        Math.max(0.1, to - from).toFixed(2),
        "-i",
        file,
        "-af",
        "volumedetect",
        "-f",
        "null",
        "-",
      ],
      { cwd: ENGINE_ROOT, onStderr: read },
    );
  return found;
}

export async function encode(
  context: StageContext,
  source: string,
  target: string,
  format: "flac" | { mp3: number },
  cut?: { from: number; to: number },
): Promise<void> {
  await context.engine.run(
    "ffmpeg",
    [
      ...QUIET,
      ...(cut
        ? ["-ss", cut.from.toFixed(2), "-t", (cut.to - cut.from).toFixed(2)]
        : []),
      "-i",
      source,
      "-map_metadata",
      "-1",
      "-vn",
      ...(format === "flac"
        ? ["-c:a", "flac"]
        : ["-c:a", "libmp3lame", "-b:a", `${format.mp3}k`]),
      target,
    ],
    { cwd: ENGINE_ROOT, outputs: [target] },
  );
}

export type SpliceOptions = {
  // The part to replace, in seconds of the original.
  start: number;
  end: number;
  duration: number;
  // Where the new audio file starts on the original's clock (the window's start).
  offset: number;
  crossfade: number;
  // Applied to the new audio so it sits at the original's level.
  gainDb: number;
};

// ffmpeg arguments that put [start, end] of `part` (a file whose time 0 is `offset` in the
// original) into `original`, crossfading both seams, the song's length unchanged.
export function spliceArgs(
  original: string,
  part: string,
  target: string,
  options: SpliceOptions,
): string[] {
  const { start, end, duration, offset } = options;
  const half = options.crossfade / 2;
  const fmt = "aresample=48000,aformat=sample_fmts=fltp:channel_layouts=stereo";
  const head = start > options.crossfade;
  const tail = end < duration - options.crossfade;
  const from = Math.max(0, (head ? start - half : 0) - offset);
  const to = Math.max(from + 0.1, (tail ? end + half : duration) - offset);
  const n = (value: number) => value.toFixed(3);
  const filters = [
    `[1:a]${fmt},atrim=${n(from)}:${n(to)},asetpts=PTS-STARTPTS,volume=${options.gainDb.toFixed(2)}dB[mid]`,
  ];
  let current = "mid";
  if (head) {
    filters.push(
      `[0:a]${fmt},atrim=0:${n(start + half)},asetpts=PTS-STARTPTS[head]`,
      `[head][mid]acrossfade=d=${n(options.crossfade)}:c1=tri:c2=tri[hm]`,
    );
    current = "hm";
  }
  if (tail) {
    filters.push(
      `[0:a]${fmt},atrim=${n(end - half)},asetpts=PTS-STARTPTS[tail]`,
      `[${current}][tail]acrossfade=d=${n(options.crossfade)}:c1=tri:c2=tri[out]`,
    );
    current = "out";
  }
  return [
    ...QUIET,
    "-i",
    original,
    "-i",
    part,
    "-filter_complex",
    filters.join(";"),
    "-map",
    `[${current}]`,
    "-c:a",
    "flac",
    target,
  ];
}

export async function splice(
  context: StageContext,
  original: string,
  part: string,
  target: string,
  options: SpliceOptions,
): Promise<void> {
  await context.engine.run(
    "ffmpeg",
    spliceArgs(original, part, target, options),
    {
      cwd: ENGINE_ROOT,
      outputs: [target],
    },
  );
}

// The level difference that brings `part` (over [start, end] of the original's clock) to the
// original's level, within 6 dB; 0 when either cannot be measured.
export async function matchGain(
  context: StageContext,
  original: string,
  part: string,
  start: number,
  end: number,
  offset: number,
): Promise<number> {
  const [a, b] = await Promise.all([
    meanVolume(context, original, start, end),
    meanVolume(context, part, start - offset, end - offset),
  ]);
  if (a === null || b === null) return 0;
  return Math.max(-6, Math.min(6, Math.round((a - b) * 100) / 100));
}
