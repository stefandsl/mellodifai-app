// R1: download a YouTube video's audio, a low-res video, captions and metadata, for
// analysis only (the media is never re-published nor given to a generator). Then a
// transcript (captions, else Whisper through Groq), scene-cut frames and 1 fps contact
// sheets (the /watch skill method). Every step is cached in the output folder.
import { existsSync } from "node:fs";
import { mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import {
  type IngestManifest,
  IngestManifestSchema,
  MAX_SCENE_FRAMES,
  type Transcript,
  youtubeVideoId,
} from "@mellodifai/shared";
import { parseVtt, type TimedWord, wordsToLines } from "./align.js";
import type { Env } from "./env.js";
import { checkMetadata, classifyYtDlp, RemakeError } from "./errors.js";
import { ENGINE_ROOT, PYTHON, remakesRoot } from "./paths.js";
import { run as defaultRun, type Run, runChecked } from "./run.js";
import { capFrames, SHEET } from "./shots.js";

// suno-remake tools/whisper_words.py supports these Whisper language codes.
const WHISPER_LANGS = new Set([
  "it",
  "ru",
  "ro",
  "ja",
  "en",
  "es",
  "de",
  "zh",
  "pt",
  "ko",
  "fr",
]);
const FONT = "C\\:/Windows/Fonts/consola.ttf";

const slash = (path: string) => path.replaceAll("\\", "/");

// The shared parser (the studio validates links with the same function).
export function parseVideoId(url: string): string | null {
  return youtubeVideoId(url);
}

type Info = {
  id?: string;
  title?: string;
  uploader?: string;
  channel?: string;
  artist?: string;
  creator?: string;
  track?: string;
  duration?: number;
  age_limit?: number;
  availability?: string | null;
  is_live?: boolean;
  live_status?: string | null;
  license?: string;
  language?: string;
  tags?: string[];
  description?: string;
  webpage_url?: string;
  subtitles?: Record<string, unknown>;
  automatic_captions?: Record<string, unknown>;
};

export function pickCaptions(
  info: Info,
  language: string,
): { lang: string; auto: boolean } | null {
  const manual = Object.keys(info.subtitles ?? {}).filter(
    (k) => k !== "live_chat",
  );
  const same = (k: string) => k === language || k.startsWith(`${language}-`);
  const m = manual.find(same) ?? manual[0];
  if (m) return { lang: m, auto: false };
  // Auto captions in other languages are machine translations: only the original is useful.
  const auto = Object.keys(info.automatic_captions ?? {});
  const a =
    auto.find((k) => k === `${language}-orig`) ??
    auto.find((k) => k === language);
  return a ? { lang: a, auto: true } : null;
}

export function parseShowinfo(stderr: string): number[] {
  return [...stderr.matchAll(/pts_time:\s*([0-9.]+)/gu)].map(
    (m) => Math.round(Number(m[1]) * 1000) / 1000,
  );
}

export type IngestOptions = {
  outRoot?: string;
  sourceLang?: string;
  engineRoot?: string;
  python?: string;
  sceneThreshold?: number;
  force?: boolean;
  env: Env;
  run?: Run;
  log?: (line: string) => void;
};

async function findFile(
  dir: string,
  prefix: string,
  exts: string[],
): Promise<string | null> {
  const files = await readdir(dir).catch(() => [] as string[]);
  for (const ext of exts) {
    const f = files.find(
      (x) => x.startsWith(prefix) && x.toLowerCase().endsWith(ext),
    );
    if (f) return join(dir, f);
  }
  return null;
}

export async function ingest(
  url: string,
  options: IngestOptions,
): Promise<IngestManifest> {
  const runner = options.run ?? defaultRun;
  const log = options.log ?? (() => {});
  const videoId = parseVideoId(url);
  if (!videoId) throw new Error(`not a YouTube video link: ${url}`);
  const canonical = `https://www.youtube.com/watch?v=${videoId}`;
  const dir = join(options.outRoot ?? remakesRoot(), videoId).replaceAll(
    "\\",
    "/",
  );
  await mkdir(join(dir, "frames"), { recursive: true });
  await mkdir(join(dir, "sheets"), { recursive: true });
  const ytdlp = (args: string[], what: string) =>
    runChecked(
      runner,
      "yt-dlp",
      [
        "--js-runtimes",
        "node",
        "--no-playlist",
        "--no-progress",
        ...args,
        canonical,
      ],
      {
        what,
        timeoutMs: 15 * 60_000,
        redact: options.env.redact,
      },
    );
  const fresh = (path: string) => options.force || !existsSync(path);

  const infoPath = join(dir, "source.info.json");
  if (fresh(infoPath)) {
    log("ingest: metadata");
    try {
      await ytdlp(
        [
          "--skip-download",
          "--write-info-json",
          "-o",
          join(dir, "source.%(ext)s"),
        ],
        "yt-dlp metadata",
      );
    } catch (error) {
      // A private, age-gated or removed video: a reason the person can act on.
      const message = error instanceof Error ? error.message : String(error);
      const code = classifyYtDlp(message);
      if (code) throw new RemakeError(code, message);
      throw error;
    }
  }
  const info = JSON.parse(await readFile(infoPath, "utf8")) as Info;
  // Before any media is downloaded: private, age-restricted, live or too long.
  checkMetadata(info);
  const language =
    (options.sourceLang ?? info.language ?? "en").split("-")[0] ?? "en";

  let captions = await findFile(dir, "source.", [".vtt"]);
  const pick = pickCaptions(info, language);
  if ((options.force || !captions) && pick) {
    log(`ingest: captions (${pick.lang}${pick.auto ? ", auto" : ""})`);
    await ytdlp(
      [
        "--skip-download",
        pick.auto ? "--write-auto-subs" : "--write-subs",
        "--sub-langs",
        pick.lang,
        "--sub-format",
        "vtt",
        "-o",
        join(dir, "source.%(ext)s"),
      ],
      "yt-dlp captions",
    );
    captions = await findFile(dir, "source.", [".vtt"]);
  }

  const audio = join(dir, "audio.wav");
  if (fresh(audio)) {
    log("ingest: audio");
    await ytdlp(
      [
        "-f",
        "bestaudio/best",
        "-x",
        "--audio-format",
        "wav",
        "-o",
        join(dir, "audio.%(ext)s"),
      ],
      "yt-dlp audio",
    );
  }
  let video = await findFile(dir, "video.", [".mp4", ".webm", ".mkv"]);
  if (options.force || !video) {
    log("ingest: low-res video");
    await ytdlp(
      [
        "-f",
        "bv*[height<=480]/b[height<=480]/wv*/w",
        "-o",
        join(dir, "video.%(ext)s"),
      ],
      "yt-dlp video",
    );
    video = await findFile(dir, "video.", [".mp4", ".webm", ".mkv"]);
  }

  // Transcript: captions first, Whisper (Groq) on the audio otherwise.
  let transcript: Transcript = { source: "none", language, lines: [] };
  if (captions) {
    const lines = parseVtt(await readFile(captions, "utf8"));
    if (lines.length > 0) transcript = { source: "captions", language, lines };
  }
  if (transcript.lines.length === 0 && WHISPER_LANGS.has(language)) {
    const wordsPath = join(dir, "words.json");
    if (fresh(wordsPath)) {
      log("ingest: Whisper transcript (Groq)");
      const key = options.env.get("GROQ_API_KEY");
      if (!key)
        throw new Error("no captions and GROQ_API_KEY is not set for Whisper");
      await runChecked(
        runner,
        options.python ?? PYTHON,
        [
          "-I",
          join(options.engineRoot ?? ENGINE_ROOT, "tools", "whisper_words.py"),
          audio,
          language,
          wordsPath,
        ],
        {
          what: "whisper_words.py",
          env: { GROQ_API_KEY: key },
          timeoutMs: 10 * 60_000,
          redact: options.env.redact,
        },
      );
    }
    const words = JSON.parse(await readFile(wordsPath, "utf8")) as TimedWord[];
    transcript = { source: "whisper", language, lines: wordsToLines(words) };
  }

  let cutTimes: number[] = [];
  const sceneCuts: IngestManifest["frames"]["sceneCuts"] = [];
  const contactSheets: IngestManifest["frames"]["contactSheets"] = [];
  const duration = Number(info.duration ?? 0);
  if (video) {
    const cutsPath = join(dir, "frames", "cuts.json");
    if (fresh(cutsPath)) {
      log("ingest: scene-cut frames");
      const threshold = options.sceneThreshold ?? 0.3;
      const result = await runChecked(
        runner,
        "ffmpeg",
        [
          "-hide_banner",
          "-y",
          "-i",
          video,
          "-vf",
          `select='eq(n\\,0)+gt(scene\\,${threshold})',showinfo,scale=480:-2`,
          "-fps_mode",
          "vfr",
          "-q:v",
          "4",
          join(dir, "frames", "scene_%04d.jpg"),
        ],
        { what: "ffmpeg scene cuts", timeoutMs: 15 * 60_000 },
      );
      const times = parseShowinfo(result.stderr);
      await writeFile(cutsPath, JSON.stringify(times));
    }
    cutTimes = JSON.parse(await readFile(cutsPath, "utf8")) as number[];
    // Every cut time is kept for the shot timing; at most 48 frames stay on disk.
    const kept = new Set(capFrames(cutTimes, MAX_SCENE_FRAMES));
    for (const [i, t] of cutTimes.entries()) {
      const file = slash(
        join(dir, "frames", `scene_${String(i + 1).padStart(4, "0")}.jpg`),
      );
      if (kept.has(t)) sceneCuts.push({ t, file });
      else await rm(file, { force: true });
    }
    const firstSheet = join(dir, "sheets", "sheet_001.jpg");
    if (fresh(firstSheet)) {
      log("ingest: 1 fps contact sheets");
      const draw = `drawtext=fontfile='${FONT}':text='%{pts\\:hms}':x=4:y=4:fontsize=14:fontcolor=yellow:box=1:boxcolor=black@0.6:boxborderw=2`;
      await runChecked(
        runner,
        "ffmpeg",
        [
          "-hide_banner",
          "-y",
          "-i",
          video,
          "-vf",
          `fps=1,scale=256:-2,${draw},tile=${SHEET.cols}x${SHEET.rows}:padding=2:color=0x202020`,
          "-q:v",
          "3",
          join(dir, "sheets", "sheet_%03d.jpg"),
        ],
        { what: "ffmpeg contact sheets", timeoutMs: 15 * 60_000 },
      );
    }
    const sheets = (await readdir(join(dir, "sheets")))
      .filter((f) => /^sheet_\d+\.jpg$/u.test(f))
      .sort();
    const per = SHEET.cols * SHEET.rows;
    sheets.forEach((file, k) => {
      contactSheets.push({
        file: join(dir, "sheets", file).replaceAll("\\", "/"),
        start: k * per,
        end: Math.min(duration || (k + 1) * per, (k + 1) * per),
        cols: SHEET.cols,
        rows: SHEET.rows,
      });
    });
  }

  const manifest = IngestManifestSchema.parse({
    schemaVersion: 1,
    videoId,
    url: info.webpage_url ?? canonical,
    title: info.title ?? videoId,
    uploader: info.uploader ?? info.channel ?? "",
    durationS: duration,
    license: info.license ?? null,
    language,
    tags: info.tags ?? [],
    description: (info.description ?? "").slice(0, 3000),
    files: {
      dir,
      audio: slash(audio),
      video: video ? slash(video) : null,
      info: slash(infoPath),
      captions: captions ? slash(captions) : null,
    },
    transcript,
    frames: { cutTimes, sceneCuts, contactSheets },
    createdAt: new Date().toISOString(),
  });
  await writeFile(
    join(dir, "manifest.json"),
    JSON.stringify(manifest, null, 1),
  );
  // Artist names found in the metadata, so later stages can keep them out of prompts.
  const names = [
    info.artist,
    info.creator,
    info.uploader,
    info.channel,
    info.track,
  ].filter(Boolean);
  await writeFile(join(dir, "names.json"), JSON.stringify([...new Set(names)]));
  return manifest;
}
