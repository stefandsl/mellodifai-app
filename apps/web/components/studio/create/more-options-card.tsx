"use client";

import { Trash2 } from "lucide-react";

import { useLocale } from "@/components/locale-provider";
import { engineControls } from "@/lib/studio/engines";
import { st } from "@/lib/studio/i18n";
import { LIMITS, useCreateForm } from "@/store/create-form";
import { formatTime } from "@/store/player";
import { IconButton, InfoTip, PanelCard, Segmented, TickSlider } from "../ui";
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
          <div>
            <label htmlFor="exclude" className="sr-only">
              {st(lang, "create.exclude")}
            </label>
            <input
              id="exclude"
              value={f.exclude}
              maxLength={LIMITS.exclude}
              onChange={(event) => f.set({ exclude: event.target.value })}
              placeholder={`${st(lang, "create.exclude")}: ${st(lang, "create.excludePlaceholder")}`}
              className="h-10 w-full rounded-xl bg-[var(--surface-2)] px-3 outline-none placeholder:text-[var(--fg-subtle)] focus-visible:ring-2 focus-visible:ring-[var(--brand)]"
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
          <TickSlider
            label={st(lang, "create.duration")}
            hideLabel
            value={f.duration}
            min={10}
            max={360}
            step={5}
            display={formatTime(f.duration)}
            onChange={(duration) => f.set({ duration })}
          />
        ) : null}
        {controls.tuning ? (
          <>
            <TickSlider
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
            <TickSlider
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
            <TickSlider
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
      </div>
    </PanelCard>
  );
}
