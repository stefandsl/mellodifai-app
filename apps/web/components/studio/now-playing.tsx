"use client";

import { Dialog as DialogPrimitive } from "@base-ui/react/dialog";
import { cn } from "cn";
import {
  ExternalLink,
  Layers,
  Pause,
  Play,
  Scissors,
  Share2,
  Shuffle,
  SkipBack,
  SkipForward,
  X,
} from "lucide-react";
import Link from "next/link";
import { useState } from "react";

import { useLocale } from "@/components/locale-provider";
import { st, stf } from "@/lib/studio/i18n";
import { activeTake, stylePhrases } from "@/lib/studio/now-playing";
import { editorHref, stemsHref } from "@/lib/studio/stems";
import {
  formatTime,
  type Track,
  type TrackDetail,
  usePlayer,
} from "@/store/player";
import { DownloadButton, RepeatButton, SpeedMenu } from "./player-controls";
import { ReactionButtons } from "./reaction-buttons";
import { ShareDialog } from "./share-dialog";
import { IconButton } from "./ui";

const TOOL_LINK =
  "inline-flex h-8 items-center gap-1.5 rounded-full bg-[var(--surface-2)] px-3 text-[13px] text-[var(--fg-muted)] outline-none hover:bg-[var(--surface-glass-hover)] hover:text-[var(--fg)] focus-visible:ring-2 focus-visible:ring-[var(--brand)]";
const TAG_LINE = /^\s*\[[^\]\n]*\]\s*$/u;

// Three bars that move while the song plays (still when motion is reduced, or paused).
function Equaliser({ playing }: { playing: boolean }) {
  return (
    <span aria-hidden className="flex h-5 items-end gap-0.5">
      {[0, 1, 2].map((i) => (
        <span
          key={i}
          className={cn(
            "w-1 origin-bottom rounded-full bg-[var(--brand)]",
            playing ? "eq-bar" : "h-1.5",
          )}
          style={playing ? { animationDelay: `${i * 140}ms` } : undefined}
        />
      ))}
    </span>
  );
}

function Lyrics({ text }: { text: string }) {
  const lang = useLocale();
  if (!text.trim())
    return <p className="text-[var(--fg-muted)]">{st(lang, "now.noLyrics")}</p>;
  return (
    <div className="font-mono text-[15px] leading-7 whitespace-pre-wrap">
      {text.split("\n").map((line, i) => (
        <div
          // biome-ignore lint/suspicious/noArrayIndexKey: lines are positional.
          key={i}
          className={cn(TAG_LINE.test(line) && "mt-3 text-[var(--fg-subtle)]")}
        >
          {line || " "}
        </div>
      ))}
    </div>
  );
}

// A take is previewed as its own track (it cannot be liked or counted); the take the song itself
// plays goes back to the song.
export function takeTrack(track: Track, detail: TrackDetail, number: number) {
  const take = detail.takes.find((item) => item.number === number);
  if (!take?.audioUrl) return null;
  const { takeNumber: _previewing, ...song } = detail;
  const isOwn = number === activeTake(song);
  return {
    ...track,
    id: isOwn ? detail.songId : `${detail.songId}:take-${number}`,
    title: isOwn ? detail.own.title : `${detail.own.title} · ${number}`,
    subtitle: detail.own.subtitle,
    audioUrl: take.audioUrl,
    videoUrl: isOwn ? detail.own.videoUrl : null,
    reaction: isOwn ? detail.own.reaction : null,
    detail: isOwn ? song : { ...song, takeNumber: number },
  } satisfies Track;
}

function dateText(lang: "it" | "en", iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  return new Intl.DateTimeFormat(lang === "it" ? "it-IT" : "en-GB", {
    dateStyle: "long",
  }).format(date);
}

function NowPlayingBody({ track }: { track: Track }) {
  const lang = useLocale();
  const p = usePlayer();
  const detail = track.detail;
  const chips = stylePhrases(detail?.style ?? "", 4);
  const takes = (detail?.takes ?? []).filter((take) => take.audioUrl);
  const current = detail ? activeTake(detail) : null;
  const created = detail ? dateText(lang, detail.createdAt) : "";
  const pct = p.duration ? (p.time / p.duration) * 100 : 0;
  const [shareOpen, setShareOpen] = useState(false);

  return (
    <>
      <div className="flex shrink-0 items-center justify-between gap-3 px-4 pt-[max(env(safe-area-inset-top),0.75rem)] pb-2 sm:px-6">
        <DialogPrimitive.Title className="text-sm font-medium text-[var(--fg-muted)]">
          {st(lang, "player.nowPlaying")}
        </DialogPrimitive.Title>
        <DialogPrimitive.Close
          aria-label={st(lang, "now.close")}
          className="inline-flex size-10 items-center justify-center rounded-full bg-[var(--surface-2)] text-[var(--fg)] outline-none hover:bg-[color-mix(in_oklab,var(--surface-2),var(--fg)_10%)] focus-visible:ring-2 focus-visible:ring-[var(--brand)]"
        >
          <X className="size-5" />
        </DialogPrimitive.Close>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-4 pb-4 scrollbar-thin sm:px-6 lg:grid lg:grid-cols-[minmax(0,26rem)_minmax(0,1fr)] lg:gap-12 lg:overflow-hidden lg:px-12 lg:pb-6">
        <div className="mx-auto w-full max-w-[26rem] space-y-5 lg:mx-0 lg:overflow-y-auto lg:pr-1 lg:scrollbar-thin">
          <div
            className="relative aspect-square w-full overflow-hidden rounded-2xl shadow-2xl ring-1 ring-[var(--hairline)]"
            style={{ background: track.art }}
          >
            <button
              type="button"
              aria-label={st(lang, p.playing ? "player.pause" : "player.play")}
              onClick={p.toggle}
              className="group absolute inset-0 flex items-center justify-center outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[var(--brand)]"
            >
              <span className="inline-flex size-16 items-center justify-center rounded-full bg-black/45 text-white opacity-0 backdrop-blur-sm transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100 max-lg:opacity-100">
                {p.playing ? (
                  <Pause className="size-7 fill-current" />
                ) : (
                  <Play className="size-7 translate-x-0.5 fill-current" />
                )}
              </span>
            </button>
            <span className="pointer-events-none absolute bottom-3 left-3 rounded-full bg-black/45 px-2.5 py-1 backdrop-blur-sm">
              <Equaliser playing={p.playing} />
            </span>
          </div>

          <div className="min-w-0">
            <h1 className="text-2xl font-medium tracking-tight text-balance sm:text-3xl">
              {detail?.own.title ?? track.title}
            </h1>
            <p className="mt-1 text-sm text-[var(--fg-muted)]">
              {track.subtitle}
              {created
                ? ` · ${stf(lang, "now.created", { date: created })}`
                : ""}
            </p>
          </div>

          {chips.length ? (
            <ul className="flex flex-wrap gap-1.5">
              {chips.map((chip) => (
                <li
                  key={chip}
                  className="rounded-full bg-[var(--surface-2)] px-3 py-1 text-[13px] text-[var(--fg-muted)]"
                >
                  {chip}
                </li>
              ))}
            </ul>
          ) : null}

          {detail && takes.length > 1 ? (
            <fieldset className="m-0 flex min-w-0 flex-wrap items-center gap-1.5 border-0 p-0">
              <legend className="sr-only">{st(lang, "now.takes")}</legend>
              {takes.map((take) => {
                const selected = take.number === current;
                return (
                  <button
                    key={take.id}
                    type="button"
                    aria-pressed={selected}
                    onClick={() => {
                      if (selected) return p.toggle();
                      const next = takeTrack(track, detail, take.number);
                      if (next) p.play(next);
                    }}
                    className={cn(
                      "h-8 rounded-full px-3.5 text-[13px] font-medium outline-none transition-colors focus-visible:ring-2 focus-visible:ring-[var(--brand)]",
                      selected
                        ? "bg-[var(--fg)] text-[var(--bg)]"
                        : "bg-[var(--surface-2)] text-[var(--fg-muted)] hover:text-[var(--fg)]",
                    )}
                  >
                    {stf(lang, "now.take", { n: String(take.number) })}
                  </button>
                );
              })}
            </fieldset>
          ) : null}

          <div className="flex flex-wrap items-center gap-1">
            {detail ? (
              <ReactionButtons
                key={detail.songId}
                id={detail.songId}
                initial={detail.own.reaction}
              />
            ) : null}
            <IconButton
              label={st(lang, "clip.share")}
              onClick={() => setShareOpen(true)}
              className="bg-transparent"
            >
              <Share2 />
            </IconButton>
            <DownloadButton track={track} />
            <Link
              href={track.href}
              onClick={() => p.set({ showNow: false })}
              className="ml-auto inline-flex h-8 items-center gap-1.5 rounded-full px-3 text-[13px] text-[var(--fg-muted)] outline-none hover:bg-[var(--surface-glass-hover)] hover:text-[var(--fg)] focus-visible:ring-2 focus-visible:ring-[var(--brand)]"
            >
              <ExternalLink className="size-3.5" />
              {st(lang, "now.open")}
            </Link>
          </div>
          {detail?.tools?.edit || detail?.tools?.stems ? (
            <div className="-mt-3 flex flex-wrap items-center gap-1">
              {detail?.tools?.edit ? (
                <Link
                  href={editorHref(detail.songId)}
                  onClick={() => p.set({ showNow: false })}
                  className={TOOL_LINK}
                >
                  <Scissors className="size-3.5" />
                  {st(lang, "tool.edit")}
                </Link>
              ) : null}
              {detail?.tools?.stems ? (
                <Link
                  href={stemsHref(detail.songId)}
                  onClick={() => p.set({ showNow: false })}
                  className={TOOL_LINK}
                >
                  <Layers className="size-3.5" />
                  {st(lang, "tool.stems")}
                </Link>
              ) : null}
            </div>
          ) : null}
        </div>

        <section
          aria-label={st(lang, "now.lyrics")}
          className="mt-6 rounded-2xl bg-[var(--surface-1)] p-5 lg:mt-0 lg:overflow-y-auto lg:scrollbar-thin"
        >
          <h2 className="mb-3 text-[15px] font-medium">
            {st(lang, "now.lyrics")}
          </h2>
          <Lyrics text={detail?.lyrics ?? ""} />
        </section>
      </div>

      <div className="shrink-0 border-t border-[var(--hairline)] bg-[var(--bg)] px-4 pt-3 pb-[max(env(safe-area-inset-bottom),0.75rem)] sm:px-6">
        <div className="mx-auto flex w-full max-w-2xl items-center gap-2 text-[11px] tabular-nums text-[var(--fg-muted)]">
          <span className="w-9 text-right">{formatTime(p.time)}</span>
          <input
            type="range"
            aria-label={st(lang, "player.seek")}
            aria-valuetext={`${formatTime(p.time)} / ${formatTime(p.duration)}`}
            min={0}
            max={p.duration || 0}
            step={0.1}
            value={Math.min(p.time, p.duration || 0)}
            onChange={(event) => p.seek(Number(event.target.value))}
            className="studio-range h-3 flex-1"
            style={{ "--pct": `${pct}%` } as React.CSSProperties}
          />
          <span className="w-9">{formatTime(p.duration)}</span>
        </div>
        <div className="mx-auto mt-1 flex w-full max-w-2xl items-center justify-between gap-1">
          <IconButton
            label={st(lang, "player.shuffle")}
            active={p.shuffle}
            onClick={() => p.set({ shuffle: !p.shuffle })}
            className="bg-transparent"
          >
            <Shuffle />
          </IconButton>
          <div className="flex items-center gap-2">
            <IconButton
              label={st(lang, "player.prev")}
              onClick={p.prev}
              className="bg-transparent"
            >
              <SkipBack className="fill-current" />
            </IconButton>
            <button
              type="button"
              aria-label={st(lang, p.playing ? "player.pause" : "player.play")}
              onClick={p.toggle}
              className="inline-flex size-12 items-center justify-center rounded-full bg-[var(--fg)] text-[var(--bg)] outline-none transition-transform hover:scale-105 focus-visible:ring-2 focus-visible:ring-[var(--brand)]"
            >
              {p.playing ? (
                <Pause className="size-6 fill-current" />
              ) : (
                <Play className="size-6 translate-x-px fill-current" />
              )}
            </button>
            <IconButton
              label={st(lang, "player.next")}
              onClick={p.next}
              className="bg-transparent"
            >
              <SkipForward className="fill-current" />
            </IconButton>
          </div>
          <div className="flex items-center">
            <RepeatButton className="bg-transparent" />
            <SpeedMenu />
          </div>
        </div>
      </div>
      <ShareDialog
        open={shareOpen}
        onOpenChange={setShareOpen}
        title={detail?.own.title ?? track.title}
        href={track.href}
      />
    </>
  );
}

// The full listening view: cover, title, lyrics, takes and the transport, over the whole screen.
// Esc, the close button or following a link closes it; the audio keeps playing.
export function NowPlaying() {
  const open = usePlayer((s) => s.showNow);
  const set = usePlayer((s) => s.set);
  const track = usePlayer((s) => s.queue[s.index]);
  return (
    <DialogPrimitive.Root
      open={open && Boolean(track)}
      onOpenChange={(next) => set({ showNow: next })}
    >
      <DialogPrimitive.Portal>
        <DialogPrimitive.Popup
          data-slot="now-playing"
          className="fixed inset-0 z-50 flex flex-col bg-[var(--bg)] text-[var(--fg)] outline-none"
        >
          {track ? <NowPlayingBody track={track} /> : null}
        </DialogPrimitive.Popup>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}
