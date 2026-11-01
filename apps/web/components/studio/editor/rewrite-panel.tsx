"use client";

import {
  AUDITION,
  KIE_CREDITS,
  linesInRange,
  maxSection,
  type RewriteEngine,
  replaceSection,
  SECTION_LIMITS,
  sectionProblem,
  sectionText,
  timedLyrics,
} from "@mellodifai/shared";
import { cn } from "cn";
import {
  Check,
  Loader2,
  Pause,
  Play,
  RotateCcw,
  Sparkles,
  Trash2,
} from "lucide-react";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";

import {
  discardSectionEdit,
  keepSectionEdit,
  requestSectionEdit,
} from "@/app/actions/songs-from-songs";
import { useLocale } from "@/components/locale-provider";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/components/ui/dialog";
import { computePeaks, formatClock } from "@/lib/studio/audio-edit";
import type { Clip } from "@/lib/studio/clips";
import { st, stf } from "@/lib/studio/i18n";
import {
  canRewrite,
  editPhase,
  loadOpenEdit,
  type RewriteData,
  type RewriteTake,
  rewriteEngines,
  type SectionEditView,
} from "@/lib/studio/rewrite";
import { latestProgress, useJobEvents } from "@/lib/studio/use-job-progress";
import { createClient } from "@/lib/supabase/browser";
import { usePlayer } from "@/store/player";
import { Segmented } from "../ui";
import { useWorkerState } from "../worker-state";
import { ClockField } from "./clock-field";
import { type Range, Waveform } from "./waveform";

const CARD = "rounded-2xl bg-[var(--surface-1)] p-4 sm:p-5";
const PILL =
  "inline-flex h-9 items-center justify-center gap-2 rounded-full px-4 text-[13px] font-medium outline-none focus-visible:ring-2 focus-visible:ring-[var(--brand)] disabled:cursor-not-allowed disabled:opacity-55";
const PEAKS = 2000;
const POLL_MS = 3000;
const ENGINE_KEY = "mellodifai.rewrite.engine";

type Loaded = { duration: number; peaks: Float32Array };

// One audio element plays a stretch of a file: the part of the original, or an alternative
// around the part. The main player pauses while it plays.
function useAudition(lang: "it" | "en") {
  const audio = useRef<HTMLAudioElement | null>(null);
  const stopAt = useRef(0);
  const [playing, setPlaying] = useState<string | null>(null);
  const [position, setPosition] = useState<number | null>(null);
  const stop = useCallback(() => {
    audio.current?.pause();
    setPlaying(null);
    setPosition(null);
  }, []);
  useEffect(() => {
    const element = new Audio();
    element.preload = "auto";
    const tick = () => {
      setPosition(element.currentTime);
      if (element.currentTime >= stopAt.current) {
        element.pause();
        setPlaying(null);
        setPosition(null);
      }
    };
    element.addEventListener("timeupdate", tick);
    element.addEventListener("ended", () => {
      setPlaying(null);
      setPosition(null);
    });
    audio.current = element;
    return () => {
      element.pause();
      element.removeEventListener("timeupdate", tick);
      audio.current = null;
    };
  }, []);
  // The main player taking over stops the audition.
  useEffect(
    () =>
      usePlayer.subscribe((state, previous) => {
        if (state.playing && !previous.playing) stop();
      }),
    [stop],
  );
  const play = useCallback(
    async (id: string, url: string, from: number, to: number) => {
      const element = audio.current;
      if (!element) return;
      if (playing === id) return stop();
      usePlayer.getState().set({ playing: false });
      if (!element.src.endsWith(url)) element.src = url;
      stopAt.current = to;
      const start = () => {
        element.currentTime = Math.max(0, from);
      };
      if (element.readyState >= 1) start();
      else element.addEventListener("loadedmetadata", start, { once: true });
      setPlaying(id);
      try {
        await element.play();
      } catch {
        setPlaying(null);
        toast.error(st(lang, "rw.loadFailed"));
      }
    },
    [playing, stop, lang],
  );
  return { play, stop, playing, position };
}

// The open request, polled while the PC works on it.
function useOpenEdit(versionId: string, initial: SectionEditView | null) {
  const [edit, setEdit] = useState(initial);
  const phase = editPhase(edit);
  const active = phase === "queued" || phase === "running";
  const refresh = useCallback(async () => {
    setEdit(await loadOpenEdit(createClient(), versionId));
  }, [versionId]);
  useEffect(() => {
    if (!active) return;
    const timer = setInterval(() => void refresh(), POLL_MS);
    return () => clearInterval(timer);
  }, [active, refresh]);
  return { edit, setEdit, refresh, phase, active };
}

function TakeChips({
  takes,
  value,
  onChange,
  disabled,
}: {
  takes: RewriteTake[];
  value: string;
  onChange: (id: string) => void;
  disabled: boolean;
}) {
  const lang = useLocale();
  if (takes.length < 2) return null;
  return (
    <fieldset className="m-0 flex min-w-0 flex-wrap items-center gap-1.5 border-0 p-0">
      <legend className="mb-2 text-[12px] text-[var(--fg-muted)]">
        {st(lang, "rw.take")}
      </legend>
      {takes.map((take) => (
        <button
          key={take.id}
          type="button"
          aria-pressed={take.id === value}
          disabled={disabled}
          onClick={() => onChange(take.id)}
          className={cn(
            "h-8 rounded-full px-3.5 text-[13px] font-medium outline-none transition-colors focus-visible:ring-2 focus-visible:ring-[var(--brand)] disabled:opacity-55",
            take.id === value
              ? "bg-[var(--fg)] text-[var(--bg)]"
              : "bg-[var(--surface-2)] text-[var(--fg-muted)] hover:text-[var(--fg)]",
          )}
        >
          {stf(lang, "det.take", { n: String(take.number) })}
          {take.rewritten ? (
            <span className="ml-1 opacity-70">
              · {st(lang, "det.takeRewritten")}
            </span>
          ) : null}
        </button>
      ))}
    </fieldset>
  );
}

// The section's start and end fit the limits: the start stays, the end follows.
function initialRange(take: RewriteTake, duration: number): Range {
  const timed = timedLyrics(take.lyrics, take.timing).find(
    (line) => line.sung && line.start !== null,
  );
  const start = Math.min(
    Math.max(0, duration - SECTION_LIMITS.minSeconds),
    Math.max(
      0,
      Math.floor(((timed?.start ?? duration * 0.25) - 0.5) * 10) / 10,
    ),
  );
  const length = Math.min(15, maxSection(duration));
  return { start, end: Math.min(duration, start + length) };
}

export function RewritePanel({
  clip,
  data,
}: {
  clip: Clip;
  data: RewriteData | null;
}) {
  const lang = useLocale();
  const router = useRouter();
  const worker = useWorkerState();
  const takes = data?.takes ?? [];
  const [takeId, setTakeId] = useState(
    data?.edit?.takeId ??
      takes.find((take) => take.id === clip.chosenTakeId)?.id ??
      takes[0]?.id ??
      "",
  );
  const take = takes.find((item) => item.id === takeId) ?? takes[0] ?? null;
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [failed, setFailed] = useState(false);
  const [range, setRange] = useState<Range>({ start: 0, end: 0 });
  const [manual, setManual] = useState<number[] | null>(null);
  const [text, setText] = useState("");
  const [dirty, setDirty] = useState(false);
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState<"request" | "keep" | "discard" | null>(null);
  const { edit, setEdit, refresh, phase, active } = useOpenEdit(
    clip.id,
    data?.edit ?? null,
  );
  const events = useJobEvents(edit?.job?.id ?? null, active);
  const progress = latestProgress(events, edit?.job?.startedAt ?? null);
  const audition = useAudition(lang);
  const engines = rewriteEngines({
    isAdmin: worker.isAdmin,
    engines: worker.engines,
    lastSeen: worker.lastSeen,
    now: worker.now,
    lang: clip.lang,
  });
  const [engine, setEngine] = useState<RewriteEngine>("kie");
  useEffect(() => {
    try {
      const saved = localStorage.getItem(ENGINE_KEY);
      if (saved === "kie" || saved === "ace-step") setEngine(saved);
    } catch {
      /* Remembering the engine is a convenience. */
    }
  }, []);
  const chosenEngine: RewriteEngine = engines.includes(engine) ? engine : "kie";

  // The waveform of the take being rewritten.
  const takeUrl = take?.audioUrl ?? null;
  const takeKey = take?.id ?? null;
  // biome-ignore lint/correctness/useExhaustiveDependencies: a new take reloads; its URL is read once.
  useEffect(() => {
    if (!takeUrl || !take) return;
    let alive = true;
    setLoaded(null);
    setFailed(false);
    (async () => {
      try {
        const response = await fetch(takeUrl);
        if (!response.ok) throw new Error(String(response.status));
        const context = new AudioContext();
        try {
          const buffer = await context.decodeAudioData(
            await response.arrayBuffer(),
          );
          const channels = Array.from(
            { length: buffer.numberOfChannels },
            (_, i) => buffer.getChannelData(i),
          );
          if (!alive) return;
          setLoaded({
            duration: buffer.duration,
            peaks: computePeaks(channels, PEAKS),
          });
          const open = data?.edit?.takeId === take.id ? data.edit : null;
          setRange(
            open
              ? { start: open.start, end: open.end }
              : initialRange(take, buffer.duration),
          );
          if (open) {
            setManual(open.lines);
            setText(open.sectionLyrics);
            setDirty(true);
          } else {
            setManual(null);
            setDirty(false);
          }
        } finally {
          void context.close();
        }
      } catch {
        if (alive) setFailed(true);
      }
    })();
    return () => {
      alive = false;
    };
  }, [takeKey]);

  const duration = loaded?.duration ?? 0;
  const lyrics = take?.lyrics ?? clip.lyrics;
  const timed = useMemo(
    () => timedLyrics(lyrics, take?.timing ?? null),
    [lyrics, take?.timing],
  );
  const hasTiming = timed.some((line) => line.start !== null);
  const auto = useMemo(
    () => (hasTiming ? linesInRange(timed, range.start, range.end) : []),
    [timed, hasTiming, range],
  );
  const lines = manual ?? auto;
  const linesKey = lines.join(",");
  // A new selection of lines brings their text into the box, unless the owner already changed it.
  // biome-ignore lint/correctness/useExhaustiveDependencies: follows the chosen lines only.
  useEffect(() => {
    if (!dirty) setText(sectionText(lyrics, lines));
  }, [linesKey, lyrics]);
  const problem = loaded
    ? sectionProblem(range.start, range.end, duration)
    : null;
  // The lit lines come into view in the lyrics list as the part moves.
  const lyricList = useRef<HTMLOListElement>(null);
  // biome-ignore lint/correctness/useExhaustiveDependencies: follows the lit lines only.
  useEffect(() => {
    const list = lyricList.current;
    const first = lines[0];
    if (!list || first === undefined) return;
    const item = list.querySelector<HTMLElement>(`[data-line="${first}"]`);
    if (item)
      list.scrollTo({
        top: Math.max(0, item.offsetTop - 8),
        behavior: "smooth",
      });
  }, [linesKey]);
  const max = Math.floor(maxSection(duration) * 10) / 10;
  const full = replaceSection(lyrics, lines, text);
  const busyEdit = active || busy !== null;

  const updateRange = (patch: Partial<Range>) => {
    setRange((old) => {
      const next = { ...old, ...patch };
      next.start = Math.max(0, Math.min(next.start, duration));
      next.end = Math.max(0, Math.min(next.end, duration));
      if (next.end < next.start) {
        if ("start" in patch) next.end = next.start;
        else next.start = next.end;
      }
      return next;
    });
    // A new range lights its own lines again.
    if (hasTiming) setManual(null);
  };
  const toggleLine = (index: number) => {
    setManual((old) => {
      const base = old ?? auto;
      return base.includes(index)
        ? base.filter((item) => item !== index)
        : [...base, index].sort((a, b) => a - b);
    });
  };

  const request = async () => {
    if (!take || problem || !text.trim()) return;
    setConfirm(false);
    setBusy("request");
    audition.stop();
    try {
      const result = await requestSectionEdit({
        versionId: clip.id,
        takeId: take.id,
        engine: chosenEngine,
        start: range.start,
        end: range.end,
        duration,
        lines,
        section: text.trim(),
        full,
      });
      if (!result.ok) throw new Error(result.error);
      await refresh();
    } catch {
      toast.error(st(lang, "rw.requestFailed"));
    } finally {
      setBusy(null);
    }
  };

  const keep = async (alternative: number) => {
    if (!edit) return;
    setBusy("keep");
    audition.stop();
    try {
      const result = await keepSectionEdit({ editId: edit.id, alternative });
      if (!result.ok) throw new Error(result.error);
      toast.success(
        st(lang, clip.status === "takes_review" ? "rw.keptReview" : "rw.kept"),
      );
      setEdit(null);
      setDirty(false);
      setManual(null);
      router.refresh();
    } catch {
      toast.error(st(lang, "rw.keepFailed"));
    } finally {
      setBusy(null);
    }
  };

  const discard = async () => {
    if (!edit) return;
    setBusy("discard");
    audition.stop();
    try {
      const result = await discardSectionEdit({ editId: edit.id });
      if (!result.ok) throw new Error(result.error);
      toast.success(st(lang, "rw.discarded"));
      setEdit(null);
    } catch {
      toast.error(st(lang, "rw.keepFailed"));
    } finally {
      setBusy(null);
    }
  };

  if (!canRewrite(clip) || !take)
    return (
      <section className={CARD}>
        <p className="text-[14px] text-[var(--fg-muted)]">
          {st(lang, takes.length ? "rw.unavailable" : "rw.noTakes")}
        </p>
      </section>
    );
  if (failed)
    return (
      <section className={cn(CARD, "space-y-3")}>
        <p role="alert" className="text-[14px] text-[var(--danger)]">
          {st(lang, "rw.loadFailed")}
        </p>
      </section>
    );
  if (!loaded)
    return (
      <section
        aria-busy
        className={cn(
          CARD,
          "flex items-center gap-3 text-[14px] text-[var(--fg-muted)]",
        )}
      >
        <Loader2 className="size-4 animate-spin" />
        {st(lang, "rw.loading")}
      </section>
    );

  const partId = `part-${take.id}`;
  const length = Math.max(0, range.end - range.start);
  const problemText =
    problem === "half"
      ? stf(lang, "rw.half", { max: String(max) })
      : problem
        ? st(lang, `rw.${problem}`)
        : null;
  const original = { id: "original", url: take.audioUrl };
  const from = Math.max(0, range.start - AUDITION.pre);
  const to = Math.min(duration, range.end + AUDITION.post);
  const balance = worker.balance;
  const low = balance !== null && balance < KIE_CREDITS.replace;
  return (
    <>
      <section className={cn(CARD, "space-y-4")}>
        <TakeChips
          takes={takes}
          value={take.id}
          onChange={(id) => {
            audition.stop();
            setTakeId(id);
          }}
          disabled={busyEdit || phase === "ready"}
        />
        <p className="text-[13px] text-[var(--fg-muted)]">
          {st(lang, "rw.hint")}
        </p>
        <Waveform
          variant="section"
          peaks={loaded.peaks}
          duration={duration}
          range={range}
          position={audition.position ?? range.start}
          onRange={busyEdit || phase === "ready" ? () => {} : updateRange}
          onSeek={() => {}}
          invalid={Boolean(problem)}
        />
        <div className="flex flex-wrap items-end gap-3">
          <button
            type="button"
            onClick={() =>
              void audition.play("part", original.url, range.start, range.end)
            }
            className={cn(
              PILL,
              "bg-[var(--surface-2)] hover:bg-[var(--surface-glass-hover)]",
            )}
          >
            {audition.playing === "part" ? (
              <Pause className="size-4 fill-current" />
            ) : (
              <Play className="size-4 fill-current" />
            )}
            {st(
              lang,
              audition.playing === "part" ? "rw.stopPart" : "rw.playPart",
            )}
          </button>
          <div className="grid min-w-0 flex-1 grid-cols-3 gap-3">
            <ClockField
              label={st(lang, "rw.from")}
              value={range.start}
              onCommit={(start) => updateRange({ start })}
            />
            <ClockField
              label={st(lang, "rw.to")}
              value={range.end}
              onCommit={(end) => updateRange({ end })}
            />
            <div className="flex min-w-0 flex-col gap-1 text-[12px] text-[var(--fg-muted)]">
              {st(lang, "rw.length")}
              <p
                className={cn(
                  "flex h-9 items-center px-1 text-[14px] tabular-nums",
                  problem ? "text-[var(--danger)]" : "text-[var(--fg)]",
                )}
              >
                {formatClock(length, true)}
              </p>
            </div>
          </div>
        </div>
        <p
          role={problem ? "alert" : undefined}
          className={cn(
            "text-[12.5px]",
            problem ? "text-[var(--danger)]" : "text-[var(--fg-muted)]",
          )}
        >
          {problemText ?? stf(lang, "rw.limits", { max: String(max) })}
        </p>
      </section>

      <div className="grid gap-4 md:grid-cols-2">
        <section aria-label={st(lang, "rw.lyrics")} className={CARD}>
          <h3 className="text-[14px] font-medium">{st(lang, "rw.lyrics")}</h3>
          <p className="mt-1 mb-3 text-[12.5px] text-[var(--fg-muted)]">
            {st(lang, hasTiming ? "rw.lyricsTimed" : "rw.lyricsUntimed")}
          </p>
          <ol
            ref={lyricList}
            className="relative max-h-80 space-y-0.5 overflow-y-auto font-mono text-[13px] leading-6 scrollbar-thin"
          >
            {timed.map((line) =>
              line.sung ? (
                <li key={line.index} data-line={line.index}>
                  <button
                    type="button"
                    aria-pressed={lines.includes(line.index)}
                    aria-label={`${st(lang, "rw.markLine")}: ${line.text}`}
                    disabled={busyEdit || phase === "ready"}
                    onClick={() => toggleLine(line.index)}
                    className={cn(
                      "block w-full rounded-md px-2 text-left outline-none transition-colors focus-visible:ring-2 focus-visible:ring-[var(--brand)] disabled:cursor-default",
                      lines.includes(line.index)
                        ? "bg-[color-mix(in_oklab,var(--brand),transparent_80%)] text-[var(--fg)]"
                        : "text-[var(--fg-muted)] hover:bg-[var(--surface-glass-hover)]",
                    )}
                  >
                    {line.text}
                  </button>
                </li>
              ) : (
                <li
                  key={line.index}
                  className="px-2 text-[var(--fg-subtle)]"
                  aria-hidden={!line.text.trim()}
                >
                  {line.text || " "}
                </li>
              ),
            )}
          </ol>
        </section>
        <section className={cn(CARD, "flex flex-col")}>
          <div className="flex items-center justify-between gap-2">
            <label htmlFor={partId} className="text-[14px] font-medium">
              {st(lang, "rw.part")}
            </label>
            {dirty && phase === "none" ? (
              <button
                type="button"
                onClick={() => {
                  setDirty(false);
                  setText(sectionText(lyrics, lines));
                }}
                className="inline-flex h-7 items-center gap-1 rounded-full bg-[var(--surface-2)] px-2.5 text-[12px] font-medium text-[var(--fg-muted)] outline-none hover:text-[var(--fg)] focus-visible:ring-2 focus-visible:ring-[var(--brand)]"
              >
                <RotateCcw className="size-3.5" />
                {st(lang, "edit.reset")}
              </button>
            ) : null}
          </div>
          <p className="mt-1 mb-3 text-[12.5px] text-[var(--fg-muted)]">
            {lines.length === 0
              ? st(lang, "rw.noLines")
              : st(lang, "rw.partHint")}
          </p>
          <textarea
            id={partId}
            value={text}
            disabled={busyEdit || phase === "ready"}
            maxLength={5000}
            placeholder={st(lang, "rw.partPlaceholder")}
            onChange={(event) => {
              setText(event.target.value);
              setDirty(true);
            }}
            className="min-h-40 w-full flex-1 resize-y rounded-xl bg-[var(--surface-2)] p-3 font-mono text-[13px] leading-6 outline-none placeholder:text-[var(--fg-subtle)] focus-visible:ring-2 focus-visible:ring-[var(--brand)] disabled:opacity-70"
          />
        </section>
      </div>

      {phase === "none" ? (
        <section className={cn(CARD, "space-y-3")}>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <span className="text-[14px] font-medium">
              {st(lang, "rw.engine")}
            </span>
            <Segmented<RewriteEngine>
              label={st(lang, "rw.engine")}
              value={chosenEngine}
              onChange={(next) => {
                if (!next) return;
                setEngine(next);
                try {
                  localStorage.setItem(ENGINE_KEY, next);
                } catch {
                  /* Convenience only. */
                }
              }}
              options={engines.map((value) => ({
                value,
                label:
                  value === "kie"
                    ? stf(lang, "rw.engineKie", {
                        c: String(KIE_CREDITS.replace),
                      })
                    : st(lang, "rw.engineAce"),
              }))}
            />
          </div>
          <p className="text-[12.5px] text-[var(--fg-muted)]">
            {st(
              lang,
              chosenEngine === "kie" ? "rw.engineKieHint" : "rw.engineAceHint",
            )}
            {chosenEngine === "kie" && !take.kieDirect
              ? ` ${st(lang, "rw.kieAsFile")}`
              : ""}
          </p>
          <button
            type="button"
            disabled={Boolean(problem) || !text.trim() || busy !== null}
            onClick={() => setConfirm(true)}
            className={cn(
              PILL,
              "h-11 w-full bg-cta text-[15px] text-white shadow-[0_8px_30px_-10px_var(--brand)] hover:brightness-110",
            )}
          >
            {busy === "request" ? (
              <Loader2 className="size-4 animate-spin" />
            ) : (
              <Sparkles className="size-4" />
            )}
            {st(lang, "rw.create")}
          </button>
        </section>
      ) : phase === "queued" || phase === "running" ? (
        <section aria-live="polite" aria-busy className={cn(CARD, "space-y-3")}>
          <p className="flex items-center gap-2 text-[14px] font-medium">
            <Loader2 className="size-4 animate-spin text-[var(--brand)]" />
            {phase === "queued"
              ? edit?.queuePosition
                ? stf(lang, "rw.queued", { n: String(edit.queuePosition) })
                : st(lang, "rw.waiting")
              : (progress?.message ?? st(lang, "rw.working"))}
          </p>
          <div
            role="progressbar"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={Math.round(Number(progress?.progress ?? 0))}
            className="h-1.5 overflow-hidden rounded-full bg-[var(--surface-2)]"
          >
            <div
              className="h-full rounded-full bg-cta transition-[width] duration-500"
              style={{
                width: `${Math.max(3, Number(progress?.progress ?? 0))}%`,
              }}
            />
          </div>
        </section>
      ) : phase === "failed" ? (
        <section className={cn(CARD, "space-y-3")}>
          <p role="alert" className="text-[14px] text-[var(--danger)]">
            {st(lang, "rw.failed")}
            {edit?.job?.error ? ` ${edit.job.error}` : ""}
          </p>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              disabled={busy !== null}
              onClick={() => setConfirm(true)}
              className={cn(PILL, "bg-cta text-white hover:brightness-110")}
            >
              <RotateCcw className="size-4" />
              {st(lang, "rw.retry")}
            </button>
            <button
              type="button"
              disabled={busy !== null}
              onClick={() => void discard()}
              className={cn(
                PILL,
                "bg-[var(--surface-2)] hover:bg-[var(--surface-glass-hover)]",
              )}
            >
              <Trash2 className="size-4" />
              {st(lang, "rw.discard")}
            </button>
          </div>
        </section>
      ) : edit ? (
        <section
          aria-label={st(lang, "rw.alternatives")}
          className={cn(CARD, "space-y-3")}
        >
          <div>
            <h3 className="text-[14px] font-medium">
              {st(lang, "rw.alternatives")}
            </h3>
            <p className="mt-1 text-[12.5px] text-[var(--fg-muted)]">
              {stf(lang, "rw.alternativesHint", {
                pre: String(AUDITION.pre),
                post: String(AUDITION.post),
              })}
            </p>
          </div>
          <ul className="space-y-2">
            {[
              {
                id: "original",
                url: original.url,
                name: st(lang, "rw.original"),
              },
              ...edit.alternatives.map((alt, i) => ({
                id: `alt-${i}`,
                url: alt.url,
                name: stf(lang, "rw.alt", { n: String(i + 1) }),
                index: i,
              })),
            ].map((item) => (
              <li
                key={item.id}
                className={cn(
                  "flex flex-wrap items-center gap-2 rounded-xl px-2 py-2",
                  audition.playing === item.id
                    ? "bg-[color-mix(in_oklab,var(--brand),transparent_88%)]"
                    : "bg-[var(--surface-2)]",
                )}
              >
                <button
                  type="button"
                  aria-label={stf(lang, "rw.listen", { name: item.name })}
                  onClick={() =>
                    void audition.play(item.id, item.url, from, to)
                  }
                  className="inline-flex size-9 shrink-0 items-center justify-center rounded-full bg-[var(--fg)] text-[var(--bg)] outline-none hover:scale-105 focus-visible:ring-2 focus-visible:ring-[var(--brand)]"
                >
                  {audition.playing === item.id ? (
                    <Pause className="size-4 fill-current" />
                  ) : (
                    <Play className="size-4 translate-x-px fill-current" />
                  )}
                </button>
                <span className="min-w-0 flex-1 text-[14px] font-medium">
                  {item.name}
                </span>
                {"index" in item && typeof item.index === "number" ? (
                  <button
                    type="button"
                    disabled={busy !== null}
                    onClick={() => void keep(item.index as number)}
                    className={cn(
                      PILL,
                      "h-8 bg-cta px-3 text-white hover:brightness-110",
                    )}
                  >
                    {busy === "keep" ? (
                      <Loader2 className="size-3.5 animate-spin" />
                    ) : (
                      <Check className="size-3.5" />
                    )}
                    {st(lang, "rw.keep")}
                  </button>
                ) : null}
              </li>
            ))}
          </ul>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              disabled={busy !== null}
              onClick={() => setConfirm(true)}
              className={cn(
                PILL,
                "bg-[var(--surface-2)] hover:bg-[var(--surface-glass-hover)]",
              )}
            >
              <Sparkles className="size-4" />
              {st(lang, "rw.again")}
            </button>
            <button
              type="button"
              disabled={busy !== null}
              onClick={() => void discard()}
              className={cn(
                PILL,
                "text-[var(--fg-muted)] hover:bg-[var(--surface-glass-hover)] hover:text-[var(--danger)]",
              )}
            >
              <Trash2 className="size-4" />
              {st(lang, "rw.discard")}
            </button>
          </div>
        </section>
      ) : null}

      <Dialog open={confirm} onOpenChange={setConfirm}>
        <DialogContent showCloseButton={false} className="gap-4 sm:max-w-sm">
          <DialogTitle className="text-lg">
            {st(lang, "rw.confirmTitle")}
          </DialogTitle>
          <DialogDescription>
            {chosenEngine === "kie"
              ? stf(lang, "rw.confirmKie", {
                  from: formatClock(range.start, true),
                  to: formatClock(range.end, true),
                  c: String(KIE_CREDITS.replace),
                })
              : stf(lang, "rw.confirmAce", {
                  from: formatClock(range.start, true),
                  to: formatClock(range.end, true),
                })}
            {chosenEngine === "kie" && balance !== null ? (
              <span
                className={cn(
                  "mt-2 block",
                  low ? "text-[var(--danger)]" : "text-[var(--fg-muted)]",
                )}
              >
                {low
                  ? stf(lang, "rw.confirmLow", {
                      n: String(balance),
                      c: String(KIE_CREDITS.replace),
                    })
                  : stf(lang, "rw.confirmBalance", { n: String(balance) })}
              </span>
            ) : null}
          </DialogDescription>
          <div className="flex justify-end gap-2">
            <DialogClose className="inline-flex h-9 items-center rounded-full bg-[var(--surface-2)] px-4 text-[13px] font-medium outline-none focus-visible:ring-2 focus-visible:ring-[var(--brand)]">
              {st(lang, "rw.cancel")}
            </DialogClose>
            <button
              type="button"
              disabled={(chosenEngine === "kie" && low) || busy !== null}
              onClick={() => void request()}
              className="inline-flex h-9 items-center gap-2 rounded-full bg-cta px-4 text-[13px] font-medium text-white outline-none focus-visible:ring-2 focus-visible:ring-[var(--brand)] disabled:opacity-55"
            >
              {st(lang, "rw.confirm")}
            </button>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
