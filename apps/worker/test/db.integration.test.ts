import { createClient } from "@supabase/supabase-js";
import { expect, it } from "vitest";
import { SupabaseDb } from "../src/db.js";

function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required for queue integration`);
  return value;
}

it("claims, heartbeats, and finishes its own queued fixture", async () => {
  const url = required("SUPABASE_URL");
  const key = required("SUPABASE_SERVICE_ROLE_KEY");
  const service = createClient(url, key, { auth: { persistSession: false } });
  const id = crypto.randomUUID();
  const email = `queue-integration-${id}@example.test`;
  const worker = `queue-integration-${id}`;
  let owner: string | undefined;
  let project: string | undefined;
  let childId: string | undefined;
  try {
    expect(
      (await service.from("admin_allowlist").insert({ email })).error,
    ).toBeNull();
    const user = await service.auth.admin.createUser({
      email,
      email_confirm: true,
    });
    expect(user.error).toBeNull();
    owner = user.data.user?.id;
    if (!owner) throw new Error("Fixture owner was not created");
    const created = await service
      .from("projects")
      .insert({ owner_id: owner, topic: "Queue integration" })
      .select("id")
      .single();
    expect(created.error).toBeNull();
    project = created.data?.id;
    const version = await service
      .from("versions")
      .insert({ owner_id: owner, project_id: project, lang: "en" })
      .select("id")
      .single();
    expect(version.error).toBeNull();
    const versionId = version.data?.id;
    if (!versionId) throw new Error("Fixture version was not created");
    expect(
      (
        await service.from("jobs").insert({
          id,
          owner_id: owner,
          version_id: versionId,
          stage: "draft_lyrics",
          idempotency_key: worker,
          created_at: "1970-01-01T00:00:00Z",
        })
      ).error,
    ).toBeNull();
    const db = new SupabaseDb(url, key, owner);
    const job = await db.claim(worker);
    expect(job).toMatchObject({
      id,
      status: "running",
      worker_id: worker,
      attempts: 1,
    });
    expect(await db.heartbeat(id, worker)).toBe(true);
    expect(await db.heartbeat(id, `${worker}-wrong`)).toBe(false);
    childId = await db.enqueue(
      id,
      versionId,
      "import_audio",
      `${worker}-child`,
    );
    expect(
      (
        await service
          .from("jobs")
          .select("id,owner_id,version_id,stage")
          .eq("id", childId)
          .single()
      ).data,
    ).toMatchObject({
      id: childId,
      owner_id: owner,
      version_id: versionId,
      stage: "import_audio",
    });
    await db.finishJob(id, { integration: true }, worker);
    const finished = await service
      .from("jobs")
      .select("status,result,heartbeat_at,finished_at")
      .eq("id", id)
      .single();
    expect(finished.error).toBeNull();
    expect(finished.data).toMatchObject({
      status: "done",
      result: { integration: true },
      heartbeat_at: null,
    });
    expect(finished.data?.finished_at).toBeTruthy();
  } finally {
    if (childId)
      expect(
        (await service.from("jobs").delete().eq("id", childId)).error,
      ).toBeNull();
    expect((await service.from("jobs").delete().eq("id", id)).error).toBeNull();
    if (project)
      expect(
        (await service.from("projects").delete().eq("id", project)).error,
      ).toBeNull();
    if (owner)
      expect((await service.auth.admin.deleteUser(owner)).error).toBeNull();
    expect(
      (await service.from("admin_allowlist").delete().eq("email", email)).error,
    ).toBeNull();
  }
}, 30_000);
