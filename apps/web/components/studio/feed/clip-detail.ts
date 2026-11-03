import type { Clip } from "@/lib/studio/clips";
import { canRewrite } from "@/lib/studio/rewrite";
import { canEdit, canSeparate } from "@/lib/studio/stems";
import type { TrackDetail } from "@/store/player";
import { modelLabel } from "../create/model-select";

// What made the song: the local engine's name, else the kie model ("v6").
export function clipBadge(
  clip: Pick<Clip, "model" | "settings" | "source">,
): string {
  // An imported recording was not made here: name where it came from, not a model.
  if (clip.source?.kind === "suno") return "Suno";
  if (clip.source?.kind === "upload") return "Audio";
  if (clip.settings.engine === "yue2") return "YuE2";
  if (clip.settings.engine === "ace-step") return "ACE-Step";
  return modelLabel(clip.model);
}

// What the listening view shows for a song; takeNumber is set for a take preview.
export function detailFor(clip: Clip, takeNumber?: number): TrackDetail {
  return {
    songId: clip.id,
    lyrics: clip.lyrics,
    style: clip.style,
    createdAt: clip.createdAt,
    takes: clip.takes.map(({ id, number, audioUrl, lyrics, timing }) => ({
      id,
      number,
      audioUrl,
      lyrics,
      timing,
    })),
    chosenTakeId: clip.chosenTakeId,
    ...(takeNumber === undefined ? {} : { takeNumber }),
    tools: {
      edit: canEdit(clip),
      stems: canSeparate(clip),
      rewrite: canRewrite(clip),
    },
    own: {
      title: clip.title,
      subtitle: `${clip.lang.toUpperCase()} · ${clipBadge(clip)}`,
      videoUrl: clip.videoUrl,
      reaction: clip.reaction,
    },
  };
}
