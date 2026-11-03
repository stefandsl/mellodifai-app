"use client";

import { aceStepStatusText, type SongEngine } from "@mellodifai/shared";
import { Check, ChevronDown } from "lucide-react";
import { useLocale } from "@/components/locale-provider";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { engineLabel } from "@/lib/studio/engines";
import { st } from "@/lib/studio/i18n";
import { useAceStepStatus } from "@/lib/studio/use-ace-step";

// Admin only: Suno through kie, or a local engine on the PC. The caller passes only the
// engines that can run right now.
export function EngineSelect({
  value,
  options,
  onChange,
}: {
  value: SongEngine;
  options: SongEngine[];
  onChange: (engine: SongEngine) => void;
}) {
  const lang = useLocale();
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        aria-label={`${st(lang, "create.engine")}: ${engineLabel(lang, value)}`}
        className="inline-flex h-7 max-w-full items-center gap-1 rounded-full bg-[var(--surface-2)] px-3 text-[13px] font-medium whitespace-nowrap outline-none hover:bg-[color-mix(in_oklab,var(--surface-2),var(--fg)_8%)] focus-visible:ring-2 focus-visible:ring-[var(--brand)]"
      >
        <span className="truncate">{engineLabel(lang, value)}</span>
        <ChevronDown className="size-3.5 shrink-0 text-[var(--fg-muted)]" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-72 rounded-2xl p-1.5">
        <DropdownMenuGroup>
          <DropdownMenuLabel className="px-3 text-[11px] tracking-wider text-[var(--fg-subtle)] uppercase">
            {st(lang, "create.engine")}
          </DropdownMenuLabel>
          {options.map((engine) => (
            <DropdownMenuItem
              key={engine}
              onClick={() => onChange(engine)}
              className="items-start gap-3 rounded-xl px-3 py-2"
            >
              <div className="min-w-0 flex-1">
                <div className="text-[13px] font-medium">
                  {engineLabel(lang, engine)}
                </div>
                <p className="text-xs text-[var(--fg-muted)]">
                  {st(lang, `engine.${engine}`)}
                </p>
              </div>
              {value === engine ? (
                <Check className="mt-0.5 size-4 text-[var(--brand)]" />
              ) : null}
            </DropdownMenuItem>
          ))}
        </DropdownMenuGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

// What native ACE-Step is doing on the PC (first-song setup, starting, ready), in plain words.
export function AceStepStatusLine() {
  const { status, online } = useAceStepStatus();
  return (
    <p
      role="status"
      data-testid="ace-step-status"
      className={
        status.state === "error" || !online
          ? "mt-2 text-xs text-[var(--danger)]"
          : "mt-2 text-xs text-[var(--fg-muted)]"
      }
    >
      {aceStepStatusText(status, online)}
    </p>
  );
}
