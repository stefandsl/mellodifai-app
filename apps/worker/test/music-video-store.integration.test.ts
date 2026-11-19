import {
  type CutPlanLine,
  planCuts,
  planFromShotList,
  planShots,
} from "@mellodifai/shared";
import { createClient } from "@supabase/supabase-js";
import { expect, it } from "vitest";
import { SupabaseDb } from "../src/db.js";

function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required for storyboard integration`);
  return value;
}

function plan() {
  const beats = Array.from({ length: 200 }, (_, i) => i * 0.5);
  const lines: CutPlanLine[] = [];
  for (let t = 20, n = 0; t < 88; t += 4, n += 4)
    lines.push({
      section: t < 52 ? "Verse 1" : "Chorus",
      text: `w${n} w${n + 1} w${n + 2} w${n + 3}`,
      words: [0, 1, 2, 3].map((k) => ({
        w: `w${n + k}`,
        start: t + k * 0.9 + 0.05,
        end: t + k * 0.9 + 0.8,
      })),
    });
  const cut = planCuts({
    duration: 100,
    lines,
    sections: [
      { name: "Intro", start: 0, end: 20 },
      { name: "Verse 1", start: 20, end: 52 },
      { name: "Chorus", start: 52, end: 84 },
      { name: "Outro", start: 84, end: 100 },
    ],
    downbeats: beats.filter((_, i) => i % 4 === 0),
    beats,
  });
  return planFromShotList(cut, planShots(cut, { genre: "Italo-disco" }), {
    title: "Storyboard integration",
    language: "Italian",
  });
}

it("saves a plan, reads the storyboard and records takes through the service role", async () => {
  const url = required("SUPABASE_URL");
  const key = required("SUPABASE_SERVICE_ROLE_KEY");
  const service = createClient(url, key, { auth: { persistSession: false } });
  const email = `storyboard-integration-${crypto.randomUUID()}@example.test`;
  let owner: string | undefined;
  try {
    expect(
      (await service.from("admin_allowlist").insert({ email })).error,
    ).toBeNull();
    const user = await service.auth.admin.createUser({
      email,
      email_confirm: true,
    });
    expect(user.error).toBeNull();
    owner = user.data.user?.id;
    if (!owner) throw new Error("Fixture owner was not created");
    const project = await service
      .from("projects")
      .insert({ owner_id: owner, topic: "Storyboard integration" })
      .select("id")
      .single();
    expect(project.error).toBeNull();
    const version = await service
      .from("versions")
      .insert({ owner_id: owner, project_id: project.data?.id, lang: "it" })
      .select("id")
      .single();
    expect(version.error).toBeNull();
    const versionId = version.data?.id as string;
    const store = new SupabaseDb(url, key, owner).musicVideo;
    const expected = plan();
    const projectId = await store.savePlan(versionId, expected);
    const board = await store.storyboard(versionId);
    expect(board?.project).toMatchObject({ id: projectId, owner_id: owner });
    const shots = board?.scenes.flatMap((s) => s.shots) ?? [];
    expect(shots.map((s) => [s.start_frame, s.end_frame])).toEqual(
      expected.shots.map((s) => [s.start_frame, s.end_frame]),
    );
    const shot = shots[0];
    if (!shot) throw new Error("no shot");
    const fields = {
      shot_id: shot.id,
      phase: "draft" as const,
      model: "bytedance/seedance-2-5",
      prompt: "p",
      refs: ["images/costume-a.png"],
      params: { seconds: 10 },
      cost_credits: 340,
      gates: null,
      status: "done" as const,
    };
    const first = await store.addTake({ ...fields, chosen: true });
    const second = await store.addTake(fields);
    expect(await store.patchTake(second.id, { chosen: true })).toMatchObject({
      chosen: true,
      cost_credits: 340,
    });
    const takes = (await store.storyboard(versionId))?.scenes[0]?.shots[0]
      ?.takes;
    expect(takes?.map((t) => [t.id, t.chosen])).toEqual([
      [first.id, false],
      [second.id, true],
    ]);
    await expect(store.savePlan(versionId, expected)).rejects.toMatchObject({
      message: expect.stringMatching(/already has takes/),
    });
    expect(
      await store.storyboard("00000000-0000-4000-8000-00000000abcd"),
    ).toBeNull();
  } finally {
    if (owner) await service.auth.admin.deleteUser(owner);
    await service.from("admin_allowlist").delete().eq("email", email);
  }
});
