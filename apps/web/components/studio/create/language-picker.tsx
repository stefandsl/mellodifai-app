"use client";

import { LANGS, type Lang } from "@mellodifai/shared";
import { Languages } from "lucide-react";
import { useLocale } from "@/components/locale-provider";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { st } from "@/lib/studio/i18n";

export function languageName(code: string, ui: "it" | "en"): string {
  const name =
    new Intl.DisplayNames([ui], { type: "language" }).of(code) ?? code;
  return name.charAt(0).toUpperCase() + name.slice(1);
}

export function LanguagePicker({
  value,
  onChange,
}: {
  value: Lang[];
  onChange: (languages: Lang[]) => void;
}) {
  const lang = useLocale();
  const summary =
    value.length === 0
      ? "-"
      : value.length <= 3
        ? value.map((code) => code.toUpperCase()).join(" ")
        : `${value
            .slice(0, 2)
            .map((c) => c.toUpperCase())
            .join(" ")} +${value.length - 2}`;
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        aria-label={`${st(lang, "create.languages")}: ${value.map((code) => languageName(code, lang)).join(", ")}`}
        className="inline-flex h-7 items-center gap-1.5 rounded-full bg-[var(--surface-2)] px-3 text-[13px] font-medium outline-none hover:bg-[color-mix(in_oklab,var(--surface-2),var(--fg)_8%)] focus-visible:ring-2 focus-visible:ring-[var(--brand)]"
      >
        <Languages className="size-3.5 text-[var(--fg-muted)]" />
        <span className="tabular-nums">{summary}</span>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-60 rounded-2xl p-1.5">
        <DropdownMenuGroup>
          <DropdownMenuLabel className="px-3 text-xs font-normal text-[var(--fg-muted)]">
            {st(lang, "create.languagesHint")}
          </DropdownMenuLabel>
          {LANGS.map((code) => {
            const checked = value.includes(code);
            return (
              <DropdownMenuCheckboxItem
                key={code}
                checked={checked}
                closeOnClick={false}
                onCheckedChange={(next) =>
                  onChange(
                    next
                      ? LANGS.filter((c) => c === code || value.includes(c))
                      : value.filter((c) => c !== code),
                  )
                }
                className="rounded-lg"
              >
                <span className="w-7 font-mono text-xs text-[var(--fg-subtle)]">
                  {code.toUpperCase()}
                </span>
                {languageName(code, lang)}
              </DropdownMenuCheckboxItem>
            );
          })}
        </DropdownMenuGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
