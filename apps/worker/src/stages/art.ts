import { join } from "node:path";
import { LyricPackSchema } from "@mellodifai/shared";
import type { StageHandler } from "../loop.js";
import { ENGINE_ROOT, upload } from "./utils.js";
export const art: StageHandler = async (context) => {
  const pack = LyricPackSchema.parse(context.version.lyric_pack);
  const output = join(context.ws.renderDir, "thumbnail.png");
  await context.engine.run(
    "python",
    [
      "-I",
      "-X",
      "utf8",
      "tools/make_thumb.py",
      "--title",
      pack.title,
      "--out",
      output,
    ],
    { cwd: ENGINE_ROOT, outputs: [output] },
  );
  await upload(context, output, "image/png");
  return { versionStatus: "video_review" };
};
