import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, expect, it } from "vitest";
import { opsRpc } from "./helpers/ops-call";

let service: SupabaseClient;
let admin: SupabaseClient;
let other: SupabaseClient;
let owner: string;
const users: string[] = [];
const prefix = `spend-${Date.now()}`;
function env(name: string) {
  const value = process.env[name];
  if (!value) throw new Error(`${name} required for database tests`);
  return value;
}
beforeAll(async () => {
  service = createClient(env("SUPABASE_URL"), env("SUPABASE_SERVICE_ROLE_KEY"));
  for (const suffix of ["admin", "other"]) {
    const email = `${prefix}-${suffix}@example.test`;
    expect(
      (await service.from("admin_allowlist").insert({ email, role: "admin" }))
        .error,
    ).toBeNull();
    const result = await service.auth.admin.createUser({
      email,
      password: "spend-test-password",
      email_confirm: true,
    });
    expect(result.error).toBeNull();
    if (!result.data.user) throw new Error("Missing test user");
    const id = result.data.user.id;
    users.push(id);
    const client = createClient(env("SUPABASE_URL"), env("SUPABASE_ANON_KEY"), {
      auth: { persistSession: false },
    });
    expect(
      (
        await client.auth.signInWithPassword({
          email,
          password: "spend-test-password",
        })
      ).error,
    ).toBeNull();
    if (suffix === "admin") {
      admin = client;
      owner = id;
    } else other = client;
  }
});
afterAll(async () => {
  if (!service) return;
  for (const id of users) await service.auth.admin.deleteUser(id);
  await service.from("admin_allowlist").delete().like("email", `${prefix}%`);
});
async function ambiguous() {
  const p = await service
    .from("projects")
    .insert({ owner_id: owner, topic: prefix })
    .select()
    .single();
  expect(p.error).toBeNull();
  const v = await service
    .from("versions")
    .insert({
      owner_id: owner,
      project_id: p.data.id,
      lang: "it",
      status: "failed",
      kie_submit_state: "submitting",
    })
    .select()
    .single();
  expect(v.error).toBeNull();
  return v.data.id as string;
}
async function state(id: string) {
  const result = await service.from("versions").select().eq("id", id).single();
  expect(result.error).toBeNull();
  return result.data;
}
it("blocks Generate again without changing the generation or enqueueing a spend", async () => {
  const id = await ambiguous();
  expect(
    (
      await admin.rpc("transition_version", {
        p_version: id,
        p_action: "generate_again",
      })
    ).error,
  ).not.toBeNull();
  const result = await opsRpc(admin, "generate_again", {
    p_version: id,
    p_generation: 1,
  });
  expect(result.error?.message).toBe(
    "kie submission state unknown: resolve it in the kie dashboard first",
  );
  expect(await state(id)).toMatchObject({
    generation_count: 1,
    status: "failed",
    kie_submit_state: "submitting",
  });
  const jobs = await service.from("jobs").select("id").eq("version_id", id);
  expect(jobs.error).toBeNull();
  expect(jobs.data).toEqual([]);
});
it("returns an uncharged ambiguous submission to lyrics review", async () => {
  const id = await ambiguous();
  expect(
    (
      await opsRpc(admin, "resolve_kie_submission", {
        p_version: id,
        p_charged: false,
      })
    ).error,
  ).toBeNull();
  expect(await state(id)).toMatchObject({
    kie_submit_state: null,
    kie_task_id: null,
    generation_count: 2,
    status: "lyrics_review",
  });
  expect(
    (await service.from("jobs").select("id").eq("version_id", id)).data,
  ).toEqual([]);
});
it("recovers a charged submission by queueing its known task", async () => {
  const id = await ambiguous();
  const job = await service
    .from("jobs")
    .insert({
      owner_id: owner,
      version_id: id,
      stage: "generate_song",
      status: "failed",
      idempotency_key: `generate_song:${id}:1`,
    })
    .select()
    .single();
  expect(job.error).toBeNull();
  expect(
    (
      await opsRpc(admin, "resolve_kie_submission", {
        p_version: id,
        p_charged: true,
        p_task_id: "recovered-task",
      })
    ).error,
  ).toBeNull();
  expect(await state(id)).toMatchObject({
    kie_task_id: "recovered-task",
    kie_submit_state: "submitted",
    generation_count: 1,
    status: "song_queued",
  });
  expect(
    (
      await service
        .from("jobs")
        .select("id")
        .eq("version_id", id)
        .eq("status", "queued")
    ).data,
  ).toHaveLength(1);
});
it("requires an owning admin, rejects malformed outcomes, and does not resolve active work", async () => {
  const id = await ambiguous();
  const args = { p_version: id, p_charged: false };
  expect(
    (await opsRpc(other, "resolve_kie_submission", args)).error,
  ).not.toBeNull();
  expect(
    (
      await service
        .from("profiles")
        .update({ role: "customer" })
        .eq("id", owner)
    ).error,
  ).toBeNull();
  try {
    expect(
      (await opsRpc(admin, "resolve_kie_submission", args)).error?.message,
    ).toBe("admin required");
  } finally {
    expect(
      (await service.from("profiles").update({ role: "admin" }).eq("id", owner))
        .error,
    ).toBeNull();
  }
  for (const [p_charged, p_task_id] of [
    [null, null],
    [true, null],
    [true, ""],
    [true, "bad task"],
  ] as const) {
    expect(
      (
        await opsRpc(admin, "resolve_kie_submission", {
          p_version: id,
          p_charged,
          p_task_id,
        })
      ).error,
    ).not.toBeNull();
  }
  const anon = createClient(env("SUPABASE_URL"), env("SUPABASE_ANON_KEY"));
  expect((await anon.rpc("resolve_kie_submission", args)).error).not.toBeNull();
  expect(
    (
      await service.from("jobs").insert({
        owner_id: owner,
        version_id: id,
        stage: "generate_song",
        idempotency_key: `active:${id}`,
      })
    ).error,
  ).toBeNull();
  expect(
    (await opsRpc(admin, "resolve_kie_submission", args)).error?.message,
  ).toBe("job already active");
  expect(await state(id)).toMatchObject({
    kie_submit_state: "submitting",
    kie_task_id: null,
  });
});
