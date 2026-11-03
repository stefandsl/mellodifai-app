import { mkdir, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { type TimedWord, timingFromWords } from "@mellodifai/shared";
import type { StageHandler } from "../loop.js";
import { takeAudio } from "./take-audio.js";

export const alignLyrics: StageHandler = async (context) => {
  const id = context.job.payload?.take_id;
  const take = id
    ? (await context.db.getTakes(context.version.id)).find(
        (item) => item.id === id,
      )
    : null;
  if (id && !take) throw new Error("Take not found");
  const lyrics = (
    take?.lyrics ||
    (context.version.lyric_pack as { lyrics?: string } | null)?.lyrics ||
    ""
  ).trim();
  if (!lyrics) throw new Error("Lyrics required");
  if (take ? take.lyric_timing : context.version.lyric_timing) return {};
  const dir = join(context.ws.root, "align-lyrics", take?.id ?? "master");
  await mkdir(dir, { recursive: true });
  try {
    let audio: string;
    if (take) audio = await takeAudio(context, take, dir);
    else {
      const master = await context.db.getRender(context.version.id, "master");
      if (!master?.preview_path || !context.storage.download)
        throw new Error("Playable master preview required");
      audio = join(dir, "master-preview.mp4");
      await context.storage.download(master.preview_path, audio);
    }
    const output = join(dir, "words.json");
    await context.engine.run(
      "E:/mellodifai/venvs/karaoke-whisper/Scripts/python",
      [
        fileURLToPath(
          new URL("../../scripts/local-whisper.py", import.meta.url),
        ),
        audio,
        context.version.lang,
        output,
      ],
      { clearOutputs: [output] },
    );
    const heard = JSON.parse(await readFile(output, "utf8")) as TimedWord[];
    const timing = timingFromWords(lyrics, heard, "whisper");
    if (!timing) throw new Error("Unable to align these lyrics to the audio");
    for (const line of timing.lines) {
      const words = heard.filter(
        (word) =>
          word.start >= line.start - 0.01 && word.end <= line.end + 0.01,
      );
      if (words.length === (line.text.match(/\S+/gu)?.length ?? 0))
        line.words = words;
    }
    if (take) await context.db.patchTake(take.id, { lyric_timing: timing });
    else
      await context.db.patchVersion(context.version.id, {
        lyric_timing: timing,
      });
    return {};
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
};
