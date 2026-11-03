"use server";
import { playlistAdd } from "@/lib/ops/defs/playlist-add";
import { playlistCreate } from "@/lib/ops/defs/playlist-create";
import { playlistDelete } from "@/lib/ops/defs/playlist-delete";
import { playlistRemove } from "@/lib/ops/defs/playlist-remove";
import { playlistRename } from "@/lib/ops/defs/playlist-rename";
import { playlistReorder } from "@/lib/ops/defs/playlist-reorder";
import { runAction } from "@/lib/run-action";

export async function createPlaylist(input: unknown) {
  return runAction(playlistCreate, input);
}

export async function renamePlaylist(input: unknown) {
  return runAction(playlistRename, input);
}

export async function deletePlaylist(input: unknown) {
  return runAction(playlistDelete, input);
}

export async function addToPlaylist(input: unknown) {
  return runAction(playlistAdd, input);
}

export async function removeFromPlaylist(input: unknown) {
  return runAction(playlistRemove, input);
}

export async function reorderPlaylist(input: unknown) {
  return runAction(playlistReorder, input);
}
