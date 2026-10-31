import { t } from "@mellodifai/shared";

import { LoginForm } from "@/components/login-form";
import { Logo } from "@/components/studio/sidebar";
import { getLocale } from "@/lib/locale";

// The local Supabase stack delivers auth mail to Mailpit, never to a real inbox.
function localInbox() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
  if (process.env.NODE_ENV !== "development") return undefined;
  const match = /^http:\/\/(127\.0\.0\.1|localhost):54321\/?$/u.exec(url);
  return match ? `http://${match[1]}:54324` : undefined;
}

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ message?: string }>;
}) {
  const lang = await getLocale();
  const params = await searchParams;
  return (
    <main className="relative grid min-h-dvh place-items-center overflow-hidden bg-[var(--bg)] p-5">
      <div
        aria-hidden
        className="pointer-events-none absolute -top-40 left-1/2 h-80 w-[36rem] -translate-x-1/2 rounded-full bg-[var(--brand)] opacity-[0.12] blur-3xl"
      />
      <section className="relative w-full max-w-md rounded-3xl bg-[var(--surface-1)] p-7 ring-1 ring-[var(--hairline)] sm:p-8">
        <Logo />
        <h1 className="mt-8 text-2xl font-medium tracking-tight">
          {t(lang, "auth.sendLink")}
        </h1>
        {params.message && (
          <p role="alert" className="mt-3 text-sm text-destructive">
            {t(
              lang,
              params.message === "invalid-link"
                ? "auth.invalidLink"
                : "auth.notAllowed",
            )}
          </p>
        )}
        <LoginForm lang={lang} />
        {localInbox() && (
          <p className="mt-6 rounded-xl border border-dashed border-[var(--hairline)] p-3 text-sm text-muted-foreground">
            {t(lang, "auth.devInbox")}{" "}
            <a
              className="font-medium text-foreground underline"
              href={localInbox()}
              target="_blank"
              rel="noreferrer"
            >
              {localInbox()}
            </a>
          </p>
        )}
      </section>
    </main>
  );
}
