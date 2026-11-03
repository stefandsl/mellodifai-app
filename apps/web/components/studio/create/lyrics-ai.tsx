"use client";

import {
  type LyricsAssistMode,
  type LyricsAssistResult,
  sectionAt,
} from "@mellodifai/shared";
import { cn } from "cn";
import { Loader2, RefreshCw, Sparkles, Square, Wand2 } from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";
import { toast } from "sonner";

import {
  cancelLyricsAssist,
  readLyricsAssistState,
  requestLyricsAssist,
} from "@/app/actions/lyrics-assist";
import { useLocale } from "@/components/locale-provider";
import { type StudioKey, st, stf } from "@/lib/studio/i18n";
import { useCreateForm } from "@/store/create-form";
import { Tip } from "../ui";

const POLL_MS = 1200;
const BUTTON =
  "inline-flex h-7 items-center gap-1 rounded-full bg-[var(--surface-2)] px-2.5 text-xs font-medium text-[var(--fg-muted)] outline-none hover:bg-[color-mix(in_oklab,var(--surface-2),var(--fg)_8%)] hover:text-[var(--fg)] focus-visible:ring-2 focus-visible:ring-[var(--brand)] disabled:cursor-not-allowed disabled:opacity-45 disabled:hover:bg-[var(--surface-2)] disabled:hover:text-[var(--fg-muted)]";

type State = {
  status: "queued" | "running" | "done" | "failed" | "cancelled" | null;
  progress: number | null;
  message: string | null;
  queuePosition: number | null;
  result: LyricsAssistResult | null;
  errorCode: "privacy_filter" | "limit" | "failed" | null;
};

// The create panel's AI lyric buttons: one lyrics_assist job per click on the worker's lyric
// pipeline (task 27). The result replaces the text, with Undo in the toast.
export function LyricsAi({
  caret,
  onBusy,
}: {
  // Where the cursor is in the lyrics box (null when it never was), for "Rigenera sezione".
  caret: number | null;
  onBusy: (busy: boolean) => void;
}) {
  const lang = useLocale();
  const lyrics = useCreateForm((s) => s.lyrics);
  const [request, setRequest] = useState<{
    id: string;
    mode: LyricsAssistMode;
  } | null>(null);
  const [state, setState] = useState<State | null>(null);
  const [briefOpen, setBriefOpen] = useState(false);
  const [brief, setBrief] = useState("");
  const [sending, setSending] = useState(false);
  const briefId = useId();
  const before = useRef<{ lyrics: string; title: string } | null>(null);
  const empty = !lyrics.trim();
  const section = empty || caret === null ? null : sectionAt(lyrics, caret);
  const busy = sending || Boolean(request);

  useEffect(() => onBusy(busy), [busy, onBusy]);

  // Follows the request until it is done, failed or cancelled. `apply` reads the store when the
  // result arrives, so it does not need to restart the poll.
  // biome-ignore lint/correctness/useExhaustiveDependencies: see the comment above.
  useEffect(() => {
    if (!request) return;
    let alive = true;
    const poll = async () => {
      const result = await readLyricsAssistState(request.id);
      const data = result.ok ? result.data : null;
      if (!alive || !data) return;
      const next = data as State;
      setState(next);
      if (next.status === "done" && next.result) {
        alive = false;
        setRequest(null);
        apply(next.result, request.mode);
      } else if (next.status === "failed" || next.status === "cancelled") {
        alive = false;
        setRequest(null);
        if (next.status === "failed")
          toast.error(
            st(
              lang,
              next.errorCode === "privacy_filter"
                ? "assist.privacy"
                : next.errorCode === "limit"
                  ? "assist.limit"
                  : "assist.failed",
            ),
            next.errorCode === "privacy_filter"
              ? {
                  duration: 12_000,
                  action: {
                    label: st(lang, "remake.openrouterSettings"),
                    onClick: () =>
                      window.open(
                        "https://openrouter.ai/settings/privacy",
                        "_blank",
                        "noopener",
                      ),
                  },
                }
              : undefined,
          );
      }
    };
    void poll();
    const timer = setInterval(() => {
      if (alive) void poll();
    }, POLL_MS);
    return () => {
      alive = false;
      clearInterval(timer);
    };
  }, [request, lang]);

  function apply(result: LyricsAssistResult, mode: LyricsAssistMode) {
    const form = useCreateForm.getState();
    const previous = before.current ?? {
      lyrics: form.lyrics,
      title: form.title,
    };
    const patch: { lyrics: string; title?: string } = {
      lyrics: result.lyrics.slice(0, 5000),
    };
    if (mode === "write" && result.title && !form.title.trim())
      patch.title = result.title.slice(0, 80);
    form.set(patch);
    const scores = Object.values(result.jury.scores);
    const low = scores.length ? Math.min(...scores) : null;
    toast.success(st(lang, "assist.done"), {
      duration: 10_000,
      description: !result.jury.available
        ? undefined
        : result.jury.passed
          ? low === null
            ? undefined
            : stf(lang, "assist.juryScore", { s: low.toFixed(2) })
          : st(lang, "assist.juryFailed"),
      action: {
        label: st(lang, "assist.undo"),
        onClick: () => {
          const now = useCreateForm.getState();
          if (now.lyrics === patch.lyrics)
            now.set({
              lyrics: previous.lyrics,
              ...(patch.title !== undefined ? { title: previous.title } : {}),
            });
        },
      },
    });
  }

  async function run(mode: LyricsAssistMode, briefText = "") {
    if (busy) return;
    const form = useCreateForm.getState();
    const target = form.languages[0] ?? lang;
    const range =
      mode === "regenerate" && section
        ? { start: section.start, end: section.end }
        : null;
    setSending(true);
    try {
      const result = await requestLyricsAssist({
        mode,
        lang: target,
        title: form.title.slice(0, 100),
        brief: (briefText || form.prompt).slice(0, 500),
        style: form.styles.slice(0, 1000),
        lyrics: mode === "write" ? "" : form.lyrics,
        section: range,
        vocalGender: form.vocalGender,
      });
      if (!result.ok) {
        toast.error(st(lang, `assist.${result.error}` as StudioKey));
        return;
      }
      before.current = { lyrics: form.lyrics, title: form.title };
      setState(null);
      setBriefOpen(false);
      if ("committed" in result) return;
      setRequest({ id: result.id, mode });
    } finally {
      setSending(false);
    }
  }

  const status = request
    ? state?.status === "queued" && (state.queuePosition ?? 0) > 1
      ? stf(lang, "assist.queued", { n: String(state.queuePosition) })
      : ((state?.message
          ? st(lang, `assist.step.${state.message}` as StudioKey)
          : null) ?? st(lang, "assist.working"))
    : null;

  if (request)
    return (
      <div className="flex min-w-0 items-center gap-2">
        <p
          role="status"
          className="flex min-w-0 items-center gap-1.5 text-xs text-[var(--fg-muted)]"
        >
          <Loader2 className="size-3.5 shrink-0 animate-spin text-[var(--brand)]" />
          <span className="truncate">{status}</span>
        </p>
        <button
          type="button"
          onClick={() => void cancelLyricsAssist(request.id)}
          className={cn(BUTTON, "px-2")}
        >
          <Square className="size-3" />
          {st(lang, "assist.stop")}
        </button>
      </div>
    );

  return (
    <div className="min-w-0 flex-1">
      {briefOpen ? (
        // Not a <form>: the lyrics box sits inside the create panel's form.
        <div className="mb-2 space-y-2 rounded-xl bg-[var(--surface-2)] p-2.5">
          <label htmlFor={briefId} className="block text-xs font-medium">
            {st(lang, "assist.briefLabel")}
          </label>
          <textarea
            id={briefId}
            // biome-ignore lint/a11y/noAutofocus: the person just opened this field.
            autoFocus
            rows={2}
            maxLength={500}
            value={brief}
            placeholder={st(lang, "assist.briefPlaceholder")}
            onChange={(event) => setBrief(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter" && !event.shiftKey) {
                event.preventDefault();
                void run("write", brief.trim());
              } else if (event.key === "Escape") setBriefOpen(false);
            }}
            className="block w-full resize-none rounded-lg bg-[var(--bg)] px-2.5 py-1.5 text-[13px] leading-5 outline-none placeholder:text-[var(--fg-subtle)] focus-visible:ring-2 focus-visible:ring-[var(--brand)]"
          />
          <div className="flex justify-end gap-1.5">
            <button
              type="button"
              onClick={() => setBriefOpen(false)}
              className={BUTTON}
            >
              {st(lang, "remake.cancel")}
            </button>
            <button
              type="button"
              onClick={() => void run("write", brief.trim())}
              disabled={
                sending ||
                !(
                  brief.trim() ||
                  useCreateForm.getState().title.trim() ||
                  useCreateForm.getState().styles.trim()
                )
              }
              className={cn(
                BUTTON,
                "bg-[var(--fg)] text-[var(--bg)] hover:bg-[var(--fg)] hover:text-[var(--bg)] hover:opacity-90",
              )}
            >
              {sending ? <Loader2 className="size-3 animate-spin" /> : null}
              {st(lang, "assist.go")}
            </button>
          </div>
        </div>
      ) : null}
      <div className="flex flex-wrap items-center gap-1.5">
        <Tip label={st(lang, "assist.writeTip")}>
          <button
            type="button"
            disabled={busy}
            aria-expanded={briefOpen}
            onClick={() => {
              setBrief(useCreateForm.getState().prompt);
              setBriefOpen(!briefOpen);
            }}
            className={cn(BUTTON, "text-[var(--fg)]")}
          >
            <Sparkles className="size-3.5 text-[var(--brand)]" />
            {st(lang, "assist.write")}
          </button>
        </Tip>
        <Tip
          label={
            empty
              ? st(lang, "assist.needLyrics")
              : st(lang, "assist.regenerateTip")
          }
        >
          <button
            type="button"
            disabled={busy || empty}
            onClick={() => void run("regenerate")}
            className={BUTTON}
          >
            <RefreshCw className="size-3.5" />
            {section
              ? `${st(lang, "assist.regenerate")} [${section.label}]`
              : st(lang, "assist.regenerate")}
          </button>
        </Tip>
        <Tip
          label={
            empty
              ? st(lang, "assist.needLyrics")
              : st(lang, "assist.improveTip")
          }
        >
          <button
            type="button"
            disabled={busy || empty}
            onClick={() => void run("improve")}
            className={BUTTON}
          >
            <Wand2 className="size-3.5" />
            {st(lang, "assist.improve")}
          </button>
        </Tip>
      </div>
    </div>
  );
}
