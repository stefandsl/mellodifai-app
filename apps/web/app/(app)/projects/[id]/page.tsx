import type { LyricPack, VersionStatus } from "@mellodifai/shared";
import Link from "next/link";
import { notFound } from "next/navigation";

import { LiveTimeline } from "@/components/live-timeline";
import { ProjectWorkspace } from "@/components/project-workspace";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { requireProfile } from "@/lib/auth";

type Version = {
  id: string;
  lang: string;
  status: VersionStatus;
  lyric_pack: LyricPack | null;
};
type RenderRow = {
  id: string;
  kind: string;
  preview_path: string | null;
  qa_results: Record<string, boolean>;
};
type TakeRow = {
  id: string;
  audio_preview_path: string | null;
  scores: Record<string, unknown> | null;
};

async function signedUrl(
  supabase: Awaited<ReturnType<typeof requireProfile>>["supabase"],
  path: string | null,
) {
  if (!path) return null;
  const { data } = await supabase.storage
    .from("previews")
    .createSignedUrl(path, 60 * 60);
  return data?.signedUrl ?? null;
}

export default async function ProjectPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ lang?: string }>;
}) {
  const [{ id }, query, { supabase }] = await Promise.all([
    params,
    searchParams,
    requireProfile(),
  ]);
  const { data: project } = await supabase
    .from("projects")
    .select("id, topic, versions(id, lang, status, lyric_pack)")
    .eq("id", id)
    .maybeSingle();
  if (!project) notFound();
  const versions = (project.versions ?? []) as unknown as Version[];
  const current =
    versions.find((version) => version.lang === query.lang) ?? versions[0];
  if (!current) notFound();
  const [
    { data: jobs },
    { data: events },
    { data: takes },
    { data: renderRows },
  ] = await Promise.all([
    supabase
      .from("jobs")
      .select("id, stage, status, created_at")
      .eq("version_id", current.id)
      .order("created_at"),
    supabase
      .from("job_events")
      .select("id, job_id, message, progress")
      .order("at"),
    supabase
      .from("takes")
      .select("id, audio_preview_path, scores")
      .eq("version_id", current.id),
    supabase
      .from("renders")
      .select("id, kind, preview_path, qa_results")
      .eq("version_id", current.id),
  ]);
  const renders = await Promise.all(
    ((renderRows ?? []) as unknown as RenderRow[]).map(async (render) => ({
      ...render,
      previewUrl: await signedUrl(supabase, render.preview_path),
    })),
  );
  const takeData = await Promise.all(
    ((takes ?? []) as unknown as TakeRow[]).map(async (take) => ({
      id: take.id,
      audioUrl: await signedUrl(supabase, take.audio_preview_path),
      scores: take.scores,
    })),
  );
  const master = renders.find((render) => render.kind === "master");
  const { data: publication } = master
    ? await supabase
        .from("publications")
        .select("id, youtube_video_id, privacy")
        .eq("render_id", master.id)
        .maybeSingle()
    : { data: null };
  return (
    <>
      <div className="mb-8">
        <p className="text-sm text-muted-foreground">Progetto</p>
        <h1 className="mt-1 text-3xl font-semibold">{project.topic}</h1>
        <div className="mt-5 flex flex-wrap gap-2">
          {versions.map((version) => (
            <Link
              key={version.id}
              href={`/projects/${id}?lang=${version.lang}`}
            >
              <Badge
                variant={version.id === current.id ? "default" : "outline"}
              >
                {version.lang.toUpperCase()}
              </Badge>
            </Link>
          ))}
        </div>
      </div>
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_22rem]">
        <Card>
          <CardHeader>
            <CardTitle>
              {current.lang.toUpperCase()}{" "}
              <span className="text-sm font-normal text-muted-foreground">
                {current.status}
              </span>
            </CardTitle>
          </CardHeader>
          <CardContent>
            <ProjectWorkspace
              version={current}
              takes={takeData}
              renders={renders}
              publication={
                publication as {
                  id: string;
                  youtube_video_id: string | null;
                  privacy: "public" | "unlisted" | "scheduled" | "private";
                } | null
              }
            />
          </CardContent>
        </Card>
        <aside className="rounded-xl border bg-white p-5">
          <h2 className="mb-4 font-semibold">Pipeline</h2>
          <LiveTimeline
            projectId={id}
            initialJobs={(jobs ?? []) as never[]}
            initialEvents={(events ?? []) as never[]}
          />
        </aside>
      </div>
    </>
  );
}
