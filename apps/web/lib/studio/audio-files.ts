import {
  AUDIO_UPLOAD_LIMIT,
  UPLOADS_BUCKET,
  uploadUrlOf,
} from "@mellodifai/shared";
import type { SupabaseClient } from "@supabase/supabase-js";

// Recordings the studio takes in (the create panel's audio card, "Importa da Suno"): MP3, WAV and
// FLAC up to 50 MB, the local storage's upload limit today. Browsers name the same file type in
// several ways, so the extension decides when the type is unknown.
export type AudioExt = "mp3" | "wav" | "flac";
export const AUDIO_CONTENT_TYPE: Record<AudioExt, string> = {
  mp3: "audio/mpeg",
  wav: "audio/wav",
  flac: "audio/flac",
};
const BY_TYPE: Record<string, AudioExt> = {
  "audio/mpeg": "mp3",
  "audio/mp3": "mp3",
  "audio/wav": "wav",
  "audio/x-wav": "wav",
  "audio/wave": "wav",
  "audio/vnd.wave": "wav",
  "audio/flac": "flac",
  "audio/x-flac": "flac",
};
export const AUDIO_ACCEPT =
  ".mp3,.wav,.flac,audio/mpeg,audio/wav,audio/x-wav,audio/flac,audio/x-flac";

export function audioExt(file: Pick<File, "name" | "type">): AudioExt | null {
  const byType = BY_TYPE[file.type.toLowerCase()];
  if (byType) return byType;
  const ext = /\.([a-z0-9]+)$/iu.exec(file.name)?.[1]?.toLowerCase();
  return ext === "mp3" || ext === "wav" || ext === "flac" ? ext : null;
}

export function audioProblem(
  file: Pick<File, "name" | "type" | "size">,
): "wrongType" | "tooBig" | null {
  if (!audioExt(file)) return "wrongType";
  if (file.size > AUDIO_UPLOAD_LIMIT) return "tooBig";
  return null;
}

export const AUDIO_LIMIT_MB = Math.round(AUDIO_UPLOAD_LIMIT / 1024 / 1024);

// The file name without its extension, tidied, as a first guess at the title.
export function titleFromFile(name: string): string {
  return name
    .replace(/\.[a-z0-9]+$/iu, "")
    .replace(/[_]+/gu, " ")
    .replace(/\s+/gu, " ")
    .trim()
    .slice(0, 100);
}

// Stores a recording in the private uploads bucket (<owner>/audio/<uuid>.<ext>) and returns its
// path, which create_song and import_song check again.
export async function uploadAudio(
  supabase: SupabaseClient,
  file: File | Blob,
  name: string,
): Promise<string> {
  const ext = audioExt({ name, type: file.type });
  if (!ext) throw new Error("wrong type");
  const { data } = await supabase.auth.getUser();
  const uid = data.user?.id;
  if (!uid) throw new Error("not signed in");
  const path = `${uid}/audio/${crypto.randomUUID()}.${ext}`;
  const { error } = await supabase.storage
    .from(UPLOADS_BUCKET)
    .upload(path, file, {
      contentType: AUDIO_CONTENT_TYPE[ext],
      upsert: false,
    });
  if (error) throw error;
  return path;
}

export const uploadedAudioUrl = (path: string) => uploadUrlOf(path);

// The length of a recording in seconds, or null when the browser cannot decode it.
export async function audioSeconds(file: Blob): Promise<number | null> {
  try {
    const context = new AudioContext();
    try {
      const buffer = await context.decodeAudioData(await file.arrayBuffer());
      return Math.round(buffer.duration * 100) / 100;
    } finally {
      void context.close();
    }
  } catch {
    return null;
  }
}
