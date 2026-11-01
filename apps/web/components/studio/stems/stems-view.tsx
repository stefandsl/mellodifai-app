"use client";

import { cn } from "cn";
import {
  CheckCircle2,
  Download,
  Layers,
  Loader2,
  Pause,
  Play,
  RotateCcw,
} from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";

import { requestStems } from "@/app/actions/audio-tools";
import { ErrorDetails } from "@/components/error-details";
import { useLocale } from "@/components/locale-provider";
import { formatClock } from "@/lib/studio/audio-edit";
import { st, stf } from "@/lib/studio/i18n";
import { downloadHref, downloadName } from "@/lib/studio/now-playing";
import {
  audible,
  FULL_MIX,
  isFullMix,
  isOnly,
  type Mix,
  remaining,
  rowPress,
  toggleMute,
  toggleSolo,
} from "@/lib/studio/stem-mix";
import {
  canSeparate,
  STEM_LABEL,
  STEM_NAMES,
  type StemName,
  type StemsPage,
  type StemTrack,
} from "@/lib/studio/stems";
import {
  type JobEvent,
  latestProgress,
  useJobEvents,
} from "@/lib/studio/use-job-progress";
import { zipStored } from "@/lib/studio/zip";
import { usePlayer } from "@/store/player";
import { useLiveRefresh } from "../feed/use-live-refresh";
import { ToolPage } from "../tool-page";

const CARD = "rounded-2xl bg-[var(--surface-1)] p-4 sm:p-5";
const PILL =
  "inline-flex h-9 items-center gap-2 rounded-full px-4 text-[13px] font-medium outline-none focus-visible:ring-2 focus-visible:ring-[var(--brand)] disabled:cursor-not-allowed disabled:opacity-55";
const SMALL =
  "inline-flex h-8 min-w-8 items-center justify-center rounded-full px-2.5 text-[12px] font-semibold outline-none transition-colors focus-visible:ring-2 focus-visible:ring-[var(--brand)]";
// Waveform bars per stem: enough detail on a desktop, still a few pixels each on a phone.
const BARS = 150;

const color = (name: StemName) => `var(--stem-${name})`;

type Players = Partial<Record<StemName, HTMLAudioElement | null>>;
// The stems' audio elements in page order; the first one is the clock the others follow.
const playersOf = (players: Players) =>
  STEM_NAMES.flatMap((name) => {
    const element = players[name];
    return element ? [element] : [];
  });

// Seconds since `since`, ticking every second while `live`.
function useElapsed(since: string | null, live: boolean): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!live) return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [live]);
  const start = since ? Date.parse(since) : Number.NaN;
  return Number.isFinite(start) ? Math.max(0, (now - start) / 1000) : 0;
}

function Bar({ value }: { value: number | null }) {
  return (
    <div
      role="progressbar"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={value ?? undefined}
      className="relative h-1.5 overflow-hidden rounded-full bg-[var(--surface-2)]"
    >
      {value == null ? (
        <div className="absolute inset-y-0 w-1/3 stems-indeterminate rounded-full bg-[var(--brand)]" />
      ) : (
        <div
          className="h-full rounded-full bg-[var(--brand)] transition-[width] duration-500"
          style={{ width: `${Math.max(2, Math.min(100, value))}%` }}
        />
      )}
    </div>
  );
}

function Log({ events, open }: { events: JobEvent[]; open?: boolean }) {
  const lang = useLocale();
  return (
    <details open={open} className="group/log text-[13px]">
      <summary className="cursor-pointer select-none text-[var(--fg-muted)] outline-none hover:text-[var(--fg)] focus-visible:text-[var(--fg)]">
        {st(lang, "stems.log")}
      </summary>
      {events.length ? (
        <ol className="mt-2 max-h-56 space-y-0.5 overflow-y-auto rounded-xl bg-[var(--surface-2)] p-3 font-mono text-[11.5px] leading-5 text-[var(--fg-muted)] scrollbar-thin">
          {events.map((event) => (
            <li key={event.id} className="break-words">
              <span className="text-[var(--fg-subtle)] tabular-nums">
                {new Date(event.at).toLocaleTimeString(lang, {
                  hour: "2-digit",
                  minute: "2-digit",
                  second: "2-digit",
                })}
              </span>{" "}
              {event.message}
            </li>
          ))}
        </ol>
      ) : (
        <p className="mt-2 text-[var(--fg-subtle)]">
          {st(lang, "stems.logEmpty")}
        </p>
      )}
    </details>
  );
}

// The separation before there are tracks: start it, wait for it, or try it again.
function Status({ page, events }: { page: StemsPage; events: JobEvent[] }) {
  const lang = useLocale();
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const job = page.job;
  const running = job?.status === "running";
  const elapsed = useElapsed(job?.startedAt ?? null, running);
  const latest = running
    ? latestProgress(events, job?.startedAt ?? null)
    : null;
  const ask = async () => {
    setBusy(true);
    const result = await requestStems({ versionId: page.clip.id });
    setBusy(false);
    if (!result.ok) toast.error(st(lang, "tool.stemsFailed"));
    router.refresh();
  };
  if (!job || job.status === "done") {
    if (!canSeparate(page.clip))
      return (
        <section className={CARD}>
          <p className="text-[14px] text-[var(--fg-muted)]">
            {st(lang, "stems.unavailable")}
          </p>
        </section>
      );
    return (
      <section className={cn(CARD, "flex flex-wrap items-center gap-4")}>
        <p className="min-w-0 flex-1 text-[14px] text-pretty text-[var(--fg-muted)]">
          {st(lang, "stems.startHint")}
        </p>
        <button
          type="button"
          disabled={busy}
          onClick={() => void ask()}
          className={cn(
            PILL,
            "bg-cta text-[var(--brand-ink)] hover:brightness-110",
          )}
        >
          {busy ? (
            <Loader2 className="size-4 animate-spin" />
          ) : (
            <Layers className="size-4" />
          )}
          {st(lang, "stems.start")}
        </button>
      </section>
    );
  }
  if (job.status === "failed" || job.status === "cancelled")
    return (
      <section className={cn(CARD, "space-y-3")}>
        <p className="text-[15px] font-medium text-[var(--danger)]">
          {st(lang, "stems.failed")}
        </p>
        {job.error ? <ErrorDetails text={job.error} /> : null}
        <button
          type="button"
          disabled={busy || !canSeparate(page.clip)}
          onClick={() => void ask()}
          className={cn(
            PILL,
            "bg-[var(--surface-2)] hover:bg-[var(--surface-glass-hover)]",
          )}
        >
          {busy ? (
            <Loader2 className="size-4 animate-spin" />
          ) : (
            <RotateCcw className="size-4" />
          )}
          {st(lang, "stems.retry")}
        </button>
        <Log events={events} />
      </section>
    );
  const left =
    latest?.progress != null ? remaining(elapsed, latest.progress) : null;
  return (
    <section className={cn(CARD, "space-y-3")} aria-live="polite">
      <div className="flex items-baseline justify-between gap-3">
        <p className="flex items-center gap-2 text-[15px] font-medium">
          <Loader2 className="size-4 animate-spin text-[var(--brand)]" />
          {running
            ? st(lang, "stems.running")
            : page.queuePosition && page.queuePosition > 1
              ? stf(lang, "stems.queuedAt", { n: String(page.queuePosition) })
              : st(lang, "stems.queued")}
        </p>
        {latest?.progress != null ? (
          <span className="text-[13px] tabular-nums text-[var(--fg-muted)]">
            {Math.round(latest.progress)}%
          </span>
        ) : null}
      </div>
      <Bar value={running ? (latest?.progress ?? null) : null} />
      {running ? (
        <p className="text-[13px] tabular-nums text-[var(--fg-muted)]">
          {stf(lang, "stems.elapsed", { time: formatClock(elapsed) })}
          {left != null
            ? ` · ${stf(lang, "stems.eta", { time: formatClock(left) })}`
            : ""}
        </p>
      ) : null}
      <Log events={events} />
    </section>
  );
}

// Peaks folded into `count` bars (the largest of each group).
function bars(peaks: number[], count: number): number[] {
  if (!peaks.length) return Array.from({ length: count }, () => 0);
  return Array.from({ length: count }, (_, i) => {
    const a = Math.floor((i * peaks.length) / count);
    const b = Math.max(a + 1, Math.floor(((i + 1) * peaks.length) / count));
    return Math.max(...peaks.slice(a, b));
  });
}

// Bar heights read better on a square-root scale; `loudest` (the highest peak of all four stems)
// keeps the stems comparable with each other.
function Wave({
  name,
  peaks,
  loudest,
  pct,
  heard,
}: {
  name: StemName;
  peaks: number[];
  loudest: number;
  pct: number;
  heard: boolean;
}) {
  const shape = useMemo(() => {
    const values = bars(peaks, BARS);
    return values
      .map((value, i) => {
        const h = Math.max(4, Math.sqrt(value / (loudest || 1)) * 92);
        return `M${i + 0.15} ${50 - h / 2}h0.7v${h}h-0.7z`;
      })
      .join("");
  }, [peaks, loudest]);
  const svg = (fill: string) => (
    <svg
      aria-hidden
      viewBox={`0 0 ${BARS} 100`}
      preserveAspectRatio="none"
      className="absolute inset-0 size-full"
    >
      <path d={shape} fill={fill} />
    </svg>
  );
  return (
    <div
      className={cn("relative h-10 transition-opacity", !heard && "opacity-40")}
    >
      {svg("color-mix(in oklab, var(--fg) 20%, transparent)")}
      <div
        className="absolute inset-0"
        style={{ clipPath: `inset(0 ${100 - pct}% 0 0)` }}
      >
        {svg(color(name))}
      </div>
    </div>
  );
}

function StemRow({
  track,
  loudest,
  mix,
  playing,
  pct,
  time,
  length,
  fileName,
  onPress,
  onMix,
  onSeek,
}: {
  track: StemTrack;
  loudest: number;
  mix: Mix;
  playing: boolean;
  pct: number;
  time: number;
  length: number;
  fileName: string;
  onPress: () => void;
  onMix: (mix: Mix) => void;
  onSeek: (at: number) => void;
}) {
  const lang = useLocale();
  const label = st(lang, STEM_LABEL[track.name]);
  const heard = audible(mix, track.name);
  const solo = mix.solo.includes(track.name);
  const muted = mix.muted.includes(track.name);
  const mine = playing && isOnly(mix, track.name);
  return (
    <li
      className="flex items-center gap-3 rounded-2xl bg-[var(--surface-1)] p-3 sm:gap-4 sm:p-4"
      style={{ "--stem": color(track.name) } as React.CSSProperties}
    >
      <button
        type="button"
        aria-label={
          mine
            ? stf(lang, "stems.pauseOf", { name: label })
            : stf(lang, "stems.playOnly", { name: label })
        }
        onClick={onPress}
        className="inline-flex size-11 shrink-0 items-center justify-center rounded-full bg-[color-mix(in_oklab,var(--stem),transparent_80%)] text-[var(--stem)] outline-none transition-transform hover:scale-105 focus-visible:ring-2 focus-visible:ring-[var(--stem)]"
      >
        {mine ? (
          <Pause className="size-5 fill-current" />
        ) : (
          <Play className="size-5 translate-x-px fill-current" />
        )}
      </button>
      <div className="min-w-0 flex-1">
        <div className="flex items-center justify-between gap-2">
          <span className="flex min-w-0 items-center gap-2 text-[14px] font-medium">
            <span
              aria-hidden
              className="size-2 shrink-0 rounded-full bg-[var(--stem)]"
            />
            <span className="truncate">{label}</span>
          </span>
          <div className="flex shrink-0 items-center gap-1">
            <button
              type="button"
              aria-pressed={solo}
              aria-label={stf(lang, "stems.soloOf", { name: label })}
              title={st(lang, "stems.solo")}
              onClick={() => onMix(toggleSolo(mix, track.name))}
              className={cn(
                SMALL,
                solo
                  ? "bg-[var(--stem)] text-[var(--bg)]"
                  : "bg-[var(--surface-2)] text-[var(--fg-muted)] hover:text-[var(--fg)]",
              )}
            >
              S
            </button>
            <button
              type="button"
              aria-pressed={muted}
              aria-label={stf(lang, "stems.muteOf", { name: label })}
              title={st(lang, "stems.mute")}
              onClick={() => onMix(toggleMute(mix, track.name))}
              className={cn(
                SMALL,
                muted
                  ? "bg-[var(--fg)] text-[var(--bg)]"
                  : "bg-[var(--surface-2)] text-[var(--fg-muted)] hover:text-[var(--fg)]",
              )}
            >
              M
            </button>
            <a
              href={downloadHref(track.url, fileName)}
              download={fileName}
              aria-label={stf(lang, "stems.downloadOf", { name: label })}
              title={stf(lang, "stems.downloadOf", { name: label })}
              className={cn(
                SMALL,
                "gap-1 bg-[var(--surface-2)] text-[var(--fg-muted)] hover:text-[var(--fg)]",
              )}
            >
              <Download className="size-3.5" />
              <span className="max-sm:hidden">MP3</span>
            </a>
          </div>
        </div>
        <div className="relative mt-2">
          <Wave
            name={track.name}
            peaks={track.peaks}
            loudest={loudest}
            pct={pct}
            heard={heard}
          />
          <input
            type="range"
            aria-label={`${st(lang, "stems.seek")}: ${label}`}
            aria-valuetext={`${formatClock(time)} / ${formatClock(length)}`}
            min={0}
            max={length || 0}
            step={0.1}
            value={Math.min(time, length || 0)}
            onChange={(event) => onSeek(Number(event.target.value))}
            className="absolute inset-0 size-full cursor-pointer opacity-0"
          />
        </div>
      </div>
    </li>
  );
}

// The four stems, played together and in sync; solo and mute decide which ones are heard.
function Mixer({ page }: { page: StemsPage }) {
  const lang = useLocale();
  const tracks = page.tracks as StemTrack[];
  const title = page.clip.title || st(lang, "clip.untitled");
  const audio = useRef<Players>({});
  const [playing, setPlaying] = useState(false);
  const [time, setTime] = useState(0);
  const [length, setLength] = useState(page.duration);
  const [mix, setMix] = useState<Mix>(FULL_MIX);
  const [zipping, setZipping] = useState<number | null>(null);
  const loudest = useMemo(
    () => Math.max(0, ...tracks.flatMap((track) => track.peaks)),
    [tracks],
  );
  const elements = () => playersOf(audio.current);

  useEffect(() => {
    for (const name of STEM_NAMES) {
      const element = audio.current[name];
      if (element) element.muted = !audible(mix, name);
    }
  }, [mix]);

  useEffect(() => {
    const all = playersOf(audio.current);
    if (!playing) {
      for (const element of all) element.pause();
      return;
    }
    // One sound at a time: the main player stops while the stems play.
    usePlayer.getState().set({ playing: false });
    const at = all[0]?.currentTime ?? 0;
    for (const element of all)
      if (Math.abs(element.currentTime - at) > 0.03) element.currentTime = at;
    void Promise.all(all.map((element) => element.play())).catch(() =>
      setPlaying(false),
    );
    let frame = 0;
    const tick = () => {
      const players = playersOf(audio.current);
      const master = players[0];
      if (master) {
        setTime(master.currentTime);
        // Keep the others on the first one's clock.
        for (const element of players)
          if (
            element !== master &&
            Math.abs(element.currentTime - master.currentTime) > 0.08
          )
            element.currentTime = master.currentTime;
      }
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [playing]);

  // The main player taking over stops the stems.
  useEffect(
    () =>
      usePlayer.subscribe((state, previous) => {
        if (state.playing && !previous.playing) setPlaying(false);
      }),
    [],
  );

  const seek = (at: number) => {
    for (const element of elements()) element.currentTime = at;
    setTime(at);
  };
  const pct = length ? Math.min(100, (time / length) * 100) : 0;
  const fileName = (name: StemName) =>
    downloadName(
      `${title} - ${st(lang, STEM_LABEL[name])}`,
      tracks[0]?.url ?? "",
    );

  const zip = async () => {
    setZipping(0);
    try {
      const entries = [];
      for (const [i, track] of tracks.entries()) {
        const response = await fetch(track.url);
        if (!response.ok) throw new Error(String(response.status));
        entries.push({
          name: fileName(track.name),
          data: new Uint8Array(await response.arrayBuffer()),
        });
        setZipping(Math.round(((i + 1) / tracks.length) * 100));
      }
      const url = URL.createObjectURL(
        new Blob([zipStored(entries) as BlobPart], { type: "application/zip" }),
      );
      const link = document.createElement("a");
      link.href = url;
      link.download = downloadName(`${title} - stems`, "https://zip/x.zip");
      document.body.append(link);
      link.click();
      link.remove();
      setTimeout(() => URL.revokeObjectURL(url), 60_000);
    } catch {
      toast.error(st(lang, "stems.zipFailed"));
    } finally {
      setZipping(null);
    }
  };

  return (
    <section aria-label={st(lang, "stems.tracks")} className="space-y-3">
      <div className={cn(CARD, "space-y-4")}>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <h2 className="text-[17px] font-medium">
              {st(lang, "stems.tracks")}
            </h2>
            <p className="mt-1 flex items-center gap-1.5 text-[13px] text-[var(--success)]">
              <CheckCircle2 className="size-3.5" />
              {page.seconds != null
                ? stf(lang, "stems.doneIn", { time: formatClock(page.seconds) })
                : st(lang, "stems.done")}
            </p>
          </div>
          <button
            type="button"
            disabled={zipping !== null}
            onClick={() => void zip()}
            className={cn(
              PILL,
              "bg-[var(--surface-2)] hover:bg-[var(--surface-glass-hover)]",
            )}
          >
            {zipping !== null ? (
              <Loader2 className="size-4 animate-spin" />
            ) : (
              <Download className="size-4" />
            )}
            {zipping !== null
              ? stf(lang, "stems.zipping", { pct: String(zipping) })
              : st(lang, "stems.zip")}
          </button>
        </div>
        <div className="flex items-center gap-3">
          <button
            type="button"
            aria-label={st(lang, playing ? "stems.pause" : "stems.mix")}
            onClick={() => setPlaying(!playing)}
            className="inline-flex size-12 shrink-0 items-center justify-center rounded-full bg-[var(--fg)] text-[var(--bg)] outline-none transition-transform hover:scale-105 focus-visible:ring-2 focus-visible:ring-[var(--brand)]"
          >
            {playing ? (
              <Pause className="size-5 fill-current" />
            ) : (
              <Play className="size-5 translate-x-px fill-current" />
            )}
          </button>
          <div className="min-w-0 flex-1">
            <input
              type="range"
              aria-label={st(lang, "stems.seek")}
              aria-valuetext={`${formatClock(time)} / ${formatClock(length)}`}
              min={0}
              max={length || 0}
              step={0.1}
              value={Math.min(time, length || 0)}
              onChange={(event) => seek(Number(event.target.value))}
              className="studio-range w-full"
              style={{ "--pct": `${pct}%` } as React.CSSProperties}
            />
            <div className="mt-0.5 flex items-center justify-between gap-2 text-[12px] tabular-nums text-[var(--fg-muted)]">
              <span>
                {formatClock(time)} / {formatClock(length)}
              </span>
              <button
                type="button"
                disabled={isFullMix(mix)}
                onClick={() => setMix(FULL_MIX)}
                className="rounded-full px-2 py-0.5 font-medium outline-none hover:text-[var(--fg)] focus-visible:ring-2 focus-visible:ring-[var(--brand)] disabled:opacity-0"
              >
                {st(lang, "stems.all")}
              </button>
            </div>
          </div>
        </div>
        <p className="text-[12.5px] text-pretty text-[var(--fg-subtle)]">
          {st(lang, "stems.tracksHint")}
        </p>
      </div>
      <ul className="space-y-2">
        {tracks.map((track) => (
          <StemRow
            key={track.name}
            track={track}
            loudest={loudest}
            mix={mix}
            playing={playing}
            pct={pct}
            time={time}
            length={length}
            fileName={fileName(track.name)}
            onPress={() => {
              const next = rowPress(mix, playing, track.name);
              setMix(next.mix);
              setPlaying(next.playing);
            }}
            onMix={setMix}
            onSeek={seek}
          />
        ))}
      </ul>
      {tracks.map((track) => (
        // biome-ignore lint/a11y/useMediaCaption: separated music tracks have no captions.
        <audio
          key={track.name}
          ref={(element) => {
            audio.current[track.name] = element;
          }}
          src={track.url}
          preload="auto"
          onLoadedMetadata={(event) => {
            const value = event.currentTarget.duration;
            if (Number.isFinite(value) && value > 0)
              setLength((old) => Math.max(old, value));
          }}
          onEnded={() => {
            setPlaying(false);
            seek(0);
          }}
          className="hidden"
        />
      ))}
    </section>
  );
}

export function StemsView({ page }: { page: StemsPage }) {
  const lang = useLocale();
  // Job changes (claimed, done, failed) re-render the page with fresh data.
  useLiveRefresh(["jobs"]);
  const active =
    page.job?.status === "queued" || page.job?.status === "running";
  const events = useJobEvents(page.job?.id ?? null, active, page.events);
  return (
    <ToolPage
      clip={page.clip}
      eyebrow={st(lang, "stems.title")}
      subtitle={st(lang, "stems.subtitle")}
    >
      {page.tracks ? (
        <>
          <Mixer page={page} />
          {page.job ? (
            <div className="px-1">
              <Log events={events} />
            </div>
          ) : null}
        </>
      ) : (
        <Status page={page} events={events} />
      )}
    </ToolPage>
  );
}
