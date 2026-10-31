"use client";
import { createContext, useContext } from "react";

const Locale = createContext<"it" | "en">("it");
export const LocaleProvider = Locale.Provider;
export function useLocale() {
  return useContext(Locale);
}
