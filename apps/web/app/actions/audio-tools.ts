"use server";
import { runAction } from "@/lib/run-action";
import { SaveEditInput, VersionIdInput } from "./schemas";

// Queues the separation of the song's chosen take (free, on the render PC). Asking again for the
// same take returns the same job; a failed one is queued again.
export async function requestStems(input: unknown) {
  return runAction(async (db) => {
    const v = VersionIdInput.parse(input);
    const { data, error } = await db.rpc("request_stems", {
      p_version: v.versionId,
    });
    if (error) throw error;
    return { versionId: v.versionId, id: String(data) };
  });
}

// Records the editor's uploaded file as the song's new chosen take.
export async function saveEditedTake(input: unknown) {
  return runAction(async (db) => {
    const v = SaveEditInput.parse(input);
    const { data, error } = await db.rpc("save_edited_take", {
      p_version: v.versionId,
      p_path: v.path,
    });
    if (error) throw error;
    return { versionId: v.versionId, id: String(data) };
  });
}
