"use server";
import { runAction } from "@/lib/run-action";
import { AlignLyricsInput } from "./schemas";

export async function requestLyricAlignment(input: unknown) {
  return runAction(async (db) => {
    const { versionId, takeId } = AlignLyricsInput.parse(input);
    const { data, error } = await db.rpc("request_lyric_alignment", {
      p_version: versionId,
      p_take: takeId,
    });
    if (error) throw error;
    return { versionId, id: String(data) };
  });
}
