"use client";

import { cn } from "cn";
import { Download, Loader2, Pause, Play, RotateCcw, Save } from "lucide-react";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";

import { useLocale } from "@/components/locale-provider";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  clampParams,
  computePeaks,
  defaultParams,
  type EditParams,
  encodeWav,
  envelopeAt,
  formatClock,
  isUnchanged,
  MAX_FADE,
  normalizeGain,
  parseClock,
  renderEdit,
} from "@/lib/studio/audio-edit";
import type { Clip } from "@/lib/studio/clips";
import { saveEdit } from "@/lib/studio/edit-save";
import { st, stf } from "@/lib/studio/i18n";
import { encodeMp3 } from "@/lib/studio/mp3";
import { downloadName } from "@/lib/studio/now-playing";
import { editorAudio } from "@/lib/studio/stems";
import { createClient } from "@/lib/supabase/browser";
import { usePlayer } from "@/store/player";
import { ToolPage } from "../tool-page";
import { EditableSlider } from "../ui";
import { Waveform } from "./waveform";

const CARD = "rounded-2xl bg-[var(--surface-1)] p-4 sm:p-5";
const PILL =
  "inline-flex h-9 items-center justify-center gap-2 rounded-full px-4 text-[13px] font-medium outline-none focus-visible:ring-2 focus-visible:ring-[var(--brand)] disabled:cursor-not-allowed disabled:opacity-55";
const PEAKS = 2000;

type Loaded = {
  buffer: AudioBuffer;
  channels: Float32Array[];
  peaks: Float32Array;
};

type Busy = { kind: "wav" | "mp3" | "save"; label: string } | null;

function save(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = name;
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

// A time field: shows m:ss.s, takes the same or plain seconds; Enter or leaving it commits.
function ClockField({
  label,
  value,
  onCommit,
}: {
  label: string;
  value: number;
  onCommit: (seconds: number) => void;
}) {
  const [text, setText] = useState(formatClock(value, true));
  useEffect(() => setText(formatClock(value, true)), [value]);
  const commit = () => {
    const parsed = parseClock(text);
    if (parsed === null) setText(formatClock(value, true));
    else onCommit(parsed);
  };
  return (
    <label className="flex min-w-0 flex-col gap-1 text-[12px] text-[var(--fg-muted)]">
      {label}
      <input
        inputMode="decimal"
        value={text}
        onChange={(event) => setText(event.target.value)}
        onBlur={commit}
        onKeyDown={(event) => {
          if (event.key === "Enter") {
            event.preventDefault();
            commit();
          } else if (event.key === "Escape") {
            setText(formatClock(value, true));
          }
        }}
        className="h-9 w-full rounded-lg bg-[var(--surface-2)] px-3 text-[14px] tabular-nums text-[var(--fg)] outline-none focus-visible:ring-2 focus-visible:ring-[var(--brand)]"
      />
    </label>
  );
}

function Editor({ clip, url }: { clip: Clip; url: string }) {
  const lang = useLocale();
  const router = useRouter();
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const [params, setParams] = useState<EditParams>(defaultParams(0));
  const [position, setPosition] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [busy, setBusy] = useState<Busy>(null);
  const [confirm, setConfirm] = useState(false);
  const context = useRef<AudioContext | null>(null);
  const source = useRef<AudioBufferSourceNode | null>(null);
  const started = useRef({ at: 0, from: 0 });
  const title = clip.title || st(lang, "clip.untitled");
  // A refresh signs the same file again under a new URL: only a new take reloads the editor.
  const source0 = useRef(url);
  source0.current = url;

  // biome-ignore lint/correctness/useExhaustiveDependencies: `attempt` reloads after an error.
  useEffect(() => {
    let alive = true;
    setFailed(false);
    setLoaded(null);
    (async () => {
      try {
        const response = await fetch(source0.current);
        if (!response.ok) throw new Error(String(response.status));
        const bytes = await response.arrayBuffer();
        context.current ??= new AudioContext();
        const buffer = await context.current.decodeAudioData(bytes);
        const channels = Array.from(
          { length: buffer.numberOfChannels },
          (_, i) => buffer.getChannelData(i),
        );
        if (!alive) return;
        setLoaded({ buffer, channels, peaks: computePeaks(channels, PEAKS) });
        setParams(defaultParams(buffer.duration));
        setPosition(0);
      } catch {
        if (alive) setFailed(true);
      }
    })();
    return () => {
      alive = false;
    };
  }, [clip.chosenTakeId, attempt]);

  useEffect(
    () => () => {
      source.current?.stop();
      void context.current?.close();
    },
    [],
  );

  const duration = loaded?.buffer.duration ?? 0;
  const gain = useMemo(
    () =>
      loaded
        ? normalizeGain(loaded.channels, loaded.buffer.sampleRate, params)
        : 1,
    [loaded, params],
  );

  const stop = useCallback(() => {
    const node = source.current;
    source.current = null;
    if (node) {
      node.onended = null;
      node.stop();
    }
  }, []);

  // Plays the edit from `from` (seconds of the original) through the same envelope the export
  // renders: the kept part only, the fades as ramps, the normalising gain.
  const start = useCallback(
    async (from: number) => {
      const ctx = context.current;
      if (!loaded || !ctx) return;
      stop();
      await ctx.resume();
      const at = Math.min(Math.max(from, params.start), params.end - 0.01);
      const node = ctx.createBufferSource();
      node.buffer = loaded.buffer;
      const amp = ctx.createGain();
      const now = ctx.currentTime;
      const length = params.end - params.start;
      const t0 = at - params.start;
      amp.gain.setValueAtTime(gain * envelopeAt(t0, params), now);
      if (params.fadeIn > 0 && t0 < params.fadeIn)
        amp.gain.linearRampToValueAtTime(gain, now + (params.fadeIn - t0));
      const fadeFrom = length - params.fadeOut;
      if (params.fadeOut > 0) {
        if (t0 < fadeFrom) amp.gain.setValueAtTime(gain, now + (fadeFrom - t0));
        amp.gain.linearRampToValueAtTime(0, now + (length - t0));
      }
      node.connect(amp).connect(ctx.destination);
      node.onended = () => {
        if (source.current !== node) return;
        source.current = null;
        setPlaying(false);
        setPosition(params.start);
      };
      node.start(0, at, params.end - at);
      source.current = node;
      started.current = { at: now, from: at };
      usePlayer.getState().set({ playing: false });
      setPlaying(true);
    },
    [loaded, params, gain, stop],
  );

  // The position follows the sound while it plays.
  useEffect(() => {
    if (!playing) return;
    let frame = 0;
    const tick = () => {
      const ctx = context.current;
      if (ctx)
        setPosition(
          started.current.from + (ctx.currentTime - started.current.at),
        );
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [playing]);

  // A change while playing is heard at once: playback restarts from where it is.
  const positionRef = useRef(position);
  positionRef.current = position;
  // biome-ignore lint/correctness/useExhaustiveDependencies: restart only on new settings.
  useEffect(() => {
    if (source.current) void start(positionRef.current);
  }, [params]);

  // The main player taking over pauses the editor.
  useEffect(
    () =>
      usePlayer.subscribe((state, previous) => {
        if (state.playing && !previous.playing) {
          stop();
          setPlaying(false);
        }
      }),
    [stop],
  );

  const update = (patch: Partial<EditParams>) =>
    setParams((old) =>
      clampParams(
        { ...old, ...patch },
        duration,
        "start" in patch ? "start" : "end" in patch ? "end" : undefined,
      ),
    );

  const toggle = () => {
    if (playing) {
      stop();
      setPlaying(false);
      return;
    }
    const from =
      position < params.start || position >= params.end - 0.05
        ? params.start
        : position;
    void start(from);
  };

  const seek = (at: number) => {
    const clamped = Math.min(Math.max(at, 0), duration);
    setPosition(clamped);
    if (playing) void start(clamped);
  };

  const rendered = () => {
    if (!loaded) throw new Error("not loaded");
    return renderEdit(loaded.channels, loaded.buffer.sampleRate, params);
  };
  const fileName = (ext: string) =>
    downloadName(`${title} - ${st(lang, "edit.title")}`, `https://x/x.${ext}`);

  const mp3 = async () =>
    encodeMp3(rendered(), loaded?.buffer.sampleRate ?? 44_100, {
      onProgress: (fraction) =>
        setBusy((old) =>
          old
            ? {
                ...old,
                label: stf(lang, "edit.encoding", {
                  pct: String(Math.round(fraction * 100)),
                }),
              }
            : old,
        ),
    });

  const exportWav = async () => {
    setBusy({ kind: "wav", label: st(lang, "edit.wav") });
    try {
      // Let the button show its spinner before the work blocks the page.
      await new Promise((resolve) => setTimeout(resolve, 0));
      const bytes = encodeWav(rendered(), loaded?.buffer.sampleRate ?? 44_100);
      save(
        new Blob([bytes as BlobPart], { type: "audio/wav" }),
        fileName("wav"),
      );
    } catch {
      toast.error(st(lang, "edit.exportFailed"));
    } finally {
      setBusy(null);
    }
  };

  const exportMp3 = async () => {
    setBusy({ kind: "mp3", label: stf(lang, "edit.encoding", { pct: "0" }) });
    try {
      save(await mp3(), fileName("mp3"));
    } catch {
      toast.error(st(lang, "edit.exportFailed"));
    } finally {
      setBusy(null);
    }
  };

  const saveVersion = async () => {
    setConfirm(false);
    stop();
    setPlaying(false);
    setBusy({ kind: "save", label: stf(lang, "edit.encoding", { pct: "0" }) });
    try {
      const file = await mp3();
      const result = await saveEdit(createClient(), clip.id, file, () =>
        setBusy({ kind: "save", label: st(lang, "edit.uploading") }),
      );
      if (!result.ok) throw new Error("save");
      toast.success(st(lang, "edit.saved"));
      router.refresh();
      if (window.history.length > 1) router.back();
      else router.push("/library");
    } catch {
      toast.error(st(lang, "edit.saveFailed"));
    } finally {
      setBusy(null);
    }
  };

  if (failed)
    return (
      <section className={cn(CARD, "space-y-3")}>
        <p role="alert" className="text-[14px] text-[var(--danger)]">
          {st(lang, "edit.loadFailed")}
        </p>
        <button
          type="button"
          onClick={() => setAttempt((n) => n + 1)}
          className={cn(
            PILL,
            "bg-[var(--surface-2)] hover:bg-[var(--surface-glass-hover)]",
          )}
        >
          <RotateCcw className="size-4" />
          {st(lang, "edit.retry")}
        </button>
      </section>
    );
  if (!loaded)
    return (
      <section
        className={cn(
          CARD,
          "flex items-center gap-3 text-[14px] text-[var(--fg-muted)]",
        )}
        aria-busy
      >
        <Loader2 className="size-4 animate-spin" />
        {st(lang, "edit.loading")}
      </section>
    );

  const length = params.end - params.start;
  const unchanged = isUnchanged(params, duration);
  const fadeLimit = Math.min(MAX_FADE, Math.floor(length * 10) / 10);
  return (
    <>
      <section className={cn(CARD, "space-y-4")}>
        <Waveform
          peaks={loaded.peaks}
          duration={duration}
          params={params}
          position={position}
          onParams={update}
          onSeek={seek}
        />
        <div className="flex items-center gap-3">
          <button
            type="button"
            aria-label={st(lang, playing ? "edit.pause" : "edit.play")}
            onClick={toggle}
            className="inline-flex size-12 shrink-0 items-center justify-center rounded-full bg-[var(--fg)] text-[var(--bg)] outline-none transition-transform hover:scale-105 focus-visible:ring-2 focus-visible:ring-[var(--brand)]"
          >
            {playing ? (
              <Pause className="size-5 fill-current" />
            ) : (
              <Play className="size-5 translate-x-px fill-current" />
            )}
          </button>
          <p className="text-[13px] tabular-nums text-[var(--fg-muted)]">
            <span className="text-[var(--fg)]">
              {formatClock(Math.max(0, position - params.start), true)}
            </span>{" "}
            / {formatClock(length, true)}
          </p>
          <button
            type="button"
            disabled={unchanged}
            onClick={() => setParams(defaultParams(duration))}
            className={cn(
              PILL,
              "ml-auto px-3 text-[var(--fg-muted)] hover:bg-[var(--surface-glass-hover)] hover:text-[var(--fg)] disabled:opacity-0",
            )}
          >
            <RotateCcw className="size-4" />
            <span className="max-sm:sr-only">{st(lang, "edit.reset")}</span>
          </button>
        </div>
        <div className="grid grid-cols-3 gap-3">
          <ClockField
            label={st(lang, "edit.start")}
            value={params.start}
            onCommit={(start) => update({ start })}
          />
          <ClockField
            label={st(lang, "edit.end")}
            value={params.end}
            onCommit={(end) => update({ end })}
          />
          <div className="flex min-w-0 flex-col gap-1 text-[12px] text-[var(--fg-muted)]">
            {st(lang, "edit.length")}
            <p className="flex h-9 items-center px-1 text-[14px] tabular-nums text-[var(--fg)]">
              {formatClock(length, true)}
            </p>
          </div>
        </div>
      </section>

      <section className={cn(CARD, "space-y-5")}>
        <div className="grid gap-5 sm:grid-cols-2">
          <EditableSlider
            label={st(lang, "edit.fadeIn")}
            value={Math.round(params.fadeIn * 10) / 10}
            onChange={(fadeIn) => update({ fadeIn })}
            min={0}
            max={fadeLimit}
            step={0.1}
            display={stf(lang, "edit.seconds", { n: params.fadeIn.toFixed(1) })}
            format={(value) => value.toFixed(1)}
          />
          <EditableSlider
            label={st(lang, "edit.fadeOut")}
            value={Math.round(params.fadeOut * 10) / 10}
            onChange={(fadeOut) => update({ fadeOut })}
            min={0}
            max={fadeLimit}
            step={0.1}
            display={stf(lang, "edit.seconds", {
              n: params.fadeOut.toFixed(1),
            })}
            format={(value) => value.toFixed(1)}
          />
        </div>
        <label className="flex cursor-pointer items-start justify-between gap-4">
          <span className="min-w-0">
            <span className="block text-[14px] font-medium">
              {st(lang, "edit.normalize")}
            </span>
            <span className="mt-0.5 block text-[12.5px] text-[var(--fg-muted)]">
              {st(lang, "edit.normalizeHint")}
            </span>
          </span>
          <input
            type="checkbox"
            role="switch"
            aria-checked={params.normalize}
            checked={params.normalize}
            onChange={(event) => update({ normalize: event.target.checked })}
            className="peer sr-only"
          />
          <span
            aria-hidden
            className="relative mt-0.5 inline-flex h-6 w-10 shrink-0 rounded-full bg-[var(--surface-2)] transition-colors peer-checked:bg-[var(--brand)] peer-focus-visible:ring-2 peer-focus-visible:ring-[var(--brand)] peer-focus-visible:ring-offset-2 peer-focus-visible:ring-offset-[var(--surface-1)] after:absolute after:top-0.5 after:left-0.5 after:size-5 after:rounded-full after:bg-[var(--fg)] after:shadow after:transition-transform peer-checked:after:translate-x-4 peer-checked:after:bg-white"
          />
        </label>
      </section>

      <section className={cn(CARD, "flex flex-wrap items-center gap-2")}>
        <button
          type="button"
          disabled={busy !== null}
          onClick={() => void exportWav()}
          className={cn(
            PILL,
            "bg-[var(--surface-2)] hover:bg-[var(--surface-glass-hover)]",
          )}
        >
          {busy?.kind === "wav" ? (
            <Loader2 className="size-4 animate-spin" />
          ) : (
            <Download className="size-4" />
          )}
          {st(lang, "edit.wav")}
        </button>
        <button
          type="button"
          disabled={busy !== null}
          onClick={() => void exportMp3()}
          className={cn(
            PILL,
            "bg-[var(--surface-2)] hover:bg-[var(--surface-glass-hover)]",
          )}
        >
          {busy?.kind === "mp3" ? (
            <Loader2 className="size-4 animate-spin" />
          ) : (
            <Download className="size-4" />
          )}
          {busy?.kind === "mp3" ? busy.label : st(lang, "edit.mp3")}
        </button>
        <button
          type="button"
          disabled={busy !== null || unchanged}
          onClick={() => setConfirm(true)}
          className={cn(
            PILL,
            "bg-cta text-[var(--brand-ink)] hover:brightness-110 sm:ml-auto max-sm:w-full",
          )}
        >
          {busy?.kind === "save" ? (
            <Loader2 className="size-4 animate-spin" />
          ) : (
            <Save className="size-4" />
          )}
          {busy?.kind === "save" ? busy.label : st(lang, "edit.save")}
        </button>
      </section>

      <Dialog open={confirm} onOpenChange={setConfirm}>
        <DialogContent showCloseButton={false} className="gap-4 sm:max-w-sm">
          <DialogTitle className="text-lg">
            {st(lang, "edit.saveTitle")}
          </DialogTitle>
          <DialogDescription>{st(lang, "edit.saveBody")}</DialogDescription>
          <div className="flex justify-end gap-2">
            <DialogClose className="inline-flex h-9 items-center rounded-full bg-[var(--surface-2)] px-4 text-[13px] font-medium outline-none focus-visible:ring-2 focus-visible:ring-[var(--brand)]">
              {st(lang, "edit.cancel")}
            </DialogClose>
            <button
              type="button"
              onClick={() => void saveVersion()}
              className="inline-flex h-9 items-center gap-2 rounded-full bg-cta px-4 text-[13px] font-medium text-[var(--brand-ink)] outline-none focus-visible:ring-2 focus-visible:ring-[var(--brand)]"
            >
              {st(lang, "edit.saveConfirm")}
            </button>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}

export function AudioEditor({ clip }: { clip: Clip }) {
  const lang = useLocale();
  const url = editorAudio(clip);
  return (
    <ToolPage
      clip={clip}
      eyebrow={st(lang, "edit.title")}
      subtitle={st(lang, "edit.subtitle")}
    >
      {url ? (
        <Editor clip={clip} url={url} />
      ) : (
        <section className={CARD}>
          <p className="text-[14px] text-[var(--fg-muted)]">
            {st(lang, "edit.unavailable")}
          </p>
        </section>
      )}
    </ToolPage>
  );
}
