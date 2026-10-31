"use client";

import { SONG_MODELS, type SongModel } from "@mellodifai/shared";
import { Check, ChevronDown } from "lucide-react";
import { useState } from "react";
import { useLocale } from "@/components/locale-provider";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { st } from "@/lib/studio/i18n";

const LATEST: SongModel[] = ["V6", "V6_WILD", "V6_MINI"];
const PRO: SongModel[] = ["V6", "V6_WILD"];

export function modelLabel(model: string): string {
  return model
    .toLowerCase()
    .replace("_", "-")
    .replace("4-5plus", "4.5+")
    .replace("v4-5", "v4.5");
}

export function ModelSelect({
  value,
  onChange,
}: {
  value: SongModel;
  onChange: (model: SongModel) => void;
}) {
  const lang = useLocale();
  const [older, setOlder] = useState(!LATEST.includes(value));
  const row = (model: SongModel) => (
    <DropdownMenuItem
      key={model}
      onClick={() => onChange(model)}
      className="items-start gap-3 rounded-xl px-3 py-2"
    >
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5 text-[13px] font-medium">
          {modelLabel(model)}
          {PRO.includes(model) ? (
            <span className="rounded-full bg-[color-mix(in_oklab,var(--brand),transparent_80%)] px-1.5 text-[10px] font-semibold text-[var(--brand)]">
              Pro
            </span>
          ) : null}
        </div>
        <p className="text-xs text-[var(--fg-muted)]">
          {st(lang, `model.${model}`)}
        </p>
      </div>
      {value === model ? (
        <Check className="mt-0.5 size-4 text-[var(--brand)]" />
      ) : null}
    </DropdownMenuItem>
  );
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        aria-label={`${st(lang, "create.model")}: ${modelLabel(value)}`}
        className="inline-flex h-7 items-center gap-1 rounded-full bg-[var(--surface-2)] px-3 text-[13px] font-medium outline-none hover:bg-[color-mix(in_oklab,var(--surface-2),var(--fg)_8%)] focus-visible:ring-2 focus-visible:ring-[var(--brand)]"
      >
        <span className="text-[var(--brand)]">{modelLabel(value)}</span>
        <ChevronDown className="size-3.5 text-[var(--fg-muted)]" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-72 rounded-2xl p-1.5">
        <DropdownMenuGroup>
          <DropdownMenuLabel className="px-3 text-[11px] tracking-wider text-[var(--fg-subtle)] uppercase">
            {st(lang, "create.model")}
          </DropdownMenuLabel>
          {LATEST.map(row)}
        </DropdownMenuGroup>
        <button
          type="button"
          onClick={() => setOlder(!older)}
          aria-expanded={older}
          className="mt-1 flex w-full items-center gap-1 rounded-lg px-3 py-1.5 text-xs text-[var(--fg-muted)] outline-none hover:text-[var(--fg)] focus-visible:ring-2 focus-visible:ring-[var(--brand)]"
        >
          <ChevronDown
            className={`size-3.5 transition-transform ${older ? "" : "-rotate-90"}`}
          />
          {st(lang, "create.olderModels")}
        </button>
        {older ? (
          <DropdownMenuGroup>
            {SONG_MODELS.filter((m) => !LATEST.includes(m)).map(row)}
          </DropdownMenuGroup>
        ) : null}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
