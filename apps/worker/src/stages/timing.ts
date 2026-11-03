import { access } from "node:fs/promises";
import { join } from "node:path";
import { LyricPackSchema } from "@mellodifai/shared";
import type { StageHandler } from "../loop.js";
import { materializeEditedTake } from "./take-audio.js";
import {
  ENGINE_ROOT,
  key,
  language,
  readJson,
  upload,
  versionFile,
  writePack,
} from "./utils.js";

export const timing: StageHandler = async (context) => {
  const takes = await context.db.getTakes(context.version.id);
  const selected = takes.find(
    (take) => take.id === context.version.chosen_take_id,
  );
  if (!selected) throw new Error("chosen take is required before timing");
  const takeNumber = selected.take_number;
  // Takes 1 and 2 come from a generation; a rewritten part adds 3, 4 and so on.
  if (!takeNumber || !Number.isInteger(takeNumber) || takeNumber < 1)
    throw new Error("Invalid take_number");
  const lang = language(context);
  await materializeEditedTake(context, selected);
  // A song that never went through generate_song (an import) may have no lyric files yet: the
  // pipeline reads them from versions/<lang>/.
  const hasPack = await access(versionFile(context, "title.txt")).then(
    () => true,
    () => false,
  );
  const pack = LyricPackSchema.safeParse(context.version.lyric_pack);
  if (!hasPack && pack.success) await writePack(context, pack.data);
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
    lines?: {
      section?: string;
      text?: string;
      words?: { word?: string; start: number; end: number }[];
    }[];
    sections?: {
      name?: string;
      title?: string;
      lines?: { words?: { start: number; end: number }[] }[];
    }[];
  }>(timingFile);
  // The measured lines become the take's timing for "Riscrivi una parte".
  const timed = (data.lines ?? []).flatMap((line) => {
    const first = line.words?.[0];
    const last = line.words?.at(-1);
    return first && last && typeof line.text === "string"
      ? [
          {
            text: line.text,
            start: first.start,
            end: last.end,
            ...(line.words?.every((word) => typeof word.word === "string")
              ? {
                  words: line.words.map((word) => ({
                    word: word.word ?? "",
                    start: word.start,
                    end: word.end,
                  })),
                }
              : {}),
          },
        ]
      : [];
  });
  if (timed.length > 0)
    await context.db
      .patchTake(selected.id, {
        lyric_timing: { source: "timing", lines: timed },
      })
      .catch(() => {});
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
