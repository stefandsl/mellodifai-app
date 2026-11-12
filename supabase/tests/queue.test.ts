import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { afterEach, beforeAll, describe, expect, it } from "vitest";

const requiredEnvironment = [
  "SUPABASE_URL",
  "SUPABASE_SERVICE_ROLE_KEY",
] as const;
const testPrefix = `queue-test-${Date.now()}-${Math.random().toString(36).slice(2)}`;
let service: SupabaseClient;
let ownerId: string;
let projectId: string;
let versionId: string;

function environment(name: (typeof requiredEnvironment)[number]): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} must be set to run database tests`);
  return value;
}

async function insertJob(
  key: string,
): Promise<{ id: string; attempts: number }> {
  const { data, error } = await service
    .from("jobs")
    .insert({
      owner_id: ownerId,
      version_id: versionId,
      stage: "draft_lyrics",
      idempotency_key: `${testPrefix}-${key}`,
    })
    .select("id, attempts")
    .single();
  expect(error).toBeNull();
  if (!data) throw new Error("Expected test job");
  return data;
}

beforeAll(async () => {
  service = createClient(
    environment("SUPABASE_URL"),
    environment("SUPABASE_SERVICE_ROLE_KEY"),
    { auth: { persistSession: false, autoRefreshToken: false } },
  );
  const email = `${testPrefix}@example.test`;
  const { error: allowlistError } = await service
    .from("admin_allowlist")
    .insert({ email, role: "admin" });
  expect(allowlistError).toBeNull();
  const { data: userData, error: userError } =
    await service.auth.admin.createUser({
      email,
      password: "database-test-password",
      email_confirm: true,
    });
  expect(userError).toBeNull();
  if (!userData.user) throw new Error("Expected queue test user");
  ownerId = userData.user.id;

  const { data: project, error: projectError } = await service
    .from("projects")
    .insert({ owner_id: ownerId, topic: "Queue test project" })
    .select("id")
    .single();
  expect(projectError).toBeNull();
  if (!project) throw new Error("Expected queue test project");
  projectId = project.id;

  const { data: version, error: versionError } = await service
    .from("versions")
    .insert({ owner_id: ownerId, project_id: projectId, lang: "en" })
    .select("id")
    .single();
  expect(versionError).toBeNull();
  if (!version) throw new Error("Expected queue test version");
  versionId = version.id;
});

afterEach(async () => {
  const { error } = await service
    .from("jobs")
    .delete()
    .like("idempotency_key", `${testPrefix}-%`);
  expect(error).toBeNull();
});

describe("job queue RPCs", () => {
  it("claims each queued job once when two workers claim concurrently", async () => {
    const jobA = await insertJob("concurrent-a");
    const jobB = await insertJob("concurrent-b");

    const [first, second] = await Promise.all([
      service.rpc("claim_job", { p_worker: "worker-a" }),
      service.rpc("claim_job", { p_worker: "worker-b" }),
    ]);
    expect(first.error).toBeNull();
    expect(second.error).toBeNull();
    expect(first.data).toEqual([
      expect.objectContaining({
        status: "running",
        attempts: 1,
        worker_id: "worker-a",
      }),
    ]);
    expect(second.data).toEqual([
      expect.objectContaining({
        status: "running",
        attempts: 1,
        worker_id: "worker-b",
      }),
    ]);
    expect([first.data[0].id, second.data[0].id].sort()).toEqual(
      [jobA.id, jobB.id].sort(),
    );
  });

  it("returns [job] and [] for two concurrent claims of one queued job", async () => {
    const job = await insertJob("single");

    const [first, second] = await Promise.all([
      service.rpc("claim_job", { p_worker: "worker-a" }),
      service.rpc("claim_job", { p_worker: "worker-b" }),
    ]);
    expect(first.error).toBeNull();
    expect(second.error).toBeNull();
    const claims = [first.data, second.data];
    expect(claims).toContainEqual([]);
    expect(claims.flat()).toEqual([
      expect.objectContaining({ id: job.id, status: "running", attempts: 1 }),
    ]);
    for (const [index, claim] of claims.entries()) {
      expect(Array.isArray(claim)).toBe(true);
      if (claim.length > 0) {
        expect(claim[0].worker_id).toBe(index === 0 ? "worker-a" : "worker-b");
      }
    }
  });

  it("returns scalar booleans for matching and non-matching heartbeats", async () => {
    const job = await insertJob("heartbeat");
    const claim = await service.rpc("claim_job", { p_worker: "worker-a" });
    expect(claim.error).toBeNull();
    expect(claim.data).toEqual([expect.objectContaining({ id: job.id })]);

    for (const [worker, expected] of [
      ["worker-a", true],
      ["worker-b", false],
    ] as const) {
      const heartbeat = await service.rpc("heartbeat_job", {
        p_job: job.id,
        p_worker: worker,
      });
      expect(heartbeat.error).toBeNull();
      expect(heartbeat.data).toBe(expected);
    }
  });

  it("requeues stale jobs without changing their attempts", async () => {
    const job = await insertJob("stale");
    const { error: runningError } = await service
      .from("jobs")
      .update({
        status: "running",
        attempts: 4,
        worker_id: "worker-a",
        heartbeat_at: new Date(Date.now() - 180_000).toISOString(),
      })
      .eq("id", job.id);
    expect(runningError).toBeNull();

    const { data: requeued, error: requeueError } = await service.rpc(
      "requeue_stale",
      { p_seconds: 120 },
    );
    expect(requeueError).toBeNull();
    // A stack shared with other runs may hold stale jobs of its own: at least this one.
    expect(requeued).toBeGreaterThanOrEqual(1);

    const { data: updated, error: updatedError } = await service
      .from("jobs")
      .select("status, attempts")
      .eq("id", job.id)
      .single();
    expect(updatedError).toBeNull();
    expect(updated).toEqual({ status: "queued", attempts: 4 });

    const noStaleJobs = await service.rpc("requeue_stale", { p_seconds: 120 });
    expect(noStaleJobs.error).toBeNull();
    expect(noStaleJobs.data).toBe(0);
  });

  it("enforces unique idempotency keys", async () => {
    await insertJob("duplicate");
    const { error } = await service.from("jobs").insert({
      owner_id: ownerId,
      version_id: versionId,
      stage: "draft_lyrics",
      idempotency_key: `${testPrefix}-duplicate`,
    });
    expect(error).not.toBeNull();
    expect(error?.code).toBe("23505");
  });
});
