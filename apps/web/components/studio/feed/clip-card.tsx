"use client";

import { cn } from "cn";
import {
  Download,
  Film,
  Info,
  ListMusic,
  ListPlus,
  Loader2,
  MoreHorizontal,
  Music2,
  Pause,
  Play,
  RotateCcw,
  Share2,
  Trash2,
  Undo2,
} from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";

import { useLocale } from "@/components/locale-provider";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { type Clip, isGenerating, needsAction } from "@/lib/studio/clips";
import { st, stf } from "@/lib/studio/i18n";
import { reusePrompt } from "@/lib/studio/reuse-prompt";
import { restoreSongs, trashSongs } from "@/lib/studio/trash-actions";
import { useDetails } from "@/store/details";
import { type Track, usePlayer } from "@/store/player";
import { CoverFace } from "../cover-face";
import { AddToPlaylistDialog } from "../playlist-dialog";
import { ReactionButtons } from "../reaction-buttons";
import { ShareDialog } from "../share-dialog";
import { clipBadge, detailFor } from "./clip-detail";
import { hasNextStep, NextStep } from "./next-step";

export { clipBadge };

import { TitleEditor } from "./title-editor";

// Select mode: the checkbox state of one card, owned by the feed.
export type Selection = { selected: boolean; onToggle: () => void };

// Elements that keep their own click: a click on them is not a pick of the card.
const INTERACTIVE =
  "a,button,input,select,textarea,label,[role=menuitem],[role=checkbox],[role=radio]";

export function trackFor(clip: Clip): Track | null {
  if (!clip.audioUrl) return null;
  return {
    id: clip.id,
    title: clip.title,
    subtitle: `${clip.lang.toUpperCase()} · ${clipBadge(clip)}`,
    audioUrl: clip.audioUrl,
    videoUrl: clip.videoUrl,
    href: clip.href,
    art: clip.art,
    reaction: clip.reaction,
    detail: detailFor(clip),
  };
}

export function StatusBadge({ clip }: { clip: Clip }) {
  const lang = useLocale();
  const base =
    "inline-flex shrink-0 items-center gap-1 whitespace-nowrap rounded-full px-2 py-0.5 text-[10px] font-semibold tracking-wide";
  if (clip.status === "failed")
    return (
      <span
        className={cn(
          base,
          "bg-[color-mix(in_oklab,var(--danger),transparent_82%)] text-[var(--danger)]",
        )}
      >
        {st(lang, "badge.failed")}
      </span>
    );
  if (needsAction(clip.status))
    return (
      <span
        className={cn(
          base,
          "bg-[color-mix(in_oklab,var(--brand),transparent_80%)] text-[var(--brand)]",
        )}
      >
        {st(lang, "badge.action")}
      </span>
    );
  if (clip.status === "producing")
    return (
      <span
        className={cn(base, "bg-[var(--surface-2)] text-[var(--fg-muted)]")}
      >
        <Loader2 className="size-3 animate-spin" />
        {st(lang, "badge.rendering")}
      </span>
    );
  if (clip.status === "audio_ready")
    return (
      <span
        className={cn(base, "bg-[var(--surface-2)] text-[var(--fg-muted)]")}
      >
        <Music2 className="size-3" />
        {st(lang, "badge.audioOnly")}
      </span>
    );
  if (
    clip.videoUrl &&
    ["approved", "published", "publishing"].includes(clip.status)
  )
    return (
      <span
        className={cn(
          base,
          "bg-[color-mix(in_oklab,var(--success),transparent_82%)] text-[var(--success)]",
        )}
      >
        <Film className="size-3" />
        {st(lang, "badge.videoReady")}
      </span>
    );
  return null;
}

function Artwork({
  clip,
  list,
  size,
  playable,
}: {
  clip: Clip;
  list: Clip[];
  size: "list" | "grid";
  // False in select mode and in the trash: the artwork is only a picture then.
  playable: boolean;
}) {
  const lang = useLocale();
  const current = usePlayer((s) => s.queue[s.index]?.id === clip.id);
  const playing = usePlayer((s) => s.playing) && current;
  const play = usePlayer((s) => s.play);
  const toggle = usePlayer((s) => s.toggle);
  const generating = isGenerating(clip.status);
  const track = playable ? trackFor(clip) : null;
  return (
    <div
      className={cn(
        "group/art relative shrink-0 overflow-hidden rounded-lg",
        size === "list" ? "size-[84px]" : "aspect-square w-full",
        generating && "shimmer",
      )}
      style={generating ? undefined : { background: clip.art }}
    >
      <CoverFace clip={clip} size={size} />
      {track ? (
        <button
          type="button"
          aria-label={`${st(lang, playing ? "clip.pause" : "clip.play")}: ${clip.title}`}
          onClick={() =>
            current
              ? toggle()
              : play(
                  track,
                  list
                    .map(trackFor)
                    .filter((item): item is Track => item !== null),
                )
          }
          className={cn(
            "absolute inset-0 flex items-center justify-center bg-black/35 text-white outline-none transition-opacity focus-visible:opacity-100",
            current ? "opacity-100" : "opacity-0 group-hover/art:opacity-100",
          )}
        >
          <span className="flex size-10 items-center justify-center rounded-full bg-black/45 backdrop-blur-sm">
            {playing ? (
              <Pause className="size-5 fill-current" />
            ) : (
              <Play className="size-5 translate-x-px fill-current" />
            )}
          </span>
        </button>
      ) : null}
    </div>
  );
}

export function MoreMenu({
  clip,
  onMoved,
}: {
  clip: Clip;
  onMoved?: (ids: string[]) => void;
}) {
  const lang = useLocale();
  const router = useRouter();
  const enqueue = usePlayer((s) => s.enqueue);
  const showDetails = useDetails((s) => s.show);
  const track = trackFor(clip);
  const [shareOpen, setShareOpen] = useState(false);
  const [listOpen, setListOpen] = useState(false);
  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger
          aria-label={st(lang, "clip.more")}
          className="inline-flex size-8 items-center justify-center rounded-full bg-[var(--surface-2)] outline-none hover:bg-[color-mix(in_oklab,var(--surface-2),var(--fg)_10%)] focus-visible:ring-2 focus-visible:ring-[var(--brand)]"
        >
          <MoreHorizontal className="size-4" />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-56 rounded-2xl p-1.5">
          <DropdownMenuItem
            onClick={() => showDetails(clip.id)}
            className="rounded-lg"
          >
            <Info />
            {st(lang, "clip.details")}
          </DropdownMenuItem>
          <DropdownMenuItem
            disabled={!track}
            onClick={() => {
              if (!track) return;
              enqueue(track);
              toast.success(st(lang, "clip.added"));
            }}
            className="rounded-lg"
          >
            <ListPlus />
            {st(lang, "clip.addQueue")}
          </DropdownMenuItem>
          <DropdownMenuItem
            onClick={() => setListOpen(true)}
            className="rounded-lg"
          >
            <ListMusic />
            {st(lang, "pl.add")}
          </DropdownMenuItem>
          <DropdownMenuItem
            onClick={() => reusePrompt(clip, lang)}
            className="rounded-lg"
          >
            <RotateCcw />
            {st(lang, "clip.reuse")}
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem
            onClick={() => setShareOpen(true)}
            className="rounded-lg"
          >
            <Share2 />
            {st(lang, "clip.share")}
          </DropdownMenuItem>
          <DropdownMenuItem
            disabled={!clip.videoUrl}
            render={
              clip.videoUrl ? (
                // biome-ignore lint/a11y/useAnchorContent: the menu item renders its children here.
                <a href={clip.videoUrl} download />
              ) : undefined
            }
            className="rounded-lg"
          >
            <Download />
            {st(lang, "clip.downloadVideo")}
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem
            onClick={() =>
              void trashSongs([clip.id], lang, {
                refresh: router.refresh,
                onMoved,
              })
            }
            className="rounded-lg text-[var(--danger)]"
          >
            <Trash2 />
            {st(lang, "clip.trash")}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <ShareDialog
        open={shareOpen}
        onOpenChange={setShareOpen}
        title={clip.title || st(lang, "clip.untitled")}
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

function Actions({ clip }: { clip: Clip }) {
  const lang = useLocale();
  const [shareOpen, setShareOpen] = useState(false);
  const [listOpen, setListOpen] = useState(false);
  const button =
    "hidden h-8 items-center gap-1.5 rounded-full bg-[var(--surface-2)] text-[13px] outline-none hover:bg-[color-mix(in_oklab,var(--surface-2),var(--fg)_10%)] focus-visible:ring-2 focus-visible:ring-[var(--brand)] sm:inline-flex";
  return (
    <div className="flex items-center gap-1.5">
      <ReactionButtons
        id={clip.id}
        initial={clip.reaction}
        className="-ml-1.5"
        compact
      />
      <button
        type="button"
        aria-label={st(lang, "clip.share")}
        onClick={() => setShareOpen(true)}
        className={cn(button, "px-3")}
      >
        <Share2 className="size-3.5" />
        {lang === "it" ? "Condividi" : "Share"}
      </button>
      <button
        type="button"
        aria-label={st(lang, "pl.add")}
        title={st(lang, "pl.add")}
        onClick={() => setListOpen(true)}
        className={cn(button, "w-8 justify-center")}
      >
        <ListMusic className="size-3.5" />
      </button>
      <ShareDialog
        open={shareOpen}
        onOpenChange={setShareOpen}
        title={clip.title || st(lang, "clip.untitled")}
        href={clip.href}
      />
      <AddToPlaylistDialog
        open={listOpen}
        onOpenChange={setListOpen}
        versionIds={[clip.id]}
      />
    </div>
  );
}

// In the trash the only action is getting the song back.
function RestoreButton({
  clip,
  onMoved,
}: {
  clip: Clip;
  onMoved?: (ids: string[]) => void;
}) {
  const lang = useLocale();
  const router = useRouter();
  return (
    <button
      type="button"
      onClick={() =>
        void restoreSongs([clip.id], lang, { refresh: router.refresh, onMoved })
      }
      className="inline-flex h-8 items-center gap-1.5 rounded-full bg-[var(--surface-2)] px-3 text-[13px] outline-none hover:bg-[color-mix(in_oklab,var(--surface-2),var(--fg)_10%)] focus-visible:ring-2 focus-visible:ring-[var(--brand)]"
    >
      <Undo2 className="size-3.5" />
      {st(lang, "clip.restore")}
    </button>
  );
}

// Waiting behind other jobs on the render PC.
export function QueueBadge({ clip }: { clip: Clip }) {
  const lang = useLocale();
  if (!clip.queuePosition || clip.queuePosition < 2) return null;
  return (
    <span className="inline-flex shrink-0 items-center whitespace-nowrap rounded-full bg-[var(--surface-2)] px-2 py-0.5 text-[10px] font-semibold tracking-wide tabular-nums text-[var(--fg-muted)]">
      {stf(lang, "clip.queued", { n: String(clip.queuePosition) })}
    </span>
  );
}

export function StageLine({ clip }: { clip: Clip }) {
  const lang = useLocale();
  const label = st(lang, `stage.${clip.status}` as "stage.drafting");
  const action = needsAction(clip.status);
  // From sm up the status badge already says this; phones show only this line.
  const badged = ["producing", "approved", "published"].includes(clip.status);
  return action ? (
    <Link
      href={clip.href}
      className="text-xs font-medium text-[var(--brand)] underline-offset-4 hover:underline"
    >
      {label} →
    </Link>
  ) : (
    <span
      className={cn("text-xs text-[var(--fg-muted)]", badged && "sm:hidden")}
    >
      {label}
    </span>
  );
}

// The style line, with how often the song was played.
function Subtitle({ clip, className }: { clip: Clip; className?: string }) {
  const lang = useLocale();
  return (
    <p
      className={cn(
        "flex items-center gap-1.5 text-[13px] text-[var(--fg-muted)]",
        className,
      )}
    >
      <span className="truncate">{clip.style || clip.prompt}</span>
      {clip.playCount > 0 ? (
        <span className="shrink-0 tabular-nums">
          {"· "}
          {clip.playCount === 1
            ? st(lang, "clip.playsOne")
            : stf(lang, "clip.playsMany", { n: String(clip.playCount) })}
        </span>
      ) : null}
    </p>
  );
}

// A checkbox big enough to hit, shown on every card while the feed is in select mode.
function SelectBox({ clip, selection }: { clip: Clip; selection: Selection }) {
  const lang = useLocale();
  return (
    <label className="flex size-8 shrink-0 cursor-pointer items-center justify-center">
      <input
        type="checkbox"
        checked={selection.selected}
        onChange={selection.onToggle}
        aria-label={`${st(lang, "feed.select")}: ${clip.title || st(lang, "clip.untitled")}`}
        className="size-[18px] cursor-pointer accent-[var(--brand)]"
      />
    </label>
  );
}

export function ClipCard({
  clip,
  list,
  view,
  selection,
  trash = false,
  onMoved,
}: {
  clip: Clip;
  list: Clip[];
  view: "list" | "grid";
  // Present in select mode.
  selection?: Selection;
  // The Library trash: no playback or editing, only Restore.
  trash?: boolean;
  onMoved?: (ids: string[]) => void;
}) {
  const lang = useLocale();
  const current = usePlayer((s) => s.queue[s.index]?.id === clip.id);
  const detailed = useDetails((s) => s.open && s.selectedId === clip.id);
  const showDetails = useDetails((s) => s.show);
  const title = clip.title || st(lang, "clip.untitled");
  const playable = !selection && !trash;
  // A click on the card body (not on one of its buttons or links) picks the song: it opens
  // the details panel, or ticks the box in select mode.
  const onCardClick = (event: React.MouseEvent) => {
    if (trash || event.defaultPrevented) return;
    if ((event.target as HTMLElement).closest(INTERACTIVE)) return;
    if (selection) return selection.onToggle();
    showDetails(clip.id);
  };
  const card = cn(
    "group/card transition-colors hover-glass",
    !trash && "cursor-pointer",
    detailed && "bg-[var(--surface-glass)] ring-1 ring-[var(--hairline)]",
    // The playing song: brand tint, an accent edge and a brand title.
    current &&
      "bg-[color-mix(in_oklab,var(--brand),transparent_92%)] shadow-[inset_3px_0_0_var(--brand)]",
    selection?.selected &&
      "bg-[var(--surface-glass)] ring-1 ring-[var(--brand)]",
  );
  const heading = trash ? (
    <span className="truncate">{title}</span>
  ) : (
    <TitleEditor
      clip={clip}
      title={title}
      className={current ? "text-[var(--brand)]" : undefined}
    />
  );
  if (view === "grid")
    return (
      // biome-ignore lint/a11y/useKeyWithClickEvents: the card menu and buttons carry the keyboard path.
      <article
        aria-label={title}
        aria-current={current ? "true" : undefined}
        data-selected={detailed ? "true" : undefined}
        onClick={onCardClick}
        className={cn("flex flex-col gap-2 rounded-[20px] p-2.5", card)}
      >
        <div className="relative">
          <Artwork clip={clip} list={list} size="grid" playable={playable} />
          {selection ? (
            <div className="absolute right-1 bottom-1 rounded-full bg-black/45 backdrop-blur-sm">
              <SelectBox clip={clip} selection={selection} />
            </div>
          ) : null}
        </div>
        <div className="flex min-w-0 flex-1 flex-col px-0.5">
          <div className="flex items-center gap-1.5 font-medium">
            {heading}
            <span className="shrink-0 text-[11px] font-semibold text-[var(--brand)]">
              {clipBadge(clip)}
            </span>
          </div>
          <Subtitle clip={clip} />
          <div className="mt-1.5 flex min-h-5 flex-wrap items-center gap-1.5">
            {trash ? (
              <RestoreButton clip={clip} onMoved={onMoved} />
            ) : (
              <>
                <StatusBadge clip={clip} />
                <QueueBadge clip={clip} />
                {hasNextStep(clip) ? (
                  <NextStep clip={clip} />
                ) : (
                  <StageLine clip={clip} />
                )}
              </>
            )}
          </div>
          {trash ? null : (
            <div className="mt-auto flex items-center justify-between pt-1">
              <ReactionButtons
                id={clip.id}
                initial={clip.reaction}
                className="-ml-1.5"
              />
              <MoreMenu clip={clip} onMoved={onMoved} />
            </div>
          )}
        </div>
      </article>
    );
  return (
    // biome-ignore lint/a11y/useKeyWithClickEvents: the card menu and buttons carry the keyboard path.
    <article
      aria-label={title}
      aria-current={current ? "true" : undefined}
      data-selected={detailed ? "true" : undefined}
      onClick={onCardClick}
      className={cn(
        "flex h-[110px] items-center gap-3 rounded-[20px] p-3",
        card,
      )}
    >
      {selection ? <SelectBox clip={clip} selection={selection} /> : null}
      <Artwork clip={clip} list={list} size="list" playable={playable} />
      <div className="flex min-w-0 flex-1 flex-col justify-between self-stretch py-0.5">
        <div className="min-w-0">
          <div className="flex items-center gap-1.5 text-[15px] font-medium">
            {heading}
            <span className="shrink-0 rounded-full bg-[color-mix(in_oklab,var(--brand),transparent_85%)] px-1.5 text-[10px] leading-4 font-semibold text-[var(--brand)]">
              {clipBadge(clip)}
            </span>
            {trash ? null : (
              <span className="contents max-sm:hidden">
                <StatusBadge clip={clip} />
              </span>
            )}
          </div>
          <Subtitle clip={clip} className="mt-0.5" />
        </div>
        <div className="flex items-center justify-between gap-2">
          <div className="flex min-w-0 items-center gap-2 sm:gap-3">
            {trash ? (
              <RestoreButton clip={clip} onMoved={onMoved} />
            ) : (
              <>
                <Actions clip={clip} />
                <QueueBadge clip={clip} />
                {hasNextStep(clip) ? (
                  <NextStep clip={clip} />
                ) : (
                  <span className="truncate">
                    <StageLine clip={clip} />
                  </span>
                )}
              </>
            )}
          </div>
          {trash ? null : <MoreMenu clip={clip} onMoved={onMoved} />}
        </div>
      </div>
    </article>
  );
}
