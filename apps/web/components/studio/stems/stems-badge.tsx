"use client";

import { cn } from "cn";
import { Layers, Loader2 } from "lucide-react";
import Link from "next/link";

import { useLocale } from "@/components/locale-provider";
import type { Clip } from "@/lib/studio/clips";
import { st, stf } from "@/lib/studio/i18n";
import { stemsHref } from "@/lib/studio/stems";
import { latestProgress, useJobEvents } from "@/lib/studio/use-job-progress";

const BASE =
  "inline-flex shrink-0 items-center gap-1 whitespace-nowrap rounded-full px-2 py-0.5 text-[10px] font-semibold tracking-wide tabular-nums outline-none focus-visible:ring-2 focus-visible:ring-[var(--brand)]";

function RunningText({ jobId }: { jobId: string }) {
  const lang = useLocale();
  const progress = latestProgress(useJobEvents(jobId, true), null)?.progress;
  return progress == null
    ? st(lang, "stems.title")
    : stf(lang, "stems.badgeRunning", { pct: String(Math.round(progress)) });
}

// The stems of a song on its card: on their way or failed, linking to the stems page. Ready
// stems show only where `done` is asked for (the details panel), to keep the cards quiet.
export function StemsBadge({
  clip,
  done = false,
}: {
  clip: Clip;
  done?: boolean;
}) {
  const lang = useLocale();
  const stems = clip.stems;
  if (!stems || clip.trashedAt) return null;
  if (stems.status === "done" && !done) return null;
  const tone =
    stems.status === "failed"
      ? "bg-[color-mix(in_oklab,var(--danger),transparent_82%)] text-[var(--danger)]"
      : stems.status === "done"
        ? "bg-[color-mix(in_oklab,var(--success),transparent_82%)] text-[var(--success)]"
        : "bg-[var(--surface-2)] text-[var(--fg-muted)] hover:text-[var(--fg)]";
  return (
    <Link
      href={stemsHref(clip.id)}
      title={st(lang, "stems.open")}
      className={cn(BASE, tone)}
    >
      {stems.status === "running" ? (
        <Loader2 className="size-3 animate-spin" />
      ) : (
        <Layers className="size-3" />
      )}
      {stems.status === "running" && stems.jobId ? (
        <RunningText jobId={stems.jobId} />
      ) : stems.status === "queued" ? (
        stems.queuePosition && stems.queuePosition > 1 ? (
          stf(lang, "stems.badgeQueued", { n: String(stems.queuePosition) })
        ) : (
          st(lang, "stems.badgeWaiting")
        )
      ) : stems.status === "failed" ? (
        st(lang, "stems.badgeFailed")
      ) : stems.status === "done" ? (
        st(lang, "stems.title")
      ) : (
        st(lang, "stems.running")
      )}
    </Link>
  );
}
