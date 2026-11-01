"use client";

import {
  BPM_RANGE,
  KEY_ROOTS,
  TIME_SIGNATURE_LABELS,
  TIME_SIGNATURES,
  type TimeSignature,
} from "@mellodifai/shared";
import { RotateCcw } from "lucide-react";
import { useId } from "react";

import { useLocale } from "@/components/locale-provider";
import { st } from "@/lib/studio/i18n";
import { useCreateForm } from "@/store/create-form";
import { EditableSlider, IconButton, PanelCard, Segmented } from "../ui";

// "D minor" shown as "D minore" in Italian; the stored value stays the engine's spelling.
export function keyLabel(lang: "it" | "en", key: string): string {
  const [root, quality] = key.split(" ");
  const word = quality === "major" ? "major" : "minor";
  return `${root} ${st(lang, word === "major" ? "create.major" : "create.minor")}`;
}

// Tempo, key and time signature. Auto (the default) leaves the choice to the engine; chosen
// values travel as style tags (kie, YuE2) or as text-encoder inputs (ACE-Step).
export function MusicCard() {
  const lang = useLocale();
  const keyId = useId();
  const f = useCreateForm();
  return (
    <PanelCard
      id="music"
      title={st(lang, "create.music")}
      open={f.open.music}
      onToggle={() => f.toggleCard("music")}
      actions={
        <IconButton
          label={st(lang, "create.musicReset")}
          onClick={f.resetMusic}
          className="bg-transparent"
        >
          <RotateCcw />
        </IconButton>
      }
    >
      <div className="space-y-4">
        <EditableSlider
          label={st(lang, "create.bpm")}
          tip={st(lang, "create.bpmTip")}
          value={f.bpm}
          min={BPM_RANGE.min}
          max={BPM_RANGE.max}
          autoAtMin={st(lang, "create.autoValue")}
          onChange={(bpm) => f.set({ bpm })}
        />
        <div className="flex items-center justify-between gap-3 text-[13px]">
          <label htmlFor={keyId} className="flex items-center gap-1.5">
            {st(lang, "create.key")}
          </label>
          <select
            id={keyId}
            value={f.keyscale}
            onChange={(event) => f.set({ keyscale: event.target.value })}
            className="h-9 max-w-44 rounded-xl bg-[var(--surface-2)] px-3 text-[13px] outline-none focus-visible:ring-2 focus-visible:ring-[var(--brand)]"
          >
            <option value="auto">{st(lang, "create.autoValue")}</option>
            {KEY_ROOTS.flatMap((root) =>
              (["major", "minor"] as const).map((quality) => (
                <option key={`${root} ${quality}`} value={`${root} ${quality}`}>
                  {keyLabel(lang, `${root} ${quality}`)}
                </option>
              )),
            )}
          </select>
        </div>
        <div className="flex items-center justify-between gap-3 text-[13px]">
          <span>{st(lang, "create.timeSignature")}</span>
          <Segmented<"auto" | TimeSignature>
            label={st(lang, "create.timeSignature")}
            value={f.timeSignature}
            onChange={(timeSignature) =>
              timeSignature && f.set({ timeSignature })
            }
            size="sm"
            options={[
              { value: "auto", label: st(lang, "create.autoValue") },
              ...TIME_SIGNATURES.map((value) => ({
                value,
                label: TIME_SIGNATURE_LABELS[value],
              })),
            ]}
          />
        </div>
      </div>
    </PanelCard>
  );
}
