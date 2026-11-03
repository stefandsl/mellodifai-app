"use client";
import {
  type LocalEngineStatus,
  parseLocalEngineStatus,
} from "@mellodifai/shared";
import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/browser";
import { workerIsOnline } from "@/lib/worker";

export type AceStepView = { status: LocalEngineStatus; online: boolean };

// Setup state of the free local engine, as the PC worker publishes it.
export function aceStepView(
  row: { last_seen: string | null; engines: unknown } | null,
  now = Date.now(),
): AceStepView {
  const engines =
    row?.engines && typeof row.engines === "object"
      ? (row.engines as Record<string, unknown>)
      : {};
  return {
    status: parseLocalEngineStatus(engines["ace-step"]),
    online: workerIsOnline(row?.last_seen ?? null, now),
  };
}

export function useAceStepStatus(): AceStepView {
  const [view, setView] = useState<AceStepView>({
    status: { state: "not_installed" },
    online: false,
  });
  useEffect(() => {
    const db = createClient();
    let cancelled = false;
    const refresh = async () => {
      const { data } = await db
        .from("workers")
        .select("last_seen,engines")
        .order("last_seen", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (!cancelled) setView(aceStepView(data ?? null));
    };
    void refresh();
    const timer = setInterval(() => void refresh(), 10000);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, []);
  return view;
}
