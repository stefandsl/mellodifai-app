import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

// Playlists (migration 20261101000019): RLS, the write RPCs, ordering and the liked-at time.
let service: SupabaseClient;
let client: SupabaseClient;
let other: SupabaseClient;
let anon: SupabaseClient;
let owner: string;
let stranger: string;
const users: string[] = [];
const prefix = `playlists-${Date.now()}`;
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
      password: "playlists-test-password",
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
          password: "playlists-test-password",
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
async function song(who: string = owner) {
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
  return version.data?.id as string;
}
async function songs(n: number, who: string = owner) {
  const out: string[] = [];
  for (let i = 0; i < n; i += 1) out.push(await song(who));
  return out;
}
async function playlist(name = "Mine", who: SupabaseClient = client) {
  const { data, error } = await who.rpc("create_playlist", { p_name: name });
  expect(error).toBeNull();
  return data as string;
}
async function order(id: string) {
  const { data, error } = await service
    .from("playlist_items")
    .select("version_id,position")
    .eq("playlist_id", id)
    .order("position");
  expect(error).toBeNull();
  return data ?? [];
}
async function ids(id: string) {
  return (await order(id)).map((item) => item.version_id as string);
}
async function positions(id: string) {
  return (await order(id)).map((item) => item.position as number);
}

describe("access", () => {
  it("lets an owner read their playlists and items and nobody else", async () => {
    const [a, b] = await songs(2);
    const id = await playlist("Visible");
    await client.rpc("add_to_playlist", { p_playlist: id, p_versions: [a, b] });

    const mine = await client.from("playlists").select();
    expect(mine.error).toBeNull();
    expect(mine.data?.map((row) => row.id)).toContain(id);
    expect((await client.from("playlist_items").select()).data).toHaveLength(2);

    expect((await other.from("playlists").select()).data).toEqual([]);
    expect((await other.from("playlist_items").select()).data).toEqual([]);
    expect((await anon.from("playlists").select()).data ?? []).toEqual([]);
    expect(
      (await anon.rpc("my_playlists")).error ??
        (await anon.rpc("create_playlist", { p_name: "x" })).error,
    ).not.toBeNull();
  });

  it("refuses direct writes: every change goes through an RPC", async () => {
    const [a] = await songs(1);
    const id = await playlist("Guarded");
    expect(
      (
        await client
          .from("playlists")
          .insert({ owner_id: owner, name: "Sneaky" })
      ).error,
    ).not.toBeNull();
    expect(
      (await client.from("playlists").update({ name: "Renamed" }).eq("id", id))
        .error,
    ).not.toBeNull();
    expect(
      (await client.from("playlists").delete().eq("id", id)).error,
    ).not.toBeNull();
    expect(
      (
        await client
          .from("playlist_items")
          .insert({ playlist_id: id, version_id: a, position: 1 })
      ).error,
    ).not.toBeNull();
    expect(
      (await client.from("playlist_items").delete().eq("playlist_id", id))
        .error,
    ).not.toBeNull();
    const { data } = await service
      .from("playlists")
      .select("name")
      .eq("id", id)
      .single();
    expect(data?.name).toBe("Guarded");
  });

  it("refuses to touch a playlist that belongs to someone else", async () => {
    const [mine] = await songs(1);
    const [theirs] = await songs(1, stranger);
    const id = await playlist("Private");
    await client.rpc("add_to_playlist", { p_playlist: id, p_versions: [mine] });
    for (const call of [
      other.rpc("rename_playlist", { p_playlist: id, p_name: "Stolen" }),
      other.rpc("delete_playlist", { p_playlist: id }),
      other.rpc("add_to_playlist", { p_playlist: id, p_versions: [theirs] }),
      other.rpc("remove_from_playlist", { p_playlist: id, p_versions: [mine] }),
      other.rpc("reorder_playlist", { p_playlist: id, p_versions: [mine] }),
    ])
      expect((await call).error?.message).toContain("owned playlist required");
    expect(await ids(id)).toEqual([mine]);
    const { data } = await service
      .from("playlists")
      .select("name")
      .eq("id", id)
      .single();
    expect(data?.name).toBe("Private");
  });
});

describe("create, rename and delete", () => {
  it("trims names, enforces 1 to 100 characters and returns the id", async () => {
    const id = await playlist("  Sera  ");
    const { data } = await service
      .from("playlists")
      .select("name,owner_id")
      .eq("id", id)
      .single();
    expect(data).toEqual({ name: "Sera", owner_id: owner });

    for (const bad of ["", "   ", "x".repeat(101)])
      expect(
        (await client.rpc("create_playlist", { p_name: bad })).error?.message,
      ).toContain("invalid name");
    expect(
      (await client.rpc("create_playlist", { p_name: "x".repeat(100) })).error,
    ).toBeNull();

    expect(
      (
        await client.rpc("rename_playlist", {
          p_playlist: id,
          p_name: " Notte ",
        })
      ).error,
    ).toBeNull();
    const renamed = await service
      .from("playlists")
      .select("name")
      .eq("id", id)
      .single();
    expect(renamed.data?.name).toBe("Notte");
    expect(
      (await client.rpc("rename_playlist", { p_playlist: id, p_name: " " }))
        .error?.message,
    ).toContain("invalid name");
  });

  it("deletes the playlist and its entries but never the songs", async () => {
    const [a, b] = await songs(2);
    const id = await playlist("Gone");
    await client.rpc("add_to_playlist", { p_playlist: id, p_versions: [a, b] });
    expect(
      (await client.rpc("delete_playlist", { p_playlist: id })).error,
    ).toBeNull();
    expect(
      (await service.from("playlists").select().eq("id", id)).data,
    ).toEqual([]);
    expect(await order(id)).toEqual([]);
    const left = await service.from("versions").select("id").in("id", [a, b]);
    expect(left.data).toHaveLength(2);
    expect(
      (await client.rpc("delete_playlist", { p_playlist: id })).error?.message,
    ).toContain("owned playlist required");
  });

  it("caps a user at 100 playlists", async () => {
    const email = `${prefix}-cap@example.test`;
    await service.from("admin_allowlist").insert({ email, role: "admin" });
    const { data: fresh } = await service.auth.admin.createUser({
      email,
      password: "playlists-test-password",
      email_confirm: true,
    });
    const capId = fresh.user?.id as string;
    users.push(capId);
    const capped = createClient(env("SUPABASE_URL"), env("SUPABASE_ANON_KEY"), {
      auth: { persistSession: false },
    });
    await capped.auth.signInWithPassword({
      email,
      password: "playlists-test-password",
    });
    const rows = Array.from({ length: 100 }, (_, i) => ({
      owner_id: capId,
      name: `P${i}`,
    }));
    expect((await service.from("playlists").insert(rows)).error).toBeNull();
    expect(
      (await capped.rpc("create_playlist", { p_name: "One too many" })).error
        ?.message,
    ).toContain("too many playlists");
  });
});

describe("songs in a playlist", () => {
  it("appends in the given order, skips repeats, foreign and trashed songs", async () => {
    const [a, b, c, d, e] = await songs(5);
    const [theirs] = await songs(1, stranger);
    const id = await playlist("Order");
    await service
      .from("versions")
      .update({ trashed_at: new Date().toISOString() })
      .eq("id", d);

    const first = await client.rpc("add_to_playlist", {
      p_playlist: id,
      p_versions: [c, a],
    });
    expect(first.data).toBe(2);
    expect(await ids(id)).toEqual([c, a]);
    expect(await positions(id)).toEqual([1, 2]);

    // a is already in, theirs is foreign, d is in the trash, c repeats inside the call.
    const second = await client.rpc("add_to_playlist", {
      p_playlist: id,
      p_versions: [a, theirs, d, e, b, e],
    });
    expect(second.data).toBe(2);
    expect(await ids(id)).toEqual([c, a, e, b]);
    expect(await positions(id)).toEqual([1, 2, 3, 4]);
    expect(
      (await client.rpc("add_to_playlist", { p_playlist: id, p_versions: [] }))
        .error?.message,
    ).toContain("invalid versions");
  });

  it("removes songs, counts what really left and keeps positions dense", async () => {
    const [a, b, c, d] = await songs(4);
    const id = await playlist("Remove");
    await client.rpc("add_to_playlist", {
      p_playlist: id,
      p_versions: [a, b, c, d],
    });
    const stray = await song();
    const removed = await client.rpc("remove_from_playlist", {
      p_playlist: id,
      p_versions: [b, d, stray],
    });
    expect(removed.data).toBe(2);
    expect(await ids(id)).toEqual([a, c]);
    expect(await positions(id)).toEqual([1, 2]);
    // The songs are still in the library.
    expect(
      (await service.from("versions").select("id").in("id", [b, d])).data,
    ).toHaveLength(2);
  });

  it("reorders: listed songs first in the given order, the rest keep their order", async () => {
    const [a, b, c, d] = await songs(4);
    const [theirs] = await songs(1, stranger);
    const id = await playlist("Reorder");
    await client.rpc("add_to_playlist", {
      p_playlist: id,
      p_versions: [a, b, c, d],
    });
    expect(
      (
        await client.rpc("reorder_playlist", {
          p_playlist: id,
          p_versions: [d, c, b, a],
        })
      ).error,
    ).toBeNull();
    expect(await ids(id)).toEqual([d, c, b, a]);
    expect(await positions(id)).toEqual([1, 2, 3, 4]);

    // A stale or partial list never loses a song; unknown ids are ignored.
    await client.rpc("reorder_playlist", {
      p_playlist: id,
      p_versions: [a, theirs, b],
    });
    expect(await ids(id)).toEqual([a, b, d, c]);
    expect(await positions(id)).toEqual([1, 2, 3, 4]);
    expect(
      (await client.rpc("reorder_playlist", { p_playlist: id, p_versions: [] }))
        .error?.message,
    ).toContain("invalid versions");
  });

  it("deletes entries when a song is deleted for good", async () => {
    const [a, b] = await songs(2);
    const id = await playlist("Cascade");
    await client.rpc("add_to_playlist", { p_playlist: id, p_versions: [a, b] });
    await service.from("versions").delete().eq("id", a);
    expect(await ids(id)).toEqual([b]);
  });
});

describe("lists and counts", () => {
  it("my_playlists counts the songs on show: trashed ones hide and come back on restore", async () => {
    const [a, b, c] = await songs(3);
    const id = await playlist("Counted");
    await client.rpc("add_to_playlist", {
      p_playlist: id,
      p_versions: [a, b, c],
    });
    const count = async () => {
      const { data, error } = await client.rpc("my_playlists");
      expect(error).toBeNull();
      return (data as { id: string; song_count: number }[]).find(
        (row) => row.id === id,
      )?.song_count;
    };
    expect(await count()).toBe(3);
    await client.rpc("trash_versions", { p_versions: [b] });
    expect(await count()).toBe(2);
    await client.rpc("restore_versions", { p_versions: [b] });
    expect(await count()).toBe(3);
    // Another user sees none of it.
    expect(
      ((await other.rpc("my_playlists")).data as { id: string }[]).map(
        (row) => row.id,
      ),
    ).not.toContain(id);
  });

  it("lists playlists oldest first with their name", async () => {
    const first = await playlist("Alpha");
    const second = await playlist("Beta");
    const { data } = await client.rpc("my_playlists");
    const mine = (data as { id: string; name: string }[]).filter((row) =>
      [first, second].includes(row.id),
    );
    expect(mine.map((row) => row.name)).toEqual(["Alpha", "Beta"]);
  });

  it("playlist_membership says how many of the given songs each playlist holds", async () => {
    const [a, b, c] = await songs(3);
    const one = await playlist("One");
    const two = await playlist("Two");
    await client.rpc("add_to_playlist", {
      p_playlist: one,
      p_versions: [a, b],
    });
    await client.rpc("add_to_playlist", { p_playlist: two, p_versions: [b] });
    const { data, error } = await client.rpc("playlist_membership", {
      p_versions: [a, b, c],
    });
    expect(error).toBeNull();
    const byId = new Map(
      (data as { playlist_id: string; n: number }[]).map((row) => [
        row.playlist_id,
        row.n,
      ]),
    );
    expect(byId.get(one)).toBe(2);
    expect(byId.get(two)).toBe(1);
    const single = await client.rpc("playlist_membership", { p_versions: [c] });
    expect(
      (single.data as { playlist_id: string; n: number }[]).find(
        (row) => row.playlist_id === one,
      )?.n,
    ).toBe(0);
  });
});

describe("liked_at", () => {
  it("is set on like, kept when liked again, and cleared by dislike or none", async () => {
    const id = await song();
    const liked = async () =>
      (
        await service
          .from("versions")
          .select("liked,liked_at")
          .eq("id", id)
          .single()
      ).data as { liked: boolean; liked_at: string | null };
    expect((await liked()).liked_at).toBeNull();

    await client.rpc("set_reaction", { p_version: id, p_reaction: "like" });
    const first = await liked();
    expect(first.liked).toBe(true);
    expect(first.liked_at).not.toBeNull();

    await new Promise((resolve) => setTimeout(resolve, 20));
    await client.rpc("set_reaction", { p_version: id, p_reaction: "like" });
    expect((await liked()).liked_at).toBe(first.liked_at);

    await client.rpc("set_reaction", { p_version: id, p_reaction: "dislike" });
    expect((await liked()).liked_at).toBeNull();
    await client.rpc("set_reaction", { p_version: id, p_reaction: "like" });
    await client.rpc("set_reaction", { p_version: id, p_reaction: "none" });
    expect((await liked()).liked_at).toBeNull();
  });
});
