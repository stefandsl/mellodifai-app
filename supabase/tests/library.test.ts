import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

// Library RPCs (migration 20261101000018): reactions, play count, rename, trash, queue position.
let service: SupabaseClient;
let client: SupabaseClient;
let other: SupabaseClient;
let anon: SupabaseClient;
let owner: string;
let stranger: string;
const users: string[] = [];
const prefix = `library-${Date.now()}`;
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
      password: "library-test-password",
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
          password: "library-test-password",
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
});
afterAll(async () => {
  if (!service) return;
  for (const id of users) await service.auth.admin.deleteUser(id);
  await service.from("admin_allowlist").delete().like("email", `${prefix}%`);
});

// A song with no job, so the live render PC worker has nothing to claim.
async function song(
  who: string = owner,
  pack: object | null = { title: "Pack title", lyrics: "x" },
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
      lyric_pack: pack,
    })
    .select("id")
    .single();
  expect(version.error).toBeNull();
  return version.data?.id as string;
}
async function row(id: string) {
  const { data, error } = await service
    .from("versions")
    .select()
    .eq("id", id)
    .single();
  expect(error).toBeNull();
  return data;
}

describe("reactions and plays", () => {
  it("keeps like and dislike mutually exclusive and clears them with none", async () => {
    const id = await song();
    expect(await row(id)).toMatchObject({
      liked: false,
      disliked: false,
      play_count: 0,
    });
    expect(
      (await client.rpc("set_reaction", { p_version: id, p_reaction: "like" }))
        .error,
    ).toBeNull();
    expect(await row(id)).toMatchObject({ liked: true, disliked: false });
    expect(
      (
        await client.rpc("set_reaction", {
          p_version: id,
          p_reaction: "dislike",
        })
      ).error,
    ).toBeNull();
    expect(await row(id)).toMatchObject({ liked: false, disliked: true });
    expect(
      (await client.rpc("set_reaction", { p_version: id, p_reaction: "none" }))
        .error,
    ).toBeNull();
    expect(await row(id)).toMatchObject({ liked: false, disliked: false });
    expect(
      (await client.rpc("set_reaction", { p_version: id, p_reaction: "love" }))
        .error?.message,
    ).toContain("invalid reaction");
    // The table constraint holds even for a writer that skips the RPC.
    expect(
      (
        await service
          .from("versions")
          .update({ liked: true, disliked: true })
          .eq("id", id)
      ).error,
    ).not.toBeNull();
  });

  it("counts a play for the owner only", async () => {
    const id = await song();
    for (let i = 0; i < 3; i += 1)
      expect(
        (await client.rpc("count_play", { p_version: id })).error,
      ).toBeNull();
    expect((await row(id)).play_count).toBe(3);
    expect(
      (await other.rpc("count_play", { p_version: id })).error?.message,
    ).toContain("owned version required");
    expect((await row(id)).play_count).toBe(3);
  });

  it("refuses owner writes made without the RPCs and denies anonymous callers", async () => {
    const id = await song();
    const direct = await client
      .from("versions")
      .update({
        liked: true,
        play_count: 99,
        trashed_at: new Date().toISOString(),
      })
      .eq("id", id)
      .select();
    expect(direct.error ?? direct.data?.length === 0).toBeTruthy();
    expect(await row(id)).toMatchObject({
      liked: false,
      play_count: 0,
      trashed_at: null,
    });
    for (const call of [
      anon.rpc("set_reaction", { p_version: id, p_reaction: "like" }),
      anon.rpc("count_play", { p_version: id }),
      anon.rpc("rename_version", { p_version: id, p_title: "x" }),
      anon.rpc("trash_versions", { p_versions: [id] }),
      anon.rpc("restore_versions", { p_versions: [id] }),
      anon.rpc("my_queue_positions"),
    ])
      expect((await call).error).not.toBeNull();
    expect(await row(id)).toMatchObject({ liked: false, trashed_at: null });
  });
});

describe("rename", () => {
  it("stores a trimmed display title and leaves the lyric pack alone", async () => {
    const id = await song();
    expect(
      (
        await client.rpc("rename_version", {
          p_version: id,
          p_title: "  Lunedi  ",
        })
      ).error,
    ).toBeNull();
    const after = await row(id);
    expect(after.display_title).toBe("Lunedi");
    expect(after.lyric_pack).toEqual({ title: "Pack title", lyrics: "x" });
  });

  it("accepts 1 to 100 characters and rejects the rest", async () => {
    const id = await song();
    const rename = (p_title: string | null) =>
      client.rpc("rename_version", { p_version: id, p_title });
    expect((await rename("x".repeat(100))).error).toBeNull();
    expect((await row(id)).display_title).toHaveLength(100);
    for (const bad of ["x".repeat(101), "", "   ", null])
      expect((await rename(bad)).error?.message).toContain("invalid title");
    expect((await row(id)).display_title).toHaveLength(100);
  });

  it("is owner only", async () => {
    const id = await song();
    expect(
      (
        await other.rpc("rename_version", {
          p_version: id,
          p_title: "mine now",
        })
      ).error?.message,
    ).toContain("owned version required");
    expect((await row(id)).display_title).toBeNull();
  });
});

describe("trash", () => {
  it("moves owned songs to the trash and restores them, counting what changed", async () => {
    const [a, b, c] = [await song(), await song(), await song()] as [
      string,
      string,
      string,
    ];
    const foreign = await song(stranger);
    // One id is not the caller's, one is repeated: only real changes count.
    const trashed = await client.rpc("trash_versions", {
      p_versions: [a, b, b, foreign],
    });
    expect(trashed.error).toBeNull();
    expect(trashed.data).toBe(2);
    expect((await row(a)).trashed_at).not.toBeNull();
    expect((await row(b)).trashed_at).not.toBeNull();
    expect((await row(c)).trashed_at).toBeNull();
    expect((await row(foreign)).trashed_at).toBeNull();
    // Already trashed songs do not count a second time.
    expect(
      (await client.rpc("trash_versions", { p_versions: [a, c] })).data,
    ).toBe(1);
    // The strangers cannot restore them.
    expect(
      (await other.rpc("restore_versions", { p_versions: [a, b, c] })).data,
    ).toBe(0);
    const restored = await client.rpc("restore_versions", {
      p_versions: [a, b, c],
    });
    expect(restored.data).toBe(3);
    for (const id of [a, b, c]) expect((await row(id)).trashed_at).toBeNull();
    expect(
      (await client.rpc("restore_versions", { p_versions: [a] })).data,
    ).toBe(0);
  });

  it("validates the id list", async () => {
    expect(
      (await client.rpc("trash_versions", { p_versions: [] })).error?.message,
    ).toContain("invalid versions");
    expect(
      (await client.rpc("restore_versions", { p_versions: null })).error
        ?.message,
    ).toContain("invalid versions");
  });

  it("blocks web checkpoints on a trashed song until it is restored", async () => {
    const id = await song();
    await client.rpc("trash_versions", { p_versions: [id] });
    for (const call of [
      client.rpc("set_reaction", { p_version: id, p_reaction: "like" }),
      client.rpc("count_play", { p_version: id }),
      client.rpc("rename_version", { p_version: id, p_title: "x" }),
      client.rpc("generate_again", { p_version: id, p_generation: 1 }),
    ])
      expect((await call).error?.message).toContain("owned version required");
    await client.rpc("restore_versions", { p_versions: [id] });
    expect(
      (await client.rpc("set_reaction", { p_version: id, p_reaction: "like" }))
        .error,
    ).toBeNull();
  });

  it("keeps the worker from claiming a job of a trashed song, and resumes it on restore", async () => {
    const id = await song();
    const job = await service
      .from("jobs")
      .insert({
        owner_id: owner,
        version_id: id,
        stage: "draft_lyrics",
        idempotency_key: `${prefix}-claim`,
      })
      .select("id")
      .single();
    expect(job.error).toBeNull();
    await client.rpc("trash_versions", { p_versions: [id] });
    const claimed = await service.rpc("claim_job", { p_worker: `${prefix}-w` });
    expect(claimed.error).toBeNull();
    expect((claimed.data as { id: string }[]).map((j) => j.id)).not.toContain(
      job.data?.id,
    );
    const still = await service
      .from("jobs")
      .select("status")
      .eq("id", job.data?.id)
      .single();
    expect(still.data?.status).toBe("queued");

    await client.rpc("restore_versions", { p_versions: [id] });
    const again = await service.rpc("claim_job", { p_worker: `${prefix}-w` });
    expect(again.error).toBeNull();
    const after = await service
      .from("jobs")
      .select("status,worker_id")
      .eq("id", job.data?.id)
      .single();
    // Either this claim took it, or the live render PC did first; it is claimable again.
    if ((again.data as { id: string }[]).some((j) => j.id === job.data?.id))
      expect(after.data?.worker_id).toBe(`${prefix}-w`);
    else expect(after.data?.status).not.toBe("queued");
  });
});

describe("queue position", () => {
  it("counts the jobs ahead, ignores trashed songs, and shows only the caller's songs", async () => {
    const [a, b, c] = [await song(), await song(), await song()] as [
      string,
      string,
      string,
    ];
    const foreign = await song(stranger);
    // Far-future creation times put these jobs behind every real job, in a known order.
    const stamp = (n: number) =>
      new Date(Date.UTC(2099, 0, 1, 0, 0, n)).toISOString();
    for (const [i, [who, version]] of (
      [
        [owner, a],
        [owner, b],
        [stranger, foreign],
        [owner, c],
      ] as const
    ).entries()) {
      const inserted = await service.from("jobs").insert({
        owner_id: who,
        version_id: version,
        stage: "draft_lyrics",
        idempotency_key: `${prefix}-pos-${i}`,
        created_at: stamp(i),
      });
      expect(inserted.error).toBeNull();
    }
    const positions = async () => {
      const { data, error } = await client.rpc("my_queue_positions");
      expect(error).toBeNull();
      return new Map(
        (data as { version_id: string; queue_position: number }[]).map((p) => [
          p.version_id,
          p.queue_position,
        ]),
      );
    };
    const first = await positions();
    const base = first.get(a);
    expect(base).toBeGreaterThanOrEqual(1);
    // a, b, the stranger's song and c are consecutive; the stranger's job counts for c.
    expect(first.get(b)).toBe((base ?? 0) + 1);
    expect(first.get(c)).toBe((base ?? 0) + 3);
    expect(first.has(foreign)).toBe(false);

    // Trashing b removes it from the list and from c's count.
    await client.rpc("trash_versions", { p_versions: [b] });
    const second = await positions();
    expect(second.has(b)).toBe(false);
    expect(second.get(c)).toBe((base ?? 0) + 2);

    // The stranger sees their own song, behind everything the caller has queued before it.
    const theirs = await other.rpc("my_queue_positions");
    expect(
      (theirs.data as { version_id: string }[]).map((p) => p.version_id),
    ).toEqual([foreign]);

    // Once a job leaves the queue its song has no position.
    await service
      .from("jobs")
      .update({ status: "done" })
      .eq("idempotency_key", `${prefix}-pos-0`);
    expect((await positions()).has(a)).toBe(false);
  });
});
