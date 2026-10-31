import { join } from "node:path";
import type { StageHandler } from "../loop.js";
import { ENGINE_ROOT, key, language, readJson, upload } from "./utils.js";

export const timing: StageHandler = async (context) => {
  const takes = await context.db.getTakes(context.version.id);
  const selected = takes.find(
    (take) => take.id === context.version.chosen_take_id,
  );
  if (!selected) throw new Error("chosen take is required before timing");
  const takeNumber = selected.take_number;
  if (takeNumber !== 1 && takeNumber !== 2)
    throw new Error("Invalid take_number");
  const lang = language(context);
  const timingFile = join(context.ws.publicDir, "data", lang, "timing.json");
  const vocalStem = join(
    context.ws.root,
    "stems",
    "htdemucs",
    lang,
    "vocals.wav",
  );
  await context.engine.run(
    "bash",
    ["tools/workspace_pipeline.sh", lang, String(takeNumber)],
    {
      cwd: ENGINE_ROOT,
      clearOutputs: [
        timingFile,
        join(context.ws.publicDir, "audio", `${lang}.wav`),
        join(context.ws.outDir, "master.wav"),
        ...["master.mp3", "words.json", "lines.json", "loudness.json"].map(
          (file) => join(context.ws.outDir, file),
        ),
        vocalStem,
        join(
          context.ws.root,
          "stems",
          "htdemucs",
          `${lang}-take${takeNumber}`,
          "vocals.wav",
        ),
      ],
    },
  );
  const data = await readJson<{
    duration?: number;
    words?: { start: number; end: number }[];
    lines?: { section?: string; words?: { start: number; end: number }[] }[];
    sections?: {
      name?: string;
      title?: string;
      lines?: { words?: { start: number; end: number }[] }[];
    }[];
  }>(timingFile);
  const words =
    data.words ??
    data.lines?.flatMap((line) => line.words ?? []) ??
    data.sections?.flatMap(
      (section) => section.lines?.flatMap((line) => line.words ?? []) ?? [],
    );
  const crushed =
    words?.filter((word) => word.end - word.start < 0.2).length ?? null;
  const final = data.sections?.find((s) =>
    /final chorus/iu.test(s.name ?? s.title ?? ""),
  );
  const firstWord =
    final?.lines?.[0]?.words?.[0]?.start ??
    data.lines?.find((line) => /final chorus/iu.test(line.section ?? ""))
      ?.words?.[0]?.start;
  if (firstWord === undefined || firstWord < 8)
    throw new Error("Final Chorus timing is not measured");
  const chantClip = join(context.ws.renderDir, "chant-listen.mp3");
  const outroClip = join(context.ws.renderDir, "outro-listen.mp3");
  await context.engine.run(
    "ffmpeg",
    [
      "-y",
      "-ss",
      String(firstWord - 8),
      "-i",
      vocalStem,
      "-t",
      "8",
      "-f",
      "mp3",
      chantClip,
    ],
    { cwd: ENGINE_ROOT, outputs: [chantClip] },
  );
  await context.engine.run(
    "ffmpeg",
    ["-y", "-sseof", "-12", "-i", vocalStem, "-f", "mp3", outroClip],
    { cwd: ENGINE_ROOT, outputs: [outroClip] },
  );
  return {
    versionStatus: "producing",

    patch: {
      render_attempt: context.version.render_attempt ?? 1,
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
