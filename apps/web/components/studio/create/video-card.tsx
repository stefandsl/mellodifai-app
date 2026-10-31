"use client";

import {
  Check,
  Clapperboard,
  Film,
  Images,
  Sparkles,
  Type,
  X,
} from "lucide-react";

import { useLocale } from "@/components/locale-provider";
import { st } from "@/lib/studio/i18n";
import { useCreateForm, type VideoMode } from "@/store/create-form";
import { PanelCard, Segmented, Tip } from "../ui";

// Only the lyric video exists in the PC pipeline today; the other modes are v2.
function modeOptions(lang: "it" | "en") {
  const soon = st(lang, "soon");
  return [
    { value: "off" as const, label: st(lang, "video.off"), icon: <X />, soon },
    { value: "lyric" as const, label: st(lang, "video.lyric"), icon: <Type /> },
    {
      value: "ai" as const,
      label: st(lang, "video.ai"),
      icon: <Sparkles />,
      soon,
    },
    {
      value: "slideshow" as const,
      label: st(lang, "video.slideshow"),
      icon: <Images />,
      soon,
    },
    {
      value: "footage" as const,
      label: st(lang, "video.footage"),
      icon: <Film />,
      soon,
    },
  ];
}

function Formats() {
  const lang = useLocale();
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {["16:9", "9:16"].map((aspect) => (
        <span
          key={aspect}
          className="inline-flex h-7 items-center gap-1 rounded-full bg-[var(--surface-2)] px-3 text-[13px] font-medium"
        >
          <Check className="size-3.5 text-[var(--brand)]" />
          {aspect}
        </span>
      ))}
      <Tip label={st(lang, "soon")}>
        <span
          aria-disabled
          className="inline-flex h-7 cursor-not-allowed items-center rounded-full bg-[var(--surface-2)] px-3 text-[13px] text-[var(--fg-muted)] opacity-45"
        >
          1:1
        </span>
      </Tip>
    </div>
  );
}

export function VideoCard() {
  const lang = useLocale();
  const video = useCreateForm((s) => s.video);
  const open = useCreateForm((s) => s.open.video);
  const toggle = useCreateForm((s) => s.toggleCard);
  const setVideo = useCreateForm((s) => s.setVideo);
  return (
    <PanelCard
      id="video"
      title={st(lang, "create.video")}
      open={open}
      onToggle={() => toggle("video")}
    >
      <div className="space-y-4">
        <div className="overflow-x-auto scrollbar-none">
          <Segmented<VideoMode>
            label={st(lang, "create.videoMode")}
            value={video.mode}
            onChange={(mode) => mode && setVideo({ mode })}
            options={modeOptions(lang)}
            size="sm"
          />
        </div>
        <div className="flex items-center justify-between gap-3 text-[13px]">
          <span>{st(lang, "create.aspect")}</span>
          <Formats />
        </div>
        <div className="flex items-center justify-between gap-3 text-[13px]">
          <span>{st(lang, "create.lyricsOverlay")}</span>
          <Segmented
            label={st(lang, "create.lyricsOverlay")}
            value="on"
            onChange={() => {}}
            size="sm"
            options={[
              { value: "on", label: st(lang, "create.on") },
              {
                value: "off",
                label: st(lang, "create.off"),
                soon: st(lang, "soon"),
              },
            ]}
          />
        </div>
        <p className="flex gap-2 text-xs leading-5 text-[var(--fg-muted)]">
          <Clapperboard className="mt-0.5 size-3.5 shrink-0" />
          {st(lang, "create.videoNote")}
        </p>
      </div>
    </PanelCard>
  );
}

// Compact video row under the Simple prompt (brief section 6.1).
export function VideoRow() {
  const lang = useLocale();
  return (
    <div className="flex items-center justify-between gap-3 rounded-2xl bg-[var(--surface-1)] px-4 py-3 text-[13px]">
      <span className="flex min-w-0 items-center gap-2 whitespace-nowrap">
        <Clapperboard className="size-4 shrink-0 text-[var(--brand)]" />
        {st(lang, "create.videoAlso")}
      </span>
      <span className="flex shrink-0 items-center gap-1.5 whitespace-nowrap">
        <span className="rounded-full bg-[var(--surface-2)] px-2.5 py-1 text-xs">
          {st(lang, "video.lyric")}
        </span>
        <span className="rounded-full bg-[var(--surface-2)] px-2.5 py-1 text-xs tabular-nums">
          16:9 + 9:16
        </span>
      </span>
    </div>
  );
}
