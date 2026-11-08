import type { SupabaseClient } from "@supabase/supabase-js";

import { saveEditedTake } from "@/app/actions/audio-tools";

export type SaveStep = "uploading" | "saving";

// Stores an edited MP3 as the song's new chosen take: the file goes to
// previews/edits/<owner>/<song>/<uuid>.mp3 (the only folder the browser may write), then
// save_edited_take records it. A file that could not be recorded is removed again.
export async function saveEdit(
  supabase: SupabaseClient,
  versionId: string,
  mp3: Blob,
  onStep?: (step: SaveStep) => void,
): Promise<{ ok: boolean }> {
  const { data } = await supabase.auth.getUser();
  const owner = data.user?.id;
  if (!owner) return { ok: false };
  const path = `edits/${owner}/${versionId}/${crypto.randomUUID()}.mp3`;
  onStep?.("uploading");
  const bucket = supabase.storage.from("previews");
  const upload = await bucket.upload(path, mp3, {
    contentType: "audio/mpeg",
    upsert: false,
  });
  if (upload.error) return { ok: false };
  onStep?.("saving");
  const result = await saveEditedTake({ versionId, path });
  if (!result.ok) {
    // A lost reply may follow a committed save; deleting its file would break the chosen take.
    if (result.code !== "internal" && result.code !== "ambiguous_spend")
      await bucket.remove([path]);
    return { ok: false };
  }
  return { ok: true };
}
