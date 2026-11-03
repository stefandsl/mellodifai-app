import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { LyricPackSchema } from "@mellodifai/shared";
import type { StageContext, StageHandler } from "../loop.js";
import { ENGINE_ROOT, upload } from "./utils.js";

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
  const frame = join(context.ws.renderDir, "thumbnail-frame.jpg");
  await context.engine.run(
    "ffmpeg",
    ["-y", "-ss", "0.5", "-i", render.path, "-frames:v", "1", frame],
    { cwd: ENGINE_ROOT, outputs: [frame] },
  );
  const thumbnailPath = await makeThumbnail(context, frame);
  await context.db.patchRender(render.id, {
    qa_results: {
      ...((render.qa_results as Record<string, unknown> | null) ?? {}),
      assets: {
        storyboard_path: context.version.storyboard_path,
        thumbnail_path: thumbnailPath,
        chosen_take_id: context.version.chosen_take_id,
        lyric_pack: context.version.lyric_pack,
        storyboard_sections: context.version.storyboard_sections,
        title: LyricPackSchema.parse(context.version.lyric_pack).title,
        lang: context.version.lang,
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
