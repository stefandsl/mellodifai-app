import { t } from "@mellodifai/shared";

import { LoginForm } from "@/components/login-form";
import { getLocale } from "@/lib/locale";

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
          mellodifai<span className="text-[#7C5CFF]">.</span>
        </p>
        <h1 className="mt-8 text-2xl font-semibold">
          {t(lang, "auth.sendLink")}
        </h1>
        {params.message === "not-allowed" && (
          <p role="alert" className="mt-3 text-sm text-destructive">
            {t(lang, "auth.notAllowed")}
          </p>
        )}
        <LoginForm lang={lang} />
      </section>
    </main>
  );
}
