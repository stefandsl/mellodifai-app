"use client";

import { useRouter } from "next/navigation";
import { useEffect, useEffectEvent, useRef } from "react";

import { jobsWatch, versionsWatch } from "@/lib/live/cursors";
import { checkNow, watch } from "@/lib/live/poller";
import { createClient } from "@/lib/supabase/browser";

type LiveTable = "versions" | "jobs";

// Re-renders the server data when a version or job changes. `revision` is the server data the
// page shows: when it is replaced (the user queued something, a refresh came back) the cursors
// are read again at once instead of at the next tick.
export function useLiveRefresh(
  revision: unknown,
  tables: LiveTable[] = ["versions", "jobs"],
) {
  const router = useRouter();
  const refresh = useEffectEvent(() => router.refresh());
  const key = tables.join(",");
  useEffect(() => {
    const supabase = createClient();
    let timer: ReturnType<typeof setTimeout> | undefined;
    // The tables are read in the same tick: a change that shows in both causes one refresh.
    const changed = (_cursor: unknown, { initial }: { initial: boolean }) => {
      // The first value is the state the page was just rendered with.
      if (initial) return;
      clearTimeout(timer);
      timer = setTimeout(refresh, 250);
    };
    const stops = key
      .split(",")
      .map((table) =>
        table === "versions"
          ? watch(versionsWatch(supabase), changed)
          : watch(jobsWatch(supabase), changed),
      );
    // Signed media URLs last an hour; refresh before they expire.
    const hourly = setInterval(refresh, 50 * 60 * 1000);
    return () => {
      clearTimeout(timer);
      clearInterval(hourly);
      for (const stop of stops) stop();
    };
  }, [key]);
  const shown = useRef(revision);
  useEffect(() => {
    if (shown.current === revision) return;
    shown.current = revision;
    checkNow();
  }, [revision]);
}
