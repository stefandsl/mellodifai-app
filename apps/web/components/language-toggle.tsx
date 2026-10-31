"use client";

import { useRouter } from "next/navigation";

import { Button } from "@/components/ui/button";

export function LanguageToggle({ lang }: { lang: "it" | "en" }) {
  const router = useRouter();
  return (
    <Button
      variant="ghost"
      size="sm"
      onClick={() => {
        // biome-ignore lint/suspicious/noDocumentCookie: locale persistence needs a browser cookie.
        document.cookie = `mellodifai_lang=${lang === "it" ? "en" : "it"}; path=/; max-age=31536000`;
        router.refresh();
      }}
    >
      {lang === "it" ? "EN" : "IT"}
    </Button>
  );
}
