import type { Lang, VersionStatus } from "@mellodifai/shared";
import type { SupabaseClient } from "@supabase/supabase-js";

// One card in the studio feed: a language version of a project, with signed media URLs.
export type Clip = {
  id: string;
  projectId: string;
  lang: Lang;
  title: string;
  style: string;
  prompt: string;
  lyrics: string;
  model: string;
  status: VersionStatus;
  createdAt: string;
  updatedAt: string;
  audioUrl: string | null;
  videoUrl: string | null;
  hookUrl: string | null;
  href: string;
  // CSS background: the pipeline thumbnail when there is one, else a generated gradient.
  art: string;
  settings: Record<string, unknown>;
};

type Row = {
  id: string;
  lang: Lang;
  status: VersionStatus;
  created_at: string;
  updated_at: string;
  lyric_pack: {
    title?: string;
    style?: string;
    lyrics?: string;
    settings?: { model?: string };
  } | null;
  chosen_take_id: string | null;
  generation_count: number;
  render_attempt: number;
  projects: {
    id: string;
    topic: string;
    style: string | null;
    brief: string | null;
    song_settings: Record<string, unknown> | null;
  } | null;
};

// A stable artwork gradient per song until generated covers exist.
export function artFor(id: string): string {
  let hash = 0;
  for (const char of id) hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  const hue = 345 + (hash % 50);
  const hue2 = (hue + 25 + ((hash >> 8) % 60)) % 360;
  const angle = hash % 360;
  return `linear-gradient(${angle}deg, hsl(${hue % 360} 78% 46%), hsl(${hue2} 70% 22%) 70%, #101012)`;
}

function coverArt(cover: string | null | undefined, id: string): string {
  return cover
    ? `center / cover no-repeat url("${cover.replaceAll('"', "%22")}"), ${artFor(id)}`
    : artFor(id);
}

const STATUS_WITH_ACTION: VersionStatus[] = [
  "lyrics_review",
  "takes_review",
  "video_review",
];
export function needsAction(status: VersionStatus): boolean {
  return STATUS_WITH_ACTION.includes(status);
}

export async function loadClips(
  supabase: SupabaseClient,
  limit = 200,
): Promise<Clip[]> {
  const { data } = await supabase
    .from("versions")
    .select(
      "id,lang,status,created_at,updated_at,lyric_pack,chosen_take_id,generation_count,render_attempt,projects(id,topic,style,brief,song_settings)",
    )
    .order("created_at", { ascending: false })
    .limit(limit);
  const rows = (data ?? []) as unknown as Row[];
  if (rows.length === 0) return [];
  const ids = rows.map((row) => row.id);
  const [{ data: takes }, { data: renders }] = await Promise.all([
    supabase
      .from("takes")
      .select("id,version_id,audio_preview_path,generation,take_number")
      .in("version_id", ids),
    supabase
      .from("renders")
      .select("version_id,kind,preview_path,render_attempt,created_at")
      .in("version_id", ids)
      .order("created_at", { ascending: false }),
  ]);

  const audioPath = new Map<string, string>();
  for (const row of rows) {
    const own = (takes ?? []).filter(
      (take) => take.version_id === row.id && take.audio_preview_path,
    );
    const take =
      own.find((item) => item.id === row.chosen_take_id) ??
      own
        .filter((item) => item.generation === row.generation_count)
        .sort((a, b) => (a.take_number ?? 0) - (b.take_number ?? 0))[0];
    if (take?.audio_preview_path)
      audioPath.set(row.id, take.audio_preview_path);
  }
  const renderPath = new Map<string, string>();
  for (const render of renders ?? []) {
    const row = rows.find((item) => item.id === render.version_id);
    if (!row || render.render_attempt !== row.render_attempt) continue;
    const key = `${render.version_id}:${render.kind}`;
    if (render.preview_path && !renderPath.has(key))
      renderPath.set(key, render.preview_path);
  }

  // The art stage writes thumbnail.png next to the renders; imported songs may carry the
  // 1280x720 export instead. Missing files simply fail to sign.
  const coverCandidates = new Map<string, string[]>();
  for (const row of rows) {
    const master = renderPath.get(`${row.id}:master`);
    if (!master) continue;
    const dir = master.slice(0, master.lastIndexOf("/"));
    coverCandidates.set(row.id, [
      `${dir}/thumbnail.png`,
      `${dir}/thumbnail-1280x720.png`,
    ]);
  }

  const paths = [
    ...new Set([
      ...audioPath.values(),
      ...renderPath.values(),
      ...[...coverCandidates.values()].flat(),
    ]),
  ];
  const signed = new Map<string, string>();
  if (paths.length > 0) {
    const { data: urls } = await supabase.storage
      .from("previews")
      .createSignedUrls(paths, 3600);
    for (const item of urls ?? [])
      if (item.path && item.signedUrl) signed.set(item.path, item.signedUrl);
  }
  const url = (path: string | undefined) =>
    path ? (signed.get(path) ?? null) : null;

  return rows.map((row) => {
    const pack = row.lyric_pack ?? {};
    const project = row.projects;
    const settings = project?.song_settings ?? {};
    return {
      id: row.id,
      projectId: project?.id ?? "",
      lang: row.lang,
      title: pack.title || (settings.title as string) || project?.topic || "",
      style: pack.style || project?.style || "",
      prompt: project?.topic ?? "",
      lyrics: pack.lyrics || project?.brief || "",
      model: pack.settings?.model || (settings.model as string) || "V6",
      status: row.status,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      // Imported songs have no take audio; the master preview carries the same track.
      audioUrl:
        url(audioPath.get(row.id)) ?? url(renderPath.get(`${row.id}:master`)),
      videoUrl: url(renderPath.get(`${row.id}:master`)),
      hookUrl: url(renderPath.get(`${row.id}:hook`)),
      href: `/projects/${project?.id ?? ""}?lang=${row.lang}`,
      art: coverArt(
        (coverCandidates.get(row.id) ?? []).map(url).find(Boolean),
        row.id,
      ),
      settings,
    };
  });
}
