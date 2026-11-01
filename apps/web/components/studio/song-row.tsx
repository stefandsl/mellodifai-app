"use client";

import { cn } from "cn";
import { Loader2, Pause, Play } from "lucide-react";

import { useLocale } from "@/components/locale-provider";
import { type Clip, isGenerating } from "@/lib/studio/clips";
import { st } from "@/lib/studio/i18n";
import { type Track, usePlayer } from "@/store/player";
import { CoverFace } from "./cover-face";
import { trackFor } from "./feed/clip-card";

// Clicks on these keep their own meaning; the row's own click is for the rest of the row.
const INTERACTIVE = "a,button,input,select,textarea,label,[role=menuitem]";

// Plays a song within a list: the song itself when it is the one playing (pause or resume),
// otherwise it starts the list at this song.
export function usePlayRow(clip: Clip, list: Clip[]) {
  const current = usePlayer((s) => s.queue[s.index]?.id === clip.id);
  const playing = usePlayer((s) => s.playing) && current;
  const play = usePlayer((s) => s.play);
  const toggle = usePlayer((s) => s.toggle);
  const track = trackFor(clip);
  return {
    current,
    playing,
    playable: track !== null,
    start: () => {
      if (!track) return;
      if (current) return toggle();
      play(
        track,
        list.map(trackFor).filter((item): item is Track => item !== null),
      );
    },
  };
}

// One song in a list (a playlist page, the search results): an index or a play button, a small
// cover, the title with its style line, and the caller's controls on the right. The song that
// is playing is tinted, with the title in brand red and a pause button.
export function SongRow({
  clip,
  list,
  index,
  onActivate,
  active = false,
  selected = false,
  trailing,
  leading,
  className,
  rowProps,
}: {
  clip: Clip;
  list: Clip[];
  // A position number shown until the row is hovered (playlist pages).
  index?: number;
  // A click on the row body; the play button always plays.
  onActivate?: () => void;
  // Keyboard-highlighted (search results).
  active?: boolean;
  // The song shown in the details panel.
  selected?: boolean;
  trailing?: React.ReactNode;
  // Replaces the play cell (a drag handle goes beside it, not here).
  leading?: React.ReactNode;
  className?: string;
  rowProps?: React.HTMLAttributes<HTMLDivElement> & { draggable?: boolean };
}) {
  const lang = useLocale();
  const { current, playing, playable, start } = usePlayRow(clip, list);
  const generating = isGenerating(clip.status);
  const title = clip.title || st(lang, "clip.untitled");
  // Playlist pages number their rows; the number gives way to a play icon on hover.
  const showIndex = index !== undefined && !current;
  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: the buttons inside carry the keyboard path.
    // biome-ignore lint/a11y/useKeyWithClickEvents: the buttons inside carry the keyboard path.
    <div
      {...rowProps}
      data-current={current ? "true" : undefined}
      data-active={active ? "true" : undefined}
      aria-current={current ? "true" : undefined}
      onClick={(event) => {
        if (!onActivate || event.defaultPrevented) return;
        if ((event.target as HTMLElement).closest(INTERACTIVE)) return;
        onActivate();
      }}
      className={cn(
        "group/row flex min-h-14 items-center gap-3 rounded-xl px-2 py-1.5 transition-colors hover-glass",
        onActivate && "cursor-pointer",
        selected && "bg-[var(--surface-glass)]",
        active && "bg-[var(--surface-glass-hover)]",
        current &&
          "bg-[color-mix(in_oklab,var(--brand),transparent_92%)] shadow-[inset_3px_0_0_var(--brand)]",
        className,
      )}
    >
      {leading ?? (
        <button
          type="button"
          disabled={!playable}
          aria-label={`${st(lang, playing ? "clip.pause" : "clip.play")}: ${title}`}
          onClick={start}
          className={cn(
            "group/play relative flex size-8 shrink-0 items-center justify-center rounded-full text-[13px] tabular-nums text-[var(--fg-muted)] outline-none focus-visible:ring-2 focus-visible:ring-[var(--brand)] disabled:opacity-40",
            current && "text-[var(--brand)]",
          )}
        >
          {showIndex ? (
            <span
              className={cn(
                playable &&
                  "group-hover/row:hidden group-focus-visible/play:hidden",
              )}
            >
              {index}
            </span>
          ) : null}
          {showIndex && !playable ? null : (
            <span
              className={
                showIndex
                  ? "hidden group-hover/row:inline-flex group-focus-visible/play:inline-flex"
                  : "inline-flex"
              }
            >
              {generating ? (
                <Loader2 className="size-4 animate-spin" />
              ) : playing ? (
                <Pause className="size-4 fill-current" />
              ) : (
                <Play className="size-4 translate-x-px fill-current" />
              )}
            </span>
          )}
        </button>
      )}
      <div
        aria-hidden
        className={cn(
          "relative size-11 shrink-0 overflow-hidden rounded-lg",
          generating && "shimmer",
        )}
        style={generating ? undefined : { background: clip.art }}
      >
        <CoverFace clip={clip} size="mini" />
      </div>
      <div className="min-w-0 flex-1">
        <p
          className={cn(
            "truncate text-[14px] font-medium",
            current && "text-[var(--brand)]",
          )}
        >
          {title}
        </p>
        <p className="truncate text-[13px] text-[var(--fg-muted)]">
          {clip.style || clip.prompt}
        </p>
      </div>
      {trailing}
    </div>
  );
}
