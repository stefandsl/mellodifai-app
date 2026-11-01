"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";

import { exportBackup } from "@/app/actions/backup";

import { useLocale } from "@/components/locale-provider";
import { useTheme } from "@/components/theme-provider";
import { st } from "@/lib/studio/i18n";
import { createClient } from "@/lib/supabase/browser";
import { Segmented } from "./ui";

function Row({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[var(--hairline)] py-4 last:border-0">
      <span>{label}</span>
      {children}
    </div>
  );
}

export function SettingsPanel({
  email,
  canBackup = false,
}: {
  email: string;
  canBackup?: boolean;
}) {
  const lang = useLocale();
  const [backingUp, setBackingUp] = useState(false);
  const router = useRouter();
  const { theme, setTheme } = useTheme();
  return (
    <section className="rounded-2xl bg-[var(--surface-1)] px-6 py-2">
      <Row label={st(lang, "settings.language")}>
        <Segmented
          label={st(lang, "settings.language")}
          value={lang}
          onChange={(next) => {
            if (!next || next === lang) return;
            // biome-ignore lint/suspicious/noDocumentCookie: locale persistence needs a browser cookie.
            document.cookie = `mellodifai_lang=${next}; path=/; max-age=31536000`;
            router.refresh();
          }}
          options={[
            { value: "it", label: "Italiano" },
            { value: "en", label: "English" },
          ]}
        />
      </Row>
      <Row label={st(lang, "settings.theme")}>
        <Segmented
          label={st(lang, "settings.theme")}
          value={theme}
          onChange={(next) => next && setTheme(next)}
          options={[
            { value: "dark", label: st(lang, "theme.dark") },
            { value: "light", label: st(lang, "theme.light") },
          ]}
        />
      </Row>
      <Row label={st(lang, "settings.account")}>
        <span className="flex items-center gap-3">
          <span className="text-[var(--fg-muted)]">{email}</span>
          <button
            type="button"
            onClick={async () => {
              await createClient().auth.signOut();
              router.push("/login");
              router.refresh();
            }}
            className="h-8 rounded-full bg-[var(--surface-2)] px-3 text-[13px] hover:text-[var(--danger)]"
          >
            {st(lang, "nav.signOut")}
          </button>
        </span>
      </Row>
      {canBackup ? (
        <Row label={st(lang, "settings.backup")}>
          <button
            type="button"
            disabled={backingUp}
            onClick={async () => {
              setBackingUp(true);
              const result = await exportBackup();
              setBackingUp(false);
              if (result.ok)
                toast.success(
                  `${st(lang, "settings.backupDone")} ${result.dir}`,
                );
              else toast.error(result.error);
            }}
            className="h-8 rounded-full bg-[var(--surface-2)] px-3 text-[13px] disabled:opacity-60"
          >
            {st(
              lang,
              backingUp ? "settings.backupRunning" : "settings.backupExport",
            )}
          </button>
        </Row>
      ) : null}
    </section>
  );
}
