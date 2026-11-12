"use client";

import { BPM_RANGE, TIME_SIGNATURE_LABELS } from "@mellodifai/shared";
import { cn } from "cn";
import { Loader2, RefreshCw, Sparkles } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import { formatStyle } from "@/app/actions/format-style";
import { useLocale } from "@/components/locale-provider";
import { st, stf } from "@/lib/studio/i18n";
import { LIMITS, useCreateForm } from "@/store/create-form";
import { Counter, IconButton, PanelCard } from "../ui";
import { ClearButton } from "./clear-field";
import { keyLabel } from "./music-card";
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

// "Formatta con AI": the styles become a music prompt, and BPM, key and time signature that are
// still on Auto are filled in. Undo puts everything back while the styles are untouched.
function AiFormatButton() {
  const lang = useLocale();
  const styles = useCreateForm((s) => s.styles);
  const [busy, setBusy] = useState(false);
  const empty = !styles.trim();

  async function run() {
    if (busy || empty) return;
    setBusy(true);
    try {
      const result = await formatStyle({ styles });
      if (!result.ok) {
        toast.error(
          st(
            lang,
            result.error === "noKey"
              ? "create.aiFormatNoKey"
              : result.error === "limit"
                ? "create.aiFormatLimit"
                : "create.aiFormatError",
          ),
        );
        return;
      }
      const form = useCreateForm.getState();
      const before = {
        styles: form.styles,
        bpm: form.bpm,
        keyscale: form.keyscale,
        timeSignature: form.timeSignature,
      };
      const patch: Partial<typeof before> = { styles: result.styles };
      const filled: string[] = [];
      if (result.bpm && form.bpm <= BPM_RANGE.min) {
        patch.bpm = result.bpm;
        filled.push(`BPM ${result.bpm}`);
      }
      if (result.keyscale && form.keyscale === "auto") {
        patch.keyscale = result.keyscale;
        filled.push(
          `${st(lang, "create.key")} ${keyLabel(lang, result.keyscale)}`,
        );
      }
      if (result.timeSignature && form.timeSignature === "auto") {
        patch.timeSignature = result.timeSignature;
        filled.push(
          `${st(lang, "create.timeSignature")} ${TIME_SIGNATURE_LABELS[result.timeSignature]}`,
        );
      }
      form.set(patch);
      toast.success(
        filled.length
          ? stf(lang, "create.aiFormatFilled", { fields: filled.join(", ") })
          : st(lang, "create.aiFormatDone"),
        {
          duration: 8000,
          action: {
            label: st(lang, "create.undo"),
            onClick: () => {
              if (useCreateForm.getState().styles === result.styles)
                useCreateForm.getState().set(before);
            },
          },
        },
      );
    } catch {
      toast.error(st(lang, "create.aiFormatError"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <IconButton
      label={st(lang, "create.aiFormat")}
      soon={empty ? st(lang, "create.aiFormatNeedStyles") : undefined}
      aria-busy={busy}
      disabled={busy}
      onClick={() => void run()}
      className="bg-transparent"
    >
      {busy ? <Loader2 className="animate-spin" /> : <Sparkles />}
    </IconButton>
  );
}

export function StylesCard() {
  const lang = useLocale();
  const styles = useCreateForm((s) => s.styles);
  const open = useCreateForm((s) => s.open.styles);
  const set = useCreateForm((s) => s.set);
  const toggle = useCreateForm((s) => s.toggleCard);
  const [offset, setOffset] = useState(0);
  const chips = [...SEED_CHIPS, ...SEED_CHIPS].slice(offset, offset + 6);
  const chosen = parts(styles);

  return (
    <PanelCard
      id="styles"
      title={st(lang, "create.styles")}
      open={open}
      onToggle={() => toggle("styles")}
      actions={
        <>
          <AiFormatButton />
          <ClearButton field="styles" />
        </>
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
          className="relative block h-20 w-full resize-none bg-transparent px-0.5 leading-6 outline-none focus-visible:ring-2 focus-visible:ring-[var(--brand)] scrollbar-thin"
        />
        <div className="flex justify-end">
          <Counter value={styles.length} max={LIMITS.styles} />
        </div>
      </div>
      <div className="mt-2 flex items-center gap-1.5">
        <IconButton
          label={st(lang, "create.refreshStyles")}
          onClick={() => setOffset((offset + 6) % SEED_CHIPS.length)}
        >
          <RefreshCw />
        </IconButton>
        <div className="flex min-w-0 flex-1 flex-wrap gap-1.5">
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
