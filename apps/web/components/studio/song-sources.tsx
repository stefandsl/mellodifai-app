"use client";

import {
  SOURCE_LICENCES,
  type SongSource,
  type SourceLicence,
} from "@mellodifai/shared";
import { cn } from "cn";
import { Pause, Pencil, Play } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";

import { setSongSource } from "@/app/actions/songs-from-songs";
import { useLocale } from "@/components/locale-provider";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/components/ui/dialog";
import type { Clip } from "@/lib/studio/clips";
import { st } from "@/lib/studio/i18n";
import {
  creditLine,
  LICENCE_LABEL,
  licenceWarning,
  sourceKindLabel,
} from "@/lib/studio/song-source";
import { useKnownClips } from "@/store/details";
import { usePlayer } from "@/store/player";
import { trackFor } from "./feed/clip-card";

const PILL =
  "inline-flex h-7 items-center gap-1 rounded-full bg-[var(--surface-2)] px-2.5 text-[12px] font-medium text-[var(--fg-muted)] outline-none hover:text-[var(--fg)] focus-visible:ring-2 focus-visible:ring-[var(--brand)]";
const FIELD =
  "h-9 w-full rounded-xl bg-[var(--surface-2)] px-3 text-[14px] text-[var(--fg)] outline-none focus-visible:ring-2 focus-visible:ring-[var(--brand)]";

function SourceDialog({
  clip,
  source,
  open,
  onOpenChange,
}: {
  clip: Clip;
  source: SongSource;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const lang = useLocale();
  const router = useRouter();
  const [title, setTitle] = useState(source.title ?? "");
  const [author, setAuthor] = useState(source.author ?? "");
  const [url, setUrl] = useState(source.url ?? "");
  const [licence, setLicence] = useState<SourceLicence>(source.licence);
  const [busy, setBusy] = useState(false);
  const save = async () => {
    setBusy(true);
    const result = await setSongSource({
      versionId: clip.id,
      source: { title, author, url, licence },
    });
    setBusy(false);
    if (!result.ok) {
      toast.error(st(lang, "src.saveFailed"));
      return;
    }
    toast.success(st(lang, "src.saved"));
    onOpenChange(false);
    router.refresh();
  };
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="gap-4 sm:max-w-md">
        <div>
          <DialogTitle className="text-lg">
            {st(lang, "src.editTitle")}
          </DialogTitle>
          <DialogDescription className="mt-1">
            {st(lang, "src.editHint")}
          </DialogDescription>
        </div>
        <label className="flex flex-col gap-1 text-[12px] text-[var(--fg-muted)]">
          {st(lang, "src.title")}
          <input
            value={title}
            maxLength={200}
            onChange={(event) => setTitle(event.target.value)}
            className={FIELD}
          />
        </label>
        <label className="flex flex-col gap-1 text-[12px] text-[var(--fg-muted)]">
          {st(lang, "src.author")}
          <input
            value={author}
            maxLength={200}
            onChange={(event) => setAuthor(event.target.value)}
            className={FIELD}
          />
        </label>
        <label className="flex flex-col gap-1 text-[12px] text-[var(--fg-muted)]">
          {st(lang, "src.url")}
          <input
            value={url}
            inputMode="url"
            maxLength={500}
            placeholder="https://"
            onChange={(event) => setUrl(event.target.value)}
            className={FIELD}
          />
        </label>
        <label className="flex flex-col gap-1 text-[12px] text-[var(--fg-muted)]">
          {st(lang, "src.licence")}
          <select
            value={licence}
            onChange={(event) =>
              setLicence(event.target.value as SourceLicence)
            }
            className={FIELD}
          >
            {SOURCE_LICENCES.map((value) => (
              <option key={value} value={value}>
                {st(lang, LICENCE_LABEL[value])}
              </option>
            ))}
          </select>
        </label>
        <div className="flex justify-end gap-2">
          <DialogClose className="inline-flex h-9 items-center rounded-full bg-[var(--surface-2)] px-4 text-[13px] font-medium outline-none focus-visible:ring-2 focus-visible:ring-[var(--brand)]">
            {st(lang, "rw.cancel")}
          </DialogClose>
          <button
            type="button"
            disabled={busy || (url !== "" && !/^https?:\/\/\S+$/u.test(url))}
            onClick={() => void save()}
            className="inline-flex h-9 items-center rounded-full bg-cta px-4 text-[13px] font-medium text-white outline-none focus-visible:ring-2 focus-visible:ring-[var(--brand)] disabled:opacity-55"
          >
            {st(lang, "src.save")}
          </button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// "Fonti": where the song's audio came from, with "Ascolta" for the source, its licence, the
// remix credits to copy and a warning the licence needs (T12, feeds T17).
export function SongSources({ clip }: { clip: Clip }) {
  const lang = useLocale();
  const source = clip.source ?? null;
  const [editing, setEditing] = useState(false);
  const [playing, setPlaying] = useState(false);
  const audio = useRef<HTMLAudioElement | null>(null);
  const library = useKnownClips((s) =>
    source?.versionId ? (s.known[source.versionId] ?? null) : null,
  );
  const player = usePlayer();
  useEffect(() => () => audio.current?.pause(), []);
  if (!source) return null;
  const credits = creditLine(source, lang);
  const warning = licenceWarning(lang, source);
  const libraryTrack = library ? trackFor(library) : null;
  const listen = () => {
    if (libraryTrack) {
      player.play(libraryTrack);
      return;
    }
    if (!clip.sourceAudioUrl) return;
    if (playing) {
      audio.current?.pause();
      setPlaying(false);
      return;
    }
    player.set({ playing: false });
    audio.current ??= new Audio(clip.sourceAudioUrl);
    audio.current.onended = () => setPlaying(false);
    void audio.current.play().then(
      () => setPlaying(true),
      () => setPlaying(false),
    );
  };
  const name = source.title ?? library?.title ?? st(lang, "src.fromLibrary");
  return (
    <section
      aria-label={st(lang, "det.sources")}
      className="rounded-2xl bg-[var(--surface-1)] p-4"
    >
      <div className="mb-3 flex items-center justify-between gap-2">
        <h3 className="text-[14px] font-medium">{st(lang, "det.sources")}</h3>
        <button type="button" onClick={() => setEditing(true)} className={PILL}>
          <Pencil className="size-3.5" />
          {st(lang, "src.edit")}
        </button>
      </div>
      <div className="flex items-center gap-2">
        <div className="min-w-0 flex-1">
          <p className="text-[12px] text-[var(--fg-muted)]">
            {sourceKindLabel(lang, source.kind)}
          </p>
          <p className="truncate text-[14px]">
            {name}
            {source.author ? (
              <span className="text-[var(--fg-muted)]"> · {source.author}</span>
            ) : null}
          </p>
        </div>
        {libraryTrack || clip.sourceAudioUrl ? (
          <button type="button" onClick={listen} className={PILL}>
            {playing ? (
              <Pause className="size-3.5 fill-current" />
            ) : (
              <Play className="size-3.5 fill-current" />
            )}
            {st(lang, "src.listen")}
          </button>
        ) : null}
      </div>
      <p className="mt-2 flex flex-wrap items-center gap-1.5">
        <span className="rounded-full bg-[var(--surface-2)] px-2 py-0.5 text-[11px] font-semibold text-[var(--fg-muted)]">
          {st(lang, LICENCE_LABEL[source.licence])}
        </span>
      </p>
      {warning ? (
        <p className="mt-2 text-[12.5px] text-[var(--warning)]">{warning}</p>
      ) : null}
      {credits ? (
        <div className="mt-3">
          <div className="flex items-center justify-between gap-2">
            <p className="text-[12px] text-[var(--fg-muted)]">
              {st(lang, "src.credits")}
            </p>
            <button
              type="button"
              onClick={() =>
                void navigator.clipboard.writeText(credits).then(
                  () => toast.success(st(lang, "det.copied")),
                  () => toast.error(st(lang, "det.copyFailed")),
                )
              }
              className={cn(PILL, "h-6")}
            >
              {st(lang, "src.copyCredits")}
            </button>
          </div>
          <p className="mt-1 text-[13px] text-pretty">{credits}</p>
        </div>
      ) : null}
      {editing ? (
        <SourceDialog
          clip={clip}
          source={source}
          open={editing}
          onOpenChange={setEditing}
        />
      ) : null}
    </section>
  );
}
