import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { isRemote } from "@/lib/remote";
import { createClient } from "@/lib/supabase/server";

export async function GET(request: Request) {
  const headers = { "Cache-Control": "no-store" };
  if (isRemote(request.headers)) {
    return Response.json({ web: "ok" }, { headers });
  }

  const version = await readFile(
    join(process.cwd(), ".next", "mdf-version"),
    "utf8",
  )
    .then((value) => value.trim() || "dev")
    .catch(() => "dev");
  const detail = {
    web: "ok",
    db: "error",
    worker_heartbeat_age_s: null as number | null,
    queue_depth: null as number | null,
    version,
    // shortcut: authenticated reads cannot see migration history; Task 14's ops.health supplies it.
    schema: null,
  };
  try {
    const db = await createClient();
    const [worker, queue] = await Promise.all([
      db
        .from("workers")
        .select("last_seen")
        .order("last_seen", { ascending: false, nullsFirst: false })
        .limit(1)
        .maybeSingle(),
      db
        .from("jobs")
        .select("id", { count: "exact", head: true })
        .eq("status", "queued"),
    ]);
    if (worker.error || queue.error) {
      return Response.json(detail, { status: 503, headers });
    }
    detail.db = "ok";
    detail.queue_depth = queue.count;
    const lastSeen = Date.parse(worker.data?.last_seen ?? "");
    if (Number.isFinite(lastSeen)) {
      detail.worker_heartbeat_age_s = Math.max(
        0,
        Math.floor((Date.now() - lastSeen) / 1000),
      );
    }
    return Response.json(detail, { headers });
  } catch {
    return Response.json(detail, { status: 503, headers });
  }
}
