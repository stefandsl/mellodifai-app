import { t } from "@mellodifai/shared";
import Link from "next/link";
import { notFound } from "next/navigation";
import { LiveTimeline, type TimelineJob } from "@/components/live-timeline";
import {
  ProjectWorkspace,
  type PublicationView,
  type RenderPreview,
  type WorkspaceVersion,
} from "@/components/project-workspace";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { requireProfile } from "@/lib/auth";
import { getLocale } from "@/lib/locale";
export default async function ProjectPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ lang?: string }>;
}) {
  const [{ id }, query, { supabase }, lang] = await Promise.all([
    params,
    searchParams,
    requireProfile(),
    getLocale(),
  ]);
  const { data: project } = await supabase
    .from("projects")
    .select(
      "id,topic,brief,versions(id,lang,status,lyric_pack,generation_count,render_attempt,storyboard_sections)",
    )
    .eq("id", id)
    .maybeSingle();
  if (!project) notFound();
  const versions = project.versions as unknown as WorkspaceVersion[];
  const current = versions.find((v) => v.lang === query.lang) ?? versions[0];
  if (!current) notFound();
  const [{ data: jobs }, { data: takes }, { data: renderRows }] =
    await Promise.all([
      supabase
        .from("jobs")
        .select("id,version_id,stage,status,created_at,error")
        .eq("version_id", current.id)
        .order("created_at"),
      supabase
        .from("takes")
        .select("id,audio_preview_path,scores")
        .eq("version_id", current.id)
        .eq("generation", current.generation_count)
        .order("take_number"),
      supabase
        .from("renders")
        .select("id,kind,preview_path,qa_results")
        .eq("version_id", current.id)
        .eq("render_attempt", current.render_attempt)
        .order("created_at", { ascending: false }),
    ]);
  const ids = (jobs ?? []).map((j) => j.id);
  const { data: events } = ids.length
    ? await supabase
        .from("job_events")
        .select("id,job_id,message,progress")
        .in("job_id", ids)
        .order("id", { ascending: false })
        .limit(200)
    : { data: [] };
  async function signed(path: string | null) {
    if (!path) return null;
    const { data } = await supabase.storage
      .from("previews")
      .createSignedUrl(path, 3600);
    return data?.signedUrl ?? null;
  }
  const renders = await Promise.all(
    (renderRows ?? []).map(async (r) => ({
      ...r,
      previewUrl: await signed(r.preview_path),
    })),
  );
  const takeData = await Promise.all(
    (takes ?? []).map(async (take) => ({
      ...take,
      audioUrl: await signed(take.audio_preview_path),
    })),
  );
  const master = renders.find((r) => r.kind === "master");
  const { data: publication } = master
    ? await supabase
        .from("publications")
        .select("id,youtube_video_id,privacy,metadata")
        .eq("render_id", master.id)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle()
    : { data: null };
  const failedJob = (jobs ?? []).filter((j) => j.status === "failed").at(-1);
  return (
    <>
      <div className="mb-8">
        <p>{t(lang, "project.label")}</p>
        <h1 className="text-3xl font-semibold">{project.topic}</h1>
        <nav className="mt-5 flex flex-wrap gap-2">
          {versions.map((v) => (
            <Link
              key={v.id}
              href={`/projects/${id}?lang=${v.lang}`}
              aria-current={v.id === current.id ? "page" : undefined}
            >
              <Badge variant={v.id === current.id ? "secondary" : "outline"}>
                {v.lang.toUpperCase()}
              </Badge>
            </Link>
          ))}
        </nav>
      </div>
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_22rem]">
        <Card>
          <CardHeader>
            <CardTitle>
              {current.lang.toUpperCase()} {t(lang, `status.${current.status}`)}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <ProjectWorkspace
              key={current.id + current.status}
              version={current}
              takes={takeData}
              renders={renders as RenderPreview[]}
              publication={publication as PublicationView | null}
              brief={project.brief ?? ""}
              failedJob={failedJob}
            />
          </CardContent>
        </Card>
        <aside className="rounded-xl border bg-white p-5">
          <h2>{t(lang, "pipeline.title")}</h2>
          <LiveTimeline
            key={current.id}
            versionId={current.id}
            status={current.status}
            initialJobs={(jobs ?? []) as TimelineJob[]}
            initialEvents={(events ?? []).toReversed()}
          />
        </aside>
      </div>
    </>
  );
}
