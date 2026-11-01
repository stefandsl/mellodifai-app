"use client";

import { cn } from "cn";
import { useEffect, useRef } from "react";

import { useLocale } from "@/components/locale-provider";
import { formatClock } from "@/lib/studio/audio-edit";
import { st } from "@/lib/studio/i18n";

const HEIGHT = 168;
// A press that moves less than this is a click (seek), not a new selection.
const DRAG_PX = 4;

function cssColor(element: Element, name: string, fallback: string): string {
  return getComputedStyle(element).getPropertyValue(name).trim() || fallback;
}

export type Range = { start: number; end: number };

// The song's waveform with a range on it and the play position; two handles move the range's
// start and end. "trim" (the audio editor's cut): the kept range bright, the cut parts dim, the
// fades drawn as ramps; a click moves the position. "section" (Riscrivi una parte): the whole
// song stays readable and the part to redo is tinted; dragging across the waveform selects a
// new part, a click moves the position.
export function Waveform({
  peaks,
  duration,
  range,
  fades,
  position,
  onRange,
  onSeek,
  variant = "trim",
  invalid = false,
}: {
  peaks: Float32Array;
  duration: number;
  range: Range;
  fades?: { fadeIn: number; fadeOut: number };
  position: number;
  onRange: (patch: Partial<Range>) => void;
  onSeek: (at: number) => void;
  variant?: "trim" | "section";
  // The section is outside the allowed length: drawn in the danger colour.
  invalid?: boolean;
}) {
  const lang = useLocale();
  const box = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const drag = useRef<{ x: number; at: number; moved: boolean } | null>(null);
  const section = variant === "section";

  useEffect(() => {
    const element = canvas.current;
    const frame = box.current;
    if (!element || !frame) return;
    const draw = () => {
      const width = frame.clientWidth;
      const ratio = window.devicePixelRatio || 1;
      element.width = Math.max(1, Math.round(width * ratio));
      element.height = Math.round(HEIGHT * ratio);
      const g = element.getContext("2d");
      if (!g) return;
      g.setTransform(ratio, 0, 0, ratio, 0, 0);
      g.clearRect(0, 0, width, HEIGHT);
      const bright = cssColor(frame, "--fg", "#f7f4ef");
      const dim = cssColor(frame, "--fg-subtle", "#888");
      const brand = cssColor(
        frame,
        invalid ? "--danger" : "--brand",
        "#f2333d",
      );
      const x = (t: number) => (duration ? (t / duration) * width : 0);
      const startX = x(range.start);
      const endX = x(range.end);
      const step = 3;
      const mid = HEIGHT / 2;
      for (let px = 0; px < width; px += step) {
        const i = Math.min(
          peaks.length - 1,
          Math.floor((px / width) * peaks.length),
        );
        const h = Math.max(1.5, (peaks[i] ?? 0) * (HEIGHT - 16));
        const inside = px + step / 2 >= startX && px + step / 2 <= endX;
        if (section) {
          g.fillStyle = inside ? brand : bright;
          g.globalAlpha = inside ? 0.95 : 0.55;
        } else {
          g.fillStyle = inside ? bright : dim;
          g.globalAlpha = inside ? 0.88 : 0.4;
        }
        g.fillRect(px, mid - h / 2, step - 1, h);
      }
      g.globalAlpha = 1;
      if (fades && !section) {
        // The fades: a line from silence up to full level (and back down).
        g.strokeStyle = brand;
        g.lineWidth = 2;
        g.beginPath();
        if (fades.fadeIn > 0) {
          g.moveTo(startX, HEIGHT - 4);
          g.lineTo(x(range.start + fades.fadeIn), 4);
        }
        if (fades.fadeOut > 0) {
          g.moveTo(x(range.end - fades.fadeOut), 4);
          g.lineTo(endX, HEIGHT - 4);
        }
        g.stroke();
      }
      // The play position.
      g.fillStyle = section ? bright : brand;
      g.fillRect(Math.round(x(position)) - 1, 0, 2, HEIGHT);
    };
    draw();
    const observer = new ResizeObserver(draw);
    observer.observe(frame);
    return () => observer.disconnect();
  }, [peaks, duration, range, fades, position, section, invalid]);

  const timeAt = (clientX: number) => {
    const rect = box.current?.getBoundingClientRect();
    if (!rect?.width) return 0;
    return Math.min(
      duration,
      Math.max(0, ((clientX - rect.left) / rect.width) * duration),
    );
  };

  const handle = (edge: "start" | "end") => {
    const value = range[edge];
    const label = st(
      lang,
      edge === "start" ? "edit.handleStart" : "edit.handleEnd",
    );
    return (
      <div
        role="slider"
        tabIndex={0}
        aria-label={label}
        aria-valuemin={0}
        aria-valuemax={Math.round(duration * 10) / 10}
        aria-valuenow={Math.round(value * 10) / 10}
        aria-valuetext={formatClock(value, true)}
        title={label}
        onPointerDown={(event) => {
          event.preventDefault();
          event.stopPropagation();
          event.currentTarget.setPointerCapture(event.pointerId);
        }}
        onPointerMove={(event) => {
          if (!event.currentTarget.hasPointerCapture(event.pointerId)) return;
          onRange({ [edge]: timeAt(event.clientX) });
        }}
        onKeyDown={(event) => {
          const delta =
            event.key === "ArrowLeft" || event.key === "ArrowDown"
              ? -1
              : event.key === "ArrowRight" || event.key === "ArrowUp"
                ? 1
                : 0;
          if (!delta) return;
          event.preventDefault();
          onRange({ [edge]: value + delta * (event.shiftKey ? 1 : 0.1) });
        }}
        className="group absolute top-0 bottom-0 z-10 -ml-3 flex w-6 cursor-ew-resize touch-none justify-center outline-none"
        style={{ left: `${duration ? (value / duration) * 100 : 0}%` }}
      >
        <span
          className={cn(
            "h-full w-0.5",
            invalid ? "bg-[var(--danger)]" : "bg-[var(--brand)]",
          )}
        />
        <span
          className={cn(
            "absolute top-1/2 h-9 w-3 -translate-y-1/2 rounded-full shadow-md ring-2 ring-[var(--bg)] transition-transform group-hover:scale-110 group-focus-visible:ring-[var(--fg)]",
            invalid ? "bg-[var(--danger)]" : "bg-[var(--brand)]",
          )}
        />
      </div>
    );
  };

  const pct = (t: number) => `${duration ? (t / duration) * 100 : 0}%`;
  return (
    <div
      ref={box}
      className="relative select-none rounded-xl bg-[var(--surface-2)]"
      style={{ height: HEIGHT }}
    >
      <canvas
        ref={canvas}
        role="img"
        aria-label={st(lang, "edit.waveform")}
        onPointerDown={(event) => {
          if (!section) {
            onSeek(timeAt(event.clientX));
            return;
          }
          event.currentTarget.setPointerCapture(event.pointerId);
          drag.current = {
            x: event.clientX,
            at: timeAt(event.clientX),
            moved: false,
          };
        }}
        onPointerMove={(event) => {
          const current = drag.current;
          if (!section || !current) return;
          if (!current.moved && Math.abs(event.clientX - current.x) < DRAG_PX)
            return;
          current.moved = true;
          const at = timeAt(event.clientX);
          onRange({
            start: Math.min(current.at, at),
            end: Math.max(current.at, at),
          });
        }}
        onPointerUp={(event) => {
          const current = drag.current;
          drag.current = null;
          if (section && current && !current.moved)
            onSeek(timeAt(event.clientX));
        }}
        onPointerCancel={() => {
          drag.current = null;
        }}
        className={cn(
          "absolute inset-0 size-full touch-none",
          section ? "cursor-crosshair" : "cursor-text",
        )}
      />
      {section ? (
        // The part to redo, tinted over the bars.
        <div
          aria-hidden
          className={cn(
            "pointer-events-none absolute inset-y-0",
            invalid
              ? "bg-[color-mix(in_oklab,var(--danger),transparent_85%)]"
              : "bg-[color-mix(in_oklab,var(--brand),transparent_85%)]",
          )}
          style={{
            left: pct(range.start),
            width: `calc(${pct(range.end)} - ${pct(range.start)})`,
          }}
        />
      ) : (
        <>
          {/* The cut parts, shaded over the bars. */}
          <div
            aria-hidden
            className="pointer-events-none absolute inset-y-0 left-0 rounded-l-xl bg-[color-mix(in_oklab,var(--bg),transparent_45%)]"
            style={{ width: pct(range.start) }}
          />
          <div
            aria-hidden
            className="pointer-events-none absolute inset-y-0 right-0 rounded-r-xl bg-[color-mix(in_oklab,var(--bg),transparent_45%)]"
            style={{
              width: `${duration ? 100 - (range.end / duration) * 100 : 0}%`,
            }}
          />
        </>
      )}
      {handle("start")}
      {handle("end")}
    </div>
  );
}
