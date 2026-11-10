import { randomUUID } from "node:crypto";
import type { TransactionSql } from "postgres";
import { afterAll, expect, it } from "vitest";
import { callOps, opsSql } from "../../apps/web/lib/db/ops-client";
import { assertTestWebStack } from "../../ops/test-db-guard";
import LYRICS from "../../packages/remake/test/fixtures/remake-lyrics.it.json";
import { ownerSql } from "./helpers/pg";
import { actor, call, fixture, hash } from "./helpers/token-fixture";

assertTestWebStack(process.env);
afterAll(async () => {
  await opsSql().end();
});

const start = ["https://youtu.be/49rDdMbXd_w", "49rDdMbXd_w", "it", null];
// The fixture lyrics with every originality gate passed.
const PASSING = {
  ...LYRICS,
  originality: {
    ...LYRICS.originality,
    phrase: { ...LYRICS.originality.phrase, ok: true },
  },
  sections: LYRICS.sections.map((section) => ({
    ...section,
    lines: section.lines.map((line) => ({
      ...line,
      originality: { ...line.originality, flagged: false },
    })),
  })),
};
const section = PASSING.sections.find((s) => s.lines.length > 0)?.id;

type Ctx = Record<string, unknown>;
async function token(
  tx: TransactionSql,
  ctx: object,
  scopes = ["read", "create", "spend"],
  options: { test?: boolean; remote?: boolean } = {},
) {
  const token_hash = hash(randomUUID());
  const result = await call(tx, "mdf_web", "admin_token_create", [
    ctx,
    "Remake test",
    token_hash,
    "test",
    scopes,
    options.remote ?? false,
    options.test ?? false,
    options.remote ? new Date(Date.now() + 86400000) : null,
  ]);
  expect(result.ok).toBe(true);
  return {
    actor_kind: "pat",
    token_hash,
    remote: false,
    request_hash: hash("request"),
  };
}
// A token call needs its own idempotency key; a cookie session may go without.
const keyed = (ctx: Ctx) =>
  ctx.actor_kind === "session"
    ? ctx
    : { ...ctx, idempotency_key: randomUUID() };

// A remake of the actor waiting in the review with lyrics that pass the gates.
async function review(tx: TransactionSql, ctx: Ctx, lyrics: object = PASSING) {
  const started = await call(tx, "mdf_web", "remake_start", [
    keyed(ctx),
    ...start,
  ]);
  expect(started).toMatchObject({ ok: true });
  const id = started.data.id as string;
  const version = started.data.jobs[0].version_id as string;
  await tx`update public.jobs set status='done' where version_id=${version}`;
  await tx`update public.remakes set stage='review',lyrics=${tx.json(lyrics as never)} where id=${id}`;
  return { id, version };
}
async function lyricsText(tx: TransactionSql, id: string) {
  const [row] =
    await tx`select public.remake_lyrics_text(lyrics) as text from public.remakes where id=${id}`;
  return row.text as string;
}
const pack = (lyrics: string) => ({
  title: "Test",
  style: "pop",
  lyrics,
  settings: {},
});
// The six operations on an existing remake, with arguments that would otherwise be accepted.
const onRemake = (id: string, lyrics: string) =>
  [
    ["remake_edit", [id, 0, [], "New title"], "spend"],
    ["remake_regenerate_section", [id, 0, section], "spend"],
    ["remake_accept", [id, 0, pack(lyrics), { engine: "kie" }, null], "spend"],
    ["remake_retry", [id], "spend"],
    ["remake_cancel", [id], "create"],
    ["remake_dismiss", [id], "create"],
  ] as const;
async function state(tx: TransactionSql, id: string) {
  const [row] =
    await tx`select r.stage,r.revision,r.pending,r.dismissed_at,v.status,
      (select count(*)::int from public.jobs j where j.version_id=v.id) as jobs,
      (select count(*)::int from public.reservations x where x.version_id=v.id) as reservations
    from public.remakes r join public.versions v on v.id=r.version_id where r.id=${id}`;
  return row;
}

it("a spend PAT starts a remake, needs a key and replays by it", async () => {
  await fixture(async (tx) => {
    const a = await actor(tx);
    const t = await token(tx, a);
    expect(await call(tx, "mdf_web", "remake_start", [t, ...start])).toEqual({
      ok: false,
      code: "validation",
      message: "idempotency key required",
      details: { reason: "idempotency_key_required" },
    });
    expect(
      await tx`select 1 from public.remakes where owner_id=${a.user_id}`,
    ).toHaveLength(0);
    const ctx = keyed(t);
    const result = await call(tx, "mdf_web", "remake_start", [ctx, ...start]);
    expect(result).toEqual({
      ok: true,
      data: {
        id: expect.any(String),
        jobs: [
          {
            job_id: expect.any(String),
            version_id: expect.any(String),
            stage: "remake_ingest",
          },
        ],
      },
    });
    expect(await call(tx, "mdf_web", "remake_start", [ctx, ...start])).toEqual(
      result,
    );
    expect(
      await call(tx, "mdf_web", "remake_start", [
        { ...ctx, request_hash: hash("other") },
        ...start,
      ]),
    ).toMatchObject({ ok: false, code: "idempotency_mismatch" });
    expect(
      await tx`select 1 from public.remakes where owner_id=${a.user_id}`,
    ).toHaveLength(1);
    const [job] = await tx`select j.token_id,j.fake_providers,v.test_run
      from public.jobs j join public.versions v on v.id=j.version_id where j.id=${result.data.jobs[0].job_id}`;
    const [stored] =
      await tx`select id from public.agent_tokens where token_hash=${t.token_hash}`;
    expect(job).toEqual({
      token_id: stored.id,
      fake_providers: false,
      test_run: false,
    });
    // The limits of the cookie flow apply to agents too: one running remake per person.
    expect(
      await call(tx, "mdf_web", "remake_start", [keyed(t), ...start]),
    ).toMatchObject({
      ok: false,
      code: "conflict",
      details: { action_error: "busy" },
    });
  });
});

it("a PAT without spend cannot start a remake and leaves nothing behind", async () => {
  await fixture(async (tx) => {
    const a = await actor(tx);
    const t = await token(tx, a, ["read", "create"]);
    const ctx = keyed(t);
    expect(await call(tx, "mdf_web", "remake_start", [ctx, ...start])).toEqual({
      ok: false,
      code: "forbidden_scope",
      message: "admin required",
      details: {},
    });
    for (const table of ["projects", "versions", "jobs", "remakes"] as const) {
      const rows = await tx.unsafe(
        `select 1 from public.${table} where owner_id=$1`,
        [a.user_id],
      );
      expect(rows, table).toHaveLength(0);
    }
    expect(
      await tx`select 1 from public.reservations where user_id=${a.user_id}`,
    ).toHaveLength(0);
    expect(
      await tx`select 1 from public.idempotency_keys where key=${ctx.idempotency_key as string}`,
    ).toHaveLength(0);
    expect(
      await tx`select result,error_code from public.audit_log where owner_id=${a.user_id} and operation='remake_start'`,
    ).toEqual([{ result: "error", error_code: "forbidden_scope" }]);
  });
});

it("a remote cookie session stays refused while a remote PAT follows ops._actor", async () => {
  await fixture(async (tx) => {
    const a = await actor(tx);
    expect(
      await call(tx, "mdf_web", "remake_start", [
        { ...a, remote: true },
        ...start,
      ]),
    ).toMatchObject({
      ok: false,
      code: "forbidden_scope",
      message: "admin required",
    });
    const local = await token(tx, a);
    const remote = await token(tx, a, undefined, { remote: true });
    await call(tx, "mdf_web", "admin_flag_set", [a, "remote_mcp", false]);
    for (const t of [local, remote])
      expect(
        await call(tx, "mdf_web", "remake_start", [
          keyed({ ...t, remote: true }),
          ...start,
        ]),
      ).toMatchObject({
        ok: false,
        code: "forbidden_scope",
        message: "remote access refused",
      });
    await call(tx, "mdf_web", "admin_flag_set", [a, "remote_mcp", true]);
    expect(
      await call(tx, "mdf_web", "remake_start", [
        keyed({ ...local, remote: true }),
        ...start,
      ]),
    ).toMatchObject({ ok: false, code: "forbidden_scope" });
    expect(
      await tx`select 1 from public.remakes where owner_id=${a.user_id}`,
    ).toHaveLength(0);
    expect(
      await call(tx, "mdf_web", "remake_start", [
        keyed({ ...remote, remote: true }),
        ...start,
      ]),
    ).toMatchObject({ ok: true, data: { jobs: [{ stage: "remake_ingest" }] } });
  });
});

it("a token only changes remakes of its own test mode", async () => {
  await fixture(async (tx) => {
    const a = await actor(tx);
    const live = await token(tx, a);
    const test = await token(tx, a, undefined, { test: true });
    const liveRemake = await review(tx, live);
    const testRemake = await review(tx, test);
    expect(
      await tx`select v.test_run,j.fake_providers from public.versions v join public.jobs j on j.version_id=v.id where v.id=${testRemake.version}`,
    ).toEqual([{ test_run: true, fake_providers: true }]);
    const text = await lyricsText(tx, liveRemake.id);
    const before = [
      await state(tx, liveRemake.id),
      await state(tx, testRemake.id),
    ];
    for (const [ctx, remake] of [
      [live, testRemake],
      [test, liveRemake],
      [a, testRemake],
    ] as const)
      for (const [name, args] of onRemake(remake.id, text))
        expect(
          await call(tx, "mdf_web", name, [keyed(ctx), ...args]),
          `${name} as ${ctx.actor_kind}`,
        ).toEqual({
          ok: false,
          code: "forbidden_scope",
          message: "test rule required",
          details: { reason: "test_rule" },
        });
    expect([
      await state(tx, liveRemake.id),
      await state(tx, testRemake.id),
    ]).toEqual(before);
    // The test token's own remake goes on with fake providers only.
    const edit = await call(tx, "mdf_web", "remake_edit", [
      keyed(test),
      testRemake.id,
      0,
      [],
      "New title",
    ]);
    expect(edit).toMatchObject({
      ok: true,
      data: { revision: 1, jobs: [{ stage: "remake_rewrite" }] },
    });
    expect(
      await tx`select fake_providers from public.jobs where id=${edit.data.jobs[0].job_id}`,
    ).toEqual([{ fake_providers: true }]);
  });
});

it("each remake operation needs its scope and a key from a token", async () => {
  await fixture(async (tx) => {
    const a = await actor(tx);
    const full = await token(tx, a);
    const noSpend = await token(tx, a, ["read", "create"]);
    const readOnly = await token(tx, a, ["read"]);
    const remake = await review(tx, a);
    const text = await lyricsText(tx, remake.id);
    const before = await state(tx, remake.id);
    for (const [name, args, scope] of onRemake(remake.id, text)) {
      expect(
        await call(tx, "mdf_web", name, [
          keyed(scope === "spend" ? noSpend : readOnly),
          ...args,
        ]),
        name,
      ).toEqual({
        ok: false,
        code: "forbidden_scope",
        message: "admin required",
        details: {},
      });
      expect(await call(tx, "mdf_web", name, [full, ...args]), name).toEqual({
        ok: false,
        code: "validation",
        message: "idempotency key required",
        details: { reason: "idempotency_key_required" },
      });
    }
    expect(await state(tx, remake.id)).toEqual(before);
    // Cancel and dismiss queue no paid work: create is enough.
    const accepted = await review(tx, a);
    await tx`update public.remakes set stage='accepted' where id=${accepted.id}`;
    expect(
      await call(tx, "mdf_web", "remake_dismiss", [
        keyed(noSpend),
        accepted.id,
      ]),
    ).toEqual({ ok: true, data: { jobs: [] } });
    expect((await state(tx, accepted.id)).dismissed_at).not.toBeNull();
    expect(
      await call(tx, "mdf_web", "remake_cancel", [keyed(noSpend), remake.id]),
    ).toEqual({ ok: true, data: { jobs: [] } });
    expect(await state(tx, remake.id)).toMatchObject({ stage: "cancelled" });
  });
});

it("a token edits, regenerates and accepts; changed text or a stale revision queue nothing", async () => {
  await fixture(async (tx) => {
    const a = await actor(tx);
    const t = await token(tx, a);
    const remake = await review(tx, t);
    const edit = await call(tx, "mdf_web", "remake_edit", [
      keyed(t),
      remake.id,
      0,
      [{ index: 0, text: "Una riga nuova" }],
      null,
    ]);
    expect(edit).toEqual({
      ok: true,
      data: {
        revision: 1,
        jobs: [
          {
            job_id: expect.any(String),
            version_id: remake.version,
            stage: "remake_rewrite",
          },
        ],
      },
    });
    // The worker's check: the pending edit lands in the lyrics.
    await tx`update public.jobs set status='done' where version_id=${remake.version}`;
    await tx`update public.remakes set pending=null where id=${remake.id}`;
    const regenerate = await call(tx, "mdf_web", "remake_regenerate_section", [
      keyed(t),
      remake.id,
      1,
      section,
    ]);
    expect(regenerate).toEqual({
      ok: true,
      data: {
        jobs: [
          {
            job_id: expect.any(String),
            version_id: remake.version,
            stage: "remake_rewrite",
          },
        ],
      },
    });
    await tx`update public.jobs set status='done' where version_id=${remake.version}`;
    const text = await lyricsText(tx, remake.id);
    const before = await state(tx, remake.id);
    const changed = `${text.slice(0, -1)}${text.endsWith("x") ? "y" : "x"}`;
    for (const [revision, lyrics, message] of [
      [1, changed, "lyrics differ from the reviewed ones"],
      [0, text, "conflict: the lyrics changed meanwhile"],
    ] as const) {
      const ctx = keyed(t);
      expect(
        await call(tx, "mdf_web", "remake_accept", [
          ctx,
          remake.id,
          revision,
          pack(lyrics),
          { engine: "kie" },
          null,
        ]),
      ).toEqual({
        ok: false,
        code: "conflict",
        message,
        details: { action_error: "conflict" },
      });
      expect(await state(tx, remake.id)).toEqual(before);
      expect(
        await tx`select 1 from public.idempotency_keys where key=${ctx.idempotency_key as string}`,
      ).toHaveLength(0);
    }
    expect(
      await tx`select 1 from public.jobs where version_id=${remake.version} and stage='generate_song'`,
    ).toHaveLength(0);
    const ctx = keyed(t);
    const accept = [ctx, remake.id, 1, pack(text), { engine: "kie" }, null];
    const accepted = await call(tx, "mdf_web", "remake_accept", accept);
    expect(accepted).toEqual({
      ok: true,
      data: {
        id: remake.version,
        jobs: [
          {
            job_id: expect.any(String),
            version_id: remake.version,
            stage: "generate_song",
          },
        ],
      },
    });
    expect(await call(tx, "mdf_web", "remake_accept", accept)).toEqual(
      accepted,
    );
    expect(await state(tx, remake.id)).toMatchObject({
      stage: "accepted",
      status: "song_queued",
    });
    expect(
      await tx`select 1 from public.jobs where version_id=${remake.version} and stage='generate_song'`,
    ).toHaveLength(1);
  });
});

it("a spend token retries a failed remake stage", async () => {
  await fixture(async (tx) => {
    const a = await actor(tx);
    const t = await token(tx, a);
    const noSpend = await token(tx, a, ["read", "create"]);
    const started = await call(tx, "mdf_web", "remake_start", [
      keyed(t),
      ...start,
    ]);
    const job = started.data.jobs[0];
    await tx`update public.jobs set status='failed' where id=${job.job_id}`;
    await tx`update public.versions set status='failed' where id=${job.version_id}`;
    await tx`update public.remakes set stage='failed' where id=${started.data.id}`;
    expect(
      await call(tx, "mdf_web", "remake_retry", [
        keyed(noSpend),
        started.data.id,
      ]),
    ).toMatchObject({ ok: false, code: "forbidden_scope" });
    expect(
      await call(tx, "mdf_web", "remake_retry", [keyed(t), started.data.id]),
    ).toEqual({
      ok: true,
      data: {
        jobs: [
          {
            job_id: expect.any(String),
            version_id: job.version_id,
            stage: "remake_ingest",
          },
        ],
      },
    });
    expect(await state(tx, started.data.id)).toMatchObject({
      stage: "ingest",
      status: "analysing",
    });
  });
});

it("two edits racing on one revision: one wins, the other gets a conflict", async () => {
  const sql = ownerSql();
  const token_hash = hash(randomUUID());
  let user: string | undefined;
  try {
    // Committed rows, so two connections can race; the owner calls ops directly (no role grant
    // may outlive the test).
    const remake = await sql.begin(async (tx) => {
      const a = await actor(tx);
      user = a.user_id;
      const [created] = await tx`select ops.admin_token_create(${tx.json(a)},
        'Remake race', ${token_hash}, 'test', array['read','create','spend'], false, true, null) as result`;
      expect(created.result.ok).toBe(true);
      const ctx = {
        actor_kind: "pat",
        token_hash,
        remote: false,
        idempotency_key: randomUUID(),
        request_hash: hash("request"),
      };
      const [started] =
        await tx`select ops.remake_start(${tx.json(ctx)}, ${start[0]}, ${start[1]}, ${start[2]}, null) as result`;
      expect(started.result).toMatchObject({ ok: true });
      const id = started.result.data.id as string;
      const version = started.result.data.jobs[0].version_id as string;
      await tx`update public.jobs set status='done' where version_id=${version}`;
      await tx`update public.remakes set stage='review',lyrics=${tx.json(PASSING as never)} where id=${id}`;
      return { id, version };
    });
    const results = await Promise.all(
      ["Prima versione", "Seconda versione"].map((text) =>
        callOps<{ revision: number; jobs: { stage: string }[] }>(
          "remake_edit",
          [
            {
              actor_kind: "pat",
              token_hash,
              remote: false,
              idempotency_key: randomUUID(),
              request_hash: hash(text),
            },
            remake.id,
            0,
            [{ index: 0, text }],
            null,
          ],
        ),
      ),
    );
    const won = results.filter((r) => r.ok);
    expect(won).toHaveLength(1);
    expect(won[0]).toMatchObject({
      data: { revision: 1, jobs: [{ stage: "remake_rewrite" }] },
    });
    expect(results.filter((r) => !r.ok)).toEqual([
      {
        ok: false,
        code: "conflict",
        message: "conflict: the lyrics changed meanwhile",
        details: { action_error: "conflict" },
      },
    ]);
    const [row] =
      await sql`select revision,jsonb_array_length(pending->'lines') as lines from public.remakes where id=${remake.id}`;
    expect(row).toEqual({ revision: 1, lines: 1 });
    expect(
      await sql`select 1 from public.jobs where version_id=${remake.version} and stage='remake_rewrite'`,
    ).toHaveLength(1);
  } finally {
    if (user) {
      await sql`delete from public.idempotency_keys where actor_key in (select 'pat:' || id::text from public.agent_tokens where owner_id=${user})`;
      await sql`delete from public.spend_caps where scope='token' and key in (select id::text from public.agent_tokens where owner_id=${user})`;
      await sql`delete from auth.users where id=${user}`;
      await sql`delete from public.admin_allowlist where email=${`${user}@example.test`}`;
    }
    await sql.end();
  }
});

const GET_KEYS = [
  "remake_id",
  "project_id",
  "version_id",
  "stage",
  "lang",
  "country",
  "video_id",
  "url",
  "error_code",
  "error",
  "revision",
  "pending",
  "gate_ok",
  "accept_ready",
  "analysis",
  "lyrics",
  "lyrics_text",
  "cost",
  "active_job",
  "failed_job",
  "untrusted",
  "created_at",
  "updated_at",
].sort();
// What an agent may see of stored lyrics: no source line, no literal translation, and the
// phrase gate's detail without the source line it quotes.
function shown(lyrics: typeof LYRICS) {
  const { literalTranslation: _, ...rest } = lyrics;
  return {
    ...rest,
    sections: lyrics.sections.map((s) => ({
      ...s,
      lines: s.lines.map(({ source: _source, ...line }) => line),
    })),
    originality: {
      ...lyrics.originality,
      phrase: {
        ...lyrics.originality.phrase,
        detail: lyrics.originality.phrase.detail.replace(
          / with ".*"$/u,
          " with a source line",
        ),
      },
    },
  };
}
const hasKey = (value: unknown, key: string): boolean =>
  Array.isArray(value)
    ? value.some((item) => hasKey(item, key))
    : value !== null && typeof value === "object"
      ? key in value || Object.values(value).some((item) => hasKey(item, key))
      : false;

it("remake_get shows the review to a read token without the source text", async () => {
  await fixture(async (tx) => {
    const a = await actor(tx);
    const reader = await token(tx, a, ["read"]);
    // The fixture as the worker stores it: source lines, a literal translation, one reused phrase.
    expect(LYRICS.literalTranslation?.length).toBeGreaterThan(0);
    expect(LYRICS.sections.flatMap((s) => s.lines)[0]?.source).toBeTruthy();
    expect(LYRICS.originality.phrase.detail).toContain(
      LYRICS.literalTranslation?.[8],
    );
    const remake = await review(tx, a, LYRICS);
    await tx`update public.remakes set analysis=${tx.json({ title: "Source title" })},cost=${tx.json({ analysisUsd: 0.01 })} where id=${remake.id}`;
    const got = await call(tx, "mdf_web", "remake_get", [reader, remake.id]);
    expect(got).toMatchObject({ ok: true });
    expect(Object.keys(got.data).sort()).toEqual(GET_KEYS);
    expect(got.data).toMatchObject({
      remake_id: remake.id,
      project_id: expect.any(String),
      version_id: remake.version,
      stage: "review",
      lang: "it",
      country: null,
      video_id: start[1],
      url: start[0],
      error_code: null,
      error: null,
      revision: 0,
      pending: false,
      gate_ok: false,
      accept_ready: false,
      analysis: { title: "Source title" },
      cost: { analysisUsd: 0.01 },
      active_job: null,
      failed_job: null,
      untrusted: true,
      created_at: expect.any(String),
      updated_at: expect.any(String),
    });
    expect(got.data.lyrics).toEqual(shown(LYRICS));
    expect(got.data.lyrics_text).toBe(await lyricsText(tx, remake.id));
    expect(hasKey(got.data, "source")).toBe(false);
    expect(hasKey(got.data, "literalTranslation")).toBe(false);
    expect(got.data.lyrics.originality.phrase.detail).toBe(
      '"nessuno mi sente qui" shares 3 words in a row with a source line',
    );

    // The gates passed: ready until an edit waits for its check or a job runs.
    await tx`update public.remakes set lyrics=${tx.json(PASSING as never)} where id=${remake.id}`;
    const ready = await call(tx, "mdf_web", "remake_get", [a, remake.id]);
    expect(ready.data).toMatchObject({ gate_ok: true, accept_ready: true });
    const edit = await call(tx, "mdf_web", "remake_edit", [
      a,
      remake.id,
      0,
      [{ index: 0, text: "Una riga nuova" }],
      null,
    ]);
    await tx`insert into public.job_events(owner_id,job_id,message,progress) values(${a.user_id},${edit.data.jobs[0].job_id},'check: gates',40)`;
    const waiting = await call(tx, "mdf_web", "remake_get", [
      reader,
      remake.id,
    ]);
    expect(waiting.data).toMatchObject({
      revision: 1,
      pending: true,
      gate_ok: true,
      accept_ready: false,
      active_job: {
        job_id: edit.data.jobs[0].job_id,
        stage: "remake_rewrite",
        status: "queued",
        mode: "check",
        progress: 40,
        message: "check: gates",
      },
    });
    await tx`update public.remakes set pending=null where id=${remake.id}`;
    expect(
      (await call(tx, "mdf_web", "remake_get", [reader, remake.id])).data,
    ).toMatchObject({ pending: false, accept_ready: false });
    await tx`update public.jobs set status='done' where version_id=${remake.version}`;
    expect(
      (await call(tx, "mdf_web", "remake_get", [reader, remake.id])).data,
    ).toMatchObject({ accept_ready: true, active_job: null });
    // A review whose song left the library can no longer be accepted.
    await tx`update public.versions set trashed_at=now() where id=${remake.version}`;
    expect(
      (await call(tx, "mdf_web", "remake_get", [reader, remake.id])).data,
    ).toMatchObject({ gate_ok: true, accept_ready: false });
    expect(
      await tx`select result,count(*)::int as calls from public.audit_log where owner_id=${a.user_id} and operation='remake_get' group by result`,
    ).toEqual([{ result: "ok", calls: 6 }]);
  });
});

it("remake_get answers in every stage and never returns source text", async () => {
  await fixture(async (tx) => {
    const a = await actor(tx);
    const reader = await token(tx, a, ["read"]);
    const started = await call(tx, "mdf_web", "remake_start", [a, ...start]);
    const id = started.data.id as string;
    const job = started.data.jobs[0];
    const get = async () => {
      const result = await call(tx, "mdf_web", "remake_get", [reader, id]);
      expect(result).toMatchObject({ ok: true, data: { untrusted: true } });
      expect(Object.keys(result.data).sort()).toEqual(GET_KEYS);
      expect(hasKey(result.data, "source")).toBe(false);
      expect(hasKey(result.data, "literalTranslation")).toBe(false);
      return result.data;
    };
    await tx`update public.jobs set status='running' where id=${job.job_id}`;
    await tx`insert into public.job_events(owner_id,job_id,message,progress) values(${a.user_id},${job.job_id},'ingest: audio',40)`;
    expect(await get()).toMatchObject({
      stage: "ingest",
      lyrics: null,
      lyrics_text: null,
      analysis: null,
      gate_ok: false,
      accept_ready: false,
      active_job: {
        job_id: job.job_id,
        stage: "remake_ingest",
        status: "running",
        mode: null,
        progress: 40,
        message: "ingest: audio",
      },
      failed_job: null,
    });
    for (const stage of ["analyse", "rewrite"]) {
      await tx`update public.remakes set stage=${stage} where id=${id}`;
      expect(await get()).toMatchObject({ stage, lyrics: null });
    }
    // A failure: the long error is cut and addresses and credentials are redacted.
    const error = `download failed at https://example.test/private?token=abc api_key=sk-secret ${"x".repeat(400)}`;
    await tx`update public.jobs set status='failed',error=${error},finished_at=now() where id=${job.job_id}`;
    await tx`update public.versions set status='failed' where id=${job.version_id}`;
    await tx`update public.remakes set stage='failed',error_code='failed',error=${error} where id=${id}`;
    const failed = await get();
    expect(failed).toMatchObject({
      stage: "failed",
      error_code: "failed",
      active_job: null,
      failed_job: { job_id: job.job_id, stage: "remake_ingest" },
      accept_ready: false,
    });
    for (const text of [failed.error, failed.failed_job.error]) {
      expect(text).toHaveLength(300);
      expect(text).toContain("download failed at [redacted]");
      expect(text).not.toContain("example.test");
      expect(text).not.toContain("sk-secret");
    }
    for (const stage of ["review", "accepted"]) {
      await tx`update public.remakes set stage=${stage},error_code=null,error=null,lyrics=${tx.json(LYRICS)} where id=${id}`;
      expect(await get()).toMatchObject({
        stage,
        lyrics: shown(LYRICS),
        accept_ready: false,
      });
    }
    // A cancelled remake stays readable although its song left the library.
    await tx`update public.remakes set stage='review' where id=${id}`;
    expect(await call(tx, "mdf_web", "remake_cancel", [a, id])).toMatchObject({
      ok: true,
    });
    expect(await get()).toMatchObject({
      stage: "cancelled",
      accept_ready: false,
    });
  });
});

it("remake reads need the read scope and show only the actor's own test mode", async () => {
  await fixture(async (tx) => {
    const a = await actor(tx);
    const b = await actor(tx);
    const live = await token(tx, a, ["read"]);
    const test = await token(tx, a, undefined, { test: true });
    const noRead = await token(tx, a, ["create", "spend"]);
    const other = await token(tx, b);
    const liveRemake = await review(tx, a);
    const testRemake = await review(tx, test);
    const notFound = {
      ok: false,
      code: "not_found",
      message: "owned remake required",
      details: { reason: null },
    };
    for (const [ctx, id] of [
      [b, liveRemake.id],
      [other, liveRemake.id],
      [test, liveRemake.id],
      [live, testRemake.id],
      [a, testRemake.id],
      [live, randomUUID()],
    ] as const)
      expect(await call(tx, "mdf_web", "remake_get", [ctx, id])).toEqual(
        notFound,
      );
    for (const [name, args] of [
      ["remake_get", [liveRemake.id]],
      ["remakes_list", []],
    ] as const) {
      expect(await call(tx, "mdf_web", name, [noRead, ...args])).toEqual({
        ok: false,
        code: "forbidden_scope",
        message: "admin required",
        details: { reason: null },
      });
      expect(
        await call(tx, "mdf_web", name, [
          { ...a, session_id: randomUUID() },
          ...args,
        ]),
      ).toMatchObject({ ok: false, code: "unauthorized" });
    }
    expect(
      await call(tx, "mdf_web", "remake_get", [test, testRemake.id]),
    ).toMatchObject({ ok: true, data: { remake_id: testRemake.id } });
    const ids = async (ctx: Ctx) =>
      (await call(tx, "mdf_web", "remakes_list", [ctx])).data.remakes.map(
        (r: { remake_id: string }) => r.remake_id,
      );
    expect(await ids(live)).toEqual([liveRemake.id]);
    expect(await ids(a)).toEqual([liveRemake.id]);
    expect(await ids(test)).toEqual([testRemake.id]);
    expect(await ids(other)).toEqual([]);
    expect(
      await tx`select operation,result,error_code,count(*)::int as calls from public.audit_log
        where owner_id=${a.user_id} and operation in ('remake_get','remakes_list') group by 1,2,3 order by 1,2,3`,
    ).toEqual([
      {
        operation: "remake_get",
        result: "error",
        error_code: "forbidden_scope",
        calls: 1,
      },
      {
        operation: "remake_get",
        result: "error",
        error_code: "not_found",
        calls: 4,
      },
      { operation: "remake_get", result: "ok", error_code: null, calls: 1 },
      {
        operation: "remakes_list",
        result: "error",
        error_code: "forbidden_scope",
        calls: 1,
      },
      { operation: "remakes_list", result: "ok", error_code: null, calls: 3 },
    ]);
  });
});

it("remakes_list is newest first, clamps its limit and leaves out dismissed and trashed remakes", async () => {
  await fixture(async (tx) => {
    const a = await actor(tx);
    const reader = await token(tx, a, ["read"]);
    const made: { id: string; version: string }[] = [];
    for (let i = 0; i < 5; i++) {
      const remake = await review(tx, a);
      // Distinct, known ages: the first is the oldest.
      await tx`update public.remakes set created_at=now() - make_interval(mins => ${10 - i}) where id=${remake.id}`;
      made.push(remake);
    }
    await tx`update public.remakes set lyrics=null,stage='failed',error_code='no_lyrics' where id=${made[1].id}`;
    await tx`update public.remakes set dismissed_at=now() where id=${made[2].id}`;
    await tx`update public.versions set trashed_at=now() where id=${made[3].version}`;
    const list = async (...args: unknown[]) =>
      call(tx, "mdf_web", "remakes_list", [reader, ...args]);
    const all = await list();
    expect(all).toMatchObject({ ok: true });
    expect(Object.keys(all.data)).toEqual(["remakes"]);
    expect(all.data.remakes).toEqual([
      {
        remake_id: made[4].id,
        project_id: expect.any(String),
        version_id: made[4].version,
        stage: "review",
        lang: "it",
        title: PASSING.title,
        error_code: null,
        created_at: expect.any(String),
        updated_at: expect.any(String),
      },
      {
        remake_id: made[1].id,
        project_id: expect.any(String),
        version_id: made[1].version,
        stage: "failed",
        lang: "it",
        title: null,
        error_code: "no_lyrics",
        created_at: expect.any(String),
        updated_at: expect.any(String),
      },
      expect.objectContaining({ remake_id: made[0].id }),
    ]);
    for (const [limit, count] of [
      [1, 1],
      [2, 2],
      [0, 1],
      [-5, 1],
      [100, 3],
      [100000, 3],
      [null, 3],
    ] as const)
      expect((await list(limit)).data.remakes, String(limit)).toHaveLength(
        count,
      );
    expect((await list(1)).data.remakes[0].remake_id).toBe(made[4].id);
    // More remakes than the cap: never more than 100 come back.
    await tx`insert into public.projects(id,owner_id,topic) select gen_random_uuid(),${a.user_id},'Bulk ' || n from generate_series(1,120) n`;
    await tx`insert into public.versions(owner_id,project_id,lang,status) select owner_id,id,'it','analysing' from public.projects where owner_id=${a.user_id} and topic like 'Bulk %'`;
    await tx`insert into public.remakes(owner_id,project_id,version_id,url,video_id,lang)
      select v.owner_id,v.project_id,v.id,${start[0]},${start[1]},'it' from public.versions v join public.projects p on p.id=v.project_id where p.owner_id=${a.user_id} and p.topic like 'Bulk %'`;
    expect((await list(100000)).data.remakes).toHaveLength(100);
    expect((await list()).data.remakes).toHaveLength(20);
  });
});

it("the agent remake reads have only the web grant and fixed definer settings", async () => {
  await fixture(async (tx) => {
    const functions =
      await tx`select p.oid,p.prosecdef,p.proconfig,pg_get_userbyid(p.proowner) as owner from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='ops' and p.proname in ('remake_get','remakes_list')`;
    expect(functions).toHaveLength(2);
    for (const fn of functions) {
      expect(fn).toMatchObject({ prosecdef: true, owner: "postgres" });
      expect(fn.proconfig).toContain('search_path=""');
      expect(fn.proconfig).toContain("TimeZone=UTC");
      for (const role of [
        "mdf_web",
        "mdf_auth",
        "service_role",
        "anon",
        "authenticated",
      ]) {
        const [grant] =
          await tx`select has_function_privilege(${role},${fn.oid}::oid,'execute') as allowed`;
        expect(grant.allowed).toBe(role === "mdf_web");
      }
    }
  });
});
