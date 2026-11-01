"use client";

import { cn } from "cn";
import { AudioLines, Clapperboard, Music2, Type, X } from "lucide-react";

import { useLocale } from "@/components/locale-provider";
import { st } from "@/lib/studio/i18n";
import { useCreateForm, type VideoMode } from "@/store/create-form";
import { useVideoStudio } from "@/store/video-studio";
import { PanelCard, Segmented } from "../ui";

// The PC renders the lyric video in 16:9 plus a 9:16 vertical clip; "off" keeps audio only.
function Note({ off, visualizer }: { off: boolean; visualizer?: boolean }) {
  const lang = useLocale();
  return (
    <p className="flex gap-2 text-xs leading-5 text-[var(--fg-muted)]">
      {off ? (
        <Music2 className="mt-0.5 size-3.5 shrink-0" />
      ) : (
        <Clapperboard className="mt-0.5 size-3.5 shrink-0" />
      )}
      {st(
        lang,
        off
          ? "create.videoOffNote"
          : visualizer
            ? "create.visualizerNote"
            : "create.videoNote",
      )}
    </p>
  );
}

// The look the next songs' visualizer gets, and the way into the studio to change it.
function VisualizerLook() {
  const lang = useLocale();
  const params = useVideoStudio((s) => s.params);
  const openSetup = useVideoStudio((s) => s.openSetup);
  return (
    <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl bg-[var(--surface-2)] px-3 py-2">
      <span className="flex min-w-0 items-center gap-2 text-[13px]">
        <span
          aria-hidden
          className="size-4 shrink-0 rounded-full ring-1 ring-[var(--hairline)]"
          style={{
            background: `linear-gradient(135deg, ${params.colors.primary} 0 50%, ${params.colors.secondary} 50% 100%)`,
          }}
        />
        <span className="truncate">
          {st(lang, "create.visualizerLook")}:{" "}
          <span className="font-medium">
            {st(lang, `vs.preset.${params.preset}`)}
          </span>
          <span className="text-[var(--fg-muted)] tabular-nums">
            {" "}
            · {params.aspect}
          </span>
        </span>
      </span>
      <button
        type="button"
        onClick={openSetup}
        className="inline-flex h-7 items-center gap-1.5 rounded-full bg-[var(--fg)] px-3 text-xs font-medium text-[var(--bg)] outline-none hover:opacity-90 focus-visible:ring-2 focus-visible:ring-[var(--brand)]"
      >
        <Clapperboard className="size-3.5" />
        {st(lang, "vs.open")}
      </button>
    </div>
  );
}

export function VideoCard() {
  const lang = useLocale();
  const video = useCreateForm((s) => s.video);
  const open = useCreateForm((s) => s.open.video);
  const toggle = useCreateForm((s) => s.toggleCard);
  const setVideo = useCreateForm((s) => s.setVideo);
  const off = video.mode === "off";
  return (
    <PanelCard
      id="video"
      title={st(lang, "create.video")}
      open={open}
      onToggle={() => toggle("video")}
    >
      <div className="space-y-3">
        <Segmented<VideoMode>
          label={st(lang, "create.videoMode")}
          value={
            off ? "off" : video.mode === "visualizer" ? "visualizer" : "lyric"
          }
          onChange={(mode) => mode && setVideo({ mode })}
          size="sm"
          options={[
            { value: "off", label: st(lang, "video.off"), icon: <X /> },
            { value: "lyric", label: st(lang, "video.lyric"), icon: <Type /> },
            {
              value: "visualizer",
              label: st(lang, "video.visualizer"),
              icon: <AudioLines />,
            },
          ]}
        />
        {video.mode === "visualizer" ? <VisualizerLook /> : null}
        {off || video.mode === "visualizer" ? null : (
          <p className="text-[13px] text-[var(--fg-muted)]">
            {st(lang, "create.aspect")}:{" "}
            <span className="text-[var(--fg)] tabular-nums">16:9 + 9:16</span>
          </p>
        )}
        <Note off={off} visualizer={video.mode === "visualizer"} />
      </div>
    </PanelCard>
  );
}

// Compact video switch under the Simple prompt (brief section 6.1).
export function VideoRow() {
  const lang = useLocale();
  const mode = useCreateForm((s) => s.video.mode);
  const setVideo = useCreateForm((s) => s.setVideo);
  const on = mode !== "off";
  return (
    <div className="space-y-2 rounded-2xl bg-[var(--surface-1)] px-4 py-3">
      <button
        type="button"
        role="switch"
        aria-checked={on}
        onClick={() => setVideo({ mode: on ? "off" : "lyric" })}
        className="flex w-full items-center justify-between gap-3 rounded-lg text-left text-[13px] outline-none focus-visible:ring-2 focus-visible:ring-[var(--brand)]"
      >
        <span className="flex min-w-0 items-center gap-2 whitespace-nowrap">
          <Clapperboard
            className={cn(
              "size-4 shrink-0",
              on ? "text-[var(--brand)]" : "text-[var(--fg-subtle)]",
            )}
          />
          {st(lang, "create.videoAlso")}
          {on ? (
            <span className="text-[var(--fg-muted)] tabular-nums">
              {mode === "visualizer"
                ? `· ${st(lang, "video.visualizer")}`
                : "· 16:9 + 9:16"}
            </span>
          ) : null}
        </span>
        <span
          aria-hidden
          className={cn(
            "relative h-6 w-10 shrink-0 rounded-full transition-colors",
            on ? "bg-[var(--brand)]" : "bg-[var(--surface-2)]",
          )}
        >
          <span
            className={cn(
              "absolute top-0.5 size-5 rounded-full bg-white shadow transition-transform",
              on ? "translate-x-[18px]" : "translate-x-0.5",
            )}
          />
        </span>
      </button>
      {on ? null : <Note off />}
    </div>
  );
}
