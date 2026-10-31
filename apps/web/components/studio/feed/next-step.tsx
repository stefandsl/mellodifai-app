"use client";

import { validateLyricPack } from "@mellodifai/shared";
import { cn } from "cn";
import { ArrowRight, Check, Clapperboard, Music2, Pencil } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { toast } from "sonner";

import { approveLyrics } from "@/app/actions/checkpoints";
import { useLocale } from "@/components/locale-provider";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/components/ui/dialog";
import type { Clip } from "@/lib/studio/clips";
import { st } from "@/lib/studio/i18n";

const PILL =
  "inline-flex h-8 shrink-0 items-center gap-1.5 rounded-full px-3.5 text-[13px] font-medium whitespace-nowrap outline-none transition focus-visible:ring-2 focus-visible:ring-[var(--fg)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--bg)]";
const PRIMARY = `${PILL} bg-cta text-white shadow-[0_6px_20px_-10px_var(--brand)] hover:brightness-110`;

const TAG_LINE = /^\s*\[[^\]\n]*\]\s*$/u;

function ApproveDialog({
  clip,
  open,
  onOpenChange,
}: {
  clip: Clip;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const lang = useLocale();
  const router = useRouter();
  const [pending, start] = useTransition();
  const valid = validateLyricPack(clip.pack, "vbp").ok;
  const approve = () =>
    start(async () => {
      const result = await approveLyrics({
        versionId: clip.id,
        pack: clip.pack,
      });
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      toast.success(st(lang, "next.approved"));
      onOpenChange(false);
      router.refresh();
    });
  return (
    <Dialog open={open} onOpenChange={(next) => !pending && onOpenChange(next)}>
      <DialogContent className="flex max-h-[min(88dvh,760px)] flex-col gap-0 overflow-hidden rounded-3xl bg-[var(--surface-1)] p-0 sm:max-w-xl">
        <div className="shrink-0 px-6 pt-6 pb-4">
          <DialogTitle className="text-lg font-medium">
            {st(lang, "next.approveTitle")}
          </DialogTitle>
          <DialogDescription className="mt-1 text-[var(--fg-muted)]">
            {clip.title} · {clip.lang.toUpperCase()}
          </DialogDescription>
          {clip.style ? (
            <p className="mt-3 line-clamp-2 text-[13px] text-[var(--fg-muted)]">
              <span className="text-[var(--fg)]">
                {st(lang, "next.style")}:
              </span>{" "}
              {clip.style}
            </p>
          ) : null}
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto border-y border-[var(--hairline)] bg-[var(--bg)] px-6 py-4 leading-6 whitespace-pre-wrap scrollbar-thin">
          {clip.lyrics.split("\n").map((line, i) => (
            <span
              // biome-ignore lint/suspicious/noArrayIndexKey: lines are positional.
              key={i}
              className={cn(
                "block min-h-6",
                TAG_LINE.test(line) && "text-[13px] text-[var(--fg-subtle)]",
              )}
            >
              {line}
            </span>
          ))}
        </div>
        <div className="shrink-0 space-y-4 px-6 pt-4 pb-6">
          <ol className="space-y-1.5 text-[13px] text-[var(--fg-muted)]">
            <li className="flex gap-2">
              <Music2 className="mt-0.5 size-3.5 shrink-0 text-[var(--brand)]" />
              {st(lang, "next.approveCost")}
            </li>
            <li className="flex gap-2">
              <Clapperboard className="mt-0.5 size-3.5 shrink-0 text-[var(--brand)]" />
              {st(lang, "next.approveFlow")}
            </li>
          </ol>
          {valid ? null : (
            <p role="alert" className="text-[13px] text-[var(--danger)]">
              {st(lang, "next.invalid")}
            </p>
          )}
          <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <Link
              href={clip.href}
              className={cn(
                PILL,
                "h-11 justify-center bg-[var(--surface-2)] px-5 hover:bg-[color-mix(in_oklab,var(--surface-2),var(--fg)_10%)]",
              )}
            >
              <Pencil className="size-4" />
              {st(lang, "next.edit")}
            </Link>
            <button
              type="button"
              disabled={!valid || pending}
              onClick={approve}
              className={cn(
                PRIMARY,
                "h-11 justify-center px-6 disabled:cursor-not-allowed disabled:bg-none disabled:bg-[var(--surface-2)] disabled:text-[var(--fg-subtle)] disabled:shadow-none",
              )}
            >
              <Check className="size-4" />
              {pending ? st(lang, "next.approving") : st(lang, "next.confirm")}
            </button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// The one thing the song is waiting for, as a button on its card.
export function NextStep({ clip }: { clip: Clip }) {
  const lang = useLocale();
  const [open, setOpen] = useState(false);
  if (clip.status === "lyrics_review")
    return (
      <>
        <button type="button" onClick={() => setOpen(true)} className={PRIMARY}>
          <Check className="size-3.5" />
          {st(lang, "next.approve")}
        </button>
        <ApproveDialog clip={clip} open={open} onOpenChange={setOpen} />
      </>
    );
  const link =
    clip.status === "takes_review"
      ? st(lang, "next.pickTake")
      : clip.status === "video_review"
        ? st(lang, "next.reviewVideo")
        : clip.status === "failed"
          ? st(lang, "next.seeError")
          : null;
  if (!link) return null;
  return (
    <Link
      href={clip.href}
      className={
        clip.status === "failed"
          ? cn(
              PILL,
              "bg-[color-mix(in_oklab,var(--danger),transparent_82%)] text-[var(--danger)]",
            )
          : PRIMARY
      }
    >
      {link}
      <ArrowRight className="size-3.5" />
    </Link>
  );
}

export function hasNextStep(clip: Clip): boolean {
  return ["lyrics_review", "takes_review", "video_review", "failed"].includes(
    clip.status,
  );
}
