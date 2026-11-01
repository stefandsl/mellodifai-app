import {
  normalizeVisualizerParams,
  type VisualizerAspect,
  type VisualizerParams,
} from "@mellodifai/shared";
import { create } from "zustand";
import { persist } from "zustand/middleware";

import type { Clip } from "@/lib/studio/clips";

export type StudioTab = "preset" | "style" | "text" | "effects";

// A render started from this browser: the watcher toasts when it finishes or fails.
export type WatchedRender = {
  jobId: string;
  clipId: string;
  title: string;
  aspect: VisualizerAspect;
  params: VisualizerParams;
  // What the watcher last read of the job.
  status?: "queued" | "running";
  pct?: number | null;
  queue?: number | null;
};

type State = {
  open: boolean;
  // The song the studio renders, or "setup": choosing the look of the next songs (Create).
  clip: Clip | null;
  setup: boolean;
  tab: StudioTab;
  // The look on screen; the last one is remembered in this browser.
  params: VisualizerParams;
  watched: WatchedRender[];
};

type Actions = {
  openFor: (clip: Clip) => void;
  openSetup: () => void;
  close: () => void;
  setTab: (tab: StudioTab) => void;
  update: (change: (params: VisualizerParams) => VisualizerParams) => void;
  watch: (render: WatchedRender) => void;
  unwatch: (jobId: string) => void;
  report: (
    jobId: string,
    live: Pick<WatchedRender, "status" | "pct" | "queue">,
  ) => void;
};

// The look a song opens with: the one its last render of that aspect used (so a re-render
// starts from it), else the last look used in this browser.
export function lookFor(clip: Clip, last: VisualizerParams): VisualizerParams {
  const own = clip.visualizers?.find((item) => item.aspect === last.aspect);
  return own ? normalizeVisualizerParams(own.params) : last;
}

export const useVideoStudio = create<State & Actions>()(
  persist(
    (set, get) => ({
      open: false,
      clip: null,
      setup: false,
      tab: "preset",
      params: normalizeVisualizerParams(null),
      watched: [],
      openFor: (clip) =>
        set({
          open: true,
          clip,
          setup: false,
          params: lookFor(clip, get().params),
        }),
      openSetup: () => set({ open: true, clip: null, setup: true }),
      close: () => set({ open: false }),
      setTab: (tab) => set({ tab }),
      update: (change) =>
        set((s) => ({ params: normalizeVisualizerParams(change(s.params)) })),
      watch: (render) =>
        set((s) => ({
          watched: [
            ...s.watched.filter((item) => item.jobId !== render.jobId),
            render,
          ],
        })),
      report: (jobId, live) =>
        set((s) => ({
          watched: s.watched.map((item) =>
            item.jobId === jobId ? { ...item, ...live } : item,
          ),
        })),
      unwatch: (jobId) =>
        set((s) => ({
          watched: s.watched.filter((item) => item.jobId !== jobId),
        })),
    }),
    {
      name: "mellodifai-video-studio",
      version: 1,
      // Loaded after hydration (VideoStudio), so the first client render matches the server's.
      skipHydration: true,
      partialize: (state) => ({
        params: state.params,
        watched: state.watched,
      }),
      merge: (saved, current) => {
        const value = (saved ?? {}) as { params?: unknown; watched?: unknown };
        return {
          ...current,
          params: normalizeVisualizerParams(value.params),
          watched: Array.isArray(value.watched)
            ? (value.watched as WatchedRender[]).filter(
                (item) =>
                  item &&
                  typeof item.jobId === "string" &&
                  typeof item.clipId === "string",
              )
            : [],
        };
      },
    },
  ),
);
