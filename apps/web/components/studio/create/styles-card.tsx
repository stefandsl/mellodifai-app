"use client";

import { cn } from "cn";
import { Library, RefreshCw, Wand2 } from "lucide-react";
import { useState } from "react";

import { useLocale } from "@/components/locale-provider";
import { st } from "@/lib/studio/i18n";
import { LIMITS, useCreateForm } from "@/store/create-form";
import { Counter, IconButton, PanelCard } from "../ui";
import { RotatingPlaceholder, STYLE_EXAMPLES } from "./rotating-placeholder";

const SEED_CHIPS = [
  "big room house",
  "808 beats",
  "call and response",
  "natural vocals",
  "bass-house",
  "rhythmic synth lines",
  "tech trance",
  "emo punk rock",
  "rhythm & blues",
  "low bass",
  "sharp snares",
  "sentimental",
  "tenor male vocals",
  "techno rock",
  "soft",
  "smooth jazz",
  "lo-fi",
  "spacey",
  "cinematic",
  "acoustic folk",
  "italo disco",
  "cantautorato",
] as const;

function parts(text: string): string[] {
  return text
    .split(",")
    .map((part) => part.trim().toLowerCase())
    .filter(Boolean);
}

export function StylesCard() {
  const lang = useLocale();
  const styles = useCreateForm((s) => s.styles);
  const open = useCreateForm((s) => s.open.styles);
  const set = useCreateForm((s) => s.set);
  const toggle = useCreateForm((s) => s.toggleCard);
  const [offset, setOffset] = useState(0);
  const chips = [...SEED_CHIPS.slice(offset), ...SEED_CHIPS.slice(0, offset)];
  const chosen = parts(styles);

  return (
    <PanelCard
      id="styles"
      title={st(lang, "create.styles")}
      open={open}
      onToggle={() => toggle("styles")}
      actions={
        <IconButton
          label={lang === "it" ? "Stili salvati" : "Saved styles"}
          soon={st(lang, "soon")}
          className="bg-transparent"
        >
          <Library />
        </IconButton>
      }
    >
      <div className="relative">
        <RotatingPlaceholder
          examples={STYLE_EXAMPLES}
          visible={!styles}
          className="inset-x-0.5 top-0 leading-6"
        />
        <textarea
          value={styles}
          aria-label={st(lang, "create.styles")}
          onChange={(event) => set({ styles: event.target.value })}
          className="relative block h-20 w-full resize-none bg-transparent px-0.5 leading-6 outline-none scrollbar-thin"
        />
        <div className="flex justify-end">
          <Counter value={styles.length} max={LIMITS.styles} />
        </div>
      </div>
      <div className="mt-2 flex items-center gap-1.5">
        <IconButton
          label={st(lang, "create.boostStyle")}
          soon={st(lang, "soon")}
          className="text-[var(--brand)]"
        >
          <Wand2 />
        </IconButton>
        <IconButton
          label={st(lang, "create.refreshStyles")}
          onClick={() => setOffset((offset + 6) % SEED_CHIPS.length)}
        >
          <RefreshCw />
        </IconButton>
        <div className="flex min-w-0 flex-1 gap-1.5 overflow-x-auto scrollbar-none [mask-image:linear-gradient(to_right,black_88%,transparent)]">
          {chips.map((chip) => {
            const selected = chosen.includes(chip.toLowerCase());
            return (
              <button
                key={chip}
                type="button"
                aria-label={`${st(lang, "create.addStyle")}: ${chip}`}
                aria-pressed={selected}
                onClick={() => {
                  if (selected) {
                    set({
                      styles: styles
                        .split(",")
                        .map((p) => p.trim())
                        .filter(
                          (p) => p && p.toLowerCase() !== chip.toLowerCase(),
                        )
                        .join(", "),
                    });
                  } else {
                    set({
                      styles: styles.trim()
                        ? `${styles.trim().replace(/,$/u, "")}, ${chip}`
                        : chip,
                    });
                  }
                }}
                className={cn(
                  "h-8 shrink-0 rounded-full px-3 text-[13px] whitespace-nowrap transition-colors outline-none focus-visible:ring-2 focus-visible:ring-[var(--brand)]",
                  selected
                    ? "bg-[color-mix(in_oklab,var(--brand),transparent_78%)] text-[var(--fg)] ring-1 ring-[color-mix(in_oklab,var(--brand),transparent_40%)]"
                    : "bg-[var(--surface-2)] text-[var(--fg-muted)] hover:text-[var(--fg)]",
                )}
              >
                + {chip}
              </button>
            );
          })}
        </div>
      </div>
    </PanelCard>
  );
}
