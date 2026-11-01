"use client";

import { cn } from "cn";
import { ThumbsDown, ThumbsUp } from "lucide-react";

import { useLocale } from "@/components/locale-provider";
import type { Reaction } from "@/lib/studio/clips";
import { st } from "@/lib/studio/i18n";
import { useReaction } from "@/lib/studio/use-reaction";

// Like and dislike for one song, shared by the feed card and the player bar.
export function ReactionButtons({
  id,
  initial,
  className,
  compact = false,
}: {
  id: string;
  initial: Reaction;
  className?: string;
  // Smaller buttons for a crowded card row.
  compact?: boolean;
}) {
  const lang = useLocale();
  const { reaction, toggle } = useReaction(id, initial);
  const base =
    "inline-flex shrink-0 items-center justify-center rounded-full text-[var(--fg-muted)] outline-none transition-colors hover:bg-[var(--surface-glass-hover)] hover:text-[var(--fg)] focus-visible:ring-2 focus-visible:ring-[var(--brand)]";
  return (
    <div className={cn("flex items-center", className)}>
      {(
        [
          ["like", ThumbsUp, "clip.like"],
          ["dislike", ThumbsDown, "clip.dislike"],
        ] as const
      ).map(([kind, Icon, key]) => (
        <button
          key={kind}
          type="button"
          aria-label={st(lang, key)}
          aria-pressed={reaction === kind}
          title={st(lang, key)}
          onClick={() => void toggle(kind)}
          className={cn(
            base,
            compact ? "size-7" : "size-8",
            reaction === kind &&
              "text-[var(--brand)] hover:text-[var(--brand)]",
          )}
        >
          <Icon className={cn("size-4", reaction === kind && "fill-current")} />
        </button>
      ))}
    </div>
  );
}
