import { t } from "@mellodifai/shared";

import { ProjectForm } from "@/components/project-form";
import { requireProfile } from "@/lib/auth";
import { getLocale } from "@/lib/locale";

export default async function NewProjectPage() {
  const [{ supabase }, lang] = await Promise.all([
    requireProfile(),
    getLocale(),
  ]);
  const { data: worker } = await supabase
    .from("workers")
    .select("kie_balance")
    .order("last_seen", { ascending: false })
    .limit(1)
    .maybeSingle();
  return (
    <section className="mx-auto max-w-2xl">
      <p className="text-sm text-muted-foreground">
        {t(lang, "nav.newProject")}
      </p>
      <h1 className="mt-1 text-3xl font-semibold">
        {t(lang, "project.heading")}
      </h1>
      <p className="mt-2 text-muted-foreground">
        {t(lang, "project.subtitle")}
      </p>
      <div className="mt-8 rounded-2xl border bg-white p-5 sm:p-7">
        <ProjectForm balance={worker?.kie_balance ?? null} />
      </div>
    </section>
  );
}
