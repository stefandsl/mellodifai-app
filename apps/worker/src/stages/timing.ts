import { join } from "node:path";
import type { StageHandler } from "../loop.js";
import {
  ENGINE_ROOT,
  engine,
  key,
  language,
  readJson,
  upload,
} from "./utils.js";

export const timing: StageHandler = async (context) => {
  const takes = await context.db.getTakes(context.version.id);
  const selected = takes.find(
    (take) => take.id === context.version.chosen_take_id,
  );
  if (!selected) throw new Error("chosen take is required before timing");
  const takeNumber = Math.max(1, takes.indexOf(selected) + 1);
  const lang = language(context);
  await engine(context, "bash", [
    "tools/workspace_pipeline.sh",
    lang,
    String(takeNumber),
  ]);
  const timingFile = join(context.ws.publicDir, "data", lang, "timing.json");
  const data = await readJson<{
    duration?: number;
    words?: { start: number; end: number }[];
  }>(timingFile);
  const crushed = (data.words ?? []).filter(
    (word) => word.end - word.start < 0.2,
  ).length;
  const vocalStem = join(context.ws.root, "stems", "vocals.wav");
  const chantClip = join(context.ws.renderDir, "chant-listen.mp3");
  const outroClip = join(context.ws.renderDir, "outro-listen.mp3");
  await context.engine.run(
    "ffmpeg",
    ["-y", "-i", vocalStem, "-t", "8", "-f", "mp3", chantClip],
    { cwd: ENGINE_ROOT, outputs: [chantClip] },
  );
  await context.engine.run(
    "ffmpeg",
    ["-y", "-sseof", "-12", "-i", vocalStem, "-f", "mp3", outroClip],
    { cwd: ENGINE_ROOT, outputs: [outroClip] },
  );
  return {
    patch: {
      timing_path: `data/${lang}/timing.json`,
      qa_flags: [
        { kind: "crushed_words", blocking: true, count: crushed },
        {
          kind: "final_chorus_listen",
          blocking: false,
          path: await upload(context, chantClip, "audio/mpeg"),
        },
        {
          kind: "spoken_outro_listen",
          blocking: false,
          path: await upload(context, outroClip, "audio/mpeg"),
        },
        { kind: "timing_duration", value: data.duration ?? null },
      ],
    },
    enqueue: [
      { stage: "storyboard", idempotencyKey: key("storyboard", context) },
    ],
  };
};
