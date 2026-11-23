"use client";

import { useEffect } from "react";
import { THEME_KEY } from "@/lib/theme";

// The site draws dark, like the studio. A visitor who chose the light look in the studio
// (the same stored choice, lib/theme.ts) gets the light mode of the same theme.
export function SiteThemeSync() {
  useEffect(() => {
    try {
      if (localStorage.getItem(THEME_KEY) === "light") {
        document.documentElement.setAttribute("data-theme", "light");
      }
    } catch {
      // Storage can be blocked; the dark look stays.
    }
  }, []);
  return null;
}
