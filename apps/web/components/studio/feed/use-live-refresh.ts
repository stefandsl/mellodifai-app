"use client";

import { useRouter } from "next/navigation";
import { useEffect, useEffectEvent, useRef } from "react";

import { jobsWatch, versionsWatch } from "@/lib/live/cursors";
import { checkNow, IDLE_MS, watch } from "@/lib/live/poller";
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
  // Full reconciliation has a 15-second deadline, including late commits to old rows.
  if (info.repeated || Date.now() >= refreshedAt + IDLE_MS) refreshOnce();
  else if (pending === undefined)
    pending = setTimeout(
      refreshOnce,
      Math.min(250, refreshedAt + IDLE_MS - Date.now()),
    );
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
    if (refreshers.size === 1) {
      refreshedAt = Date.now();
      hourly = setInterval(refreshOnce, 50 * 60 * 1000);
    }
    // Both watches refresh the whole route. One slow deadline is enough when jobs are
    // included, otherwise their independent repeat clocks can cause duplicate refreshes.
    const stop = key.split(",").includes("jobs")
      ? watch(jobsWatch(supabase), changed)
      : watch(versionsWatch(), changed);
    return () => {
      stop();
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
