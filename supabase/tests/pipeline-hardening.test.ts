import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, expect, it } from "vitest";
import { opsRpc } from "./helpers/ops-call";

let service: SupabaseClient;
let client: SupabaseClient;
let other: SupabaseClient;
let owner: string;
let otherOwner: string;
let version: string;
let render: string;
let publication: string;
const prefix = `hardening-${Date.now()}`;
const users: string[] = [];
function env(key: string) {
  const value = process.env[key];
  if (!value) throw new Error(`${key} required for database tests`);
  return value;
}
beforeAll(async () => {
  service = createClient(env("SUPABASE_URL"), env("SUPABASE_SERVICE_ROLE_KEY"));
  const user = async (suffix: string) => {
    const email = `${prefix}-${suffix}@example.test`;
    expect(
      (await service.from("admin_allowlist").insert({ email, role: "admin" }))
        .error,
    ).toBeNull();
    const result = await service.auth.admin.createUser({
      email,
      password: "hardening-test-password",
      email_confirm: true,
    });
    expect(result.error).toBeNull();
    if (!result.data.user) throw new Error("Missing test user");
    const id = result.data.user.id;
    users.push(id);
    const c = createClient(env("SUPABASE_URL"), env("SUPABASE_ANON_KEY"), {
      auth: { persistSession: false },
    });
    expect(
      (
        await c.auth.signInWithPassword({
          email,
          password: "hardening-test-password",
        })
      ).error,
    ).toBeNull();
    return { id, c };
  };
  const a = await user("a"),
    b = await user("b");
  owner = a.id;
  client = a.c;
  other = b.c;
  otherOwner = b.id;
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
      lang: "fr",
      status: "approved",
    })
    .select()
    .single();
  expect(v.error).toBeNull();
  version = v.data.id;
  const r = await service
    .from("renders")
    .insert({
      owner_id: owner,
      version_id: version,
      kind: "master",
      path: "E:/workspace/video.mp4",
    })
    .select()
    .single();
  expect(r.error).toBeNull();
  render = r.data.id;
  const pub = await service
    .from("publications")
    .insert({
      owner_id: owner,
      render_id: render,
      youtube_video_id: "worker-video",
      upload_state: "uploaded",
    })
    .select()
    .single();
  expect(pub.error).toBeNull();
  publication = pub.data.id;
  expect(
    (await service.from("workers").insert({ id: prefix, owner_id: owner }))
      .error,
  ).toBeNull();
});
afterAll(async () => {
  if (!service) return;
  for (const id of users) await service.auth.admin.deleteUser(id);
  await service.from("admin_allowlist").delete().like("email", `${prefix}%`);
});

it.each(["takes", "renders", "publications", "workers", "job_events"])(
  "denies client writes to %s",
  async (table) => {
    const patch =
      table === "renders"
        ? { path: "C:/private/file" }
        : table === "publications"
          ? {
              youtube_video_id: "forged",
              confirmed_by: owner,
              confirmed_at: new Date().toISOString(),
            }
          : table === "takes"
            ? { kie_task_id: "forged" }
            : table === "workers"
              ? { youtube_uploads_today: 0 }
              : { message: "forged" };
    expect((await client.from(table).update(patch)).error).not.toBeNull();
    expect((await client.from(table).delete()).error).not.toBeNull();
    expect(
      (await client.from(table).insert({ owner_id: owner })).error,
    ).not.toBeNull();
  },
);
it.each([
  "status",
  "kie_task_id",
  "render_attempt",
  "generation_count",
  "kie_submit_state",
])("denies client updates to versions.%s", async (column) => {
  const value =
    column === "status"
      ? "approved"
      : column.includes("count") || column.includes("attempt")
        ? 5
        : "forged";
  expect(
    (
      await client
        .from("versions")
        .update({ [column]: value })
        .eq("id", version)
    ).error,
  ).not.toBeNull();
});
it.each([
  "render_master",
  "render_hook",
  "storyboard",
  "qa",
  "art",
  "import_legacy",
])("rejects client job stage %s", async (stage) => {
  expect(
    (
      await client.from("jobs").insert({
        owner_id: owner,
        version_id: version,
        stage,
        idempotency_key: `${prefix}:${stage}`,
      })
    ).error,
  ).not.toBeNull();
});
it("rejects forged worker fields and not_before on job insertion", async () => {
  expect(
    (
      await client.from("jobs").insert({
        owner_id: owner,
        version_id: version,
        stage: "publish",
        idempotency_key: `${prefix}:forged`,
        not_before: new Date().toISOString(),
      })
    ).error,
  ).not.toBeNull();
});
it("confirmation requires owner and uploaded video; records identity and queues privacy", async () => {
  expect(
    (
      await opsRpc(other, "confirm_publication", {
        p_publication: publication,
        p_privacy: "public",
      })
    ).error,
  ).not.toBeNull();
  expect(
    (
      await opsRpc(client, "confirm_publication", {
        p_publication: publication,
        p_privacy: "scheduled",
        p_publish_at: "2000-01-01T00:00:00Z",
      })
    ).error,
  ).not.toBeNull();
  const pending = await service
    .from("publications")
    .insert({ owner_id: owner, render_id: render })
    .select()
    .single();
  expect(
    (
      await opsRpc(client, "confirm_publication", {
        p_publication: pending.data.id,
        p_privacy: "public",
      })
    ).error,
  ).not.toBeNull();
  const result = await opsRpc(client, "confirm_publication", {
    p_publication: publication,
    p_privacy: "public",
  });
  expect(result.error).toBeNull();
  const row = await service
    .from("publications")
    .select()
    .eq("id", publication)
    .single();
  expect(row.data).toMatchObject({ confirmed_by: owner, privacy: "public" });
  expect(row.data.confirmed_at).toBeTruthy();
  const job = await service
    .from("jobs")
    .select()
    .eq("id", result.data)
    .single();
  expect(job.data).toMatchObject({
    owner_id: owner,
    version_id: version,
    stage: "set_privacy",
    payload: { publication_id: publication },
  });
  expect(
    (
      await client
        .from("publications")
        .update({ confirmed_by: otherOwner })
        .eq("id", publication)
    ).error,
  ).not.toBeNull();
});
it("quota reservation is atomic and service-only", async () => {
  const decimal = await service
    .from("workers")
    .update({ kie_balance: 88.25 })
    .eq("id", prefix)
    .select("kie_balance")
    .single();
  expect(decimal.error).toBeNull();
  expect(decimal.data?.kie_balance).toBe(88.25);
  expect(
    (await client.rpc("reserve_youtube_upload", { p_worker: prefix })).error,
  ).not.toBeNull();
  const results = await Promise.all(
    Array.from({ length: 10 }, () =>
      service.rpc("reserve_youtube_upload", { p_worker: prefix }),
    ),
  );
  expect(results.every((r) => r.error === null)).toBe(true);
  expect(results.filter((r) => r.data === true)).toHaveLength(4);
  const row = await service.from("workers").select().eq("id", prefix).single();
  expect(row.data.youtube_uploads_today).toBe(4);
  await service
    .from("workers")
    .update({ youtube_quota_day: "2000-01-01" })
    .eq("id", prefix);
  expect(
    (await service.rpc("reserve_youtube_upload", { p_worker: prefix })).data,
  ).toBe(true);
});
it("publication and quota reservations are serialized for the same render", async () => {
  const r = await service
    .from("renders")
    .insert({ owner_id: owner, version_id: version, kind: "hook" })
    .select()
    .single();
  await service
    .from("workers")
    .update({ youtube_uploads_today: 0 })
    .eq("id", prefix);
  const results = await Promise.all(
    [1, 2].map(() =>
      service.rpc("reserve_publication_upload", {
        p_render: r.data.id,
        p_worker: prefix,
      }),
    ),
  );
  expect(results.every((r) => r.error === null)).toBe(true);
  expect(results.map((r) => r.data.kind).sort()).toEqual([
    "reserved",
    "uploading",
  ]);
  expect(
    (await service.from("workers").select().eq("id", prefix).single()).data
      .youtube_uploads_today,
  ).toBe(1);
});
it("claim skips future jobs and explicit transitions are owner-checked", async () => {
  await service.from("jobs").delete().eq("owner_id", owner);
  const job = await service
    .from("jobs")
    .insert({
      owner_id: owner,
      version_id: version,
      stage: "publish",
      idempotency_key: `${prefix}:future`,
      not_before: new Date(Date.now() + 3600000).toISOString(),
    })
    .select()
    .single();
  expect(job.error).toBeNull();
  const claim = await service.rpc("claim_job", { p_worker: prefix });
  expect(claim.error).toBeNull();
  expect(claim.data.some((j: { id: string }) => j.id === job.data.id)).toBe(
    false,
  );
  // End the future-job fixture before testing an independent rerender.
  expect(
    (
      await service
        .from("jobs")
        .update({ status: "cancelled" })
        .eq("id", job.data.id)
    ).error,
  ).toBeNull();
  expect(
    (
      await opsRpc(other, "render_again", {
        p_version: version,
      })
    ).error,
  ).not.toBeNull();
  expect(
    (
      await opsRpc(client, "render_again", {
        p_version: version,
      })
    ).error,
  ).toBeNull();
  expect(
    (await service.from("versions").select().eq("id", version).single()).data,
  ).toMatchObject({ status: "producing", render_attempt: 2 });
});
