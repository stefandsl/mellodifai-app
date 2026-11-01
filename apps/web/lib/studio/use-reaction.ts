"use client";

import { useRouter } from "next/navigation";
import { toast } from "sonner";

import { setReaction } from "@/app/actions/library";
import { useLocale } from "@/components/locale-provider";
import { useReactions } from "@/store/reactions";
import type { Reaction } from "./clips";
import { st } from "./i18n";

// The reaction a song shows (an unsaved click wins over page data) and the click handler for
// the like and dislike buttons: pressing the active one clears it.
export function useReaction(id: string, fallback: Reaction) {
  const lang = useLocale();
  const router = useRouter();
  const reaction = useReactions((s) => s.over[id] ?? s.server[id] ?? fallback);
  const toggle = async (kind: "like" | "dislike") => {
    const next: Reaction = reaction === kind ? "none" : kind;
    useReactions.getState().begin(id, next);
    let ok = false;
    try {
      ok = (await setReaction({ versionId: id, reaction: next })).ok;
    } catch {}
    useReactions.getState().end(id, ok);
    if (ok) router.refresh();
    else toast.error(st(lang, "clip.reactFailed"));
  };
  return { reaction, toggle };
}
