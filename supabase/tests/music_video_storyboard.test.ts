import { randomUUID } from "node:crypto";
import type { TransactionSql } from "postgres";
import { expect, it } from "vitest";
import {
  type CutPlanLine,
  planCuts,
  planFromShotList,
  planShots,
  StoryboardSchema,
  takeQuote,
} from "../../packages/shared/src/music-video/index";
import { actor, call, fixture, hash } from "./helpers/token-fixture";

type Ctx = Record<string, unknown>;

// A 100 s song at 120 BPM: intro, verse, chorus, outro.
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
    title: "Va bene, passa",
    language: "Italian",
  });
}

async function song(tx: TransactionSql, ctx: Ctx) {
  const [project] =
    await tx`insert into public.projects(owner_id,topic) values(${ctx.user_id as string},'Storyboard fixture') returning id`;
  const [version] =
    await tx`insert into public.versions(owner_id,project_id,lang) values(${ctx.user_id as string},${project.id},'it') returning id`;
  const [saved] =
    await tx`select public.mv_save_plan(${version.id}, ${tx.json(plan() as never)}) as id`;
  return { version: version.id as string, project: saved.id as string };
}

async function token(tx: TransactionSql, ctx: object, scopes: string[]) {
  const token_hash = hash(randomUUID());
  const result = await call(tx, "mdf_web", "admin_token_create", [
    ctx,
    "Storyboard test",
    token_hash,
    "test",
    scopes,
    false,
    false,
    null,
  ]);
  expect(result.ok).toBe(true);
  return { actor_kind: "pat", token_hash, remote: false };
}
const keyed = (ctx: Ctx) => ({
  ...ctx,
  idempotency_key: randomUUID(),
  request_hash: hash(randomUUID()),
});

async function board(tx: TransactionSql, ctx: Ctx, version: string) {
  const result = await call(tx, "mdf_web", "music_video_storyboard", [
    ctx,
    version,
  ]);
  expect(result.ok).toBe(true);
  return StoryboardSchema.parse(result.data.storyboard);
}

it("saves the worker's plan and reads it back as the shared storyboard", async () => {
  await fixture(async (tx) => {
    const a = await actor(tx);
    const b = await actor(tx);
    const expected = plan();
    const { version, project } = await song(tx, a);
    const sb = await board(tx, a, version);
    expect(sb.project.id).toBe(project);
    expect(sb.project.cut_plan).toEqual(expected.project.cut_plan);
    const shots = sb.scenes.flatMap((s) => s.shots);
    expect(shots.map((s) => [s.start_frame, s.end_frame, s.lyrics])).toEqual(
      expected.shots.map((s) => [s.start_frame, s.end_frame, s.lyrics]),
    );
    expect(sb.scenes.map((s) => s.section)).toEqual(
      expected.scenes.map((s) => s.section),
    );
    const byId = new Map(sb.elements.map((e) => [e.id, e.key]));
    shots.forEach((shot, i) => {
      expect(shot.cast_ids.map((id) => byId.get(id))).toEqual(
        expected.shots[i]?.cast_keys,
      );
      expect(byId.get(shot.location_id ?? "")).toBe(
        expected.shots[i]?.location_key,
      );
    });
    // Another owner and the other test mode see nothing.
    expect(
      await call(tx, "mdf_web", "music_video_storyboard", [b, version]),
    ).toMatchObject({ ok: false, code: "not_found" });
    await tx`update public.versions set test_run=true where id=${version}`;
    expect(
      await call(tx, "mdf_web", "music_video_storyboard", [a, version]),
    ).toMatchObject({ ok: false, code: "not_found" });
  });
});

it("keeps edited elements on a new plan and refuses a new plan once a take exists", async () => {
  await fixture(async (tx) => {
    const a = await actor(tx);
    const { version } = await song(tx, a);
    const before = await board(tx, a, version);
    const element = before.elements[0];
    const edited = await call(tx, "mdf_web", "music_video_element_update", [
      a,
      element?.id,
      { name: "Lia", ref_asset_ids: [`${a.user_id}/mv/lia.png`] },
    ]);
    expect(edited).toMatchObject({
      ok: true,
      data: {
        element: { name: "Lia", ref_asset_ids: [`${a.user_id}/mv/lia.png`] },
      },
    });
    await tx`select public.mv_save_plan(${version}, ${tx.json(plan() as never)})`;
    const after = await board(tx, a, version);
    expect(after.elements.find((e) => e.id === element?.id)?.name).toBe("Lia");
    expect(after.scenes.flatMap((s) => s.shots)).toHaveLength(
      before.scenes.flatMap((s) => s.shots).length,
    );
    const shot = after.scenes[0]?.shots[0];
    expect(
      (
        await call(tx, "mdf_web", "music_video_take_request", [
          a,
          shot?.id,
          "draft",
        ])
      ).ok,
    ).toBe(true);
    await expect(
      tx.savepoint(
        (sp) =>
          sp`select public.mv_save_plan(${version}, ${sp.json(plan() as never)})`,
      ),
    ).rejects.toThrow(/already has takes/);
    // A plan whose cast names a location is refused as a whole.
    const bad = plan();
    const first = bad.shots[0];
    if (first) first.cast_keys = [first.location_key ?? ""];
    const [p2] =
      await tx`insert into public.projects(owner_id,topic) values(${a.user_id},'Bad plan') returning id`;
    const [v2] =
      await tx`insert into public.versions(owner_id,project_id,lang) values(${a.user_id},${p2.id},'it') returning id`;
    await expect(
      tx.savepoint(
        (sp) =>
          sp`select public.mv_save_plan(${v2.id}, ${sp.json(bad as never)})`,
      ),
    ).rejects.toThrow(/bad cast/);
  });
});

it("validates element and shot updates and keeps them to the owner", async () => {
  await fixture(async (tx) => {
    const a = await actor(tx);
    const b = await actor(tx);
    const { version } = await song(tx, a);
    const sb = await board(tx, a, version);
    const character = sb.elements.find((e) => e.kind === "character");
    const location = sb.elements.find((e) => e.kind === "location");
    const shot = sb.scenes[0]?.shots[0];
    const element = (ctx: Ctx, patch: unknown) =>
      call(tx, "mdf_web", "music_video_element_update", [
        ctx,
        character?.id,
        patch,
      ]);
    const update = (ctx: Ctx, patch: unknown) =>
      call(tx, "mdf_web", "music_video_shot_update", [ctx, shot?.id, patch]);
    for (const patch of [
      { lyrics: "other words" },
      { name: "" },
      { ref_asset_ids: [`${b.user_id}/mv/x.png`] },
      { ref_asset_ids: [`${a.user_id}/../x.png`] },
      {},
    ])
      expect(await element(a, patch), JSON.stringify(patch)).toMatchObject({
        ok: false,
        code: "validation",
      });
    expect(await element(b, { name: "x" })).toMatchObject({
      ok: false,
      code: "not_found",
    });
    for (const patch of [
      { lyrics: "other words" },
      { size: "giant" },
      { cast_ids: [location?.id] },
      { cast_ids: [randomUUID()] },
      { location_id: character?.id },
      { mood: "x".repeat(201) },
    ])
      expect(await update(a, patch), JSON.stringify(patch)).toMatchObject({
        ok: false,
        code: "validation",
      });
    expect(await update(b, { size: "wide" })).toMatchObject({
      ok: false,
      code: "not_found",
    });
    expect(
      await update(a, {
        size: "medium-close-up",
        angle: "low",
        movement: "push-in",
        lens: "50mm",
        mood: "defiant",
        cast_ids: [],
        location_id: null,
      }),
    ).toMatchObject({
      ok: true,
      data: {
        shot: {
          size: "medium-close-up",
          angle: "low",
          movement: "push-in",
          lens: "50mm",
          mood: "defiant",
          cast_ids: [],
          location_id: null,
        },
      },
    });
    await tx`insert into public.mv_takes(owner_id,shot_id,phase,model,cost_credits,status) values(${a.user_id},${shot?.id},'draft','m',0,'running')`;
    expect(await update(a, { size: "wide" })).toMatchObject({
      ok: false,
      code: "conflict",
    });
    // Tokens need the create scope and an idempotency key.
    const reader = await token(tx, a, ["read"]);
    expect(await element(keyed(reader), { name: "x" })).toMatchObject({
      ok: false,
      code: "forbidden_scope",
    });
    const writer = await token(tx, a, ["read", "create"]);
    expect(await element(writer, { name: "x" })).toMatchObject({
      ok: false,
      code: "validation",
    });
    const ctx = keyed(writer);
    expect(await element(ctx, { name: "Nina" })).toMatchObject({ ok: true });
    expect(await element(ctx, { name: "Nina" })).toMatchObject({ ok: true });
    expect(
      await element({ ...ctx, request_hash: hash("other") }, { name: "Nina" }),
    ).toMatchObject({ ok: false, code: "idempotency_mismatch" });
  });
});

it("quotes a take at the shared price without queueing or reserving anything", async () => {
  await fixture(async (tx) => {
    const a = await actor(tx);
    const { version } = await song(tx, a);
    const sb = await board(tx, a, version);
    const shot = sb.scenes.flatMap((s) => s.shots).at(-1);
    if (!shot) throw new Error("no shot");
    const counts = async () =>
      (
        await tx`select (select count(*) from public.jobs where owner_id=${a.user_id})::int as jobs,
          (select count(*) from public.reservations)::int as reservations`
      )[0];
    const before = await counts();
    const request = (phase: string) =>
      call(tx, "mdf_web", "music_video_take_request", [a, shot.id, phase]);
    const draft = await request("draft");
    const quote = takeQuote(shot, sb.project.fps, "draft");
    expect(draft).toMatchObject({
      ok: true,
      data: {
        shot_id: shot.id,
        phase: "draft",
        model: quote.model,
        status: "quoted",
        price: { credits: quote.credits, seconds: quote.seconds },
      },
    });
    expect((await request("draft")).data.take_id).toBe(draft.data.take_id);
    expect(await counts()).toEqual(before);
    expect(await request("final")).toMatchObject({
      ok: false,
      code: "conflict",
    });
    expect(await request("upscale")).toMatchObject({
      ok: false,
      code: "validation",
    });
    await tx`update public.mv_takes set status='done' where id=${draft.data.take_id}`;
    const final = takeQuote(shot, sb.project.fps, "final");
    expect(await request("final")).toMatchObject({
      ok: true,
      data: { model: final.model, price: { credits: final.credits } },
    });
    const takes = (await board(tx, a, version)).scenes
      .flatMap((s) => s.shots)
      .find((s) => s.id === shot.id)?.takes;
    expect(takes?.map((t) => [t.phase, t.status])).toEqual([
      ["draft", "done"],
      ["final", "quoted"],
    ]);
    expect(await counts()).toEqual(before);
  });
});

it("lets owners read storyboard rows but write none of them directly", async () => {
  await fixture(async (tx) => {
    const a = await actor(tx);
    const b = await actor(tx);
    const { version, project } = await song(tx, a);
    const shot = (await board(tx, a, version)).scenes[0]?.shots[0];
    const asUser = async <T>(
      user: Ctx,
      work: (sp: TransactionSql) => Promise<T>,
    ) => {
      try {
        return await tx.savepoint(async (sp) => {
          await sp`select set_config('request.jwt.claims',${JSON.stringify({ sub: user.user_id, role: "authenticated" })},true)`;
          await sp.unsafe("set local role authenticated");
          return await work(sp as unknown as TransactionSql);
        });
      } finally {
        await tx`reset role`;
      }
    };
    expect(
      await asUser(a, (sp) => sp`select id from public.mv_projects`),
    ).toEqual([{ id: project }]);
    expect(await asUser(b, (sp) => sp`select id from public.mv_shots`)).toEqual(
      [],
    );
    for (const write of [
      (sp: TransactionSql) =>
        sp`insert into public.mv_takes(owner_id,shot_id,phase,model,cost_credits) values(${a.user_id as string},${shot?.id as string},'draft','m',0)`,
      (sp: TransactionSql) =>
        sp`update public.mv_shots set size='wide' where id=${shot?.id as string}`,
      (sp: TransactionSql) => sp`delete from public.mv_elements`,
      (sp: TransactionSql) =>
        sp`select public.mv_save_plan(${version}, '{}'::jsonb)`,
    ])
      await expect(asUser(a, write)).rejects.toMatchObject({ code: "42501" });
    const grants = await tx`
      select p.proname, has_function_privilege('mdf_web', p.oid, 'EXECUTE') as web,
        has_function_privilege('authenticated', p.oid, 'EXECUTE') as auth,
        has_function_privilege('service_role', p.oid, 'EXECUTE') as service,
        p.prosecdef, p.proconfig
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where (n.nspname = 'ops' and p.proname like 'music_video_%')
        or (n.nspname = 'public' and p.proname like 'mv_%')
      order by p.proname`;
    expect(grants.map((g) => [g.proname, g.web, g.auth, g.service])).toEqual([
      ["music_video_element_update", true, false, false],
      ["music_video_plan_request", true, false, false],
      ["music_video_shot_update", true, false, false],
      ["music_video_storyboard", true, false, false],
      ["music_video_take_request", true, false, false],
      ["mv_save_plan", false, false, true],
      ["mv_storyboard_json", false, false, true],
    ]);
    for (const g of grants) {
      expect(g.prosecdef).toBe(true);
      expect(g.proconfig).toContain('search_path=""');
    }
  });
});
