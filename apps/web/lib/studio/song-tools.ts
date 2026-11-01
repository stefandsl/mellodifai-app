import type { LucideIcon } from "lucide-react";
import { Clapperboard, Layers, RotateCcw, Scissors } from "lucide-react";
import { useVideoStudio } from "@/store/video-studio";
import { openStems } from "./audio-tools";
import type { Clip } from "./clips";
import type { StudioKey } from "./i18n";
import { reusePrompt } from "./reuse-prompt";
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
