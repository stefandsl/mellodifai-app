"use client";

import { cn } from "cn";
import {
  ChevronRight,
  Clapperboard,
  Download,
  Film,
  Loader2,
} from "lucide-react";

import { useLocale } from "@/components/locale-provider";
import type { Clip, VisualizerVideo } from "@/lib/studio/clips";
import { st, stf } from "@/lib/studio/i18n";
import { useDetailsClips } from "@/store/details";
import { useVideoStudio } from "@/store/video-studio";
import { canMakeVideo, clipBadge } from "../feed/clip-card";
import { useLiveRefresh } from "../feed/use-live-refresh";

const PILL =
  "inline-flex h-8 items-center gap-1.5 rounded-full px-3 text-[13px] font-medium outline-none focus-visible:ring-2 focus-visible:ring-[var(--brand)] [&_svg]:size-3.5";

function VisualizerTile({
  video,
  clip,
}: {
  video: VisualizerVideo;
  clip: Clip;
}) {
  const lang = useLocale();
  const watched = useVideoStudio((s) =>
    s.watched.find((w) => w.clipId === clip.id && w.aspect === video.aspect),
  );
  const tall = video.aspect === "9:16";
  const active =
    watched?.status ??
    (video.status === "queued" || video.status === "running"
      ? video.status
      : null);
  const name = stf(lang, "vs.visualizerVideo", { aspect: video.aspect });
  return (
    <figure className="w-[168px] shrink-0 space-y-1.5">
      <div
        className={cn(
          "relative mx-auto overflow-hidden rounded-xl bg-black ring-1 ring-[var(--hairline)]",
          tall ? "aspect-[9/16] w-[72px]" : "aspect-video w-full",
        )}
      >
        {video.url ? (
          <video
            src={video.url}
            poster={video.posterUrl ?? undefined}
            controls
            preload="none"
            playsInline
            aria-label={`${name}: ${clip.title}`}
            className="size-full object-cover"
          >
            <track kind="captions" />
          </video>
        ) : null}
        {active ? (
          <span className="absolute inset-0 flex items-center justify-center bg-black/55 text-[11px] font-medium text-white">
            <Loader2 className="mr-1 size-3 animate-spin" />
            {active === "running"
              ? stf(lang, "vs.rendering", { pct: String(watched?.pct ?? 0) })
              : st(lang, "vs.queuedSoon")}
          </span>
        ) : null}
      </div>
      <figcaption className="flex items-center justify-between gap-1 text-[12px]">
        <span
          className={cn(
            "truncate",
            video.status === "failed" && !active
              ? "text-[var(--danger)]"
              : "text-[var(--fg-muted)]",
          )}
          title={video.status === "failed" ? (video.error ?? "") : undefined}
        >
          {name}
        </span>
        {video.downloadUrl ? (
          <a
            href={video.downloadUrl}
            download
            aria-label={`${st(lang, "vs.download")}: ${name}`}
            title={st(lang, "vs.download")}
            className="inline-flex size-7 shrink-0 items-center justify-center rounded-full outline-none hover:bg-[var(--surface-glass-hover)] focus-visible:ring-2 focus-visible:ring-[var(--brand)]"
          >
            <Download className="size-3.5" />
          </a>
        ) : null}
      </figcaption>
    </figure>
  );
}

function LyricTile({ clip }: { clip: Clip }) {
  const lang = useLocale();
  if (!clip.videoUrl) return null;
  return (
    <figure className="w-[168px] shrink-0 space-y-1.5">
      <div className="aspect-video overflow-hidden rounded-xl bg-black ring-1 ring-[var(--hairline)]">
        <video
          src={clip.videoUrl}
          controls
          preload="metadata"
          playsInline
          aria-label={`${st(lang, "vs.lyricVideo")}: ${clip.title}`}
          className="size-full object-cover"
        >
          <track kind="captions" />
        </video>
      </div>
      <figcaption className="flex items-center justify-between gap-1 text-[12px] text-[var(--fg-muted)]">
        <span className="flex items-center gap-1 truncate">
          <Film className="size-3" />
          {st(lang, "vs.lyricVideo")}
        </span>
        <a
          href={clip.videoUrl}
          download
          aria-label={`${st(lang, "vs.download")}: ${st(lang, "vs.lyricVideo")}`}
          title={st(lang, "vs.download")}
          className="inline-flex size-7 shrink-0 items-center justify-center rounded-full outline-none hover:bg-[var(--surface-glass-hover)] focus-visible:ring-2 focus-visible:ring-[var(--brand)]"
        >
          <Download className="size-3.5" />
        </a>
      </figcaption>
    </figure>
  );
}

// The sidebar's "Video" page: every song that has audio, with its videos (lyric video and
// Video Studio renders) and a way into the studio for it.
export function VideosView({
  clips,
  heading,
}: {
  clips: Clip[];
  heading: string;
}) {
  const lang = useLocale();
  useLiveRefresh();
  useDetailsClips(clips);
  const openFor = useVideoStudio((s) => s.openFor);
  const songs = clips.filter(
    (clip) => canMakeVideo(clip) || clip.videoUrl || clip.visualizers?.length,
  );
  return (
    <div className="flex h-full flex-col">
      <header className="shrink-0 space-y-1 px-4 pt-4 pb-3 sm:px-6">
        <nav
          aria-label="Breadcrumb"
          className="flex items-center gap-1.5 text-[15px]"
        >
          <span className="text-[var(--fg-muted)]">
            {st(lang, "feed.workspaces")}
          </span>
          <ChevronRight className="size-4 text-[var(--fg-subtle)]" />
          <h1 className="font-medium">{heading}</h1>
        </nav>
        <p className="text-[13px] text-[var(--fg-muted)]">
          {st(lang, "vs.videosHint")}
        </p>
      </header>
      <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-8 scrollbar-thin sm:px-4">
        {songs.length === 0 ? (
          <p className="px-2 py-10 text-center text-[13px] text-[var(--fg-muted)]">
            {st(lang, "vs.videosEmpty")}
          </p>
        ) : (
          <ul className="space-y-1">
            {songs.map((clip) => {
              const visualizers = clip.visualizers ?? [];
              const none = !clip.videoUrl && visualizers.length === 0;
              const title = clip.title || st(lang, "clip.untitled");
              return (
                <li
                  key={clip.id}
                  className="flex flex-col gap-3 rounded-[20px] p-3 hover-glass sm:flex-row sm:items-center"
                >
                  <div className="flex min-w-0 items-center gap-3 sm:w-64 sm:shrink-0">
                    <span
                      aria-hidden
                      className="size-14 shrink-0 rounded-lg"
                      style={{ background: clip.art }}
                    />
                    <div className="min-w-0">
                      <p className="truncate text-[15px] font-medium">
                        {title}
                      </p>
                      <p className="flex items-center gap-1.5 text-[12px] text-[var(--fg-muted)]">
                        <span className="font-mono">
                          {clip.lang.toUpperCase()}
                        </span>
                        <span>·</span>
                        <span className="truncate">{clipBadge(clip)}</span>
                      </p>
                    </div>
                  </div>
                  <div className="flex min-w-0 flex-1 gap-3 overflow-x-auto pb-1 scrollbar-thin">
                    {none ? (
                      <p className="self-center text-[13px] text-[var(--fg-subtle)]">
                        {st(lang, "vs.noVideos")}
                      </p>
                    ) : null}
                    <LyricTile clip={clip} />
                    {visualizers.map((video) => (
                      <VisualizerTile
                        key={video.renderId}
                        video={video}
                        clip={clip}
                      />
                    ))}
                  </div>
                  {canMakeVideo(clip) ? (
                    <button
                      type="button"
                      onClick={() => openFor(clip)}
                      className={cn(
                        PILL,
                        "shrink-0 self-start bg-[var(--fg)] text-[var(--bg)] hover:opacity-90 sm:self-center",
                      )}
                    >
                      <Clapperboard />
                      {st(lang, "vs.open")}
                    </button>
                  ) : null}
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}
