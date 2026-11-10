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
