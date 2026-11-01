import type { Clip } from "@/lib/studio/clips";
import { canEdit, canSeparate } from "@/lib/studio/stems";
import type { TrackDetail } from "@/store/player";
import { modelLabel } from "../create/model-select";

// What made the song: the local engine's name, else the kie model ("v6").
export function clipBadge(clip: Pick<Clip, "model" | "settings">): string {
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
    takes: clip.takes.map(({ id, number, audioUrl }) => ({
      id,
      number,
      audioUrl,
    })),
    chosenTakeId: clip.chosenTakeId,
    ...(takeNumber === undefined ? {} : { takeNumber }),
    tools: { edit: canEdit(clip), stems: canSeparate(clip) },
    own: {
      title: clip.title,
      subtitle: `${clip.lang.toUpperCase()} · ${clipBadge(clip)}`,
      videoUrl: clip.videoUrl,
      reaction: clip.reaction,
    },
  };
}
