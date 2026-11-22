"use client";

import { Theme } from "@astryxdesign/core/theme";
import { useEffect, useState } from "react";
import { THEME_KEY } from "@/lib/theme";
import { defaultThemeSlug, themes } from "@/src/astryx-themes";

// The site draws dark, like the studio. A visitor who chose the light look in the studio
// (the same stored choice, lib/theme.ts) gets the light mode of the same theme.
export function SiteTheme({ children }: { children: React.ReactNode }) {
  const [mode, setMode] = useState<"dark" | "light">("dark");
  useEffect(() => {
    try {
      if (localStorage.getItem(THEME_KEY) === "light") setMode("light");
    } catch {
      // Storage can be blocked; the dark look stays.
    }
  }, []);
  return (
    <Theme theme={themes[defaultThemeSlug]} mode={mode}>
      {children}
    </Theme>
  );
}
