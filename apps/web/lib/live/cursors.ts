import type { JobStatus, Stage, VersionStatus } from "@mellodifai/shared";
import type { SupabaseClient } from "@supabase/supabase-js";

import { IDLE_MS, type Watch } from "./poller";

// Reads run under the signed-in user's RLS. Sequence IDs and transaction-start timestamps
// are not commit cursors: feeds reconcile on the slow clock, events also count visible rows.

type Reply<T> = { data: T | null; error: { message: string } | null };

function unwrap<T>(reply: Reply<T>): T | null {
  if (reply.error) throw new Error(reply.error.message);
  return reply.data;
}

// A clock, not a newest-row sample. Its consumer refreshes the route on every repeat, so even
// an edit older than every sampled timestamp is reconciled within one slow period. No query
// is needed here: spending that request on the actual server data also avoids a growing sort.
export function versionsWatch(): Watch<null> {
  return {
    key: "versions",
    read: async (signal) => {
      signal.throwIfAborted();
      return null;
    },
    repeatMs: () => IDLE_MS,
  };
}

type ActiveJob = {
  id: string;
  status: string;
  started_at: string | null;
  not_before: string | null;
};

export type JobsCursor = {
  active: ActiveJob[];
};

// A queued job that may not start yet (a publish waiting for tomorrow's quota) is not work in
// progress.
type ScheduledJob = { status: string; not_before?: string | null };

export const queuedAndDue = (job: ScheduledJob) =>
  job.status === "queued" &&
  !(job.not_before && Date.parse(job.not_before) > Date.now());

export const activeJob = (job: ScheduledJob) =>
  job.status === "running" || queuedAndDue(job);

function nextDue(jobs: ScheduledJob[]): number {
  return Math.min(
    ...jobs.flatMap((job) =>
      job.status === "queued" &&
      job.not_before &&
      Date.parse(job.not_before) > Date.now()
        ? [Date.parse(job.not_before)]
        : [],
    ),
  );
}

// Active jobs keep the fast clock and expose claims/completions promptly. Historical jobs
// and queue positions are reconciled by the consumer's route refresh at least every 15s.
// Do not count or sort the entire jobs history on every fast tick.
export function jobsWatch(db: SupabaseClient): Watch<JobsCursor> {
  return {
    key: "jobs",
    read: async (signal) => {
      const active = await db
        .from("jobs")
        .select("id,status,started_at,not_before")
        .in("status", ["queued", "running"])
        .order("id")
        .abortSignal(signal);
      return {
        active: unwrap(active) ?? [],
      };
    },
    busy: (value) => value.active.some(activeJob),
    wakeAt: (value) => nextDue(value.active),
    repeatMs: () => IDLE_MS,
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
    busy: (value) => value.jobs.some(activeJob),
    wakeAt: (value) => nextDue(value.jobs),
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

export type EventsCursor = { newest: number | null; count: number };

// Events are append-only. The count changes even when a lower allocated ID commits late.
export function jobEventsWatch(
  db: SupabaseClient,
  jobIds: readonly string[],
): Watch<EventsCursor> {
  const ids = [...jobIds].sort();
  return {
    key: `job-events:${ids.join(",")}`,
    read: async (signal) => {
      const reply = await db
        .from("job_events")
        .select("id", { count: "exact" })
        .in("job_id", ids)
        .order("id", { ascending: false })
        .limit(1)
        .abortSignal(signal);
      const newest = (unwrap(reply) ?? [])[0]?.id ?? null;
      if (reply.count === null) throw new Error("Missing event count");
      return { newest, count: reply.count };
    },
  };
}

// Each subscriber owns its catch-up state. Count accounting detects holes below `after`
// without guessing a maximum transaction duration or rereading history on every tick.
// A failed/aborted page never advances either mark. A restart reconciles from zero.
export function jobEventReader(db: SupabaseClient, jobIds: readonly string[]) {
  let after = 0;
  let count = 0;
  return async (cursor: EventsCursor, signal: AbortSignal) => {
    const through = cursor.newest ?? 0;
    // A small initial history fits one latest-events request. Filter concurrent higher IDs
    // back to this cursor's snapshot; count accounting falls back to paging if rows moved.
    let fresh =
      after === 0 && cursor.count > 0 && cursor.count <= 200
        ? (await readJobEvents(db, jobIds, 200, signal)).filter(
            (event) => event.id <= through,
          )
        : await readJobEventsAfter(db, jobIds, after, through, signal);
    const reconcile = count + fresh.length !== cursor.count;
    if (reconcile)
      fresh = await readJobEventsAfter(db, jobIds, 0, through, signal);
    signal.throwIfAborted();
    // A late commit during pagination may be behind a page already read. Keep the old
    // marks and retry on the next tick rather than accepting an incomplete reconciliation.
    if (reconcile && fresh.length !== cursor.count)
      throw new Error("Event count changed during reconciliation");
    after = through;
    count = cursor.count;
    return fresh;
  };
}

// The latest `limit` events of some jobs, oldest first.
export async function readJobEvents(
  db: SupabaseClient,
  jobIds: readonly string[],
  limit: number,
  signal?: AbortSignal,
): Promise<JobEventRow[]> {
  let query = db
    .from("job_events")
    .select("id,job_id,message,progress,at")
    .in("job_id", [...jobIds])
    .order("id", { ascending: false })
    .limit(limit);
  if (signal) query = query.abortSignal(signal);
  const reply = await query;
  return ((unwrap(reply) ?? []) as JobEventRow[]).toReversed();
}

// Catch up to the cursor in bounded, ascending pages. A quieter job's final event must not be
// pushed out of the result by a busy job. A failed page rejects the whole read for retry.
export async function readJobEventsAfter(
  db: SupabaseClient,
  jobIds: readonly string[],
  after: number,
  through: number,
  signal: AbortSignal,
): Promise<JobEventRow[]> {
  const events: JobEventRow[] = [];
  while (after < through) {
    const reply = await db
      .from("job_events")
      .select("id,job_id,message,progress,at")
      .in("job_id", [...jobIds])
      .gt("id", after)
      .lte("id", through)
      .order("id")
      .limit(200)
      .abortSignal(signal);
    const page = (unwrap(reply) ?? []) as JobEventRow[];
    const last = page.at(-1);
    if (!last) break;
    events.push(...page);
    after = last.id;
  }
  return events;
}
