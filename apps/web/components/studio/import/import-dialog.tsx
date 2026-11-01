"use client";

import {
  LANGS,
  type Lang,
  SOURCE_LICENCES,
  type SourceLicence,
} from "@mellodifai/shared";
import { cn } from "cn";
import { FileAudio, Link2, Loader2, Mic, Upload, X } from "lucide-react";
import { useRouter } from "next/navigation";
import { useId, useRef, useState } from "react";
import { toast } from "sonner";

import { importSong } from "@/app/actions/songs-from-songs";
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
import { st, stf } from "@/lib/studio/i18n";
import { LICENCE_LABEL } from "@/lib/studio/song-source";
import { sunoLink } from "@/lib/studio/suno-link";
import { useTranscription } from "@/lib/studio/use-transcription";
import { createClient } from "@/lib/supabase/browser";
import { useImportDialog } from "@/store/import-dialog";
import { languageName } from "../create/language-picker";

const FIELD =
  "w-full rounded-xl bg-[var(--surface-2)] px-3 text-[14px] outline-none placeholder:text-[var(--fg-subtle)] focus-visible:ring-2 focus-visible:ring-[var(--brand)]";
const PILL =
  "inline-flex h-9 items-center justify-center gap-2 rounded-full px-4 text-[13px] font-medium outline-none focus-visible:ring-2 focus-visible:ring-[var(--brand)] disabled:cursor-not-allowed disabled:opacity-55";

export type ImportItem = {
  key: string;
  name: string;
  // A dropped file, until it is uploaded; a fetched link is uploaded by the route already.
  file: File | null;
  path: string | null;
  url: string | null;
  seconds: number | null;
  title: string;
  style: string;
  lyrics: string;
  lang: Lang;
  licence: SourceLicence;
  author: string | null;
  // The share link the song came from, kept in its source record.
  link: string | null;
};

function ItemCard({
  item,
  onChange,
  onRemove,
  disabled,
}: {
  item: ImportItem;
  onChange: (patch: Partial<ImportItem>) => void;
  onRemove: () => void;
  disabled: boolean;
}) {
  const lang = useLocale();
  const id = useId();
  const transcription = useTranscription();
  const transcribe = async () => {
    try {
      const audio =
        item.file ??
        (item.path
          ? await (await fetch(uploadedAudioUrl(item.path))).blob()
          : null);
      if (!audio) return;
      const result = await transcription.run(audio, item.lang);
      if (!result) {
        toast(st(lang, "imp.transcribeCancelled"));
        return;
      }
      onChange({ lyrics: result.lyrics });
      toast.success(st(lang, "imp.transcribed"));
    } catch {
      toast.error(st(lang, "imp.transcribeFailed"));
    }
  };
  return (
    <li className="space-y-3 rounded-2xl bg-[var(--surface-1)] p-4 ring-1 ring-[var(--hairline)]">
      <div className="flex items-center gap-3">
        <FileAudio className="size-5 shrink-0 text-[var(--brand)]" />
        <div className="min-w-0 flex-1">
          <p className="truncate text-[14px] font-medium">{item.name}</p>
          {item.seconds ? (
            <p className="text-[12px] text-[var(--fg-muted)]">
              {stf(lang, "imp.duration", { d: formatClock(item.seconds) })}
            </p>
          ) : null}
        </div>
        <button
          type="button"
          aria-label={stf(lang, "imp.remove", { name: item.name })}
          disabled={disabled}
          onClick={onRemove}
          className="inline-flex size-8 shrink-0 items-center justify-center rounded-full bg-[var(--surface-2)] text-[var(--fg-muted)] outline-none hover:text-[var(--danger)] focus-visible:ring-2 focus-visible:ring-[var(--brand)]"
        >
          <X className="size-4" />
        </button>
      </div>
      {item.url ? (
        // biome-ignore lint/a11y/useMediaCaption: a song preview, its lyrics are in the box below.
        <audio controls preload="none" src={item.url} className="h-9 w-full" />
      ) : null}
      <div className="grid gap-3 sm:grid-cols-[1fr_auto_auto]">
        <label className="flex min-w-0 flex-col gap-1 text-[12px] text-[var(--fg-muted)]">
          {st(lang, "imp.songTitle")}
          <input
            value={item.title}
            maxLength={100}
            disabled={disabled}
            onChange={(event) => onChange({ title: event.target.value })}
            className={cn(FIELD, "h-9 text-[var(--fg)]")}
          />
        </label>
        <label className="flex flex-col gap-1 text-[12px] text-[var(--fg-muted)]">
          {st(lang, "imp.lang")}
          <select
            value={item.lang}
            disabled={disabled}
            onChange={(event) => onChange({ lang: event.target.value as Lang })}
            className={cn(FIELD, "h-9 text-[var(--fg)]")}
          >
            {LANGS.map((code) => (
              <option key={code} value={code}>
                {languageName(code, lang)}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-[12px] text-[var(--fg-muted)]">
          {st(lang, "imp.licence")}
          <select
            value={item.licence}
            disabled={disabled}
            onChange={(event) =>
              onChange({ licence: event.target.value as SourceLicence })
            }
            className={cn(FIELD, "h-9 text-[var(--fg)]")}
          >
            {SOURCE_LICENCES.map((value) => (
              <option key={value} value={value}>
                {st(lang, LICENCE_LABEL[value])}
              </option>
            ))}
          </select>
        </label>
      </div>
      <label className="flex flex-col gap-1 text-[12px] text-[var(--fg-muted)]">
        {st(lang, "imp.style")}
        <input
          value={item.style}
          maxLength={1000}
          disabled={disabled}
          placeholder={st(lang, "imp.stylePlaceholder")}
          onChange={(event) => onChange({ style: event.target.value })}
          className={cn(FIELD, "h-9 text-[var(--fg)]")}
        />
      </label>
      <div className="flex flex-col gap-1">
        <div className="flex items-center justify-between gap-2">
          <label
            htmlFor={`${id}-lyrics`}
            className="text-[12px] text-[var(--fg-muted)]"
          >
            {st(lang, "imp.lyrics")}
          </label>
          <button
            type="button"
            disabled={disabled}
            onClick={() =>
              transcription.busy ? transcription.cancel() : void transcribe()
            }
            className={cn(
              "inline-flex h-7 items-center gap-1.5 rounded-full bg-[var(--surface-2)] px-2.5 text-[12px] font-medium outline-none focus-visible:ring-2 focus-visible:ring-[var(--brand)] disabled:opacity-55",
              transcription.busy
                ? "text-[var(--fg)]"
                : "text-[var(--fg-muted)] hover:text-[var(--fg)]",
            )}
          >
            {transcription.busy ? (
              <>
                <Loader2 className="size-3.5 animate-spin" />
                {st(lang, "imp.transcribing")} · {st(lang, "imp.cancel")}
              </>
            ) : (
              <>
                <Mic className="size-3.5" />
                {st(lang, "imp.transcribe")}
              </>
            )}
          </button>
        </div>
        <textarea
          id={`${id}-lyrics`}
          value={item.lyrics}
          maxLength={5000}
          disabled={disabled || transcription.busy}
          placeholder={st(lang, "imp.lyricsPlaceholder")}
          onChange={(event) => onChange({ lyrics: event.target.value })}
          className={cn(
            FIELD,
            "min-h-28 resize-y py-2 font-mono text-[13px] leading-6 text-[var(--fg)]",
          )}
        />
      </div>
    </li>
  );
}

// "Importa da Suno": drop the MP3/WAV/FLAC files downloaded from suno.com (or paste a share link),
// check title, style, lyrics and licence, and each becomes a song of the library.
export function ImportDialog() {
  const lang = useLocale();
  const router = useRouter();
  const open = useImportDialog((s) => s.open);
  const hide = useImportDialog((s) => s.hide);
  const [items, setItems] = useState<ImportItem[]>([]);
  const [link, setLink] = useState("");
  const [fetching, setFetching] = useState(false);
  const [busy, setBusy] = useState(false);
  const [over, setOver] = useState(false);
  const picker = useRef<HTMLInputElement>(null);
  const linkId = useId();

  const add = async (files: FileList | File[]) => {
    for (const file of Array.from(files)) {
      const problem = audioProblem(file);
      if (problem) {
        toast.error(
          stf(lang, problem === "tooBig" ? "imp.tooBig" : "imp.wrongType", {
            name: file.name,
            mb: String(AUDIO_LIMIT_MB),
          }),
        );
        continue;
      }
      const key = crypto.randomUUID();
      setItems((old) => [
        ...old,
        {
          key,
          name: file.name,
          file,
          path: null,
          url: URL.createObjectURL(file),
          seconds: null,
          title: titleFromFile(file.name),
          style: "",
          lyrics: "",
          lang: lang === "en" ? "en" : "it",
          licence: "own",
          author: null,
          link: null,
        },
      ]);
      void audioSeconds(file).then((seconds) =>
        setItems((old) =>
          old.map((item) => (item.key === key ? { ...item, seconds } : item)),
        ),
      );
    }
  };

  const fetchLink = async () => {
    if (!sunoLink(link)) {
      toast.error(st(lang, "imp.linkInvalid"));
      return;
    }
    setFetching(true);
    try {
      const response = await fetch("/api/suno-link", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: link }),
      });
      if (!response.ok) throw new Error(String(response.status));
      const song = (await response.json()) as {
        path: string;
        title: string | null;
        author: string | null;
        style: string | null;
        lyrics: string | null;
        url: string;
      };
      setItems((old) => [
        ...old,
        {
          key: crypto.randomUUID(),
          name: song.title ?? song.url,
          file: null,
          path: song.path,
          url: uploadedAudioUrl(song.path),
          seconds: null,
          title: (song.title ?? "").slice(0, 100),
          style: (song.style ?? "").slice(0, 1000),
          lyrics: (song.lyrics ?? "").slice(0, 5000),
          lang: lang === "en" ? "en" : "it",
          licence: "own",
          author: song.author,
          link: song.url,
        },
      ]);
      setLink("");
    } catch {
      toast.error(st(lang, "imp.linkFailed"));
    } finally {
      setFetching(false);
    }
  };

  const close = () => {
    if (busy) return;
    for (const item of items)
      if (item.file && item.url) URL.revokeObjectURL(item.url);
    setItems([]);
    setLink("");
    hide();
  };

  const submit = async () => {
    if (items.some((item) => !item.title.trim())) {
      toast.error(st(lang, "imp.needTitle"));
      return;
    }
    setBusy(true);
    const supabase = createClient();
    let done = 0;
    const left: ImportItem[] = [];
    for (const item of items) {
      try {
        const path =
          item.path ??
          (item.file
            ? await uploadAudio(supabase, item.file, item.file.name)
            : null);
        if (!path) throw new Error("no file");
        const result = await importSong({
          title: item.title.trim(),
          style: item.style.trim(),
          lyrics: item.lyrics,
          lang: item.lang,
          upload: path,
          source: {
            kind: "suno",
            title: item.title.trim(),
            ...(item.author ? { author: item.author } : {}),
            ...(item.link ? { url: item.link } : {}),
            licence: item.licence,
          },
        });
        if (!result.ok) throw new Error(result.error);
        done += 1;
      } catch {
        toast.error(stf(lang, "imp.uploadFailed", { name: item.name }));
        left.push(item);
      }
    }
    setBusy(false);
    if (done > 0) {
      toast.success(
        done === 1
          ? st(lang, "imp.done")
          : stf(lang, "imp.doneMany", { n: String(done) }),
      );
      router.refresh();
    }
    if (left.length === 0) {
      setItems([]);
      hide();
    } else setItems(left);
  };

  return (
    <Dialog open={open} onOpenChange={(next) => (next ? undefined : close())}>
      <DialogContent className="flex max-h-[92dvh] flex-col gap-0 p-0 sm:max-w-2xl">
        <div className="shrink-0 px-5 pt-5 pb-3">
          <DialogTitle className="text-lg">{st(lang, "imp.title")}</DialogTitle>
          <DialogDescription className="mt-1">
            {st(lang, "imp.subtitle")}
          </DialogDescription>
        </div>
        <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-5 pb-4 scrollbar-thin">
          <button
            type="button"
            disabled={busy}
            onClick={() => picker.current?.click()}
            onDragOver={(event) => {
              event.preventDefault();
              setOver(true);
            }}
            onDragLeave={() => setOver(false)}
            onDrop={(event) => {
              event.preventDefault();
              setOver(false);
              if (event.dataTransfer.files.length)
                void add(event.dataTransfer.files);
            }}
            className={cn(
              "flex w-full flex-col items-center justify-center gap-2 rounded-2xl border-2 border-dashed px-4 py-8 text-center outline-none transition-colors focus-visible:ring-2 focus-visible:ring-[var(--brand)]",
              over
                ? "border-[var(--brand)] bg-[color-mix(in_oklab,var(--brand),transparent_90%)]"
                : "border-[var(--hairline)] hover:bg-[var(--surface-glass-hover)]",
            )}
          >
            <Upload className="size-6 text-[var(--brand)]" />
            <span className="text-[14px] font-medium">
              {stf(lang, "imp.drop", { mb: String(AUDIO_LIMIT_MB) })}
            </span>
            <span className="text-[13px] text-[var(--fg-muted)] underline underline-offset-2">
              {st(lang, "imp.pick")}
            </span>
          </button>
          <input
            ref={picker}
            type="file"
            multiple
            accept={AUDIO_ACCEPT}
            className="sr-only"
            tabIndex={-1}
            aria-hidden
            onChange={(event) => {
              if (event.target.files) void add(event.target.files);
              event.target.value = "";
            }}
          />
          <div className="space-y-1.5">
            <label
              htmlFor={linkId}
              className="text-[12px] text-[var(--fg-muted)]"
            >
              {st(lang, "imp.link")}
            </label>
            <div className="flex gap-2">
              <div className="relative min-w-0 flex-1">
                <Link2 className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-[var(--fg-subtle)]" />
                <input
                  id={linkId}
                  value={link}
                  inputMode="url"
                  disabled={busy || fetching}
                  placeholder={st(lang, "imp.linkPlaceholder")}
                  onChange={(event) => setLink(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") {
                      event.preventDefault();
                      void fetchLink();
                    }
                  }}
                  className={cn(FIELD, "h-9 pl-9 text-[var(--fg)]")}
                />
              </div>
              <button
                type="button"
                disabled={!link.trim() || busy || fetching}
                onClick={() => void fetchLink()}
                className={cn(
                  PILL,
                  "bg-[var(--surface-2)] hover:bg-[var(--surface-glass-hover)]",
                )}
              >
                {fetching ? <Loader2 className="size-4 animate-spin" /> : null}
                {st(lang, fetching ? "imp.fetching" : "imp.fetch")}
              </button>
            </div>
            <p className="text-[12px] text-[var(--fg-subtle)]">
              {st(lang, "imp.linkHint")}
            </p>
          </div>
          {items.length > 0 ? (
            <ul className="space-y-3">
              {items.map((item) => (
                <ItemCard
                  key={item.key}
                  item={item}
                  disabled={busy}
                  onChange={(patch) =>
                    setItems((old) =>
                      old.map((other) =>
                        other.key === item.key ? { ...other, ...patch } : other,
                      ),
                    )
                  }
                  onRemove={() => {
                    if (item.file && item.url) URL.revokeObjectURL(item.url);
                    setItems((old) =>
                      old.filter((other) => other.key !== item.key),
                    );
                  }}
                />
              ))}
            </ul>
          ) : null}
        </div>
        <div className="flex shrink-0 flex-wrap items-center justify-end gap-2 border-t border-[var(--hairline)] px-5 py-3">
          <button
            type="button"
            disabled={busy}
            onClick={close}
            className={cn(
              PILL,
              "bg-[var(--surface-2)] hover:bg-[var(--surface-glass-hover)]",
            )}
          >
            {st(lang, "imp.close")}
          </button>
          <button
            type="button"
            disabled={busy || items.length === 0}
            onClick={() => void submit()}
            className={cn(PILL, "bg-cta text-white hover:brightness-110")}
          >
            {busy ? (
              <Loader2 className="size-4 animate-spin" />
            ) : (
              <Upload className="size-4" />
            )}
            {busy
              ? st(lang, "imp.importing")
              : items.length > 1
                ? stf(lang, "imp.submit", { n: String(items.length) })
                : st(lang, "imp.submitOne")}
          </button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
