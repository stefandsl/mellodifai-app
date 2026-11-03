import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { opsRpc } from "./helpers/ops-call";

// Songs from songs (migration 20261101000023): "Riscrivi una parte" (section_edits and its RPCs),
// choose_take, "Importa da Suno" (import_song), recordings in the uploads bucket, create_song
// from audio and the song's source record.
//
// The render PC worker may be running against this database: every job made here is parked
// (not_before in a day) right after the assertions that need it queued.
let service: SupabaseClient;
let client: SupabaseClient;
let other: SupabaseClient;
let owner: string;
let stranger: string;
const users: string[] = [];
const prefix = `sfs-${Date.now()}`;
const uploaded: string[] = [];
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
      password: "sfs-test-password",
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
          password: "sfs-test-password",
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
  // The stranger is a customer: local engines are refused to them.
  await service
    .from("profiles")
    .update({ role: "customer" })
    .eq("id", stranger);
});
afterAll(async () => {
  if (!service) return;
  if (uploaded.length) await service.storage.from("uploads").remove(uploaded);
  for (const id of users) await service.auth.admin.deleteUser(id);
  await service.from("admin_allowlist").delete().like("email", `${prefix}%`);
});

const LYRICS = "[Verse]\nSono le nove\nla prima mail\n[Chorus]\nSolo un caffè";
const NEW = "[Verse]\nSono le otto\nil primo file\n[Chorus]\nSolo un caffè";

async function song(status = "audio_ready", who = owner) {
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
      lang: "it",
      lyric_pack: { title: "T", lyrics: LYRICS, style: "pop" },
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
      engine: "kie",
      cover_path: "previews/cover.jpg",
      audio_preview_path: `previews/${who}/${id}/take-1.mp3`,
    })
    .select("id")
    .single();
  expect(take.error).toBeNull();
  await service
    .from("versions")
    .update({
      status,
      chosen_take_id: status === "takes_review" ? null : take.data?.id,
    })
    .eq("id", id);
  return {
    id,
    project: project.data?.id as string,
    take: take.data?.id as string,
  };
}
async function park(versionId: string) {
  await service
    .from("jobs")
    .update({ not_before: new Date(Date.now() + 86_400_000).toISOString() })
    .eq("version_id", versionId)
    .eq("status", "queued");
}
const request = (
  db: SupabaseClient,
  s: { id: string; take: string },
  patch: Record<string, unknown> = {},
) =>
  opsRpc(db, "request_section_edit", {
    p_version: s.id,
    p_take: s.take,
    p_engine: "kie",
    p_start: 21,
    p_end: 33,
    p_duration: 120,
    p_lines: [1, 2],
    p_section: "Sono le otto\nil primo file",
    p_full: NEW,
    ...patch,
  });
async function finished(editId: string, n = 2) {
  const alternatives = Array.from({ length: n }, (_, i) => ({
    path: `previews/${owner}/x/section-${i + 1}.mp3`,
    duration: 120,
    kie_task_id: "replace-1",
    kie_audio_id: `alt-${i + 1}`,
    lyric_timing: {
      source: "copied",
      lines: [{ text: "Sono le otto", start: 21, end: 24 }],
    },
  }));
  expect(
    (
      await service
        .from("section_edits")
        .update({ alternatives })
        .eq("id", editId)
    ).error,
  ).toBeNull();
  await service
    .from("jobs")
    .update({ status: "done" })
    .eq("payload->>edit_id", editId);
}

describe("request_section_edit", () => {
  it("records the part and queues the on-demand stage, leaving the song alone", async () => {
    const s = await song();
    const r = await request(client, s);
    expect(r.error).toBeNull();
    await park(s.id);
    const { data: edit } = await client
      .from("section_edits")
      .select()
      .eq("id", r.data)
      .single();
    expect(edit).toMatchObject({
      version_id: s.id,
      take_id: s.take,
      engine: "kie",
      start_s: 21,
      end_s: 33,
      section_lines: [1, 2],
      full_lyrics: NEW,
      old_lyrics: LYRICS,
      alternatives: [],
    });
    const { data: jobs } = await service
      .from("jobs")
      .select()
      .eq("version_id", s.id);
    expect(jobs).toHaveLength(1);
    expect(jobs?.[0]).toMatchObject({
      stage: "replace_section",
      idempotency_key: `replace_section:${r.data}`,
      payload: { edit_id: r.data, take_id: s.take },
    });
    const { data: v } = await service
      .from("versions")
      .select("status")
      .eq("id", s.id)
      .single();
    expect(v?.status).toBe("audio_ready");
    // One rewrite of a song at a time.
    expect((await request(client, s)).error?.message).toContain(
      "already running",
    );
    // Its own queue line, not the song's badge.
    const queue = await client.rpc("my_section_queue");
    expect(queue.error).toBeNull();
    const positions = await client.rpc("my_queue_positions");
    expect(
      (positions.data as { version_id: string }[]).some(
        (row) => row.version_id === s.id,
      ),
    ).toBe(false);
  });
  it("keeps Suno's limits: 10 to 30 seconds, at most half of the take", async () => {
    const s = await song();
    for (const [start, end, duration] of [
      [21, 30.99, 120],
      [21, 51.01, 120],
      [0, 16, 30],
      [-1, 12, 120],
      [110, 125, 120],
    ] as const) {
      const r = await request(client, s, {
        p_start: start,
        p_end: end,
        p_duration: duration,
      });
      expect(r.error?.message, `${start}-${end}/${duration}`).toMatch(
        /part is 10 to 30|outside/u,
      );
    }
    expect(
      (await request(client, s, { p_start: 0, p_end: 15, p_duration: 30 }))
        .error,
    ).toBeNull();
    await park(s.id);
  });
  it("refuses empty lyrics, other statuses, old takes, strangers and local engines for customers", async () => {
    const s = await song();
    expect(
      (await request(client, s, { p_section: "  " })).error?.message,
    ).toContain("lyrics");
    for (const status of [
      "lyrics_review",
      "song_queued",
      "producing",
      "publishing",
      "failed",
    ]) {
      const t = await song(status);
      expect((await request(client, t)).error?.message, status).toContain(
        "not ready",
      );
    }
    const review = await song("takes_review");
    expect((await request(client, review)).error).toBeNull();
    await park(review.id);
    await service
      .from("versions")
      .update({ generation_count: 2 })
      .eq("id", s.id);
    expect((await request(client, s)).error?.message).toContain("current take");
    const theirs = await song("audio_ready", stranger);
    expect((await request(client, theirs)).error?.message).toContain(
      "owned version",
    );
    expect(
      (await request(other, theirs, { p_engine: "ace-step" })).error?.message,
    ).toContain("admin only");
    expect(
      (await request(client, s, { p_engine: "yue2" })).error,
    ).not.toBeNull();
  });
  it("is private to its owner", async () => {
    const s = await song();
    const r = await request(client, s);
    await park(s.id);
    const { data } = await other
      .from("section_edits")
      .select()
      .eq("id", r.data);
    expect(data).toEqual([]);
    expect(
      (
        await client
          .from("section_edits")
          .update({ alternatives: [] })
          .eq("id", r.data)
      ).error,
    ).not.toBeNull();
  });
});

describe("keep_section_edit and choose_take", () => {
  it("adds the kept alternative as a new take next to the original and makes it the song's audio", async () => {
    const s = await song();
    const r = await request(client, s);
    await park(s.id);
    const early = await opsRpc(client, "keep_section_edit", {
      p_edit: r.data,
      p_alternative: 0,
    });
    expect(early.error?.message).toContain("alternative not found");
    await finished(r.data as string);
    const kept = await opsRpc(client, "keep_section_edit", {
      p_edit: r.data,
      p_alternative: 1,
    });
    expect(kept.error).toBeNull();
    const { data: takes } = await client
      .from("takes")
      .select()
      .eq("version_id", s.id)
      .order("take_number");
    expect(takes?.map((t) => [t.take_number, t.generation])).toEqual([
      [1, 1],
      [2, 1],
    ]);
    expect(takes?.[1]).toMatchObject({
      id: kept.data,
      engine: "kie",
      audio_preview_path: `previews/${owner}/x/section-2.mp3`,
      cover_path: "previews/cover.jpg",
      kie_task_id: "replace-1",
      kie_audio_id: "alt-2",
      lyrics: NEW,
      lyric_timing: { source: "copied" },
      source: {
        kind: "replace",
        from_take_id: s.take,
        edit_id: r.data,
        alternative: 1,
      },
    });
    // The original keeps the words it sings.
    expect(takes?.[0]?.lyrics).toBe(LYRICS);
    const { data: v } = await client
      .from("versions")
      .select("chosen_take_id,lyric_pack,status")
      .eq("id", s.id)
      .single();
    expect(v?.chosen_take_id).toBe(kept.data);
    expect(v?.lyric_pack.lyrics).toBe(NEW);
    expect(v?.status).toBe("audio_ready");
    expect(
      (
        await opsRpc(client, "keep_section_edit", {
          p_edit: r.data,
          p_alternative: 0,
        })
      ).error?.message,
    ).toContain("already kept");
    // Back to the original, with its own lyrics.
    expect(
      (await opsRpc(client, "choose_take", { p_version: s.id, p_take: s.take }))
        .error,
    ).toBeNull();
    const { data: back } = await client
      .from("versions")
      .select("chosen_take_id,lyric_pack")
      .eq("id", s.id)
      .single();
    expect(back?.chosen_take_id).toBe(s.take);
    expect(back?.lyric_pack.lyrics).toBe(LYRICS);
  });
  it("only adds the take while the takes are reviewed, and picking it brings its lyrics", async () => {
    const s = await song("takes_review");
    const r = await request(client, s);
    await park(s.id);
    await finished(r.data as string, 1);
    const kept = await opsRpc(client, "keep_section_edit", {
      p_edit: r.data,
      p_alternative: 0,
    });
    expect(kept.error).toBeNull();
    const { data: v } = await client
      .from("versions")
      .select("chosen_take_id,lyric_pack")
      .eq("id", s.id)
      .single();
    expect(v?.chosen_take_id).toBeNull();
    expect(v?.lyric_pack.lyrics).toBe(LYRICS);
    expect(
      (
        await opsRpc(client, "keep_audio", {
          p_version: s.id,
          p_take: kept.data,
        })
      ).error,
    ).toBeNull();
    const { data: after } = await client
      .from("versions")
      .select("lyric_pack,status")
      .eq("id", s.id)
      .single();
    expect(after?.lyric_pack.lyrics).toBe(NEW);
    expect(after?.status).toBe("audio_ready");
  });
  it("discards a request, and refuses strangers", async () => {
    const s = await song();
    const r = await request(client, s);
    await park(s.id);
    await finished(r.data as string);
    expect(
      (await opsRpc(other, "discard_section_edit", { p_edit: r.data })).error,
    ).not.toBeNull();
    expect(
      (
        await opsRpc(other, "keep_section_edit", {
          p_edit: r.data,
          p_alternative: 0,
        })
      ).error,
    ).not.toBeNull();
    expect(
      (await opsRpc(client, "discard_section_edit", { p_edit: r.data })).error,
    ).toBeNull();
    expect(
      (
        await opsRpc(client, "keep_section_edit", {
          p_edit: r.data,
          p_alternative: 0,
        })
      ).error?.message,
    ).toContain("discarded");
    expect(
      (await opsRpc(other, "choose_take", { p_version: s.id, p_take: s.take }))
        .error,
    ).not.toBeNull();
    const review = await song("producing");
    expect(
      (
        await opsRpc(client, "choose_take", {
          p_version: review.id,
          p_take: review.take,
        })
      ).error?.message,
    ).toContain("chosen take required");
  });
});

async function uploadAudio(
  db: SupabaseClient,
  who: string,
  ext = "mp3",
  type = "audio/mpeg",
) {
  const path = `${who}/audio/${crypto.randomUUID()}.${ext}`;
  const { error } = await db.storage
    .from("uploads")
    .upload(
      path,
      new Blob([new Uint8Array([0xff, 0xfb, 0x90, 0x00])], { type }),
      {
        contentType: type,
      },
    );
  if (!error) uploaded.push(path);
  return { path, error };
}

describe("recordings and Importa da Suno", () => {
  it("takes the owner's recordings in the uploads bucket, nobody else's", async () => {
    for (const [ext, type] of [
      ["mp3", "audio/mpeg"],
      ["wav", "audio/wav"],
      ["flac", "audio/flac"],
    ] as const)
      expect(
        (await uploadAudio(client, owner, ext, type)).error,
        type,
      ).toBeNull();
    expect((await uploadAudio(client, stranger)).error).not.toBeNull();
    expect(
      (await uploadAudio(client, owner, "mp3", "text/plain")).error,
    ).not.toBeNull();
  });
  it("makes a song waiting for import_audio, with its source", async () => {
    const file = await uploadAudio(client, owner);
    expect(file.error).toBeNull();
    const r = await opsRpc(client, "import_song", {
      p_title: "La mia canzone",
      p_style: "",
      p_lyrics: "[Verse]\nriga",
      p_lang: "it",
      p_upload: file.path,
      p_source: {
        kind: "suno",
        url: "https://suno.com/s/abc",
        licence: "own",
        junk: 1,
      },
    });
    expect(r.error).toBeNull();
    const { data: project } = await client
      .from("projects")
      .select("topic,style,source,song_settings,versions(id,status,lyric_pack)")
      .eq("id", r.data)
      .single();
    expect(project?.source).toEqual({
      kind: "suno",
      url: "https://suno.com/s/abc",
      licence: "own",
      upload: file.path,
    });
    expect(project?.style).toBe("Importata da Suno");
    expect(project?.song_settings).toMatchObject({
      engine: "kie",
      video: "off",
    });
    const version = project?.versions[0];
    expect(version?.status).toBe("song_queued");
    expect(version?.lyric_pack).toMatchObject({
      title: "La mia canzone",
      lyrics: "[Verse]\nriga",
    });
    await park(version?.id as string);
    const { data: jobs } = await service
      .from("jobs")
      .select()
      .eq("version_id", version?.id);
    expect(jobs?.[0]).toMatchObject({
      stage: "import_audio",
      payload: { upload: file.path },
    });
  });
  it("refuses a missing or foreign recording and a bad source", async () => {
    const base = { p_title: "X", p_style: "pop", p_lyrics: "", p_lang: "it" };
    const missing = `${owner}/audio/${crypto.randomUUID()}.mp3`;
    expect(
      (
        await opsRpc(client, "import_song", {
          ...base,
          p_upload: missing,
          p_source: { kind: "upload" },
        })
      ).error?.message,
    ).toContain("uploaded audio required");
    const theirs = await uploadAudio(other, stranger);
    expect(theirs.error).toBeNull();
    expect(
      (
        await opsRpc(client, "import_song", {
          ...base,
          p_upload: theirs.path,
          p_source: { kind: "upload" },
        })
      ).error,
    ).not.toBeNull();
    const mine = await uploadAudio(client, owner);
    expect(
      (
        await opsRpc(client, "import_song", {
          ...base,
          p_upload: mine.path,
          p_source: { kind: "cover" },
        })
      ).error?.message,
    ).toContain("invalid source");
    expect(
      (
        await opsRpc(client, "import_song", {
          ...base,
          p_upload: mine.path,
          p_source: { kind: "suno", licence: "stolen" },
        })
      ).error?.message,
    ).toContain("licence");
  });
});

describe("create_song from audio and the source record", () => {
  const create = (db: SupabaseClient, settings: Record<string, unknown>) =>
    opsRpc(db, "create_song", {
      p_prompt: `${prefix} cover`,
      p_lyrics: "",
      p_languages: ["it"],
      p_style: "folk",
      p_vocal_gender: null,
      p_settings: settings,
    });
  it("starts a cover from a take of the owner's and records where it came from", async () => {
    const s = await song();
    const r = await create(client, {
      engine: "kie",
      source: { mode: "cover", takeId: s.take, title: "Solo un caffè" },
    });
    expect(r.error).toBeNull();
    const { data: p } = await client
      .from("projects")
      .select("source,versions(id)")
      .eq("id", r.data)
      .single();
    expect(p?.source).toEqual({
      kind: "cover",
      licence: "own",
      title: "Solo un caffè",
      versionId: s.id,
    });
    await park(p?.versions[0]?.id as string);
  });
  it("starts from an upload, in the modes each engine has", async () => {
    const file = await uploadAudio(client, owner);
    const r = await create(client, {
      engine: "kie",
      source: { mode: "extend", upload: file.path, continueAt: 60 },
    });
    expect(r.error).toBeNull();
    const { data: p } = await client
      .from("projects")
      .select("source,versions(id)")
      .eq("id", r.data)
      .single();
    expect(p?.source).toMatchObject({ kind: "extend", upload: file.path });
    await park(p?.versions[0]?.id as string);
    for (const settings of [
      { engine: "ace-step", source: { mode: "reference", upload: file.path } },
      { engine: "ace-step", source: { mode: "cover", upload: file.path } },
      { engine: "yue2", source: { mode: "cover", upload: file.path } },
      { engine: "kie", source: { mode: "remix", upload: file.path } },
      { engine: "kie", source: { mode: "cover" } },
    ])
      expect(
        (await create(client, settings)).error,
        JSON.stringify(settings),
      ).not.toBeNull();
    const theirs = await song("audio_ready", stranger);
    expect(
      (
        await create(client, {
          engine: "kie",
          source: { mode: "cover", takeId: theirs.take },
        })
      ).error?.message,
    ).toContain("source take required");
  });
  it("lets the owner fill in title, author, link and licence, not the kind or the file", async () => {
    const file = await uploadAudio(client, owner);
    const r = await opsRpc(client, "import_song", {
      p_title: "Fonte",
      p_style: "pop",
      p_lyrics: "",
      p_lang: "it",
      p_upload: file.path,
      p_source: { kind: "upload" },
    });
    const { data: p } = await client
      .from("projects")
      .select("versions(id)")
      .eq("id", r.data)
      .single();
    const versionId = p?.versions[0]?.id as string;
    await park(versionId);
    const set = await opsRpc(client, "set_song_source", {
      p_version: versionId,
      p_source: {
        kind: "suno",
        upload: "elsewhere",
        title: "Originale",
        author: "Autore",
        url: "https://example.com/song",
        licence: "cc-by-sa",
      },
    });
    expect(set.error).toBeNull();
    const { data: after } = await client
      .from("projects")
      .select("source")
      .eq("id", r.data)
      .single();
    expect(after?.source).toEqual({
      kind: "upload",
      upload: file.path,
      title: "Originale",
      author: "Autore",
      url: "https://example.com/song",
      licence: "cc-by-sa",
    });
    expect(
      (
        await opsRpc(client, "set_song_source", {
          p_version: versionId,
          p_source: { url: "ftp://x" },
        })
      ).error?.message,
    ).toContain("url");
    expect(
      (
        await opsRpc(other, "set_song_source", {
          p_version: versionId,
          p_source: { licence: "own" },
        })
      ).error,
    ).not.toBeNull();
  });
});
