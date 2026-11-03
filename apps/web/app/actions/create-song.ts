"use server";
import { songCreate } from "@/lib/ops/defs/song-create";
import { runAction } from "@/lib/run-action";
import { CreateSongInput } from "./schemas";

export async function createSong(input: unknown) {
  return runAction(songCreate, input, {
    count: CreateSongInput.safeParse(input).data?.count,
  });
}
