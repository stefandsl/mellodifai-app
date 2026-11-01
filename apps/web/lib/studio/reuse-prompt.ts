"use client";

import { toast } from "sonner";

import { initialForm, useCreateForm } from "@/store/create-form";
import type { Clip } from "./clips";
import { st } from "./i18n";

// Copies a song's prompt, lyrics and styles into the create form.
export function reusePrompt(clip: Clip, lang: "it" | "en"): void {
  const settings = clip.settings as Record<string, unknown>;
  useCreateForm.getState().set({
    ...initialForm(clip.lang),
    mode: clip.lyrics && clip.style ? "advanced" : "simple",
    prompt: clip.prompt,
    lyrics: clip.lyrics,
    styles: clip.style,
    title: typeof settings.title === "string" ? settings.title : "",
    languages: [clip.lang],
  });
  toast.success(st(lang, "clip.reused"));
}
