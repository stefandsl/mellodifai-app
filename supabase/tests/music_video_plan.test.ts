import { randomUUID } from "node:crypto";
import type { TransactionSql } from "postgres";
import { expect, it } from "vitest";
import { MUSIC_VIDEO_PLAN_STATUSES } from "../../packages/shared/src/status";
import { actor, call, fixture, hash } from "./helpers/token-fixture";

type Ctx = Record<string, unknown>;

async function song(
  tx: TransactionSql,
  ctx: Ctx,
  status = "video_review",
  settings: object = {},
) {
  const [project] =
    await tx`insert into public.projects(owner_id,topic,song_settings) values(${ctx.user_id as string},'Music video plan fixture',${tx.json(settings as never)}) returning id`;
  const [version] =
    await tx`insert into public.versions(owner_id,project_id,lang,status) values(${ctx.user_id as string},${project.id},'it',${status}) returning id`;
  return { version: version.id as string, project: project.id as string };
}

async function token(tx: TransactionSql, ctx: object, scopes: string[]) {
  const token_hash = hash(randomUUID());
  const result = await call(tx, "mdf_web", "admin_token_create", [
    ctx,
    "Music video plan test",
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

it("queues one free music_video_plan job per render for an agent with the create scope", async () => {
  await fixture(async (tx) => {
    const a = await actor(tx);
    const pat = await token(tx, a, ["read", "create"]);
    const { version } = await song(tx, a);
    const first = await call(tx, "mdf_web", "music_video_plan_request", [
      keyed(pat),
      version,
    ]);
    expect(first).toMatchObject({ ok: true });
    expect(first.data.jobs).toHaveLength(1);
    expect(first.data.jobs[0]).toMatchObject({
      version_id: version,
      stage: "music_video_plan",
    });
    const [job] =
      await tx`select stage, status, resource_class, payload from public.jobs where id=${first.data.jobs[0].job_id}`;
    expect(job).toMatchObject({
      stage: "music_video_plan",
      status: "queued",
      resource_class: "cpu",
    });
    // Asking again for the same render gives the same job; the owner's session may ask too.
    const again = await call(tx, "mdf_web", "music_video_plan_request", [
      a,
      version,
    ]);
    expect(again.data.jobs[0].job_id).toBe(first.data.jobs[0].job_id);
    // A new render may plan again.
    await tx`update public.versions set render_attempt=render_attempt+1 where id=${version}`;
    const later = await call(tx, "mdf_web", "music_video_plan_request", [
      keyed(pat),
      version,
    ]);
    expect(later.data.jobs[0].job_id).not.toBe(first.data.jobs[0].job_id);
    // The plan costs nothing: no reservation estimates any spend for it.
    const reservations =
      await tx`select estimate, charges from public.reservations where job_id in ${tx([first.data.jobs[0].job_id, later.data.jobs[0].job_id])}`;
    for (const r of reservations) {
      expect(
        (r.estimate as { usd?: number }[]).every((e) => !e.usd),
        JSON.stringify(r.estimate),
      ).toBe(true);
      expect(r.charges).toEqual([]);
    }
  });
});

it("refuses the plan before the video, after a take, to other owners and without the scope", async () => {
  await fixture(async (tx) => {
    const a = await actor(tx);
    const b = await actor(tx);
    const reader = await token(tx, a, ["read"]);
    const writer = await token(tx, a, ["read", "create"]);
    const early = await song(tx, a, "takes_review");
    expect(
      await call(tx, "mdf_web", "music_video_plan_request", [
        keyed(writer),
        early.version,
      ]),
    ).toMatchObject({ ok: false, code: "conflict" });
    const { version } = await song(tx, a);
    expect(
      await call(tx, "mdf_web", "music_video_plan_request", [b, version]),
    ).toMatchObject({ ok: false, code: "not_found" });
    expect(
      await call(tx, "mdf_web", "music_video_plan_request", [
        keyed(reader),
        version,
      ]),
    ).toMatchObject({ ok: false, code: "forbidden_scope" });
    expect(
      await call(tx, "mdf_web", "music_video_plan_request", [writer, version]),
    ).toMatchObject({ ok: false, code: "validation" });
    // A storyboard with a take keeps its plan.
    const [project] =
      await tx`insert into public.mv_projects(owner_id,version_id,title,language,genre,fps,frames,cut_plan) values(${a.user_id as string},${version},'t','Italian','pop',30,300,'{}'::jsonb) returning id`;
    const [scene] =
      await tx`insert into public.mv_scenes(owner_id,project_id,position,section,section_kind,start_frame,end_frame) values(${a.user_id as string},${project.id},0,'Verse 1','verse',0,300) returning id`;
    const [shot] =
      await tx`insert into public.mv_shots(owner_id,project_id,scene_id,position,segment,start_frame,end_frame,kind,size,angle,movement,lens) values(${a.user_id as string},${project.id},${scene.id},0,0,0,300,'lipsync-single','close-up','eye-level','static','50mm') returning id`;
    await tx`insert into public.mv_takes(owner_id,shot_id,phase,model,cost_credits) values(${a.user_id as string},${shot.id},'draft','m',0)`;
    expect(
      await call(tx, "mdf_web", "music_video_plan_request", [
        keyed(writer),
        version,
      ]),
    ).toMatchObject({ ok: false, code: "conflict" });
    expect(
      await tx`select 1 from public.jobs where version_id in ${tx([early.version, version])}`,
    ).toHaveLength(0);
  });
});

it("allows the plan in exactly the shared statuses", async () => {
  await fixture(async (tx) => {
    const a = await actor(tx);
    const statuses = [
      "drafting",
      "lyrics_review",
      "song_queued",
      "takes_review",
      "audio_ready",
      "producing",
      "video_review",
      "approved",
      "publishing",
      "published",
      "failed",
    ];
    const allowed: string[] = [];
    for (const status of statuses) {
      const { version } = await song(tx, a, status);
      const result = await call(tx, "mdf_web", "music_video_plan_request", [
        a,
        version,
      ]);
      if (result.ok) allowed.push(status);
    }
    expect(allowed).toEqual([...MUSIC_VIDEO_PLAN_STATUSES]);
  });
});

it("reads the storyboard as an object, null before the plan", async () => {
  await fixture(async (tx) => {
    const a = await actor(tx);
    const { version } = await song(tx, a);
    expect(
      await call(tx, "mdf_web", "music_video_storyboard", [a, version]),
    ).toEqual({ ok: true, data: { storyboard: null } });
  });
});

it("R31: the owner's session saves the video choice until the take is chosen", async () => {
  await fixture(async (tx) => {
    const a = await actor(tx);
    const b = await actor(tx);
    const { version, project } = await song(tx, a, "lyrics_review", {
      model: "V6",
      video: "off",
    });
    const settings = async () =>
      (
        await tx`select song_settings from public.projects where id=${project}`
      )[0]?.song_settings;
    expect(
      await call(tx, "mdf_web", "song_video_set", [a, version, "lyric"]),
    ).toEqual({ ok: true, data: { version_id: version, video: "lyric" } });
    // The other settings stay as they were.
    expect(await settings()).toEqual({ model: "V6", video: "lyric" });
    for (const status of ["drafting", "song_queued", "takes_review"]) {
      await tx`update public.versions set status=${status} where id=${version}`;
      expect(
        await call(tx, "mdf_web", "song_video_set", [a, version, "off"]),
        status,
      ).toMatchObject({ ok: true });
    }
    expect(await settings()).toEqual({ model: "V6", video: "off" });
    expect(
      await call(tx, "mdf_web", "song_video_set", [a, version, "4k"]),
    ).toMatchObject({ ok: false, code: "validation" });
    expect(
      await call(tx, "mdf_web", "song_video_set", [b, version, "lyric"]),
    ).toMatchObject({ ok: false, code: "not_found" });
    const pat = await token(tx, a, ["read", "create", "spend"]);
    expect(
      await call(tx, "mdf_web", "song_video_set", [
        keyed(pat),
        version,
        "lyric",
      ]),
    ).toMatchObject({ ok: false });
    expect(
      await call(tx, "mdf_web", "song_video_set", [
        { ...a, remote: true },
        version,
        "lyric",
      ]),
    ).toMatchObject({ ok: false });
    await tx`update public.versions set status='audio_ready' where id=${version}`;
    expect(
      await call(tx, "mdf_web", "song_video_set", [a, version, "lyric"]),
    ).toMatchObject({ ok: false, code: "conflict" });
    expect(await settings()).toEqual({ model: "V6", video: "off" });
  });
});

it("keeps the lockdown: clients reach neither the plan request nor the project settings", async () => {
  await fixture(async (tx) => {
    const a = await actor(tx);
    const { version, project } = await song(tx, a, "video_review");
    for (const write of [
      (sp: TransactionSql) =>
        sp`select public.request_music_video_plan(${version})`,
      (sp: TransactionSql) =>
        sp`update public.projects set song_settings='{"video":"lyric"}'::jsonb where id=${project}`,
      (sp: TransactionSql) =>
        sp`insert into public.jobs(owner_id,version_id,stage,idempotency_key) values(${a.user_id as string},${version},'music_video_plan',${randomUUID()})`,
    ]) {
      try {
        await expect(
          tx.savepoint(async (sp) => {
            await sp`select set_config('request.jwt.claims',${JSON.stringify({ sub: a.user_id, role: "authenticated" })},true)`;
            await sp.unsafe("set local role authenticated");
            return await write(sp as unknown as TransactionSql);
          }),
        ).rejects.toMatchObject({ code: "42501" });
      } finally {
        await tx`reset role`;
      }
    }
    expect(
      await tx`select 1 from public.jobs where version_id=${version}`,
    ).toHaveLength(0);
  });
});
