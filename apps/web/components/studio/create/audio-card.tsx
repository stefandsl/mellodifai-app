"use client";

import {
  KIE_SOURCE_MAX_SECONDS,
  type SongEngine,
  type SourceMode,
  sourceModesFor,
} from "@mellodifai/shared";
import { cn } from "cn";
import {
  Library,
  Loader2,
  Mic,
  Music2,
  Pause,
  Play,
  Upload,
  X,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";

import { useLocale } from "@/components/locale-provider";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/components/ui/dialog";
import { formatClock } from "@/lib/studio/audio-edit";
import {
  AUDIO_ACCEPT,
  AUDIO_LIMIT_MB,
  audioProblem,
  audioSeconds,
  titleFromFile,
  uploadAudio,
  uploadedAudioUrl,
} from "@/lib/studio/audio-files";
import { SONG_DRAG_TYPE, sourceTake } from "@/lib/studio/audio-source";
import type { Clip } from "@/lib/studio/clips";
import { engineName } from "@/lib/studio/engines";
import { st, stf } from "@/lib/studio/i18n";
import { useTranscription } from "@/lib/studio/use-transcription";
import { createClient } from "@/lib/supabase/browser";
import { type CreateAudio, useCreateForm } from "@/store/create-form";
import { useKnownClips } from "@/store/details";
import { usePlayer } from "@/store/player";
import { ClockField } from "../editor/clock-field";
import { PanelCard, Segmented } from "../ui";

const PILL =
  "inline-flex h-8 items-center gap-1.5 rounded-full bg-[var(--surface-2)] px-3 text-[12.5px] font-medium text-[var(--fg-muted)] outline-none hover:text-[var(--fg)] focus-visible:ring-2 focus-visible:ring-[var(--brand)] disabled:opacity-55";

const MODE_LABEL: Record<
  SourceMode,
  "aud.reference" | "aud.cover" | "aud.extend"
> = {
  reference: "aud.reference",
  cover: "aud.cover",
  extend: "aud.extend",
};
const MODE_HINT: Record<
  SourceMode,
  "aud.hintReference" | "aud.hintCover" | "aud.hintExtend"
> = {
  reference: "aud.hintReference",
  cover: "aud.hintCover",
  extend: "aud.hintExtend",
};

// The audio a song made from audio starts with, given the clip a song card or the library gives.
export function audioFromClip(
  clip: Clip,
  mode: SourceMode,
  lang: "it" | "en",
): CreateAudio | null {
  const take = sourceTake(clip);
  if (!take) return null;
  return {
    mode,
    takeId: take.id,
    versionId: clip.id,
    title: clip.title || st(lang, "clip.untitled"),
    url: take.url,
  };
}

function LibraryPicker({
  open,
  onOpenChange,
  onPick,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onPick: (clip: Clip) => void;
}) {
  const lang = useLocale();
  const known = useKnownClips((s) => s.known);
  const [query, setQuery] = useState("");
  const songs = useMemo(
    () =>
      Object.values(known)
        .filter((clip) => !clip.trashedAt && sourceTake(clip))
        .filter((clip) =>
          clip.title.toLowerCase().includes(query.trim().toLowerCase()),
        )
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
    [known, query],
  );
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[80dvh] flex-col gap-3 sm:max-w-md">
        <DialogTitle className="text-lg">
          {st(lang, "aud.pickTitle")}
        </DialogTitle>
        <DialogDescription className="sr-only">
          {st(lang, "aud.pickSearch")}
        </DialogDescription>
        <input
          type="search"
          value={query}
          aria-label={st(lang, "aud.pickSearch")}
          placeholder={st(lang, "aud.pickSearch")}
          onChange={(event) => setQuery(event.target.value)}
          className="h-9 w-full rounded-full bg-[var(--surface-2)] px-3 text-[14px] outline-none placeholder:text-[var(--fg-subtle)] focus-visible:ring-2 focus-visible:ring-[var(--brand)]"
        />
        <ul className="min-h-0 flex-1 space-y-1 overflow-y-auto scrollbar-thin">
          {songs.length === 0 ? (
            <li className="px-2 py-6 text-center text-[13px] text-[var(--fg-muted)]">
              {st(lang, "aud.pickEmpty")}
            </li>
          ) : (
            songs.map((clip) => (
              <li key={clip.id}>
                <button
                  type="button"
                  onClick={() => onPick(clip)}
                  className="flex w-full items-center gap-3 rounded-xl p-2 text-left outline-none hover:bg-[var(--surface-glass-hover)] focus-visible:ring-2 focus-visible:ring-[var(--brand)]"
                >
                  <span
                    aria-hidden
                    className="size-10 shrink-0 rounded-lg"
                    style={{ background: clip.art }}
                  />
                  <span className="min-w-0">
                    <span className="block truncate text-[14px] font-medium">
                      {clip.title || st(lang, "clip.untitled")}
                    </span>
                    <span className="block truncate text-[12px] text-[var(--fg-muted)]">
                      {clip.style}
                    </span>
                  </span>
                </button>
              </li>
            ))
          )}
        </ul>
      </DialogContent>
    </Dialog>
  );
}

// "Audio": the song starts from a recording (an upload, a song of the library, a song card dropped
// here) as a cover, a reference or an extension, in the ways the chosen engine can (T12).
export function AudioCard({ engine }: { engine: SongEngine }) {
  const lang = useLocale();
  const f = useCreateForm();
  const audio = f.audio;
  const [picking, setPicking] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [over, setOver] = useState(false);
  const [playing, setPlaying] = useState(false);
  const picker = useRef<HTMLInputElement>(null);
  const element = useRef<HTMLAudioElement | null>(null);
  const transcription = useTranscription();
  const modes = sourceModesFor(engine);
  const mode: SourceMode = audio?.mode ?? f.audioMode;

  // A new source stops and forgets the old one's player.
  // biome-ignore lint/correctness/useExhaustiveDependencies: runs when the source changes.
  useEffect(() => {
    element.current?.pause();
    element.current = null;
    setPlaying(false);
  }, [audio?.url]);
  useEffect(() => () => element.current?.pause(), []);
  useEffect(
    () =>
      usePlayer.subscribe((state, previous) => {
        if (state.playing && !previous.playing) {
          element.current?.pause();
          setPlaying(false);
        }
      }),
    [],
  );

  const setAudio = (next: CreateAudio | null) => f.set({ audio: next });
  const pickClip = (clip: Clip) => {
    const next = audioFromClip(clip, mode, lang);
    if (next) setAudio(next);
    setPicking(false);
  };
  const upload = async (file: File) => {
    const problem = audioProblem(file);
    if (problem) {
      toast.error(
        stf(lang, problem === "tooBig" ? "imp.tooBig" : "imp.wrongType", {
          name: file.name,
          mb: String(AUDIO_LIMIT_MB),
        }),
      );
      return;
    }
    setUploading(true);
    try {
      const [path, seconds] = await Promise.all([
        uploadAudio(createClient(), file, file.name),
        audioSeconds(file),
      ]);
      setAudio({
        mode,
        upload: path,
        title: titleFromFile(file.name),
        url: uploadedAudioUrl(path),
        ...(seconds ? { duration: seconds } : {}),
      });
    } catch {
      toast.error(st(lang, "aud.uploadFailed"));
    } finally {
      setUploading(false);
    }
  };
  const toggle = () => {
    if (!audio) return;
    if (playing) {
      element.current?.pause();
      setPlaying(false);
      return;
    }
    usePlayer.getState().set({ playing: false });
    element.current ??= new Audio(audio.url);
    element.current.onended = () => setPlaying(false);
    element.current.onloadedmetadata = () => {
      const seconds = element.current?.duration;
      if (seconds && Number.isFinite(seconds) && !audio.duration)
        setAudio({ ...audio, duration: Math.round(seconds * 100) / 100 });
    };
    void element.current.play().then(
      () => setPlaying(true),
      () => setPlaying(false),
    );
  };
  const transcribe = async () => {
    if (!audio) return;
    try {
      const blob = await (await fetch(audio.url)).blob();
      const result = await transcription.run(blob, f.languages[0] ?? "it");
      if (!result) {
        toast(st(lang, "imp.transcribeCancelled"));
        return;
      }
      f.set({ lyrics: result.lyrics, open: { ...f.open, lyrics: true } });
      toast.success(st(lang, "aud.transcribed"));
    } catch {
      toast.error(st(lang, "imp.transcribeFailed"));
    }
  };
  const unsupported = audio && !modes.includes(audio.mode);
  const tooLong =
    engine === "kie" &&
    audio?.duration &&
    audio.duration > KIE_SOURCE_MAX_SECONDS;
  return (
    <PanelCard
      id="audio"
      title={st(lang, "aud.title")}
      open={f.open.audio}
      onToggle={() => f.toggleCard("audio")}
    >
      <section
        aria-label={st(lang, "aud.drop")}
        onDragOver={(event) => {
          if (
            event.dataTransfer.types.includes(SONG_DRAG_TYPE) ||
            event.dataTransfer.types.includes("Files")
          ) {
            event.preventDefault();
            setOver(true);
          }
        }}
        onDragLeave={() => setOver(false)}
        onDrop={(event) => {
          event.preventDefault();
          setOver(false);
          const id = event.dataTransfer.getData(SONG_DRAG_TYPE);
          const clip = id ? useKnownClips.getState().known[id] : null;
          if (clip) pickClip(clip);
          else if (event.dataTransfer.files[0])
            void upload(event.dataTransfer.files[0]);
        }}
        className={cn(
          "space-y-3 rounded-xl transition-colors",
          over &&
            "bg-[color-mix(in_oklab,var(--brand),transparent_88%)] ring-2 ring-[var(--brand)]",
        )}
      >
        <Segmented<SourceMode>
          label={st(lang, "aud.title")}
          size="sm"
          value={mode}
          onChange={(next) => {
            if (!next) return;
            f.set(
              audio ? { audio: { ...audio, mode: next } } : { audioMode: next },
            );
          }}
          options={(["reference", "cover", "extend"] as const).map((value) => ({
            value,
            label: st(lang, MODE_LABEL[value]),
          }))}
        />
        <p className="text-[12.5px] text-[var(--fg-muted)]">
          {st(lang, MODE_HINT[mode])}
        </p>
        {audio ? (
          <div className="space-y-2 rounded-xl bg-[var(--surface-2)] p-2">
            <div className="flex items-center gap-2">
              <button
                type="button"
                aria-label={st(lang, playing ? "aud.pause" : "aud.play")}
                onClick={toggle}
                className="inline-flex size-9 shrink-0 items-center justify-center rounded-full bg-[var(--fg)] text-[var(--bg)] outline-none focus-visible:ring-2 focus-visible:ring-[var(--brand)]"
              >
                {playing ? (
                  <Pause className="size-4 fill-current" />
                ) : (
                  <Play className="size-4 translate-x-px fill-current" />
                )}
              </button>
              <div className="min-w-0 flex-1">
                <p className="truncate text-[13.5px] font-medium">
                  {audio.title}
                </p>
                <p className="text-[12px] text-[var(--fg-muted)]">
                  {audio.takeId
                    ? st(lang, "aud.libraryTag")
                    : st(lang, "aud.upload")}
                  {audio.duration ? ` · ${formatClock(audio.duration)}` : ""}
                </p>
              </div>
              <button
                type="button"
                aria-label={st(lang, "aud.remove")}
                onClick={() => setAudio(null)}
                className="inline-flex size-8 shrink-0 items-center justify-center rounded-full text-[var(--fg-muted)] outline-none hover:text-[var(--danger)] focus-visible:ring-2 focus-visible:ring-[var(--brand)]"
              >
                <X className="size-4" />
              </button>
            </div>
            {audio.mode === "extend" ? (
              <div className="flex items-end gap-2">
                <div className="w-32">
                  <ClockField
                    label={st(lang, "aud.continueAt")}
                    value={audio.continueAt ?? audio.duration ?? 0}
                    onCommit={(seconds) =>
                      setAudio({
                        ...audio,
                        continueAt: Math.max(
                          0,
                          Math.min(seconds, audio.duration ?? seconds),
                        ),
                      })
                    }
                  />
                </div>
                {audio.continueAt === undefined ? (
                  <span className="pb-2.5 text-[12px] text-[var(--fg-muted)]">
                    {st(lang, "aud.atEnd")}
                  </span>
                ) : null}
              </div>
            ) : null}
            <button
              type="button"
              onClick={() =>
                transcription.busy ? transcription.cancel() : void transcribe()
              }
              className={PILL}
            >
              {transcription.busy ? (
                <>
                  <Loader2 className="size-3.5 animate-spin" />
                  {st(lang, "aud.transcribing")} · {st(lang, "imp.cancel")}
                </>
              ) : (
                <>
                  <Mic className="size-3.5" />
                  {st(lang, "aud.transcribe")}
                </>
              )}
            </button>
          </div>
        ) : (
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => setPicking(true)}
              className={PILL}
            >
              <Library className="size-3.5" />
              {st(lang, "aud.fromLibrary")}
            </button>
            <button
              type="button"
              disabled={uploading}
              onClick={() => picker.current?.click()}
              className={PILL}
            >
              {uploading ? (
                <Loader2 className="size-3.5 animate-spin" />
              ) : (
                <Upload className="size-3.5" />
              )}
              {st(lang, uploading ? "aud.uploading" : "aud.upload")}
            </button>
            <p className="flex basis-full items-center gap-1.5 text-[12px] text-[var(--fg-subtle)]">
              <Music2 className="size-3.5" />
              {st(lang, over ? "aud.dropHere" : "aud.drop")}
            </p>
          </div>
        )}
        {unsupported ? (
          <p role="alert" className="text-[12.5px] text-[var(--danger)]">
            {stf(lang, "aud.notForEngine", { engine: engineName(engine) })}
          </p>
        ) : tooLong ? (
          <p role="alert" className="text-[12.5px] text-[var(--danger)]">
            {st(lang, "aud.tooLongKie")}
          </p>
        ) : null}
        <input
          ref={picker}
          type="file"
          accept={AUDIO_ACCEPT}
          className="sr-only"
          tabIndex={-1}
          aria-hidden
          onChange={(event) => {
            const file = event.target.files?.[0];
            if (file) void upload(file);
            event.target.value = "";
          }}
        />
      </section>
      <LibraryPicker
        open={picking}
        onOpenChange={setPicking}
        onPick={pickClip}
      />
    </PanelCard>
  );
}
