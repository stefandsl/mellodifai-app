import { randomUUID } from "node:crypto";
import { expect, it } from "vitest";
import LYRICS from "../../packages/remake/test/fixtures/remake-lyrics.it.json";
import { withRealCaps } from "./helpers/caps";
import { ownerSql } from "./helpers/pg";
import { actor, call, fixture, hash } from "./helpers/token-fixture";

const start = ["https://youtu.be/49rDdMbXd_w", "49rDdMbXd_w", "it", null];
const operations = [
  ["remake_start", start],
  ["remake_edit", [randomUUID(), 0, [], null]],
  ["remake_regenerate_section", [randomUUID(), 0, "verse"]],
  ["remake_accept", [randomUUID(), 0, {}, {}, null]],
  ["remake_cancel", [randomUUID()]],
  ["remake_dismiss", [randomUUID()]],
  ["remake_retry", [randomUUID()]],
  ["lyrics_assist_request", ["write", "it", { title: "Test" }]],
  ["lyrics_assist_cancel", [randomUUID()]],
] as const;

it("review writes enforce test mode, revision and gates, then reserve the accepted song", async () => {
  await fixture(async (tx) => {
    const a = await actor(tx, "customer");
    const result = await call(tx, "mdf_web", "remake_start", [a, ...start]);
    const id = result.data.id;
    const [r] = await tx`select version_id from public.remakes where id=${id}`;
    await tx`update public.jobs set status='done' where version_id=${r.version_id}`;
    await tx`update public.remakes set stage='review',lyrics=${tx.json({ ...LYRICS, originality: { ...LYRICS.originality, phrase: { ...LYRICS.originality.phrase, ok: true } }, sections: LYRICS.sections.map((section) => ({ ...section, lines: section.lines.map((line) => ({ ...line, originality: { ...line.originality, flagged: false } })) })) })} where id=${id}`;
    await tx`update public.versions set test_run=true where id=${r.version_id}`;
    expect(
      await call(tx, "mdf_web", "remake_edit", [a, id, 0, [], "New title"]),
    ).toMatchObject({ code: "forbidden_scope" });
    await tx`update public.versions set test_run=false where id=${r.version_id}`;
    expect(
      await call(tx, "mdf_web", "remake_edit", [a, id, 99, [], "New title"]),
    ).toMatchObject({
      code: "conflict",
      details: { action_error: "conflict" },
    });
    const [revision] =
      await tx`select revision from public.remakes where id=${id}`;
    const edit = await call(tx, "mdf_web", "remake_edit", [
      a,
      id,
      revision.revision,
      [],
      "New title",
    ]);
    expect(edit).toMatchObject({
      ok: true,
      data: {
        revision: revision.revision + 1,
        jobs: [{ stage: "remake_rewrite" }],
      },
    });
    await tx`update public.jobs set status='done' where version_id=${r.version_id}`;
    await tx`update public.remakes set pending=null where id=${id}`;
    const section = LYRICS.sections.find((s) => s.lines.length > 0)?.id;
    expect(
      await call(tx, "mdf_web", "remake_regenerate_section", [
        a,
        id,
        edit.data.revision,
        section,
      ]),
    ).toMatchObject({
      ok: true,
      data: { jobs: [{ stage: "remake_rewrite" }] },
    });
    await tx`update public.jobs set status='done' where version_id=${r.version_id}`;
    const [text] =
      await tx`select public.remake_lyrics_text(lyrics) as lyrics from public.remakes where id=${id}`;
    const pack = {
      title: "Test",
      style: "pop",
      lyrics: text.lyrics,
      settings: {},
    };
    expect(
      await call(tx, "mdf_web", "remake_accept", [
        a,
        id,
        edit.data.revision,
        pack,
        { engine: "kie" },
        null,
      ]),
    ).toMatchObject({
      ok: true,
      data: { id: r.version_id, jobs: [{ stage: "generate_song" }] },
    });
    expect(await call(tx, "mdf_web", "remake_dismiss", [a, id])).toMatchObject({
      ok: true,
    });
  });
});

it("retry queues a failed remake stage through ops", async () => {
  await fixture(async (tx) => {
    const a = await actor(tx);
    const result = await call(tx, "mdf_web", "remake_start", [a, ...start]);
    const job = result.data.jobs[0];
    await tx`update public.jobs set status='failed' where id=${job.job_id}`;
    await tx`update public.versions set status='failed' where id=${job.version_id}`;
    await tx`update public.remakes set stage='failed' where id=${result.data.id}`;
    expect(
      await call(tx, "mdf_web", "remake_retry", [a, result.data.id]),
    ).toMatchObject({ ok: true, data: { jobs: [{ stage: "remake_ingest" }] } });
  });
});

it("lyric assistance reserves paid work and rolls back at the cap", async () => {
  const sql = ownerSql();
  const rollback = new Error("rollback fixture");
  try {
    await withRealCaps(sql, async (tx) => {
      await tx`grant mdf_web to postgres with set true`;
      const a = await actor(tx);
      const result = await call(tx, "mdf_web", "lyrics_assist_request", [
        a,
        "write",
        "it",
        { title: "Test" },
      ]);
      expect(result).toMatchObject({ ok: true });
      expect(
        await tx`select 1 from public.reservations where job_id=${result.data.jobs[0].job_id}`,
      ).toHaveLength(1);
      await call(tx, "mdf_web", "lyrics_assist_cancel", [a, result.data.id]);
      await tx`insert into public.spend_caps(scope,key,provider,unit,period,"limit") values('user',${a.user_id},'openrouter','usd','day',0)`;
      expect(
        await call(tx, "mdf_web", "lyrics_assist_request", [
          a,
          "write",
          "it",
          { title: "Second" },
        ]),
      ).toMatchObject({ ok: false, code: "cap_exceeded" });
      expect(
        await tx`select 1 from public.lyric_requests where owner_id=${a.user_id}`,
      ).toHaveLength(1);
      throw rollback;
    }).catch((error: unknown) => {
      if (error !== rollback) throw error;
    });
  } finally {
    await sql.end();
  }
});

it("all remake and lyrics wrappers enforce local sessions and restrict grants", async () => {
  await fixture(async (tx) => {
    const a = await actor(tx, "customer");
    for (const [name, args] of operations) {
      expect(
        await call(tx, "mdf_web", name, [{ ...a, remote: true }, ...args]),
      ).toMatchObject({ ok: false, code: "forbidden_scope" });
      expect(
        await call(tx, "mdf_web", name, [
          { ...a, session_id: randomUUID() },
          ...args,
        ]),
      ).toMatchObject({ ok: false, code: "unauthorized" });
      const [grants] =
        await tx`select has_function_privilege('authenticated',p.oid,'execute') as authenticated, has_function_privilege('anon',p.oid,'execute') as anon, has_function_privilege('mdf_web',p.oid,'execute') as web from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='ops' and p.proname=${name}`;
      expect(grants).toEqual({ authenticated: false, anon: false, web: true });
    }
  });
});

it("starts once, replays, enforces ownership and cancels through ops", async () => {
  await fixture(async (tx) => {
    const a = {
      ...(await actor(tx, "customer")),
      idempotency_key: randomUUID(),
      request_hash: hash("remake"),
    };
    const result = await call(tx, "mdf_web", "remake_start", [a, ...start]);
    expect(result).toMatchObject({
      ok: true,
      data: { id: expect.any(String), jobs: [{ stage: "remake_ingest" }] },
    });
    expect(await call(tx, "mdf_web", "remake_start", [a, ...start])).toEqual(
      result,
    );
    expect(
      await call(tx, "mdf_web", "remake_start", [
        { ...a, request_hash: hash("other") },
        ...start,
      ]),
    ).toMatchObject({ code: "idempotency_mismatch" });
    expect(
      await call(tx, "mdf_web", "remake_cancel", [
        await actor(tx),
        result.data.id,
      ]),
    ).toMatchObject({ code: "not_found" });
    expect(
      await call(tx, "mdf_web", "remake_cancel", [
        { ...a, idempotency_key: randomUUID() },
        result.data.id,
      ]),
    ).toMatchObject({ ok: true });
    expect(
      (await tx`select stage from public.remakes where id=${result.data.id}`)[0]
        .stage,
    ).toBe("cancelled");
    expect(
      (await tx`select current_setting('request.jwt.claim.sub',true) as sub`)[0]
        .sub,
    ).toBe("");
  });
});

it("lyrics requests are idempotent, owned and cancellable", async () => {
  await fixture(async (tx) => {
    const a = {
      ...(await actor(tx, "customer")),
      idempotency_key: randomUUID(),
      request_hash: hash("lyrics"),
    };
    const args = [a, "write", "it", { title: "Test" }];
    const result = await call(tx, "mdf_web", "lyrics_assist_request", args);
    expect(result).toMatchObject({
      ok: true,
      data: {
        id: expect.any(String),
        jobs: [{ stage: "lyrics_assist", version_id: null }],
      },
    });
    expect(await call(tx, "mdf_web", "lyrics_assist_request", args)).toEqual(
      result,
    );
    expect(
      await call(tx, "mdf_web", "lyrics_assist_request", [
        { ...a, idempotency_key: randomUUID() },
        ...args.slice(1),
      ]),
    ).toMatchObject({
      ok: false,
      code: "conflict",
      details: { action_error: "busy" },
    });
    expect(
      await call(tx, "mdf_web", "lyrics_assist_cancel", [
        await actor(tx),
        result.data.id,
      ]),
    ).toMatchObject({ code: "not_found" });
    expect(
      await call(tx, "mdf_web", "lyrics_assist_cancel", [
        { ...a, idempotency_key: randomUUID() },
        result.data.id,
      ]),
    ).toMatchObject({ ok: true });
    expect(
      (
        await tx`select status from public.jobs where id=${result.data.jobs[0].job_id}`
      )[0].status,
    ).toBe("cancelled");
  });
});
