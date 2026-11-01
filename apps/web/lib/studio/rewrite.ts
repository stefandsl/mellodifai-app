import {
  type LyricTiming,
  parseLyricTiming,
  REWRITE_STATUSES,
  type RewriteEngine,
} from "@mellodifai/shared";
import type { SupabaseClient } from "@supabase/supabase-js";

import { mediaUrl } from "@/lib/media";
import type { Clip } from "./clips";
import { type EngineMap, WORKER_FRESH_MS } from "./engines";

// "Riscrivi una parte" (T12): what the editor's rewrite tab works with.

// kie keeps its tracks 14 days; after that a take goes to kie as an uploaded file.
export const KIE_RETENTION_MS = 14 * 24 * 3600 * 1000;

export type RewriteTake = {
  id: string;
  number: number;
  audioUrl: string;
  // The lyrics this take sings (its own after a rewrite, else the song's).
  lyrics: string;
  timing: LyricTiming | null;
  // kie can replace on its own task and track (younger than 14 days).
  kieDirect: boolean;
  rewritten: boolean;
};

export type RewriteJob = {
  id: string;
  status: "queued" | "running" | "done" | "failed" | "cancelled";
  error: string | null;
  startedAt: string | null;
};

export type SectionEditView = {
  id: string;
  takeId: string;
  engine: RewriteEngine;
  start: number;
  end: number;
  lines: number[];
  sectionLyrics: string;
  fullLyrics: string;
  alternatives: { url: string; duration: number }[];
  createdAt: string;
  job: RewriteJob | null;
  queuePosition: number | null;
};

export type RewriteData = {
  takes: RewriteTake[];
  // The open request (waiting, working, failed, or with alternatives to choose from).
  edit: SectionEditView | null;
  balance: number | null;
};

type EditRow = {
  id: string;
  take_id: string;
  engine: RewriteEngine;
  start_s: number | string;
  end_s: number | string;
  section_lines: number[] | null;
  section_lyrics: string;
  full_lyrics: string;
  alternatives: { path?: unknown; duration?: unknown }[] | null;
  created_at: string;
};
type JobRow = {
  id: string;
  status: RewriteJob["status"];
  error: string | null;
  started_at: string | null;
  edit_id: string | null;
};

export function editView(
  row: EditRow,
  job: JobRow | null,
  queue: { edit_id: string; queue_position: number }[],
): SectionEditView {
  return {
    id: row.id,
    takeId: row.take_id,
    engine: row.engine,
    start: Number(row.start_s),
    end: Number(row.end_s),
    lines: row.section_lines ?? [],
    sectionLyrics: row.section_lyrics,
    fullLyrics: row.full_lyrics,
    alternatives: (row.alternatives ?? []).flatMap((item) =>
      typeof item.path === "string" && item.path
        ? [{ url: mediaUrl(item.path), duration: Number(item.duration) || 0 }]
        : [],
    ),
    createdAt: row.created_at,
    job: job
      ? {
          id: job.id,
          status: job.status,
          error: job.error,
          startedAt: job.started_at,
        }
      : null,
    queuePosition:
      queue.find((item) => item.edit_id === row.id)?.queue_position ?? null,
  };
}

const EDIT_COLUMNS =
  "id,take_id,engine,start_s,end_s,section_lines,section_lyrics,full_lyrics,alternatives,created_at";

// The open request of a song with its job and queue place, or null.
export async function loadOpenEdit(
  supabase: SupabaseClient,
  versionId: string,
): Promise<SectionEditView | null> {
  const { data } = await supabase
    .from("section_edits")
    .select(EDIT_COLUMNS)
    .eq("version_id", versionId)
    .is("kept_take_id", null)
    .is("discarded_at", null)
    .order("created_at", { ascending: false })
    .limit(1);
  const row = (data?.[0] ?? null) as EditRow | null;
  if (!row) return null;
  const [{ data: jobs }, { data: queue }] = await Promise.all([
    supabase
      .from("jobs")
      .select("id,status,error,started_at,edit_id:payload->>edit_id")
      .eq("stage", "replace_section")
      .eq("version_id", versionId)
      .order("created_at", { ascending: false }),
    supabase.rpc("my_section_queue"),
  ]);
  const job =
    ((jobs ?? []) as JobRow[]).find((item) => item.edit_id === row.id) ?? null;
  return editView(
    row,
    job,
    (queue ?? []) as { edit_id: string; queue_position: number }[],
  );
}

// The takes of the song's current generation that have audio, with their lyrics and timing.
export async function loadRewrite(
  supabase: SupabaseClient,
  clip: Clip,
  now = Date.now(),
): Promise<RewriteData> {
  const ids = clip.takes.filter((take) => take.audioUrl).map((take) => take.id);
  const [{ data: rows }, edit, { data: worker }] = await Promise.all([
    ids.length
      ? supabase
          .from("takes")
          .select(
            "id,take_number,audio_preview_path,lyrics,lyric_timing,engine,kie_task_id,created_at,source_kind:source->>kind",
          )
          .in("id", ids)
      : Promise.resolve({ data: [] }),
    loadOpenEdit(supabase, clip.id),
    supabase
      .from("workers")
      .select("kie_balance,last_seen")
      .order("last_seen", { ascending: false })
      .limit(1),
  ]);
  const takes = (
    (rows ?? []) as {
      id: string;
      take_number: number | null;
      audio_preview_path: string | null;
      lyrics: string | null;
      lyric_timing: unknown;
      engine: string | null;
      kie_task_id: string | null;
      created_at: string;
      source_kind: string | null;
    }[]
  )
    .filter((row) => row.audio_preview_path)
    .sort((a, b) => (a.take_number ?? 0) - (b.take_number ?? 0))
    .map((row) => ({
      id: row.id,
      number: row.take_number ?? 1,
      audioUrl:
        clip.takes.find((take) => take.id === row.id)?.audioUrl ??
        mediaUrl(row.audio_preview_path ?? ""),
      lyrics: row.lyrics ?? clip.lyrics,
      timing: parseLyricTiming(row.lyric_timing),
      kieDirect:
        row.engine === "kie" &&
        Boolean(row.kie_task_id) &&
        now - Date.parse(row.created_at) < KIE_RETENTION_MS,
      rewritten: row.source_kind === "replace",
    }));
  const balance = (worker?.[0] as { kie_balance?: number | null } | undefined)
    ?.kie_balance;
  return { takes, edit, balance: typeof balance === "number" ? balance : null };
}

// Mirrors request_section_edit: a current take with audio, in a status that allows it.
export function canRewrite(clip: Clip): boolean {
  return (
    !clip.trashedAt &&
    REWRITE_STATUSES.includes(clip.status) &&
    clip.takes.some((take) => take.audioUrl)
  );
}

export const rewriteHref = (id: string) => `/editor/${id}?tab=rewrite`;

// kie always; ACE-Step for the admin while the PC is online, has it installed with the rewrite
// feature, and the song's language passed its bake-off.
export function rewriteEngines(context: {
  isAdmin: boolean;
  engines: EngineMap;
  lastSeen: string | null;
  now: number;
  lang: string;
}): RewriteEngine[] {
  const ace = context.engines["ace-step"];
  const fresh =
    context.lastSeen !== null &&
    context.now - Date.parse(context.lastSeen) <= WORKER_FRESH_MS;
  const local =
    context.isAdmin &&
    fresh &&
    Boolean(ace?.installed) &&
    Boolean(ace?.features?.includes("rewrite")) &&
    Boolean(ace?.passedLangs.includes(context.lang as never));
  return local ? ["kie", "ace-step"] : ["kie"];
}

// Where the request stands, for the panel.
export function editPhase(
  edit: SectionEditView | null,
): "none" | "queued" | "running" | "failed" | "ready" {
  if (!edit) return "none";
  if (edit.alternatives.length > 0) return "ready";
  const status = edit.job?.status;
  if (status === "failed" || status === "cancelled") return "failed";
  if (status === "running") return "running";
  if (status === "done") return "failed";
  return "queued";
}
