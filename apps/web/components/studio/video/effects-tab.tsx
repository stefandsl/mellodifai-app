"use client";

import {
  effectOf,
  VISUALIZER_EFFECTS,
  type VisualizerEffect,
} from "@mellodifai/shared";
import { cn } from "cn";
import {
  Aperture,
  Film,
  type LucideIcon,
  ScanLine,
  SunDim,
  Tv,
  Zap,
} from "lucide-react";

import { useLocale } from "@/components/locale-provider";
import { st } from "@/lib/studio/i18n";
import { useVideoStudio } from "@/store/video-studio";
import { EditableSlider } from "../ui";
import { Toggle } from "./text-tab";

const ICON: Record<VisualizerEffect, LucideIcon> = {
  grain: Film,
  vhs: Tv,
  scanlines: ScanLine,
  vignette: SunDim,
  aberration: Aperture,
  glitch: Zap,
};

// One card per effect: a switch, and once on an "Intensità" slider. Effects stack, in the order
// listed, in the preview and in the video alike.
export function EffectsTab() {
  const lang = useLocale();
  const params = useVideoStudio((s) => s.params);
  const update = useVideoStudio((s) => s.update);
  const set = (
    id: VisualizerEffect,
    patch: { enabled?: boolean; intensity?: number },
  ) =>
    update((p) => ({
      ...p,
      effects: p.effects.map((effect) =>
        effect.id === id ? { ...effect, ...patch } : effect,
      ),
    }));
  return (
    <ul className="space-y-2">
      {VISUALIZER_EFFECTS.map((id) => {
        const effect = effectOf(params, id);
        const Icon = ICON[id];
        return (
          <li
            key={id}
            className={cn(
              "rounded-2xl p-3 ring-1 transition-colors",
              effect.enabled
                ? "bg-[color-mix(in_oklab,var(--brand),transparent_86%)] ring-[color-mix(in_oklab,var(--brand),transparent_50%)]"
                : "bg-[var(--surface-2)] ring-transparent",
            )}
          >
            <Toggle
              checked={effect.enabled}
              onChange={(enabled) => set(id, { enabled })}
              label={
                <span className="flex items-center gap-3">
                  <span
                    className={cn(
                      "flex size-8 shrink-0 items-center justify-center rounded-lg",
                      effect.enabled
                        ? "bg-[var(--brand)] text-[var(--brand-ink)]"
                        : "bg-[var(--surface-1)] text-[var(--fg-muted)]",
                    )}
                  >
                    <Icon className="size-4" />
                  </span>
                  <span className="min-w-0">
                    <span className="block font-medium">
                      {st(lang, `vs.effect.${id}`)}
                    </span>
                    <span className="block text-[12px] text-[var(--fg-muted)]">
                      {st(lang, `vs.effectHint.${id}`)}
                    </span>
                  </span>
                </span>
              }
            />
            {effect.enabled ? (
              <div className="mt-3">
                <EditableSlider
                  label={st(lang, "vs.intensity")}
                  value={effect.intensity}
                  display={`${effect.intensity}%`}
                  onChange={(intensity) => set(id, { intensity })}
                />
              </div>
            ) : null}
          </li>
        );
      })}
    </ul>
  );
}
