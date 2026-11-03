import { randomUUID } from "node:crypto";
import type { TransactionSql } from "postgres";
import { expect, it } from "vitest";
import { ownerSql } from "./helpers/pg";
import {
  actor,
  call,
  fixture,
  grant,
  interaction,
} from "./helpers/token-fixture";

async function worker(tx: TransactionSql, name: string, args: unknown[] = []) {
  await tx`set local role service_role`;
  const [row] = await tx.unsafe(
    `select ops.${name}(${args.map((_, i) => `$${i + 1}`).join(",")}) as result`,
    args as never[],
  );
  await tx`reset role`;
  return row.result;
}

it("a stale claim older than 10 minutes is taken over", async () => {
  await fixture(async (tx) => {
    await tx`delete from public.scheduled_tasks`;
    await tx`insert into public.scheduled_tasks (name, interval_s, next_run_at, running_by, started_at) values
      ('stale', 300, now() - interval '1 hour', 'old', now() - interval '10 minutes 1 second'),
      ('fresh', 300, now() - interval '2 hours', 'busy', now() - interval '10 minutes'),
      ('future', 300, now() + interval '1 hour', null, null)`;
    expect(await worker(tx, "claim_scheduled_task", ["new"])).toBe("stale");
    const [row] =
      await tx`select running_by, started_at = now() as started from public.scheduled_tasks where name = 'stale'`;
    expect(row).toEqual({ running_by: "new", started: true });
    expect(await worker(tx, "claim_scheduled_task", ["other"])).toBeNull();
  });
});

it("only the claiming worker finishes", async () => {
  await fixture(async (tx) => {
    await tx`delete from public.scheduled_tasks`;
    await tx`insert into public.scheduled_tasks (name, interval_s, next_run_at) values ('task', 300, now())`;
    await worker(tx, "claim_scheduled_task", ["one"]);
    await worker(tx, "finish_scheduled_task", ["task", "two", true, null]);
    const [unchanged] =
      await tx`select running_by, next_run_at = now() as unchanged from public.scheduled_tasks where name = 'task'`;
    expect(unchanged).toEqual({ running_by: "one", unchanged: true });
    await worker(tx, "finish_scheduled_task", ["task", "one", false, "failed"]);
    const [failed] =
      await tx`select running_by, last_error, last_ok_at, next_run_at = now() + interval '300 seconds' as scheduled from public.scheduled_tasks where name = 'task'`;
    expect(failed).toEqual({
      running_by: null,
      last_error: "failed",
      last_ok_at: null,
      scheduled: true,
    });
    await tx`update public.scheduled_tasks set next_run_at = now() where name = 'task'`;
    await worker(tx, "claim_scheduled_task", ["one"]);
    await worker(tx, "finish_scheduled_task", ["task", "one", true, null]);
    const [ok] =
      await tx`select last_error, last_ok_at = now() as succeeded from public.scheduled_tasks where name = 'task'`;
    expect(ok).toEqual({ last_error: null, succeeded: true });
  });
});

it("a concurrent worker skips locked tasks", async () => {
  const other = ownerSql();
  const rollback = new Error("rollback concurrent scheduler");
  try {
    await fixture(async (tx) => {
      await tx`select name from public.scheduled_tasks where name <> 'purge_idempotency' for update`;
      await other
        .begin(async (second) => {
          await second`set local statement_timeout = '2s'`;
          await second`update public.scheduled_tasks set next_run_at = now(), running_by = null where name = 'purge_idempotency'`;
          expect(await worker(second, "claim_scheduled_task", ["second"])).toBe(
            "purge_idempotency",
          );
          throw rollback;
        })
        .catch((error: unknown) => {
          if (error !== rollback) throw error;
        });
    });
  } finally {
    await other.end();
  }
});

it("daily tasks use the Rome date for their next wall-clock run", async () => {
  await fixture(async (tx) => {
    await tx`delete from public.scheduled_tasks`;
    await tx`insert into public.scheduled_tasks (name, daily_at, next_run_at, running_by) values ('daily', '03:30', now(), 'worker')`;
    await worker(tx, "finish_scheduled_task", ["daily", "worker", true, null]);
    const [row] =
      await tx`select next_run_at = (((now() at time zone 'Europe/Rome')::date + 1 + daily_at) at time zone 'Europe/Rome') as correct from public.scheduled_tasks where name = 'daily'`;
    expect(row.correct).toBe(true);
    // Exercise the actual function body at Rome midnight and both DST changes.
    const [definition] =
      await tx`select pg_get_functiondef('ops.finish_scheduled_task(text,text,boolean,text)'::regprocedure) as body`;
    for (const [instant, expected] of [
      ["2026-03-28 23:30:00+00", "2026-03-30T01:30:00.000Z"],
      ["2026-03-28 12:00:00+00", "2026-03-29T01:30:00.000Z"],
      ["2026-10-24 12:00:00+00", "2026-10-25T02:30:00.000Z"],
    ]) {
      await tx.unsafe(
        definition.body.replaceAll("now()", `timestamptz '${instant}'`),
      );
      await tx`update public.scheduled_tasks set running_by = 'worker' where name = 'daily'`;
      await worker(tx, "finish_scheduled_task", [
        "daily",
        "worker",
        true,
        null,
      ]);
      const [next] =
        await tx`select next_run_at from public.scheduled_tasks where name = 'daily'`;
      expect(next.next_run_at.toISOString()).toBe(expected);
    }
  });
});

it("purge_oauth revokes token rows of consents that never bound a grant", async () => {
  await fixture(async (tx) => {
    const ctx = await actor(tx);
    const bound = await grant(tx, ctx);
    const flow = await interaction(tx, ctx);
    const consent = await call(tx, "mdf_web", "oauth_consent", [
      ctx,
      flow.uid,
      flow.nonce,
      ["read"],
      false,
    ]);
    expect(consent.ok).toBe(true);
    // A consumed consent can still be abandoned before binding its grant.
    await call(tx, "mdf_auth", "oauth_interaction_result", [
      flow.uid,
      flow.nonce,
    ]);
    await tx`update public.oauth_consents set created_at = now() - interval '1 day 1 second' where uid in (${bound.uid}, ${flow.uid})`;
    const fresh = await interaction(tx, ctx);
    const recent = await call(tx, "mdf_web", "oauth_consent", [
      ctx,
      fresh.uid,
      fresh.nonce,
      ["read"],
      false,
    ]);
    await worker(tx, "purge_oauth");
    const [token] =
      await tx`select revoked_at is not null as revoked from public.agent_tokens where id = ${consent.data.token_id}`;
    expect(token.revoked).toBe(true);
    expect(
      await tx`select uid from public.oauth_consents where uid = ${flow.uid}`,
    ).toHaveLength(0);
    expect(
      await tx`select uid from public.oauth_consents where uid = ${bound.uid}`,
    ).toHaveLength(1);
    const [kept] =
      await tx`select revoked_at from public.agent_tokens where id = ${recent.data.token_id}`;
    expect(kept.revoked_at).toBeNull();
  });
});

it("purges retain rows on the retention boundary", async () => {
  await fixture(async (tx) => {
    await tx`delete from public.idempotency_keys`;
    await tx`delete from public.audit_log`;
    await tx`delete from public.oauth_store`;
    for (const older of [true, false]) {
      const seconds = older ? 1 : 0;
      await tx`insert into public.idempotency_keys (actor_key, key, request_hash, state, created_at) values ('test', ${`key-${older}-123`}, 'hash', 'done', now() - interval '24 hours' - ${seconds} * interval '1 second')`;
      await tx`insert into public.audit_log (actor_kind, operation, args_hash, result, at) values ('worker', 'test', 'hash', 'ok', now() - interval '180 days' - ${seconds} * interval '1 second')`;
      await tx`insert into public.oauth_store (model, id_hash, payload, expires_at) values ('Session', ${`expired-${older}`}, '{}', now() - interval '1 hour' - ${seconds} * interval '1 second')`;
      await tx`insert into public.oauth_store (model, id_hash, payload, expires_at, consumed_at) values ('Session', ${`consumed-${older}`}, '{}', now() + interval '1 day', now() - interval '1 hour' - ${seconds} * interval '1 second')`;
    }
    await tx`insert into public.oauth_store (model, id_hash, payload) values ('Client', 'persistent', '{}')`;
    await worker(tx, "purge_idempotency");
    await worker(tx, "purge_audit");
    await worker(tx, "purge_oauth");
    expect(await tx`select * from public.idempotency_keys`).toHaveLength(1);
    expect(await tx`select * from public.audit_log`).toHaveLength(1);
    expect(
      (await tx`select id_hash from public.oauth_store order by id_hash`).map(
        (r) => r.id_hash,
      ),
    ).toEqual(["consumed-false", "expired-false", "persistent"]);
  });
});

it("purge_test_runs cancels jobs and trashes test versions older than 7 days", async () => {
  await fixture(async (tx) => {
    const ctx = await actor(tx);
    for (const [test, days, trash] of [
      [true, 8, true],
      [true, 7, false],
      [false, 8, false],
    ] as const) {
      const [project] =
        await tx`insert into public.projects (owner_id, topic) values (${ctx.user_id}, 'scheduler') returning id`;
      const [v] =
        await tx`insert into public.versions (owner_id, project_id, lang, test_run, created_at) values (${ctx.user_id}, ${project.id}, 'it', ${test}, now() - ${days} * interval '1 day') returning id`;
      for (const status of [
        "queued",
        "running",
        "done",
        "failed",
        "cancelled",
      ]) {
        await tx`insert into public.jobs (owner_id, version_id, stage, idempotency_key, status, heartbeat_at) values (${ctx.user_id}, ${v.id}, 'draft_lyrics', ${randomUUID()}, ${status}, now())`;
      }
      await worker(tx, "purge_test_runs");
      const [version] =
        await tx`select trashed_at is not null as trashed from public.versions where id = ${v.id}`;
      expect(version.trashed).toBe(trash);
      const jobs =
        await tx`select status, finished_at, heartbeat_at from public.jobs where version_id = ${v.id} order by created_at, id`;
      expect(jobs.filter((j) => j.status === "cancelled")).toHaveLength(
        trash ? 3 : 1,
      );
      expect(
        jobs.filter((j) => j.status === "done" || j.status === "failed"),
      ).toHaveLength(2);
      if (trash)
        expect(
          jobs.filter((j) => j.finished_at && j.heartbeat_at === null),
        ).toHaveLength(2);
      await worker(tx, "purge_test_runs");
    }
  });
});

it("seeds exactly the five M1 tasks with their cadences", async () => {
  await fixture(async (tx) => {
    const rows =
      await tx`select name, interval_s, daily_at::text from public.scheduled_tasks order by name`;
    expect(rows).toEqual([
      { name: "expire_reservations", interval_s: 300, daily_at: null },
      { name: "purge_audit", interval_s: null, daily_at: "03:30:00" },
      { name: "purge_idempotency", interval_s: 3600, daily_at: null },
      { name: "purge_oauth", interval_s: 3600, daily_at: null },
      { name: "purge_test_runs", interval_s: null, daily_at: "03:45:00" },
    ]);
  });
});

it("scheduler functions are hardened and granted only to service_role", async () => {
  await fixture(async (tx) => {
    const names = [
      "claim_scheduled_task",
      "finish_scheduled_task",
      "purge_idempotency",
      "purge_oauth",
      "purge_audit",
      "purge_test_runs",
    ];
    const rows =
      await tx`select p.oid, p.prosecdef, p.proconfig, pg_get_userbyid(p.proowner) as owner from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'ops' and p.proname = any(${names})`;
    expect(rows).toHaveLength(names.length);
    for (const row of rows) {
      expect(row.prosecdef).toBe(true);
      expect(row.owner).toBe("postgres");
      expect(row.proconfig).toEqual(
        expect.arrayContaining(['search_path=""', "TimeZone=UTC"]),
      );
      for (const role of [
        "anon",
        "authenticated",
        "mdf_web",
        "mdf_auth",
        "service_role",
      ]) {
        const [privilege] =
          await tx`select has_function_privilege(${role}, ${row.oid}::oid, 'EXECUTE') as allowed`;
        expect(privilege.allowed).toBe(role === "service_role");
      }
    }
  });
});
