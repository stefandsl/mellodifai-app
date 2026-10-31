"use client";

import { useCallback, useSyncExternalStore } from "react";

export type Theme = "dark" | "light";
const KEY = "mellodifai-theme";

// Runs before paint from the server-rendered <head>, so the saved theme never flashes.
export const THEME_SCRIPT = `try{var t=localStorage.getItem("${KEY}");var c=document.documentElement.classList;if(t==="light"){c.remove("dark");c.add("light")}}catch(e){}`;

function read(): Theme {
  return document.documentElement.classList.contains("light")
    ? "light"
    : "dark";
}

function subscribe(onChange: () => void) {
  const observer = new MutationObserver(onChange);
  observer.observe(document.documentElement, {
    attributes: true,
    attributeFilter: ["class"],
  });
  return () => observer.disconnect();
}

// The theme lives on <html>: dark is the default, light is opt-in and remembered.
export function useTheme() {
  const theme = useSyncExternalStore<Theme | null>(subscribe, read, () => null);
  const setTheme = useCallback((next: Theme) => {
    const classes = document.documentElement.classList;
    classes.toggle("light", next === "light");
    classes.toggle("dark", next === "dark");
    try {
      localStorage.setItem(KEY, next);
    } catch {}
  }, []);
  return { theme, setTheme };
}
