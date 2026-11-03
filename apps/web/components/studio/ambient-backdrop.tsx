"use client";

import { useEffect, useRef, useState } from "react";
import {
  type Color,
  colorCss,
  coverColors,
  guardColor,
} from "@/lib/studio/ambient";
import { usePlayer } from "@/store/player";

const cache = new Map<string, Color[]>();
const fallback: Color[] = [
  [94, 42, 64],
  [35, 67, 101],
  [85, 57, 104],
];

export function useGlass() {
  const [enabled, setEnabled] = useState(false);
  useEffect(() => {
    try {
      if (localStorage.getItem("mellodifai-glass") === "on")
        document.documentElement.classList.add("glass");
    } catch {}
    const sync = () =>
      setEnabled(document.documentElement.classList.contains("glass"));
    sync();
    const observer = new MutationObserver(sync);
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["class"],
    });
    return () => observer.disconnect();
  }, []);
  const setGlass = (next: boolean) => {
    document.documentElement.classList.toggle("glass", next);
    try {
      localStorage.setItem("mellodifai-glass", next ? "on" : "off");
    } catch {}
    setEnabled(next);
  };
  return { enabled, setGlass };
}

export function AmbientBackdrop() {
  const track = usePlayer((state) => state.queue[state.index]);
  const { enabled } = useGlass();
  const [palette, setPalette] = useState<Color[]>(fallback);
  const [previous, setPrevious] = useState<Color[] | null>(null);
  const lastPalette = useRef<Color[] | null>(null);
  const [light, setLight] = useState(false);

  useEffect(() => {
    const sync = () =>
      setLight(document.documentElement.classList.contains("light"));
    sync();
    const observer = new MutationObserver(sync);
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["class"],
    });
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    const sync = () => {
      document.documentElement.dataset.pageHidden = String(document.hidden);
    };
    sync();
    document.addEventListener("visibilitychange", sync);
    return () => document.removeEventListener("visibilitychange", sync);
  }, []);

  useEffect(() => {
    if (!enabled) return;
    const url = track?.coverUrl;
    if (!url) {
      setPalette(fallback);
      return;
    }
    const saved = cache.get(url);
    if (saved) {
      setPalette(saved);
      return;
    }
    let cancelled = false;
    const image = new Image();
    image.crossOrigin = "anonymous";
    image.onload = () => {
      try {
        const canvas = document.createElement("canvas");
        canvas.width = 36;
        canvas.height = 36;
        const context = canvas.getContext("2d", { willReadFrequently: true });
        if (!context) return;
        context.drawImage(image, 0, 0, 36, 36);
        const colors = coverColors(context.getImageData(0, 0, 36, 36));
        cache.set(url, colors);
        if (!cancelled) setPalette(colors);
      } catch {
        if (!cancelled) setPalette(fallback);
      }
    };
    image.onerror = () => {
      if (!cancelled) setPalette(fallback);
    };
    image.src = url;
    return () => {
      cancelled = true;
    };
  }, [enabled, track?.coverUrl]);

  useEffect(() => {
    if (!enabled) return;
    const colors = palette.map((color) => colorCss(guardColor(color, light)));
    const root = document.documentElement;
    colors.forEach((color, index) => {
      root.style.setProperty(`--ambient-${index + 1}`, color);
    });
  }, [enabled, palette, light]);

  useEffect(() => {
    if (!enabled) return;
    setPrevious(lastPalette.current);
    lastPalette.current = palette;
    const timer = window.setTimeout(() => setPrevious(null), 480);
    return () => window.clearTimeout(timer);
  }, [enabled, palette]);

  if (!enabled) return null;
  const background = (colors: Color[]) => ({
    background: `radial-gradient(ellipse at 18% 18%, ${colorCss(guardColor(colors[0], light))}, transparent 58%), radial-gradient(ellipse at 85% 12%, ${colorCss(guardColor(colors[1], light))}, transparent 60%), radial-gradient(ellipse at 55% 85%, ${colorCss(guardColor(colors[2], light))}, transparent 62%)`,
  });
  return (
    <div
      aria-hidden
      className="ambient-backdrop pointer-events-none absolute inset-0 overflow-hidden"
    >
      {previous && (
        <div className="absolute inset-0" style={background(previous)} />
      )}
      <div
        key={`${track?.id ?? "idle"}-${palette.join()}`}
        className="ambient-enter absolute inset-0"
        style={background(palette)}
      />
    </div>
  );
}
