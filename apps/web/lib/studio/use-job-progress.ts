"use client";

import { useEffect, useRef, useState } from "react";

import { createClient } from "@/lib/supabase/browser";

export type JobEvent = {
  id: number;
  message: string;
  progress: number | null;
  at: string;
};

const POLL_MS = 4000;
const KEEP = 200;
// One shared default, so the merge effect below does not run on every render.
const NONE: JobEvent[] = [];

function merge(old: JobEvent[], fresh: JobEvent[]): JobEvent[] {
  const byId = new Map([...old, ...fresh].map((event) => [event.id, event]));
  return [...byId.values()].sort((a, b) => a.id - b.id).slice(-KEEP);
}

// The progress events of one job while it is active: pushed by Realtime and, in case a push is
// lost, polled every few seconds. `initial` are the events the page was rendered with.
export function useJobEvents(
  jobId: string | null,
  active: boolean,
  initial: JobEvent[] = NONE,
): JobEvent[] {
  const [events, setEvents] = useState(initial);
  const previousJobId = useRef(jobId);
  useEffect(() => {
    if (previousJobId.current === jobId)
      setEvents((old) => merge(old, initial));
    else {
      previousJobId.current = jobId;
      setEvents(initial);
    }
  }, [jobId, initial]);
  useEffect(() => {
    if (!jobId || !active) return;
    const supabase = createClient();
    let alive = true;
    const poll = async () => {
      const { data } = await supabase
        .from("job_events")
        .select("id,message,progress,at")
        .eq("job_id", jobId)
        .order("id", { ascending: false })
        .limit(50);
      if (alive && data) setEvents((old) => merge(old, data as JobEvent[]));
    };
    const channel = supabase
      .channel(`job-events:${jobId}:${crypto.randomUUID()}`)
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "job_events",
          filter: `job_id=eq.${jobId}`,
        },
        (payload) => {
          const event = payload.new as JobEvent & { job_id?: string };
          if (alive && event.job_id === jobId)
            setEvents((old) => merge(old, [event]));
        },
      )
      .subscribe();
    void poll();
    const timer = setInterval(() => void poll(), POLL_MS);
    return () => {
      alive = false;
      clearInterval(timer);
      void supabase.removeChannel(channel);
    };
  }, [jobId, active]);
  return previousJobId.current === jobId ? events : initial;
}

// The newest progress value among `events` at or after `since` (an ISO time), else null.
export function latestProgress(
  events: readonly JobEvent[],
  since: string | null,
): JobEvent | null {
  const from = since ? Date.parse(since) : Number.NEGATIVE_INFINITY;
  for (let i = events.length - 1; i >= 0; i--) {
    const event = events[i] as JobEvent;
    if (event.progress != null && Date.parse(event.at) >= from) return event;
  }
  return null;
}
