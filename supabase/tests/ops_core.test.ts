import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import postgres, { type TransactionSql } from "postgres";
import { afterAll, expect, it } from "vitest";
import { callOps, opsSql } from "../../apps/web/lib/db/ops-client";
import { ownerSql } from "./helpers/pg";

const sql = ownerSql();
afterAll(async () => {
  await sql.end();
  await opsSql().end();
});
const rollback = new Error("rollback fixture");
async function fixture(work: (tx: TransactionSql) => Promise<void>) {
  await expect(
    sql.begin(async (tx) => {
      await tx`grant mdf_web to postgres with set true`;
      await work(tx);
      throw rollback;
    }),
  ).rejects.toBe(rollback);
}
async function actor(tx: TransactionSql) {
  const user_id = randomUUID();
  const session_id = randomUUID();
  const email = `${user_id}@example.test`;
  await tx`insert into public.admin_allowlist (email) values (${email})`;
  await tx`insert into auth.users (id, email, email_confirmed_at) values (${user_id}, ${email}, now())`;
  await tx`insert into auth.sessions (id, user_id, created_at, refreshed_at) values (${session_id}, ${user_id}, now(), now())`;
  return { actor_kind: "session", user_id, session_id, remote: false };
}
async function begin(
  tx: TransactionSql,
  ctx: object,
  key = "test-key-001",
  hash = "hash",
) {
  const [row] =
    await tx`select ops.idem_begin(${tx.json(ctx)}, ${key}, ${hash}) as result`;
  return row.result;
}

it("creates mdf_web and mdf_auth only once and as nologin roles without memberships", async () => {
  const migration = readFileSync(
    new URL("../migrations/20261102000028_ops_layer.sql", import.meta.url),
    "utf8",
  );
  const roles = migration.slice(0, migration.indexOf("create schema"));
  expect(roles).toContain("nologin noinherit");
  await fixture(async (tx) => {
    await tx`select pg_advisory_xact_lock(600600)`;
    for (const role of ["mdf_web", "mdf_auth"]) {
      await tx.unsafe(`alter role ${role} rename to task14_saved_${role}`);
    }
    await tx.unsafe(roles);
    await tx.unsafe(roles);
    const rows =
      await tx`select rolcanlogin, rolinherit from pg_roles where rolname in ('mdf_web','mdf_auth')`;
    expect(rows).toEqual([
      { rolcanlogin: false, rolinherit: false },
      { rolcanlogin: false, rolinherit: false },
    ]);
    expect(
      await tx`select 1 from pg_auth_members where member in (select oid from pg_roles where rolname in ('mdf_web','mdf_auth'))`,
    ).toEqual([]);
  });
  expect(
    await sql`select rolcanlogin, rolinherit from pg_roles where rolname in ('mdf_web','mdf_auth')`,
  ).toEqual([
    { rolcanlogin: true, rolinherit: false },
    { rolcanlogin: true, rolinherit: false },
  ]);
});

it("health as mdf_web writes and reads back the heartbeat", async () => {
  await fixture(async (tx) => {
    await tx`delete from public.ops_health`;
    await tx`set local role mdf_web`;
    const [row] = await tx`select ops.health() as result`;
    expect(row.result).toMatchObject({
      ok: true,
      data: { db: "ok", ops: "ok" },
    });
    expect(row.result.data.schema).toMatch(/^202611/);
    await tx`reset role`;
    const [heartbeat] = await tx`select at from public.ops_health`;
    expect(heartbeat.at.toISOString()).toBe(
      new Date(row.result.data.at).toISOString(),
    );
  });
});

it("idem_begin returns new, replay, idempotency_mismatch and in_progress; takes over a 10-minute-old in_flight row", async () => {
  await fixture(async (tx) => {
    const ctx = await actor(tx);
    await tx`set local role mdf_web`;
    expect(await begin(tx, ctx)).toEqual({ ok: true, data: { status: "new" } });
    expect(await begin(tx, ctx)).toMatchObject({
      ok: false,
      code: "in_progress",
      retry_after: 2,
    });
    expect(await begin(tx, ctx, "test-key-001", "different")).toMatchObject({
      ok: false,
      code: "idempotency_mismatch",
    });
    await tx`reset role`;
    await tx`update public.idempotency_keys set created_at = now() - interval '10 minutes' where actor_key = ${`session:${ctx.user_id}`}`;
    await tx`set local role mdf_web`;
    expect(await begin(tx, ctx)).toEqual({ ok: true, data: { status: "new" } });
    await tx`reset role`;
    await tx`update public.idempotency_keys set state = 'done', response = '{"ok":true,"data":{"id":1}}' where actor_key = ${`session:${ctx.user_id}`}`;
    await tx`set local role mdf_web`;
    expect(await begin(tx, ctx)).toEqual({
      ok: true,
      data: { status: "replay", response: { ok: true, data: { id: 1 } } },
    });
  });
});

it("a refusal before work deletes the in_flight key (Nit 5)", async () => {
  await fixture(async (tx) => {
    const ctx = await actor(tx);
    await tx`insert into public.idempotency_keys (actor_key, key, request_hash, state) values (${`session:${ctx.user_id}`}, 'test-key-001', '', 'in_flight')`;
    // A refusal releases its matching in-flight key, never another request's key.
    expect(await begin(tx, ctx, "test-key-001", "")).toMatchObject({
      ok: false,
      code: "validation",
    });
    expect(
      await tx`select 1 from public.idempotency_keys where actor_key = ${`session:${ctx.user_id}`}`,
    ).toEqual([]);
  });
});

it("two provisioned mdf_web connections cannot open the same key twice", async () => {
  const ctx = await sql.begin(actor);
  const web = postgres(process.env.TEST_MDF_WEB_URL as string, { max: 2 });
  try {
    expect(await web`select current_user as role`).toEqual([
      { role: "mdf_web" },
    ]);
    const results = await Promise.all(
      [0, 1].map(async (index) => {
        if (index === 0)
          return callOps<{ status: string }>("idem_begin", [
            ctx,
            "parallel-key",
            "same-hash",
          ]);
        const [row] =
          await web`select ops.idem_begin(${web.json(ctx)}, 'parallel-key', 'same-hash') as result`;
        return row.result;
      }),
    );
    expect(
      results.filter((result) => result.ok && result.data.status === "new"),
    ).toHaveLength(1);
    expect(
      results.filter(
        (result) =>
          !result.ok &&
          result.code === "in_progress" &&
          result.retry_after === 2,
      ),
    ).toHaveLength(1);
  } finally {
    await web.end();
    await sql`delete from public.idempotency_keys where actor_key = ${`session:${ctx.user_id}`}`;
    await sql`delete from auth.users where id = ${ctx.user_id}`;
    await sql`delete from public.admin_allowlist where email = ${`${ctx.user_id}@example.test`}`;
  }
});

it("an ops function ignores a preset mdf.job_ctx and preset claims (Major 3)", async () => {
  await fixture(async (tx) => {
    const ctx = await actor(tx);
    for (const setting of [
      "mdf.job_ids",
      "mdf.job_ctx",
      "request.jwt.claim.sub",
      "request.jwt.claim.role",
      "request.jwt.claims",
    ]) {
      await tx`select set_config(${setting}, '{"fake_providers":true}', true)`;
    }
    await tx`set local role mdf_web`;
    expect(await begin(tx, ctx)).toMatchObject({ ok: true });
    const [row] =
      await tx`select current_setting('mdf.job_ids') as ids, current_setting('mdf.job_ctx') as ctx, current_setting('request.jwt.claim.sub') as sub, current_setting('request.jwt.claim.role') as role, current_setting('request.jwt.claims') as claims`;
    expect(row).toEqual({ ids: "", ctx: "", sub: "", role: "", claims: "" });
  });
});

it("session recency is compared in UTC under TimeZone Etc/GMT-14 (Major 3)", async () => {
  await fixture(async (tx) => {
    const ctx = await actor(tx);
    await tx`update auth.sessions set created_at = now() - interval '15 hours', refreshed_at = null where id = ${ctx.session_id}`;
    await tx`set local timezone = 'Etc/GMT-14'`;
    await tx`set local role mdf_web`;
    expect(await begin(tx, ctx)).toMatchObject({
      ok: false,
      code: "unauthorized",
    });
  });
});

it("mdf_web cannot update stack_settings; mdf.force_caps on turns caps on and nothing turns them off", async () => {
  await fixture(async (tx) => {
    expect(await tx`select fake_stack from public.stack_settings`).toEqual([
      { fake_stack: true },
    ]);
    await tx`set local role mdf_web`;
    await expect(
      tx.savepoint(async (sp) => {
        await sp`update public.stack_settings set fake_stack = true`;
      }),
    ).rejects.toMatchObject({ code: "42501" });
    await tx`reset role`;
    expect(await tx`select ops._fake_stack() as fake`).toEqual([
      { fake: true },
    ]);
    await tx`select set_config('mdf.force_caps', 'on', true)`;
    expect(await tx`select ops._fake_stack() as fake`).toEqual([
      { fake: false },
    ]);
    await tx`update public.stack_settings set fake_stack = false`;
    for (const value of ["off", "", "true"]) {
      await tx`select set_config('mdf.force_caps', ${value}, true)`;
      expect(await tx`select ops._fake_stack() as fake`).toEqual([
        { fake: false },
      ]);
    }
  });
});

it("resolves PAT identity from storage, refuses revoked and remote-disabled tokens, and seeds flags off", async () => {
  await fixture(async (tx) => {
    const ctx = await actor(tx);
    const [token] =
      await tx`insert into public.agent_tokens (owner_id, kind, name, token_hash, scopes) values (${ctx.user_id}, 'pat', 'test', ${randomUUID()}, array['read']) returning id, token_hash`;
    const pat = {
      actor_kind: "pat",
      token_hash: token.token_hash,
      user_id: randomUUID(),
      test_mode: true,
    };
    expect(await begin(tx, pat)).toMatchObject({ ok: true });
    expect(
      await tx`select actor_key from public.idempotency_keys where key = 'test-key-001'`,
    ).toContainEqual({ actor_key: `pat:${token.id}` });
    expect(await begin(tx, { ...pat, remote: true })).toMatchObject({
      ok: false,
      code: "forbidden_scope",
    });
    await tx`update public.agent_tokens set revoked_at = now() where id = ${token.id}`;
    expect(await begin(tx, pat)).toMatchObject({
      ok: false,
      code: "unauthorized",
    });
    await tx`set local role mdf_web`;
    const [flags] = await tx`select ops.flags() as result`;
    expect(flags.result).toEqual({
      ok: true,
      data: {
        remote_mcp: false,
        autopilot: false,
        auto_publish_public: false,
        loop_merge: false,
        premium: false,
      },
    });
  });
});

it("every ops function has a fixed owner, search path, timezone and a single role grant", async () => {
  const rows =
    await sql`select p.oid, p.prosecdef, p.proconfig, pg_get_userbyid(p.proowner) as owner from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'ops'`;
  expect(rows.length).toBeGreaterThan(0);
  for (const row of rows) {
    expect(row.prosecdef).toBe(true);
    expect(row.owner).toBe("postgres");
    expect(row.proconfig).toContain('search_path=""');
    expect(row.proconfig).toContain("TimeZone=UTC");
    const grants =
      await sql`select pg_get_userbyid(a.grantee) as role from pg_proc p, lateral aclexplode(p.proacl) a where p.oid = ${row.oid} and a.grantee <> p.proowner and a.privilege_type = 'EXECUTE'`;
    expect(grants).toHaveLength(1);
    expect(["mdf_web", "mdf_auth", "service_role"]).toContain(grants[0].role);
  }
});
