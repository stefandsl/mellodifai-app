import { describe, expect, it } from "vitest";
import { SupabaseDb } from "../src/db.js";

const url = process.env.SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
const enabled = Boolean(url && key);

describe.skipIf(!enabled)("Supabase queue integration", () => {
  it("claims, heartbeats, and finishes a queued job", async () => {
    if (!url || !key)
      throw new Error("integration credentials are unavailable");
    const db = new SupabaseDb(url, key, process.env.WORKER_OWNER_ID);
    const job = await db.claim(`integration-${crypto.randomUUID()}`);
    if (!job) return;
    expect(await db.heartbeat(job.id, job.worker_id ?? "")).toBe(true);
    await db.finishJob(job.id, { integration: true });
  });
});
