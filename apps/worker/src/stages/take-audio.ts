import { rm, stat } from "node:fs/promises";
import { extname, join } from "node:path";
import type { Take } from "../db.js";
import type { StageContext } from "../loop.js";

async function exists(file: string): Promise<boolean> {
  try {
    return (await stat(file)).isFile();
  } catch {
    return false;
  }
}

async function download(context: StageContext, take: Take, file: string) {
  if (!take.audio_preview_path)
    throw new Error("La versione scelta non ha un audio");
  if (!context.storage.download)
    throw new Error("This worker cannot download stored audio");
  await context.storage.download(take.audio_preview_path, file);
}

// The best local file of a take: the workspace keeps the full-quality files of the current
// generation (out/<lang>/take-N.flac from a local engine, take-N.mp3 from kie or any engine);
// anything else (an edit, an older generation) is fetched from storage into `dir`.
export async function takeAudio(
  context: StageContext,
  take: Take,
  dir: string,
): Promise<string> {
  const current =
    (take.generation ?? 1) === (context.version.generation_count ?? 1);
  if (
    take.engine !== "edit" &&
    current &&
    (take.take_number === 1 || take.take_number === 2)
  ) {
    const local = take.engine === "ace-step" || take.engine === "yue2";
    for (const ext of local ? ["flac", "mp3"] : ["mp3"]) {
      const file = join(context.ws.outDir, `take-${take.take_number}.${ext}`);
      if (await exists(file)) return file;
    }
  }
  const file = join(
    dir,
    `take-source${extname(take.audio_preview_path ?? "") || ".mp3"}`,
  );
  await download(context, take, file);
  return file;
}

// The timing pipeline reads out/<lang>/take-N.mp3. An edited take exists only in storage, so it
// is written there first; its kie word alignment (if any) belongs to the original and goes.
export async function materializeEditedTake(
  context: StageContext,
  take: Take,
): Promise<void> {
  if (take.engine !== "edit") return;
  const n = take.take_number ?? 1;
  await rm(join(context.ws.outDir, `aligned-take${n}.json`), { force: true });
  await download(context, take, join(context.ws.outDir, `take-${n}.mp3`));
}
