import { mkdir, readFile, rm } from "node:fs/promises";
import { join, parse } from "node:path";
import type { Take } from "../db.js";
import type { StageContext, StageHandler } from "../loop.js";
import { workerPaths } from "../paths.js";
import { takeAudio } from "./take-audio.js";
import { ENGINE_ROOT, upload } from "./utils.js";

// The Demucs install and model the timing stage uses (suno-remake tools/workspace_pipeline.sh):
// htdemucs, --shifts=0, on whatever device that venv's torch has (a CPU build on this PC, so the
// separation never competes with ComfyUI for the GPU). Without --two-stems it writes four stems.
export const DEMUCS_PYTHON = workerPaths().stemsPython;
export const DEMUCS_MODEL = "htdemucs";
export const STEM_NAMES = ["vocals", "drums", "bass", "other"] as const;
export type StemName = (typeof STEM_NAMES)[number];
// Stored as MP3: four WAV stems of a 4-minute song would take about 170 MB of the 1 GB bucket.
export const STEM_BITRATE = 192;
// Waveform columns per stem, read from a mono 8 kHz copy.
export const PEAK_COUNT = 600;
const PEAK_RATE = 8000;

export type StemTrack = { path: string; peaks: number[] };
// takes.stems as this stage writes it (migration 20261101000020).
export type StemSet = {
  model: typeof DEMUCS_MODEL;
  format: "mp3";
  bitrate: number;
  duration: number;
  // How long the separation took, for the "Completato in 2:17" line.
  seconds: number;
  created_at: string;
  tracks: Record<StemName, StemTrack>;
};

export function stemsComplete(value: unknown): value is StemSet {
  const tracks =
    value && typeof value === "object"
      ? (value as { tracks?: Record<string, { path?: unknown }> }).tracks
      : undefined;
  return Boolean(
    tracks &&
      STEM_NAMES.every((name) => typeof tracks[name]?.path === "string"),
  );
}

// Peak level (0..1) of `count` equal slices of signed 16-bit mono samples.
export function peaksOf(samples: Int16Array, count = PEAK_COUNT): number[] {
  if (samples.length === 0) return Array.from({ length: count }, () => 0);
  const peaks: number[] = [];
  for (let i = 0; i < count; i++) {
    const start = Math.floor((i * samples.length) / count);
    const end = Math.max(
      start + 1,
      Math.floor(((i + 1) * samples.length) / count),
    );
    let max = 0;
    for (let j = start; j < end && j < samples.length; j++) {
      const v = Math.abs(samples[j] ?? 0);
      if (v > max) max = v;
    }
    peaks.push(Math.round(Math.min(1, max / 32768) * 1000) / 1000);
  }
  return peaks;
}

// tqdm writes " 45%|####      | 87.8/195.0 [00:12<00:14, 7.28seconds/s]".
export function demucsPercent(line: string): number | null {
  const found = /(\d{1,3})%\|/u.exec(line);
  if (!found) return null;
  const pct = Number(found[1]);
  return pct >= 0 && pct <= 100 ? pct : null;
}

function wanted(context: StageContext, takes: Take[]): Take {
  const payload = (context.job.payload ?? {}) as { take_id?: unknown };
  const id =
    typeof payload.take_id === "string"
      ? payload.take_id
      : context.version.chosen_take_id;
  const take = takes.find((item) => item.id === id);
  if (!id || !take) throw new Error("La versione da separare non esiste più");
  return take;
}

export const stems: StageHandler = async (context) => {
  const take = wanted(context, await context.db.getTakes(context.version.id));
  if (stemsComplete(take.stems)) {
    await context.log("Stems già pronti per questa versione");
    return {};
  }
  const started = Date.now();
  const dir = join(context.ws.root, "stems", "separate", take.id);
  await rm(dir, { recursive: true, force: true });
  await mkdir(dir, { recursive: true });
  try {
    await context.progress(2, "Stems: preparo l'audio");
    const source = await takeAudio(context, take, dir);
    // Demucs reports progress many times a second: keep those lines out of the job log and turn
    // them into a progress event every few seconds instead.
    const engine = context.engine.withWorkspace(
      context.ws.root,
      async (line) => {
        if (demucsPercent(line) === null) await context.log(line);
      },
      context.signal,
    );
    let reported = -1;
    let reportedAt = 0;
    let pending = Promise.resolve();
    // Engine.run throws on a non-zero exit, with the last lines of the output.
    await engine.run(
      DEMUCS_PYTHON,
      [
        "-I",
        "-m",
        "demucs",
        "-n",
        DEMUCS_MODEL,
        "--shifts=0",
        "-o",
        dir,
        source,
      ],
      {
        cwd: ENGINE_ROOT,
        onStderr: (line) => {
          const pct = demucsPercent(line);
          if (pct === null) return;
          const now = Date.now();
          if (pct === reported || (now - reportedAt < 2000 && pct < 100))
            return;
          reported = pct;
          reportedAt = now;
          // 5..85: separating; the rest is encoding and uploading.
          const overall = Math.round(5 + pct * 0.8);
          pending = pending.then(() =>
            context
              .progress(overall, `Stems: separazione ${pct}%`)
              .catch(() => {}),
          );
        },
      },
    );
    await pending;
    const separated = join(dir, DEMUCS_MODEL, parse(source).name);
    const tracks = {} as Record<StemName, StemTrack>;
    let duration = 0;
    for (const [i, name] of STEM_NAMES.entries()) {
      context.signal.throwIfAborted();
      const wav = join(separated, `${name}.wav`);
      const mp3 = join(dir, `stems-${take.id}-${name}.mp3`);
      const raw = join(dir, `${name}.s16`);
      await context.engine.run(
        "ffmpeg",
        [
          "-hide_banner",
          "-loglevel",
          "error",
          "-y",
          "-i",
          wav,
          "-map_metadata",
          "-1",
          "-c:a",
          "libmp3lame",
          "-b:a",
          `${STEM_BITRATE}k`,
          mp3,
        ],
        { cwd: ENGINE_ROOT, outputs: [mp3] },
      );
      await context.engine.run(
        "ffmpeg",
        [
          "-hide_banner",
          "-loglevel",
          "error",
          "-y",
          "-i",
          wav,
          "-ac",
          "1",
          "-ar",
          String(PEAK_RATE),
          "-f",
          "s16le",
          raw,
        ],
        { cwd: ENGINE_ROOT, outputs: [raw] },
      );
      const bytes = await readFile(raw);
      const samples = new Int16Array(
        bytes.buffer,
        bytes.byteOffset,
        Math.floor(bytes.byteLength / 2),
      );
      duration = Math.max(duration, samples.length / PEAK_RATE);
      tracks[name] = {
        path: await upload(context, mp3, "audio/mpeg"),
        peaks: peaksOf(samples),
      };
      await context.progress(
        Math.round(85 + ((i + 1) * 15) / STEM_NAMES.length) - 1,
        `Stems: ${name} pronto`,
      );
    }
    const set: StemSet = {
      model: DEMUCS_MODEL,
      format: "mp3",
      bitrate: STEM_BITRATE,
      duration: Math.round(duration * 100) / 100,
      seconds: Math.round((Date.now() - started) / 100) / 10,
      created_at: new Date().toISOString(),
      tracks,
    };
    await context.db.patchTake(take.id, { stems: set });
    await context.progress(100, "Stems pronti");
    return {};
  } finally {
    // The WAV files are about 50 MB per stem; the stored MP3s are what the studio plays.
    await rm(dir, { recursive: true, force: true }).catch(() => {});
  }
};
