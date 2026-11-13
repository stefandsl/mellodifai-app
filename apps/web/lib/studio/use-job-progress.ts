"use client";

import { useEffect, useRef, useState } from "react";

import { jobEventReader, jobEventsWatch } from "@/lib/live/cursors";
import { holdFast, watch } from "@/lib/live/poller";
import { createClient } from "@/lib/supabase/browser";

export type JobEvent = {
  id: number;
  message: string;
  progress: number | null;
  at: string;
};

const KEEP = 200;
// One shared default, so the merge effect below does not run on every render.
const NONE: JobEvent[] = [];

function merge(old: JobEvent[], fresh: JobEvent[]): JobEvent[] {
  const byId = new Map([...old, ...fresh].map((event) => [event.id, event]));
  return [...byId.values()].sort((a, b) => a.id - b.id).slice(-KEEP);
}

// Counted catch-up continues on the slow clock after completion: an event's transaction can
// commit after the job's final status. `initial` are the events the page was rendered with.
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
    if (!jobId) return;
    const supabase = createClient();
    let alive = true;
    // The job is in progress: its events are worth a fast clock.
    const release = active ? holdFast() : () => {};
    const controller = new AbortController();
    const read = jobEventReader(supabase, [jobId]);
    const stop = watch(jobEventsWatch(supabase, [jobId]), async (cursor) => {
      const fresh = await read(cursor, controller.signal);
      if (alive) setEvents((old) => merge(old, fresh));
    });
    return () => {
      alive = false;
      controller.abort();
      release();
      stop();
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
