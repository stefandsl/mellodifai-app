"use client";

import {
  REMAKE_BUSY_STAGES,
  type RemakeErrorCode,
  type RemakeLyrics,
  RemakeLyricsSchema,
  type RemakeStage,
  type RemakeSummary,
  RemakeSummarySchema,
} from "@mellodifai/shared";
import { useCallback, useEffect, useRef, useState } from "react";

import { readRemake } from "@/app/actions/remake";

// The create panel's view of the person's current remake (my_remake, migration 20261102000025).
export type RemakeView = {
  id: string;
  projectId: string;
  versionId: string;
  url: string;
  videoId: string;
  lang: string;
  country: string | null;
  stage: RemakeStage;
  errorCode: RemakeErrorCode | null;
  error: string | null;
  source: { title?: string; durationS?: number; licence?: string } | null;
  analysis: RemakeSummary | null;
  lyrics: RemakeLyrics | null;
  pending: { lines?: { index: number; text: string }[]; title?: string } | null;
  revision: number;
  costUsd: number;
  job: {
    id: string;
    stage: string;
    status: "queued" | "running";
    mode: string | null;
    section: string | null;
    progress: number | null;
    message: string | null;
    queuePosition: number | null;
  } | null;
  failedJob: { stage: string; mode: string | null; error: string } | null;
};

type Row = {
  remake: Record<string, unknown>;
  job: RemakeView["job"];
  failedJob: RemakeView["failedJob"];
} | null;

export function toView(row: Row): RemakeView | null {
  if (!row?.remake) return null;
  const r = row.remake;
  const analysis = RemakeSummarySchema.safeParse(r.analysis);
  const lyrics = RemakeLyricsSchema.safeParse(r.lyrics);
  const cost = (r.cost ?? {}) as Record<string, number>;
  return {
    id: String(r.id),
    projectId: String(r.project_id),
    versionId: String(r.version_id),
    url: String(r.url),
    videoId: String(r.video_id),
    lang: String(r.lang),
    country: (r.country as string | null) ?? null,
    stage: r.stage as RemakeStage,
    errorCode: (r.error_code as RemakeErrorCode | null) ?? null,
    error: (r.error as string | null) ?? null,
    source: (r.source as RemakeView["source"]) ?? null,
    analysis: analysis.success ? analysis.data : null,
    lyrics: lyrics.success ? lyrics.data : null,
    pending: (r.pending as RemakeView["pending"]) ?? null,
    revision: Number(r.revision ?? 0),
    costUsd:
      Math.round(
        ((cost.analysisUsd ?? 0) +
          (cost.rewriteUsd ?? 0) +
          (cost.sectionsUsd ?? 0) +
          (cost.failedUsd ?? 0)) *
          1e4,
      ) / 1e4,
    job: row.job ?? null,
    failedJob: row.failedJob ?? null,
  };
}

export function remakeBusy(view: RemakeView | null): boolean {
  return Boolean(
    view &&
      (REMAKE_BUSY_STAGES.includes(view.stage) || view.job || view.pending),
  );
}

const FAST_MS = 1500;
const SLOW_MS = 15_000;

// Polls my_remake: every 1.5 s while a step runs, every 15 s otherwise (another tab may act).
export function useRemake() {
  const [view, setView] = useState<RemakeView | null>(null);
  const [loaded, setLoaded] = useState(false);
  const busy = remakeBusy(view);
  const tick = useRef(0);
  const refresh = useCallback(async () => {
    const mine = ++tick.current;
    try {
      const result = await readRemake();
      if (!result.ok || mine !== tick.current) return;
      const data = result.data;
      setView(toView(data as Row));
      setLoaded(true);
    } catch {
      // Offline or not configured: the next poll tries again; the panel keeps what it showed.
    }
  }, []);
  useEffect(() => {
    void refresh();
    const timer = setInterval(() => void refresh(), busy ? FAST_MS : SLOW_MS);
    return () => clearInterval(timer);
  }, [busy, refresh]);
  return { view, loaded, refresh, setView };
}
