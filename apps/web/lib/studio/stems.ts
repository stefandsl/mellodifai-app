import { EDIT_STATUSES, STEMS_STATUSES } from "@mellodifai/shared";
import type { SupabaseClient } from "@supabase/supabase-js";

import { type Clip, loadClips } from "./clips";
import type { StudioKey } from "./i18n";

// The four tracks the worker's stems stage writes (apps/worker/src/stages/stems.ts), in the
// order the page lists them.
export const STEM_NAMES = ["vocals", "drums", "bass", "other"] as const;
export type StemName = (typeof STEM_NAMES)[number];

export const STEM_LABEL: Record<StemName, StudioKey> = {
  vocals: "stems.vocals",
  drums: "stems.drums",
  bass: "stems.bass",
  other: "stems.other",
};

// The chosen take is the audio both tools work on; a song without one has nothing to give them.
function chosenAudio(clip: Clip): string | null {
  if (!clip.chosenTakeId) return null;
  const take = clip.takes.find((item) => item.id === clip.chosenTakeId);
  return take ? take.audioUrl : clip.audioUrl;
}

// Mirrors request_stems (migration 20261101000020).
export function canSeparate(clip: Clip): boolean {
  return (
    !clip.trashedAt &&
    STEMS_STATUSES.includes(clip.status) &&
    Boolean(chosenAudio(clip))
  );
}

// Mirrors save_edited_take: an edit can become the song's audio only while nothing is being made.
export function canEdit(clip: Clip): boolean {
  return (
    !clip.trashedAt &&
    EDIT_STATUSES.includes(clip.status) &&
    Boolean(chosenAudio(clip))
  );
}

export function editorAudio(clip: Clip): string | null {
  return canEdit(clip) ? chosenAudio(clip) : null;
}

export const stemsHref = (id: string) => `/stems/${id}`;
export const editorHref = (id: string) => `/editor/${id}`;

export type StemTrack = {
  name: StemName;
  url: string;
  peaks: number[];
};

export type StemsJob = {
  id: string;
  status: "queued" | "running" | "done" | "failed" | "cancelled";
  error: string | null;
  createdAt: string;
  startedAt: string | null;
  finishedAt: string | null;
};

export type StemsEvent = {
  id: number;
  message: string;
  progress: number | null;
  at: string;
};

export type StemsPage = {
  clip: Clip;
  takeId: string | null;
  // The four tracks once they exist, else null.
  tracks: StemTrack[] | null;
  duration: number;
  // How long the separation took, in seconds.
  seconds: number | null;
  job: StemsJob | null;
  // Oldest first, the newest 200.
  events: StemsEvent[];
  queuePosition: number | null;
};

type StoredStems = {
  duration?: unknown;
  seconds?: unknown;
  tracks?: Record<string, { path?: unknown; peaks?: unknown } | undefined>;
};

function storedTracks(
  stems: unknown,
): { name: StemName; path: string; peaks: number[] }[] | null {
  const tracks =
    stems && typeof stems === "object"
      ? (stems as StoredStems).tracks
      : undefined;
  if (!tracks || typeof tracks !== "object") return null;
  const out: { name: StemName; path: string; peaks: number[] }[] = [];
  for (const name of STEM_NAMES) {
    const track = tracks[name];
    if (!track || typeof track.path !== "string" || !track.path) return null;
    const peaks = Array.isArray(track.peaks)
      ? track.peaks.filter(
          (value): value is number => typeof value === "number",
        )
      : [];
    out.push({ name, path: track.path, peaks });
  }
  return out;
}

const finite = (value: unknown): number | null =>
  typeof value === "number" && Number.isFinite(value) ? value : null;

// Everything the stems page shows for one song: its chosen take's tracks, or the job making
// them with its log. Null when the song is not the caller's (RLS) or does not exist.
export async function loadStemsPage(
  supabase: SupabaseClient,
  id: string,
): Promise<StemsPage | null> {
  const [clip] = await loadClips(supabase, 1, { ids: [id] });
  if (!clip) return null;
  const takeId = clip.chosenTakeId;
  if (!takeId)
    return {
      clip,
      takeId,
      tracks: null,
      duration: 0,
      seconds: null,
      job: null,
      events: [],
      queuePosition: null,
    };
  const [{ data: take }, { data: job }, { data: queue }] = await Promise.all([
    supabase.from("takes").select("id,stems").eq("id", takeId).maybeSingle(),
    supabase
      .from("jobs")
      .select("id,status,error,created_at,started_at,finished_at")
      .eq("idempotency_key", `stems:${id}:${takeId}`)
      .maybeSingle(),
    supabase.rpc("my_stems_queue"),
  ]);
  const stored = storedTracks(take?.stems);
  let tracks: StemTrack[] | null = null;
  if (stored) {
    const { data: urls } = await supabase.storage
      .from("previews")
      .createSignedUrls(
        stored.map((track) => track.path),
        3600,
      );
    const signed = new Map(
      (urls ?? []).flatMap((item) =>
        item.path && item.signedUrl ? [[item.path, item.signedUrl]] : [],
      ),
    );
    if (stored.every((track) => signed.has(track.path)))
      tracks = stored.map((track) => ({
        name: track.name,
        url: signed.get(track.path) as string,
        peaks: track.peaks,
      }));
  }
  const { data: events } = job
    ? await supabase
        .from("job_events")
        .select("id,message,progress,at")
        .eq("job_id", job.id)
        .order("id", { ascending: false })
        .limit(200)
    : { data: [] };
  const stems = take?.stems as StoredStems | null | undefined;
  return {
    clip,
    takeId,
    tracks,
    duration: finite(stems?.duration) ?? 0,
    seconds: finite(stems?.seconds),
    job: job
      ? {
          id: job.id,
          status: job.status,
          error: job.error,
          createdAt: job.created_at,
          startedAt: job.started_at,
          finishedAt: job.finished_at,
        }
      : null,
    events: (
      (events ?? []) as {
        id: number;
        message: string;
        progress: number | null;
        at: string;
      }[]
    )
      .map((event) => ({
        id: event.id,
        message: event.message,
        progress: event.progress,
        at: event.at,
      }))
      .toReversed(),
    queuePosition:
      ((queue ?? []) as { version_id: string; queue_position: number }[]).find(
        (item) => item.version_id === id,
      )?.queue_position ?? null,
  };
}
