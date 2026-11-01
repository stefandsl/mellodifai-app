"use client";

import { useEffect, useRef } from "react";

import { useLocale } from "@/components/locale-provider";
import { type EditParams, formatClock } from "@/lib/studio/audio-edit";
import { st } from "@/lib/studio/i18n";

const HEIGHT = 168;

function cssColor(element: Element, name: string, fallback: string): string {
  return getComputedStyle(element).getPropertyValue(name).trim() || fallback;
}

// The song's waveform with the kept part bright, the cut parts dim, the fades as ramps and the
// play position. Two handles move the start and the end; a click elsewhere moves the position.
export function Waveform({
  peaks,
  duration,
  params,
  position,
  onParams,
  onSeek,
}: {
  peaks: Float32Array;
  duration: number;
  params: EditParams;
  position: number;
  onParams: (patch: Partial<EditParams>) => void;
  onSeek: (at: number) => void;
}) {
  const lang = useLocale();
  const box = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);

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
      const brand = cssColor(frame, "--brand", "#f2333d");
      const x = (t: number) => (duration ? (t / duration) * width : 0);
      const startX = x(params.start);
      const endX = x(params.end);
      const step = 3;
      const mid = HEIGHT / 2;
      for (let px = 0; px < width; px += step) {
        const i = Math.min(
          peaks.length - 1,
          Math.floor((px / width) * peaks.length),
        );
        const h = Math.max(1.5, (peaks[i] ?? 0) * (HEIGHT - 16));
        const inside = px + step / 2 >= startX && px + step / 2 <= endX;
        g.fillStyle = inside ? bright : dim;
        g.globalAlpha = inside ? 0.88 : 0.4;
        g.fillRect(px, mid - h / 2, step - 1, h);
      }
      g.globalAlpha = 1;
      // The fades: a line from silence up to full level (and back down).
      g.strokeStyle = brand;
      g.lineWidth = 2;
      g.beginPath();
      if (params.fadeIn > 0) {
        g.moveTo(startX, HEIGHT - 4);
        g.lineTo(x(params.start + params.fadeIn), 4);
      }
      if (params.fadeOut > 0) {
        g.moveTo(x(params.end - params.fadeOut), 4);
        g.lineTo(endX, HEIGHT - 4);
      }
      g.stroke();
      // The play position.
      g.fillStyle = brand;
      g.fillRect(Math.round(x(position)) - 1, 0, 2, HEIGHT);
    };
    draw();
    const observer = new ResizeObserver(draw);
    observer.observe(frame);
    return () => observer.disconnect();
  }, [peaks, duration, params, position]);

  const timeAt = (clientX: number) => {
    const rect = box.current?.getBoundingClientRect();
    if (!rect?.width) return 0;
    return Math.min(
      duration,
      Math.max(0, ((clientX - rect.left) / rect.width) * duration),
    );
  };

  const handle = (edge: "start" | "end") => {
    const value = params[edge];
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
          onParams({ [edge]: timeAt(event.clientX) });
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
          onParams({ [edge]: value + delta * (event.shiftKey ? 1 : 0.1) });
        }}
        className="group absolute top-0 bottom-0 z-10 -ml-3 flex w-6 cursor-ew-resize touch-none justify-center outline-none"
        style={{ left: `${duration ? (value / duration) * 100 : 0}%` }}
      >
        <span className="h-full w-0.5 bg-[var(--brand)]" />
        <span className="absolute top-1/2 h-9 w-3 -translate-y-1/2 rounded-full bg-[var(--brand)] shadow-md ring-2 ring-[var(--bg)] transition-transform group-hover:scale-110 group-focus-visible:ring-[var(--fg)]" />
      </div>
    );
  };

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
        onPointerDown={(event) => onSeek(timeAt(event.clientX))}
        className="absolute inset-0 size-full cursor-text"
      />
      {/* The cut parts, shaded over the bars. */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-y-0 left-0 rounded-l-xl bg-[color-mix(in_oklab,var(--bg),transparent_45%)]"
        style={{ width: `${duration ? (params.start / duration) * 100 : 0}%` }}
      />
      <div
        aria-hidden
        className="pointer-events-none absolute inset-y-0 right-0 rounded-r-xl bg-[color-mix(in_oklab,var(--bg),transparent_45%)]"
        style={{
          width: `${duration ? 100 - (params.end / duration) * 100 : 0}%`,
        }}
      />
      {handle("start")}
      {handle("end")}
    </div>
  );
}
