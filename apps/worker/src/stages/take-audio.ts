import { copyFile, rm, stat } from "node:fs/promises";
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

// The full-quality copy of a kept rewrite (stages/replace-section.ts sectionFile).
export function rewrittenFile(
  context: StageContext,
  take: Take,
): string | null {
  const source = take.source as
    | { kind?: unknown; edit_id?: unknown; alternative?: unknown }
    | null
    | undefined;
  if (source?.kind !== "replace" || typeof source.edit_id !== "string")
    return null;
  const n = typeof source.alternative === "number" ? source.alternative : 0;
  return join(context.ws.outDir, "sections", `${source.edit_id}-${n + 1}.mp3`);
}

// The best local file of a take: the workspace keeps the full-quality files of the current
// generation (out/<lang>/take-N.flac from a local engine, take-N.mp3 from kie, an import or any
// engine, sections/<edit>-N.mp3 for a rewritten part); anything else (an edit, an older
// generation) is fetched from storage into `dir`.
export async function takeAudio(
  context: StageContext,
  take: Take,
  dir: string,
): Promise<string> {
  const rewritten = rewrittenFile(context, take);
  if (rewritten && (await exists(rewritten))) return rewritten;
  const current =
    (take.generation ?? 1) === (context.version.generation_count ?? 1);
  if (
    take.engine !== "edit" &&
    !rewritten &&
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

// The timing pipeline reads out/<lang>/take-N.mp3. An edited take exists only in storage and a
// rewritten one in sections/, so it is written there first; a kie word alignment of that number
// belongs to another take and goes.
export async function materializeEditedTake(
  context: StageContext,
  take: Take,
): Promise<void> {
  const rewritten = rewrittenFile(context, take);
  if (take.engine !== "edit" && !rewritten) return;
  const n = take.take_number ?? 1;
  const target = join(context.ws.outDir, `take-${n}.mp3`);
  await rm(join(context.ws.outDir, `aligned-take${n}.json`), { force: true });
  if (rewritten && (await exists(rewritten))) await copyFile(rewritten, target);
  else await download(context, take, target);
}
