"use client";
import {
  type JobStatus,
  type Stage,
  t,
  type VersionStatus,
} from "@mellodifai/shared";
import { useRouter } from "next/navigation";
import { useEffect, useEffectEvent, useRef, useState } from "react";
import {
  jobEventReader,
  jobEventsWatch,
  type TimelineSnapshot,
  timelineWatch,
} from "@/lib/live/cursors";
import { watch } from "@/lib/live/poller";
import { createClient } from "@/lib/supabase/browser";
import { jobStatusLine, timelineRows } from "@/lib/timeline";
import { ErrorDetails } from "./error-details";
import { useLocale } from "./locale-provider";

// Events kept per job, so a busy job cannot discard another job's last status line.
const KEEP = 200;

export type TimelineJob = {
  id: string;
  version_id: string;
  stage: Stage;
  status: JobStatus;
  created_at: string;
  error?: string | null;
  not_before?: string | null;
};
export type TimelineEvent = {
  id: number;
  job_id: string;
  message: string;
  progress: number | null;
};
export function LiveTimeline({
  versionId,
  status,
  initialJobs,
  initialEvents,
}: {
  versionId: string;
  status: VersionStatus;
  initialJobs: TimelineJob[];
  initialEvents: TimelineEvent[];
}) {
  const [jobs, setJobs] = useState(initialJobs);
  const [events, setEvents] = useState(initialEvents);
  const lang = useLocale();
  const router = useRouter();
  const currentStatus = useRef(status);
  const missingVersion = useRef<string | null>(null);
  useEffect(() => {
    setJobs(initialJobs);
    setEvents(initialEvents);
    currentStatus.current = status;
  }, [initialJobs, initialEvents, status]);
  const show = useEffectEvent((snapshot: TimelineSnapshot) => {
    if (snapshot.status === null) {
      if (missingVersion.current !== versionId) {
        missingVersion.current = versionId;
        router.refresh();
      }
      return;
    }
    missingVersion.current = null;
    setJobs(snapshot.jobs);
    if (snapshot.status && snapshot.status !== currentStatus.current) {
      currentStatus.current = snapshot.status;
      router.refresh();
    }
  });
  // The version's status and jobs, read again on every tick and shown when they differ.
  // biome-ignore lint/correctness/useExhaustiveDependencies: new server data restarts the watch, so a value read before that data cannot stay on screen.
  useEffect(
    () => watch(timelineWatch(createClient(), versionId), show),
    [versionId, initialJobs],
  );
  const ids = jobs
    .map((j) => j.id)
    .sort()
    .join(",");
  // Reconcile from zero when a job finishes, including events committed before its status.
  const finalJobs = jobs
    .filter((job) => ["done", "failed", "cancelled"].includes(job.status))
    .map((job) => job.id)
    .sort()
    .join(",");
  // biome-ignore lint/correctness/useExhaustiveDependencies: new server data restarts the watch, so a value read before that data cannot stay on screen.
  useEffect(() => {
    if (!ids) return;
    let active = true;
    const controller = new AbortController();
    const db = createClient();
    const jobIds = ids.split(",");
    const read = jobEventReader(db, jobIds);
    const stop = watch(jobEventsWatch(db, jobIds), async (cursor) => {
      const fresh = await read(cursor, controller.signal);
      if (active) {
        setEvents((old) => {
          const merged = new Map([...old, ...fresh].map((e) => [e.id, e]));
          const sorted = [...merged.values()].sort((a, b) => a.id - b.id);
          return jobIds.flatMap((id) =>
            sorted.filter((event) => event.job_id === id).slice(-KEEP),
          );
        });
      }
    });
    return () => {
      active = false;
      controller.abort();
      stop();
    };
  }, [ids, initialEvents, finalJobs]);
  if (jobs.length === 0)
    return (
      <p className="mt-3 text-sm text-muted-foreground">
        {t(lang, "pipeline.imported")}
      </p>
    );
  return (
    <ol className="space-y-3 border-l pl-5">
      {timelineRows(jobs).map(({ job, superseded }) => {
        if (superseded)
          return (
            <li key={job.id} className="text-sm text-muted-foreground">
              <p>{t(lang, `stage.${job.stage}`)}</p>
              <p>{t(lang, "job.superseded")}</p>
            </li>
          );
        const line = jobStatusLine(job, events);
        return (
          <li key={job.id}>
            <p>{t(lang, `stage.${job.stage}`)}</p>
            {job.stage === "publish" &&
              job.status === "queued" &&
              job.not_before &&
              Date.parse(job.not_before) > Date.now() && (
                <p suppressHydrationWarning>
                  {t(lang, "publish.quotaWait").replace(
                    "{time}",
                    new Date(job.not_before).toLocaleString(lang),
                  )}
                </p>
              )}
            <p className="text-sm text-muted-foreground">
              {[
                t(lang, `job.${job.status}`),
                line.progress != null && `${line.progress}%`,
                line.message,
              ]
                .filter(Boolean)
                .join(" · ")}
            </p>
            {line.details && <ErrorDetails text={line.details} />}
          </li>
        );
      })}
    </ol>
  );
}
