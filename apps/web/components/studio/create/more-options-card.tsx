"use client";

import { ACE_GUIDANCE, ACE_STEPS, SEED_MAX } from "@mellodifai/shared";
import { cn } from "cn";
import { ChevronRight, Dices, Trash2 } from "lucide-react";
import { useState } from "react";

import { useLocale } from "@/components/locale-provider";
import { engineControls } from "@/lib/studio/engines";
import { st } from "@/lib/studio/i18n";
import { LIMITS, useCreateForm } from "@/store/create-form";
import { formatTime } from "@/store/player";
import {
  EditableSlider,
  IconButton,
  InfoTip,
  PanelCard,
  Segmented,
} from "../ui";
import { ClearButton } from "./clear-field";
import { useEngineChoice } from "./use-engine";

function Row({
  label,
  tip,
  children,
}: {
  label: string;
  tip?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex items-center justify-between gap-3 text-[13px]">
      <span className="flex items-center gap-1.5">
        {label}
        {tip ? <InfoTip label={tip} /> : null}
      </span>
      {children}
    </div>
  );
}

// "1:30" or "90" (seconds) typed into the duration value.
function parseDuration(text: string): number {
  const [minutes, seconds] = text.split(":");
  if (seconds === undefined) return Number(minutes);
  return Number(minutes) * 60 + Number(seconds);
}

// Local engines: a random seed per song, or one fixed number (take 1 uses it, take 2 the next).
function SeedRow() {
  const lang = useLocale();
  const f = useCreateForm();
  const fixed = f.seedMode === "fixed";
  const roll = () => Math.floor(Math.random() * (SEED_MAX + 1));
  return (
    <div className="space-y-2">
      <Row label={st(lang, "create.seed")} tip={st(lang, "create.seedTip")}>
        <Segmented<"random" | "fixed">
          label={st(lang, "create.seed")}
          value={f.seedMode}
          size="sm"
          onChange={(seedMode) => {
            if (!seedMode) return;
            // Switching to a fixed seed starts from a real number, not from 0.
            f.set({
              seedMode,
              ...(seedMode === "fixed" && f.seed === 0 ? { seed: roll() } : {}),
            });
          }}
          options={[
            { value: "random", label: st(lang, "create.seedRandom") },
            { value: "fixed", label: st(lang, "create.seedFixed") },
          ]}
        />
      </Row>
      {fixed ? (
        <div className="flex items-center gap-2">
          <input
            aria-label={st(lang, "create.seedValue")}
            inputMode="numeric"
            value={String(f.seed)}
            onChange={(event) => {
              const digits = event.target.value.replace(/\D/gu, "");
              f.set({ seed: Math.min(SEED_MAX, Number(digits || "0")) });
            }}
            className="h-10 min-w-0 flex-1 rounded-xl bg-[var(--surface-2)] px-3 tabular-nums outline-none focus-visible:ring-2 focus-visible:ring-[var(--brand)]"
          />
          <IconButton
            label={st(lang, "create.seedRoll")}
            onClick={() => f.set({ seed: roll() })}
          >
            <Dices />
          </IconButton>
        </div>
      ) : null}
    </div>
  );
}

// ACE-Step only: how many sampling steps and how closely it follows the prompt.
function ExpertSection() {
  const lang = useLocale();
  const f = useCreateForm();
  const [open, setOpen] = useState(
    f.steps !== ACE_STEPS.default || f.guidance !== ACE_GUIDANCE.default,
  );
  return (
    <div className="space-y-4">
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen(!open)}
        className="flex items-center gap-1.5 rounded-lg text-[13px] font-medium outline-none focus-visible:ring-2 focus-visible:ring-[var(--brand)]"
      >
        <ChevronRight
          className={cn(
            "size-4 text-[var(--fg-muted)] transition-transform",
            open && "rotate-90",
          )}
        />
        {st(lang, "create.expert")}
      </button>
      {open ? (
        <>
          <p className="text-xs text-[var(--fg-subtle)]">
            {st(lang, "create.expertTip")}
          </p>
          <EditableSlider
            label={st(lang, "create.steps")}
            tip={st(lang, "create.stepsTip")}
            value={f.steps}
            min={ACE_STEPS.min}
            max={ACE_STEPS.max}
            onChange={(steps) => f.set({ steps })}
          />
          <EditableSlider
            label={st(lang, "create.guidance")}
            tip={st(lang, "create.guidanceTip")}
            value={f.guidance}
            min={ACE_GUIDANCE.min}
            max={ACE_GUIDANCE.max}
            step={ACE_GUIDANCE.step}
            onChange={(guidance) => f.set({ guidance })}
          />
        </>
      ) : null}
    </div>
  );
}

export function MoreOptionsCard() {
  const lang = useLocale();
  const f = useCreateForm();
  const controls = engineControls(useEngineChoice().engine);
  const varietyWord = st(lang, `variety.${f.variety}` as "variety.2");
  return (
    <PanelCard
      id="more"
      title={st(lang, "create.moreOptions")}
      open={f.open.more}
      onToggle={() => f.toggleCard("more")}
      actions={
        <IconButton
          label={st(lang, "create.resetOptions")}
          onClick={f.resetMore}
          className="bg-transparent hover:text-[var(--danger)]"
        >
          <Trash2 />
        </IconButton>
      }
    >
      <div className="space-y-4">
        {controls.tuning ? (
          <div className="relative">
            <label htmlFor="exclude" className="sr-only">
              {st(lang, "create.exclude")}
            </label>
            <input
              id="exclude"
              value={f.exclude}
              maxLength={LIMITS.exclude}
              onChange={(event) => f.set({ exclude: event.target.value })}
              placeholder={`${st(lang, "create.exclude")}: ${st(lang, "create.excludePlaceholder")}`}
              className="h-10 w-full rounded-xl bg-[var(--surface-2)] py-0 pr-11 pl-3 outline-none placeholder:text-[var(--fg-subtle)] focus-visible:ring-2 focus-visible:ring-[var(--brand)]"
            />
            <ClearButton
              field="exclude"
              className="absolute top-1 right-1 bg-transparent"
            />
          </div>
        ) : null}
        <Row
          label={st(lang, "create.vocalGender")}
          tip={st(lang, "create.vocalGenderTip")}
        >
          <Segmented
            label={st(lang, "create.vocalGender")}
            clearable
            value={f.vocalGender}
            onChange={(vocalGender) => f.set({ vocalGender })}
            options={[
              { value: "m", label: st(lang, "create.male") },
              { value: "f", label: st(lang, "create.female") },
            ]}
          />
        </Row>
        {controls.duration ? (
          <Row
            label={st(lang, "create.duration")}
            tip={st(lang, "create.durationTip")}
          >
            <Segmented
              label={st(lang, "create.duration")}
              value={f.durationMode}
              onChange={(durationMode) =>
                durationMode && f.set({ durationMode })
              }
              options={[
                { value: "custom", label: st(lang, "create.custom") },
                { value: "auto", label: st(lang, "create.auto") },
              ]}
            />
          </Row>
        ) : null}
        {controls.duration && f.durationMode === "custom" ? (
          <EditableSlider
            label={st(lang, "create.duration")}
            hideLabel
            value={f.duration}
            min={10}
            max={360}
            step={5}
            display={formatTime(f.duration)}
            parse={parseDuration}
            format={(seconds) => formatTime(seconds)}
            onChange={(duration) => f.set({ duration })}
          />
        ) : null}
        {controls.tuning ? (
          <>
            <EditableSlider
              label={st(lang, "create.weirdness")}
              value={f.weirdness}
              display={`${f.weirdness}%`}
              caption={st(
                lang,
                f.weirdness <= 50
                  ? "create.weirdnessLow"
                  : "create.weirdnessHigh",
              )}
              onChange={(weirdness) => f.set({ weirdness })}
            />
            <EditableSlider
              label={st(lang, "create.styleInfluence")}
              value={f.styleInfluence}
              display={`${f.styleInfluence}%`}
              caption={st(
                lang,
                f.styleInfluence < 35
                  ? "create.styleLow"
                  : f.styleInfluence <= 65
                    ? "create.styleMid"
                    : "create.styleHigh",
              )}
              onChange={(styleInfluence) => f.set({ styleInfluence })}
            />
            <EditableSlider
              label={st(lang, "create.variety")}
              value={f.variety}
              min={0}
              max={4}
              display={varietyWord}
              tip={st(lang, "create.varietyTip")}
              onChange={(variety) => f.set({ variety })}
            />
          </>
        ) : null}
        {controls.seed ? <SeedRow /> : null}
        {controls.expert ? <ExpertSection /> : null}
      </div>
    </PanelCard>
  );
}
