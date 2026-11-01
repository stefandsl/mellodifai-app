"use server";
import { runAction } from "@/lib/run-action";
import {
  ReactionInput,
  RenameInput,
  VersionIdInput,
  VersionIdsInput,
} from "./schemas";

export async function setReaction(input: unknown) {
  return runAction(async (db) => {
    const v = ReactionInput.parse(input);
    const { error } = await db.rpc("set_reaction", {
      p_version: v.versionId,
      p_reaction: v.reaction,
    });
    if (error) throw error;
    return { versionId: v.versionId };
  });
}

// The player calls this once per track after 30 s of playback.
export async function countPlay(input: unknown) {
  return runAction(async (db) => {
    const v = VersionIdInput.parse(input);
    const { error } = await db.rpc("count_play", { p_version: v.versionId });
    if (error) throw error;
    return { versionId: v.versionId };
  });
}

export async function renameVersion(input: unknown) {
  return runAction(async (db) => {
    const v = RenameInput.parse(input);
    const { error } = await db.rpc("rename_version", {
      p_version: v.versionId,
      p_title: v.title,
    });
    if (error) throw error;
    return { versionId: v.versionId };
  });
}

// Both return how many songs changed in `count`, so a partial result can be reported.
export async function trashVersions(input: unknown) {
  return runAction(async (db) => {
    const v = VersionIdsInput.parse(input);
    const { data, error } = await db.rpc("trash_versions", {
      p_versions: v.versionIds,
    });
    if (error) throw error;
    return { count: Number(data) };
  });
}

export async function restoreVersions(input: unknown) {
  return runAction(async (db) => {
    const v = VersionIdsInput.parse(input);
    const { data, error } = await db.rpc("restore_versions", {
      p_versions: v.versionIds,
    });
    if (error) throw error;
    return { count: Number(data) };
  });
}
