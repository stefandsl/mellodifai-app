import { create } from "zustand";

import type { Reaction } from "@/lib/studio/clips";

export type Track = {
  id: string;
  title: string;
  subtitle: string;
  audioUrl: string;
  videoUrl: string | null;
  href: string;
  art: string;
  // The reaction when the track was queued (the live value comes from the reactions store), or
  // null for a preview that is not a library song, like a take: it cannot be liked or counted.
  reaction: Reaction | null;
};

type PlayerState = {
  queue: Track[];
  index: number;
  playing: boolean;
  time: number;
  duration: number;
  volume: number;
  muted: boolean;
  shuffle: boolean;
  repeat: boolean;
  showVideo: boolean;
  showQueue: boolean;
  // Bumped when the bar should move the audio element to `time`.
  seekTo: { at: number; n: number };
};

type PlayerActions = {
  play: (track: Track, list?: Track[]) => void;
  toggle: () => void;
  next: () => void;
  prev: () => void;
  enqueue: (track: Track) => void;
  remove: (id: string) => void;
  // Takes songs out of the queue even when one is playing (they left the library).
  drop: (ids: string[]) => void;
  seek: (at: number) => void;
  set: (patch: Partial<PlayerState>) => void;
  ended: () => void;
};

export const usePlayer = create<PlayerState & PlayerActions>()((set, get) => ({
  queue: [],
  index: -1,
  playing: false,
  time: 0,
  duration: 0,
  volume: 0.9,
  muted: false,
  shuffle: false,
  repeat: false,
  showVideo: false,
  showQueue: false,
  seekTo: { at: 0, n: 0 },
  play: (track, list) => {
    const { queue, index } = get();
    if (queue[index]?.id === track.id) return set({ playing: true });
    const next = list?.some((item) => item.id === track.id) ? list : [track];
    set({
      queue: next,
      index: next.findIndex((item) => item.id === track.id),
      playing: true,
      time: 0,
      duration: 0,
    });
  },
  toggle: () => {
    if (get().index >= 0) set({ playing: !get().playing });
  },
  next: () => {
    const { queue, index, shuffle } = get();
    if (queue.length === 0) return;
    const target = shuffle
      ? Math.floor(Math.random() * queue.length)
      : (index + 1) % queue.length;
    set({ index: target, playing: true, time: 0, duration: 0 });
  },
  prev: () => {
    const { queue, index, time } = get();
    if (queue.length === 0) return;
    if (time > 3) return get().seek(0);
    set({
      index: (index - 1 + queue.length) % queue.length,
      playing: true,
      time: 0,
      duration: 0,
    });
  },
  enqueue: (track) => {
    const { queue, index } = get();
    if (queue.some((item) => item.id === track.id)) return;
    set({
      queue: [...queue, track],
      index: Math.max(index, 0),
    });
  },
  remove: (id) => {
    const { queue, index } = get();
    const at = queue.findIndex((item) => item.id === id);
    if (at < 0 || at === index) return;
    set({
      queue: queue.filter((item) => item.id !== id),
      index: at < index ? index - 1 : index,
    });
  },
  drop: (ids) => {
    const { queue, index } = get();
    const gone = new Set(ids);
    if (!queue.some((item) => gone.has(item.id))) return;
    const rest = queue.filter((item) => !gone.has(item.id));
    const current = queue[index];
    if (current && !gone.has(current.id))
      return set({ queue: rest, index: rest.indexOf(current) });
    // The playing song is gone: stop, and keep the cursor on what came next.
    const next = queue.slice(index).find((item) => !gone.has(item.id));
    set({
      queue: rest,
      index: next ? rest.indexOf(next) : -1,
      playing: false,
      time: 0,
      duration: 0,
    });
  },
  seek: (at) => set((s) => ({ time: at, seekTo: { at, n: s.seekTo.n + 1 } })),
  set: (patch) => set(patch),
  ended: () => {
    const { repeat, queue, index } = get();
    if (repeat) return get().seek(0);
    if (index < queue.length - 1 || get().shuffle) get().next();
    else set({ playing: false });
  },
}));

export function formatTime(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return "0:00";
  const s = Math.floor(seconds);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}
