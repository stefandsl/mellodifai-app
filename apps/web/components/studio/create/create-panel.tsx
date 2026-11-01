"use client";

import { cn } from "cn";
import { Music2, Trash2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useState, useTransition } from "react";
import { toast } from "sonner";

import { createSong } from "@/app/actions/create-song";
import { useLocale } from "@/components/locale-provider";
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import {
  engineControls,
  engineLabel,
  localCost,
  minutesPhrase,
} from "@/lib/studio/engines";
import { st, stf } from "@/lib/studio/i18n";
import {
  blocker,
  type CreateFormState,
  hasContent,
  LIMITS,
  useCreateForm,
} from "@/store/create-form";
import { Counter, Segmented, Tip } from "../ui";
import { EngineSelect } from "./engine-select";
import { LanguagePicker } from "./language-picker";
import { LyricsCard } from "./lyrics-card";
import { ModelSelect } from "./model-select";
import { MoreOptionsCard } from "./more-options-card";
import { PROMPT_EXAMPLES, RotatingPlaceholder } from "./rotating-placeholder";
import { StylesCard } from "./styles-card";
import { useEngineChoice } from "./use-engine";
import { VideoCard, VideoRow } from "./video-card";

export function payloadFor(form: CreateFormState) {
  const controls = engineControls(form.engine);
  return {
    mode: form.mode,
    prompt: form.prompt.trim(),
    lyrics: form.lyrics.trim(),
    styles: form.styles.trim(),
    languages: form.languages,
    vocalGender: form.vocalGender,
    settings: {
      ...(controls.model ? { model: form.model } : {}),
      ...(form.title.trim() ? { title: form.title.trim() } : {}),
      ...(controls.tuning
        ? {
            ...(form.exclude.trim() ? { exclude: form.exclude.trim() } : {}),
            weirdness: Math.round(form.weirdness) / 100,
            styleWeight: Math.round(form.styleInfluence) / 100,
            variety: form.variety,
          }
        : {}),
      duration:
        controls.duration && form.durationMode === "custom"
          ? form.duration
          : null,
      video: form.video.mode === "off" ? ("off" as const) : ("lyric" as const),
      engine: form.engine,
    },
  };
}

function Heading() {
  const lang = useLocale();
  return (
    <h2 className="flex h-10 items-center border-b border-[var(--hairline)] text-base font-medium">
      <span className="-mb-px flex h-full items-center border-b-2 border-[var(--fg)]">
        {st(lang, "create.songs")}
      </span>
    </h2>
  );
}

function SimplePrompt() {
  const lang = useLocale();
  const prompt = useCreateForm((s) => s.prompt);
  const set = useCreateForm((s) => s.set);
  return (
    <div className="relative rounded-2xl bg-[var(--surface-glass)] p-4 ring-1 ring-[var(--hairline)] focus-within:ring-[color-mix(in_oklab,var(--brand),transparent_40%)]">
      <label htmlFor="simple-prompt" className="sr-only">
        {st(lang, "create.promptLabel")}
      </label>
      <RotatingPlaceholder
        examples={PROMPT_EXAMPLES[lang]}
        visible={!prompt}
        className="inset-x-4 top-4 leading-6"
      />
      <textarea
        id="simple-prompt"
        value={prompt}
        onChange={(event) => set({ prompt: event.target.value })}
        className="relative block min-h-[150px] w-full resize-none bg-transparent leading-6 outline-none scrollbar-thin"
      />
      {prompt.length >= 400 ? (
        <Counter
          value={prompt.length}
          max={LIMITS.prompt}
          className="absolute right-4 bottom-3"
        />
      ) : null}
    </div>
  );
}

export function CreatePanel({ onCreated }: { onCreated?: () => void }) {
  const lang = useLocale();
  const router = useRouter();
  const form = useCreateForm();
  const [pending, start] = useTransition();
  const [confirmClear, setConfirmClear] = useState(false);
  const choice = useEngineChoice();
  const { engine } = choice;
  const controls = engineControls(engine);
  // One line saying why a local engine was dropped; gone as soon as the admin picks again.
  const [fallback, setFallback] = useState<string | null>(null);
  // The persisted draft loads after hydration; render the server default until then.
  const [ready, setReady] = useState(false);
  useEffect(() => {
    void Promise.resolve(useCreateForm.persist.rehydrate()).then(() =>
      setReady(true),
    );
  }, []);
  const block = blocker(form);

  // A local engine that stops qualifying (PC offline, language added) hands the form back to
  // kie; the stored choice follows so the form never keeps a stale engine.
  const { stored, reason } = choice;
  const setForm = form.set;
  useEffect(() => {
    if (!ready || !reason) return;
    setForm({ engine: "kie" });
    if (reason !== "admin")
      setFallback(
        stf(lang, "create.engineFallback", {
          engine: engineLabel(lang, stored),
          reason: st(lang, `engine.reason.${reason}`),
        }),
      );
  }, [ready, reason, stored, lang, setForm]);

  const minutes = localCost(
    engine,
    choice.engines,
    controls.duration && form.durationMode === "custom" ? form.duration : null,
  );
  const cost =
    engine === "kie"
      ? st(lang, "create.cost")
      : minutes === null
        ? st(lang, "create.costLocalNoEstimate")
        : stf(lang, "create.costLocal", { m: minutesPhrase(lang, minutes) });

  function submit() {
    if (block || pending) return;
    start(async () => {
      const result = await createSong(payloadFor({ ...form, engine }));
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      toast.success(st(lang, "create.created"));
      router.refresh();
      onCreated?.();
    });
  }

  return (
    <form
      aria-label={st(lang, "create.submitLabel")}
      onSubmit={(event) => {
        event.preventDefault();
        submit();
      }}
      onKeyDown={(event) => {
        if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
          event.preventDefault();
          submit();
        }
      }}
      className={cn(
        "flex h-full min-h-0 flex-col transition-opacity",
        !ready && "opacity-0",
      )}
    >
      <div className="shrink-0 px-4 pt-3">
        <Heading />
        <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
          <Segmented
            label={`${st(lang, "create.simple")} / ${st(lang, "create.advanced")}`}
            value={form.mode}
            onChange={(mode) => mode && form.set({ mode })}
            options={[
              { value: "simple", label: st(lang, "create.simple") },
              { value: "advanced", label: st(lang, "create.advanced") },
            ]}
          />
          <div className="flex items-center gap-1.5">
            <LanguagePicker
              value={form.languages}
              onChange={(languages) => form.set({ languages })}
            />
            {choice.isAdmin ? (
              <EngineSelect
                value={engine}
                options={choice.options}
                onChange={(next) => {
                  setFallback(null);
                  form.set({ engine: next });
                }}
              />
            ) : null}
            {controls.model ? (
              <ModelSelect
                value={form.model}
                onChange={(model) => form.set({ model })}
              />
            ) : null}
          </div>
        </div>
        {fallback ? (
          <p
            role="status"
            className="mt-2 rounded-xl bg-[var(--surface-2)] px-3 py-1.5 text-xs text-[var(--fg-muted)]"
          >
            {fallback}
          </p>
        ) : null}
      </div>

      <div className="min-h-0 flex-1 space-y-3 overflow-y-auto px-4 pt-3 pb-4 scrollbar-thin">
        {form.mode === "simple" ? (
          <>
            <SimplePrompt />
            <VideoRow />
          </>
        ) : (
          <>
            <LyricsCard />
            <StylesCard />
            <VideoCard />
            <MoreOptionsCard />
            <div className="flex h-11 items-center gap-2 rounded-2xl bg-[var(--surface-1)] px-4 focus-within:ring-2 focus-within:ring-[var(--brand)]">
              <Music2 className="size-4 shrink-0 text-[var(--fg-muted)]" />
              <label htmlFor="song-title" className="sr-only">
                {st(lang, "create.title")}
              </label>
              <input
                id="song-title"
                value={form.title}
                maxLength={LIMITS.title}
                placeholder={st(lang, "create.title")}
                onChange={(event) => form.set({ title: event.target.value })}
                className="h-full min-w-0 flex-1 bg-transparent outline-none placeholder:text-[var(--fg-subtle)]"
              />
              {form.title ? (
                <Counter value={form.title.length} max={LIMITS.title} />
              ) : null}
            </div>
          </>
        )}
      </div>

      <div className="shrink-0 border-t border-[var(--hairline)] bg-[var(--bg)] px-4 pt-3 pb-4">
        {block && hasContent(form) ? (
          <p
            role="status"
            className="mb-2 rounded-full bg-[var(--surface-2)] px-3 py-1 text-center text-xs text-[var(--fg-muted)]"
          >
            {st(lang, `create.${block}`)}
          </p>
        ) : (
          <p className="mb-2 text-center text-xs text-[var(--fg-subtle)]">
            {cost}
          </p>
        )}
        <div className="flex items-center gap-2">
          <Tip label={st(lang, "create.clear")}>
            <button
              type="button"
              aria-label={st(lang, "create.clear")}
              onClick={() =>
                hasContent(form) ? setConfirmClear(true) : form.clear()
              }
              className="inline-flex size-12 shrink-0 items-center justify-center rounded-full bg-[var(--surface-2)] text-[var(--fg-muted)] outline-none hover:text-[var(--danger)] focus-visible:ring-2 focus-visible:ring-[var(--brand)]"
            >
              <Trash2 className="size-4" />
            </button>
          </Tip>
          <button
            type="submit"
            aria-label={st(lang, "create.submitLabel")}
            aria-disabled={Boolean(block) || pending}
            className={cn(
              "inline-flex h-12 flex-1 items-center justify-center gap-2 rounded-full text-[17px] font-medium outline-none focus-visible:ring-2 focus-visible:ring-[var(--fg)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--bg)]",
              block || pending
                ? "cursor-not-allowed bg-[var(--surface-2)] text-[var(--fg-subtle)]"
                : "bg-cta text-white shadow-[0_8px_30px_-10px_var(--brand)] hover:brightness-110",
            )}
          >
            <Music2 className="size-5" />
            {pending
              ? st(lang, "create.submitting")
              : st(lang, "create.submit")}
          </button>
        </div>
      </div>

      <AlertDialog open={confirmClear} onOpenChange={setConfirmClear}>
        <AlertDialogContent>
          <AlertDialogTitle>{st(lang, "create.clear")}</AlertDialogTitle>
          <AlertDialogDescription>
            {st(lang, "create.clearConfirm")}
          </AlertDialogDescription>
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={() => setConfirmClear(false)}>
              {lang === "it" ? "Annulla" : "Cancel"}
            </Button>
            <Button
              onClick={() => {
                form.clear();
                setConfirmClear(false);
              }}
            >
              {lang === "it" ? "Svuota" : "Clear"}
            </Button>
          </div>
        </AlertDialogContent>
      </AlertDialog>
    </form>
  );
}
