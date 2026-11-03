import type { LyricTiming } from "@mellodifai/shared";
import { create } from "zustand";
import { persist } from "zustand/middleware";
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
  // What the listening view shows; absent for a preview that is not a library song.
  detail?: TrackDetail;
};

// The song behind a track, for the full listening view. A take preview carries the same detail
// as the song, with `takeNumber` set to the take it plays.
export type TrackDetail = {
  songId: string;
  lyrics: string;
  style: string;
  createdAt: string;
  takes: {
    id: string;
    number: number;
    audioUrl: string | null;
    lyrics?: string | null;
    timing?: LyricTiming | null;
  }[];
  // The take whose audio the song plays, or null when no take was chosen.
  chosenTakeId: string | null;
  // Set when the track is a preview of this take instead of the song itself.
  takeNumber?: number;
  // Which song tools apply now (the audio editor, the stems page); absent means none.
  tools?: { edit: boolean; stems: boolean; rewrite?: boolean };
  // The song's own track fields, to go back to it from a take preview.
  own: {
    title: string;
    subtitle: string;
    videoUrl: string | null;
    reaction: Reaction;
  };
};

export type RepeatMode = "off" | "all" | "one";
export function nextRepeat(mode: RepeatMode): RepeatMode {
  return mode === "off" ? "all" : mode === "all" ? "one" : "off";
}

export const SPEEDS = [0.5, 0.75, 1, 1.25, 1.5, 1.75, 2] as const;
export function clampSpeed(value: number): number {
  if (!Number.isFinite(value)) return 1;
  return Math.min(2, Math.max(0.5, value));
}

type PlayerState = {
  queue: Track[];
  index: number;
  playing: boolean;
  time: number;
  duration: number;
  volume: number;
  muted: boolean;
  shuffle: boolean;
  repeat: RepeatMode;
  // Playback rate, 0.5 to 2; the one setting that is remembered between visits.
  speed: number;
  // The full listening view is open.
  showNow: boolean;
  showLyrics: boolean;
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
  setSpeed: (speed: number) => void;
  set: (patch: Partial<PlayerState>) => void;
  ended: () => void;
};

export const usePlayer = create<PlayerState & PlayerActions>()(
  persist(
    (set, get) => ({
      queue: [],
      index: -1,
      playing: false,
      time: 0,
      duration: 0,
      volume: 0.9,
      muted: false,
      shuffle: false,
      repeat: "off" as RepeatMode,
      speed: 1,
      showNow: false,
      showLyrics: false,
      showVideo: false,
      showQueue: false,
      seekTo: { at: 0, n: 0 },
      play: (track, list) => {
        const { queue, index } = get();
        if (queue[index]?.id === track.id) return set({ playing: true });
        const next = list?.some((item) => item.id === track.id)
          ? list
          : [track];
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
        // Shuffle moves to another song; the one that just ended would not restart.
        const target =
          shuffle && queue.length > 1
            ? (index + 1 + Math.floor(Math.random() * (queue.length - 1))) %
              queue.length
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
      seek: (at) =>
        set((s) => ({ time: at, seekTo: { at, n: s.seekTo.n + 1 } })),
      setSpeed: (speed) => set({ speed: clampSpeed(speed) }),
      set: (patch) => set(patch),
      ended: () => {
        const { repeat, queue, index, shuffle } = get();
        // The audio element stops at its end, so a song that plays again needs a fresh seek.
        const again = () => {
          set({ playing: true });
          get().seek(0);
        };
        if (repeat === "one" || (repeat === "all" && queue.length === 1))
          return again();
        if (index < queue.length - 1 || shuffle || repeat === "all")
          get().next();
        else set({ playing: false });
      },
    }),
    {
      name: "mellodifai-player",
      version: 1,
      // Loaded after hydration (PlayerBar), so the first client render matches the server.
      skipHydration: true,
      partialize: (state) => ({ speed: state.speed }),
      merge: (saved, current) => ({
        ...current,
        speed: clampSpeed(
          (saved as { speed?: number } | undefined)?.speed ?? 1,
        ),
      }),
    },
  ),
);

export function formatTime(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return "0:00";
  const s = Math.floor(seconds);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}
