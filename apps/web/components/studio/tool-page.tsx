"use client";

import { ArrowLeft } from "lucide-react";
import { useRouter } from "next/navigation";
import type { ReactNode } from "react";

import { useLocale } from "@/components/locale-provider";
import type { Clip } from "@/lib/studio/clips";
import { st } from "@/lib/studio/i18n";

// The frame of a song tool page (stems, editor): Back, the song's cover and title, the tool's
// name and a line about it, then the tool itself.
export function ToolPage({
  clip,
  eyebrow,
  subtitle,
  children,
}: {
  clip: Clip;
  eyebrow: string;
  subtitle: string;
  children: ReactNode;
}) {
  const lang = useLocale();
  const router = useRouter();
  const title = clip.title || st(lang, "clip.untitled");
  return (
    <div className="h-full overflow-y-auto pb-24 scrollbar-thin min-[900px]:pb-6">
      <div className="mx-auto max-w-3xl px-4 py-6 sm:px-8 sm:py-10">
        <button
          type="button"
          onClick={() => {
            // Opened from inside the app: go back there. Opened from a link: the library.
            if (window.history.length > 1) router.back();
            else router.push("/library");
          }}
          className="-ml-2 inline-flex h-8 items-center gap-1.5 rounded-full px-2.5 text-[13px] font-medium text-[var(--fg-muted)] outline-none hover:bg-[var(--surface-glass-hover)] hover:text-[var(--fg)] focus-visible:ring-2 focus-visible:ring-[var(--brand)]"
        >
          <ArrowLeft className="size-4" />
          {st(lang, "stems.back")}
        </button>
        <header className="mt-4 flex items-center gap-4">
          <div
            aria-hidden
            className="size-16 shrink-0 rounded-xl shadow-lg ring-1 ring-[var(--hairline)] sm:size-20"
            style={{ background: clip.art }}
          />
          <div className="min-w-0">
            <p className="text-[11px] font-semibold tracking-[0.14em] text-[var(--brand)] uppercase">
              {eyebrow}
            </p>
            <h1 className="mt-0.5 truncate text-2xl font-medium tracking-tight sm:text-3xl">
              {title}
            </h1>
            <p className="mt-1 text-[13px] text-pretty text-[var(--fg-muted)]">
              {subtitle}
            </p>
          </div>
        </header>
        <div className="mt-6 space-y-4">{children}</div>
      </div>
    </div>
  );
}
