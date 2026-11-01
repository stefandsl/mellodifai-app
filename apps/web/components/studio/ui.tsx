"use client";

import { cn } from "cn";
import { ChevronRight, Info } from "lucide-react";
import type { ReactElement, ReactNode } from "react";
import { useId, useRef, useState } from "react";

import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";

export function Tip({
  label,
  children,
  side = "top",
}: {
  label: ReactNode;
  children: ReactElement;
  side?: "top" | "bottom" | "left" | "right";
}) {
  return (
    <Tooltip>
      <TooltipTrigger render={children} />
      <TooltipContent side={side} className="max-w-64 text-pretty">
        {label}
      </TooltipContent>
    </Tooltip>
  );
}

// 32px round icon button (brief: like, dislike, share, more).
export function IconButton({
  label,
  children,
  className,
  soon,
  active,
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & {
  label: string;
  soon?: string;
  active?: boolean;
}) {
  const button = (
    <button
      type="button"
      aria-label={label}
      aria-disabled={soon ? true : undefined}
      aria-pressed={active}
      className={cn(
        "inline-flex size-8 shrink-0 items-center justify-center rounded-full bg-[var(--surface-2)] text-[var(--fg)] transition-colors outline-none hover:bg-[color-mix(in_oklab,var(--surface-2),var(--fg)_10%)] focus-visible:ring-2 focus-visible:ring-[var(--brand)] [&_svg]:size-4",
        active && "text-[var(--brand)]",
        soon && "cursor-not-allowed opacity-45 hover:bg-[var(--surface-2)]",
        className,
      )}
      {...props}
      onClick={soon ? undefined : props.onClick}
    >
      {children}
    </button>
  );
  return <Tip label={soon ? `${label} - ${soon}` : label}>{button}</Tip>;
}

export function SoonBadge({ children }: { children: ReactNode }) {
  return (
    <span className="rounded-full bg-[var(--surface-2)] px-1.5 py-px text-[10px] font-medium tracking-wide text-[var(--fg-muted)] uppercase">
      {children}
    </span>
  );
}

// Two-or-more-state segmented pill. Clicking the selected option clears it when `clearable`.
export function Segmented<T extends string>({
  value,
  options,
  onChange,
  label,
  clearable,
  size = "md",
  className,
}: {
  value: T | null;
  options: { value: T; label: ReactNode; soon?: string; icon?: ReactNode }[];
  onChange: (value: T | null) => void;
  label: string;
  clearable?: boolean;
  size?: "sm" | "md";
  className?: string;
}) {
  return (
    <div
      role="radiogroup"
      aria-label={label}
      className={cn(
        "inline-flex items-center gap-0.5 rounded-full bg-[var(--surface-2)] p-0.5",
        className,
      )}
    >
      {options.map((option) => {
        const selected = option.value === value;
        const button = (
          // biome-ignore lint/a11y/useSemanticElements: a styled segmented pill, not a native radio input.
          <button
            key={option.value}
            type="button"
            role="radio"
            aria-checked={selected}
            aria-disabled={option.soon ? true : undefined}
            onClick={() => {
              if (option.soon) return;
              onChange(selected && clearable ? null : option.value);
            }}
            className={cn(
              "inline-flex items-center gap-1.5 rounded-full font-medium whitespace-nowrap transition-colors outline-none focus-visible:ring-2 focus-visible:ring-[var(--brand)] [&_svg]:size-3.5",
              size === "sm" ? "h-6 px-2.5 text-xs" : "h-7 px-3 text-[13px]",
              selected
                ? "bg-[var(--fg)] text-[var(--bg)]"
                : "text-[var(--fg-muted)] hover:text-[var(--fg)]",
              option.soon &&
                "cursor-not-allowed opacity-45 hover:text-[var(--fg-muted)]",
            )}
          >
            {option.icon}
            {option.label}
          </button>
        );
        return option.soon ? (
          <Tip key={option.value} label={option.soon}>
            {button}
          </Tip>
        ) : (
          button
        );
      })}
    </div>
  );
}

export function InfoTip({ label }: { label: string }) {
  return (
    <Tip label={label}>
      <button
        type="button"
        aria-label={label}
        className="inline-flex size-4 items-center justify-center rounded-full text-[var(--fg-subtle)] outline-none hover:text-[var(--fg)] focus-visible:ring-2 focus-visible:ring-[var(--brand)]"
      >
        <Info className="size-3.5" />
      </button>
    </Tip>
  );
}

// A value inside [min, max] on the step grid that starts at min.
export function snapToStep(
  value: number,
  min: number,
  max: number,
  step: number,
): number {
  const clamped = Math.min(max, Math.max(min, value));
  const snapped = min + Math.round((clamped - min) / step) * step;
  return Number(Math.min(max, snapped).toFixed(6));
}

function EditableValue({
  label,
  value,
  shown,
  onCommit,
  parse,
  format,
}: {
  label: string;
  value: number;
  // What the label reads when not editing ("50%", "Auto", "3:00").
  shown: string;
  // Called with the typed number, or null when the text could not be read.
  onCommit: (value: number | null) => void;
  parse: (text: string) => number;
  format: (value: number) => string;
}) {
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState("");
  // Escape and a commit both unmount the field, and unmounting blurs it: only the first counts.
  const settled = useRef(false);
  function finish(commit: boolean) {
    if (settled.current) return;
    settled.current = true;
    setEditing(false);
    if (!commit) return;
    const parsed = parse(text.trim().replace(",", "."));
    onCommit(Number.isFinite(parsed) && text.trim() !== "" ? parsed : null);
  }
  if (editing)
    return (
      <input
        // biome-ignore lint/a11y/noAutofocus: the person just clicked the value to type it.
        autoFocus
        aria-label={label}
        inputMode="decimal"
        value={text}
        onFocus={(event) => event.currentTarget.select()}
        onChange={(event) => setText(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Enter") {
            event.preventDefault();
            finish(true);
          } else if (event.key === "Escape") {
            // Only this field: an open window around it stays open.
            event.preventDefault();
            event.stopPropagation();
            finish(false);
          }
        }}
        onBlur={() => finish(true)}
        className="h-6 w-16 rounded-md bg-[var(--surface-2)] px-1.5 text-right tabular-nums outline-none ring-1 ring-[var(--brand)]"
      />
    );
  return (
    <button
      type="button"
      aria-label={`${label}: ${shown}`}
      title={label}
      onClick={() => {
        settled.current = false;
        setText(format(value));
        setEditing(true);
      }}
      className="-m-1 rounded-md p-1 tabular-nums text-[var(--fg-muted)] outline-none hover:bg-[var(--surface-2)] hover:text-[var(--fg)] focus-visible:ring-2 focus-visible:ring-[var(--brand)]"
    >
      {shown}
    </button>
  );
}

// Slider with 11 ticks, brand thumb and label left; the value on the right is a button that
// turns into a field: type an exact value, Enter commits, Esc cancels, out-of-range values clamp
// (brief section 2.3). `autoAtMin` names the minimum (usually "Auto") where the setting has one.
export function EditableSlider({
  label,
  value,
  onChange,
  min = 0,
  max = 100,
  step = 1,
  display,
  autoAtMin,
  parse = Number,
  format = String,
  caption,
  tip,
  hideLabel,
}: {
  label: string;
  hideLabel?: boolean;
  value: number;
  onChange: (value: number) => void;
  min?: number;
  max?: number;
  step?: number;
  // The value as shown; the number itself when omitted.
  display?: string;
  autoAtMin?: string;
  // Reads typed text (default: a plain number) and writes the number into the field.
  parse?: (text: string) => number;
  format?: (value: number) => string;
  caption?: string;
  tip?: string;
}) {
  const id = useId();
  const pct = ((value - min) / (max - min)) * 100;
  const shown =
    autoAtMin !== undefined && value <= min
      ? autoAtMin
      : (display ?? String(value));
  return (
    <div className="group/slider">
      <div className="mb-1.5 flex items-center justify-between gap-3 text-[13px]">
        <span className="flex items-center gap-1.5">
          <label htmlFor={id} className={cn(hideLabel && "sr-only")}>
            {label}
          </label>
          {tip ? <InfoTip label={tip} /> : null}
        </span>
        <EditableValue
          label={label}
          value={value}
          shown={shown}
          parse={parse}
          format={format}
          onCommit={(typed) => {
            if (typed !== null) onChange(snapToStep(typed, min, max, step));
          }}
        />
      </div>
      <div className="relative h-5">
        <div className="pointer-events-none absolute inset-x-0 top-1/2 flex -translate-y-1/2 justify-between px-[7px]">
          {Array.from({ length: 11 }, (_, i) => (
            <span
              // biome-ignore lint/suspicious/noArrayIndexKey: fixed decorative ticks.
              key={i}
              className={cn(
                "h-2 w-px rounded-full",
                (i / 10) * 100 <= pct
                  ? "bg-[color-mix(in_oklab,var(--brand),transparent_35%)]"
                  : "bg-[var(--hairline)]",
              )}
            />
          ))}
        </div>
        <input
          id={id}
          type="range"
          min={min}
          max={max}
          step={step}
          value={value}
          aria-valuetext={shown}
          onChange={(event) => onChange(Number(event.target.value))}
          className="studio-range absolute inset-0 w-full"
          style={{ "--pct": `${pct}%` } as React.CSSProperties}
        />
      </div>
      {caption ? (
        <p className="mt-1 h-4 text-xs text-[var(--fg-subtle)] opacity-0 transition-opacity group-focus-within/slider:opacity-100 group-hover/slider:opacity-100">
          {caption}
        </p>
      ) : null}
    </div>
  );
}

// Collapsible card in the create panel (surface-1, radius 16, chevron left of the title).
export function PanelCard({
  title,
  open,
  onToggle,
  actions,
  children,
  id,
}: {
  title: string;
  open: boolean;
  onToggle: () => void;
  actions?: ReactNode;
  children: ReactNode;
  id: string;
}) {
  return (
    <section
      aria-labelledby={`${id}-title`}
      className="rounded-2xl bg-[var(--surface-1)] p-4"
    >
      <div className="flex items-center justify-between gap-2">
        <button
          type="button"
          id={`${id}-title`}
          aria-expanded={open}
          aria-controls={`${id}-body`}
          onClick={onToggle}
          className="-m-1 flex items-center gap-1.5 rounded-lg p-1 text-[15px] font-medium outline-none focus-visible:ring-2 focus-visible:ring-[var(--brand)]"
        >
          <ChevronRight
            className={cn(
              "size-4 text-[var(--fg-muted)] transition-transform",
              open && "rotate-90",
            )}
          />
          {title}
        </button>
        {actions ? (
          <div className="flex items-center gap-1">{actions}</div>
        ) : null}
      </div>
      <div id={`${id}-body`} hidden={!open} className="mt-3">
        {children}
      </div>
    </section>
  );
}

export function Counter({
  value,
  max,
  className,
}: {
  value: number;
  max: number;
  className?: string;
}) {
  return (
    <span
      className={cn(
        "text-xs tabular-nums",
        value > max ? "text-[var(--danger)]" : "text-[var(--fg-subtle)]",
        className,
      )}
    >
      {value}/{max}
    </span>
  );
}
