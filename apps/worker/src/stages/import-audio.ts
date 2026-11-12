import { copyFile, mkdir, rm } from "node:fs/promises";
import { extname, join } from "node:path";
import { LyricPackSchema } from "@mellodifai/shared";
import type { StageHandler } from "../loop.js";
import { encode, probeSeconds } from "./audio-util.js";
import { scoreTakes } from "./score-takes.js";
import { upload, writePack } from "./utils.js";

export const IMPORT_TEXT = {
  invalid: "Il file da importare non è valido.",
  unreadable: "Il file caricato non contiene un audio leggibile.",
};

// "Importa da Suno": the uploaded recording (uploads/<owner>/audio/<uuid>.<ext>) becomes take 1
// of the song, as a generated take would be: the full-quality MP3 in out/<lang>/take-1.mp3 for
// the video and the stems, a 128k preview for the studio, and Groq Whisper's words as its timing.
export const importAudio: StageHandler = async (context) => {
  const payload = (context.job.payload ?? {}) as { upload?: unknown };
  const owner = context.project.owner_id ?? context.version.owner_id;
  const path = typeof payload.upload === "string" ? payload.upload : "";
  if (
    !owner ||
    !new RegExp(`^${owner}/audio/[0-9a-f-]{36}\\.(mp3|wav|flac)$`, "u").test(
      path,
    )
  )
    throw new Error(IMPORT_TEXT.invalid);
  if (!context.storage.download)
    throw new Error("This worker cannot download stored audio");
  const dir = join(context.ws.root, "import");
  await rm(dir, { recursive: true, force: true });
  await mkdir(dir, { recursive: true });
  try {
    await context.progress(5, "Importo l'audio");
    const source = join(dir, `source${extname(path)}`);
    await context.storage.download(path, source, "uploads");
    const seconds = await probeSeconds(context, source);
    if (seconds <= 0) throw new Error(IMPORT_TEXT.unreadable);
    const generation = context.version.generation_count ?? 1;
    const full = join(context.ws.outDir, "take-1.mp3");
    // An MP3 from Suno is kept as it is; a WAV or FLAC becomes a 320k MP3.
    if (extname(path) === ".mp3") await copyFile(source, full);
    else await encode(context, source, full, { mp3: 320 });
    if (extname(path) === ".flac")
      await copyFile(source, join(context.ws.outDir, "take-1.flac"));
    await context.progress(40, "Preparo l'anteprima");
    const preview = join(context.ws.outDir, "take-1-preview.mp3");
    await encode(context, full, preview, { mp3: 128 });
    const take = await context.db.createTake({
      ...(context.version.owner_id
        ? { owner_id: context.version.owner_id }
        : {}),
      version_id: context.version.id,
      generation,
      take_number: 1,
      engine: "import",
      audio_preview_path: await upload(context, preview, "audio/mpeg"),
      cover_path: null,
      source: { kind: "import", upload: path },
    });
    await context.progress(60, "Ascolto il brano per il testo");
    // score_takes.py compares what it hears with versions/<lang>/lyrics.txt.
    const pack = LyricPackSchema.safeParse(context.version.lyric_pack);
    if (pack.success) await writePack(context, pack.data);
    // Length, loudness and the heard words (the lines "Riscrivi una parte" lights up).
    await scoreTakes(context, [take]);
    await context.progress(100, "Canzone importata");
    return {
      versionStatus: "audio_ready",
      patch: { chosen_take_id: take.id },
    };
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => {});
  }
};
