import { randomUUID } from "node:crypto";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

// Visualizer videos (migration 20261101000022): request_visualizer, the renders it keeps per
// aspect, the queue line, the stage check and the uploads bucket with its policies.
//
// The render PC worker may be running against this database, so every job made here is parked
// (not_before in a day) right after the assertions that need it queued.
let service: SupabaseClient;
let client: SupabaseClient;
let other: SupabaseClient;
let anon: SupabaseClient;
let owner: string;
let stranger: string;
const users: string[] = [];
const prefix = `visualizer-${Date.now()}`;
const uploads: string[] = [];
function env(k: string) {
  const v = process.env[k];
  if (!v) throw new Error(`${k} required`);
  return v;
}

const params = (over: Record<string, unknown> = {}) => ({
  preset: "circle",
  aspect: "16:9",
  background: { mode: "random", seed: 3, assetUrl: null, dimming: 60 },
  colors: { primary: "#f2333d", secondary: "#2ee6d6" },
  particles: 30,
  centerImage: { mode: "cover", assetUrl: null },
  textLayers: [],
  effects: [],
  classico: { artist: "", website: "", album: "", cards: true },
  logos: [],
  ...over,
});

beforeAll(async () => {
  service = createClient(env("SUPABASE_URL"), env("SUPABASE_SERVICE_ROLE_KEY"));
  anon = createClient(env("SUPABASE_URL"), env("SUPABASE_ANON_KEY"), {
    auth: { persistSession: false },
  });
  for (const suffix of ["a", "b"]) {
    const email = `${prefix}-${suffix}@example.test`;
    await service.from("admin_allowlist").insert({ email });
    const result = await service.auth.admin.createUser({
      email,
      password: "visualizer-test-password",
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
          password: "visualizer-test-password",
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
  if (uploads.length) await service.storage.from("uploads").remove(uploads);
  for (const id of users) await service.auth.admin.deleteUser(id);
  await service.from("admin_allowlist").delete().like("email", `${prefix}%`);
});

async function song(
  status = "audio_ready",
  { who = owner, chosen = true } = {},
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
      lyric_pack: { title: "T" },
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
      audio_preview_path: `previews/${who}/${id}/take-1.mp3`,
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
async function park(id: string) {
  await service
    .from("jobs")
    .update({ not_before: new Date(Date.now() + 86_400_000).toISOString() })
    .eq("id", id)
    .eq("status", "queued");
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
async function upload(
  who: SupabaseClient,
  folder: string,
  ext: string,
  type: string,
  bytes = 1024,
) {
  const path = `${folder}/${randomUUID()}.${ext}`;
  const result = await who.storage
    .from("uploads")
    .upload(path, new Blob([new Uint8Array(bytes)], { type }), {
      contentType: type,
    });
  if (!result.error) uploads.push(path);
  return { path, error: result.error };
}

describe("request_visualizer", () => {
  it("stores the parameters on one render per aspect and queues the visualizer stage", async () => {
    const s = await song();
    const first = await client.rpc("request_visualizer", {
      p_version: s.id,
      p_params: params(),
    });
    expect(first.error).toBeNull();
    const jobId = first.data as string;
    await park(jobId);
    expect(await job(jobId)).toMatchObject({
      stage: "visualizer",
      owner_id: owner,
      version_id: s.id,
      idempotency_key: `visualizer:${s.id}:16:9`,
      payload: { take_id: s.take },
    });
    const renders = await service
      .from("renders")
      .select("id,kind,aspect,visualizer_params")
      .eq("version_id", s.id);
    expect(renders.data).toHaveLength(1);
    expect(renders.data?.[0]).toMatchObject({
      kind: "visualizer",
      aspect: "16:9",
      visualizer_params: { preset: "circle" },
    });
    expect((await job(jobId)).payload.render_id).toBe(renders.data?.[0]?.id);

    // Asking again while it waits keeps the job and its place, with the new look.
    const again = await client.rpc("request_visualizer", {
      p_version: s.id,
      p_params: params({ preset: "mirror" }),
    });
    expect(again.data).toBe(jobId);
    const after = await service
      .from("renders")
      .select("visualizer_params")
      .eq("version_id", s.id)
      .eq("aspect", "16:9")
      .single();
    expect(after.data?.visualizer_params.preset).toBe("mirror");

    // The other aspect is a second render and a second job.
    const tall = await client.rpc("request_visualizer", {
      p_version: s.id,
      p_params: params({ aspect: "9:16" }),
    });
    expect(tall.error).toBeNull();
    expect(tall.data).not.toBe(jobId);
    await park(tall.data as string);
    const { count } = await service
      .from("renders")
      .select("id", { count: "exact", head: true })
      .eq("version_id", s.id);
    expect(count).toBe(2);
    // The song itself is untouched.
    const v = await service
      .from("versions")
      .select("status")
      .eq("id", s.id)
      .single();
    expect(v.data?.status).toBe("audio_ready");
  });

  it("queues a finished or failed render again, and refuses one that is rendering", async () => {
    const s = await song("published");
    const first = await client.rpc("request_visualizer", {
      p_version: s.id,
      p_params: params(),
    });
    const jobId = first.data as string;
    await service
      .from("jobs")
      .update({ status: "failed", error: "boom" })
      .eq("id", jobId);
    const retry = await client.rpc("request_visualizer", {
      p_version: s.id,
      p_params: params(),
    });
    expect(retry.data).toBe(jobId);
    expect(await job(jobId)).toMatchObject({
      status: "queued",
      error: null,
      attempts: 0,
    });
    await service
      .from("jobs")
      .update({ status: "running", worker_id: "test", not_before: null })
      .eq("id", jobId);
    const busy = await client.rpc("request_visualizer", {
      p_version: s.id,
      p_params: params(),
    });
    expect(busy.error?.message).toContain("visualizer already rendering");
    await service.from("jobs").update({ status: "done" }).eq("id", jobId);
    const redo = await client.rpc("request_visualizer", {
      p_version: s.id,
      p_params: params(),
    });
    expect(redo.data).toBe(jobId);
    await park(jobId);
  });

  it("needs a chosen take with audio, a valid aspect and the caller's own song", async () => {
    for (const status of ["lyrics_review", "takes_review", "failed"]) {
      const s = await song(status);
      const r = await client.rpc("request_visualizer", {
        p_version: s.id,
        p_params: params(),
      });
      expect(r.error?.message, status).toContain("chosen take required");
    }
    const none = await song("audio_ready", { chosen: false });
    expect(
      (
        await client.rpc("request_visualizer", {
          p_version: none.id,
          p_params: params(),
        })
      ).error?.message,
    ).toContain("chosen take required");
    const s = await song();
    for (const bad of [params({ aspect: "4:3" }), { aspect: "16:9" }, null]) {
      const r = await client.rpc("request_visualizer", {
        p_version: s.id,
        p_params: bad,
      });
      expect(r.error?.message).toContain("invalid visualizer params");
    }
    const foreign = await other.rpc("request_visualizer", {
      p_version: s.id,
      p_params: params(),
    });
    expect(foreign.error?.message).toContain("owned version required");
    const nobody = await anon.rpc("request_visualizer", {
      p_version: s.id,
      p_params: params(),
    });
    expect(nobody.error).not.toBeNull();
  });

  it("accepts only the caller's own uploads within their limits", async () => {
    const s = await song();
    const image = await upload(client, owner, "jpg", "image/jpeg");
    expect(image.error).toBeNull();
    const ok = await client.rpc("request_visualizer", {
      p_version: s.id,
      p_params: params({
        background: {
          mode: "image",
          seed: 0,
          assetUrl: `/media/uploads/${image.path}`,
          dimming: 40,
        },
        centerImage: {
          mode: "upload",
          assetUrl: `/media/uploads/${image.path}`,
        },
      }),
    });
    expect(ok.error).toBeNull();
    await park(ok.data as string);
    // A picture is not a video background.
    const wrongKind = await client.rpc("request_visualizer", {
      p_version: s.id,
      p_params: params({
        background: {
          mode: "video",
          seed: 0,
          assetUrl: `/media/uploads/${image.path}`,
          dimming: 40,
        },
      }),
    });
    expect(wrongKind.error?.message).toContain("invalid visualizer asset");
    // Someone else's file, a missing file, and a path outside the caller's folder.
    const theirs = await upload(other, stranger, "png", "image/png");
    expect(theirs.error).toBeNull();
    for (const url of [
      `/media/uploads/${theirs.path}`,
      `/media/uploads/${owner}/${randomUUID()}.jpg`,
      `/media/uploads/stock/visualizer/bg-01.jpg`,
      `/media/previews/${owner}/x.jpg`,
    ]) {
      const r = await client.rpc("request_visualizer", {
        p_version: s.id,
        p_params: params({ centerImage: { mode: "upload", assetUrl: url } }),
      });
      expect(r.error?.message, url).toContain("invalid visualizer asset");
    }
    // A picture over 10 MB is refused even though the bucket takes it.
    const big = await upload(
      client,
      owner,
      "png",
      "image/png",
      10 * 1024 * 1024 + 10,
    );
    expect(big.error).toBeNull();
    const tooBig = await client.rpc("request_visualizer", {
      p_version: s.id,
      p_params: params({
        centerImage: { mode: "upload", assetUrl: `/media/uploads/${big.path}` },
      }),
    });
    expect(tooBig.error?.message).toContain("invalid visualizer asset");
    const video = await upload(client, owner, "mp4", "video/mp4");
    const withVideo = await client.rpc("request_visualizer", {
      p_version: s.id,
      p_params: params({
        background: {
          mode: "video",
          seed: 0,
          assetUrl: `/media/uploads/${video.path}`,
          dimming: 50,
        },
      }),
    });
    expect(withVideo.error).toBeNull();
    await park(withVideo.data as string);
  });

  it("checks the logos like the centre picture: own pictures only, two at most", async () => {
    const s = await song();
    const image = await upload(client, owner, "png", "image/png");
    expect(image.error).toBeNull();
    const logo = (assetUrl: string) => ({
      assetUrl,
      position: "top-right",
      size: 12,
      opacity: 100,
    });
    const mine = `/media/uploads/${image.path}`;
    const ok = await client.rpc("request_visualizer", {
      p_version: s.id,
      p_params: params({ logos: [logo(mine), logo(mine)] }),
    });
    expect(ok.error).toBeNull();
    await park(ok.data as string);
    const theirs = await upload(other, stranger, "png", "image/png");
    expect(theirs.error).toBeNull();
    const video = await upload(client, owner, "mp4", "video/mp4");
    for (const url of [
      `/media/uploads/${theirs.path}`,
      `/media/uploads/${owner}/${randomUUID()}.png`,
      `/media/uploads/${video.path}`,
      `/media/uploads/stock/visualizer/bg-01.jpg`,
    ]) {
      const r = await client.rpc("request_visualizer", {
        p_version: s.id,
        p_params: params({ logos: [logo(url)] }),
      });
      expect(r.error?.message, url).toContain("invalid visualizer asset");
    }
    const missing = await client.rpc("request_visualizer", {
      p_version: s.id,
      p_params: params({ logos: [{ position: "top-left" }] }),
    });
    expect(missing.error?.message).toContain("invalid visualizer asset");
    const three = await client.rpc("request_visualizer", {
      p_version: s.id,
      p_params: params({ logos: [logo(mine), logo(mine), logo(mine)] }),
    });
    expect(three.error?.message).toContain("invalid visualizer params");
  });
});

describe("visualizer queue and stage", () => {
  it("reports the queue position per aspect and keeps it off the song's own badge", async () => {
    const s = await song();
    const r = await client.rpc("request_visualizer", {
      p_version: s.id,
      p_params: params({ aspect: "9:16" }),
    });
    expect(r.error).toBeNull();
    const queue = await client.rpc("my_visualizer_queue");
    expect(queue.error).toBeNull();
    const mine = (
      queue.data as {
        version_id: string;
        aspect: string;
        queue_position: number;
      }[]
    ).find((row) => row.version_id === s.id);
    expect(mine?.aspect).toBe("9:16");
    expect(mine?.queue_position).toBeGreaterThanOrEqual(1);
    const positions = await client.rpc("my_queue_positions");
    expect(
      (positions.data as { version_id: string }[]).some(
        (row) => row.version_id === s.id,
      ),
    ).toBe(false);
    await park(r.data as string);
    // Another user sees nothing of it.
    const theirs = await other.rpc("my_visualizer_queue");
    expect(
      (theirs.data as { version_id: string }[]).some(
        (row) => row.version_id === s.id,
      ),
    ).toBe(false);
  });

  it("allows the visualizer stage and the visualizer render kind only in their shape", async () => {
    const s = await song();
    const bad = await service.from("renders").insert({
      owner_id: owner,
      version_id: s.id,
      kind: "visualizer",
      aspect: null,
      visualizer_params: params(),
    });
    expect(bad.error).not.toBeNull();
    const master = await service.from("renders").insert({
      owner_id: owner,
      version_id: s.id,
      kind: "master",
      aspect: "16:9",
    });
    expect(master.error).not.toBeNull();
    // The web cannot write renders or jobs itself.
    const direct = await client.from("renders").insert({
      owner_id: owner,
      version_id: s.id,
      kind: "visualizer",
      aspect: "16:9",
      visualizer_params: params(),
    });
    expect(direct.error).not.toBeNull();
  });
});

describe("uploads bucket", () => {
  it("keeps each owner's files to themselves and lets everyone read the stock folder", async () => {
    const mine = await upload(client, owner, "png", "image/png");
    expect(mine.error).toBeNull();
    expect(
      (await upload(client, stranger, "png", "image/png")).error,
    ).not.toBeNull();
    expect(
      (await upload(client, "stock/visualizer", "jpg", "image/jpeg")).error,
    ).not.toBeNull();
    expect(
      (await upload(anon, owner, "png", "image/png")).error,
    ).not.toBeNull();
    // Only pictures and videos.
    expect(
      (await upload(client, owner, "mp4", "text/plain")).error,
    ).not.toBeNull();
    const read = await other.storage.from("uploads").download(mine.path);
    expect(read.error).not.toBeNull();
    const own = await client.storage.from("uploads").download(mine.path);
    expect(own.error).toBeNull();
    const stock = `stock/visualizer/test-${randomUUID()}.jpg`;
    const put = await service.storage
      .from("uploads")
      .upload(stock, new Blob([new Uint8Array(16)], { type: "image/jpeg" }), {
        contentType: "image/jpeg",
      });
    expect(put.error).toBeNull();
    uploads.push(stock);
    expect(
      (await other.storage.from("uploads").download(stock)).error,
    ).toBeNull();
    expect(
      (await anon.storage.from("uploads").download(stock)).error,
    ).not.toBeNull();
    // Owners can remove their own uploads only.
    const removeTheirs = await other.storage
      .from("uploads")
      .remove([mine.path]);
    expect(removeTheirs.data ?? []).toHaveLength(0);
    const removeOwn = await client.storage.from("uploads").remove([mine.path]);
    expect(removeOwn.data).toHaveLength(1);
  });
});
