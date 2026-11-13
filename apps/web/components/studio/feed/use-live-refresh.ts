"use client";

import { useRouter } from "next/navigation";
import { useEffect, useEffectEvent, useRef } from "react";

import { jobsWatch, versionsWatch } from "@/lib/live/cursors";
import { checkNow, watch } from "@/lib/live/poller";
import { createClient } from "@/lib/supabase/browser";

type LiveTable = "versions" | "jobs";

// All mounted feeds refresh the same route. Share the debounce and signed-URL renewal too.
const refreshers = new Set<() => void>();
let pending: ReturnType<typeof setTimeout> | undefined;
let hourly: ReturnType<typeof setInterval> | undefined;
let refreshedAt = Number.NEGATIVE_INFINITY;

function refreshOnce() {
  clearTimeout(pending);
  pending = undefined;
  if (refreshedAt === Date.now()) return;
  refreshedAt = Date.now();
  refreshers.values().next().value?.();
}

function changed(
  _cursor: unknown,
  info: { initial: boolean; repeated?: boolean },
) {
  if (info.initial) return;
  // Queue positions have a 15-second deadline; do not add the change debounce to it.
  if (info.repeated) refreshOnce();
  else if (pending === undefined) pending = setTimeout(refreshOnce, 250);
}

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
    refreshers.add(refresh);
    if (refreshers.size === 1)
      hourly = setInterval(refreshOnce, 50 * 60 * 1000);
    const stops = key
      .split(",")
      .map((table) =>
        table === "versions"
          ? watch(versionsWatch(supabase), changed)
          : watch(jobsWatch(supabase), changed),
      );
    return () => {
      for (const stop of stops) stop();
      refreshers.delete(refresh);
      if (refreshers.size === 0) {
        clearTimeout(pending);
        pending = undefined;
        clearInterval(hourly);
        hourly = undefined;
        refreshedAt = Number.NEGATIVE_INFINITY;
      }
    };
  }, [key]);
  const shown = useRef(revision);
  useEffect(() => {
    if (shown.current === revision) return;
    shown.current = revision;
    checkNow();
  }, [revision]);
}
