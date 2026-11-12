import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { opsRpc } from "./helpers/ops-call";

// Stems and the audio editor (migration 20261101000020): request_stems, the stage check, stems on
// takes, edited takes and their storage policies.
//
// The render PC worker may be running against this database and can claim a queued stems job at
// any moment, so every job made here is parked (not_before in a day) right after the assertions
// that need it queued, and the checks accept a job the worker already took.
let service: SupabaseClient;
let client: SupabaseClient;
let other: SupabaseClient;
let anon: SupabaseClient;
let owner: string;
let stranger: string;
const users: string[] = [];
const prefix = `stems-${Date.now()}`;
const uploaded: string[] = [];
function env(k: string) {
  const v = process.env[k];
  if (!v) throw new Error(`${k} required`);
  return v;
}
beforeAll(async () => {
  service = createClient(env("SUPABASE_URL"), env("SUPABASE_SERVICE_ROLE_KEY"));
  anon = createClient(env("SUPABASE_URL"), env("SUPABASE_ANON_KEY"), {
    auth: { persistSession: false },
  });
  for (const suffix of ["a", "b"]) {
    const email = `${prefix}-${suffix}@example.test`;
    await service.from("admin_allowlist").insert({ email, role: "admin" });
    const result = await service.auth.admin.createUser({
      email,
      password: "stems-test-password",
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
          password: "stems-test-password",
        })
      ).error,
    ).toBeNull();
    if (suffix === "a") {
      client = c;
      owner = id;
    } else {
      other = c;
      stranger = id;
    }
  }
  // The stranger is a customer, so the admin-reads-every-preview policy does not apply to them.
  expect(
    (
      await service
        .from("profiles")
        .update({ role: "customer" })
        .eq("id", stranger)
    ).error,
  ).toBeNull();
});
afterAll(async () => {
  if (!service) return;
  if (uploaded.length) await service.storage.from("previews").remove(uploaded);
  for (const id of users) await service.auth.admin.deleteUser(id);
  await service.from("admin_allowlist").delete().like("email", `${prefix}%`);
});

// A song in `status` with a chosen take that has audio (unless `audio` is false).
async function song(
  status = "audio_ready",
  { who = owner, audio = true, chosen = true } = {},
) {
  const project = await service
    .from("projects")
    .insert({ owner_id: who, topic: `${prefix} topic` })
    .select("id")
    .single();
  expect(project.error).toBeNull();
  const version = await service
    .from("versions")
    .insert({
      owner_id: who,
      project_id: project.data?.id,
      lang: "en",
      lyric_pack: { title: "T", lyrics: "x" },
    })
    .select("id")
    .single();
  expect(version.error).toBeNull();
  const id = version.data?.id as string;
  const take = await service
    .from("takes")
    .insert({
      owner_id: who,
      version_id: id,
      generation: 1,
      take_number: 1,
      engine: "ace-step",
      cover_path: "previews/cover.jpg",
      audio_preview_path: audio ? `previews/${who}/${id}/take-1.mp3` : null,
    })
    .select("id")
    .single();
  expect(take.error).toBeNull();
  const update = await service
    .from("versions")
    .update({ status, chosen_take_id: chosen ? take.data?.id : null })
    .eq("id", id);
  expect(update.error).toBeNull();
  return { id, take: take.data?.id as string };
}
async function job(id: string) {
  const { data, error } = await service
    .from("jobs")
    .select()
    .eq("id", id)
    .single();
  expect(error).toBeNull();
  return data;
}
async function park(id: string) {
  await service
    .from("jobs")
    .update({ not_before: new Date(Date.now() + 86_400_000).toISOString() })
    .eq("id", id)
    .eq("status", "queued");
}
async function version(id: string) {
  const { data, error } = await service
    .from("versions")
    .select()
    .eq("id", id)
    .single();
  expect(error).toBeNull();
  return data;
}

describe("request_stems", () => {
  it("queues one stems job for the chosen take and returns it again on a repeat", async () => {
    const s = await song();
    const first = await opsRpc(client, "request_stems", { p_version: s.id });
    expect(first.error).toBeNull();
    const jobId = first.data as string;
    const second = await opsRpc(client, "request_stems", { p_version: s.id });
    expect(second.error).toBeNull();
    expect(second.data).toBe(jobId);
    await park(jobId);
    expect(await job(jobId)).toMatchObject({
      stage: "stems",
      owner_id: owner,
      version_id: s.id,
      idempotency_key: `stems:${s.id}:${s.take}`,
      payload: { take_id: s.take },
    });
    const { count } = await service
      .from("jobs")
      .select("id", { count: "exact", head: true })
      .eq("version_id", s.id);
    expect(count).toBe(1);
    // The request never touches the song.
    expect(await version(s.id)).toMatchObject({ status: "audio_ready" });
  });

  it("is allowed in every status that has a chosen take, and only there", async () => {
    for (const status of [
      "producing",
      "video_review",
      "approved",
      "publishing",
      "published",
    ]) {
      const s = await song(status);
      const r = await opsRpc(client, "request_stems", { p_version: s.id });
      expect(r.error, status).toBeNull();
      await park(r.data as string);
      expect((await version(s.id)).status).toBe(status);
    }
    for (const status of [
      "lyrics_review",
      "song_queued",
      "takes_review",
      "failed",
    ]) {
      const s = await song(status);
      const r = await opsRpc(client, "request_stems", { p_version: s.id });
      expect(r.error?.message, status).toContain("chosen take required");
    }
  });

  it("refuses a song without a chosen take, without audio, foreign, trashed or anonymous", async () => {
    const none = await song("audio_ready", { chosen: false });
    expect(
      (await opsRpc(client, "request_stems", { p_version: none.id })).error
        ?.message,
    ).toContain("chosen take required");
    const silent = await song("audio_ready", { audio: false });
    expect(
      (await opsRpc(client, "request_stems", { p_version: silent.id })).error
        ?.message,
    ).toContain("chosen take audio required");
    const mine = await song();
    expect(
      (await opsRpc(other, "request_stems", { p_version: mine.id })).error
        ?.message,
    ).toContain("owned version required");
    expect(
      (await anon.rpc("request_stems", { p_version: mine.id })).error,
    ).not.toBeNull();
    await service
      .from("versions")
      .update({ trashed_at: new Date().toISOString() })
      .eq("id", mine.id);
    expect(
      (await opsRpc(client, "request_stems", { p_version: mine.id })).error
        ?.message,
    ).toContain("owned version required");
    const { count } = await service
      .from("jobs")
      .select("id", { count: "exact", head: true })
      .in("version_id", [none.id, silent.id, mine.id]);
    expect(count).toBe(0);
  });

  it("queues a failed job again but leaves a finished one alone", async () => {
    const s = await song();
    const jobId = (await opsRpc(client, "request_stems", { p_version: s.id }))
      .data as string;
    await service
      .from("jobs")
      .update({
        status: "failed",
        error: "demucs exited 1",
        attempts: 2,
        worker_id: "w",
        finished_at: new Date().toISOString(),
      })
      .eq("id", jobId);
    const retry = await opsRpc(client, "request_stems", { p_version: s.id });
    expect(retry.error).toBeNull();
    expect(retry.data).toBe(jobId);
    await park(jobId);
    const queued = await job(jobId);
    expect(queued.error).toBeNull();
    // Queued again, or already claimed by the live render PC.
    expect(["queued", "running"]).toContain(queued.status);
    if (queued.status === "queued")
      expect(queued).toMatchObject({ attempts: 0, worker_id: null });

    await service
      .from("jobs")
      .update({ status: "done", error: null })
      .eq("id", jobId);
    expect(
      (await opsRpc(client, "request_stems", { p_version: s.id })).data,
    ).toBe(jobId);
    expect((await job(jobId)).status).toBe("done");
  });

  it("asks again for a new chosen take", async () => {
    const s = await song();
    const a = (await opsRpc(client, "request_stems", { p_version: s.id }))
      .data as string;
    await park(a);
    const take = await service
      .from("takes")
      .insert({
        owner_id: owner,
        version_id: s.id,
        generation: 2,
        take_number: 1,
        engine: "edit",
        audio_preview_path: `edits/${owner}/${s.id}/x.mp3`,
      })
      .select("id")
      .single();
    await service
      .from("versions")
      .update({ chosen_take_id: take.data?.id, generation_count: 2 })
      .eq("id", s.id);
    const b = (await opsRpc(client, "request_stems", { p_version: s.id }))
      .data as string;
    await park(b);
    expect(b).not.toBe(a);
    expect((await job(b)).payload).toEqual({ take_id: take.data?.id });
  });
});

describe("stage check and direct writes", () => {
  it("accepts the stems stage in jobs and nothing unknown", async () => {
    const s = await song();
    const ok = await service
      .from("jobs")
      .insert({
        owner_id: owner,
        version_id: s.id,
        stage: "stems",
        idempotency_key: `${prefix}-direct`,
        not_before: new Date(Date.now() + 86_400_000).toISOString(),
      })
      .select("id")
      .single();
    expect(ok.error).toBeNull();
    const bad = await service.from("jobs").insert({
      owner_id: owner,
      version_id: s.id,
      stage: "separate",
      idempotency_key: `${prefix}-bad`,
    });
    expect(bad.error?.message).toContain("jobs_stage_check");
  });

  it("does not let an owner insert a stems job directly", async () => {
    const s = await song();
    const direct = await client.from("jobs").insert({
      owner_id: owner,
      version_id: s.id,
      stage: "stems",
      idempotency_key: `${prefix}-owner-direct`,
    });
    expect(direct.error).not.toBeNull();
  });

  it("accepts the edit engine on takes and nothing unknown", async () => {
    const s = await song();
    const ok = await service.from("takes").insert({
      owner_id: owner,
      version_id: s.id,
      generation: 5,
      take_number: 1,
      engine: "edit",
    });
    expect(ok.error).toBeNull();
    const bad = await service.from("takes").insert({
      owner_id: owner,
      version_id: s.id,
      generation: 6,
      take_number: 1,
      engine: "audacity",
    });
    expect(bad.error?.message).toContain("takes_engine_check");
  });
});

describe("stems on takes (RLS)", () => {
  it("shows the stems to the owner only and lets nobody but the worker write them", async () => {
    const s = await song();
    const stems = {
      model: "htdemucs",
      format: "mp3",
      tracks: { vocals: { path: "previews/v.mp3", peaks: [0.5] } },
    };
    expect(
      (await service.from("takes").update({ stems }).eq("id", s.take)).error,
    ).toBeNull();
    const mine = await client
      .from("takes")
      .select("stems")
      .eq("id", s.take)
      .single();
    expect(mine.data?.stems).toEqual(stems);
    const theirs = await other.from("takes").select("stems").eq("id", s.take);
    expect(theirs.data).toEqual([]);
    expect(
      (await anon.from("takes").select("stems").eq("id", s.take)).data ?? [],
    ).toEqual([]);
    await client
      .from("takes")
      .update({ stems: { tracks: {} } })
      .eq("id", s.take);
    expect(
      (await service.from("takes").select("stems").eq("id", s.take).single())
        .data?.stems,
    ).toEqual(stems);
    expect(
      (
        await service
          .from("takes")
          .update({ stems: [1] })
          .eq("id", s.take)
      ).error?.message,
    ).toContain("takes_stems_object");
  });
});

describe("my_stems_queue", () => {
  it("lists the caller's queued stems jobs and keeps them out of the song badge", async () => {
    const s = await song();
    const jobId = (await opsRpc(client, "request_stems", { p_version: s.id }))
      .data as string;
    const [stems, songs] = await Promise.all([
      client.rpc("my_stems_queue"),
      client.rpc("my_queue_positions"),
    ]);
    const state = (await job(jobId)).status;
    await park(jobId);
    expect(stems.error).toBeNull();
    expect(songs.error).toBeNull();
    const row = (
      stems.data as { version_id: string; queue_position: number }[]
    ).find((r) => r.version_id === s.id);
    // Unless the live render PC already took it.
    if (state === "queued") expect(row?.queue_position).toBeGreaterThan(0);
    expect(
      (songs.data as { version_id: string }[]).some(
        (r) => r.version_id === s.id,
      ),
    ).toBe(false);
    const foreign = await other.rpc("my_stems_queue");
    expect(
      (foreign.data as { version_id: string }[]).some(
        (r) => r.version_id === s.id,
      ),
    ).toBe(false);
  });
});

describe("save_edited_take", () => {
  async function upload(path: string, as = client, type = "audio/mpeg") {
    const r = await as.storage
      .from("previews")
      .upload(
        path,
        new Blob([new Uint8Array([0xff, 0xfb, 0x90, 0])], { type }),
        {
          contentType: type,
        },
      );
    if (!r.error) uploaded.push(path);
    return r;
  }
  const uuid = () => crypto.randomUUID();

  it("records the upload as a new chosen take of a new generation", async () => {
    const s = await song("video_review");
    const path = `edits/${owner}/${s.id}/${uuid()}.mp3`;
    expect((await upload(path)).error).toBeNull();
    const saved = await opsRpc(client, "save_edited_take", {
      p_version: s.id,
      p_path: path,
    });
    expect(saved.error).toBeNull();
    const takeId = saved.data as string;
    expect(await version(s.id)).toMatchObject({
      status: "video_review",
      generation_count: 2,
      chosen_take_id: takeId,
    });
    const take = await service.from("takes").select().eq("id", takeId).single();
    expect(take.data).toMatchObject({
      owner_id: owner,
      version_id: s.id,
      generation: 2,
      take_number: 1,
      engine: "edit",
      audio_preview_path: path,
      cover_path: "previews/cover.jpg",
      stems: null,
    });
    // The same file is not a second take.
    expect(
      (
        await opsRpc(client, "save_edited_take", {
          p_version: s.id,
          p_path: path,
        })
      ).error?.message,
    ).toContain("edit already saved");
    // A saved edit can no longer be deleted by the owner.
    await client.storage.from("previews").remove([path]);
    const still = await service.storage
      .from("previews")
      .list(`edits/${owner}/${s.id}`);
    expect(still.data?.map((f) => f.name)).toContain(path.split("/").at(-1));
  });

  it("refuses a missing upload, a wrong path, a foreign song and a busy song", async () => {
    const s = await song();
    for (const path of [
      `edits/${owner}/${s.id}/${uuid()}.mp3`,
      `edits/${owner}/${s.id}/not-a-uuid.mp3`,
      `edits/${stranger}/${s.id}/${uuid()}.mp3`,
      `previews/${owner}/${s.id}/${uuid()}.mp3`,
      `edits/${owner}/${s.id}/${uuid()}.wav`,
    ]) {
      const r = await opsRpc(client, "save_edited_take", {
        p_version: s.id,
        p_path: path,
      });
      expect(r.error, path).not.toBeNull();
    }
    const wrongType = `edits/${owner}/${s.id}/${uuid()}.mp3`;
    expect((await upload(wrongType, client, "text/plain")).error).toBeNull();
    expect(
      (
        await opsRpc(client, "save_edited_take", {
          p_version: s.id,
          p_path: wrongType,
        })
      ).error?.message,
    ).toContain("uploaded audio required");
    const path = `edits/${owner}/${s.id}/${uuid()}.mp3`;
    expect((await upload(path)).error).toBeNull();
    expect(
      (
        await opsRpc(other, "save_edited_take", {
          p_version: s.id,
          p_path: path,
        })
      ).error?.message,
    ).toContain("owned version required");
    for (const status of ["producing", "publishing", "takes_review"]) {
      await service.from("versions").update({ status }).eq("id", s.id);
      expect(
        (
          await opsRpc(client, "save_edited_take", {
            p_version: s.id,
            p_path: path,
          })
        ).error?.message,
        status,
      ).toContain("chosen take required");
    }
    expect((await version(s.id)).generation_count).toBe(1);
  });

  it("lets owners upload and delete unsaved edits only under their own prefix", async () => {
    const s = await song();
    expect(
      (await upload(`edits/${owner}/${s.id}/${uuid()}.mp3`, other)).error,
    ).not.toBeNull();
    expect(
      (await upload(`previews/${owner}/${s.id}/${uuid()}.mp3`)).error,
    ).not.toBeNull();
    const path = `edits/${owner}/${s.id}/${uuid()}.mp3`;
    expect((await upload(path)).error).toBeNull();
    // A stranger cannot read or remove it.
    expect(
      (await other.storage.from("previews").createSignedUrl(path, 60)).error,
    ).not.toBeNull();
    await other.storage.from("previews").remove([path]);
    expect(
      (await client.storage.from("previews").createSignedUrl(path, 60)).error,
    ).toBeNull();
    const removed = await client.storage.from("previews").remove([path]);
    expect(removed.error).toBeNull();
    expect(removed.data?.map((f) => f.name)).toEqual([path]);
  });
});
