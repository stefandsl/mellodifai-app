import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, expect, it } from "vitest";

const required = (name: string) => {
  const value = process.env[name];
  if (!value) throw new Error(`${name} required`);
  return value;
};
const prefix = `karaoke-${Date.now()}`;
const users: string[] = [];
let service: SupabaseClient;
let owner: SupabaseClient;
let stranger: SupabaseClient;
let versionId: string;
let takeId: string;

beforeAll(async () => {
  const url = required("SUPABASE_URL");
  service = createClient(url, required("SUPABASE_SERVICE_ROLE_KEY"));
  const clients: SupabaseClient[] = [];
  for (const suffix of ["owner", "stranger"]) {
    const email = `${prefix}-${suffix}@example.test`;
    await service.from("admin_allowlist").insert({ email });
    const { data, error } = await service.auth.admin.createUser({
      email,
      password: "karaoke-test-password",
      email_confirm: true,
    });
    if (error || !data.user) throw error ?? new Error("User missing");
    users.push(data.user.id);
    const client = createClient(url, required("SUPABASE_ANON_KEY"), {
      auth: { persistSession: false },
    });
    const signed = await client.auth.signInWithPassword({
      email,
      password: "karaoke-test-password",
    });
    if (signed.error) throw signed.error;
    clients.push(client);
  }
  owner = clients[0] as SupabaseClient;
  stranger = clients[1] as SupabaseClient;
  const { data: project, error: projectError } = await service
    .from("projects")
    .insert({ owner_id: users[0], topic: prefix })
    .select("id")
    .single();
  if (projectError) throw projectError;
  const { data: version, error: versionError } = await service
    .from("versions")
    .insert({
      owner_id: users[0],
      project_id: project.id,
      lang: "it",
      status: "audio_ready",
      lyric_pack: { lyrics: "[Verse]\nCiao mondo" },
    })
    .select("id")
    .single();
  if (versionError) throw versionError;
  versionId = version.id;
  const { data: take, error: takeError } = await service
    .from("takes")
    .insert({
      owner_id: users[0],
      version_id: versionId,
      generation: 1,
      take_number: 1,
      audio_preview_path: "previews/test.mp3",
    })
    .select("id")
    .single();
  if (takeError) throw takeError;
  takeId = take.id;
});

afterAll(async () => {
  if (!service) return;
  for (const id of users) await service.auth.admin.deleteUser(id);
  await service.from("admin_allowlist").delete().like("email", `${prefix}%`);
});

it("queues one local alignment job for the owner's untimed take", async () => {
  const first = await owner.rpc("request_lyric_alignment", {
    p_version: versionId,
    p_take: takeId,
  });
  expect(first.error).toBeNull();
  const second = await owner.rpc("request_lyric_alignment", {
    p_version: versionId,
    p_take: takeId,
  });
  expect(second.error).toBeNull();
  expect(second.data).toBe(first.data);
  const { data: job } = await service
    .from("jobs")
    .select("stage,payload")
    .eq("id", first.data)
    .single();
  expect(job).toMatchObject({
    stage: "align_lyrics",
    payload: { take_id: takeId },
  });
  await service
    .from("jobs")
    .update({ not_before: new Date(Date.now() + 86400000).toISOString() })
    .eq("id", first.data);
});

it("rejects another user and a take that is already aligned", async () => {
  expect(
    (
      await stranger.rpc("request_lyric_alignment", {
        p_version: versionId,
        p_take: takeId,
      })
    ).error,
  ).not.toBeNull();
  await service
    .from("takes")
    .update({
      lyric_timing: {
        source: "whisper",
        lines: [{ text: "Ciao mondo", start: 1, end: 3 }],
      },
    })
    .eq("id", takeId);
  expect(
    (
      await owner.rpc("request_lyric_alignment", {
        p_version: versionId,
        p_take: takeId,
      })
    ).error,
  ).not.toBeNull();
});
