"use client";
import { t } from "@mellodifai/shared";
import { useEffect, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { createClient } from "@/lib/supabase/browser";
import { useLocale } from "./locale-provider";
export function workerIsOnline(lastSeen: string | null, now = Date.now()) {
  return Boolean(lastSeen && now - Date.parse(lastSeen) <= 45000);
}
export function WorkerBadge({
  lastSeen,
  busyJobId,
  now,
  workerId,
  balance = null,
}: {
  lastSeen: string | null;
  busyJobId?: string | null;
  now?: number;
  workerId?: string;
  balance?: number | null;
}) {
  const lang = useLocale();
  const [clock, setClock] = useState(now ?? Date.now());
  const [worker, setWorker] = useState({
    last_seen: lastSeen,
    busy_job_id: busyJobId,
    kie_balance: balance,
  });
  useEffect(() => {
    setWorker({
      last_seen: lastSeen,
      busy_job_id: busyJobId,
      kie_balance: balance,
    });
  }, [lastSeen, busyJobId, balance]);
  useEffect(() => {
    const timer = setInterval(() => setClock(Date.now()), 15000);
    return () => clearInterval(timer);
  }, []);
  useEffect(() => {
    const db = createClient();
    const channel = db
      .channel(`worker:${workerId ?? "available"}`)
      .on(
        "postgres_changes",
        {
          event: "UPDATE",
          schema: "public",
          table: "workers",
          ...(workerId ? { filter: `id=eq.${workerId}` } : {}),
        },
        (p) => setWorker(p.new as typeof worker),
      )
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "workers",
          ...(workerId ? { filter: `id=eq.${workerId}` } : {}),
        },
        (p) => setWorker(p.new as typeof worker),
      )
      .subscribe();
    return () => {
      void db.removeChannel(channel);
    };
  }, [workerId]);
  const online = workerIsOnline(worker.last_seen, now ?? clock);
  return (
    <div className="space-y-1 text-xs">
      <Badge variant="secondary">
        {online
          ? t(lang, worker.busy_job_id ? "worker.busy" : "worker.online")
          : t(lang, "worker.offline")}
        {!online &&
          worker.last_seen &&
          ` ${t(lang, "worker.since")} ${new Date(worker.last_seen).toLocaleString(lang)}`}
      </Badge>
      <p>
        {t(lang, "project.balance")}:{" "}
        {worker.kie_balance ?? t(lang, "value.unknown")}
      </p>
    </div>
  );
}
