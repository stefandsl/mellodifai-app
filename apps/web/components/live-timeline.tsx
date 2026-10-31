"use client";
import {
  type JobStatus,
  type Stage,
  t,
  type VersionStatus,
} from "@mellodifai/shared";
import type { RealtimeChannel, SupabaseClient } from "@supabase/supabase-js";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { createClient } from "@/lib/supabase/browser";
import { upsertJob } from "@/lib/timeline";
import { useLocale } from "./locale-provider";

function subscribeWithRecovery(
  db: SupabaseClient,
  makeChannel: (attemptId: string) => RealtimeChannel,
  reconcile: () => Promise<void>,
) {
  let closed = false;
  let retry: ReturnType<typeof setTimeout> | undefined;
  let channel: RealtimeChannel;
  let delay = 1000;
  const connect = () => {
    // Supabase reuses registered topics, including channels still being removed.
    const attemptChannel = makeChannel(crypto.randomUUID());
    channel = attemptChannel;
    attemptChannel.subscribe((state) => {
      if (closed) return;
      if (state === "SUBSCRIBED") {
        delay = 1000;
        void reconcile();
      }
      if ((state === "CHANNEL_ERROR" || state === "TIMED_OUT") && !retry) {
        void reconcile();
        retry = setTimeout(() => {
          void (async () => {
            try {
              await db.removeChannel(attemptChannel);
            } catch {
              /* Retry even if the failed channel cannot be removed. */
            } finally {
              retry = undefined;
            }
            if (!closed) connect();
          })();
        }, delay);
        delay = Math.min(delay * 2, 30_000);
      }
    });
  };
  connect();
  return () => {
    closed = true;
    clearTimeout(retry);
    const ownedChannel = channel;
    void Promise.resolve()
      .then(() => db.removeChannel(ownedChannel))
      .catch(() => {});
  };
}
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
  const reconcileRef = useRef<() => Promise<void>>(async () => {});
  useEffect(() => {
    setJobs(initialJobs);
    setEvents(initialEvents);
    currentStatus.current = status;
  }, [initialJobs, initialEvents, status]);
  useEffect(() => {
    const db = createClient();
    let active = true;
    let pending = false;
    let queued = false;
    const reconcile = async () => {
      if (!active) return;
      if (pending) {
        queued = true;
        return;
      }
      pending = true;
      try {
        const [version, snapshot] = await Promise.all([
          db.from("versions").select("status").eq("id", versionId).single(),
          db
            .from("jobs")
            .select("id,version_id,stage,status,created_at,error")
            .eq("version_id", versionId)
            .order("created_at"),
        ]);
        if (
          !active ||
          version.error ||
          snapshot.error ||
          !version.data ||
          !snapshot.data
        )
          return;
        const jobIds = snapshot.data.map((job) => job.id);
        const recent = jobIds.length
          ? await db
              .from("job_events")
              .select("id,job_id,message,progress")
              .in("job_id", jobIds)
              .order("id", { ascending: false })
              .limit(200)
          : { data: [], error: null };
        if (!active || recent.error) return;
        setJobs(snapshot.data as TimelineJob[]);
        setEvents((recent.data ?? []).toReversed());
        if (version.data.status !== currentStatus.current) {
          currentStatus.current = version.data.status;
          router.refresh();
        }
      } catch {
        // Keep the last snapshot; focus, reconnect, or the active-job poll retries.
      } finally {
        pending = false;
        if (queued) {
          queued = false;
          if (active) void reconcile();
        }
      }
    };
    reconcileRef.current = reconcile;
    const onFocus = () => {
      void reconcile();
    };
    window.addEventListener("focus", onFocus);
    const unsubscribe = subscribeWithRecovery(
      db,
      (attemptId) =>
        db
          .channel(`version:${versionId}:${attemptId}`)
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
              if (j.version_id === versionId)
                setJobs((old) => upsertJob(old, j));
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
              if (j.version_id === versionId)
                setJobs((old) => upsertJob(old, j));
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
          ),
      reconcile,
    );
    return () => {
      active = false;
      window.removeEventListener("focus", onFocus);
      unsubscribe();
    };
  }, [versionId, router.refresh]);
  const hasActiveJobs = jobs.some(
    (job) => job.status === "queued" || job.status === "running",
  );
  useEffect(() => {
    if (!hasActiveJobs) return;
    const timer = setInterval(() => {
      void reconcileRef.current();
    }, 5000);
    return () => clearInterval(timer);
  }, [hasActiveJobs]);
  const ids = jobs
    .map((j) => j.id)
    .sort()
    .join(",");
  useEffect(() => {
    if (!ids) return;
    let active = true;
    const db = createClient();
    const unsubscribe = subscribeWithRecovery(
      db,
      (attemptId) =>
        db.channel(`events:${versionId}:${ids}:${attemptId}`).on(
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
        ),
      () => reconcileRef.current(),
    );
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
      unsubscribe();
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
