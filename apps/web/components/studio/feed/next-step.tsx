"use client";

import { suggestTake, validateLyricPack } from "@mellodifai/shared";
import { cn } from "cn";
import {
  ArrowRight,
  Check,
  Clapperboard,
  Music2,
  Pause,
  Pencil,
  Play,
} from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { toast } from "sonner";

import {
  approveLyrics,
  keepAudio,
  makeVideo,
  pickTake,
} from "@/app/actions/checkpoints";
import { useLocale } from "@/components/locale-provider";
import { useSongEngine } from "@/components/studio/worker-state";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/components/ui/dialog";
import type { Clip } from "@/lib/studio/clips";
import { engineName, isLocal, minutesPhrase } from "@/lib/studio/engines";
import { st, stf } from "@/lib/studio/i18n";
import { usePlayer } from "@/store/player";
import { detailFor } from "./clip-detail";
import { JuryPanel } from "./jury-panel";

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
  const { engine, minutes } = useSongEngine(clip.settings);
  const local = isLocal(engine);
  // A local song costs no credits; the PC needs the minutes the worker reported.
  const costLine = !local
    ? st(lang, "next.approveCost")
    : minutes === null
      ? stf(lang, "next.approveCostLocalNoEstimate", {
          engine: engineName(engine),
        })
      : stf(lang, "next.approveCostLocal", {
          engine: engineName(engine),
          m: minutesPhrase(lang, minutes),
        });
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
          {clip.jury ? <JuryPanel jury={clip.jury} /> : null}
          <ol className="space-y-1.5 text-[13px] text-[var(--fg-muted)]">
            <li className="flex gap-2">
              <Music2 className="mt-0.5 size-3.5 shrink-0 text-[var(--brand)]" />
              {costLine}
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
              {pending
                ? st(lang, "next.approving")
                : st(lang, local ? "next.confirmLocal" : "next.confirm")}
            </button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function TakesDialog({
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
  // The suggestion follows the scores as they land until the owner picks a take by hand.
  const suggestion = suggestTake(
    clip.takes.map((take) => ({ id: take.id, scores: take.scores })),
  );
  const [picked, setPicked] = useState<string | null>(null);
  const chosen = picked ?? suggestion?.takeId ?? clip.takes[0]?.id ?? null;
  const current = usePlayer((s) => s.queue[s.index]?.id);
  const playing = usePlayer((s) => s.playing);
  const play = usePlayer((s) => s.play);
  const toggle = usePlayer((s) => s.toggle);
  const videoOff = clip.settings.video === "off";
  const run = (action: "audio" | "video") =>
    start(async () => {
      if (!chosen) return;
      const input = { versionId: clip.id, takeId: chosen };
      const result =
        action === "audio" ? await keepAudio(input) : await pickTake(input);
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      toast.success(
        st(lang, action === "audio" ? "next.audioKept" : "next.videoStarted"),
      );
      onOpenChange(false);
      router.refresh();
    });
  // The form's video choice decides which action is the primary one.
  const first = videoOff ? "audio" : "video";
  const second = videoOff ? "video" : "audio";
  const label = (action: "audio" | "video") =>
    st(lang, action === "audio" ? "next.keepAudio" : "next.makeVideo");
  const icon = (action: "audio" | "video") =>
    action === "audio" ? (
      <Music2 className="size-4" />
    ) : (
      <Clapperboard className="size-4" />
    );
  return (
    <Dialog open={open} onOpenChange={(next) => !pending && onOpenChange(next)}>
      <DialogContent className="gap-0 rounded-3xl bg-[var(--surface-1)] p-6 sm:max-w-lg">
        <DialogTitle className="text-lg font-medium">
          {st(lang, "next.pickTake")}
        </DialogTitle>
        <DialogDescription className="mt-1 text-[var(--fg-muted)]">
          {clip.title} · {clip.lang.toUpperCase()}
        </DialogDescription>
        <p className="mt-3 text-[13px] text-[var(--fg-muted)]">
          {st(lang, "next.takesHint")}
        </p>
        <div
          role="radiogroup"
          aria-label={st(lang, "next.pickTake")}
          className="mt-4 space-y-2"
        >
          {clip.takes.map((take) => {
            const id = `${clip.id}:take-${take.number}`;
            const isPlaying = current === id && playing;
            const selected = chosen === take.id;
            const name = `${st(lang, "next.take")} ${take.number}`;
            const suggested = suggestion?.takeId === take.id;
            const reason =
              suggestion?.reason === "fidelity" && take.scores
                ? `${st(lang, "next.heardWords")} ${Math.round(take.scores.fidelity * 100)}%`
                : st(lang, "next.wholeEnding");
            return (
              <div
                key={take.id}
                className={cn(
                  "flex items-center gap-3 rounded-2xl p-3 ring-1 transition-colors",
                  selected
                    ? "bg-[color-mix(in_oklab,var(--brand),transparent_88%)] ring-[color-mix(in_oklab,var(--brand),transparent_45%)]"
                    : "bg-[var(--bg)] ring-[var(--hairline)]",
                )}
              >
                <button
                  type="button"
                  disabled={!take.audioUrl}
                  aria-label={`${st(lang, isPlaying ? "clip.pause" : "clip.play")}: ${name}`}
                  onClick={() => {
                    if (current === id) return toggle();
                    if (!take.audioUrl) return;
                    play({
                      id,
                      title: `${clip.title} · ${name}`,
                      subtitle: clip.lang.toUpperCase(),
                      audioUrl: take.audioUrl,
                      videoUrl: null,
                      href: clip.href,
                      art: clip.art,
                      reaction: null,
                      detail: detailFor(clip, take.number),
                    });
                  }}
                  className="inline-flex size-11 shrink-0 items-center justify-center rounded-full bg-[var(--fg)] text-[var(--bg)] outline-none focus-visible:ring-2 focus-visible:ring-[var(--brand)] disabled:opacity-40"
                >
                  {isPlaying ? (
                    <Pause className="size-5 fill-current" />
                  ) : (
                    <Play className="size-5 translate-x-px fill-current" />
                  )}
                </button>
                {/* biome-ignore lint/a11y/useSemanticElements: a full-row selectable take, not a bare radio input. */}
                <button
                  type="button"
                  role="radio"
                  aria-checked={selected}
                  aria-label={
                    suggested ? `${name}, ${st(lang, "next.suggested")}` : name
                  }
                  onClick={() => setPicked(take.id)}
                  className="flex min-w-0 flex-1 items-center justify-between gap-3 self-stretch rounded-xl px-1 text-left outline-none focus-visible:ring-2 focus-visible:ring-[var(--brand)]"
                >
                  <span className="flex min-w-0 flex-col gap-1">
                    <span className="font-medium">{name}</span>
                    {suggested ? (
                      <span className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[12px] text-[var(--fg-muted)]">
                        <span className="rounded-full bg-[color-mix(in_oklab,var(--brand),transparent_85%)] px-2 py-0.5 font-medium text-[var(--brand)]">
                          {st(lang, "next.suggested")}
                        </span>
                        <span>{reason}</span>
                      </span>
                    ) : null}
                  </span>
                  <span
                    className={cn(
                      "inline-flex size-5 items-center justify-center rounded-full ring-2",
                      selected
                        ? "bg-[var(--brand)] text-white ring-[var(--brand)]"
                        : "ring-[var(--hairline)]",
                    )}
                  >
                    {selected ? (
                      <Check className="size-3" strokeWidth={3} />
                    ) : null}
                  </span>
                </button>
              </div>
            );
          })}
        </div>
        {videoOff ? (
          <p className="mt-4 text-[13px] text-[var(--fg-muted)]">
            {st(lang, "next.videoOff")}
          </p>
        ) : null}
        <div className="mt-6 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <button
            type="button"
            disabled={!chosen || pending}
            onClick={() => run(second)}
            className={cn(
              PILL,
              "h-11 justify-center bg-[var(--surface-2)] px-5 hover:bg-[color-mix(in_oklab,var(--surface-2),var(--fg)_10%)] disabled:opacity-50",
            )}
          >
            {icon(second)}
            {label(second)}
          </button>
          <button
            type="button"
            disabled={!chosen || pending}
            onClick={() => run(first)}
            className={cn(
              PRIMARY,
              "h-11 justify-center px-6 disabled:cursor-not-allowed disabled:opacity-60",
            )}
          >
            {icon(first)}
            {label(first)}
          </button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function MakeVideoButton({ clip }: { clip: Clip }) {
  const lang = useLocale();
  const router = useRouter();
  const [pending, start] = useTransition();
  return (
    <button
      type="button"
      disabled={pending}
      onClick={() =>
        start(async () => {
          const result = await makeVideo({ versionId: clip.id });
          if (!result.ok) {
            toast.error(result.error);
            return;
          }
          toast.success(st(lang, "next.videoStarted"));
          router.refresh();
        })
      }
      className={cn(
        PILL,
        "bg-[var(--surface-2)] hover:bg-[color-mix(in_oklab,var(--surface-2),var(--fg)_10%)] disabled:opacity-50",
      )}
    >
      <Clapperboard className="size-3.5 text-[var(--brand)]" />
      {st(lang, "next.makeVideo")}
    </button>
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
  if (clip.status === "takes_review" && clip.takes.length > 0)
    return (
      <>
        <button type="button" onClick={() => setOpen(true)} className={PRIMARY}>
          {st(lang, "next.pickTake")}
          <ArrowRight className="size-3.5" />
        </button>
        <TakesDialog clip={clip} open={open} onOpenChange={setOpen} />
      </>
    );
  if (clip.status === "audio_ready") return <MakeVideoButton clip={clip} />;
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
  return [
    "lyrics_review",
    "takes_review",
    "audio_ready",
    "video_review",
    "failed",
  ].includes(clip.status);
}
