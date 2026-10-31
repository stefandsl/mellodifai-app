"use client";

import type { Stage } from "@mellodifai/shared";
import { useEffect, useState } from "react";

import { createClient } from "@/lib/supabase/browser";

type Job = { id: string; stage: Stage; status: string; created_at: string };
type Event = {
  id: number;
  job_id: string;
  message: string;
  progress: number | null;
};

export function LiveTimeline({
  projectId,
  initialJobs,
  initialEvents,
}: {
  projectId: string;
  initialJobs: Job[];
  initialEvents: Event[];
}) {
  const [jobs, setJobs] = useState(initialJobs);
  const [events, setEvents] = useState(initialEvents);
  useEffect(() => {
    const supabase = createClient();
    const channel = supabase
      .channel(`project:${projectId}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "jobs" },
        (payload) => {
          const job = payload.new as Job;
          setJobs((old) => [...old.filter((item) => item.id !== job.id), job]);
        },
      )
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "job_events" },
        (payload) => setEvents((old) => [...old, payload.new as Event]),
      )
      .subscribe();
    return () => {
      void supabase.removeChannel(channel);
    };
  }, [projectId]);
  return (
    <ol className="space-y-3 border-l pl-5">
      {jobs.map((job) => {
        const event = events.filter((item) => item.job_id === job.id).at(-1);
        return (
          <li key={job.id} className="relative">
            <span className="absolute -left-[1.8rem] top-1 size-3 rounded-full bg-[#7C5CFF]" />
            <p className="font-medium">{job.stage.replaceAll("_", " ")}</p>
            <p className="text-sm text-muted-foreground">
              {job.status}
              {event?.progress !== null && event?.progress !== undefined
                ? ` · ${event.progress}%`
                : ""}
              {event?.message ? ` · ${event.message}` : ""}
            </p>
          </li>
        );
      })}
    </ol>
  );
}
