"use client";

import { cn } from "cn";
import { Clapperboard, Music2, Type, X } from "lucide-react";

import { useLocale } from "@/components/locale-provider";
import { st } from "@/lib/studio/i18n";
import { useCreateForm, type VideoMode } from "@/store/create-form";
import { PanelCard, Segmented } from "../ui";

// The PC renders the lyric video in 16:9 plus a 9:16 vertical clip; "off" keeps audio only.
function Note({ off }: { off: boolean }) {
  const lang = useLocale();
  return (
    <p className="flex gap-2 text-xs leading-5 text-[var(--fg-muted)]">
      {off ? (
        <Music2 className="mt-0.5 size-3.5 shrink-0" />
      ) : (
        <Clapperboard className="mt-0.5 size-3.5 shrink-0" />
      )}
      {st(lang, off ? "create.videoOffNote" : "create.videoNote")}
    </p>
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
          value={off ? "off" : "lyric"}
          onChange={(mode) => mode && setVideo({ mode })}
          size="sm"
          options={[
            { value: "off", label: st(lang, "video.off"), icon: <X /> },
            { value: "lyric", label: st(lang, "video.lyric"), icon: <Type /> },
          ]}
        />
        {off ? null : (
          <p className="text-[13px] text-[var(--fg-muted)]">
            {st(lang, "create.aspect")}:{" "}
            <span className="text-[var(--fg)] tabular-nums">16:9 + 9:16</span>
          </p>
        )}
        <Note off={off} />
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
              · 16:9 + 9:16
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
