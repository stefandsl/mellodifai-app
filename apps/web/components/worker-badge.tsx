import { t } from "@mellodifai/shared";

import { Badge } from "@/components/ui/badge";

export function workerIsOnline(lastSeen: string | null, now = Date.now()) {
  return Boolean(lastSeen && now - new Date(lastSeen).getTime() <= 45_000);
}

export function WorkerBadge({
  lastSeen,
  busyJobId,
  now,
}: {
  lastSeen: string | null;
  busyJobId?: string | null;
  now?: number;
}) {
  if (!workerIsOnline(lastSeen, now))
    return (
      <Badge variant="outline">
        {t("it", "worker.offline")}
        {lastSeen ? ` since ${new Date(lastSeen).toLocaleString("it-IT")}` : ""}
      </Badge>
    );
  return (
    <Badge className="bg-[#2BD9A0] text-zinc-950">
      {busyJobId ? t("it", "worker.busy") : t("it", "worker.online")}
    </Badge>
  );
}
