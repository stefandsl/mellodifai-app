import { useEffect } from "react";
import { create } from "zustand";
import { persist } from "zustand/middleware";

import type { Clip } from "@/lib/studio/clips";

// The song shown in the details panel, and whether the panel is open. Both survive a reload.
// `picked` does not: it says the song was picked on this page visit, which a panel that covers
// the page (a sheet) needs before it opens, so a reload never greets the user with a sheet.
type State = {
  open: boolean;
  selectedId: string | null;
  picked: boolean;
};

type Actions = {
  show: (id: string) => void;
  close: () => void;
  // The picked song left the library (trash): the panel lets go of it.
  forget: (ids: string[]) => void;
};

export const useDetails = create<State & Actions>()(
  persist(
    (set, get) => ({
      open: false,
      selectedId: null,
      picked: false,
      show: (id) => set({ open: true, selectedId: id, picked: true }),
      close: () => set({ open: false }),
      forget: (ids) => {
        const { selectedId } = get();
        if (selectedId && ids.includes(selectedId)) set({ selectedId: null });
      },
    }),
    {
      name: "mellodifai-details",
      version: 1,
      // Loaded after hydration (DetailsPanel), so the first client render matches the server's.
      skipHydration: true,
      partialize: (state) => ({
        open: state.open,
        selectedId: state.selectedId,
      }),
      merge: (saved, current) => {
        const value = (saved ?? {}) as { open?: unknown; selectedId?: unknown };
        return {
          ...current,
          open: value.open === true,
          selectedId:
            typeof value.selectedId === "string" ? value.selectedId : null,
        };
      },
    },
  ),
);

// The songs of the page on screen, so the panel can show one without loading it again. Kept
// apart from the choice above: filling it must never write the stored choice before the
// panel has read it.
type KnownState = { known: Record<string, Clip> };
type KnownActions = {
  sync: (clips: Clip[]) => void;
  drop: (ids: string[]) => void;
};

export const useKnownClips = create<KnownState & KnownActions>()((set) => ({
  known: {},
  sync: (clips) =>
    set({ known: Object.fromEntries(clips.map((clip) => [clip.id, clip])) }),
  drop: (ids) =>
    set((s) => ({
      known: Object.fromEntries(
        Object.entries(s.known).filter(([id]) => !ids.includes(id)),
      ),
    })),
}));

// Songs that left the library: the panel forgets them.
export function dropFromDetails(ids: string[]): void {
  useDetails.getState().forget(ids);
  useKnownClips.getState().drop(ids);
}

// A page tells the panel which songs it shows, so a click on a card can open them.
export function useDetailsClips(clips: Clip[]): void {
  const sync = useKnownClips((s) => s.sync);
  // The page's songs go when the page does: the panel never shows a song from another page.
  useEffect(() => {
    sync(clips);
    return () => sync([]);
  }, [clips, sync]);
}
