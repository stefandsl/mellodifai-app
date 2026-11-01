"use client";

import { toast } from "sonner";

import { restoreVersions, trashVersions } from "@/app/actions/library";
import { dropFromDetails } from "@/store/details";
import { usePlayer } from "@/store/player";
import { st, stf } from "./i18n";

type Lang = "it" | "en";
type Hooks = {
  refresh: () => void;
  // Songs that left the list on screen, so the caller can hide them before fresh data arrives.
  onMoved?: (ids: string[]) => void;
};

async function run(
  call: (input: unknown) => Promise<{ ok: boolean; count?: number }>,
  ids: string[],
): Promise<number | null> {
  try {
    const result = await call({ versionIds: ids });
    return result.ok ? (result.count ?? 0) : null;
  } catch {
    return null;
  }
}

// Moves songs to the trash and tells the user how many actually moved ("2 of 3"). The player
// forgets them too. Returns the number moved.
export async function trashSongs(
  ids: string[],
  lang: Lang,
  hooks: Hooks,
): Promise<number> {
  const count = await run(trashVersions, ids);
  if (count === null) {
    toast.error(
      st(lang, ids.length === 1 ? "clip.trashFailed" : "feed.trashedNone"),
    );
    return 0;
  }
  if (count === 0) {
    toast.error(st(lang, "feed.trashedNone"));
    return 0;
  }
  usePlayer.getState().drop(ids);
  dropFromDetails(ids);
  hooks.onMoved?.(ids);
  const undo = {
    label: st(lang, "clip.undo"),
    onClick: () => void restoreSongs(ids, lang, { refresh: hooks.refresh }),
  };
  if (count < ids.length)
    toast.warning(
      stf(lang, "feed.trashedSome", {
        done: String(count),
        total: String(ids.length),
      }),
      { action: undo },
    );
  else
    toast.success(
      ids.length === 1
        ? st(lang, "clip.trashed")
        : stf(lang, "feed.trashedAll", { n: String(count) }),
      { action: undo },
    );
  hooks.refresh();
  return count;
}

export async function restoreSongs(
  ids: string[],
  lang: Lang,
  hooks: Hooks,
): Promise<number> {
  const count = await run(restoreVersions, ids);
  if (count === null) {
    toast.error(
      st(lang, ids.length === 1 ? "clip.restoreFailed" : "feed.restoredNone"),
    );
    return 0;
  }
  if (count === 0) {
    toast.error(st(lang, "feed.restoredNone"));
    return 0;
  }
  hooks.onMoved?.(ids);
  if (count < ids.length)
    toast.warning(
      stf(lang, "feed.restoredSome", {
        done: String(count),
        total: String(ids.length),
      }),
    );
  else
    toast.success(
      ids.length === 1
        ? st(lang, "clip.restored")
        : stf(lang, "feed.restoredAll", { n: String(count) }),
    );
  hooks.refresh();
  return count;
}
