"use client";
import {
  type JobStatus,
  type Stage,
  t,
  type VersionStatus,
} from "@mellodifai/shared";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { createClient } from "@/lib/supabase/browser";
import { upsertJob } from "@/lib/timeline";
import { useLocale } from "./locale-provider";
export type TimelineJob = {
  id: string;
  version_id: string;
  stage: Stage;
  status: JobStatus;
  created_at: string;
  error?: string | null;
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
  useEffect(() => {
    setJobs(initialJobs);
    setEvents(initialEvents);
    currentStatus.current = status;
  }, [initialJobs, initialEvents, status]);
  useEffect(() => {
    const db = createClient();
    const channel = db
      .channel(`version:${versionId}`)
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "jobs",
          filter: `version_id=eq.${versionId}`,
        },
        (p) => {
          const j = p.new as TimelineJob;
          if (j.version_id === versionId) setJobs((old) => upsertJob(old, j));
        },
      )
      .on(
        "postgres_changes",
        {
          event: "UPDATE",
          schema: "public",
          table: "jobs",
          filter: `version_id=eq.${versionId}`,
        },
        (p) => {
          const j = p.new as TimelineJob;
          if (j.version_id === versionId) setJobs((old) => upsertJob(old, j));
        },
      )
      .on(
        "postgres_changes",
        {
          event: "UPDATE",
          schema: "public",
          table: "versions",
          filter: `id=eq.${versionId}`,
        },
        (p) => {
          if (p.new.status !== currentStatus.current) {
            currentStatus.current = p.new.status;
            router.refresh();
          }
        },
      )
      .subscribe();
    return () => {
      void db.removeChannel(channel);
    };
  }, [versionId, router]);
  const ids = jobs
    .map((j) => j.id)
    .sort()
    .join(",");
  useEffect(() => {
    if (!ids) return;
    let active = true;
    const db = createClient();
    const channel = db
      .channel(`events:${versionId}:${ids}`)
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "job_events",
          filter: `job_id=in.(${ids})`,
        },
        (p) => {
          const event = p.new as TimelineEvent;
          if (ids.split(",").includes(event.job_id))
            setEvents((old) =>
              [...old.filter((e) => e.id !== event.id), event]
                .sort((a, b) => a.id - b.id)
                .slice(-200),
            );
        },
      )
      .subscribe();
    void db
      .from("job_events")
      .select("id,job_id,message,progress")
      .in("job_id", ids.split(","))
      .order("id", { ascending: false })
      .limit(200)
      .then(({ data }) => {
        if (active && data)
          setEvents((old) => {
            const merged = new Map([...data, ...old].map((e) => [e.id, e]));
            return [...merged.values()].sort((a, b) => a.id - b.id).slice(-200);
          });
      });
    return () => {
      active = false;
      void db.removeChannel(channel);
    };
  }, [ids, versionId]);
  return (
    <ol className="space-y-3 border-l pl-5">
      {jobs.map((job) => {
        const event = events.filter((e) => e.job_id === job.id).at(-1);
        return (
          <li key={job.id}>
            <p>{t(lang, `stage.${job.stage}`)}</p>
            <p className="text-sm text-muted-foreground">
              {t(lang, `job.${job.status}`)}{" "}
              {event?.progress != null ? `${event.progress}%` : ""}{" "}
              {event?.message}
            </p>
          </li>
        );
      })}
    </ol>
  );
}
