import { randomUUID } from "node:crypto";
import { afterAll, expect, it } from "vitest";
import { callOps, opsSql } from "../../apps/web/lib/db/ops-client";
import { newPat } from "../../apps/web/lib/ops/tokens";
import { ownerSql } from "./helpers/pg";
import { actor, call } from "./helpers/token-fixture";

const sql = ownerSql();
afterAll(async () => {
  await sql.end();
  await opsSql().end();
});

it("parallel token requests open one key, create one fake job and replay its response", async () => {
  const token = newPat();
  const session = await sql.begin(async (tx) => {
    await tx`grant mdf_web to postgres with set true`;
    const ctx = await actor(tx);
    const result = await call(tx, "mdf_web", "admin_token_create", [
      ctx,
      "Task 39 concurrency",
      token.hash,
      token.hint,
      ["read", "spend"],
      false,
      true,
      null,
    ]);
    expect(result.ok).toBe(true);
    return ctx;
  });
  const key = randomUUID();
  const ctx = {
    actor_kind: "pat",
    token_hash: token.hash,
    remote: false,
    request_id: randomUUID(),
    idempotency_key: key,
    request_hash: "same-validated-request",
  };
  try {
    const results = await Promise.all(
      [0, 1].map(() =>
        callOps<{ status: string }>("idem_begin", [ctx, key, ctx.request_hash]),
      ),
    );
    expect(results.filter((r) => r.ok && r.data.status === "new")).toHaveLength(
      1,
    );
    expect(
      results.filter(
        (r) => !r.ok && r.code === "in_progress" && r.retry_after === 2,
      ),
    ).toHaveLength(1);
    const result = await callOps<{
      project_id: string;
      jobs: { job_id: string }[];
    }>("song_create", [
      ctx,
      {
        mode: "simple",
        prompt: "Task 39 fake job",
        lyrics: "",
        styles: "",
        languages: ["it"],
        vocalGender: null,
        settings: { engine: "kie" },
        count: 1,
      },
    ]);
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("Fake song creation failed");
    expect(result.data.jobs).toHaveLength(1);
    expect(
      await sql`select fake_providers from public.jobs where owner_id=${session.user_id}`,
    ).toEqual([{ fake_providers: true }]);
    expect(await callOps("idem_begin", [ctx, key, ctx.request_hash])).toEqual({
      ok: true,
      data: { status: "replay", response: result },
    });
  } finally {
    await sql`delete from public.idempotency_keys where key=${key} and actor_key in (select 'pat:' || id::text from public.agent_tokens where owner_id=${session.user_id})`;
    await sql`delete from public.spend_caps where scope='token' and key in (select id::text from public.agent_tokens where owner_id=${session.user_id})`;
    await sql`delete from auth.users where id=${session.user_id}`;
    await sql`delete from public.admin_allowlist where email=${`${session.user_id}@example.test`}`;
  }
});
