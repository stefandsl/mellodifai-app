import {
  type Lang,
  parseTakeScores,
  type TakeScores,
  type VersionStatus,
} from "@mellodifai/shared";
import type { SupabaseClient } from "@supabase/supabase-js";

import { artFor } from "./cover-art";

export { artFor };

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
  // False when art is only the gradient; the card then shows a frame of the video if any.
  hasCover: boolean;
  // Takes of the current generation, in take order, with playable previews.
  // scores is null until the worker has heard the take.
  takes: {
    id: string;
    number: number;
    audioUrl: string | null;
    scores: TakeScores | null;
  }[];
  chosenTakeId: string | null;
  settings: Record<string, unknown>;
  // The drafted lyric pack as stored, sent back unchanged when lyrics are approved from the feed.
  pack: unknown;
  // The lyric pipeline's report (router choice, jury scores), when the worker wrote one.
  jury: Jury | null;
  reaction: Reaction;
  playCount: number;
  // Set while the song sits in the trash.
  trashedAt: string | null;
  // 1 + the jobs ahead on the render PC while this song waits in the queue; null otherwise.
  queuePosition: number | null;
  // The stems of the chosen take: ready, or the separation asked for; null when never asked.
  stems: StemsState | null;
};

export type StemsState = {
  takeId: string;
  status: "queued" | "running" | "done" | "failed";
  // The stems job, when there is one (stems saved by an older job may outlive it).
  jobId: string | null;
  // While queued: 1 + the jobs ahead on the render PC.
  queuePosition: number | null;
};

type StemsJob = {
  id: string;
  version_id: string;
  status: string;
  take_id: string | null;
};

// What the feed says about the stems of a song's chosen take.
export function stemsState(
  takeId: string | null,
  hasStems: boolean,
  jobs: StemsJob[],
  queuePosition: number | null,
): StemsState | null {
  if (!takeId) return null;
  // Newest first: a retry replaces the failed job in place, so there is one per take.
  const job = jobs.find((item) => item.take_id === takeId) ?? null;
  if (hasStems)
    return {
      takeId,
      status: "done",
      jobId: job?.id ?? null,
      queuePosition: null,
    };
  if (!job) return null;
  const status =
    job.status === "queued" || job.status === "running"
      ? job.status
      : job.status === "failed" || job.status === "cancelled"
        ? "failed"
        : null;
  if (!status) return null;
  return {
    takeId,
    status,
    jobId: job.id,
    queuePosition: status === "queued" ? queuePosition : null,
  };
}

export type Reaction = "like" | "dislike" | "none";

export type Jury = {
  passed: boolean;
  available: boolean;
  scores: Record<string, number>;
  failing: string[];
  route?: { writer?: string; tone?: string | null };
  writers?: Record<string, string>;
  rounds?: { writer: string; passed: boolean }[];
  verdicts?: { model: string; ms: number; error?: string }[];
  ms?: number;
  redacted?: boolean;
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
  lyric_jury: Jury | null;
  liked: boolean;
  disliked: boolean;
  play_count: number;
  trashed_at: string | null;
  display_title: string | null;
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

function coverArt(cover: string | null | undefined, id: string): string {
  return cover
    ? `center / cover no-repeat url("${cover.replaceAll('"', "%22")}"), ${artFor(id)}`
    : artFor(id);
}

// The pipeline is working on the song: a card shows a spinner instead of its artwork.
const GENERATING: VersionStatus[] = [
  "drafting",
  "song_queued",
  "producing",
  "publishing",
];
export function isGenerating(status: VersionStatus): boolean {
  return GENERATING.includes(status);
}

const STATUS_WITH_ACTION: VersionStatus[] = [
  "lyrics_review",
  "takes_review",
  "video_review",
];
export function needsAction(status: VersionStatus): boolean {
  return STATUS_WITH_ACTION.includes(status);
}

// What loadClips asks for. Without options it returns the songs that are not in the trash.
export type LoadOptions = {
  // The trash view: only trashed songs.
  trash?: boolean;
  // Only these songs (a playlist), in no particular order; the caller sorts them.
  ids?: string[];
  // Only liked songs, newest like first.
  liked?: boolean;
};

// The feed and Library show songs that are not in the trash; the trash view shows the rest.
export async function loadClips(
  supabase: SupabaseClient,
  limit = 200,
  { trash = false, ids: only, liked = false }: LoadOptions = {},
): Promise<Clip[]> {
  if (only && only.length === 0) return [];
  const base = supabase
    .from("versions")
    .select(
      "id,lang,status,created_at,updated_at,lyric_pack,lyric_jury,liked,disliked,play_count,trashed_at,display_title,chosen_take_id,generation_count,render_attempt,projects(id,topic,style,brief,song_settings)",
    );
  let query = trash
    ? base.not("trashed_at", "is", null)
    : base.is("trashed_at", null);
  if (only) query = query.in("id", only);
  if (liked)
    query = query
      .eq("liked", true)
      .order("liked_at", { ascending: false, nullsFirst: false });
  const [{ data }, positions, stemsPositions] = await Promise.all([
    query
      .order(trash ? "trashed_at" : "created_at", { ascending: false })
      .limit(limit),
    // Trashed songs are not in the queue, so the trash view needs no positions.
    trash ? { data: null } : supabase.rpc("my_queue_positions"),
    trash ? { data: null } : supabase.rpc("my_stems_queue"),
  ]);
  const rows = (data ?? []) as unknown as Row[];
  if (rows.length === 0) return [];
  const queuePosition = new Map<string, number>(
    (
      (positions.data ?? []) as { version_id: string; queue_position: number }[]
    ).map((item) => [item.version_id, item.queue_position]),
  );
  const stemsQueue = new Map<string, number>(
    (
      (stemsPositions.data ?? []) as {
        version_id: string;
        queue_position: number;
      }[]
    ).map((item) => [item.version_id, item.queue_position]),
  );
  const ids = rows.map((row) => row.id);
  const [{ data: takes }, { data: renders }, { data: stemsJobs }] =
    await Promise.all([
      supabase
        .from("takes")
        // Only whether the stems exist: the full set carries four waveforms.
        .select(
          "id,version_id,audio_preview_path,cover_path,generation,take_number,scores,stems_at:stems->>created_at",
        )
        .in("version_id", ids),
      supabase
        .from("renders")
        .select("version_id,kind,preview_path,render_attempt,created_at")
        .in("version_id", ids)
        .order("created_at", { ascending: false }),
      trash
        ? { data: null }
        : supabase
            .from("jobs")
            .select("id,version_id,status,take_id:payload->>take_id")
            .eq("stage", "stems")
            .in("version_id", ids)
            .order("created_at", { ascending: false }),
    ]);

  const currentTakes = new Map<
    string,
    {
      id: string;
      number: number;
      path: string | null;
      scores: TakeScores | null;
    }[]
  >();
  for (const row of rows)
    currentTakes.set(
      row.id,
      (takes ?? [])
        .filter(
          (take) =>
            take.version_id === row.id &&
            take.generation === row.generation_count,
        )
        .sort((a, b) => (a.take_number ?? 0) - (b.take_number ?? 0))
        .map((take, i) => ({
          id: take.id,
          number: take.take_number ?? i + 1,
          path: take.audio_preview_path,
          scores: parseTakeScores(take.scores),
        })),
    );

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

  // Suno's artwork saved per take: the chosen take's, else the first current take's.
  const takeCover = new Map<string, string>();
  for (const row of rows) {
    const own = (takes ?? []).filter(
      (take) => take.version_id === row.id && take.cover_path,
    );
    const take =
      own.find((item) => item.id === row.chosen_take_id) ??
      own
        .filter((item) => item.generation === row.generation_count)
        .sort((a, b) => (a.take_number ?? 0) - (b.take_number ?? 0))[0];
    if (take?.cover_path) takeCover.set(row.id, take.cover_path);
  }

  const paths = [
    ...new Set([
      ...takeCover.values(),
      ...audioPath.values(),
      ...[...currentTakes.values()]
        .flat()
        .flatMap((take) => (take.path ? [take.path] : [])),
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
  const url = (path: string | null | undefined) =>
    path ? (signed.get(path) ?? null) : null;

  return rows.map((row) => {
    const cover =
      url(takeCover.get(row.id)) ??
      (coverCandidates.get(row.id) ?? []).map(url).find(Boolean);
    const pack = row.lyric_pack ?? {};
    const project = row.projects;
    const settings = project?.song_settings ?? {};
    return {
      id: row.id,
      projectId: project?.id ?? "",
      lang: row.lang,
      title:
        row.display_title ||
        pack.title ||
        (settings.title as string) ||
        project?.topic ||
        "",
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
      art: coverArt(cover, row.id),
      hasCover: Boolean(cover),
      takes: (currentTakes.get(row.id) ?? []).map((take) => ({
        id: take.id,
        number: take.number,
        audioUrl: url(take.path),
        scores: take.scores,
      })),
      chosenTakeId: row.chosen_take_id,
      jury: row.lyric_jury,
      reaction: row.liked ? "like" : row.disliked ? "dislike" : "none",
      playCount: row.play_count ?? 0,
      trashedAt: row.trashed_at,
      queuePosition: queuePosition.get(row.id) ?? null,
      stems: stemsState(
        row.chosen_take_id,
        Boolean(
          (takes ?? []).find((take) => take.id === row.chosen_take_id)
            ?.stems_at,
        ),
        ((stemsJobs ?? []) as StemsJob[]).filter(
          (job) => job.version_id === row.id,
        ),
        stemsQueue.get(row.id) ?? null,
      ),
      settings,
      pack: row.lyric_pack,
    };
  });
}
