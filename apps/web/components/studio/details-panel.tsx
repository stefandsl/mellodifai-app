"use client";

import { Dialog as DialogPrimitive } from "@base-ui/react/dialog";
import { cn } from "cn";
import {
  Check,
  Copy,
  ExternalLink,
  ListMusic,
  Pause,
  Play,
  Share2,
  X,
} from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";

import { useLocale } from "@/components/locale-provider";
import { type Clip, isGenerating, needsAction } from "@/lib/studio/clips";
import { st, stf } from "@/lib/studio/i18n";
import { stylePhrases } from "@/lib/studio/now-playing";
import { songToolsFor } from "@/lib/studio/song-tools";
import { useReaction } from "@/lib/studio/use-reaction";
import { useMediaQuery } from "@/lib/use-media-query";
import { useDetails, useKnownClips } from "@/store/details";
import { usePlayer } from "@/store/player";
import { CoverFace } from "./cover-face";
import {
  MoreMenu,
  QueueBadge,
  StageLine,
  StatusBadge,
  trackFor,
} from "./feed/clip-card";
import { clipBadge } from "./feed/clip-detail";
import { hasNextStep, NextStep } from "./feed/next-step";
import { TitleEditor } from "./feed/title-editor";
import { takeTrack } from "./now-playing";
import { DownloadButton } from "./player-controls";
import { AddToPlaylistDialog } from "./playlist-dialog";
import { ReactionButtons } from "./reaction-buttons";
import { ShareDialog } from "./share-dialog";
import { StemsBadge } from "./stems/stems-badge";
import { IconButton } from "./ui";

const SECTION = "rounded-2xl bg-[var(--surface-1)] p-4";
const PILL =
  "inline-flex h-7 items-center gap-1 rounded-full bg-[var(--surface-2)] px-2.5 text-[12px] font-medium text-[var(--fg-muted)] outline-none hover:text-[var(--fg)] focus-visible:ring-2 focus-visible:ring-[var(--brand)]";
// Screen widths from which the panel docks beside the page instead of opening as a sheet.
const DOCK_PAGE = 1280;
const DOCK_CREATE = 1600;
// Style phrases shown before "+ altri".
const TAGS_SHOWN = 6;

function dateText(lang: "it" | "en", iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  return new Intl.DateTimeFormat(lang === "it" ? "it-IT" : "en-GB", {
    dateStyle: "long",
  }).format(date);
}

// "Copia" turns into "Copiato" for two seconds; a refused clipboard says so.
function CopyButton({ text, label }: { text: string; label: string }) {
  const lang = useLocale();
  const [done, setDone] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => () => clearTimeout(timer.current), []);
  return (
    <button
      type="button"
      aria-label={label}
      disabled={!text}
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(text);
          setDone(true);
          clearTimeout(timer.current);
          timer.current = setTimeout(() => setDone(false), 2000);
        } catch {
          toast.error(st(lang, "det.copyFailed"));
        }
      }}
      className={cn(PILL, "disabled:opacity-40")}
    >
      {done ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}
      {st(lang, done ? "det.copied" : "det.copy")}
    </button>
  );
}

function Tags({ style }: { style: string }) {
  const lang = useLocale();
  const [all, setAll] = useState(false);
  const phrases = stylePhrases(style, 60);
  const shown = all ? phrases : phrases.slice(0, TAGS_SHOWN);
  return (
    <section aria-label={st(lang, "det.tags")} className={SECTION}>
      <div className="mb-3 flex items-center justify-between gap-2">
        <h3 className="text-[14px] font-medium">{st(lang, "det.tags")}</h3>
        <CopyButton text={style} label={st(lang, "det.copyTags")} />
      </div>
      {phrases.length === 0 ? (
        <p className="text-[13px] text-[var(--fg-muted)]">
          {st(lang, "det.noStyle")}
        </p>
      ) : (
        <ul className="flex flex-wrap gap-1.5">
          {shown.map((phrase, i) => (
            <li
              // biome-ignore lint/suspicious/noArrayIndexKey: a phrase can repeat.
              key={`${phrase}-${i}`}
              className="rounded-full bg-[var(--surface-2)] px-2.5 py-1 text-[12px] text-[var(--fg-muted)]"
            >
              {phrase}
            </li>
          ))}
          {phrases.length > TAGS_SHOWN ? (
            <li>
              <button
                type="button"
                aria-expanded={all}
                onClick={() => setAll(!all)}
                className="rounded-full px-2.5 py-1 text-[12px] font-medium text-[var(--brand)] outline-none hover:underline focus-visible:ring-2 focus-visible:ring-[var(--brand)]"
              >
                {all
                  ? st(lang, "det.less")
                  : stf(lang, "det.more", {
                      n: String(phrases.length - TAGS_SHOWN),
                    })}
              </button>
            </li>
          ) : null}
        </ul>
      )}
    </section>
  );
}

const TAG_LINE = /^\s*\[[^\]\n]*\]\s*$/u;

function Lyrics({ text }: { text: string }) {
  const lang = useLocale();
  return (
    <section aria-label={st(lang, "det.lyrics")} className={SECTION}>
      <div className="mb-3 flex items-center justify-between gap-2">
        <h3 className="text-[14px] font-medium">{st(lang, "det.lyrics")}</h3>
        <CopyButton text={text} label={st(lang, "det.copyLyrics")} />
      </div>
      {text.trim() ? (
        <div className="max-h-80 overflow-y-auto font-mono text-[13px] leading-6 whitespace-pre-wrap scrollbar-thin">
          {text.split("\n").map((line, i) => (
            <div
              // biome-ignore lint/suspicious/noArrayIndexKey: lines are positional.
              key={i}
              className={cn(
                TAG_LINE.test(line) && "mt-2 text-[var(--fg-subtle)]",
              )}
            >
              {line || " "}
            </div>
          ))}
        </div>
      ) : (
        <p className="text-[13px] text-[var(--fg-muted)]">
          {st(lang, "now.noLyrics")}
        </p>
      )}
    </section>
  );
}

function Cover({ clip }: { clip: Clip }) {
  const lang = useLocale();
  const current = usePlayer((s) => s.queue[s.index]?.id === clip.id);
  const playing = usePlayer((s) => s.playing) && current;
  const play = usePlayer((s) => s.play);
  const toggle = usePlayer((s) => s.toggle);
  const track = trackFor(clip);
  const generating = isGenerating(clip.status);
  return (
    <div
      role="img"
      aria-label={stf(lang, "det.cover", { title: clip.title })}
      className={cn(
        "group/art relative aspect-square w-full overflow-hidden rounded-2xl ring-1 ring-[var(--hairline)]",
        generating && "shimmer",
      )}
      style={generating ? undefined : { background: clip.art }}
    >
      <CoverFace clip={clip} size="panel" />
      {track ? (
        <button
          type="button"
          aria-label={`${st(lang, playing ? "clip.pause" : "clip.play")}: ${clip.title}`}
          onClick={() => (current ? toggle() : play(track))}
          className={cn(
            "absolute inset-0 flex items-center justify-center bg-black/30 text-white outline-none transition-opacity focus-visible:opacity-100",
            current ? "opacity-100" : "opacity-0 group-hover/art:opacity-100",
            "[@media(pointer:coarse)]:opacity-100",
          )}
        >
          <span className="flex size-14 items-center justify-center rounded-full bg-black/45 backdrop-blur-sm">
            {playing ? (
              <Pause className="size-7 fill-current" />
            ) : (
              <Play className="size-7 translate-x-0.5 fill-current" />
            )}
          </span>
        </button>
      ) : null}
      {generating ? null : (
        <span className="pointer-events-none absolute bottom-2 left-2 inline-flex items-center gap-1 rounded-full bg-black/55 px-2.5 py-1 text-[12px] font-medium text-white backdrop-blur-sm">
          <Play className="size-3 fill-current" />
          {clip.playCount === 1
            ? st(lang, "clip.playsOne")
            : stf(lang, "clip.playsMany", { n: String(clip.playCount) })}
        </span>
      )}
    </div>
  );
}

// The versions of the song as chips: a chip plays that take as its own preview.
function Takes({ clip }: { clip: Clip }) {
  const lang = useLocale();
  const playingId = usePlayer((s) => s.queue[s.index]?.id);
  const p = usePlayer();
  const own = trackFor(clip);
  const detail = own?.detail;
  const takes = clip.takes.filter((take) => take.audioUrl);
  if (!own || !detail || takes.length < 2) return null;
  return (
    <fieldset className="m-0 flex min-w-0 flex-wrap items-center gap-1.5 border-0 p-0">
      <legend className="sr-only">{st(lang, "det.takes")}</legend>
      {takes.map((take) => {
        const next = takeTrack(own, detail, take.number);
        const pressed = next !== null && playingId === next.id;
        return (
          <button
            key={take.id}
            type="button"
            aria-pressed={pressed}
            disabled={!next}
            onClick={() => {
              if (!next) return;
              if (pressed) return p.toggle();
              p.play(next);
            }}
            className={cn(
              "h-8 rounded-full px-3.5 text-[13px] font-medium outline-none transition-colors focus-visible:ring-2 focus-visible:ring-[var(--brand)]",
              pressed
                ? "bg-[var(--fg)] text-[var(--bg)]"
                : "bg-[var(--surface-2)] text-[var(--fg-muted)] hover:text-[var(--fg)]",
            )}
          >
            {stf(lang, "det.take", { n: String(take.number) })}
          </button>
        );
      })}
    </fieldset>
  );
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div className="flex-1 rounded-xl bg-[var(--surface-1)] px-3 py-2">
      <p className="text-[11px] text-[var(--fg-muted)]">{label}</p>
      <p className="text-[17px] font-medium tabular-nums">{value}</p>
    </div>
  );
}

export function DetailsBody({
  clip,
  onClose,
  heading,
}: {
  clip: Clip;
  onClose: () => void;
  heading?: React.ReactNode;
}) {
  const lang = useLocale();
  const router = useRouter();
  const [shareOpen, setShareOpen] = useState(false);
  const [listOpen, setListOpen] = useState(false);
  const { reaction } = useReaction(clip.id, clip.reaction);
  const track = trackFor(clip);
  const generating = isGenerating(clip.status);
  const title = clip.title || st(lang, "clip.untitled");
  const created = dateText(lang, clip.createdAt);
  const tools = generating ? [] : songToolsFor(clip);
  return (
    <>
      <div className="flex shrink-0 items-center justify-between gap-3 px-4 pt-4 pb-2">
        {heading ?? (
          <h2 className="text-[15px] font-medium">{st(lang, "det.title")}</h2>
        )}
        <button
          type="button"
          aria-label={st(lang, "det.close")}
          onClick={onClose}
          className="inline-flex size-8 items-center justify-center rounded-full bg-[var(--surface-2)] outline-none hover:bg-[color-mix(in_oklab,var(--surface-2),var(--fg)_10%)] focus-visible:ring-2 focus-visible:ring-[var(--brand)]"
        >
          <X className="size-4" />
        </button>
      </div>

      <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-4 pb-6 scrollbar-thin">
        <Cover clip={clip} />

        <div className="min-w-0">
          <div className="group/card flex items-center gap-1.5 text-[18px] font-medium">
            <TitleEditor clip={clip} title={title} />
            <span className="ml-auto shrink-0">
              <MoreMenu clip={clip} onMoved={() => onClose()} />
            </span>
          </div>
          <div className="mt-2 flex flex-wrap items-center gap-1.5">
            <span className="rounded-full bg-[color-mix(in_oklab,var(--brand),transparent_85%)] px-2 py-0.5 text-[11px] font-semibold text-[var(--brand)]">
              {clipBadge(clip)}
            </span>
            <span className="rounded-full bg-[var(--surface-2)] px-2 py-0.5 font-mono text-[11px] font-semibold text-[var(--fg-muted)]">
              {clip.lang.toUpperCase()}
            </span>
            <StatusBadge clip={clip} />
            <QueueBadge clip={clip} />
            <StemsBadge clip={clip} done />
          </div>
          {created ? (
            <p className="mt-2 text-[13px] text-[var(--fg-muted)]">
              {stf(lang, "det.created", { date: created })}
            </p>
          ) : null}
        </div>

        {generating ? (
          <div className={SECTION}>
            <p className="text-[12px] text-[var(--fg-muted)]">
              {st(lang, "det.generating")}
            </p>
            <StageLine clip={clip} />
          </div>
        ) : needsAction(clip.status) && hasNextStep(clip) ? (
          <div className={cn(SECTION, "flex flex-wrap items-center gap-2")}>
            <NextStep clip={clip} />
          </div>
        ) : null}

        <div className="flex gap-2">
          <Stat label={st(lang, "det.plays")} value={clip.playCount} />
          <Stat
            label={st(lang, "clip.like")}
            value={reaction === "like" ? 1 : 0}
          />
        </div>

        <div className="flex flex-wrap items-center gap-1">
          <ReactionButtons
            key={clip.id}
            id={clip.id}
            initial={clip.reaction}
            className="-ml-1.5"
          />
          <IconButton
            label={st(lang, "clip.share")}
            onClick={() => setShareOpen(true)}
            className="bg-transparent"
          >
            <Share2 />
          </IconButton>
          <IconButton
            label={st(lang, "pl.add")}
            onClick={() => setListOpen(true)}
            className="bg-transparent"
          >
            <ListMusic />
          </IconButton>
          {track ? <DownloadButton track={track} /> : null}
        </div>

        {tools.length > 0 ? (
          <section
            aria-label={st(lang, "det.tools")}
            className="flex flex-wrap gap-1.5 rounded-2xl bg-[var(--surface-1)] p-2"
          >
            {tools.map((tool) => {
              const Icon = tool.icon;
              return (
                <button
                  key={tool.id}
                  type="button"
                  onClick={() =>
                    tool.run({
                      clip,
                      lang,
                      navigate: (href) => router.push(href),
                    })
                  }
                  className="inline-flex h-9 items-center gap-2 rounded-xl px-3 text-[13px] font-medium outline-none hover:bg-[var(--surface-glass-hover)] focus-visible:ring-2 focus-visible:ring-[var(--brand)]"
                >
                  <Icon className="size-4" />
                  {st(lang, tool.label)}
                </button>
              );
            })}
          </section>
        ) : null}

        {track ? null : generating ? null : (
          <p className="text-[13px] text-[var(--fg-muted)]">
            {st(lang, "det.noAudio")}
          </p>
        )}

        <Takes clip={clip} />
        <Tags style={clip.style} />
        <Lyrics text={clip.lyrics} />

        <Link
          href={clip.href}
          className="inline-flex h-9 items-center gap-1.5 rounded-full px-3 text-[13px] text-[var(--fg-muted)] outline-none hover:bg-[var(--surface-glass-hover)] hover:text-[var(--fg)] focus-visible:ring-2 focus-visible:ring-[var(--brand)]"
        >
          <ExternalLink className="size-3.5" />
          {st(lang, "det.openFull")}
        </Link>
      </div>

      <ShareDialog
        open={shareOpen}
        onOpenChange={setShareOpen}
        title={title}
        href={clip.href}
      />
      <AddToPlaylistDialog
        open={listOpen}
        onOpenChange={setListOpen}
        versionIds={[clip.id]}
      />
    </>
  );
}

// The panel for the song picked in the feed: docked to the right of the page from 1280 px,
// a sheet over the page below that. Esc or the X closes it; its open state is remembered.
export function DetailsPanel() {
  const lang = useLocale();
  const open = useDetails((s) => s.open);
  const picked = useDetails((s) => s.picked);
  const selectedId = useDetails((s) => s.selectedId);
  const clip = useKnownClips((s) => (selectedId ? s.known[selectedId] : null));
  const close = useDetails((s) => s.close);
  // The Create page already holds the form beside the feed, so the panel needs a wider
  // screen there to leave the feed room; elsewhere it docks from 1280 px.
  const onCreate = usePathname() === "/create";
  const docked = useMediaQuery(
    onCreate ? `(min-width: ${DOCK_CREATE}px)` : `(min-width: ${DOCK_PAGE}px)`,
  );
  const aside = useRef<HTMLElement>(null);
  const sheet = useRef<HTMLDivElement>(null);

  // Loaded after hydration, so the first client render matches the server's.
  useEffect(() => {
    void useDetails.persist.rehydrate();
  }, []);

  // Docked, the panel comes back as it was left; as a sheet over the page it opens only for a
  // song picked in this visit.
  const visible = open && Boolean(clip) && (docked || picked);
  useEffect(() => {
    if (!visible || !docked) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || event.defaultPrevented) return;
      const active = document.activeElement;
      // Esc belongs to whatever is open or being edited; the panel answers only when the
      // focus is inside it or on the page itself.
      if (
        active &&
        active !== document.body &&
        !aside.current?.contains(active)
      )
        return;
      close();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [visible, docked, close]);

  if (!visible || !clip) return null;
  if (docked)
    return (
      <aside
        ref={aside}
        aria-label={st(lang, "det.title")}
        className="flex h-full w-[340px] shrink-0 flex-col border-l border-[var(--hairline)] bg-[var(--bg)] 2xl:w-[380px]"
      >
        <DetailsBody clip={clip} onClose={close} />
      </aside>
    );
  return (
    <DialogPrimitive.Root
      open
      onOpenChange={(next) => {
        if (!next) close();
      }}
    >
      <DialogPrimitive.Portal>
        <DialogPrimitive.Backdrop className="fixed inset-0 z-40 bg-black/50" />
        <DialogPrimitive.Popup
          ref={sheet}
          initialFocus={sheet}
          aria-label={st(lang, "det.title")}
          className="fixed inset-x-0 bottom-0 z-50 flex max-h-[92dvh] min-h-[60dvh] flex-col rounded-t-3xl border-t border-[var(--hairline)] bg-[var(--bg)] text-[var(--fg)] shadow-2xl outline-none sm:inset-y-0 sm:right-0 sm:left-auto sm:max-h-none sm:w-[400px] sm:rounded-none sm:rounded-l-3xl sm:border-t-0 sm:border-l"
        >
          <span
            aria-hidden
            className="mx-auto mt-2 h-1 w-10 shrink-0 rounded-full bg-[var(--surface-2)] sm:hidden"
          />
          <DetailsBody
            clip={clip}
            onClose={close}
            heading={
              <DialogPrimitive.Title className="text-[15px] font-medium">
                {st(lang, "det.title")}
              </DialogPrimitive.Title>
            }
          />
        </DialogPrimitive.Popup>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}
