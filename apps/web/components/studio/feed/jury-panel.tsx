"use client";

import { cn } from "cn";
import { Gavel } from "lucide-react";

import { useLocale } from "@/components/locale-provider";
import type { Jury } from "@/lib/studio/clips";
import { type StudioKey, st } from "@/lib/studio/i18n";

const CRITERIA = [
  "topic",
  "language",
  "singable",
  "chorus",
  "original",
] as const;

// "anthropic/claude-opus-5.5" -> "Opus 5.5"
export function modelName(id: string): string {
  const name = id.split("/").pop() ?? id;
  if (name.startsWith("jev")) return "Jev";
  return name
    .replace(/^claude-/u, "")
    .replace(/-(\d+)\.(\d+)$/u, " $1.$2")
    .replace(/-/gu, " ")
    .replace(/^\w/u, (c) => c.toUpperCase());
}

// The jury's verdict on the drafted lyrics: who wrote them, how many rounds, each score.
export function JuryPanel({
  jury,
  threshold = 0.7,
}: {
  jury: Jury;
  threshold?: number;
}) {
  const lang = useLocale();
  const judges = (jury.verdicts ?? []).filter((v) => !v.error).length;
  const rounds = jury.rounds ?? [];
  const writer = rounds.at(-1)?.writer;
  const rewrites = Math.max(0, rounds.length - 1);
  const tone = !jury.available
    ? "bg-[var(--surface-2)] text-[var(--fg-muted)]"
    : jury.passed
      ? "bg-[color-mix(in_oklab,var(--success),transparent_85%)] text-[var(--success)]"
      : "bg-[color-mix(in_oklab,var(--warning),transparent_82%)] text-[var(--warning)]";
  return (
    <section
      aria-label={st(lang, jury.passed ? "jury.passed" : "jury.failed")}
      className="rounded-2xl bg-[var(--bg)] p-3 ring-1 ring-[var(--hairline)]"
    >
      <div className="flex flex-wrap items-center gap-2 text-[13px]">
        <span
          className={cn(
            "inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 font-medium",
            tone,
          )}
        >
          <Gavel className="size-3.5" />
          {st(
            lang,
            !jury.available
              ? "jury.unavailable"
              : jury.passed
                ? "jury.passed"
                : "jury.failed",
          )}
        </span>
        {jury.available ? (
          <span className="text-[var(--fg-muted)]">
            {judges} {st(lang, "jury.judges")}
            {jury.ms ? ` · ${(jury.ms / 1000).toFixed(1)} s` : ""}
          </span>
        ) : null}
      </div>
      {writer ? (
        <p className="mt-2 text-xs text-[var(--fg-muted)]">
          {st(lang, "jury.writtenBy")}{" "}
          <span className="text-[var(--fg)]">{modelName(writer)}</span>
          {rewrites > 0
            ? ` · ${st(lang, "jury.revised")} ${rewrites} ${st(lang, rewrites === 1 ? "jury.once" : "jury.times")}`
            : ""}
        </p>
      ) : null}
      {jury.redacted ? (
        <p role="note" className="mt-2 text-xs text-[var(--warning)]">
          {st(lang, "jury.redacted")}
        </p>
      ) : null}
      {jury.available ? (
        <dl className="mt-3 grid grid-cols-5 gap-2">
          {CRITERIA.map((key) => {
            const score = jury.scores[key] ?? 0;
            const low = score < threshold;
            return (
              <div key={key} className="min-w-0">
                <dt className="truncate text-[11px] text-[var(--fg-muted)]">
                  {st(lang, `jury.${key}` as StudioKey)}
                </dt>
                <dd className="mt-1">
                  <span className="sr-only">{Math.round(score * 100)}%</span>
                  <span
                    aria-hidden
                    className="block h-1.5 overflow-hidden rounded-full bg-[var(--surface-2)]"
                  >
                    <span
                      className={cn(
                        "block h-full rounded-full",
                        low ? "bg-[var(--warning)]" : "bg-[var(--success)]",
                      )}
                      style={{ width: `${Math.round(score * 100)}%` }}
                    />
                  </span>
                  <span
                    aria-hidden
                    className={cn(
                      "mt-1 block text-[11px] tabular-nums",
                      low ? "text-[var(--warning)]" : "text-[var(--fg-subtle)]",
                    )}
                  >
                    {Math.round(score * 100)}
                  </span>
                </dd>
              </div>
            );
          })}
        </dl>
      ) : null}
    </section>
  );
}
