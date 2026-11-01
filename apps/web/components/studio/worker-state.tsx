"use client";

import { createContext, useContext, useEffect, useState } from "react";

import {
  type EngineMap,
  engineOf,
  isLocal,
  type LocalCost,
  localCost,
  parseEngines,
} from "@/lib/studio/engines";
import { createClient } from "@/lib/supabase/browser";
import { workerIsOnline } from "@/lib/worker";

// The worker row as the server layout reads it; engines is the raw jsonb column.
export type WorkerInfo = {
  id: string | null;
  lastSeen: string | null;
  balance: number | null;
  engines: unknown;
  // Server clock at render time: the first client render judges freshness with the same
  // clock, so the online dot and the engine choice hydrate exactly as the server drew them.
  renderedAt: number;
};

export type WorkerState = {
  id: string | null;
  lastSeen: string | null;
  balance: number | null;
  online: boolean;
  engines: EngineMap;
  // Only the admin may use local engines (profiles.role = 'admin').
  isAdmin: boolean;
  // The clock the freshness checks use; moves forward with every refresh of the row.
  now: number;
};

export const NO_WORKER: WorkerState = {
  id: null,
  lastSeen: null,
  balance: null,
  online: false,
  engines: {},
  isAdmin: false,
  now: 0,
};

const WorkerContext = createContext<WorkerState>(NO_WORKER);

// Reads the worker row now and every 15 s, so the sidebar dot, the credit balance and the
// engine choice all follow the same heartbeat.
export function useWorker(initial: WorkerInfo) {
  const [worker, setWorker] = useState(initial);
  const [now, setNow] = useState(initial.renderedAt);
  useEffect(() => {
    const db = createClient();
    let cancelled = false;
    const refresh = async () => {
      const { data } = await db
        .from("workers")
        .select("id,last_seen,kie_balance,engines")
        .order("last_seen", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (cancelled) return;
      // The clock and the row move together, so a row that is about to be replaced is never
      // judged against a newer clock (that would flicker the engine choice).
      setNow(Date.now());
      if (data)
        setWorker((current) => ({
          ...current,
          id: data.id,
          lastSeen: data.last_seen,
          balance: data.kie_balance,
          engines: data.engines,
        }));
    };
    void refresh();
    const timer = setInterval(() => void refresh(), 15000);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, []);
  return {
    id: worker.id,
    lastSeen: worker.lastSeen,
    balance: worker.balance,
    online: workerIsOnline(worker.lastSeen, now),
    engines: parseEngines(worker.engines),
    now,
  };
}

// Mounted once by the studio shell; the sidebar and the song screens read it.
export function WorkerProvider({
  initial,
  isAdmin,
  children,
}: {
  initial: WorkerInfo;
  isAdmin: boolean;
  children: React.ReactNode;
}) {
  const worker = useWorker(initial);
  return (
    <WorkerContext.Provider value={{ ...worker, isAdmin }}>
      {children}
    </WorkerContext.Provider>
  );
}

// What a song needs to know about its engine: which one, and the PC minutes it takes.
export function useSongEngine(settings: Record<string, unknown> | undefined) {
  const { engines } = useWorkerState();
  const engine = engineOf(settings);
  const duration =
    typeof settings?.duration === "number" ? settings.duration : null;
  return { engine, minutes: localCost(engine, engines, duration) };
}

// The same as a LocalCost for the song page, or null for a kie song.
export function useLocalCost(
  settings: Record<string, unknown> | undefined,
): LocalCost | null {
  const { engine, minutes } = useSongEngine(settings);
  return isLocal(engine) ? { engine, minutes } : null;
}

// A fixed state, for the pages' tests.
export const WorkerStateProvider = WorkerContext.Provider;

export function useWorkerState(): WorkerState {
  return useContext(WorkerContext);
}
