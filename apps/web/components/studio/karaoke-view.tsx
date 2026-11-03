"use client";

import { Dialog as DialogPrimitive } from "@base-ui/react/dialog";
import { parseLyricTiming } from "@mellodifai/shared";
import { MicVocal, Pause, Play, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { requestLyricAlignment } from "@/app/actions/align-lyrics";
import { useLocale } from "@/components/locale-provider";
import { st } from "@/lib/studio/i18n";
import {
  activeLine,
  activeWord,
  karaokeLines,
  sectionLabel,
} from "@/lib/studio/karaoke";
import { createClient } from "@/lib/supabase/browser";
import { formatTime, type TrackDetail, usePlayer } from "@/store/player";

export function KaraokeView() {
  const track = usePlayer((state) => state.queue[state.index]);
  const detail = track?.detail;
  const take = detail?.takes.find(
    (item) =>
      item.number ===
      (detail.takeNumber ??
        detail.takes.find((item) => item.id === detail.chosenTakeId)?.number ??
        detail.takes[0]?.number),
  );
  return <KaraokeSession key={`${detail?.songId}:${take?.id}`} take={take} />;
}

function KaraokeSession({
  take,
}: {
  take: TrackDetail["takes"][number] | undefined;
}) {
  const lang = useLocale();
  const p = usePlayer();
  const track = p.queue[p.index];
  const detail = track?.detail;
  const lyrics = take?.lyrics || detail?.lyrics || "";
  const lines = useMemo(
    () => karaokeLines(lyrics, take?.timing ?? null),
    [lyrics, take?.timing],
  );
  const active = activeLine(lines, p.time);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const lineRefs = useRef<(HTMLLIElement | null)[]>([]);
  const [job, setJob] = useState<string | null>(null);
  const [error, setError] = useState(false);
  const [requesting, setRequesting] = useState(false);

  useEffect(() => {
    if (!p.showLyrics || active < 0) return;
    const center = () =>
      lineRefs.current[active]?.scrollIntoView({
        block: "center",
        behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches
          ? "instant"
          : "smooth",
      });
    const resize = () => {
      const container = scrollRef.current;
      const content = container?.firstElementChild as HTMLElement | null;
      if (container && content)
        content.style.paddingBlock = `${container.clientHeight / 2}px`;
      center();
    };
    const observer = new ResizeObserver(resize);
    if (scrollRef.current) observer.observe(scrollRef.current);
    resize();
    return () => observer.disconnect();
  }, [active, p.showLyrics]);

  useEffect(() => {
    if (!job || !take) return;
    const db = createClient();
    let cancelled = false;
    const poll = async () => {
      try {
        const [updatedResult, statusResult] = await Promise.all([
          db.from("takes").select("lyric_timing").eq("id", take.id).single(),
          db.from("jobs").select("status").eq("id", job).single(),
        ]);
        if (cancelled) return;
        if (updatedResult.error || statusResult.error)
          throw new Error("Alignment polling failed");
        const updated = updatedResult.data;
        const status = statusResult.data;
        const timing = parseLyricTiming(updated?.lyric_timing);
        if (timing) {
          usePlayer.setState((state) => ({
            queue: state.queue.map((item) => {
              if (!item.detail || item.detail.songId !== detail?.songId)
                return item;
              return {
                ...item,
                detail: {
                  ...item.detail,
                  takes: item.detail.takes.map((entry) =>
                    entry.id === take.id ? { ...entry, timing } : entry,
                  ),
                },
              };
            }),
          }));
          setJob(null);
        } else if (
          ["failed", "cancelled", "done"].includes(status?.status ?? "")
        ) {
          setError(true);
          setJob(null);
        }
      } catch {
        if (!cancelled) {
          setError(true);
          setJob(null);
        }
      }
    };
    void poll();
    const timer = setInterval(() => void poll(), 3000);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [job, take, detail]);

  const request = async () => {
    if (!detail || !take) return;
    setRequesting(true);
    setError(false);
    try {
      const result = await requestLyricAlignment({
        versionId: detail.songId,
        takeId: take.id,
      });
      if (result.ok && result.id) setJob(result.id);
      else setError(true);
    } catch {
      setError(true);
    } finally {
      setRequesting(false);
    }
  };

  return (
    <DialogPrimitive.Root
      open={p.showLyrics && Boolean(track)}
      onOpenChange={(open) => p.set({ showLyrics: open })}
    >
      <DialogPrimitive.Portal>
        <DialogPrimitive.Popup
          data-slot="karaoke-view"
          className="fixed inset-0 z-50 flex flex-col bg-[var(--bg)] text-[var(--fg)] outline-none"
        >
          <header className="flex shrink-0 items-center justify-between gap-4 border-b border-[var(--hairline)] px-5 py-3 sm:px-10">
            <div className="min-w-0">
              <DialogPrimitive.Title className="flex items-center gap-2 text-lg font-semibold">
                <MicVocal className="size-5 text-[var(--brand)]" />
                {st(lang, "karaoke.title")}
              </DialogPrimitive.Title>
              <p className="truncate text-sm text-[var(--fg-muted)]">
                {track?.title} · {track?.subtitle}
              </p>
            </div>
            <DialogPrimitive.Close
              aria-label={st(lang, "karaoke.close")}
              className="inline-flex size-10 shrink-0 items-center justify-center rounded-full bg-[var(--surface-2)] focus-visible:ring-2 focus-visible:ring-[var(--brand)]"
            >
              <X className="size-5" />
            </DialogPrimitive.Close>
          </header>
          <div
            ref={scrollRef}
            data-slot="karaoke-scroll"
            className="min-h-0 flex-1 overflow-y-auto px-5 scrollbar-thin sm:px-10"
          >
            <div className="mx-auto max-w-4xl py-10">
              {lyrics.trim() && !take?.timing ? (
                <div className="mb-8 rounded-xl border border-[var(--hairline)] bg-[var(--surface-1)] p-4">
                  <p className="mb-3 text-sm text-[var(--fg-muted)]">
                    {st(lang, "karaoke.unsynced")}
                  </p>
                  {take?.audioUrl ? (
                    <button
                      type="button"
                      disabled={requesting || Boolean(job)}
                      onClick={() => void request()}
                      className="rounded-full bg-[var(--brand)] px-5 py-2 font-semibold text-black disabled:opacity-60 focus-visible:ring-2 focus-visible:ring-[var(--fg)]"
                    >
                      {st(
                        lang,
                        job || requesting ? "karaoke.syncing" : "karaoke.sync",
                      )}
                    </button>
                  ) : null}
                  {error ? (
                    <p role="alert" className="mt-2 text-sm text-[var(--fg)]">
                      {st(lang, "karaoke.failed")}
                    </p>
                  ) : null}
                </div>
              ) : null}
              {!lyrics.trim() ? (
                <p className="text-xl text-[var(--fg-muted)]">
                  {st(lang, "now.noLyrics")}
                </p>
              ) : (
                <ol className="space-y-4 sm:space-y-5">
                  {lines.map((line, index) => (
                    <li
                      key={line.index}
                      ref={(node) => {
                        lineRefs.current[index] = node;
                      }}
                    >
                      {!line.sung ? (
                        line.text.trim() ? (
                          <p className="pt-5 text-sm font-semibold uppercase tracking-[0.18em] text-[var(--fg-muted)]">
                            {sectionLabel(line.text, lang)}
                          </p>
                        ) : null
                      ) : (
                        <button
                          type="button"
                          disabled={line.start === null}
                          onClick={() => {
                            if (line.start !== null) p.seek(line.start);
                          }}
                          aria-current={active === index ? "true" : undefined}
                          className={`block w-full rounded-lg text-left text-[clamp(1.55rem,3.5vw,3.5rem)] font-bold leading-[1.2] tracking-tight break-words outline-none focus-visible:ring-2 focus-visible:ring-[var(--brand)] ${active === index ? "text-[var(--fg)]" : line.end !== null && p.time >= line.end ? "text-[var(--fg-subtle)]" : "text-[var(--fg-muted)]"}`}
                        >
                          {line.words &&
                          line.words.length ===
                            (line.text.match(/\S+/gu)?.length ?? 0)
                            ? line.text
                                .split(/(\s+)/u)
                                .map((part, partIndex) => {
                                  const wordIndex = Math.floor(partIndex / 2);
                                  const lit =
                                    active === index &&
                                    wordIndex <=
                                      activeWord(line.words ?? [], p.time);
                                  return /^\s+$/u.test(part) ? (
                                    part
                                  ) : (
                                    <span
                                      // biome-ignore lint/suspicious/noArrayIndexKey: lyric fragments are positional and never reordered.
                                      key={partIndex}
                                      className={
                                        lit ? "text-[var(--brand)]" : undefined
                                      }
                                    >
                                      {part}
                                    </span>
                                  );
                                })
                            : line.text}
                        </button>
                      )}
                    </li>
                  ))}
                </ol>
              )}
            </div>
          </div>
          <footer className="shrink-0 border-t border-[var(--hairline)] bg-[var(--bg)] px-5 py-3 sm:px-10">
            <div className="mx-auto flex max-w-4xl items-center gap-3">
              <button
                type="button"
                onClick={p.toggle}
                aria-label={st(
                  lang,
                  p.playing ? "player.pause" : "player.play",
                )}
                className="flex size-11 shrink-0 items-center justify-center rounded-full bg-[var(--fg)] text-[var(--bg)] focus-visible:ring-2 focus-visible:ring-[var(--brand)]"
              >
                {p.playing ? (
                  <Pause className="size-5 fill-current" />
                ) : (
                  <Play className="size-5 fill-current" />
                )}
              </button>
              <span className="w-10 text-right text-xs tabular-nums text-[var(--fg-muted)]">
                {formatTime(p.time)}
              </span>
              <input
                type="range"
                min={0}
                max={p.duration || 0}
                step={0.1}
                value={Math.min(p.time, p.duration || 0)}
                onChange={(event) => p.seek(Number(event.target.value))}
                aria-label={st(lang, "player.seek")}
                className="studio-range h-3 min-w-0 flex-1"
                style={
                  {
                    "--pct": `${p.duration ? (p.time / p.duration) * 100 : 0}%`,
                  } as React.CSSProperties
                }
              />
              <span className="w-10 text-xs tabular-nums text-[var(--fg-muted)]">
                {formatTime(p.duration)}
              </span>
            </div>
          </footer>
        </DialogPrimitive.Popup>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}
