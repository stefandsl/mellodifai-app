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
  await context.db.patchRender(render.id, {
    qa_results: {
      ...((render.qa_results as Record<string, unknown> | null) ?? {}),
      assets: {
        ...saved,
        storyboard_path: context.version.storyboard_path,
        thumbnail_path: thumbnailPath,
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
  const srt = join(context.ws.renderDir, `${context.version.lang}.srt`);
  await context.engine.run(
    "python",
    ["-I", "-X", "utf8", "tools/make_srt.py", context.version.lang, srt],
    { cwd: ENGINE_ROOT, outputs: [srt] },
  );
  await upload(context, srt, "application/x-subrip");
  return { versionStatus: "video_review" };
};
