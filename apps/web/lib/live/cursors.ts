import type { JobStatus, Stage, VersionStatus } from "@mellodifai/shared";
import type { SupabaseClient } from "@supabase/supabase-js";

import type { Watch } from "./poller";

// The reads the live parts of the app watch (see poller.ts). Each is small, runs under the
// signed-in user's RLS and changes whenever a row the consumer shows is added, edited or removed.

// How many of the newest rows a cursor carries. One would do if changes were committed in clock
// order; a few more also catch a slower transaction that commits behind a later timestamp.
const NEWEST = 5;

type Reply<T> = { data: T | null; error: { message: string } | null };

function unwrap<T>(reply: Reply<T>): T | null {
  if (reply.error) throw new Error(reply.error.message);
  return reply.data;
}

export type VersionsCursor = {
  count: number;
  newest: { id: string; updated_at: string }[];
};

// Every version the user can see. A new or deleted one moves the count; any edit (status, title,
// like, trash) moves updated_at, which a trigger keeps.
export function versionsWatch(db: SupabaseClient): Watch<VersionsCursor> {
  return {
    key: "versions",
    read: async (signal) => {
      const reply = await db
        .from("versions")
        .select("id,updated_at", { count: "exact" })
        .order("updated_at", { ascending: false })
        .order("id")
        .limit(NEWEST)
        .abortSignal(signal);
      return { count: reply.count ?? 0, newest: unwrap(reply) ?? [] };
    },
  };
}

type ActiveJob = {
  id: string;
  status: string;
  started_at: string | null;
  not_before: string | null;
};

export type JobsCursor = {
  count: number;
  active: ActiveJob[];
  finished: { id: string; status: string; finished_at: string | null }[];
};

// A queued job that may not start yet (a publish waiting for tomorrow's quota) is not work in
// progress.
const waiting = (job: ActiveJob) =>
  job.status === "queued" &&
  job.not_before !== null &&
  Date.parse(job.not_before) > Date.now();

// Every job the user can see. Jobs have no updated_at, so the cursor is made of what a job can
// do: appear or go (the count), be claimed, put back or deferred (the queued and running rows),
// and end (the latest finished ones). A worker heartbeat alone changes nothing here.
export function jobsWatch(db: SupabaseClient): Watch<JobsCursor> {
  return {
    key: "jobs",
    read: async (signal) => {
      const [active, finished] = await Promise.all([
        db
          .from("jobs")
          .select("id,status,started_at,not_before")
          .in("status", ["queued", "running"])
          .order("id")
          .abortSignal(signal),
        db
          .from("jobs")
          .select("id,status,finished_at", { count: "exact" })
          .order("finished_at", { ascending: false, nullsFirst: false })
          .order("id")
          .limit(NEWEST)
          .abortSignal(signal),
      ]);
      return {
        count: finished.count ?? 0,
        active: unwrap(active) ?? [],
        finished: unwrap(finished) ?? [],
      };
    },
    busy: (value) => value.active.some((job) => !waiting(job)),
  };
}

export type TimelineSnapshot = {
  // Null when the version is gone.
  status: VersionStatus | null;
  jobs: {
    id: string;
    version_id: string;
    stage: Stage;
    status: JobStatus;
    created_at: string;
    error: string | null;
    not_before: string | null;
  }[];
};

// One version's pipeline: its status and its jobs. The set is a handful of rows, so the read is
// the timeline itself and nothing more is fetched when it changes.
export function timelineWatch(
  db: SupabaseClient,
  versionId: string,
): Watch<TimelineSnapshot> {
  return {
    key: `timeline:${versionId}`,
    read: async (signal) => {
      const [version, jobs] = await Promise.all([
        db
          .from("versions")
          .select("status")
          .eq("id", versionId)
          .abortSignal(signal)
          .maybeSingle(),
        db
          .from("jobs")
          .select("id,version_id,stage,status,created_at,error,not_before")
          .eq("version_id", versionId)
          .order("created_at")
          .order("id")
          .abortSignal(signal),
      ]);
      return {
        status: unwrap(version)?.status ?? null,
        jobs: unwrap(jobs) ?? [],
      };
    },
  };
}

export type JobEventRow = {
  id: number;
  job_id: string;
  message: string;
  progress: number | null;
  at: string;
};

// The progress events of some jobs: events are only ever added, so the newest id tells.
export function jobEventsWatch(
  db: SupabaseClient,
  jobIds: readonly string[],
): Watch<{ newest: number | null }> {
  const ids = [...jobIds].sort();
  return {
    key: `job-events:${ids.join(",")}`,
    read: async (signal) => {
      const reply = await db
        .from("job_events")
        .select("id")
        .in("job_id", ids)
        .order("id", { ascending: false })
        .limit(1)
        .abortSignal(signal);
      return { newest: (unwrap(reply) ?? [])[0]?.id ?? null };
    },
  };
}

// The latest `limit` events of some jobs, oldest first.
export async function readJobEvents(
  db: SupabaseClient,
  jobIds: readonly string[],
  limit: number,
): Promise<JobEventRow[]> {
  const reply = await db
    .from("job_events")
    .select("id,job_id,message,progress,at")
    .in("job_id", [...jobIds])
    .order("id", { ascending: false })
    .limit(limit);
  return ((unwrap(reply) ?? []) as JobEventRow[]).toReversed();
}
