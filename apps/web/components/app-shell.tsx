import { t } from "@mellodifai/shared";
import Link from "next/link";

import { LanguageToggle } from "./language-toggle";

export function AppShell({
  lang,
  children,
}: {
  lang: "it" | "en";
  children: React.ReactNode;
}) {
  return (
    <div className="min-h-screen bg-[#fbfdfc]">
      <header className="border-b bg-white">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-5 py-4">
          <Link
            href="/library"
            className="text-lg font-semibold tracking-tight"
          >
            {t(lang, "app.name")}
            <span className="text-[#7C5CFF]">.</span>
          </Link>
          <nav className="flex items-center gap-4 text-sm">
            <Link href="/library">{t(lang, "nav.library")}</Link>
            <Link
              href="/projects/new"
              className="rounded-lg bg-[#2BD9A0] px-3 py-2 font-medium text-zinc-950"
            >
              {t(lang, "nav.newProject")}
            </Link>
            <LanguageToggle lang={lang} />
          </nav>
        </div>
      </header>
      <main className="mx-auto max-w-6xl px-5 py-8 sm:py-12">{children}</main>
    </div>
  );
}
