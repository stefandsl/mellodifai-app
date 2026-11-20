import { mkdir, readFile, rm } from "node:fs/promises";
import { extname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { LyricPackSchema, songMood } from "@mellodifai/shared";
import type { StageContext, StageHandler } from "../loop.js";
import { ENGINE_ROOT, renderAssetPath, upload } from "./utils.js";

const script = fileURLToPath(new URL("./thumbnail.py", import.meta.url));

export async function makeThumbnail(context: StageContext, source: string) {
  const pack = LyricPackSchema.parse(context.version.lyric_pack);
  const output = join(context.ws.renderDir, "thumbnail.png");
  await context.engine.run(
    "python",
    [
      "-X",
      "utf8",
      script,
      `--title=${pack.title}`,
      "--lang",
      context.version.lang,
      "--source",
      source,
      "--out",
      output,
    ],
    { cwd: context.ws.root, outputs: [output] },
  );
  return upload(context, output, "image/png");
}

// Three cover candidates from this render's own frames (PIANO-UNIFICATO M2b): one frame every
// COVER_STEP seconds, ranked by thumbnail.py (lyric-free first, then sharpness, then distinct
// scenes; no model, no network), each with the song title as local typography. The owner picks one
// in "Pubblica"; the files sit in this render attempt's own folder, so a re-render never replaces
// them. Best effort: a failure leaves the default thumbnail and no candidates.
export const COVER_STEP = 2;
export const COVER_FILE = /^cover-[1-3]\.png$/u;
export type CoverCandidate = {
  id: string;
  path: string;
  frame_sec: number;
  sharpness: number;
  lyric_free: boolean;
  distinct: boolean;
  fonts: string[];
  phone: { min_line_px: number; em_px: number; contrast: number };
  source: { kind: "render_frame"; method: string; render_attempt: number };
};
export async function makeCovers(
  context: StageContext,
  video: string,
  srt: string | null,
): Promise<CoverCandidate[]> {
  const pack = LyricPackSchema.parse(context.version.lyric_pack);
  const frames = join(context.ws.renderDir, "cover-frames");
  const manifest = join(context.ws.renderDir, "cover-manifest.json");
  const outputs = [1, 2, 3].map((n) =>
    join(context.ws.renderDir, `cover-${n}.png`),
  );
  try {
    await rm(frames, { recursive: true, force: true });
    await mkdir(frames, { recursive: true });
    await context.engine.run(
      "ffmpeg",
      [
        "-y",
        "-i",
        video,
        "-vf",
        `fps=1/${COVER_STEP},scale=1280:720`,
        "-q:v",
        "3",
        join(frames, "f%04d.jpg"),
      ],
      { cwd: context.ws.root },
    );
    await context.engine.run(
      "python",
      [
        "-X",
        "utf8",
        script,
        `--title=${pack.title}`,
        "--lang",
        context.version.lang,
        "--frames",
        frames,
        "--step",
        String(COVER_STEP),
        ...(srt ? ["--srt", srt] : []),
        "--manifest",
        manifest,
        "--covers",
        ...outputs,
      ],
      { cwd: context.ws.root, outputs: [manifest, ...outputs] },
    );
    const made = JSON.parse(await readFile(manifest, "utf8")) as {
      method: string;
      covers: Array<Omit<CoverCandidate, "path" | "source"> & { file: string }>;
    };
    const result: CoverCandidate[] = [];
    for (const cover of made.covers) {
      if (!COVER_FILE.test(cover.file) || cover.id !== cover.file.slice(0, -4))
        throw new Error("Unexpected cover file");
      result.push({
        id: cover.id,
        path: await upload(
          context,
          join(context.ws.renderDir, cover.file),
          "image/png",
        ),
        frame_sec: cover.frame_sec,
        sharpness: cover.sharpness,
        lyric_free: cover.lyric_free,
        distinct: cover.distinct,
        fonts: cover.fonts,
        phone: {
          min_line_px: cover.phone.min_line_px,
          em_px: cover.phone.em_px,
          contrast: cover.phone.contrast,
        },
        source: {
          kind: "render_frame",
          method: made.method,
          render_attempt: context.version.render_attempt ?? 1,
        },
      });
    }
    return result;
  } catch (error) {
    await context.log(
      context.secrets.redact(`Cover candidates skipped: ${String(error)}`),
    );
    return [];
  } finally {
    await rm(frames, { recursive: true, force: true });
  }
}

export const art: StageHandler = async (context) => {
  const render = await context.db.getRender(context.version.id, "master");
  if (!render?.path) throw new Error("Master video required for its thumbnail");
  const saved = (
    render.qa_results as { assets?: { thumbnail_path?: unknown } } | null
  )?.assets;
  const oldThumbnail = saved?.thumbnail_path;
  let thumbnailPath: string;
  if (
    (context.version.render_attempt ?? 1) > 1 &&
    typeof oldThumbnail === "string" &&
    renderAssetPath(
      context,
      (context.version.render_attempt ?? 1) - 1,
      oldThumbnail,
      /^thumbnail(?:-1280x720)?\.(?:png|jpg|jpeg|webp)$/u,
    )
  ) {
    if (!context.storage.download)
      throw new Error("Thumbnail download unavailable");
    const extension = extname(oldThumbnail);
    const local = join(context.ws.renderDir, `thumbnail${extension}`);
    await context.storage.download(oldThumbnail, local);
    thumbnailPath = await upload(
      context,
      local,
      extension === ".webp"
        ? "image/webp"
        : extension === ".png"
          ? "image/png"
          : "image/jpeg",
    );
  } else {
    const frame = join(context.ws.renderDir, "thumbnail-frame.jpg");
    await context.engine.run(
      "ffmpeg",
      ["-y", "-ss", "0.5", "-i", render.path, "-frames:v", "1", frame],
      { cwd: ENGINE_ROOT, outputs: [frame] },
    );
    thumbnailPath = await makeThumbnail(context, frame);
  }
  const srt = join(context.ws.renderDir, `${context.version.lang}.srt`);
  await context.engine.run(
    "python",
    ["-I", "-X", "utf8", "tools/make_srt.py", context.version.lang, srt],
    { cwd: ENGINE_ROOT, outputs: [srt] },
  );
  await upload(context, srt, "application/x-subrip");
  const covers = await makeCovers(context, render.path, srt);
  await context.db.patchRender(render.id, {
    qa_results: {
      ...((render.qa_results as Record<string, unknown> | null) ?? {}),
      assets: {
        ...saved,
        storyboard_path: context.version.storyboard_path,
        thumbnail_path: thumbnailPath,
        cover_candidates: covers,
        chosen_take_id: context.version.chosen_take_id,
        lyric_pack: context.version.lyric_pack,
        storyboard_sections: context.version.storyboard_sections,
        title: LyricPackSchema.parse(context.version.lyric_pack).title,
        lang: context.version.lang,
        mood: songMood(
          context.project.mood,
          (context.project.song_settings as { mood?: string } | null)?.mood,
          LyricPackSchema.parse(context.version.lyric_pack).style,
        ),
      },
    },
  });
  return { versionStatus: "video_review" };
};
