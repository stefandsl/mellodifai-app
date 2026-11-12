import { randomUUID } from "node:crypto";
import { expect, it } from "vitest";
import { opsCall } from "./helpers/ops-call";
import { ownerSql } from "./helpers/pg";
import { actor } from "./helpers/token-fixture";

it("opsCall passes a session context to an ops wrapper", async () => {
  const session = { userId: randomUUID(), sessionId: randomUUID() };
  for (const opts of [undefined, { realCaps: true }]) {
    const result = await opsCall(session, "songs_list", [], opts);
    expect(result).toMatchObject({ ok: false, code: "unauthorized" });
  }
});

it("opsCall accepts a valid session and realCaps rolls back work above its cap", async () => {
  const sql = ownerSql();
  const a = await sql.begin(async (tx) => {
    const a = await actor(tx);
    await tx`insert into public.spend_caps(scope,key,provider,unit,period,"limit") values('user',${a.user_id},'openrouter','usd','day',0)`;
    return a;
  });
  const session = { userId: a.user_id, sessionId: a.session_id };
  const args = ["write", "it", { title: "Helper cap test" }];
  try {
    expect(await opsCall(session, "songs_list", [])).toMatchObject({
      ok: true,
    });
    expect(
      await opsCall(session, "lyrics_assist_request", args, { realCaps: true }),
    ).toMatchObject({ ok: false, code: "cap_exceeded" });
    expect(
      await sql`select id from public.lyric_requests where owner_id=${a.user_id}`,
    ).toHaveLength(0);
    expect(
      await sql`select id from public.jobs where owner_id=${a.user_id}`,
    ).toHaveLength(0);
    expect(await opsCall(session, "lyrics_assist_request", args)).toMatchObject(
      { ok: true },
    );
    expect(
      await sql`select id from public.lyric_requests where owner_id=${a.user_id}`,
    ).toHaveLength(1);
  } finally {
    await sql`delete from auth.users where id=${a.user_id}`;
    await sql`delete from public.admin_allowlist where email=${`${a.user_id}@example.test`}`;
    await sql`delete from public.spend_caps where scope='user' and key=${a.user_id}`;
    await sql.end();
  }
});
