"use server";
import { playCount } from "@/lib/ops/defs/play-count";
import { reactionSet } from "@/lib/ops/defs/reaction-set";
import { songRename } from "@/lib/ops/defs/song-rename";
import { songsRestore } from "@/lib/ops/defs/songs-restore";
import { songsTrash } from "@/lib/ops/defs/songs-trash";
import { runAction } from "@/lib/run-action";

export async function setReaction(input: unknown) {
  return runAction(reactionSet, input);
}

export async function countPlay(input: unknown) {
  return runAction(playCount, input);
}

export async function renameVersion(input: unknown) {
  return runAction(songRename, input);
}

export async function trashVersions(input: unknown) {
  return runAction(songsTrash, input);
}

export async function restoreVersions(input: unknown) {
  return runAction(songsRestore, input);
}
