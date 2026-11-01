"use client";

import { MAX_TEXT_LAYERS, TEXT_SIZE } from "@mellodifai/shared";
import { cn } from "cn";
import { Plus, Trash2 } from "lucide-react";
import { useId, useState } from "react";

import { useLocale } from "@/components/locale-provider";
import { st, stf } from "@/lib/studio/i18n";
import { useVideoStudio } from "@/store/video-studio";
import { EditableSlider, Segmented } from "../ui";
import { Section } from "./style-tab";

const FIELD =
  "h-9 w-full rounded-xl bg-[var(--surface-2)] px-3 text-[13px] outline-none ring-1 ring-transparent placeholder:text-[var(--fg-subtle)] focus:ring-[color-mix(in_oklab,var(--brand),transparent_40%)]";

function Labeled({
  label,
  children,
}: {
  label: string;
  children: (id: string) => React.ReactNode;
}) {
  const id = useId();
  return (
    <div className="min-w-0 space-y-1">
      <label htmlFor={id} className="block text-[12px] text-[var(--fg-muted)]">
        {label}
      </label>
      {children(id)}
    </div>
  );
}

// The channel template's lines, shown while MellodifAI Classico is the preset.
function ClassicoLines() {
  const lang = useLocale();
  const classico = useVideoStudio((s) => s.params.classico);
  const update = useVideoStudio((s) => s.update);
  const set = (patch: Partial<typeof classico>) =>
    update((p) => ({ ...p, classico: { ...p.classico, ...patch } }));
  return (
    <Section title={st(lang, "vs.classico")}>
      <div className="grid grid-cols-2 gap-2">
        <Labeled label={st(lang, "vs.artist")}>
          {(id) => (
            <input
              id={id}
              value={classico.artist}
              maxLength={40}
              onChange={(e) => set({ artist: e.target.value })}
              className={FIELD}
            />
          )}
        </Labeled>
        <Labeled label={st(lang, "vs.album")}>
          {(id) => (
            <input
              id={id}
              value={classico.album}
              maxLength={40}
              onChange={(e) => set({ album: e.target.value })}
              className={FIELD}
            />
          )}
        </Labeled>
        <div className="col-span-2">
          <Labeled label={st(lang, "vs.website")}>
            {(id) => (
              <input
                id={id}
                value={classico.website}
                maxLength={40}
                onChange={(e) => set({ website: e.target.value })}
                className={FIELD}
              />
            )}
          </Labeled>
        </div>
      </div>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="text-[13px]">{st(lang, "vs.gramophone")}</span>
        <Segmented<"red" | "black">
          label={st(lang, "vs.gramophone")}
          value={classico.gramophone}
          size="sm"
          onChange={(gramophone) => gramophone && set({ gramophone })}
          options={[
            { value: "red", label: st(lang, "vs.gramophone.red") },
            { value: "black", label: st(lang, "vs.gramophone.black") },
          ]}
        />
      </div>
      <Toggle
        label={st(lang, "vs.cards")}
        checked={classico.cards}
        onChange={(cards) => set({ cards })}
      />
    </Section>
  );
}

export function Toggle({
  label,
  checked,
  onChange,
  className,
}: {
  label: React.ReactNode;
  checked: boolean;
  onChange: (on: boolean) => void;
  className?: string;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      onClick={() => onChange(!checked)}
      className={cn(
        "flex w-full items-center justify-between gap-3 rounded-xl text-left text-[13px] outline-none focus-visible:ring-2 focus-visible:ring-[var(--brand)]",
        className,
      )}
    >
      <span className="min-w-0">{label}</span>
      <span
        aria-hidden
        className={cn(
          "relative h-6 w-10 shrink-0 rounded-full transition-colors",
          checked
            ? "bg-[var(--brand)]"
            : "bg-[var(--surface-2)] ring-1 ring-[var(--hairline)]",
        )}
      >
        <span
          className={cn(
            "absolute top-0.5 size-5 rounded-full bg-white shadow transition-transform",
            checked ? "translate-x-[18px]" : "translate-x-0.5",
          )}
        />
      </span>
    </button>
  );
}

// The size field: free typing, the value applies as soon as it is in range and is clamped when
// the field is left.
function SizeField({
  id,
  value,
  onChange,
}: {
  id: string;
  value: number;
  onChange: (size: number) => void;
}) {
  const [draft, setDraft] = useState<string | null>(null);
  const clamp = (n: number) =>
    Math.round(Math.max(TEXT_SIZE.min, Math.min(TEXT_SIZE.max, n)));
  return (
    <input
      id={id}
      type="number"
      inputMode="numeric"
      min={TEXT_SIZE.min}
      max={TEXT_SIZE.max}
      value={draft ?? String(value)}
      onChange={(e) => {
        const text = e.target.value;
        setDraft(text);
        const n = Number(text);
        if (
          text &&
          Number.isFinite(n) &&
          n >= TEXT_SIZE.min &&
          n <= TEXT_SIZE.max
        )
          onChange(Math.round(n));
      }}
      onBlur={() => {
        const n = Number(draft);
        if (draft !== null && draft !== "" && Number.isFinite(n))
          onChange(clamp(n));
        setDraft(null);
      }}
      className={cn(FIELD, "bg-[var(--surface-1)] tabular-nums")}
    />
  );
}

export function TextTab() {
  const lang = useLocale();
  const layers = useVideoStudio((s) => s.params.textLayers);
  const classico = useVideoStudio((s) => s.params.preset === "classico");
  const update = useVideoStudio((s) => s.update);
  const setLayer = (index: number, patch: Partial<(typeof layers)[number]>) =>
    update((p) => ({
      ...p,
      textLayers: p.textLayers.map((layer, i) =>
        i === index ? { ...layer, ...patch } : layer,
      ),
    }));
  const full = layers.length >= MAX_TEXT_LAYERS;
  return (
    <div className="space-y-6">
      {classico ? <ClassicoLines /> : null}
      <Section title={st(lang, "vs.tabText")}>
        <button
          type="button"
          disabled={full}
          onClick={() =>
            update((p) => ({
              ...p,
              textLayers: [
                ...p.textLayers,
                {
                  text: "",
                  x: 50,
                  // New layers stack downwards so they do not cover each other.
                  y: Math.min(90, 20 + p.textLayers.length * 12),
                  size: TEXT_SIZE.default,
                  color: "#ffffff",
                },
              ],
            }))
          }
          className="inline-flex h-9 w-full items-center justify-center gap-2 rounded-xl bg-[var(--brand)] text-[13px] font-medium text-[var(--brand-ink)] outline-none hover:bg-[var(--brand-strong)] focus-visible:ring-2 focus-visible:ring-[var(--brand)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--surface-1)] disabled:opacity-50"
        >
          <Plus className="size-4" />
          {st(lang, "vs.addLayer")}
        </button>
        <p className="text-xs leading-5 text-[var(--fg-muted)]">
          {layers.length === 0
            ? st(lang, "vs.noLayers")
            : stf(lang, "vs.layersMax", { n: String(MAX_TEXT_LAYERS) })}
        </p>
        {layers.map((layer, index) => {
          const n = String(index + 1);
          return (
            <article
              // biome-ignore lint/suspicious/noArrayIndexKey: layers have no identity beyond their place.
              key={index}
              aria-label={stf(lang, "vs.layer", { n })}
              className="space-y-3 rounded-2xl bg-[var(--surface-2)] p-3"
            >
              <div className="flex items-center justify-between">
                <h4 className="text-[13px] font-medium">
                  {stf(lang, "vs.layer", { n })}
                </h4>
                <button
                  type="button"
                  aria-label={stf(lang, "vs.deleteLayer", { n })}
                  title={stf(lang, "vs.deleteLayer", { n })}
                  onClick={() =>
                    update((p) => ({
                      ...p,
                      textLayers: p.textLayers.filter((_, i) => i !== index),
                    }))
                  }
                  className="inline-flex size-7 items-center justify-center rounded-full text-[var(--fg-muted)] outline-none hover:bg-[var(--surface-1)] hover:text-[var(--danger)] focus-visible:ring-2 focus-visible:ring-[var(--brand)]"
                >
                  <Trash2 className="size-3.5" />
                </button>
              </div>
              <Labeled label={st(lang, "vs.layerText")}>
                {(id) => (
                  <input
                    id={id}
                    value={layer.text}
                    maxLength={80}
                    placeholder={st(lang, "vs.layerPlaceholder")}
                    onChange={(e) => setLayer(index, { text: e.target.value })}
                    className={cn(FIELD, "bg-[var(--surface-1)]")}
                  />
                )}
              </Labeled>
              <EditableSlider
                label={st(lang, "vs.x")}
                value={layer.x}
                display={`${layer.x}%`}
                onChange={(x) => setLayer(index, { x })}
              />
              <EditableSlider
                label={st(lang, "vs.y")}
                value={layer.y}
                display={`${layer.y}%`}
                onChange={(y) => setLayer(index, { y })}
              />
              <div className="grid grid-cols-2 gap-2">
                <Labeled label={st(lang, "vs.size")}>
                  {(id) => (
                    <SizeField
                      id={id}
                      value={layer.size}
                      onChange={(size) => setLayer(index, { size })}
                    />
                  )}
                </Labeled>
                <Labeled label={st(lang, "vs.color")}>
                  {(id) => (
                    <div className="flex h-9 items-center gap-2 rounded-xl bg-[var(--surface-1)] px-1.5">
                      <input
                        id={id}
                        type="color"
                        value={layer.color}
                        onChange={(e) =>
                          setLayer(index, { color: e.target.value })
                        }
                        className="size-7 shrink-0 cursor-pointer rounded-md border-0 bg-transparent p-0"
                      />
                      <span className="font-mono text-[12px] uppercase">
                        {layer.color}
                      </span>
                    </div>
                  )}
                </Labeled>
              </div>
            </article>
          );
        })}
      </Section>
    </div>
  );
}
