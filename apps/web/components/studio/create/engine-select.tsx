"use client";
import { aceStepStatusText, type SongEngine } from "@mellodifai/shared";
import { Cpu, Sparkles } from "lucide-react";
import { useLocale } from "@/components/locale-provider";
import { st } from "@/lib/studio/i18n";
import type { AceStepView } from "@/lib/studio/use-ace-step";
import { Segmented } from "../ui";

// Suno (kie credits) or ACE-Step on the PC (free). The free option is never a dead
// button: while the PC is off it explains why, and while the engine is being set up
// it says what is happening; the first song sets it up by itself.
export function EngineSelect({
  value,
  onChange,
  status,
}: {
  value: SongEngine;
  onChange: (engine: SongEngine) => void;
  status: AceStepView;
}) {
  const lang = useLocale();
  const text = aceStepStatusText(status.status, status.online);
  const offline = !status.online;
  return (
    <div className="mt-2 space-y-1.5">
      <Segmented
        size="sm"
        label={st(lang, "create.engine")}
        value={value}
        onChange={(engine) => engine && onChange(engine)}
        options={[
          {
            value: "kie",
            label: st(lang, "engine.kie"),
            icon: <Sparkles />,
          },
          {
            value: "ace-step",
            label: st(lang, "engine.aceStep"),
            icon: <Cpu />,
            ...(offline && value !== "ace-step" ? { soon: text } : {}),
          },
        ]}
      />
      {value === "ace-step" ? (
        <p
          role="status"
          data-testid="ace-step-status"
          className={
            status.status.state === "error" || offline
              ? "text-xs text-[var(--danger)]"
              : "text-xs text-[var(--fg-muted)]"
          }
        >
          {text}
        </p>
      ) : null}
    </div>
  );
}
