import { t } from "@mellodifai/shared";

import { LoginForm } from "@/components/login-form";
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
    <main className="grid min-h-screen place-items-center bg-[#fbfdfc] p-5">
      <section className="w-full max-w-md rounded-2xl border bg-white p-7 shadow-sm">
        <p className="text-lg font-semibold">
          {t(lang, "app.name")}
          <span className="text-[#7C5CFF]">.</span>
        </p>
        <h1 className="mt-8 text-2xl font-semibold">
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
          <p className="mt-6 rounded-lg border border-dashed p-3 text-sm text-muted-foreground">
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
