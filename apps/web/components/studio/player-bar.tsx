"use client";

import { cn } from "cn";
import {
  Film,
  Info,
  ListMusic,
  Maximize2,
  Pause,
  Play,
  Shuffle,
  SkipBack,
  SkipForward,
  Volume2,
  VolumeX,
  X,
} from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef } from "react";
import { toast } from "sonner";

import { countPlay } from "@/app/actions/library";
import { useLocale } from "@/components/locale-provider";
import { st } from "@/lib/studio/i18n";
import { createPlayCounter } from "@/lib/studio/play-counter";
import { registerPlayerAudio } from "@/lib/studio/visualizer/audio-tap";
import { formatTime, usePlayer } from "@/store/player";
import { NowPlaying } from "./now-playing";
import { DownloadButton, RepeatButton, SpeedMenu } from "./player-controls";
import { ReactionButtons } from "./reaction-buttons";
import { IconButton, Tip } from "./ui";

function typing(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null;
  return Boolean(
    el &&
      (el.isContentEditable ||
        ["INPUT", "TEXTAREA", "SELECT"].includes(el.tagName) ||
        el.getAttribute("role") === "slider"),
  );
}

function MiniVideo({
  audio,
}: {
  audio: React.RefObject<HTMLAudioElement | null>;
}) {
  const lang = useLocale();
  const router = useRouter();
  const track = usePlayer((s) => s.queue[s.index]);
  const show = usePlayer((s) => s.showVideo);
  const playing = usePlayer((s) => s.playing);
  const set = usePlayer((s) => s.set);
  const video = useRef<HTMLVideoElement>(null);

  // Follow the audio clock; correct only when the drift is noticeable.
  useEffect(() => {
    const el = video.current;
    const clock = audio.current;
    if (!el || !clock) return;
    if (playing) void el.play().catch(() => {});
    else el.pause();
    const timer = setInterval(() => {
      if (Math.abs(el.currentTime - clock.currentTime) > 0.25)
        el.currentTime = clock.currentTime;
    }, 500);
    return () => clearInterval(timer);
  }, [playing, audio]);

  if (!show || !track?.videoUrl) return null;
  return (
    <div className="fixed right-4 bottom-[calc(var(--player-h)+12px)] z-40 w-60 overflow-hidden rounded-xl bg-black shadow-2xl ring-1 ring-[var(--hairline)]">
      <button
        type="button"
        aria-label={track.title}
        onClick={() => router.push(track.href)}
        className="block w-full"
      >
        <video
          ref={video}
          src={track.videoUrl}
          muted
          playsInline
          className="aspect-video w-full"
          onLoadedMetadata={(event) => {
            if (audio.current)
              event.currentTarget.currentTime = audio.current.currentTime;
          }}
        />
      </button>
      <button
        type="button"
        aria-label={st(lang, "create.close")}
        onClick={() => set({ showVideo: false })}
        className="absolute top-1.5 right-1.5 inline-flex size-6 items-center justify-center rounded-full bg-black/60 text-white"
      >
        <X className="size-3.5" />
      </button>
    </div>
  );
}

function QueueDrawer() {
  const lang = useLocale();
  const { queue, index, showQueue, set, remove } = usePlayer();
  if (!showQueue) return null;
  return (
    <aside
      aria-label={st(lang, "player.queue")}
      className="fixed right-0 bottom-[var(--player-h)] z-40 flex max-h-[70dvh] w-full flex-col border-l border-t border-[var(--hairline)] bg-[var(--surface-1)] sm:top-0 sm:max-h-none sm:w-80"
    >
      <div className="flex items-center justify-between px-4 py-3">
        <h2 className="font-medium">{st(lang, "player.queue")}</h2>
        <IconButton
          label={st(lang, "create.close")}
          onClick={() => set({ showQueue: false })}
          className="bg-transparent"
        >
          <X />
        </IconButton>
      </div>
      <ol className="min-h-0 flex-1 overflow-y-auto px-2 pb-3 scrollbar-thin">
        {queue.length === 0 ? (
          <li className="px-2 py-6 text-center text-[var(--fg-muted)]">
            {st(lang, "player.queueEmpty")}
          </li>
        ) : (
          queue.map((track, i) => (
            <li
              key={track.id}
              className={cn(
                "group flex items-center gap-3 rounded-xl p-2",
                i === index ? "bg-[var(--surface-glass-hover)]" : "hover-glass",
              )}
            >
              <button
                type="button"
                onClick={() => set({ index: i, playing: true, time: 0 })}
                className="flex min-w-0 flex-1 items-center gap-3 text-left"
              >
                <span
                  aria-hidden
                  className="size-10 shrink-0 rounded-md"
                  style={{ background: track.art }}
                />
                <span className="min-w-0">
                  <span
                    className={cn(
                      "block truncate text-sm",
                      i === index && "text-[var(--brand)]",
                    )}
                  >
                    {track.title}
                  </span>
                  <span className="block truncate text-xs text-[var(--fg-muted)]">
                    {track.subtitle}
                  </span>
                </span>
              </button>
              {i !== index ? (
                <button
                  type="button"
                  aria-label={`${lang === "it" ? "Rimuovi" : "Remove"}: ${track.title}`}
                  onClick={() => remove(track.id)}
                  className="inline-flex size-7 items-center justify-center rounded-full text-[var(--fg-muted)] opacity-0 group-hover:opacity-100 focus-visible:opacity-100"
                >
                  <X className="size-3.5" />
                </button>
              ) : null}
            </li>
          ))
        )}
      </ol>
    </aside>
  );
}

export function PlayerBar() {
  const lang = useLocale();
  const audio = useRef<HTMLAudioElement>(null);
  const p = usePlayer();
  const track = p.queue[p.index];
  const source = track?.audioUrl;
  // Counts a play once 30 s of this track were heard; a failed count is not worth a message.
  const plays = useRef<ReturnType<typeof createPlayCounter>>(null);
  plays.current ??= createPlayCounter((id) => {
    void countPlay({ versionId: id }).catch(() => {});
  });

  // Drive the single audio element from the store.
  useEffect(() => {
    const el = audio.current;
    if (!el || !track) return;
    if (p.playing) void el.play().catch(() => p.set({ playing: false }));
    else el.pause();
  }, [p.playing, track, p.set]);
  useEffect(() => {
    const el = audio.current;
    if (!el) return;
    el.currentTime = p.seekTo.at;
    // A song that ended stands still: a repeat (seek to 0 while playing) must start it again.
    if (usePlayer.getState().playing && el.paused && p.seekTo.n > 0)
      void el.play().catch(() => usePlayer.getState().set({ playing: false }));
  }, [p.seekTo]);
  // The remembered speed loads after hydration; every new source resets the rate to its default,
  // so both are set.
  useEffect(() => {
    void usePlayer.persist.rehydrate();
    // The Video Studio's live preview listens to this element (lib/studio/visualizer/audio-tap).
    registerPlayerAudio(audio.current);
  }, []);
  useEffect(() => {
    if (!audio.current || !source) return;
    audio.current.defaultPlaybackRate = p.speed;
    audio.current.playbackRate = p.speed;
  }, [p.speed, source]);
  useEffect(() => {
    if (!audio.current) return;
    audio.current.volume = p.volume;
    audio.current.muted = p.muted;
  }, [p.volume, p.muted]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (typing(event.target) || !usePlayer.getState().queue.length) return;
      const state = usePlayer.getState();
      if (
        event.code === "Space" &&
        !(event.target as HTMLElement)?.closest("button,a")
      ) {
        event.preventDefault();
        state.toggle();
      } else if (event.key === "ArrowRight" && !event.altKey) {
        state.seek(Math.min(state.duration, state.time + 5));
      } else if (event.key === "ArrowLeft" && !event.altKey) {
        state.seek(Math.max(0, state.time - 5));
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const pct = p.duration ? (p.time / p.duration) * 100 : 0;
  const _soon = st(lang, "soon");
  return (
    <>
      <MiniVideo audio={audio} />
      <QueueDrawer />
      <NowPlaying />
      <section
        aria-label="Player"
        className="relative z-30 grid h-[var(--player-h)] shrink-0 grid-cols-[1fr_auto] items-center gap-3 border-t border-[var(--hairline)] bg-[var(--bg)] px-3 sm:grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)_minmax(0,1fr)] sm:px-4"
      >
        <audio
          ref={audio}
          src={track?.audioUrl}
          // Lets the Video Studio's analyser read the samples of the signed storage file.
          crossOrigin="anonymous"
          preload="metadata"
          onTimeUpdate={(event) => {
            p.set({ time: event.currentTarget.currentTime });
            if (track?.reaction)
              plays.current?.tick(track.id, event.currentTarget.currentTime);
          }}
          onLoadedMetadata={(event) =>
            p.set({ duration: event.currentTarget.duration })
          }
          onEnded={() => {
            plays.current?.reset();
            p.ended();
          }}
          // A file that cannot load would otherwise leave the bar "playing" at 0:00.
          onError={() => {
            p.set({ playing: false });
            toast.error(st(lang, "player.loadFailed"), { id: "player-load" });
          }}
        >
          <track kind="captions" />
        </audio>

        <div className="flex min-w-0 items-center gap-3">
          {track ? (
            <button
              type="button"
              aria-label={st(lang, "player.expand")}
              onClick={() => p.set({ showNow: true })}
              className="size-10 shrink-0 rounded-md bg-[var(--surface-2)] outline-none focus-visible:ring-2 focus-visible:ring-[var(--brand)]"
              style={{ background: track.art }}
            />
          ) : (
            <span
              aria-hidden
              className="size-10 shrink-0 rounded-md bg-[var(--surface-2)]"
            />
          )}
          {track ? (
            <>
              <div className="min-w-0">
                <button
                  type="button"
                  onClick={() => p.set({ showNow: true })}
                  className="block max-w-full truncate rounded text-left text-sm font-medium outline-none hover:underline focus-visible:ring-2 focus-visible:ring-[var(--brand)]"
                >
                  {track.title}
                </button>
                <p className="truncate text-xs text-[var(--fg-muted)]">
                  {track.subtitle}
                </p>
              </div>
              {track.reaction ? (
                <ReactionButtons
                  key={track.id}
                  id={track.id}
                  initial={track.reaction}
                  className="shrink-0"
                />
              ) : null}
            </>
          ) : (
            <p className="truncate text-sm text-[var(--fg-subtle)]">
              {st(lang, "player.idle")}
            </p>
          )}
        </div>

        <div className="flex flex-col items-center gap-1 max-sm:hidden">
          <div className="flex items-center gap-2">
            <IconButton
              label={st(lang, "player.shuffle")}
              active={p.shuffle}
              onClick={() => p.set({ shuffle: !p.shuffle })}
              className="bg-transparent"
            >
              <Shuffle />
            </IconButton>
            <IconButton
              label={st(lang, "player.prev")}
              onClick={p.prev}
              className="bg-transparent"
              disabled={!track}
            >
              <SkipBack className="fill-current" />
            </IconButton>
            <button
              type="button"
              aria-label={st(lang, p.playing ? "player.pause" : "player.play")}
              disabled={!track}
              onClick={p.toggle}
              className="inline-flex size-10 items-center justify-center rounded-full bg-[var(--fg)] text-[var(--bg)] outline-none transition-transform hover:scale-105 focus-visible:ring-2 focus-visible:ring-[var(--brand)] disabled:opacity-40 disabled:hover:scale-100"
            >
              {p.playing ? (
                <Pause className="size-5 fill-current" />
              ) : (
                <Play className="size-5 translate-x-px fill-current" />
              )}
            </button>
            <IconButton
              label={st(lang, "player.next")}
              onClick={p.next}
              className="bg-transparent"
              disabled={!track}
            >
              <SkipForward className="fill-current" />
            </IconButton>
            <RepeatButton className="bg-transparent" />
          </div>
          <div className="flex w-full max-w-xl items-center gap-2 text-[11px] tabular-nums text-[var(--fg-muted)]">
            <span className="w-9 text-right">{formatTime(p.time)}</span>
            <input
              type="range"
              aria-label={st(lang, "player.seek")}
              aria-valuetext={`${formatTime(p.time)} / ${formatTime(p.duration)}`}
              min={0}
              max={p.duration || 0}
              step={0.1}
              value={Math.min(p.time, p.duration || 0)}
              disabled={!track}
              onChange={(event) => p.seek(Number(event.target.value))}
              className="studio-range h-3 flex-1"
              style={{ "--pct": `${pct}%` } as React.CSSProperties}
            />
            <span className="w-9">{formatTime(p.duration)}</span>
          </div>
        </div>

        <div className="flex items-center justify-end gap-1">
          <button
            type="button"
            aria-label={st(lang, p.playing ? "player.pause" : "player.play")}
            disabled={!track}
            onClick={p.toggle}
            className="inline-flex size-10 items-center justify-center rounded-full bg-[var(--fg)] text-[var(--bg)] disabled:opacity-40 sm:hidden"
          >
            {p.playing ? (
              <Pause className="size-5 fill-current" />
            ) : (
              <Play className="size-5 translate-x-px fill-current" />
            )}
          </button>
          {track?.videoUrl ? (
            <IconButton
              label={st(lang, "player.video")}
              active={p.showVideo}
              onClick={() => p.set({ showVideo: !p.showVideo })}
              className="bg-transparent max-sm:hidden"
            >
              <Film />
            </IconButton>
          ) : null}
          <IconButton
            label={st(lang, "player.queue")}
            active={p.showQueue}
            onClick={() => p.set({ showQueue: !p.showQueue })}
            className="bg-transparent max-sm:hidden"
          >
            <ListMusic />
          </IconButton>
          <span className="group/vol flex items-center max-md:hidden">
            <IconButton
              label={st(lang, "player.mute")}
              active={p.muted}
              onClick={() => p.set({ muted: !p.muted })}
              className="bg-transparent"
            >
              {p.muted || p.volume === 0 ? <VolumeX /> : <Volume2 />}
            </IconButton>
            <input
              type="range"
              aria-label={st(lang, "player.volume")}
              min={0}
              max={1}
              step={0.01}
              value={p.muted ? 0 : p.volume}
              onChange={(event) =>
                p.set({ volume: Number(event.target.value), muted: false })
              }
              className="studio-range h-3 w-20"
              style={
                {
                  "--pct": `${(p.muted ? 0 : p.volume) * 100}%`,
                } as React.CSSProperties
              }
            />
          </span>
          {track ? <SpeedMenu className="max-lg:hidden" /> : null}
          {track ? (
            <DownloadButton track={track} className="max-sm:hidden" />
          ) : null}
          {track ? (
            <IconButton
              label={st(lang, "player.expand")}
              onClick={() => p.set({ showNow: true })}
              className="bg-transparent max-sm:hidden"
            >
              <Maximize2 />
            </IconButton>
          ) : null}
          {track ? (
            <Tip label={st(lang, "player.info")}>
              <Link
                href={track.href}
                aria-label={st(lang, "player.info")}
                className="inline-flex size-8 items-center justify-center rounded-full text-[var(--fg-muted)] hover:text-[var(--fg)] max-sm:hidden"
              >
                <Info className="size-4" />
              </Link>
            </Tip>
          ) : null}
        </div>
      </section>
    </>
  );
}
