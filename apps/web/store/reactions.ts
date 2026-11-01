import { create } from "zustand";

import type { Reaction } from "@/lib/studio/clips";

// Likes and dislikes as the screen should show them. `server` is the last value the page data
// carried; `over` holds a click until the server has confirmed it and the page data caught up,
// so a button answers at once and a failure puts it back.
type State = {
  server: Record<string, Reaction>;
  over: Record<string, Reaction>;
  pending: Record<string, number>;
};

type Actions = {
  sync: (items: { id: string; reaction: Reaction }[]) => void;
  begin: (id: string, reaction: Reaction) => void;
  end: (id: string, ok: boolean) => void;
};

export const useReactions = create<State & Actions>()((set) => ({
  server: {},
  over: {},
  pending: {},
  sync: (items) =>
    set((s) => {
      const server = { ...s.server };
      const over = { ...s.over };
      for (const { id, reaction } of items) {
        server[id] = reaction;
        // Fresh page data is the truth, unless a click is still being saved.
        if (!s.pending[id]) delete over[id];
      }
      return { server, over };
    }),
  begin: (id, reaction) =>
    set((s) => ({
      over: { ...s.over, [id]: reaction },
      pending: { ...s.pending, [id]: (s.pending[id] ?? 0) + 1 },
    })),
  end: (id, ok) =>
    set((s) => {
      const left = (s.pending[id] ?? 1) - 1;
      const pending = { ...s.pending, [id]: left };
      if (left > 0 || ok) return { pending };
      const over = { ...s.over };
      delete over[id];
      return { pending, over };
    }),
}));
