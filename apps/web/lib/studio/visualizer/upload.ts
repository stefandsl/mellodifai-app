import {
  IMAGE_TYPES,
  UPLOAD_LIMITS,
  UPLOADS_BUCKET,
  uploadUrlOf,
  VIDEO_TYPES,
} from "@mellodifai/shared";

import { createClient } from "@/lib/supabase/browser";

export type UploadKind = "image" | "video";

const EXT: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "video/mp4": "mp4",
  "video/webm": "webm",
};

// Why a file cannot be used, before it is sent: the same limits request_visualizer checks.
export function uploadProblem(
  file: Pick<File, "size" | "type">,
  kind: UploadKind,
): "wrongType" | "tooBig" | null {
  const types: readonly string[] = kind === "image" ? IMAGE_TYPES : VIDEO_TYPES;
  if (!types.includes(file.type)) return "wrongType";
  if (file.size > UPLOAD_LIMITS[kind]) return "tooBig";
  return null;
}

export const limitLabel = (kind: UploadKind) =>
  `${Math.round(UPLOAD_LIMITS[kind] / 1024 / 1024)} MB`;

// Stores a picture or video in the private uploads bucket under the user's folder and returns
// the /media link the parameters keep.
export async function uploadStudioFile(file: File): Promise<string> {
  const supabase = createClient();
  const { data } = await supabase.auth.getUser();
  const uid = data.user?.id;
  if (!uid) throw new Error("not signed in");
  const path = `${uid}/${crypto.randomUUID()}.${EXT[file.type] ?? "bin"}`;
  const { error } = await supabase.storage
    .from(UPLOADS_BUCKET)
    .upload(path, file, { contentType: file.type, upsert: false });
  if (error) throw error;
  return uploadUrlOf(path);
}
