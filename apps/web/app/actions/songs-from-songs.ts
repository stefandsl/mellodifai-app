"use server";
import { sectionEditDiscard } from "@/lib/ops/defs/section-edit-discard";
import { sectionEditKeep } from "@/lib/ops/defs/section-edit-keep";
import { sectionEditRequest } from "@/lib/ops/defs/section-edit-request";
import { songImport } from "@/lib/ops/defs/song-import";
import { songSourceSet } from "@/lib/ops/defs/song-source-set";
import { takeChoose } from "@/lib/ops/defs/take-choose";
import { runAction } from "@/lib/run-action";

export async function requestSectionEdit(input: unknown) {
  return runAction(sectionEditRequest, input);
}

export async function keepSectionEdit(input: unknown) {
  return runAction(sectionEditKeep, input);
}

export async function discardSectionEdit(input: unknown) {
  return runAction(sectionEditDiscard, input);
}

export async function chooseTake(input: unknown) {
  return runAction(takeChoose, input);
}

export async function importSong(input: unknown) {
  return runAction(songImport, input);
}

export async function setSongSource(input: unknown) {
  return runAction(songSourceSet, input);
}
