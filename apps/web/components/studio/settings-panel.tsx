"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";

import { useLocale } from "@/components/locale-provider";
import { useTheme } from "@/components/theme-provider";
import { clearComposerDraft } from "@/lib/site/composer-draft";
import { st } from "@/lib/studio/i18n";
import { createClient } from "@/lib/supabase/browser";
import { useGlass } from "./ambient-backdrop";
import { pt } from "./publishing/copy";
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
  canManageAgents = false,
}: {
  email: string;
  canManageAgents?: boolean;
}) {
  const lang = useLocale();
  const router = useRouter();
  const { theme, setTheme } = useTheme();
  const { enabled, setGlass } = useGlass();
  return (
    <section className="rounded-2xl bg-[var(--surface-1)] px-6 py-2">
      {canManageAgents && (
        <Row label="Agenti">
          <Link
            href="/settings/agents"
            className="rounded-full px-3 py-2 outline-none hover:bg-[var(--surface-2)] focus-visible:ring-2 focus-visible:ring-[var(--brand)]"
          >
            Gestisci agenti
          </Link>
        </Row>
      )}
      {canManageAgents && (
        <Row label={pt(lang, "settings")}>
          <Link
            href="/settings/publishing"
            className="rounded-full px-3 py-2 outline-none hover:bg-[var(--surface-2)] focus-visible:ring-2 focus-visible:ring-[var(--brand)]"
          >
            {pt(lang, "rules")}
          </Link>
        </Row>
      )}
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
      <Row label={st(lang, "settings.appearance")}>
        <Segmented
          label={st(lang, "settings.appearance")}
          value={enabled ? "glass" : "classic"}
          onChange={(next) => setGlass(next === "glass")}
          options={[
            { value: "classic", label: st(lang, "appearance.classic") },
            { value: "glass", label: st(lang, "appearance.glass") },
          ]}
        />
      </Row>
      <Row label={st(lang, "settings.account")}>
        <span className="flex items-center gap-3">
          <span className="text-[var(--fg-muted)]">{email}</span>
          <button
            type="button"
            onClick={async () => {
              clearComposerDraft();
              await createClient().auth.signOut();
              router.push("/login");
              router.refresh();
            }}
            className="h-8 rounded-full bg-[var(--surface-2)] px-3 text-[13px] outline-none hover:text-[var(--danger)] focus-visible:ring-2 focus-visible:ring-[var(--brand)]"
          >
            {st(lang, "nav.signOut")}
          </button>
        </span>
      </Row>
    </section>
  );
}
