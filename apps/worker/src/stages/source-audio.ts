import { mkdir, writeFile } from "node:fs/promises";
import { extname, join } from "node:path";
import {
  type AudioSource,
  AudioSourceSchema,
  KIE_AUDIO_WEIGHT,
  KIE_CREDITS,
  KIE_SOURCE_MAX_SECONDS,
  type LyricPack,
} from "@mellodifai/shared";
import { KieClient, KieRefused } from "../kie/client.js";
import type { StageContext } from "../loop.js";
import { encode, probeSeconds } from "./audio-util.js";

export const SOURCE_TEXT = {
  invalid: "L'audio di partenza di questa canzone non è leggibile.",
  gone: "L'audio di partenza non esiste più.",
  tooLong: "kie accetta audio di partenza fino a 8 minuti.",
  notCharged:
    "kie submission was not charged; correct the issue and generate again",
  unknown: "kie submission state unknown, check the kie dashboard",
};

// The audio a song starts from (song_settings.source), or null for a plain song.
export function songSource(songSettings: unknown): AudioSource | null {
  const raw =
    songSettings && typeof songSettings === "object"
      ? (songSettings as { source?: unknown }).source
      : undefined;
  if (raw === undefined || raw === null) return null;
  const parsed = AudioSourceSchema.safeParse(raw);
  if (!parsed.success) throw new Error(SOURCE_TEXT.invalid);
  return parsed.data;
}

// Fetches the source into `dir`: the owner's upload (uploads bucket) or one of the owner's takes.
export async function fetchSource(
  context: StageContext,
  source: AudioSource,
  dir: string,
): Promise<string> {
  await mkdir(dir, { recursive: true });
  if (!context.storage.download)
    throw new Error("This worker cannot download stored audio");
  const owner = context.project.owner_id ?? context.version.owner_id;
  if (source.upload) {
    if (owner && !source.upload.startsWith(`${owner}/`))
      throw new Error(SOURCE_TEXT.gone);
    const file = join(dir, `source${extname(source.upload)}`);
    await context.storage.download(source.upload, file, "uploads");
    return file;
  }
  const take = source.takeId ? await context.db.getTake(source.takeId) : null;
  if (
    !take?.audio_preview_path ||
    (owner && take.owner_id && take.owner_id !== owner)
  )
    throw new Error(SOURCE_TEXT.gone);
  const file = join(dir, `source${extname(take.audio_preview_path) || ".mp3"}`);
  await context.storage.download(take.audio_preview_path, file);
  return file;
}

// The kie request for a song made from audio: upload-and-cover-audio (cover, or reference with a
// low audio weight) or upload-and-extend-audio, with the song's lyric pack.
export function kieSourceTask(
  source: AudioSource,
  pack: LyricPack,
  uploadUrl: string,
): { model: string; input: Record<string, unknown> } {
  const instrumental = !pack.lyrics.trim();
  const input: Record<string, unknown> = {
    upload_url: uploadUrl,
    model: pack.settings.model,
    instrumental,
    title: pack.title.slice(0, 80),
    style: pack.style.slice(0, 1000),
    ...(instrumental ? {} : { lyrics: pack.lyrics }),
    ...(pack.exclude ? { negative_tags: pack.exclude } : {}),
    ...(pack.settings.vocalGender && !instrumental
      ? { vocal_gender: pack.settings.vocalGender }
      : {}),
    style_weight: pack.settings.styleWeight,
    weirdness_constraint: pack.settings.weirdness,
    variety: pack.settings.variety,
  };
  if (source.mode === "extend")
    return {
      model: "ai-music-api/upload-and-extend-audio",
      input: {
        ...input,
        ...(source.continueAt ? { continue_at: source.continueAt } : {}),
      },
    };
  return {
    model: "ai-music-api/upload-and-cover-audio",
    input: {
      ...input,
      audio_weight: KIE_AUDIO_WEIGHT[source.mode],
      ...(pack.settings.duration ? { duration: pack.settings.duration } : {}),
    },
  };
}

// Submits a song made from audio to kie and writes out/<lang>/task.json as `kie.mjs generate`
// does, so the rest of generate_song (wait, word timestamps, previews) runs unchanged. Errors
// carry generate_song's two sentences: not charged, or state unknown.
export async function submitSourceTask(
  context: StageContext,
  source: AudioSource,
  pack: LyricPack,
  client = new KieClient(context.secrets.values.KIE_API_KEY ?? ""),
): Promise<string> {
  const dir = join(context.ws.root, "source");
  let file: string;
  let url: string;
  try {
    file = await fetchSource(context, source, dir);
    const seconds = await probeSeconds(context, file);
    if (seconds > KIE_SOURCE_MAX_SECONDS)
      throw new KieRefused(SOURCE_TEXT.tooLong);
    const credits = await client.credits();
    if (credits < KIE_CREDITS.cover)
      throw new KieRefused(
        `balance ${credits} credits < ${KIE_CREDITS.cover} needed for one call`,
      );
    // kie reads mp3; a FLAC or WAV upload goes as a 320k copy.
    if (!/\.mp3$/iu.test(file)) {
      const mp3 = join(dir, "source.mp3");
      await encode(context, file, mp3, { mp3: 320 });
      file = mp3;
    }
    url = await client.upload(file, "audio/mpeg");
  } catch (error) {
    await context.log(
      context.secrets.redact(`Source not sent: ${String(error)}`),
    );
    throw new Error(
      error instanceof KieRefused
        ? `${SOURCE_TEXT.notCharged}: ${error.message}`
        : SOURCE_TEXT.notCharged,
    );
  }
  let taskId: string;
  try {
    taskId = await client.createTask(kieSourceTask(source, pack, url));
  } catch (error) {
    if (error instanceof KieRefused) {
      await context.log(context.secrets.redact(error.message));
      throw new Error(SOURCE_TEXT.notCharged);
    }
    throw new Error(SOURCE_TEXT.unknown);
  }
  await writeFile(
    join(context.ws.outDir, "task.json"),
    JSON.stringify({ taskId, submitted: new Date().toISOString() }, null, 1),
  );
  await context.log(`submitted ${source.mode} from audio: taskId=${taskId}`);
  return taskId;
}
