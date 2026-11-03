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
    await service.from("admin_allowlist").insert({ email, role: "admin" });
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
it("allows only the worker to write kie_task_state, while the owner can read it", async () => {
  const version = await fixture("failed");
  expect(
    (
      await service
        .from("versions")
        .update({ kie_task_state: "failed" })
        .eq("id", version)
    ).error,
  ).toBeNull();
  expect(
    (
      await client
        .from("versions")
        .select("kie_task_state")
        .eq("id", version)
        .single()
    ).data,
  ).toEqual({ kie_task_state: "failed" });
  expect(
    (
      await client
        .from("versions")
        .update({ kie_task_state: null })
        .eq("id", version)
    ).error?.code,
  ).toBe("42501");
  const anon = createClient(env("SUPABASE_URL"), env("SUPABASE_ANON_KEY"));
  expect(
    (
      await anon
        .from("versions")
        .update({ kie_task_state: null })
        .eq("id", version)
    ).error?.code,
  ).toBe("42501");
  expect(
    (
      await service
        .from("versions")
        .update({ kie_task_state: "timeout" })
        .eq("id", version)
    ).error?.code,
  ).toBe("23514");
});
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

it.each(["generate_again", "back_to_lyrics"] as const)(
  "%s refuses a possibly live task without changing state or enqueueing work",
  async (rpc) => {
    const v = await fixture("failed");
    await service.from("jobs").update({ status: "failed" }).eq("version_id", v);
    expect(
      (
        await service
          .from("versions")
          .update({ kie_task_id: "pending-task", kie_task_state: null })
          .eq("id", v)
      ).error,
    ).toBeNull();
    const params =
      rpc === "generate_again"
        ? { p_version: v, p_generation: 1 }
        : { p_version: v };
    const before = await service.from("versions").select().eq("id", v).single();
    const jobsBefore = await service
      .from("jobs")
      .select("id")
      .eq("version_id", v);
    expect((await client.rpc(rpc, params)).error?.message).toBe(
      "kie task may still succeed: use Retry, it is free",
    );
    expect(
      (await service.from("versions").select().eq("id", v).single()).data,
    ).toEqual(before.data);
    expect(
      (await service.from("jobs").select("id").eq("version_id", v)).data,
    ).toEqual(jobsBefore.data);
    expect((await service.rpc(rpc, params)).error?.code).toBe("42501");
  },
);
it.each([
  ["generate_again", "failed"],
  ["generate_again", "missing"],
  ["back_to_lyrics", "failed"],
  ["back_to_lyrics", "missing"],
] as const)("%s allows recovery when task is %s", async (rpc, task) => {
  const v = await fixture("failed");
  await service.from("jobs").update({ status: "failed" }).eq("version_id", v);
  expect(
    (
      await service
        .from("versions")
        .update({
          kie_task_id: task === "failed" ? "failed-task" : null,
          kie_task_state: task === "failed" ? "failed" : null,
        })
        .eq("id", v)
    ).error,
  ).toBeNull();
  const params =
    rpc === "generate_again"
      ? { p_version: v, p_generation: 1 }
      : { p_version: v };
  expect((await client.rpc(rpc, params)).error).toBeNull();
  expect(
    (
      await service
        .from("versions")
        .select("status,generation_count")
        .eq("id", v)
        .single()
    ).data,
  ).toEqual({
    status: rpc === "generate_again" ? "song_queued" : "lyrics_review",
    generation_count: 2,
  });
});
it("back_to_lyrics requires an owned failed version and preserves unknown submission protection", async () => {
  const v = await fixture("failed");
  await service.from("jobs").update({ status: "failed" }).eq("version_id", v);
  expect(
    (await other.rpc("back_to_lyrics", { p_version: v })).error,
  ).not.toBeNull();
  await service
    .from("versions")
    .update({ kie_submit_state: "submitting" })
    .eq("id", v);
  expect(
    (await client.rpc("back_to_lyrics", { p_version: v })).error,
  ).not.toBeNull();
  await service.from("versions").update({ kie_submit_state: null }).eq("id", v);
  expect(
    (await client.rpc("back_to_lyrics", { p_version: v })).error,
  ).toBeNull();
  expect(
    (await service.from("versions").select("status").eq("id", v).single()).data
      ?.status,
  ).toBe("lyrics_review");
  expect(
    (await client.rpc("back_to_lyrics", { p_version: v })).error,
  ).not.toBeNull();
});

it("clients cannot delete or update projects even as their owner", async () => {
  const v = await fixture("failed");
  const row = await service
    .from("versions")
    .select("project_id")
    .eq("id", v)
    .single();
  const id = row.data?.project_id;
  expect(
    (await client.from("projects").delete().eq("id", id)).error,
  ).not.toBeNull();
  expect(
    (await client.from("projects").update({ topic: "changed" }).eq("id", id))
      .error,
  ).not.toBeNull();
  expect(
    (await service.from("projects").select("id").eq("id", id).single()).data
      ?.id,
  ).toBe(id);
});

it("generate_again from failed advances once and queues one explicit generation", async () => {
  const v = await fixture("failed");
  await service.from("jobs").update({ status: "failed" }).eq("version_id", v);
  expect(
    (await other.rpc("generate_again", { p_version: v, p_generation: 1 }))
      .error,
  ).not.toBeNull();
  expect(
    (await client.rpc("generate_again", { p_version: v, p_generation: 1 }))
      .error,
  ).toBeNull();
  expect(
    (await client.rpc("generate_again", { p_version: v, p_generation: 1 }))
      .error,
  ).not.toBeNull();
  expect(
    (
      await service
        .from("versions")
        .select("status,generation_count")
        .eq("id", v)
        .single()
    ).data,
  ).toEqual({ status: "song_queued", generation_count: 2 });
  const jobs = await service
    .from("jobs")
    .select("id")
    .eq("version_id", v)
    .eq("stage", "generate_song");
  expect(jobs.data).toHaveLength(1);
});

async function uploadFixture() {
  const version = await fixture("failed");
  await service
    .from("jobs")
    .update({ status: "failed" })
    .eq("version_id", version);
  const r = await service
    .from("renders")
    .insert({ owner_id: owner, version_id: version, kind: "master" })
    .select("id")
    .single();
  expect(r.error).toBeNull();
  const worker = `${prefix}-${version}`;
  expect(
    (await service.from("workers").insert({ id: worker, owner_id: owner }))
      .error,
  ).toBeNull();
  const reserved = await service.rpc("reserve_publication_upload", {
    p_render: r.data?.id,
    p_worker: worker,
  });
  expect(reserved.error).toBeNull();
  return {
    version,
    worker,
    publication: reserved.data.publication.id as string,
  };
}

it("release_youtube_upload is service-only and releases exactly its reservation", async () => {
  const { worker, publication } = await uploadFixture();
  const params = {
    p_publication: publication,
    p_worker: worker,
    p_error: "redacted upload error",
  };
  expect(
    (await client.rpc("release_youtube_upload", params)).error,
  ).toMatchObject({ code: "42501" });
  const anon = createClient(env("SUPABASE_URL"), env("SUPABASE_ANON_KEY"), {
    auth: { persistSession: false },
  });
  expect(
    (await anon.rpc("release_youtube_upload", params)).error,
  ).toMatchObject({ code: "42501" });
  expect(
    (
      await service.rpc("release_youtube_upload", {
        ...params,
        p_worker: "other-worker",
      })
    ).error,
  ).not.toBeNull();
  expect(
    (await service.rpc("release_youtube_upload", params)).error,
  ).toBeNull();
  expect(
    (
      await service
        .from("publications")
        .select("upload_state")
        .eq("id", publication)
        .single()
    ).data?.upload_state,
  ).toBe("pending");
  expect(
    (
      await service
        .from("workers")
        .select("youtube_uploads_today")
        .eq("id", worker)
        .single()
    ).data?.youtube_uploads_today,
  ).toBe(0);
  expect(
    (await service.rpc("release_youtube_upload", params)).error,
  ).not.toBeNull();
});

it("keeps worker RPCs inaccessible to both client roles and client recovery RPCs inaccessible to anon", async () => {
  const anon = createClient(env("SUPABASE_URL"), env("SUPABASE_ANON_KEY"), {
    auth: { persistSession: false },
  });
  const id = "00000000-0000-4000-8000-000000000001";
  for (const c of [anon, client]) {
    expect(
      (
        await c.rpc("reserve_publication_upload", {
          p_render: id,
          p_worker: "test",
        })
      ).error,
    ).toMatchObject({ code: "42501" });
    expect(
      (await c.rpc("reserve_youtube_upload", { p_worker: "test" })).error,
    ).toMatchObject({ code: "42501" });
  }
  for (const [name, params] of [
    ["back_to_lyrics", { p_version: id }],
    [
      "resolve_kie_submission",
      { p_version: id, p_charged: false, p_task_id: null },
    ],
    ["resolve_kie_submission", { p_version: id, p_outcome: "not_submitted" }],
    [
      "resolve_upload",
      { p_publication: id, p_uploaded: false, p_video_id: null },
    ],
    ["generate_again", { p_version: id, p_generation: 1 }],
  ] as const) {
    expect((await anon.rpc(name, params)).error).toMatchObject({
      code: "42501",
    });
  }
});

it.each([false, true])(
  "resolve_upload owned admin outcome uploaded=%s",
  async (uploaded) => {
    const { worker, publication, version } = await uploadFixture();
    const params = {
      p_publication: publication,
      p_uploaded: uploaded,
      p_video_id: uploaded ? "abc123" : null,
    };
    expect((await other.rpc("resolve_upload", params)).error).not.toBeNull();
    await service.from("profiles").update({ role: "customer" }).eq("id", owner);
    try {
      expect((await client.rpc("resolve_upload", params)).error).not.toBeNull();
    } finally {
      await service.from("profiles").update({ role: "admin" }).eq("id", owner);
    }
    expect(
      (
        await client.rpc("resolve_upload", {
          ...params,
          p_uploaded: true,
          p_video_id: "",
        })
      ).error,
    ).not.toBeNull();
    await service.from("jobs").insert({
      owner_id: owner,
      version_id: version,
      stage: "publish",
      idempotency_key: `active:${version}`,
    });
    expect((await client.rpc("resolve_upload", params)).error).not.toBeNull();
    await service
      .from("jobs")
      .update({ status: "failed" })
      .eq("version_id", version);
    expect((await client.rpc("resolve_upload", params)).error).toBeNull();
    expect(
      (
        await service
          .from("publications")
          .select("upload_state,youtube_video_id")
          .eq("id", publication)
          .single()
      ).data,
    ).toEqual({
      upload_state: uploaded ? "uploaded" : "pending",
      youtube_video_id: uploaded ? "abc123" : null,
    });
    expect(
      (
        await service
          .from("workers")
          .select("youtube_uploads_today")
          .eq("id", worker)
          .single()
      ).data?.youtube_uploads_today,
    ).toBe(uploaded ? 1 : 0);
  },
);
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
it("keeps only the audio of the chosen take and makes the video later on request", async () => {
  const v = await fixture("takes_review");
  const take = await service
    .from("takes")
    .insert({ owner_id: owner, version_id: v, generation: 1 })
    .select()
    .single();
  expect(
    (await client.rpc("make_video", { p_version: v })).error,
  ).not.toBeNull();
  expect(
    (await other.rpc("keep_audio", { p_version: v, p_take: take.data.id }))
      .error,
  ).not.toBeNull();
  expect(
    (await client.rpc("keep_audio", { p_version: v, p_take: take.data.id }))
      .error,
  ).toBeNull();
  expect(
    (await service.from("versions").select().eq("id", v).single()).data,
  ).toMatchObject({ status: "audio_ready", chosen_take_id: take.data.id });
  expect(
    (
      await service
        .from("jobs")
        .select()
        .eq("version_id", v)
        .eq("stage", "timing")
    ).data,
  ).toHaveLength(0);
  expect(
    (await other.rpc("make_video", { p_version: v })).error,
  ).not.toBeNull();
  expect((await client.rpc("make_video", { p_version: v })).error).toBeNull();
  expect(
    (await client.rpc("make_video", { p_version: v })).error,
  ).not.toBeNull();
  expect(
    (await service.from("versions").select().eq("id", v).single()).data,
  ).toMatchObject({ status: "producing" });
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
it("lets only the admin choose a local song engine and rejects unknown engines", async () => {
  const song = (engine?: string) => ({
    p_prompt: "Una canzone sul caffè",
    p_lyrics: "",
    p_languages: ["it"],
    p_style: "",
    p_vocal_gender: null,
    p_settings: engine ? { model: "V6", engine } : { model: "V6" },
  });
  expect((await client.rpc("create_song", song("yue2"))).error).toBeNull();
  expect((await client.rpc("create_song", song("kie"))).error).toBeNull();
  expect((await client.rpc("create_song", song())).error).toBeNull();
  expect(
    (await client.rpc("create_song", song("udio"))).error?.message,
  ).toContain("invalid engine");
  const otherId = users[1];
  await service.from("profiles").update({ role: "customer" }).eq("id", otherId);
  try {
    expect(
      (await other.rpc("create_song", song("ace-step"))).error?.message,
    ).toContain("admin only");
    expect((await other.rpc("create_song", song("kie"))).error).toBeNull();
  } finally {
    await service.from("profiles").update({ role: "admin" }).eq("id", otherId);
  }
});
it("records failed-QA override and approver, uses current attempt and rerenders atomically", async () => {
  const v = await fixture("video_review");
  // Reaching video review means the preceding pipeline jobs have finished.
  expect(
    (await service.from("jobs").update({ status: "done" }).eq("version_id", v))
      .error,
  ).toBeNull();
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
