"use client";

import {
  acceptBlockers,
  BPM_RANGE,
  LANGS,
  type Lang,
  latestJury,
  REMAKE_COUNTRIES,
  REMAKE_JURY_KEYS,
  type RemakeLyrics,
  type RewrittenLine,
  SONG_KEYS,
  TIME_SIGNATURES,
  youtubeVideoId,
} from "@mellodifai/shared";
import { cn } from "cn";
import {
  AlertTriangle,
  ArrowRight,
  Check,
  ExternalLink,
  Link2,
  Loader2,
  Pencil,
  RefreshCw,
  X,
} from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useId, useMemo, useState, useTransition } from "react";
import { toast } from "sonner";

import {
  acceptRemake,
  cancelRemake,
  dismissRemake,
  editRemake,
  type RemakeActionResult,
  regenerateRemakeSection,
  retryRemake,
  startRemake,
} from "@/app/actions/remake";
import { useLocale } from "@/components/locale-provider";
import { kieCredits } from "@/lib/studio/engines";
import { type StudioKey, st, stf } from "@/lib/studio/i18n";
import { type RemakeView, useRemake } from "@/lib/studio/use-remake";
import { useCreateForm } from "@/store/create-form";
import { useVideoStudio } from "@/store/video-studio";
import { PanelCard, Tip } from "../ui";
import { payloadFor } from "./create-panel";
import { languageName } from "./language-picker";
import { useEngineChoice } from "./use-engine";

const PRIVACY_URL = "https://openrouter.ai/settings/privacy";
const PILL =
  "inline-flex h-8 items-center gap-1.5 rounded-full px-3 text-[13px] font-medium outline-none focus-visible:ring-2 focus-visible:ring-[var(--brand)] disabled:cursor-not-allowed disabled:opacity-50";
const FIELD =
  "h-9 rounded-xl bg-[var(--surface-2)] px-3 text-[13px] outline-none focus-visible:ring-2 focus-visible:ring-[var(--brand)]";

function clock(seconds: number) {
  const s = Math.max(0, Math.round(seconds));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

function errorText(lang: "it" | "en", result: RemakeActionResult) {
  return result.ok ? "" : st(lang, `remake.${result.error}` as StudioKey);
}

function useAct(refresh: () => Promise<void>) {
  const lang = useLocale();
  const [pending, start] = useTransition();
  const act = (
    work: () => Promise<RemakeActionResult>,
    done?: (result: RemakeActionResult & { ok: true }) => void,
  ) =>
    start(async () => {
      const result = await work();
      if (!result.ok) toast.error(errorText(lang, result));
      else done?.(result);
      await refresh();
    });
  return { pending, act };
}

// --- Start ------------------------------------------------------------------------------------

function StartForm({ onStarted }: { onStarted: () => Promise<void> }) {
  const lang = useLocale();
  const languages = useCreateForm((s) => s.languages);
  const [url, setUrl] = useState("");
  const [target, setTarget] = useState<Lang>(languages[0] ?? lang);
  const [country, setCountry] = useState<string>("");
  const [invalid, setInvalid] = useState(false);
  const { pending, act } = useAct(onStarted);
  const urlId = useId();
  const langId = useId();
  const countryId = useId();
  const countryNames = useMemo(
    () => new Intl.DisplayNames([lang], { type: "region" }),
    [lang],
  );
  const submit = () => {
    if (pending) return;
    if (!youtubeVideoId(url)) {
      setInvalid(true);
      return;
    }
    act(
      () =>
        startRemake({
          url: url.trim(),
          lang: target,
          country: country || null,
        }),
      () => setUrl(""),
    );
  };
  return (
    <div className="space-y-2.5">
      <p className="text-[13px] leading-5 text-[var(--fg-muted)]">
        {st(lang, "remake.hint")}
      </p>
      <div
        className={cn(
          "flex h-10 items-center gap-2 rounded-xl bg-[var(--surface-2)] px-3 focus-within:ring-2 focus-within:ring-[var(--brand)]",
          invalid && "ring-2 ring-[var(--danger)]",
        )}
      >
        <Link2 className="size-4 shrink-0 text-[var(--fg-muted)]" />
        <label htmlFor={urlId} className="sr-only">
          {st(lang, "remake.url")}
        </label>
        <input
          id={urlId}
          value={url}
          inputMode="url"
          autoComplete="off"
          spellCheck={false}
          placeholder={st(lang, "remake.urlPlaceholder")}
          aria-invalid={invalid}
          aria-describedby={invalid ? `${urlId}-error` : undefined}
          onChange={(event) => {
            setUrl(event.target.value);
            setInvalid(false);
          }}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              submit();
            }
          }}
          className="h-full min-w-0 flex-1 bg-transparent text-[13px] outline-none placeholder:text-[var(--fg-subtle)]"
        />
      </div>
      {invalid ? (
        <p
          id={`${urlId}-error`}
          role="alert"
          className="text-xs text-[var(--danger)]"
        >
          {st(lang, "remake.invalidUrl")}
        </p>
      ) : null}
      <div className="flex flex-wrap items-center gap-2">
        <label htmlFor={langId} className="sr-only">
          {st(lang, "remake.lang")}
        </label>
        <select
          id={langId}
          value={target}
          title={st(lang, "remake.lang")}
          onChange={(event) => setTarget(event.target.value as Lang)}
          className={cn(FIELD, "min-w-0 flex-1")}
        >
          {LANGS.map((code) => (
            <option key={code} value={code}>
              {languageName(code, lang)}
            </option>
          ))}
        </select>
        <label htmlFor={countryId} className="sr-only">
          {st(lang, "remake.country")}
        </label>
        <Tip label={st(lang, "remake.countryHint")}>
          <select
            id={countryId}
            value={country}
            onChange={(event) => setCountry(event.target.value)}
            className={cn(FIELD, "min-w-0 flex-1")}
          >
            <option value="">{st(lang, "remake.noCountry")}</option>
            {REMAKE_COUNTRIES.map((code) => (
              <option key={code} value={code}>
                {countryNames.of(code) ?? code}
              </option>
            ))}
          </select>
        </Tip>
        <button
          type="button"
          onClick={submit}
          disabled={pending || !url.trim()}
          className={cn(
            PILL,
            "h-9 bg-[var(--fg)] px-4 text-[var(--bg)] hover:opacity-90",
          )}
        >
          {pending ? <Loader2 className="size-3.5 animate-spin" /> : null}
          {pending ? st(lang, "remake.starting") : st(lang, "remake.start")}
        </button>
      </div>
    </div>
  );
}

// --- Progress ---------------------------------------------------------------------------------

const STEPS = ["ingest", "analyse", "rewrite", "review"] as const;

// Progress messages are step keys (apps/worker/src/stages/remake.ts); anything else is not shown.
function stepText(lang: "it" | "en", message: string | null): string | null {
  if (!message) return null;
  return st(lang, `remake.step.${message}` as StudioKey) ?? null;
}

function Progress({
  view,
  onChange,
}: {
  view: RemakeView;
  onChange: () => Promise<void>;
}) {
  const lang = useLocale();
  const { pending, act } = useAct(onChange);
  const at = STEPS.indexOf(view.stage as (typeof STEPS)[number]);
  const job = view.job;
  const queued = job?.status === "queued";
  const pct = Math.max(2, Math.min(100, Number(job?.progress ?? 0)));
  const detail = queued
    ? job?.queuePosition && job.queuePosition > 1
      ? stf(lang, "remake.queue", { n: String(job.queuePosition) })
      : st(lang, "remake.waiting")
    : (stepText(lang, job?.message ?? null) ?? "");
  return (
    <div className="space-y-3">
      <SourceLine view={view} />
      <ol
        className="grid grid-cols-4 gap-1.5"
        aria-label={st(lang, "remake.title")}
      >
        {STEPS.map((step, i) => (
          <li
            key={step}
            aria-current={i === at ? "step" : undefined}
            className="space-y-1.5"
          >
            <span
              className={cn(
                "block h-1 rounded-full",
                i < at
                  ? "bg-[var(--fg)]"
                  : i === at
                    ? "bg-[color-mix(in_oklab,var(--brand),transparent_20%)]"
                    : "bg-[var(--surface-2)]",
              )}
            />
            <span
              className={cn(
                "block truncate text-[11px]",
                i === at ? "text-[var(--fg)]" : "text-[var(--fg-subtle)]",
              )}
            >
              {st(lang, `remake.stage.${step}` as StudioKey)}
            </span>
          </li>
        ))}
      </ol>
      <div
        role="progressbar"
        aria-label={st(lang, `remake.stage.${view.stage}` as StudioKey)}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={queued ? 0 : Math.round(pct)}
        aria-valuetext={detail}
        className="h-1.5 overflow-hidden rounded-full bg-[var(--surface-2)]"
      >
        <div
          className={cn(
            "h-full rounded-full bg-cta transition-[width] duration-700",
            queued && "w-1/4 animate-pulse",
          )}
          style={queued ? undefined : { width: `${pct}%` }}
        />
      </div>
      <div className="flex items-center justify-between gap-2">
        <p
          role="status"
          className="flex min-w-0 items-center gap-1.5 truncate text-xs text-[var(--fg-muted)]"
        >
          <Loader2 className="size-3.5 shrink-0 animate-spin" />
          <span className="truncate">{detail}</span>
        </p>
        <button
          type="button"
          disabled={pending}
          onClick={() =>
            act(
              () => cancelRemake({ remakeId: view.id }),
              () => toast.success(st(lang, "remake.cancelled")),
            )
          }
          className={cn(
            PILL,
            "h-7 shrink-0 bg-[var(--surface-2)] text-[var(--fg-muted)] hover:text-[var(--fg)]",
          )}
        >
          {st(lang, "remake.cancel")}
        </button>
      </div>
    </div>
  );
}

function SourceLine({ view }: { view: RemakeView }) {
  const lang = useLocale();
  const title = view.source?.title ?? view.analysis?.title;
  return (
    <a
      href={`https://www.youtube.com/watch?v=${view.videoId}`}
      target="_blank"
      rel="noreferrer noopener"
      className="group flex min-w-0 items-center gap-1.5 text-xs text-[var(--fg-muted)] outline-none hover:text-[var(--fg)] focus-visible:ring-2 focus-visible:ring-[var(--brand)]"
    >
      <span className="shrink-0 text-[var(--fg-subtle)]">
        {st(lang, "remake.source")}:
      </span>
      <span className="truncate">{title ?? view.videoId}</span>
      <ExternalLink className="size-3 shrink-0 opacity-60 group-hover:opacity-100" />
      <span className="ml-auto shrink-0 rounded-full bg-[var(--surface-2)] px-2 py-0.5 font-mono text-[10px] text-[var(--fg-muted)]">
        {view.lang.toUpperCase()}
        {view.country ? ` · ${view.country}` : ""}
      </span>
    </a>
  );
}

// --- Failure ----------------------------------------------------------------------------------

function Failure({
  view,
  onChange,
}: {
  view: RemakeView;
  onChange: () => Promise<void>;
}) {
  const lang = useLocale();
  const { pending, act } = useAct(onChange);
  const code = view.errorCode ?? "failed";
  return (
    <div className="space-y-3">
      <SourceLine view={view} />
      <div
        role="alert"
        className="rounded-xl bg-[color-mix(in_oklab,var(--danger),transparent_88%)] p-3"
      >
        <p className="flex items-center gap-1.5 text-[13px] font-medium text-[var(--danger)]">
          <AlertTriangle className="size-4 shrink-0" />
          {st(lang, "remake.errorTitle")}
        </p>
        <p className="mt-1 text-[13px] leading-5 text-[var(--fg)]">
          {st(lang, `remake.error.${code}` as StudioKey)}
        </p>
        {code === "privacy_filter" ? (
          <a
            href={PRIVACY_URL}
            target="_blank"
            rel="noreferrer noopener"
            className="mt-2 inline-flex items-center gap-1 text-xs font-medium text-[var(--fg)] underline underline-offset-2"
          >
            {st(lang, "remake.openrouterSettings")}
            <ExternalLink className="size-3" />
          </a>
        ) : null}
      </div>
      <div className="flex justify-end gap-2">
        <button
          type="button"
          disabled={pending}
          onClick={() => act(() => dismissRemake({ remakeId: view.id }))}
          className={cn(
            PILL,
            "bg-[var(--surface-2)] text-[var(--fg-muted)] hover:text-[var(--fg)]",
          )}
        >
          {st(lang, "remake.close")}
        </button>
        {[
          "private",
          "age_restricted",
          "too_long",
          "unavailable",
          "invalid_url",
          "no_lyrics",
        ].includes(code) ? null : (
          <button
            type="button"
            disabled={pending}
            onClick={() => act(() => retryRemake({ remakeId: view.id }))}
            className={cn(
              PILL,
              "bg-[var(--fg)] text-[var(--bg)] hover:opacity-90",
            )}
          >
            <RefreshCw className="size-3.5" />
            {st(lang, "remake.retry")}
          </button>
        )}
      </div>
    </div>
  );
}

// --- Review -----------------------------------------------------------------------------------

function Summary({ view }: { view: RemakeView }) {
  const lang = useLocale();
  const a = view.analysis;
  if (!a) return null;
  const vocal = ["female", "male", "mixed", "none"].includes(a.vocal.type)
    ? st(lang, `remake.vocal.${a.vocal.type}` as StudioKey)
    : a.vocal.type;
  const mode =
    a.key.mode === "minor" || a.key.mode === "major"
      ? st(lang, `remake.${a.key.mode}` as StudioKey)
      : a.key.mode;
  const facts: [string, string][] = [
    [st(lang, "remake.bpm"), String(Math.round(a.bpm))],
    [st(lang, "remake.key"), `${a.key.tonic} ${mode}`],
    [st(lang, "remake.meter"), `${a.beatsPerBar}/4`],
    [st(lang, "remake.duration"), clock(a.durationS)],
  ];
  return (
    <div className="space-y-2">
      <dl className="grid grid-cols-4 gap-1.5">
        {facts.map(([label, value]) => (
          <div
            key={label}
            className="min-w-0 rounded-xl bg-[var(--surface-2)] px-2 py-1.5"
          >
            <dt className="truncate text-[10px] tracking-wide text-[var(--fg-subtle)] uppercase">
              {label}
            </dt>
            <dd className="truncate text-[13px] font-medium tabular-nums">
              {value}
            </dd>
          </div>
        ))}
      </dl>
      <p className="flex flex-wrap gap-1">
        {[`${st(lang, "remake.vocal")} ${vocal}`, ...a.mood, ...a.genre].map(
          (tag) => (
            <span
              key={tag}
              className="rounded-full bg-[var(--surface-glass)] px-2 py-0.5 text-[11px] text-[var(--fg-muted)] ring-1 ring-[var(--hairline)]"
            >
              {tag}
            </span>
          ),
        )}
        <span className="rounded-full px-1 py-0.5 text-[11px] text-[var(--fg-subtle)]">
          {stf(lang, "remake.sectionsCount", { n: String(a.sections.length) })}
        </span>
      </p>
    </div>
  );
}

function JuryBox({
  lyrics,
  edited,
}: {
  lyrics: RemakeLyrics;
  edited: boolean;
}) {
  const lang = useLocale();
  const jury = latestJury(lyrics);
  const [open, setOpen] = useState(false);
  if (!jury) return null;
  const status = !jury.available
    ? "remake.juryUnavailable"
    : jury.passed
      ? "remake.juryPassed"
      : "remake.juryFailed";
  const notes = [
    ...jury.objections
      .filter((o) => o.severity === "must_fix")
      .map((o) => ({ line: o.line, text: o.text, must: true })),
    ...jury.issues.map((i) => ({ line: i.line, text: i.problem, must: false })),
    ...jury.objections
      .filter((o) => o.severity !== "must_fix")
      .map((o) => ({ line: o.line, text: o.text, must: false })),
  ];
  return (
    <section
      aria-label={st(lang, "remake.jury")}
      className="space-y-2 rounded-xl bg-[var(--surface-2)] p-3"
    >
      <p className="flex items-center gap-1.5 text-[13px] font-medium">
        {jury.passed ? (
          <Check className="size-4 text-[var(--success)]" />
        ) : (
          <AlertTriangle className="size-4 text-[var(--warning)]" />
        )}
        {st(lang, status)}
      </p>
      {jury.redacted ? (
        <p className="text-xs leading-5 text-[var(--warning)]">
          {st(lang, "remake.privacyNotice")}{" "}
          <a
            href={PRIVACY_URL}
            target="_blank"
            rel="noreferrer noopener"
            className="underline underline-offset-2"
          >
            {st(lang, "remake.openrouterSettings")}
          </a>
        </p>
      ) : null}
      {jury.available ? (
        <ul className="grid grid-cols-2 gap-x-4 gap-y-1.5">
          {REMAKE_JURY_KEYS.map((key) => {
            const score = jury.scores[key] ?? 0;
            return (
              <li key={key} className="min-w-0">
                <div className="flex items-baseline justify-between gap-2 text-[11px]">
                  <span className="truncate text-[var(--fg-muted)]">
                    {st(lang, `remake.criterion.${key}` as StudioKey)}
                  </span>
                  <span
                    className={cn(
                      "tabular-nums",
                      score < 0.7
                        ? "text-[var(--warning)]"
                        : "text-[var(--fg)]",
                    )}
                  >
                    {score.toFixed(2)}
                  </span>
                </div>
                <span className="relative mt-0.5 block h-1 rounded-full bg-[var(--surface-glass-hover)]">
                  <span
                    className={cn(
                      "absolute inset-y-0 left-0 rounded-full",
                      score < 0.7
                        ? "bg-[var(--warning)]"
                        : "bg-[var(--fg-muted)]",
                    )}
                    style={{ width: `${Math.round(score * 100)}%` }}
                  />
                  <span className="absolute inset-y-[-2px] left-[70%] w-px bg-[var(--fg-subtle)]" />
                </span>
              </li>
            );
          })}
        </ul>
      ) : null}
      {edited ? (
        <p className="text-[11px] text-[var(--fg-subtle)]">
          {st(lang, "remake.juryEdited")}
        </p>
      ) : null}
      {notes.length ? (
        <div>
          <button
            type="button"
            aria-expanded={open}
            onClick={() => setOpen(!open)}
            className="text-xs font-medium text-[var(--fg-muted)] underline-offset-2 outline-none hover:text-[var(--fg)] hover:underline focus-visible:ring-2 focus-visible:ring-[var(--brand)]"
          >
            {st(lang, "remake.notes")} ({notes.length})
          </button>
          {open ? (
            <ul className="mt-1.5 space-y-1">
              {notes.map((note, i) => (
                <li
                  // biome-ignore lint/suspicious/noArrayIndexKey: notes are positional.
                  key={i}
                  className="text-xs leading-5 text-[var(--fg-muted)]"
                >
                  {note.must ? (
                    <span className="mr-1 rounded bg-[color-mix(in_oklab,var(--danger),transparent_80%)] px-1 text-[10px] font-medium text-[var(--danger)]">
                      {st(lang, "remake.mustFix")}
                    </span>
                  ) : null}
                  {note.line !== null ? (
                    <span className="mr-1 text-[var(--fg-subtle)]">
                      {stf(lang, "remake.line", { n: String(note.line + 1) })}:
                    </span>
                  ) : null}
                  {note.text}
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}

function LineRow({
  line,
  pendingText,
  busy,
  onSave,
}: {
  line: RewrittenLine;
  pendingText: string | undefined;
  busy: boolean;
  onSave: (text: string) => void;
}) {
  const lang = useLocale();
  const [editing, setEditing] = useState(false);
  const shown = pendingText ?? line.text;
  const [draft, setDraft] = useState(shown);
  useEffect(() => {
    if (!editing) setDraft(shown);
  }, [shown, editing]);
  const checking = pendingText !== undefined;
  const flagged = !checking && line.originality.flagged;
  const misfit = !checking && !line.fits;
  const save = () => {
    setEditing(false);
    const text = draft.trim();
    if (text && text !== shown) onSave(text);
    else setDraft(shown);
  };
  const n = String(line.index + 1);
  return (
    <li className="group/line flex items-start gap-2">
      <span
        aria-hidden
        className="w-5 shrink-0 pt-[3px] text-right font-mono text-[10px] text-[var(--fg-subtle)] tabular-nums"
      >
        {n}
      </span>
      <div className="min-w-0 flex-1">
        {editing ? (
          <input
            // biome-ignore lint/a11y/noAutofocus: the person just asked to edit this line.
            autoFocus
            aria-label={stf(lang, "remake.editLine", { n })}
            value={draft}
            maxLength={200}
            onChange={(event) =>
              setDraft(event.target.value.replace(/[\r\n]/gu, " "))
            }
            onBlur={save}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                save();
              } else if (event.key === "Escape") {
                setDraft(shown);
                setEditing(false);
              }
            }}
            className="-mx-1.5 -my-0.5 h-7 w-[calc(100%+0.75rem)] rounded-lg bg-[var(--bg)] px-1.5 text-[13px] outline-none ring-2 ring-[var(--brand)]"
          />
        ) : (
          <button
            type="button"
            disabled={busy}
            aria-label={`${stf(lang, "remake.editLine", { n })}: ${shown}`}
            onClick={() => setEditing(true)}
            className={cn(
              "-mx-1.5 -my-0.5 block w-[calc(100%+0.75rem)] rounded-lg px-1.5 py-0.5 text-left text-[13px] leading-5 outline-none hover:bg-[var(--surface-glass-hover)] focus-visible:ring-2 focus-visible:ring-[var(--brand)] disabled:cursor-default",
              flagged &&
                "bg-[color-mix(in_oklab,var(--danger),transparent_88%)] text-[var(--fg)]",
              checking && "text-[var(--fg-muted)]",
            )}
          >
            {shown}
          </button>
        )}
        <p className="mt-0.5 truncate text-[11px] leading-4 text-[var(--fg-subtle)]">
          {line.source}
        </p>
      </div>
      <span className="flex h-6 shrink-0 items-center gap-1">
        {checking ? (
          <Tip label={st(lang, "remake.checking")}>
            <Loader2
              aria-label={st(lang, "remake.checking")}
              className="size-3.5 animate-spin text-[var(--fg-muted)]"
            />
          </Tip>
        ) : null}
        {flagged ? (
          <Tip label={st(lang, "remake.lineFlagged")}>
            <AlertTriangle
              aria-label={st(lang, "remake.lineFlagged")}
              className="size-3.5 text-[var(--danger)]"
            />
          </Tip>
        ) : null}
        {misfit ? (
          <Tip
            label={stf(lang, "remake.lineMisfit", {
              n: String(line.syllables.max),
              t: String(line.target.max),
            })}
          >
            <span className="rounded bg-[color-mix(in_oklab,var(--warning),transparent_82%)] px-1 font-mono text-[10px] text-[var(--warning)] tabular-nums">
              {line.syllables.max}/{line.target.max}
            </span>
          </Tip>
        ) : null}
        {line.edited && !checking ? (
          <Tip label={st(lang, "remake.lineEdited")}>
            <Pencil
              aria-label={st(lang, "remake.lineEdited")}
              className="size-3 text-[var(--fg-subtle)] opacity-0 group-hover/line:opacity-100"
            />
          </Tip>
        ) : null}
      </span>
    </li>
  );
}

function Review({
  view,
  onChange,
}: {
  view: RemakeView;
  onChange: () => Promise<void>;
}) {
  const lang = useLocale();
  const router = useRouter();
  const form = useCreateForm();
  const { engine } = useEngineChoice();
  const lyrics = view.lyrics as RemakeLyrics;
  const { pending, act } = useAct(onChange);
  const [title, setTitle] = useState(view.pending?.title ?? lyrics.title);
  const [styles, setStyles] = useState(lyrics.styleTags.join(", "));
  useEffect(() => {
    setTitle(view.pending?.title ?? lyrics.title);
  }, [lyrics.title, view.pending?.title]);
  useEffect(() => {
    setStyles(lyrics.styleTags.join(", "));
  }, [lyrics.styleTags]);
  const pendingLines = new Map(
    (view.pending?.lines ?? []).map((line) => [line.index, line.text]),
  );
  const blockers = acceptBlockers(lyrics);
  const job = view.job;
  const stepRunning = Boolean(job || view.pending);
  const sectionBusy = job?.mode === "section" ? job.section : null;
  const meaning = new Map(
    lyrics.originality.sections.map((s) => [s.sectionId, s]),
  );
  const edited = lyrics.sections.some((s) => s.lines.some((l) => l.edited));

  const save = (lines: { index: number; text: string }[], newTitle?: string) =>
    act(() =>
      editRemake({
        remakeId: view.id,
        revision: view.revision,
        lines,
        title: newTitle ?? null,
      }),
    );

  const accept = () => {
    const a = view.analysis;
    const base = payloadFor(
      { ...form, engine, mode: "advanced", audio: null },
      useVideoStudio.getState().params,
    ).settings;
    const key = a ? `${a.key.tonic} ${a.key.mode}` : "";
    // The remake keeps the source's tempo, key and meter unless the music card says otherwise.
    const settings = {
      ...base,
      ...(base.bpm === undefined &&
      a &&
      a.bpm >= BPM_RANGE.min &&
      a.bpm <= BPM_RANGE.max
        ? { bpm: Math.round(a.bpm) }
        : {}),
      ...(base.keyscale === undefined &&
      (SONG_KEYS as readonly string[]).includes(key)
        ? { keyscale: key }
        : {}),
      ...(base.timeSignature === undefined &&
      a &&
      (TIME_SIGNATURES as readonly string[]).includes(String(a.beatsPerBar))
        ? {
            timeSignature: String(
              a.beatsPerBar,
            ) as (typeof TIME_SIGNATURES)[number],
          }
        : {}),
    };
    const vocal = a?.vocal.type;
    act(
      () =>
        acceptRemake({
          remakeId: view.id,
          revision: view.revision,
          title: title.trim().slice(0, 80),
          style: styles.trim(),
          vocalGender:
            form.vocalGender ??
            (vocal === "female" ? "f" : vocal === "male" ? "m" : null),
          settings,
        }),
      () => {
        toast.success(st(lang, "remake.accepted"));
        router.refresh();
      },
    );
  };

  return (
    <div className="space-y-3">
      <SourceLine view={view} />
      <Summary view={view} />
      <div className="space-y-1">
        <label
          htmlFor={`${view.id}-title`}
          className="text-[11px] tracking-wide text-[var(--fg-subtle)] uppercase"
        >
          {st(lang, "remake.newTitle")}
        </label>
        <input
          id={`${view.id}-title`}
          value={title}
          maxLength={80}
          disabled={stepRunning && !view.pending}
          onChange={(event) => setTitle(event.target.value)}
          onBlur={() => {
            const next = title.trim();
            if (next && next !== (view.pending?.title ?? lyrics.title))
              save([], next);
            else setTitle(view.pending?.title ?? lyrics.title);
          }}
          onKeyDown={(event) => {
            // Inside the create panel's form: Enter must not create a song.
            if (event.key === "Enter") {
              event.preventDefault();
              event.currentTarget.blur();
            }
          }}
          className={cn(FIELD, "w-full text-[15px] font-medium")}
        />
      </div>
      <JuryBox lyrics={lyrics} edited={edited} />
      <p className="text-[11px] text-[var(--fg-subtle)]">
        {st(lang, "remake.editHint")}
      </p>
      <div className="space-y-2.5">
        {lyrics.sections.map((section) => {
          const m = meaning.get(section.id);
          const weak =
            m && !m.ok && lyrics.originality.meaningGate === "enforce";
          const timing = view.analysis?.sections.find(
            (s) => s.id === section.id,
          );
          if (section.lines.length === 0)
            return (
              <p
                key={section.id}
                className="flex items-center gap-2 px-1 text-xs text-[var(--fg-subtle)]"
              >
                <span className="font-medium text-[var(--fg-muted)]">
                  [{section.label}]
                </span>
                {st(lang, "remake.instrumental")}
                {timing ? (
                  <span className="tabular-nums">{clock(timing.start)}</span>
                ) : null}
              </p>
            );
          const regenerating = sectionBusy === section.id;
          return (
            <section
              key={section.id}
              aria-label={section.label}
              className={cn(
                "rounded-xl bg-[var(--surface-glass)] p-2.5 ring-1 ring-[var(--hairline)]",
                regenerating && "opacity-60",
              )}
            >
              <div className="mb-1.5 flex items-center gap-2">
                <h4 className="text-xs font-medium text-[var(--fg-muted)]">
                  [{section.label}]
                </h4>
                {timing ? (
                  <span className="text-[11px] text-[var(--fg-subtle)] tabular-nums">
                    {clock(timing.start)} - {clock(timing.end)}
                  </span>
                ) : null}
                {weak ? (
                  <Tip
                    label={stf(lang, "remake.meaningWeakTip", {
                      s: (m?.meaningCosine ?? 0).toFixed(2),
                      r: (m?.required ?? 0).toFixed(2),
                    })}
                  >
                    <span className="rounded-full bg-[color-mix(in_oklab,var(--warning),transparent_85%)] px-1.5 text-[10px] text-[var(--warning)]">
                      {st(lang, "remake.meaningWeak")}
                    </span>
                  </Tip>
                ) : null}
                <button
                  type="button"
                  disabled={pending || stepRunning}
                  aria-label={stf(lang, "remake.regenerateSection", {
                    s: section.label,
                  })}
                  onClick={() =>
                    act(() =>
                      regenerateRemakeSection({
                        remakeId: view.id,
                        revision: view.revision,
                        section: section.id,
                      }),
                    )
                  }
                  className="ml-auto inline-flex h-6 items-center gap-1 rounded-full px-2 text-[11px] text-[var(--fg-muted)] outline-none hover:bg-[var(--surface-glass-hover)] hover:text-[var(--fg)] focus-visible:ring-2 focus-visible:ring-[var(--brand)] disabled:cursor-not-allowed disabled:opacity-40"
                >
                  <RefreshCw
                    className={cn("size-3", regenerating && "animate-spin")}
                  />
                  {st(lang, "remake.regenerate")}
                </button>
              </div>
              <ol className="space-y-1">
                {section.lines.map((line) => (
                  <LineRow
                    key={line.index}
                    line={line}
                    pendingText={pendingLines.get(line.index)}
                    busy={pending || Boolean(job && job.mode !== "check")}
                    onSave={(text) => save([{ index: line.index, text }])}
                  />
                ))}
              </ol>
            </section>
          );
        })}
      </div>
      <div className="space-y-1">
        <label
          htmlFor={`${view.id}-styles`}
          className="text-[11px] tracking-wide text-[var(--fg-subtle)] uppercase"
        >
          {st(lang, "remake.styles")}
        </label>
        <textarea
          id={`${view.id}-styles`}
          value={styles}
          rows={2}
          maxLength={1000}
          onChange={(event) => setStyles(event.target.value)}
          className="block w-full resize-none rounded-xl bg-[var(--surface-2)] px-3 py-2 text-[13px] leading-5 outline-none focus-visible:ring-2 focus-visible:ring-[var(--brand)]"
        />
      </div>
      {stepRunning && job ? (
        <p
          role="status"
          className="flex items-center gap-1.5 text-xs text-[var(--fg-muted)]"
        >
          <Loader2 className="size-3.5 animate-spin" />
          {job.status === "queued"
            ? st(lang, "remake.waiting")
            : (stepText(lang, job.message) ?? st(lang, "remake.checking"))}
        </p>
      ) : blockers.length ? (
        <p role="status" className="text-xs text-[var(--danger)]">
          {blockers.some((b) => b.kind === "phrase") &&
          blockers.every((b) => b.kind === "phrase")
            ? st(lang, "remake.phraseBlocked")
            : stf(lang, "remake.acceptBlocked", {
                n: String(blockers.filter((b) => b.kind !== "phrase").length),
              })}
        </p>
      ) : null}
      <div className="flex items-center gap-2">
        <button
          type="button"
          disabled={pending}
          onClick={() => act(() => cancelRemake({ remakeId: view.id }))}
          className={cn(
            PILL,
            "h-10 bg-[var(--surface-2)] text-[var(--fg-muted)] hover:text-[var(--fg)]",
          )}
        >
          <X className="size-3.5" />
          {st(lang, "remake.cancel")}
        </button>
        <button
          type="button"
          onClick={accept}
          disabled={
            pending ||
            stepRunning ||
            blockers.length > 0 ||
            !title.trim() ||
            !styles.trim()
          }
          className={cn(
            PILL,
            "h-10 flex-1 justify-center bg-cta text-[15px] text-white shadow-[0_8px_30px_-10px_var(--brand)] hover:brightness-110 disabled:bg-[var(--surface-2)] disabled:bg-none disabled:text-[var(--fg-subtle)] disabled:shadow-none",
          )}
        >
          {pending ? (
            <Loader2 className="size-4 animate-spin" />
          ) : (
            <Check className="size-4" />
          )}
          {st(lang, "remake.accept")}
        </button>
      </div>
      <p className="text-center text-[11px] text-[var(--fg-subtle)]">
        {stf(lang, "remake.cost", { c: view.costUsd.toFixed(3) })}
        {" · "}
        {engine === "kie"
          ? stf(lang, "remake.costKie", { c: String(kieCredits(1)) })
          : st(lang, "remake.costLocal")}
      </p>
    </div>
  );
}

function Accepted({
  view,
  onChange,
}: {
  view: RemakeView;
  onChange: () => Promise<void>;
}) {
  const lang = useLocale();
  const { pending, act } = useAct(onChange);
  return (
    <div className="space-y-3">
      <div
        role="status"
        className="rounded-xl bg-[color-mix(in_oklab,var(--success),transparent_88%)] p-3"
      >
        <p className="flex items-center gap-1.5 text-[13px] font-medium text-[var(--success)]">
          <Check className="size-4" />
          {st(lang, "remake.accepted")}
        </p>
        <p className="mt-1 text-xs text-[var(--fg-muted)]">
          {st(lang, "remake.acceptedNote")}
        </p>
      </div>
      <div className="flex items-center justify-end gap-2">
        <button
          type="button"
          disabled={pending}
          onClick={() => act(() => dismissRemake({ remakeId: view.id }))}
          className={cn(
            PILL,
            "bg-[var(--surface-2)] text-[var(--fg-muted)] hover:text-[var(--fg)]",
          )}
        >
          {st(lang, "remake.another")}
        </button>
        <Link
          href={`/projects/${view.projectId}?lang=${view.lang}`}
          className={cn(
            PILL,
            "bg-[var(--fg)] text-[var(--bg)] hover:opacity-90",
          )}
        >
          {st(lang, "remake.openSong")}
          <ArrowRight className="size-3.5" />
        </Link>
      </div>
    </div>
  );
}

export function RemakeCard() {
  const lang = useLocale();
  const open = useCreateForm((s) => s.open.remake);
  const toggle = useCreateForm((s) => s.toggleCard);
  const { view, loaded, refresh } = useRemake();
  const active = Boolean(view);
  return (
    <PanelCard
      id="remake"
      title={st(lang, "remake.title")}
      open={open || active}
      onToggle={() => toggle("remake")}
    >
      {!loaded ? (
        <div className="h-24 animate-pulse rounded-xl bg-[var(--surface-2)]" />
      ) : !view ? (
        <StartForm onStarted={refresh} />
      ) : view.stage === "failed" ? (
        <Failure view={view} onChange={refresh} />
      ) : view.stage === "accepted" ? (
        <Accepted view={view} onChange={refresh} />
      ) : view.stage === "review" && view.lyrics ? (
        <Review view={view} onChange={refresh} />
      ) : (
        <Progress view={view} onChange={refresh} />
      )}
    </PanelCard>
  );
}
