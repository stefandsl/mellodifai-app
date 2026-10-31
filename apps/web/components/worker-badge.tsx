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
  now,
  workerId,
  balance = null,
}: {
  lastSeen: string | null;
  now?: number;
  workerId?: string;
  balance?: number | null;
}) {
  const lang = useLocale();
  const [clock, setClock] = useState(now ?? Date.now());
  const [worker, setWorker] = useState({
    last_seen: lastSeen,
    kie_balance: balance,
  });
  useEffect(() => {
    setWorker({
      last_seen: lastSeen,
      kie_balance: balance,
    });
  }, [lastSeen, balance]);
  useEffect(() => {
    const timer = setInterval(() => setClock(Date.now()), 15000);
    return () => clearInterval(timer);
  }, []);
  useEffect(() => {
    if (!workerId) return;
    const db = createClient();
    let cancelled = false;
    const refresh = async () => {
      const { data } = await db
        .from("workers")
        .select(
          "id,last_seen,kie_balance,youtube_uploads_today,youtube_quota_day,engine_version",
        )
        .eq("id", workerId)
        .maybeSingle();
      if (data && !cancelled) {
        setWorker({
          last_seen: data.last_seen,
          kie_balance: data.kie_balance,
        });
      }
    };
    void refresh();
    const timer = setInterval(() => void refresh(), 15000);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [workerId]);
  const online = workerIsOnline(worker.last_seen, now ?? clock);
  return (
    <div className="space-y-1 text-xs">
      <Badge variant="secondary">
        {online ? t(lang, "worker.online") : t(lang, "worker.offline")}
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
