import type { LucideIcon } from "lucide-react";
import {
  Clapperboard,
  Disc3,
  Layers,
  PenLine,
  RotateCcw,
  Scissors,
  Sparkles,
} from "lucide-react";
import { useVideoStudio } from "@/store/video-studio";
import { canStartFrom, startFromSong } from "./audio-source";
import { openStems } from "./audio-tools";
import type { Clip } from "./clips";
import type { StudioKey } from "./i18n";
import { reusePrompt } from "./reuse-prompt";
import { canRewrite, rewriteHref } from "./rewrite";
import { canEdit, canSeparate, editorHref } from "./stems";

// The tool buttons of the song details panel. Later features (video studio, stems, editor,
// cover, reference, repaint) call `registerSongTool` when they exist, and their button appears
// in the panel for the songs they `available` for; nothing is shown for a feature that is not
// built.
export type SongToolContext = {
  clip: Clip;
  lang: "it" | "en";
  // Opens a page of the app (the panel uses the router).
  navigate: (href: string) => void;
};

export type SongTool = {
  id: string;
  label: StudioKey;
  icon: LucideIcon;
  // Lower first. Built-in tools use 0 to 99, features registered later 100 and up.
  order: number;
  available?: (clip: Clip) => boolean;
  run: (context: SongToolContext) => void;
};

const tools = new Map<string, SongTool>();

// Registers (or replaces) a tool; the returned function removes it again.
export function registerSongTool(tool: SongTool): () => void {
  tools.set(tool.id, tool);
  return () => {
    if (tools.get(tool.id) === tool) tools.delete(tool.id);
  };
}

export function songToolsFor(clip: Clip): SongTool[] {
  return [...tools.values()]
    .filter((tool) => !tool.available || tool.available(clip))
    .sort((a, b) => a.order - b.order || a.id.localeCompare(b.id));
}

registerSongTool({
  id: "reuse-prompt",
  label: "clip.reuse",
  icon: RotateCcw,
  order: 10,
  run: ({ clip, lang }) => reusePrompt(clip, lang),
});

registerSongTool({
  id: "edit-audio",
  label: "tool.edit",
  icon: Scissors,
  order: 20,
  available: canEdit,
  run: ({ clip, navigate }) => navigate(editorHref(clip.id)),
});

registerSongTool({
  id: "stems",
  label: "tool.stems",
  icon: Layers,
  order: 30,
  available: canSeparate,
  run: ({ clip, lang, navigate }) => void openStems(clip, lang, navigate),
});

// The Video Studio, for a song whose chosen take has audio (request_visualizer).
registerSongTool({
  id: "video",
  label: "vs.create",
  icon: Clapperboard,
  order: 15,
  available: canSeparate,
  run: ({ clip }) => useVideoStudio.getState().openFor(clip),
});

// "Riscrivi una parte" (T12): the editor's rewrite tab.
registerSongTool({
  id: "rewrite",
  label: "tool.rewrite",
  icon: PenLine,
  order: 25,
  available: canRewrite,
  run: ({ clip, navigate }) => navigate(rewriteHref(clip.id)),
});

// The song's take as the audio of a new one (T12).
registerSongTool({
  id: "cover",
  label: "clip.coverThis",
  icon: Disc3,
  order: 40,
  available: canStartFrom,
  run: ({ clip, lang, navigate }) =>
    startFromSong(clip, "cover", lang, navigate),
});
registerSongTool({
  id: "reference",
  label: "clip.useReference",
  icon: Sparkles,
  order: 45,
  available: canStartFrom,
  run: ({ clip, lang, navigate }) =>
    startFromSong(clip, "reference", lang, navigate),
});
