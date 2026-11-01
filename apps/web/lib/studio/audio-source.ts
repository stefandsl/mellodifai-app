"use client";

import type { SourceMode } from "@mellodifai/shared";
import { toast } from "sonner";

import { useCreateForm } from "@/store/create-form";
import type { Clip } from "./clips";
import { st } from "./i18n";

// The take a song gives to the create panel as audio: its chosen take, else its first one.
export function sourceTake(clip: Clip): { id: string; url: string } | null {
  const take =
    clip.takes.find((item) => item.id === clip.chosenTakeId && item.audioUrl) ??
    clip.takes.find((item) => item.audioUrl);
  return take?.audioUrl ? { id: take.id, url: take.audioUrl } : null;
}

export function canStartFrom(clip: Clip): boolean {
  return !clip.trashedAt && sourceTake(clip) !== null;
}

// "Cover di questa canzone" / "Usa come riferimento" (and a song dropped on the panel): the
// create form gets the song's take as its audio, in advanced mode, and the Create page opens.
export function startFromSong(
  clip: Clip,
  mode: SourceMode,
  lang: "it" | "en",
  navigate?: (href: string) => void,
): void {
  const take = sourceTake(clip);
  if (!take) return;
  const form = useCreateForm.getState();
  form.set({
    mode: "advanced",
    audio: {
      mode,
      takeId: take.id,
      versionId: clip.id,
      title: clip.title || st(lang, "clip.untitled"),
      url: take.url,
    },
    open: { ...form.open, audio: true },
    // A cover keeps the words of the song unless the owner writes new ones.
    ...(mode === "cover" && !form.lyrics.trim() ? { lyrics: clip.lyrics } : {}),
  });
  toast.success(st(lang, "aud.set"));
  navigate?.("/create");
}

// The MIME type a dragged song card carries.
export const SONG_DRAG_TYPE = "application/x-mellodifai-song";
