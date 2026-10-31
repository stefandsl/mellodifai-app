"use client";

import { Music2, X } from "lucide-react";
import { useEffect, useState } from "react";

import { useLocale } from "@/components/locale-provider";
import type { Clip } from "@/lib/studio/clips";
import { st } from "@/lib/studio/i18n";
import { CreatePanel } from "./create/create-panel";
import { WorkspaceFeed } from "./feed/workspace-feed";

// >= 900px: create panel beside the feed. Below: the feed is the page and the form opens
// as a full-height bottom sheet from a floating Create pill (brief section 1.1).
export function CreateLayout({ clips }: { clips: Clip[] }) {
  const lang = useLocale();
  const [sheet, setSheet] = useState(false);
  useEffect(() => {
    if (!sheet) return;
    const close = (event: KeyboardEvent) => {
      if (event.key === "Escape") setSheet(false);
    };
    window.addEventListener("keydown", close);
    return () => window.removeEventListener("keydown", close);
  }, [sheet]);
  return (
    <div className="flex h-full min-h-0">
      <div className="hidden h-full w-[420px] shrink-0 border-r border-[var(--hairline)] min-[900px]:block xl:w-[var(--create-w)]">
        <CreatePanel />
      </div>
      <div className="min-w-0 flex-1">
        <WorkspaceFeed clips={clips} />
      </div>
      <button
        type="button"
        onClick={() => setSheet(true)}
        className="bg-cta fixed bottom-[calc(var(--player-h)+16px)] left-1/2 z-30 inline-flex h-12 -translate-x-1/2 items-center gap-2 rounded-full px-6 text-[17px] font-medium text-white shadow-[0_10px_30px_-8px_var(--brand)] min-[900px]:hidden"
      >
        <Music2 className="size-5" />
        {st(lang, "create.open")}
      </button>
      {sheet ? (
        <div
          role="dialog"
          aria-modal="true"
          aria-label={st(lang, "create.submitLabel")}
          className="fixed inset-0 z-50 flex flex-col bg-black/50 min-[900px]:hidden"
        >
          <button
            type="button"
            aria-label={st(lang, "create.close")}
            onClick={() => setSheet(false)}
            className="h-8 shrink-0"
          />
          <div className="relative flex min-h-0 flex-1 flex-col rounded-t-3xl bg-[var(--bg)] pt-2">
            <span
              aria-hidden
              className="mx-auto mb-1 h-1 w-10 rounded-full bg-[var(--surface-2)]"
            />
            <button
              type="button"
              aria-label={st(lang, "create.close")}
              onClick={() => setSheet(false)}
              className="absolute top-3 right-3 z-10 inline-flex size-8 items-center justify-center rounded-full bg-[var(--surface-2)]"
            >
              <X className="size-4" />
            </button>
            <div className="min-h-0 flex-1">
              <CreatePanel onCreated={() => setSheet(false)} />
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
