import { t, type VersionStatus } from "@mellodifai/shared";
import Link from "next/link";

import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { WorkerBadge } from "@/components/worker-badge";
import { requireProfile } from "@/lib/auth";
import { getLocale } from "@/lib/locale";
import { orderedVersions } from "@/lib/versions";

type Project = {
  id: string;
  topic: string;
  updated_at: string;
  versions: { lang: string; status: VersionStatus }[];
};
export default async function LibraryPage() {
  const [{ supabase }, lang] = await Promise.all([
    requireProfile(),
    getLocale(),
  ]);
  const { data } = await supabase
    .from("projects")
    .select("id, topic, updated_at, versions(lang, status)")
    .order("updated_at", { ascending: false });
  const { data: worker } = await supabase
    .from("workers")
    .select("id,last_seen,busy_job_id,kie_balance")
    .order("last_seen", { ascending: false })
    .limit(1)
    .maybeSingle();
  const projects = (data ?? []) as unknown as Project[];
  return (
    <>
      <div className="mb-8 flex items-start justify-between">
        <div>
          <p className="text-sm text-muted-foreground">
            {t(lang, "nav.library")}
          </p>
          <h1 className="mt-1 text-3xl font-semibold tracking-tight">
            {t(lang, "library.title")}
          </h1>
        </div>
        <WorkerBadge
          workerId={worker?.id}
          balance={worker?.kie_balance ?? null}
          lastSeen={worker?.last_seen ?? null}
          busyJobId={worker?.busy_job_id}
        />
      </div>
      {projects.length === 0 ? (
        <p className="rounded-xl border bg-white p-8 text-muted-foreground">
          {t(lang, "project.empty")}
        </p>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {projects.map((project) => (
            <Link
              href={`/projects/${project.id}`}
              key={project.id}
              className="group block rounded-xl outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-4"
            >
              <Card className="h-full transition hover:-translate-y-0.5 hover:shadow-md">
                <CardHeader>
                  <CardTitle>{project.topic}</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="flex flex-wrap gap-1">
                    {orderedVersions(project.versions).map((version) => (
                      <Badge variant="secondary" key={version.lang}>
                        {version.lang.toUpperCase()} ·{" "}
                        {t(
                          lang,
                          `status.${version.status}` as Parameters<typeof t>[1],
                        )}
                      </Badge>
                    ))}
                  </div>
                  <p className="mt-5 text-xs text-muted-foreground">
                    {t(lang, "library.updated")}{" "}
                    {new Date(project.updated_at).toLocaleDateString(
                      lang === "it" ? "it-IT" : "en-US",
                    )}
                  </p>
                </CardContent>
              </Card>
            </Link>
          ))}
        </div>
      )}
    </>
  );
}
