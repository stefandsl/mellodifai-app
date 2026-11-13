"use client";

import { useCallback, useEffect, useSyncExternalStore } from "react";
import { THEME_KEY as KEY } from "@/lib/theme";

export type Theme = "dark" | "light";

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
  useEffect(() => {
    try {
      if (localStorage.getItem(KEY) === "light") {
        document.documentElement.classList.remove("dark");
        document.documentElement.classList.add("light");
      }
    } catch {}
  }, []);
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
