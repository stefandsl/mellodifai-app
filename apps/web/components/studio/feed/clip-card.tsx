"use client";

import { cn } from "cn";
import {
  Download,
  Film,
  Info,
  ListPlus,
  Loader2,
  MoreHorizontal,
  Music2,
  Pause,
  Play,
  RotateCcw,
  Share2,
} from "lucide-react";
import Link from "next/link";
import { toast } from "sonner";

import { useLocale } from "@/components/locale-provider";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { type Clip, needsAction } from "@/lib/studio/clips";
import { st } from "@/lib/studio/i18n";
import { initialForm, useCreateForm } from "@/store/create-form";
import { type Track, usePlayer } from "@/store/player";
import { modelLabel } from "../create/model-select";
import { hasNextStep, NextStep } from "./next-step";

const GENERATING = new Set([
  "drafting",
  "song_queued",
  "producing",
  "publishing",
]);

// What made the song: the local engine's name, else the kie model ("v6").
export function clipBadge(clip: Pick<Clip, "model" | "settings">): string {
  if (clip.settings.engine === "yue2") return "YuE2";
  if (clip.settings.engine === "ace-step") return "ACE-Step";
  return modelLabel(clip.model);
}

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
  };
}

function StatusBadge({ clip }: { clip: Clip }) {
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
}: {
  clip: Clip;
  list: Clip[];
  size: "list" | "grid";
}) {
  const lang = useLocale();
  const current = usePlayer((s) => s.queue[s.index]?.id === clip.id);
  const playing = usePlayer((s) => s.playing) && current;
  const play = usePlayer((s) => s.play);
  const toggle = usePlayer((s) => s.toggle);
  const generating = GENERATING.has(clip.status);
  const track = trackFor(clip);
  return (
    <div
      className={cn(
        "group/art relative shrink-0 overflow-hidden rounded-lg",
        size === "list" ? "size-[84px]" : "aspect-square w-full",
        generating && "shimmer",
      )}
      style={generating ? undefined : { background: clip.art }}
    >
      {!generating && !clip.hasCover && clip.videoUrl ? (
        // No thumbnail yet: a frame from the song's own video stands in as the cover.
        <video
          aria-hidden
          src={`${clip.videoUrl}#t=25`}
          muted
          playsInline
          preload="metadata"
          tabIndex={-1}
          className="pointer-events-none absolute inset-0 size-full object-cover"
        />
      ) : null}
      {!generating && !clip.hasCover && !clip.videoUrl ? (
        // No image at all yet: the title on the song's own gradient is its cover.
        <span
          aria-hidden
          className={cn(
            "absolute inset-x-2 top-2 line-clamp-3 font-semibold leading-tight text-white [text-shadow:0_1px_3px_rgb(0_0_0/0.6)]",
            size === "list" ? "text-[11px]" : "text-lg",
          )}
        >
          {clip.title}
        </span>
      ) : null}
      {generating ? (
        <Loader2 className="absolute top-1/2 left-1/2 size-5 -translate-1/2 animate-spin text-[var(--fg-muted)]" />
      ) : (
        <span
          aria-hidden
          className="absolute bottom-1.5 left-2 font-mono text-[11px] font-semibold text-white/90 [text-shadow:0_1px_3px_rgb(0_0_0/0.8)]"
        >
          {clip.lang.toUpperCase()}
        </span>
      )}
      {clip.videoUrl ? (
        <Film
          aria-hidden
          className="absolute top-1.5 right-1.5 size-3.5 text-white/85"
        />
      ) : null}
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

function MoreMenu({ clip }: { clip: Clip }) {
  const lang = useLocale();
  const enqueue = usePlayer((s) => s.enqueue);
  const setForm = useCreateForm((s) => s.set);
  const track = trackFor(clip);
  const share = async () => {
    const url = new URL(clip.href, window.location.origin).toString();
    await navigator.clipboard.writeText(url);
    toast.success(st(lang, "clip.copied"));
  };
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        aria-label={st(lang, "clip.more")}
        className="inline-flex size-8 items-center justify-center rounded-full bg-[var(--surface-2)] outline-none hover:bg-[color-mix(in_oklab,var(--surface-2),var(--fg)_10%)] focus-visible:ring-2 focus-visible:ring-[var(--brand)]"
      >
        <MoreHorizontal className="size-4" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-56 rounded-2xl p-1.5">
        <DropdownMenuItem
          render={<Link href={clip.href} />}
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
          onClick={() => {
            const settings = clip.settings as Record<string, unknown>;
            setForm({
              ...initialForm(clip.lang),
              mode: clip.lyrics && clip.style ? "advanced" : "simple",
              prompt: clip.prompt,
              lyrics: clip.lyrics,
              styles: clip.style,
              title: typeof settings.title === "string" ? settings.title : "",
              languages: [clip.lang],
            });
            toast.success(st(lang, "clip.reused"));
          }}
          className="rounded-lg"
        >
          <RotateCcw />
          {st(lang, "clip.reuse")}
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem onClick={share} className="rounded-lg">
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
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function Actions({ clip }: { clip: Clip }) {
  const lang = useLocale();
  const _soon = st(lang, "soon");
  return (
    <div className="flex items-center gap-1.5">
      <button
        type="button"
        aria-label={st(lang, "clip.share")}
        onClick={async () => {
          await navigator.clipboard.writeText(
            new URL(clip.href, window.location.origin).toString(),
          );
          toast.success(st(lang, "clip.copied"));
        }}
        className="hidden h-8 items-center gap-1.5 rounded-full bg-[var(--surface-2)] px-3 text-[13px] outline-none hover:bg-[color-mix(in_oklab,var(--surface-2),var(--fg)_10%)] focus-visible:ring-2 focus-visible:ring-[var(--brand)] sm:inline-flex"
      >
        <Share2 className="size-3.5" />
        {lang === "it" ? "Condividi" : "Share"}
      </button>
    </div>
  );
}

function StageLine({ clip }: { clip: Clip }) {
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

export function ClipCard({
  clip,
  list,
  view,
}: {
  clip: Clip;
  list: Clip[];
  view: "list" | "grid";
}) {
  const lang = useLocale();
  const current = usePlayer((s) => s.queue[s.index]?.id === clip.id);
  const title = clip.title || st(lang, "clip.untitled");
  if (view === "grid")
    return (
      <article
        aria-label={title}
        className={cn(
          "group/card flex flex-col gap-2 rounded-[20px] p-2.5 transition-colors hover-glass",
          current && "bg-[var(--surface-glass)]",
        )}
      >
        <Artwork clip={clip} list={list} size="grid" />
        <div className="min-w-0 px-0.5">
          <div className="flex items-center gap-1.5">
            <Link
              href={clip.href}
              className="truncate font-medium outline-none hover:underline focus-visible:underline"
            >
              {title}
            </Link>
            <span className="shrink-0 text-[11px] font-semibold text-[var(--brand)]">
              {clipBadge(clip)}
            </span>
          </div>
          <p className="truncate text-[13px] text-[var(--fg-muted)]">
            {clip.style || clip.prompt}
          </p>
          <div className="mt-1.5 flex min-h-5 flex-wrap items-center gap-1.5">
            <StatusBadge clip={clip} />
            {hasNextStep(clip) ? (
              <NextStep clip={clip} />
            ) : (
              <StageLine clip={clip} />
            )}
          </div>
        </div>
      </article>
    );
  return (
    <article
      aria-label={title}
      className={cn(
        "group/card flex h-[110px] items-center gap-3 rounded-[20px] p-3 transition-colors hover-glass",
        current && "bg-[var(--surface-glass)]",
      )}
    >
      <Artwork clip={clip} list={list} size="list" />
      <div className="flex min-w-0 flex-1 flex-col justify-between self-stretch py-0.5">
        <div className="min-w-0">
          <div className="flex items-center gap-1.5">
            <Link
              href={clip.href}
              className="truncate text-[15px] font-medium outline-none hover:underline focus-visible:underline"
            >
              {title}
            </Link>
            <span className="shrink-0 rounded-full bg-[color-mix(in_oklab,var(--brand),transparent_85%)] px-1.5 text-[10px] leading-4 font-semibold text-[var(--brand)]">
              {clipBadge(clip)}
            </span>
            <span className="contents max-sm:hidden">
              <StatusBadge clip={clip} />
            </span>
          </div>
          <p className="mt-0.5 truncate text-[13px] text-[var(--fg-muted)]">
            {clip.style || clip.prompt}
          </p>
        </div>
        <div className="flex items-center justify-between gap-2">
          <div className="flex min-w-0 items-center gap-3">
            <Actions clip={clip} />
            {hasNextStep(clip) ? (
              <NextStep clip={clip} />
            ) : (
              <span className="truncate">
                <StageLine clip={clip} />
              </span>
            )}
          </div>
          <MoreMenu clip={clip} />
        </div>
      </div>
    </article>
  );
}
