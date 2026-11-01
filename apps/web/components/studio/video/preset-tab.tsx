"use client";

import {
  CLASSICO_COLORS,
  VISUALIZER_PRESETS,
  type VisualizerPreset,
} from "@mellodifai/shared";
import { cn } from "cn";
import {
  AudioLines,
  AudioWaveform,
  ChartColumn,
  CircleDot,
  Clapperboard,
  type LucideIcon,
  Minus,
  Sparkles,
} from "lucide-react";

import { useLocale } from "@/components/locale-provider";
import { st } from "@/lib/studio/i18n";
import { useVideoStudio } from "@/store/video-studio";

const ICON: Record<VisualizerPreset, LucideIcon> = {
  classico: Clapperboard,
  circle: CircleDot,
  spectrum: ChartColumn,
  mirror: AudioLines,
  waveform: AudioWaveform,
  particles: Sparkles,
  minimal: Minus,
};

// Two columns of preset tiles; a click switches the live preview at once while the song plays.
export function PresetTab() {
  const lang = useLocale();
  const preset = useVideoStudio((s) => s.params.preset);
  const update = useVideoStudio((s) => s.update);
  return (
    <div
      role="radiogroup"
      aria-label={st(lang, "vs.tabPreset")}
      className="grid grid-cols-2 gap-2"
    >
      {VISUALIZER_PRESETS.map((id) => {
        const Icon = ICON[id];
        const selected = preset === id;
        return (
          // biome-ignore lint/a11y/useSemanticElements: a styled tile, not a native radio input.
          <button
            key={id}
            type="button"
            role="radio"
            aria-checked={selected}
            onClick={() =>
              update((p) =>
                // MellodifAI Classico comes with the channel's blue to magenta wave.
                id === "classico" && p.preset !== "classico"
                  ? { ...p, preset: id, colors: { ...CLASSICO_COLORS } }
                  : { ...p, preset: id },
              )
            }
            className={cn(
              "flex min-h-[76px] flex-col items-start gap-1.5 rounded-2xl p-3 text-left ring-1 transition-colors outline-none focus-visible:ring-2 focus-visible:ring-[var(--brand)]",
              id === "classico" && "col-span-2",
              selected
                ? "bg-[color-mix(in_oklab,var(--brand),transparent_82%)] ring-[color-mix(in_oklab,var(--brand),transparent_40%)]"
                : "bg-[var(--surface-2)] ring-transparent hover:bg-[color-mix(in_oklab,var(--surface-2),var(--fg)_6%)]",
            )}
          >
            <span className="flex items-center gap-2 text-[13px] font-medium">
              <Icon
                className={cn(
                  "size-4 shrink-0",
                  selected
                    ? "text-[var(--brand)] drop-shadow-[0_0_6px_var(--brand)]"
                    : "text-[var(--fg-muted)]",
                )}
              />
              {st(lang, `vs.preset.${id}`)}
            </span>
            <span className="text-[12px] leading-4 text-[var(--fg-muted)]">
              {st(lang, `vs.presetHint.${id}`)}
            </span>
          </button>
        );
      })}
    </div>
  );
}
