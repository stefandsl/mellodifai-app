import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, expect, it } from "vitest";

let service: SupabaseClient;
let client: SupabaseClient;
let other: SupabaseClient;
let owner: string;
const users: string[] = [];
const prefix = `web-flow-${Date.now()}`;
function env(k: string) {
  const v = process.env[k];
  if (!v) throw new Error(`${k} required`);
  return v;
}
beforeAll(async () => {
  service = createClient(env("SUPABASE_URL"), env("SUPABASE_SERVICE_ROLE_KEY"));
  for (const suffix of ["a", "b"]) {
    const email = `${prefix}-${suffix}@example.test`;
    await service.from("admin_allowlist").insert({ email });
    const result = await service.auth.admin.createUser({
      email,
      password: "web-flow-test-password",
      email_confirm: true,
    });
    expect(result.error).toBeNull();
    const id = result.data.user?.id;
    if (!id) throw new Error("user missing");
    users.push(id);
    const c = createClient(env("SUPABASE_URL"), env("SUPABASE_ANON_KEY"), {
      auth: { persistSession: false },
    });
    expect(
      (
        await c.auth.signInWithPassword({
          email,
          password: "web-flow-test-password",
        })
      ).error,
    ).toBeNull();
    if (suffix === "a") {
      client = c;
      owner = id;
    } else other = c;
  }
});
afterAll(async () => {
  if (!service) return;
  for (const id of users) await service.auth.admin.deleteUser(id);
  await service.from("admin_allowlist").delete().like("email", `${prefix}%`);
});
const args = {
  p_topic: "Web song",
  p_brief: "A brief",
  p_languages: ["en", "en"],
  p_style: "Pop",
  p_mood: "Bright",
  p_vocal_gender: "f",
};
async function fixture(status: string) {
  const p = await client.rpc("create_project", args);
  expect(p.error).toBeNull();
  const v = await service
    .from("versions")
    .select()
    .eq("project_id", p.data)
    .single();
  expect(v.error).toBeNull();
  expect(
    (await service.from("versions").update({ status }).eq("id", v.data.id))
      .error,
  ).toBeNull();
  return v.data.id as string;
}
it("deduplicates languages, enqueues drafts and rolls back invalid creation", async () => {
  const result = await client.rpc("create_project", args);
  expect(result.error).toBeNull();
  const versions = await service
    .from("versions")
    .select()
    .eq("project_id", result.data);
  expect(versions.data).toHaveLength(1);
  const jobs = await service
    .from("jobs")
    .select()
    .eq("version_id", versions.data?.[0].id);
  expect(jobs.data).toHaveLength(1);
  expect(jobs.data?.[0].idempotency_key).toBe(
    `draft_lyrics:${versions.data?.[0].id}:1`,
  );
  const before = await service
    .from("projects")
    .select("id", { count: "exact" })
    .eq("owner_id", owner);
  expect(
    (await client.rpc("create_project", { ...args, p_languages: ["en", "xx"] }))
      .error,
  ).not.toBeNull();
  const after = await service
    .from("projects")
    .select("id", { count: "exact" })
    .eq("owner_id", owner);
  expect(after.count).toBe(before.count);
});
it("approves lyrics atomically, denies direct edits, bad shapes, other owners and double approval", async () => {
  const v = await fixture("lyrics_review");
  expect(
    (await client.from("versions").update({ lyric_pack: {} }).eq("id", v))
      .error,
  ).not.toBeNull();
  for (const c of [client, other])
    expect(
      (await c.rpc("approve_lyrics", { p_version: v, p_pack: {} })).error,
    ).not.toBeNull();
  expect(
    (
      await other.rpc("approve_lyrics", {
        p_version: v,
        p_pack: { title: "Song", lyrics: "Line" },
      })
    ).error,
  ).not.toBeNull();
  const results = await Promise.all(
    [1, 2].map(() =>
      client.rpc("approve_lyrics", {
        p_version: v,
        p_pack: { title: "Song", lyrics: "Line" },
      }),
    ),
  );
  expect(results.filter((r) => !r.error)).toHaveLength(1);
  const row = await service.from("versions").select().eq("id", v).single();
  expect(row.data).toMatchObject({
    status: "song_queued",
    lyric_pack: { title: "Song", lyrics: "Line" },
  });
  const jobs = await service
    .from("jobs")
    .select()
    .eq("version_id", v)
    .eq("stage", "generate_song");
  expect(jobs.data).toHaveLength(1);
  expect(jobs.data?.[0].idempotency_key).toBe(`generate_song:${v}:1`);
  expect(
    (
      await client.rpc("transition_version", {
        p_version: v,
        p_action: "approve_lyrics",
      })
    ).error,
  ).not.toBeNull();
});
it("picks only current generation and transitions once to producing with timing queued", async () => {
  const v = await fixture("takes_review");
  await service.from("versions").update({ generation_count: 2 }).eq("id", v);
  const a = await service
    .from("takes")
    .insert({ owner_id: owner, version_id: v, generation: 1 })
    .select()
    .single();
  const b = await service
    .from("takes")
    .insert({ owner_id: owner, version_id: v, generation: 2 })
    .select()
    .single();
  expect(
    (await client.rpc("pick_take", { p_version: v, p_take: a.data.id })).error,
  ).not.toBeNull();
  expect(
    (await other.rpc("pick_take", { p_version: v, p_take: b.data.id })).error,
  ).not.toBeNull();
  expect(
    (await client.rpc("pick_take", { p_version: v, p_take: b.data.id })).error,
  ).toBeNull();
  expect(
    (await client.rpc("pick_take", { p_version: v, p_take: b.data.id })).error,
  ).not.toBeNull();
  expect(
    (await service.from("versions").select().eq("id", v).single()).data,
  ).toMatchObject({ status: "producing", chosen_take_id: b.data.id });
  expect(
    (
      await service
        .from("jobs")
        .select()
        .eq("idempotency_key", `timing:${v}:1`)
        .single()
    ).error,
  ).toBeNull();
});
it("records failed-QA override and approver, uses current attempt and rerenders atomically", async () => {
  const v = await fixture("video_review");
  const r = await service
    .from("renders")
    .insert({
      owner_id: owner,
      version_id: v,
      kind: "master",
      qa_results: { gates: [{ name: "loudness", pass: false, value: -10 }] },
    })
    .select()
    .single();
  expect(
    (await client.rpc("approve_video", { p_version: v })).error,
  ).not.toBeNull();
  expect(
    (
      await other.rpc("approve_video", {
        p_version: v,
        p_override_reason: "Reviewed",
      })
    ).error,
  ).not.toBeNull();
  expect(
    (
      await client.rpc("approve_video", {
        p_version: v,
        p_override_reason: "Deliberately louder",
      })
    ).error,
  ).toBeNull();
  const approved = await service
    .from("renders")
    .select()
    .eq("id", r.data.id)
    .single();
  expect(approved.data).toMatchObject({
    approved_by: owner,
    override_reason: "Deliberately louder",
  });
  expect(approved.data.approved_at).toBeTruthy();
  const results = await Promise.all(
    [1, 2].map(() => client.rpc("render_again", { p_version: v })),
  );
  expect(results.filter((r) => !r.error)).toHaveLength(1);
  expect(
    (await service.from("versions").select().eq("id", v).single()).data,
  ).toMatchObject({ render_attempt: 2, status: "producing" });
  expect(
    (
      await service
        .from("jobs")
        .select()
        .eq("idempotency_key", `timing:${v}:2`)
        .single()
    ).error,
  ).toBeNull();
  await service.from("versions").update({ status: "video_review" }).eq("id", v);
  expect(
    (
      await client.rpc("approve_video", {
        p_version: v,
        p_override_reason: "Old render",
      })
    ).error,
  ).not.toBeNull();
});
it("publishes only approved current masters, deduplicates pending requests and permits failed retries", async () => {
  const v = await fixture("approved");
  const r = await service
    .from("renders")
    .insert({ owner_id: owner, version_id: v, kind: "master" })
    .select()
    .single();
  const input = { p_render: r.data.id, p_metadata: { title: "Song" } };
  expect((await client.rpc("enqueue_publish", input)).error).not.toBeNull();
  await service
    .from("renders")
    .update({ approved_at: new Date().toISOString() })
    .eq("id", r.data.id);
  for (let i = 0; i < 2; i++)
    expect((await client.rpc("enqueue_publish", input)).error).toBeNull();
  let jobs = await service
    .from("jobs")
    .select()
    .eq("version_id", v)
    .eq("stage", "publish");
  expect(jobs.data).toHaveLength(1);
  expect(jobs.data?.[0].idempotency_key).toBe(`publish:${r.data.id}:1`);
  await service
    .from("jobs")
    .update({ status: "failed" })
    .eq("id", jobs.data?.[0].id);
  expect((await client.rpc("enqueue_publish", input)).error).toBeNull();
  jobs = await service
    .from("jobs")
    .select()
    .eq("version_id", v)
    .eq("stage", "publish");
  expect(jobs.data).toHaveLength(2);
  await service
    .from("versions")
    .update({ render_attempt: 2, status: "approved" })
    .eq("id", v);
  expect((await client.rpc("enqueue_publish", input)).error).not.toBeNull();
});
it("generation and retry requests cannot double enqueue on repeated clicks", async () => {
  const v = await fixture("takes_review");
  const first = await client.rpc("generate_again", {
    p_version: v,
    p_generation: 1,
  });
  expect(first.error).toBeNull();
  expect(
    (await client.rpc("generate_again", { p_version: v, p_generation: 1 }))
      .error,
  ).not.toBeNull();
  const job = await service
    .from("jobs")
    .select()
    .eq("version_id", v)
    .eq("stage", "generate_song")
    .single();
  await service.from("jobs").update({ status: "done" }).eq("version_id", v);
  await service
    .from("jobs")
    .update({ status: "failed", error: "Temporary issue" })
    .eq("id", job.data.id);
  await service.from("versions").update({ status: "failed" }).eq("id", v);
  expect(
    (await client.rpc("retry_stage", { p_version: v, p_job: job.data.id }))
      .error,
  ).toBeNull();
  expect(
    (await client.rpc("retry_stage", { p_version: v, p_job: job.data.id }))
      .error,
  ).not.toBeNull();
  expect(
    (await service.from("versions").select().eq("id", v).single()).data,
  ).toMatchObject({ status: "song_queued", generation_count: 2 });
});
