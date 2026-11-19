import { LyricPackSchema, publicationDefaults } from "@mellodifai/shared";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { pt } from "@/components/studio/publishing/copy";
import { PublishDashboard } from "@/components/studio/publishing/publish-dashboard";
import { StudioPage } from "@/components/studio/studio-shell";
import { requireProfile } from "@/lib/auth";
import { getLocale } from "@/lib/locale";
import { mediaUrl } from "@/lib/media";
import { sessionCtx } from "@/lib/ops/context";
import { publishStatus } from "@/lib/ops/defs/publishing";
import { runOp } from "@/lib/ops/run";
import { orderedVersions, selectedVersion } from "@/lib/versions";

export const metadata: Metadata = { title: "Pubblica" };

const OPEN = ["draft", "awaiting_approval", "scheduled", "publishing", "held"];

// "Pubblica": one video (the language version in ?lang), its platforms, the title and thumbnail
// pairing, the slot, the veto window, the approval card and the history.
export default async function PublishPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ lang?: string }>;
}) {
  const [{ id }, query, { supabase, profile }, lang] = await Promise.all([
    params,
    searchParams,
    requireProfile(),
    getLocale(),
  ]);
  const { data: project } = await supabase
    .from("projects")
    .select(
      "id,topic,mood,song_settings,versions(id,lang,status,display_title,lyric_pack,storyboard_sections,render_attempt)",
    )
    .eq("id", id)
    .maybeSingle();
  if (!project) notFound();
  const versions = orderedVersions(
    project.versions as unknown as {
      id: string;
      lang: string;
      status: string;
      display_title: string | null;
      lyric_pack: unknown;
      storyboard_sections: unknown;
      render_attempt: number;
    }[],
  );
  const current = selectedVersion(versions, query.lang);
  if (!current) notFound();
  const back = (
    <Link
      href={`/projects/${id}?lang=${current.lang}`}
      className="text-sm underline-offset-4 hover:underline"
    >
      {pt(lang, "back")}
    </Link>
  );
  const pack = LyricPackSchema.safeParse(current.lyric_pack);
  const songTitle =
    current.display_title || (pack.success ? pack.data.title : project.topic);
  const ctx = await sessionCtx().catch(() => null);
  const status =
    ctx && !ctx.remote && profile.role === "admin"
      ? await runOp(publishStatus, ctx, { version_id: current.id })
      : null;
  if (!status?.ok || "committed" in status)
    return (
      <StudioPage title={pt(lang, "title")} eyebrow={songTitle} actions={back}>
        <p className="text-muted-foreground">{pt(lang, "notAdmin")}</p>
      </StudioPage>
    );
  const schedules = status.data.schedules;
  const open = schedules.find((plan) => OPEN.includes(plan.state)) ?? null;
  // The newest plan stays on screen until a new one starts (published, vetoed, rejected...).
  const shown = open ?? schedules[0] ?? null;
  const past = schedules.filter((plan) => plan !== shown);
  const defaults = publicationDefaults(
    songTitle,
    pack.success ? pack.data.lyrics : "",
    current.lang,
    current.storyboard_sections,
    (project as { mood?: string | null }).mood ?? "",
  );
  // The master's thumbnail, signed like the project page does it.
  const { data: master } = await supabase
    .from("renders")
    .select("preview_path,qa_results")
    .eq("version_id", current.id)
    .eq("render_attempt", current.render_attempt)
    .eq("kind", "master")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  async function signed(path: string | null | undefined) {
    if (!path) return null;
    const { data } = await supabase.storage
      .from("previews")
      .createSignedUrl(path, 3600);
    return data?.signedUrl ? mediaUrl(path) : null;
  }
  const folder = master?.preview_path?.includes("/")
    ? master.preview_path.slice(0, master.preview_path.lastIndexOf("/"))
    : null;
  const thumbnailUrl =
    (await signed(
      (master?.qa_results as { assets?: { thumbnail_path?: string } } | null)
        ?.assets?.thumbnail_path,
    )) ??
    (folder
      ? ((await signed(`${folder}/thumbnail-1280x720.png`)) ??
        (await signed(`${folder}/thumbnail.png`)))
      : null);
  return (
    <StudioPage title={pt(lang, "title")} eyebrow={songTitle} actions={back}>
      <PublishDashboard
        versionId={current.id}
        songTitle={songTitle}
        canPublish={["approved", "publishing", "published"].includes(
          current.status,
        )}
        thumbnailUrl={thumbnailUrl}
        defaults={{
          title: defaults.title,
          description: defaults.description,
          tags: defaults.tags
            .split(",")
            .map((tag) => tag.trim())
            .filter(Boolean),
          thumbnail_text: "",
        }}
        current={shown}
        past={past}
      />
    </StudioPage>
  );
}
