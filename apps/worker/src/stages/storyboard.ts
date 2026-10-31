import type { StageHandler } from "../loop.js";
import { engine, key, language } from "./utils.js";
export const storyboard: StageHandler = async (context) => {
  const lang = language(context);
  await engine(context, "python", [
    "-I",
    "-X",
    "utf8",
    "tools/make_storyboard.py",
    lang,
  ]);
  return {
    patch: { storyboard_path: `data/${lang}/storyboard.json` },
    enqueue: [
      { stage: "render_master", idempotencyKey: key("render_master", context) },
    ],
  };
};
