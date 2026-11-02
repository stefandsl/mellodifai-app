"use client";

import {
  type BackgroundMode,
  type CenterImageMode,
  COLOR_PRESETS,
  type CoverFit,
  colorPresetOf,
  rerollSeed,
} from "@mellodifai/shared";
import { cn } from "cn";
import { Loader2, RotateCcw, Shuffle, Upload, X } from "lucide-react";
import { useId, useRef, useState } from "react";
import { toast } from "sonner";

import { useLocale } from "@/components/locale-provider";
import { st, stf } from "@/lib/studio/i18n";
import {
  limitLabel,
  type UploadKind,
  uploadProblem,
  uploadStudioFile,
} from "@/lib/studio/visualizer/upload";
import { useVideoStudio } from "@/store/video-studio";
import { EditableSlider, Segmented } from "../ui";

export function Section({
  title,
  children,
  action,
}: {
  title: string;
  children: React.ReactNode;
  action?: React.ReactNode;
}) {
  return (
    <section className="space-y-2.5">
      <div className="flex min-h-7 items-center justify-between gap-2">
        <h3 className="text-[11px] font-semibold tracking-[0.08em] text-[var(--fg-muted)] uppercase">
          {title}
        </h3>
        {action}
      </div>
      {children}
    </section>
  );
}

const SMALL_BUTTON =
  "inline-flex h-7 items-center gap-1.5 rounded-full bg-[var(--surface-2)] px-2.5 text-xs font-medium outline-none hover:bg-[color-mix(in_oklab,var(--surface-2),var(--fg)_10%)] focus-visible:ring-2 focus-visible:ring-[var(--brand)] disabled:opacity-50 [&_svg]:size-3.5";

// Picks a file, checks it against the studio's limits, stores it and hands back its link.
function UploadButton({
  kind,
  label,
  onUploaded,
}: {
  kind: UploadKind;
  label: string;
  onUploaded: (url: string) => void;
}) {
  const lang = useLocale();
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  return (
    <>
      <button
        type="button"
        disabled={busy}
        onClick={() => input.current?.click()}
        className={SMALL_BUTTON}
      >
        {busy ? <Loader2 className="animate-spin" /> : <Upload />}
        {busy ? st(lang, "vs.uploading") : label}
      </button>
      <input
        ref={input}
        type="file"
        hidden
        data-testid={`upload-${kind}`}
        accept={
          kind === "image"
            ? "image/jpeg,image/png,image/webp"
            : "video/mp4,video/webm"
        }
        onChange={async (event) => {
          const file = event.currentTarget.files?.[0];
          event.currentTarget.value = "";
          if (!file) return;
          const problem = uploadProblem(file, kind);
          if (problem) {
            toast.error(
              problem === "tooBig"
                ? stf(lang, "vs.tooBig", { limit: limitLabel(kind) })
                : st(lang, "vs.wrongType"),
            );
            return;
          }
          setBusy(true);
          try {
            onUploaded(await uploadStudioFile(file));
          } catch {
            toast.error(st(lang, "vs.uploadFailed"));
          } finally {
            setBusy(false);
          }
        }}
      />
    </>
  );
}

function ColorField({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (hex: string) => void;
}) {
  const id = useId();
  const [draft, setDraft] = useState<string | null>(null);
  return (
    <div className="flex min-w-0 flex-1 items-center gap-2 rounded-xl bg-[var(--surface-2)] p-1.5 pr-2.5">
      <input
        id={id}
        type="color"
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="size-8 shrink-0 cursor-pointer rounded-lg border-0 bg-transparent p-0"
      />
      <div className="min-w-0">
        <label
          htmlFor={id}
          className="block text-[11px] text-[var(--fg-muted)]"
        >
          {label}
        </label>
        <input
          aria-label={`${label} hex`}
          value={draft ?? value.toUpperCase()}
          spellCheck={false}
          onChange={(event) => {
            const text = event.target.value.trim();
            setDraft(text);
            if (/^#[0-9a-fA-F]{6}$/u.test(text)) onChange(text.toLowerCase());
          }}
          onBlur={() => setDraft(null)}
          className="w-full bg-transparent font-mono text-[12px] uppercase outline-none"
        />
      </div>
    </div>
  );
}

export function StyleTab() {
  const lang = useLocale();
  const params = useVideoStudio((s) => s.params);
  const update = useVideoStudio((s) => s.update);
  const bg = params.background;
  const preset = colorPresetOf(params);
  return (
    <div className="space-y-6">
      <Section
        title={st(lang, "vs.background")}
        action={
          bg.mode === "random" ? (
            <button
              type="button"
              onClick={() =>
                update((p) => ({
                  ...p,
                  background: {
                    ...p.background,
                    seed: rerollSeed(p.background.seed),
                  },
                }))
              }
              className={SMALL_BUTTON}
            >
              <Shuffle />
              {st(lang, "vs.reroll")}
            </button>
          ) : (
            <span className="flex items-center gap-1.5">
              {bg.assetUrl ? (
                <button
                  type="button"
                  aria-label={st(lang, "vs.removeFile")}
                  title={st(lang, "vs.removeFile")}
                  onClick={() =>
                    update((p) => ({
                      ...p,
                      background: { ...p.background, assetUrl: null },
                    }))
                  }
                  className={cn(SMALL_BUTTON, "w-7 justify-center px-0")}
                >
                  <X />
                </button>
              ) : null}
              <UploadButton
                key={bg.mode}
                kind={bg.mode === "video" ? "video" : "image"}
                label={st(lang, bg.assetUrl ? "vs.replace" : "vs.upload")}
                onUploaded={(url) =>
                  update((p) => ({
                    ...p,
                    background: { ...p.background, assetUrl: url },
                  }))
                }
              />
            </span>
          )
        }
      >
        <Segmented<BackgroundMode>
          label={st(lang, "vs.background")}
          value={bg.mode}
          size="sm"
          onChange={(mode) =>
            mode &&
            update((p) => ({
              ...p,
              background: {
                ...p.background,
                // Casuale picks another picture on every click; the other modes start empty.
                seed:
                  mode === "random"
                    ? rerollSeed(p.background.seed)
                    : p.background.seed,
                assetUrl:
                  mode === p.background.mode ? p.background.assetUrl : null,
                mode,
              },
            }))
          }
          options={[
            { value: "random", label: st(lang, "vs.bg.random") },
            { value: "image", label: st(lang, "vs.bg.image") },
            { value: "video", label: st(lang, "vs.bg.video") },
          ]}
        />
        {bg.mode === "random" ? null : (
          <p className="text-xs leading-5 text-[var(--fg-muted)]">
            {st(lang, bg.mode === "video" ? "vs.videoHint" : "vs.imageHint")}
          </p>
        )}
        <EditableSlider
          label={st(lang, "vs.dimming")}
          value={bg.dimming}
          display={`${bg.dimming}%`}
          onChange={(dimming) =>
            update((p) => ({ ...p, background: { ...p.background, dimming } }))
          }
        />
      </Section>

      <Section title={st(lang, "vs.colorPresets")}>
        <div
          role="radiogroup"
          aria-label={st(lang, "vs.colorPresets")}
          className="grid max-w-[264px] grid-cols-5 gap-2.5"
        >
          {COLOR_PRESETS.map((item) => {
            const selected = preset === item.id;
            const name = st(lang, `vs.color.${item.id}`);
            return (
              // biome-ignore lint/a11y/useSemanticElements: a colour swatch, not a native radio input.
              <button
                key={item.id}
                type="button"
                role="radio"
                aria-checked={selected}
                aria-label={name}
                title={name}
                onClick={() =>
                  update((p) => ({
                    ...p,
                    colors: {
                      primary: item.primary,
                      secondary: item.secondary,
                    },
                  }))
                }
                className={cn(
                  "aspect-square rounded-full outline-none transition-transform hover:scale-105 focus-visible:ring-2 focus-visible:ring-[var(--brand)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--surface-1)]",
                  selected
                    ? "ring-2 ring-[var(--fg)] ring-offset-2 ring-offset-[var(--surface-1)]"
                    : "ring-1 ring-[var(--hairline)]",
                )}
                style={{
                  background: `linear-gradient(135deg, ${item.primary} 0 50%, ${item.secondary} 50% 100%)`,
                }}
              />
            );
          })}
        </div>
      </Section>

      <Section title={st(lang, "vs.customColors")}>
        <div className="flex gap-2">
          <ColorField
            label={st(lang, "vs.primary")}
            value={params.colors.primary}
            onChange={(primary) =>
              update((p) => ({ ...p, colors: { ...p.colors, primary } }))
            }
          />
          <ColorField
            label={st(lang, "vs.secondary")}
            value={params.colors.secondary}
            onChange={(secondary) =>
              update((p) => ({ ...p, colors: { ...p.colors, secondary } }))
            }
          />
        </div>
      </Section>

      <Section title={st(lang, "vs.particles")}>
        <EditableSlider
          label={st(lang, "vs.particles")}
          hideLabel
          value={params.particles}
          onChange={(particles) => update((p) => ({ ...p, particles }))}
        />
      </Section>

      <Section
        title={st(lang, "vs.center")}
        action={
          <span className="flex items-center gap-1.5">
            {params.centerImage.mode === "upload" ? (
              <UploadButton
                kind="image"
                label={st(
                  lang,
                  params.centerImage.assetUrl ? "vs.replace" : "vs.upload",
                )}
                onUploaded={(url) =>
                  update((p) => ({
                    ...p,
                    centerImage: {
                      ...p.centerImage,
                      mode: "upload",
                      assetUrl: url,
                    },
                  }))
                }
              />
            ) : null}
            <button
              type="button"
              disabled={params.centerImage.mode === "cover"}
              onClick={() =>
                update((p) => ({
                  ...p,
                  centerImage: {
                    ...p.centerImage,
                    mode: "cover",
                    assetUrl: null,
                  },
                }))
              }
              className={SMALL_BUTTON}
            >
              <RotateCcw />
              {st(lang, "vs.reset")}
            </button>
          </span>
        }
      >
        <Segmented<CenterImageMode>
          label={st(lang, "vs.center")}
          value={params.centerImage.mode}
          size="sm"
          onChange={(mode) =>
            mode &&
            update((p) => ({
              ...p,
              centerImage: {
                ...p.centerImage,
                mode,
                assetUrl: mode === "upload" ? p.centerImage.assetUrl : null,
              },
            }))
          }
          options={[
            { value: "cover", label: st(lang, "vs.center.cover") },
            { value: "upload", label: st(lang, "vs.center.upload") },
            { value: "none", label: st(lang, "vs.center.none") },
          ]}
        />
        {params.centerImage.mode === "none" ? null : (
          <Segmented<CoverFit>
            label={st(lang, "vs.fit")}
            value={params.centerImage.fit}
            size="sm"
            onChange={(fit) =>
              fit &&
              update((p) => ({ ...p, centerImage: { ...p.centerImage, fit } }))
            }
            options={[
              { value: "cover", label: st(lang, "vs.fit.cover") },
              { value: "contain", label: st(lang, "vs.fit.contain") },
            ]}
          />
        )}
        {params.centerImage.mode === "upload" &&
        !params.centerImage.assetUrl ? (
          <p className="text-xs leading-5 text-[var(--fg-muted)]">
            {st(lang, "vs.imageHint")}
          </p>
        ) : null}
      </Section>
    </div>
  );
}
