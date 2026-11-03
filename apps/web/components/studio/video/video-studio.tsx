"use client";

import { Dialog as DialogPrimitive } from "@base-ui/react/dialog";
import type { VisualizerAspect, VisualizerQuality } from "@mellodifai/shared";
import { cn } from "cn";
import {
  Check,
  Clapperboard,
  Download,
  Loader2,
  Monitor,
  Pause,
  Play,
  Smartphone,
  X,
} from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { toast } from "sonner";

import { useLocale } from "@/components/locale-provider";
import type { Clip } from "@/lib/studio/clips";
import { type StudioKey, st, stf } from "@/lib/studio/i18n";
import { canSeparate } from "@/lib/studio/stems";
import { playerAnalyser } from "@/lib/studio/visualizer/audio-tap";
import { useCreateForm } from "@/store/create-form";
import { useKnownClips } from "@/store/details";
import { usePlayer } from "@/store/player";
import { type StudioTab, useVideoStudio } from "@/store/video-studio";
import { trackFor } from "../feed/clip-card";
import { Segmented } from "../ui";
import { EffectsTab } from "./effects-tab";
import { PresetTab } from "./preset-tab";
import { StyleTab } from "./style-tab";
import { TextTab } from "./text-tab";
import { VisualizerPreview } from "./visualizer-preview";
import { startRender } from "./visualizer-watcher";

// The studio can make a video of a song whose chosen take has audio: the same rule as stems
// (request_visualizer uses stems_allowed_status).
export const canVisualize = canSeparate;

const TABS: { id: StudioTab; label: StudioKey }[] = [
  { id: "preset", label: "vs.tabPreset" },
  { id: "style", label: "vs.tabStyle" },
  { id: "text", label: "vs.tabText" },
  { id: "effects", label: "vs.tabEffects" },
];

function Tabs() {
  const lang = useLocale();
  const tab = useVideoStudio((s) => s.tab);
  const setTab = useVideoStudio((s) => s.setTab);
  return (
    <div
      role="tablist"
      aria-label={st(lang, "vs.tabs")}
      className="flex shrink-0 border-b border-[var(--hairline)] px-4"
    >
      {TABS.map((item) => {
        const selected = item.id === tab;
        return (
          <button
            key={item.id}
            type="button"
            role="tab"
            id={`vs-tab-${item.id}`}
            aria-selected={selected}
            aria-controls="vs-panel"
            onClick={() => setTab(item.id)}
            className={cn(
              "-mb-px h-11 flex-1 border-b-2 text-[12px] font-semibold tracking-[0.08em] uppercase outline-none transition-colors focus-visible:bg-[var(--surface-glass-hover)]",
              selected
                ? "border-[var(--brand)] text-[var(--fg)]"
                : "border-transparent text-[var(--fg-muted)] hover:text-[var(--fg)]",
            )}
          >
            {st(lang, item.label)}
          </button>
        );
      })}
    </div>
  );
}

function Panel() {
  const tab = useVideoStudio((s) => s.tab);
  return (
    <div
      id="vs-panel"
      role="tabpanel"
      aria-labelledby={`vs-tab-${tab}`}
      className="min-h-0 flex-1 overflow-y-auto px-4 py-4 scrollbar-thin"
    >
      {tab === "preset" ? (
        <PresetTab />
      ) : tab === "style" ? (
        <StyleTab />
      ) : tab === "text" ? (
        <TextTab />
      ) : (
        <EffectsTab />
      )}
    </div>
  );
}

function AspectSwitch() {
  const lang = useLocale();
  const aspect = useVideoStudio((s) => s.params.aspect);
  const update = useVideoStudio((s) => s.update);
  return (
    <Segmented<VisualizerAspect>
      label={st(lang, "vs.aspect")}
      value={aspect}
      onChange={(value) => value && update((p) => ({ ...p, aspect: value }))}
      size="sm"
      options={[
        { value: "16:9", label: st(lang, "vs.wide"), icon: <Monitor /> },
        { value: "9:16", label: st(lang, "vs.tall"), icon: <Smartphone /> },
      ]}
    />
  );
}

function QualitySwitch() {
  const lang = useLocale();
  const quality = useVideoStudio((s) => s.params.quality);
  const update = useVideoStudio((s) => s.update);
  return (
    <Segmented<VisualizerQuality>
      label={st(lang, "vs.quality")}
      value={quality}
      onChange={(value) => value && update((p) => ({ ...p, quality: value }))}
      size="sm"
      options={[
        { value: "1080p", label: "1080p" },
        { value: "4K", label: "4K" },
      ]}
    />
  );
}

// Play and pause under the preview drive the shared player: the song keeps playing while the
// look changes. In setup it controls whatever the player holds.
function PlayButton({ clip }: { clip: Clip | null }) {
  const lang = useLocale();
  const currentId = usePlayer((s) => s.queue[s.index]?.id ?? null);
  const playing = usePlayer((s) => s.playing);
  const play = usePlayer((s) => s.play);
  const toggle = usePlayer((s) => s.toggle);
  const track = clip ? trackFor(clip) : null;
  const mine = clip ? currentId === clip.id : currentId !== null;
  const active = mine && playing;
  const disabled = clip ? !track : currentId === null;
  return (
    <div className="flex items-center gap-3">
      <button
        type="button"
        aria-label={st(lang, active ? "vs.pause" : "vs.play")}
        disabled={disabled}
        onClick={() => {
          // The first press starts the analyser while the click still counts as a gesture.
          playerAnalyser();
          if (mine) toggle();
          else if (track) play(track);
        }}
        className="inline-flex size-11 items-center justify-center rounded-full bg-[var(--fg)] text-[var(--bg)] shadow-lg outline-none transition-transform hover:scale-105 focus-visible:ring-2 focus-visible:ring-[var(--brand)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--surface-1)] disabled:opacity-40 disabled:hover:scale-100"
      >
        {active ? (
          <Pause className="size-5 fill-current" />
        ) : (
          <Play className="size-5 translate-x-px fill-current" />
        )}
      </button>
      {disabled ? (
        <p className="max-w-56 text-xs leading-4 text-[var(--fg-muted)]">
          {st(lang, clip ? "vs.unavailable" : "vs.nothingPlaying")}
        </p>
      ) : null}
    </div>
  );
}

function RenderControl({ clip }: { clip: Clip }) {
  const lang = useLocale();
  const router = useRouter();
  const params = useVideoStudio((s) => s.params);
  const watched = useVideoStudio((s) =>
    s.watched.find((w) => w.clipId === clip.id && w.aspect === s.params.aspect),
  );
  const watch = useVideoStudio((s) => s.watch);
  const [busy, setBusy] = useState(false);
  const video = clip.visualizers?.find((item) => item.aspect === params.aspect);
  const title = clip.title || st(lang, "clip.untitled");
  // A render already on its way (asked from another tab or before a reload) is followed too.
  useEffect(() => {
    if (
      !watched &&
      video?.jobId &&
      (video.status === "queued" || video.status === "running")
    )
      watch({
        jobId: video.jobId,
        clipId: clip.id,
        title,
        aspect: video.aspect,
        params: video.params,
        status: video.status,
        queue: video.queuePosition,
      });
  }, [watched, video, clip.id, title, watch]);
  const active =
    watched?.status ??
    (video?.status === "queued" || video?.status === "running"
      ? video.status
      : null);
  const allowed = canVisualize(clip);
  const queue = watched?.queue ?? video?.queuePosition ?? null;
  const pct = watched?.pct ?? null;
  const label =
    active === "queued"
      ? queue && queue > 1
        ? stf(lang, "vs.queued", { n: String(queue) })
        : st(lang, "vs.queuedSoon")
      : active === "running"
        ? stf(lang, "vs.rendering", { pct: String(pct ?? 0) })
        : st(lang, "vs.render");
  return (
    <div className="flex min-w-0 flex-1 flex-wrap items-center justify-end gap-x-4 gap-y-2">
      {video?.status === "failed" && !active ? (
        <p
          className="min-w-0 flex-1 truncate text-xs text-[var(--danger)]"
          title={video.error ?? ""}
        >
          {stf(lang, "vs.failed", { title })}
          {video.error ? `: ${video.error}` : ""}
        </p>
      ) : video?.downloadUrl && !active ? (
        <a
          href={video.downloadUrl}
          download
          className="inline-flex h-9 items-center gap-1.5 rounded-full px-3 text-[13px] text-[var(--fg-muted)] outline-none hover:bg-[var(--surface-glass-hover)] hover:text-[var(--fg)] focus-visible:ring-2 focus-visible:ring-[var(--brand)]"
        >
          <Download className="size-4" />
          {stf(lang, "vs.lastVideo", { aspect: params.aspect })}
        </a>
      ) : null}
      <div className="relative w-full overflow-hidden rounded-full sm:w-auto">
        <button
          type="button"
          disabled={!allowed || busy || Boolean(active)}
          onClick={async () => {
            setBusy(true);
            const id = await startRender(
              lang,
              { clipId: clip.id, title, aspect: params.aspect, params },
              router.refresh,
            );
            setBusy(false);
            if (id) toast.success(st(lang, "vs.renderStarted"));
          }}
          className={cn(
            "relative inline-flex h-11 w-full items-center justify-center gap-2 rounded-full px-5 text-[14px] font-semibold tabular-nums outline-none focus-visible:ring-2 focus-visible:ring-[var(--brand)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--surface-1)] sm:w-auto sm:min-w-60",
            active
              ? "bg-[var(--surface-2)] text-[var(--fg)]"
              : "bg-[var(--fg)] text-[var(--bg)] hover:opacity-90 disabled:opacity-40",
          )}
        >
          {active === "running" ? (
            <span
              aria-hidden
              className="absolute inset-y-0 left-0 bg-[color-mix(in_oklab,var(--brand),transparent_55%)] transition-[width] duration-700"
              style={{ width: `${pct ?? 0}%` }}
            />
          ) : null}
          <span className="relative inline-flex items-center gap-2">
            {active || busy ? (
              <Loader2 className="size-4 animate-spin" />
            ) : (
              <Clapperboard className="size-4" />
            )}
            {label}
          </span>
        </button>
      </div>
    </div>
  );
}

function SetupControl() {
  const lang = useLocale();
  const close = useVideoStudio((s) => s.close);
  const setVideo = useCreateForm((s) => s.setVideo);
  return (
    <button
      type="button"
      onClick={() => {
        setVideo({ mode: "visualizer" });
        close();
        toast.success(st(lang, "vs.lookSaved"));
      }}
      className="inline-flex h-11 w-full items-center justify-center gap-2 rounded-full bg-[var(--fg)] px-5 text-[14px] font-semibold text-[var(--bg)] outline-none hover:opacity-90 focus-visible:ring-2 focus-visible:ring-[var(--brand)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--surface-1)] sm:w-auto sm:min-w-52"
    >
      <Check className="size-4" />
      {st(lang, "vs.useLook")}
    </button>
  );
}

// The Video Studio (ace-ui-replica-prompt.md item G): one modal for the song card, the details
// panel, the Videos page and the Create panel's Video card. Settings on the left, the live
// preview on the right; full height on a phone, preview on top.
export function VideoStudio() {
  const lang = useLocale();
  const open = useVideoStudio((s) => s.open);
  const snapshot = useVideoStudio((s) => s.clip);
  const setup = useVideoStudio((s) => s.setup);
  const params = useVideoStudio((s) => s.params);
  const close = useVideoStudio((s) => s.close);
  // The page's fresh copy of the song (render status, new videos), else the one it opened with.
  const fresh = useKnownClips((s) =>
    snapshot ? s.known[snapshot.id] : undefined,
  );
  const clip = setup ? null : (fresh ?? snapshot);
  const currentTitle = usePlayer((s) => s.queue[s.index]?.title ?? "");
  const title = clip ? clip.title || st(lang, "clip.untitled") : currentTitle;
  return (
    <DialogPrimitive.Root open={open} onOpenChange={(next) => !next && close()}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Backdrop className="fixed inset-0 z-50 bg-black/55 backdrop-blur-sm data-open:animate-in data-open:fade-in-0 data-closed:animate-out data-closed:fade-out-0" />
        <DialogPrimitive.Popup
          data-testid="video-studio"
          className="fixed inset-0 z-50 flex flex-col overflow-hidden bg-[var(--surface-1)] text-[var(--fg)] outline-none data-open:animate-in data-open:fade-in-0 data-closed:animate-out data-closed:fade-out-0 sm:inset-4 sm:mx-auto sm:max-w-[1240px] sm:rounded-3xl sm:ring-1 sm:ring-[var(--hairline)] sm:shadow-2xl"
        >
          <header className="flex shrink-0 items-center gap-3 border-b border-[var(--hairline)] px-4 py-3">
            <span className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-[color-mix(in_oklab,var(--brand),transparent_82%)] text-[var(--brand)]">
              <Clapperboard className="size-[18px]" />
            </span>
            <div className="min-w-0 flex-1">
              <DialogPrimitive.Title className="text-[15px] leading-5 font-semibold">
                {st(lang, "vs.title")}
              </DialogPrimitive.Title>
              <DialogPrimitive.Description className="text-[12px] leading-4 text-[var(--fg-muted)] sm:truncate">
                {setup
                  ? st(lang, "vs.setupSubtitle")
                  : `${title} · ${st(lang, "vs.subtitle")}`}
              </DialogPrimitive.Description>
            </div>
            <DialogPrimitive.Close
              aria-label={st(lang, "vs.close")}
              className="inline-flex size-9 shrink-0 items-center justify-center rounded-full bg-[var(--surface-2)] outline-none hover:bg-[color-mix(in_oklab,var(--surface-2),var(--fg)_10%)] focus-visible:ring-2 focus-visible:ring-[var(--brand)]"
            >
              <X className="size-4" />
            </DialogPrimitive.Close>
          </header>

          <div className="flex min-h-0 flex-1 flex-col lg:flex-row-reverse">
            <div className="flex h-[36dvh] shrink-0 flex-col gap-2 bg-[color-mix(in_oklab,var(--bg),black_25%)] p-3 sm:h-[40dvh] lg:h-auto lg:min-w-0 lg:flex-1 lg:gap-3 lg:p-5">
              <div className="flex shrink-0 flex-wrap justify-center gap-2">
                <AspectSwitch />
                <QualitySwitch />
              </div>
              <VisualizerPreview
                params={params}
                title={title}
                coverUrl={clip?.coverUrl ?? null}
                songId={clip?.id ?? null}
                className="min-h-0 flex-1"
              />
              <div className="flex shrink-0 justify-center">
                <PlayButton clip={clip} />
              </div>
            </div>
            <div className="flex min-h-0 flex-1 flex-col border-[var(--hairline)] lg:w-[380px] lg:flex-none lg:border-r">
              <Tabs />
              <Panel />
            </div>
          </div>

          <footer className="flex shrink-0 flex-wrap items-center gap-x-4 gap-y-2 border-t border-[var(--hairline)] px-4 py-3">
            <p className="hidden min-w-0 flex-1 text-xs leading-4 text-[var(--fg-muted)] md:block">
              {st(lang, setup ? "vs.setupNote" : "vs.renderNote")}
            </p>
            {clip ? <RenderControl clip={clip} /> : <SetupControl />}
          </footer>
        </DialogPrimitive.Popup>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}
