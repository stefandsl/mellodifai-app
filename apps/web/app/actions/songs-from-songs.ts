"use server";
import { runAction } from "@/lib/run-action";
import {
  ChooseTakeInput,
  ImportSongInput,
  SectionEditInput,
  SectionIdInput,
  SectionKeepInput,
  SongSourceInput,
} from "./schemas";

// "Riscrivi una parte": queues the alternatives of a part of a take (free on the PC with
// ACE-Step, kie's credits only once the worker submits). The song itself does not change.
export async function requestSectionEdit(input: unknown) {
  return runAction(async (db) => {
    const v = SectionEditInput.parse(input);
    const { data, error } = await db.rpc("request_section_edit", {
      p_version: v.versionId,
      p_take: v.takeId,
      p_engine: v.engine,
      p_start: Math.round(v.start * 100) / 100,
      p_end: Math.round(v.end * 100) / 100,
      p_duration: Math.round(v.duration * 100) / 100,
      p_lines: v.lines,
      p_section: v.section,
      p_full: v.full,
    });
    if (error) throw error;
    return { versionId: v.versionId, id: String(data) };
  });
}

// Keeps one alternative as a new take next to the original.
export async function keepSectionEdit(input: unknown) {
  return runAction(async (db) => {
    const v = SectionKeepInput.parse(input);
    const { data, error } = await db.rpc("keep_section_edit", {
      p_edit: v.editId,
      p_alternative: v.alternative,
    });
    if (error) throw error;
    return { id: String(data) };
  });
}

export async function discardSectionEdit(input: unknown) {
  return runAction(async (db) => {
    const v = SectionIdInput.parse(input);
    const { error } = await db.rpc("discard_section_edit", {
      p_edit: v.editId,
    });
    if (error) throw error;
    return {};
  });
}

// Makes another take of the song its audio again (A/B after a rewrite).
export async function chooseTake(input: unknown) {
  return runAction(async (db) => {
    const v = ChooseTakeInput.parse(input);
    const { error } = await db.rpc("choose_take", {
      p_version: v.versionId,
      p_take: v.takeId,
    });
    if (error) throw error;
    return { versionId: v.versionId };
  });
}

// "Importa da Suno": one song from an uploaded recording.
export async function importSong(input: unknown) {
  return runAction(async (db) => {
    const v = ImportSongInput.parse(input);
    const { data, error } = await db.rpc("import_song", {
      p_title: v.title,
      p_style: v.style,
      p_lyrics: v.lyrics,
      p_lang: v.lang,
      p_upload: v.upload,
      p_source: v.source,
    });
    if (error) throw error;
    return { projectId: String(data) };
  });
}

// The title, author, link and licence of a song's source.
export async function setSongSource(input: unknown) {
  return runAction(async (db) => {
    const v = SongSourceInput.parse(input);
    const { error } = await db.rpc("set_song_source", {
      p_version: v.versionId,
      p_source: v.source,
    });
    if (error) throw error;
    return { versionId: v.versionId };
  });
}
