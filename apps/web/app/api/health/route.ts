import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { callOps } from "@/lib/db/ops-client";
import { isRemote } from "@/lib/remote";

type Health = {
  db: string;
  ops: string;
  worker_heartbeat_age_s: number | null;
  queue_depth: number;
  schema: string | null;
};

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
  const result = await callOps<Health>("health", []);
  const detail = result.ok
    ? {
        db: result.data.db,
        ops: result.data.ops,
        worker_heartbeat_age_s: result.data.worker_heartbeat_age_s,
        queue_depth: result.data.queue_depth,
        schema: result.data.schema,
      }
    : {
        db: "error",
        ops: "error",
        worker_heartbeat_age_s: null,
        queue_depth: null,
        schema: null,
      };
  return Response.json(
    { web: "ok", ...detail, version },
    {
      status:
        result.ok && detail.db === "ok" && detail.ops === "ok" ? 200 : 503,
      headers,
    },
  );
}
