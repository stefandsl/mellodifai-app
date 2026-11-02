import {
  copyFile,
  mkdir,
  readFile,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { dirname, extname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  ANALYSIS_RATE,
  analyseSong,
  normalizeVisualizerParams,
  stockBackground,
  uploadPathOf,
  VISUALIZER_FPS,
  type VisualizerParams,
  VisualizerParamsSchema,
} from "@mellodifai/shared";
import type { Render, Take } from "../db.js";
import type { StageContext, StageHandler } from "../loop.js";
import { takeAudio } from "./take-audio.js";
import { posterOf, upload } from "./utils.js";

// The Video Studio's render (ace-ui-replica-prompt.md item G): the chosen take, drawn by the
// Remotion composition in packages/visualizer with the parameters stored on the render row.
// Local and free: no kie credits, no GPU model, only Chrome drawing frames.
const REPO = resolve(dirname(fileURLToPath(import.meta.url)), "../../../..");
export const VISUALIZER_PACKAGE = join(REPO, "packages", "visualizer");
// The bucket holds 1 GB in all: the delivered video is kept under this size.
export const DELIVERY_LIMIT = 45 * 1024 * 1024;

const AUDIO_KBPS = 160;
// Video bitrate (kbit/s) that keeps a song of `seconds` under the delivery limit, using `share`
// of it; never above what a 1080p visualizer needs.
export function deliveryKbps(seconds: number, share = 0.9): number {
  const total = (DELIVERY_LIMIT * 8 * share) / 1000 / Math.max(1, seconds);
  return Math.max(300, Math.min(8000, Math.floor(total - AUDIO_KBPS)));
}

// Remotion prints "Rendered 120/6300, time remaining: 2m" while it renders.
export function renderedPercent(line: string): number | null {
  const found = /Rendered\s+(\d+)\/(\d+)/u.exec(line);
  if (!found?.[1] || !found[2]) return null;
  const total = Number(found[2]);
  return total > 0
    ? Math.min(100, Math.round((Number(found[1]) / total) * 100))
    : null;
}

export function aspectName(aspect: string): string {
  return aspect.replace(":", "x");
}

type Payload = { render_id?: unknown; take_id?: unknown };

async function wanted(
  context: StageContext,
): Promise<{ render: Render; take: Take; params: VisualizerParams }> {
  const payload = (context.job.payload ?? {}) as Payload;
  const render =
    typeof payload.render_id === "string"
      ? await context.db.getRenderById(payload.render_id)
      : null;
  if (render?.kind !== "visualizer" || render.version_id !== context.version.id)
    throw new Error("Il video da creare non esiste più");
  const parsed = VisualizerParamsSchema.safeParse(render.visualizer_params);
  if (!parsed.success) throw new Error("Parametri del video non validi");
  // Read like the studio reads saved settings: a row saved before the logos drops the old
  // default artist and website lines nobody typed.
  const params = normalizeVisualizerParams(render.visualizer_params);
  const takeId =
    typeof payload.take_id === "string"
      ? payload.take_id
      : context.version.chosen_take_id;
  const take = (await context.db.getTakes(context.version.id)).find(
    (item) => item.id === takeId,
  );
  if (!take) throw new Error("La versione scelta non esiste più");
  return { render, take, params };
}

async function fetchStored(
  context: StageContext,
  path: string,
  dir: string,
  name: string,
  bucket: "previews" | "uploads",
): Promise<string | null> {
  if (!context.storage.download)
    throw new Error("This worker cannot download stored files");
  const file = join(dir, `${name}${extname(path).toLowerCase() || ".bin"}`);
  try {
    await context.storage.download(path, file, bucket);
    return file;
  } catch (error) {
    await context.log(`File non disponibile (${bucket}): ${String(error)}`);
    return null;
  }
}

// The song's own artwork: the take's Suno cover, else the lyric video's thumbnail.
async function coverFile(
  context: StageContext,
  take: Take,
  dir: string,
): Promise<string | null> {
  const candidates = [take.cover_path].filter((p): p is string => Boolean(p));
  const master = (
    await context.db.previewRows(context.version.id)
  ).renders.find((r) => r.kind === "master" && r.preview_path);
  if (master?.preview_path) {
    const folder = master.preview_path.slice(
      0,
      master.preview_path.lastIndexOf("/"),
    );
    candidates.push(
      `${folder}/thumbnail.png`,
      `${folder}/thumbnail-1280x720.png`,
    );
  }
  for (const path of candidates) {
    const file = await fetchStored(context, path, dir, "cover", "previews");
    if (file) return file;
  }
  return null;
}

function titleOf(context: StageContext): string {
  const v = context.version as {
    display_title?: string | null;
    lyric_pack?: unknown;
  };
  const pack = (v.lyric_pack ?? {}) as { title?: unknown };
  const settings = (context.project.song_settings ?? {}) as { title?: unknown };
  return (
    v.display_title ||
    (typeof pack.title === "string" ? pack.title : "") ||
    (typeof settings.title === "string" ? settings.title : "") ||
    context.project.topic ||
    ""
  );
}

async function probeSeconds(
  context: StageContext,
  file: string,
): Promise<number> {
  let out = "";
  const probe = context.engine.withWorkspace(
    context.ws.root,
    async (line) => {
      out += line;
    },
    context.signal,
  );
  await probe.run(
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

export const visualizer: StageHandler = async (context) => {
  const { render, take, params } = await wanted(context);
  const name = `visualizer-${aspectName(params.aspect)}`;
  const dir = join(context.ws.root, "visualizer", render.id);
  const pub = join(dir, "public");
  await rm(dir, { recursive: true, force: true });
  await mkdir(pub, { recursive: true });
  try {
    await context.progress(2, "Video: preparo l'audio");
    const source = await takeAudio(context, take, dir);
    const audio = join(pub, `audio${extname(source).toLowerCase() || ".mp3"}`);
    await copyFile(source, audio);
    const pcm = join(dir, "audio.f32");
    await context.engine.run(
      "ffmpeg",
      [
        "-hide_banner",
        "-loglevel",
        "error",
        "-y",
        "-i",
        source,
        "-ac",
        "1",
        "-ar",
        String(ANALYSIS_RATE),
        "-f",
        "f32le",
        pcm,
      ],
      { cwd: dir, outputs: [pcm] },
    );
    const bytes = await readFile(pcm);
    const samples = new Float32Array(
      bytes.buffer,
      bytes.byteOffset,
      Math.floor(bytes.byteLength / 4),
    );
    const duration = samples.length / ANALYSIS_RATE;
    if (duration < 1) throw new Error("L'audio è troppo corto per un video");
    const frames = Math.ceil(duration * VISUALIZER_FPS);
    await context.progress(6, "Video: analizzo l'audio");
    await writeFile(
      join(pub, "analysis.bin"),
      analyseSong(samples, ANALYSIS_RATE, VISUALIZER_FPS, frames),
    );
    await rm(pcm, { force: true });

    await context.progress(9, "Video: preparo le immagini");
    const cover = await coverFile(context, take, pub);
    const coverName = cover ? cover.slice(pub.length + 1) : null;
    const local = (file: string | null) =>
      file ? file.slice(pub.length + 1) : null;
    let background: {
      file: string;
      kind: "image" | "video";
      frames?: number;
    } | null = null;
    const bg = params.background;
    if (bg.mode === "random") {
      const file = await fetchStored(
        context,
        stockBackground(bg.seed),
        pub,
        "background",
        "uploads",
      );
      if (file) background = { file: local(file) as string, kind: "image" };
    } else {
      const path = uploadPathOf(bg.assetUrl);
      const file = path
        ? await fetchStored(context, path, pub, "background", "uploads")
        : null;
      if (file && bg.mode === "video") {
        const seconds = await probeSeconds(context, file);
        background = {
          file: local(file) as string,
          kind: "video",
          frames: Math.max(1, Math.floor(seconds * VISUALIZER_FPS)),
        };
      } else if (file)
        background = { file: local(file) as string, kind: "image" };
      // No upload yet: the song's cover is the picture, as in the preview.
      else if (coverName) background = { file: coverName, kind: "image" };
    }
    let center: string | null = null;
    if (params.centerImage.mode === "cover") center = coverName;
    else if (params.centerImage.mode === "upload") {
      const path = uploadPathOf(params.centerImage.assetUrl);
      // No upload yet: the cover, as in the preview.
      center =
        local(
          path
            ? await fetchStored(context, path, pub, "center", "uploads")
            : null,
        ) ?? coverName;
    }
    // The user's logos, fetched like the centre upload. A logo whose file is gone is left out,
    // not a failed render; only the user's own uploads are read.
    const owner = render.owner_id ?? context.job.owner_id;
    const logos: (string | null)[] = [];
    for (const [i, logo] of params.logos.entries()) {
      const path = uploadPathOf(logo.assetUrl);
      logos.push(
        owner && path?.startsWith(`${owner}/`)
          ? local(
              await fetchStored(context, path, pub, `logo-${i + 1}`, "uploads"),
            )
          : null,
      );
    }
    const props = join(dir, "props.json");
    await writeFile(
      props,
      JSON.stringify({
        params,
        title: titleOf(context),
        duration,
        frames,
        audio: local(audio),
        analysis: "analysis.bin",
        background,
        center,
        logos,
      }),
    );

    await context.progress(12, "Video: rendering 0%");
    const rendered = join(dir, `${name}-master.mp4`);
    // Remotion reports every few frames; one progress event every few seconds is enough.
    let reported = 0;
    let reportedAt = 0;
    let pending = Promise.resolve();
    const run = context.engine.withWorkspace(
      context.ws.root,
      async (line) => {
        const pct = renderedPercent(line);
        if (pct === null) {
          if (!/^Encoded\s/u.test(line)) await context.log(line);
          return;
        }
        const now = Date.now();
        if (pct <= reported || (now - reportedAt < 3000 && pct < 100)) return;
        reported = pct;
        reportedAt = now;
        // 12..92: rendering; the rest is the delivery copy and the upload.
        pending = pending.then(() =>
          context
            .progress(12 + Math.round(pct * 0.8), `Video: rendering ${pct}%`)
            .catch(() => {}),
        );
      },
      context.signal,
    );
    await run.run(
      process.execPath,
      [join(VISUALIZER_PACKAGE, "scripts", "render.mjs"), props, rendered, pub],
      {
        cwd: VISUALIZER_PACKAGE,
        outputs: [rendered],
        env: { RENDER_TMP: "E:/mellodifai/render-tmp" },
      },
    );
    await pending;

    await context.progress(93, "Video: preparo il file da scaricare");
    const video = join(dir, `${name}.mp4`);
    let size = (await stat(rendered)).size;
    if (size <= DELIVERY_LIMIT) await copyFile(rendered, video);
    else {
      // One encode at the bitrate that fits the limit (the stored copy is for download and the
      // card; the full-quality master stays on this PC). A second, leaner try if it still does not.
      for (const share of [0.9, 0.7]) {
        const kbps = deliveryKbps(duration, share);
        await context.engine.run(
          "ffmpeg",
          [
            "-hide_banner",
            "-loglevel",
            "error",
            "-y",
            "-i",
            rendered,
            "-c:v",
            "libx264",
            "-preset",
            "medium",
            "-b:v",
            `${kbps}k`,
            "-maxrate",
            `${Math.round(kbps * 1.5)}k`,
            "-bufsize",
            `${kbps * 2}k`,
            "-pix_fmt",
            "yuv420p",
            "-c:a",
            "aac",
            "-b:a",
            `${AUDIO_KBPS}k`,
            "-movflags",
            "+faststart",
            video,
          ],
          { cwd: dir, outputs: [video] },
        );
        size = (await stat(video)).size;
        if (size <= DELIVERY_LIMIT) break;
      }
    }
    if (size > DELIVERY_LIMIT)
      throw new Error(
        "Il video supera il limite dello spazio di archiviazione",
      );
    const poster = join(dir, `${name}.jpg`);
    await context.engine.run(
      "ffmpeg",
      [
        "-hide_banner",
        "-loglevel",
        "error",
        "-y",
        "-ss",
        String(Math.min(duration * 0.3, 20).toFixed(2)),
        "-i",
        rendered,
        "-frames:v",
        "1",
        "-vf",
        "scale='min(960,iw)':-2",
        "-q:v",
        "4",
        poster,
      ],
      { cwd: dir, outputs: [poster] },
    );
    await context.progress(96, "Video: caricamento");
    const stored = await upload(context, video, "video/mp4");
    const storedPoster = await upload(context, poster, "image/jpeg");
    if (storedPoster !== posterOf(stored))
      throw new Error("Unexpected poster path");
    // The full-quality master stays on this PC, like the lyric video's.
    const keep = join(context.ws.renderDir, `${name}.mp4`);
    await copyFile(rendered, keep);
    await context.db.patchRender(render.id, {
      path: keep,
      preview_path: stored,
    });
    await context.progress(100, "Video pronto");
    return {};
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => {});
  }
};
