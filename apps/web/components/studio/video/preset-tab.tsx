"use client";

import {
  CLASSICO_COLORS,
  CONTOUR_STYLES,
  CROWN_TEETH,
  PARTICLE_FLOWS,
  PARTICLE_SHAPES,
  VISUALIZER_PRESETS,
  type VisualizerLook,
  type VisualizerPreset,
} from "@mellodifai/shared";
import { cn } from "cn";
import {
  Activity,
  AudioLines,
  AudioWaveform,
  ChartColumn,
  CircleDashed,
  CircleDot,
  Clapperboard,
  Ellipsis,
  Frame,
  Grip,
  type LucideIcon,
  Minus,
  MountainSnow,
  Newspaper,
  Pill,
  ScanEye,
  Shapes,
  Sparkles,
  SquarePlay,
  Sun,
  Sunset,
} from "lucide-react";
import { useId } from "react";

import { useLocale } from "@/components/locale-provider";
import { type StudioKey, st } from "@/lib/studio/i18n";
import { useVideoStudio } from "@/store/video-studio";
import { Section } from "./style-tab";
import { Toggle } from "./text-tab";

const ICON: Record<VisualizerPreset, LucideIcon> = {
  classico: Clapperboard,
  circle: CircleDot,
  spectrum: ChartColumn,
  mirror: AudioLines,
  waveform: AudioWaveform,
  particles: Sparkles,
  minimal: Minus,
  dotline: Ellipsis,
  burst: Activity,
  crown: Sun,
  wirering: CircleDashed,
  lens: ScanEye,
  pills: Pill,
  edgebars: Grip,
  coverframe: Frame,
  playercard: SquarePlay,
  contours: MountainSnow,
  synthwave: Sunset,
  editorial: Newspaper,
  shaped: Shapes,
};

const FIELD =
  "h-9 w-full rounded-xl bg-[var(--surface-2)] px-3 text-[13px] outline-none ring-1 ring-transparent placeholder:text-[var(--fg-subtle)] focus:ring-[color-mix(in_oklab,var(--brand),transparent_40%)]";

// A wrapping row of choice chips, one of which is on.
function Chips<T extends string>({
  label,
  value,
  options,
  prefix,
  onChange,
}: {
  label: string;
  value: T;
  options: readonly T[];
  prefix: string;
  onChange: (value: T) => void;
}) {
  const lang = useLocale();
  return (
    <div className="space-y-1.5">
      <span className="block text-[12px] text-[var(--fg-muted)]">{label}</span>
      <div
        role="radiogroup"
        aria-label={label}
        className="flex flex-wrap gap-1.5"
      >
        {options.map((option) => {
          const selected = option === value;
          return (
            // biome-ignore lint/a11y/useSemanticElements: a styled chip, not a native radio input.
            <button
              key={option}
              type="button"
              role="radio"
              aria-checked={selected}
              onClick={() => onChange(option)}
              className={cn(
                "h-8 rounded-full px-3 text-[12px] ring-1 transition-colors outline-none focus-visible:ring-2 focus-visible:ring-[var(--brand)]",
                selected
                  ? "bg-[color-mix(in_oklab,var(--brand),transparent_82%)] font-medium ring-[color-mix(in_oklab,var(--brand),transparent_40%)]"
                  : "bg-[var(--surface-2)] text-[var(--fg-muted)] ring-transparent hover:text-[var(--fg)]",
              )}
            >
              {st(lang, `${prefix}.${option}` as StudioKey)}
            </button>
          );
        })}
      </div>
    </div>
  );
}

// The variants of the looks that have them: Corona's teeth, the shapes and their flow,
// Contorni's two styles.
function LookOptions({ preset }: { preset: VisualizerPreset }) {
  const lang = useLocale();
  const look = useVideoStudio((s) => s.params.look);
  const update = useVideoStudio((s) => s.update);
  const set = (patch: Partial<VisualizerLook>) =>
    update((p) => ({ ...p, look: { ...p.look, ...patch } }));
  if (preset !== "crown" && preset !== "shaped" && preset !== "contours")
    return null;
  return (
    <Section title={st(lang, "vs.lookOptions")}>
      {preset === "crown" ? (
        <>
          <Chips
            label={st(lang, "vs.teeth")}
            value={look.teeth}
            options={CROWN_TEETH}
            prefix="vs.teeth"
            onChange={(teeth) => set({ teeth })}
          />
          <Toggle
            label={st(lang, "vs.mirrored")}
            checked={look.mirrored}
            onChange={(mirrored) => set({ mirrored })}
          />
        </>
      ) : null}
      {preset === "shaped" ? (
        <>
          <Chips
            label={st(lang, "vs.shape")}
            value={look.shape}
            options={PARTICLE_SHAPES}
            prefix="vs.shape"
            onChange={(shape) => set({ shape })}
          />
          <Chips
            label={st(lang, "vs.flow")}
            value={look.flow}
            options={PARTICLE_FLOWS}
            prefix="vs.flow"
            onChange={(flow) => set({ flow })}
          />
        </>
      ) : null}
      {preset === "contours" ? (
        <Chips
          label={st(lang, "vs.contour")}
          value={look.contour}
          options={CONTOUR_STYLES}
          prefix="vs.contour"
          onChange={(contour) => set({ contour })}
        />
      ) : null}
    </Section>
  );
}

// Badge Rotanti: an overlay over whichever preset is chosen.
function Overlays() {
  const lang = useLocale();
  const badges = useVideoStudio((s) => s.params.badges);
  const update = useVideoStudio((s) => s.update);
  const id = useId();
  const set = (patch: Partial<typeof badges>) =>
    update((p) => ({ ...p, badges: { ...p.badges, ...patch } }));
  return (
    <Section title={st(lang, "vs.overlays")}>
      <div
        className={cn(
          "space-y-3 rounded-2xl p-3 ring-1 transition-colors",
          badges.enabled
            ? "bg-[color-mix(in_oklab,var(--brand),transparent_86%)] ring-[color-mix(in_oklab,var(--brand),transparent_50%)]"
            : "bg-[var(--surface-2)] ring-transparent",
        )}
      >
        <Toggle
          checked={badges.enabled}
          onChange={(enabled) => set({ enabled })}
          label={
            <span className="min-w-0">
              <span className="block font-medium">{st(lang, "vs.badges")}</span>
              <span className="block text-[12px] text-[var(--fg-muted)]">
                {st(lang, "vs.badgesHint")}
              </span>
            </span>
          }
        />
        {badges.enabled ? (
          <div className="space-y-1">
            <label
              htmlFor={id}
              className="block text-[12px] text-[var(--fg-muted)]"
            >
              {st(lang, "vs.badgesText")}
            </label>
            <input
              id={id}
              value={badges.text}
              maxLength={40}
              placeholder={st(lang, "vs.badgesPlaceholder")}
              onChange={(e) => set({ text: e.target.value })}
              className={cn(FIELD, "bg-[var(--surface-1)]")}
            />
          </div>
        ) : null}
      </div>
    </Section>
  );
}

// Two columns of preset tiles; a click switches the live preview at once while the song plays.
// Under them the chosen look's options and the overlays that go over any preset.
export function PresetTab() {
  const lang = useLocale();
  const preset = useVideoStudio((s) => s.params.preset);
  const update = useVideoStudio((s) => s.update);
  return (
    <div className="space-y-6">
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
      <LookOptions preset={preset} />
      <Overlays />
    </div>
  );
}
