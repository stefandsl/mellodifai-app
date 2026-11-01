"use server";
import { runAction } from "@/lib/run-action";
import {
  PlaylistIdInput,
  PlaylistNameInput,
  PlaylistRenameInput,
  PlaylistReorderInput,
  PlaylistSongsInput,
} from "./schemas";

// Every playlist write is an owner-checked RPC (migration 20261101000019). The ones that move
// songs return how many really changed in `count`, so a partial result can be reported.

// The new playlist's id comes back in `id`.
export async function createPlaylist(input: unknown) {
  return runAction(async (db) => {
    const v = PlaylistNameInput.parse(input);
    const { data, error } = await db.rpc("create_playlist", { p_name: v.name });
    if (error) throw error;
    return { id: String(data) };
  });
}

export async function renamePlaylist(input: unknown) {
  return runAction(async (db) => {
    const v = PlaylistRenameInput.parse(input);
    const { error } = await db.rpc("rename_playlist", {
      p_playlist: v.playlistId,
      p_name: v.name,
    });
    if (error) throw error;
    return {};
  });
}

export async function deletePlaylist(input: unknown) {
  return runAction(async (db) => {
    const v = PlaylistIdInput.parse(input);
    const { error } = await db.rpc("delete_playlist", {
      p_playlist: v.playlistId,
    });
    if (error) throw error;
    return {};
  });
}

export async function addToPlaylist(input: unknown) {
  return runAction(async (db) => {
    const v = PlaylistSongsInput.parse(input);
    const { data, error } = await db.rpc("add_to_playlist", {
      p_playlist: v.playlistId,
      p_versions: v.versionIds,
    });
    if (error) throw error;
    return { count: Number(data) };
  });
}

export async function removeFromPlaylist(input: unknown) {
  return runAction(async (db) => {
    const v = PlaylistSongsInput.parse(input);
    const { data, error } = await db.rpc("remove_from_playlist", {
      p_playlist: v.playlistId,
      p_versions: v.versionIds,
    });
    if (error) throw error;
    return { count: Number(data) };
  });
}

export async function reorderPlaylist(input: unknown) {
  return runAction(async (db) => {
    const v = PlaylistReorderInput.parse(input);
    const { error } = await db.rpc("reorder_playlist", {
      p_playlist: v.playlistId,
      p_versions: v.versionIds,
    });
    if (error) throw error;
    return {};
  });
}
