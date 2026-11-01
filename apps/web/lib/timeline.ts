import { STAGES } from "@mellodifai/shared";

type StatusJob = { id: string; status: string; error?: string | null };
type StatusEvent = { job_id: string; message: string; progress: number | null };

// Events carry both stage progress written for people and raw engine log lines. A running job
// shows only the former; the raw lines surface as details when a job fails.
export function jobStatusLine(
  job: StatusJob,
  events: StatusEvent[],
): { progress?: number; message?: string; details?: string } {
  const own = events.filter((e) => e.job_id === job.id);
  if (job.status === "failed") {
    const details = job.error ?? own.at(-1)?.message;
    return details ? { details } : {};
  }
  if (job.status !== "running") return {};
  const latest = own.filter((e) => e.progress != null).at(-1);
  if (!latest || latest.progress == null) return {};
  return /^Progress: \d+%$/u.test(latest.message)
    ? { progress: latest.progress }
    : { progress: latest.progress, message: latest.message };
}

// A stage that runs again (a retry, a re-render) is shown by its latest job. A failed earlier
// attempt stays as a "superseded" row so the retry is explained; a completed one is history.
// Rows follow the pipeline, so stages a re-render has not reached yet stay below it.
export function timelineRows<T extends { stage: string; status: string }>(
  jobs: T[],
): { job: T; superseded: boolean }[] {
  const order = (stage: string) => {
    const index = (STAGES as readonly string[]).indexOf(stage);
    return index < 0 ? STAGES.length : index;
  };
  return jobs
    .flatMap((job, index): { job: T; superseded: boolean }[] => {
      const rerun = jobs
        .slice(index + 1)
        .some((later) => later.stage === job.stage);
      if (!rerun) return [{ job, superseded: false }];
      return job.status === "failed" ? [{ job, superseded: true }] : [];
    })
    .sort((a, b) => order(a.job.stage) - order(b.job.stage));
}

export function upsertJob<T extends { id: string; created_at: string }>(
  rows: T[],
  row: T,
): T[] {
  const index = rows.findIndex((r) => r.id === row.id);
  if (index >= 0) return rows.map((r, i) => (i === index ? row : r));
  return [...rows, row].sort(
    (a, b) =>
      a.created_at.localeCompare(b.created_at) || a.id.localeCompare(b.id),
  );
}
