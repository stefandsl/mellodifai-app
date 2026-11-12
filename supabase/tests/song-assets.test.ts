import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, expect, it } from "vitest";
import { localSupabaseUrl } from "../../apps/web/e2e/local-env";
import { opsRpc } from "./helpers/ops-call";

let db: SupabaseClient;
let client: SupabaseClient;
let owner: string;
beforeAll(async () => {
  const url = localSupabaseUrl(process.env.SUPABASE_URL, {});
  db = createClient(url, process.env.SUPABASE_SERVICE_ROLE_KEY ?? "");
  const email = `song-assets-${Date.now()}@example.test`;
  const password = "song-assets-local-test-password";
  const { data, error } = await db.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
  });
  expect(error).toBeNull();
  if (!data.user) throw new Error("Test user missing");
  owner = data.user.id;
  expect(
    (await db.from("profiles").upsert({ id: owner, email, role: "admin" }))
      .error,
  ).toBeNull();
  client = createClient(url, process.env.SUPABASE_ANON_KEY ?? "");
  expect(
    (await client.auth.signInWithPassword({ email, password })).error,
  ).toBeNull();
});
afterAll(async () => {
  if (owner) await db.auth.admin.deleteUser(owner);
});

it.each(["video_review", "approved", "published"])(
  "invalidates assets on a different take in %s",
  async (status) => {
    const project = await db
      .from("projects")
      .insert({ owner_id: owner, topic: "Take isolation" })
      .select()
      .single();
    expect(project.error).toBeNull();
    const version = await db
      .from("versions")
      .insert({
        owner_id: owner,
        project_id: project.data.id,
        lang: "fr",
        status,
        lyric_pack: {
          title: "Le port",
          lyrics: "Anciennes paroles",
          style: "pop",
        },
        storyboard_path: "old.json",
        storyboard_sections: [{ title: "Old", start: 0 }],
      })
      .select()
      .single();
    expect(version.error).toBeNull();
    const takes = await db
      .from("takes")
      .insert(
        [1, 2].map((n) => ({
          owner_id: owner,
          version_id: version.data.id,
          generation: version.data.generation_count,
          take_number: n,
          audio_preview_path: `take-${n}.mp3`,
          lyrics: n === 1 ? "Anciennes paroles" : "Nouvelles paroles",
        })),
      )
      .select();
    expect(takes.error).toBeNull();
    if (!takes.data) throw new Error("Test takes missing");
    const [first, second] = takes.data;
    expect(
      (
        await db
          .from("versions")
          .update({ chosen_take_id: first.id })
          .eq("id", version.data.id)
      ).error,
    ).toBeNull();
    const oldRender = await db
      .from("renders")
      .insert({
        owner_id: owner,
        version_id: version.data.id,
        kind: "master",
        render_attempt: version.data.render_attempt,
        qa_results: {
          assets: {
            chosen_take_id: first.id,
            lyric_pack: version.data.lyric_pack,
          },
        },
      })
      .select()
      .single();
    expect(oldRender.error).toBeNull();
    expect(
      (
        await opsRpc(client, "choose_take", {
          p_version: version.data.id,
          p_take: first.id,
        })
      ).error,
    ).toBeNull();
    expect(
      (
        await db
          .from("versions")
          .select("status")
          .eq("id", version.data.id)
          .single()
      ).data?.status,
    ).toBe(status);
    expect(
      (
        await opsRpc(client, "choose_take", {
          p_version: version.data.id,
          p_take: second.id,
        })
      ).error,
    ).toBeNull();
    const next = await db
      .from("versions")
      .select()
      .eq("id", version.data.id)
      .single();
    expect(next.data).toMatchObject({
      status: "producing",
      chosen_take_id: second.id,
      render_attempt: version.data.render_attempt + 1,
      storyboard_path: null,
      storyboard_sections: null,
      lyric_pack: { lyrics: "Nouvelles paroles" },
    });
    const jobs = await db
      .from("jobs")
      .select("stage,idempotency_key")
      .eq("version_id", version.data.id);
    expect(jobs.data).toContainEqual({
      stage: "timing",
      idempotency_key: `timing:${version.data.id}:${next.data.render_attempt}`,
    });
    const stored = await db
      .from("renders")
      .select("qa_results")
      .eq("id", oldRender.data.id)
      .single();
    expect(stored.data?.qa_results.assets.lyric_pack.lyrics).toBe(
      "Anciennes paroles",
    );
    expect(
      (
        await db.from("renders").insert({
          owner_id: owner,
          version_id: version.data.id,
          kind: "master",
          render_attempt: next.data.render_attempt,
        })
      ).error,
    ).toBeNull();
    expect(
      (await db.from("versions").update({ status }).eq("id", version.data.id))
        .error,
    ).toBeNull();
    expect(
      (
        await opsRpc(client, "choose_take", {
          p_version: version.data.id,
          p_take: first.id,
        })
      ).error,
    ).toBeNull();
    const restored = await db
      .from("versions")
      .select("status,render_attempt,lyric_pack")
      .eq("id", version.data.id)
      .single();
    expect(restored.data).toMatchObject({
      status: "producing",
      render_attempt: version.data.render_attempt + 2,
      lyric_pack: { lyrics: "Anciennes paroles" },
    });
  },
);
