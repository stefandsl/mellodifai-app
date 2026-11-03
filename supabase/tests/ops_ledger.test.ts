import { randomUUID } from "node:crypto";
import type { TransactionSql } from "postgres";
import { expect, it } from "vitest";
import { STAGE_RESOURCE_CLASS, STAGES } from "../../packages/shared/src/stages";
import { withRealCaps } from "./helpers/caps";
import { ownerSql } from "./helpers/pg";
import { actor } from "./helpers/token-fixture";

async function fixture(fn: (tx: TransactionSql) => Promise<void>) {
  const sql = ownerSql();
  const rollback = new Error("rollback ledger fixture");
  try {
    await withRealCaps(sql, async (tx) => {
      await tx`update public.price_book set usd_per_unit=0.005 where provider='kie' and unit='credit'`;
      await tx`update public.price_book set usd_per_unit=0.1 where provider='groq' and unit='audio_hour'`;
      await fn(tx);
      throw rollback;
    }).catch((error: unknown) => {
      if (error !== rollback) throw error;
    });
  } finally {
    await sql.end();
  }
}
async function job(
  tx: TransactionSql,
  stage = "generate_song",
  role = "admin",
) {
  const ctx = await actor(tx, role);
  const [project] =
    await tx`insert into public.projects (owner_id, topic) values (${ctx.user_id}, 'ledger fixture') returning id`;
  const [version] =
    await tx`insert into public.versions (owner_id, project_id, lang) values (${ctx.user_id}, ${project.id}, 'it') returning id`;
  const [row] =
    await tx`insert into public.jobs (owner_id, version_id, stage, idempotency_key) values (${ctx.user_id}, ${stage === "lyrics_assist" ? null : version.id}, ${stage}, ${randomUUID()}) returning id`;
  return {
    id: row.id as string,
    version: version.id as string,
    project: project.id as string,
    user: ctx.user_id,
  };
}
async function reserve(tx: TransactionSql, id: string) {
  const [row] = await tx`select ops.reserve_job(${id}) as id`;
  return row.id as string | null;
}
async function refused(
  tx: TransactionSql,
  work: (sp: TransactionSql) => Promise<unknown>,
  code: string,
) {
  await expect(tx.savepoint(work)).rejects.toMatchObject({ code });
}
it("empty spend_caps: every paid path refuses with cap_exceeded reason no_cap", async () => {
  await fixture(async (tx) => {
    await tx`delete from public.spend_caps`;
    for (const stage of [
      "draft_lyrics",
      "generate_song",
      "import_audio",
      "timing",
    ]) {
      const j = await job(tx, stage);
      await refused(tx, (sp) => reserve(sp, j.id), "MDF06");
    }
    const [mapped] =
      await tx`select ops.map_error('MDF06', 'no_cap') as result`;
    expect(mapped.result).toEqual({ code: "cap_exceeded", reason: "no_cap" });
    expect(await tx`select id from public.reservations`).toHaveLength(0);
  });
});
it("20 parallel reservations on a fresh window stay within the cap", async () => {
  const sql = ownerSql();
  const clients = Array.from({ length: 20 }, () => ownerSql());
  let user = "";
  let run = "";
  let groqPrice = "";
  try {
    const ids = await withRealCaps(sql, async (tx) => {
      const [price] =
        await tx`select usd_per_unit from public.price_book where provider='groq' and model='' and unit='audio_hour'`;
      groqPrice = price.usd_per_unit;
      await tx`update public.price_book set usd_per_unit=0.1 where provider='groq' and model='' and unit='audio_hour'`;
      const j = await job(tx, "import_audio");
      user = j.user;
      run = randomUUID();
      await tx`insert into public.spend_caps (scope,key,unit,period,"limit") values ('run',${run},'usd','run',0.05)`;
      await tx`update public.jobs set run_id=${run} where id=${j.id}`;
      const ids = [j.id];
      for (let i = 1; i < 20; i++) {
        const [row] =
          await tx`insert into public.jobs (owner_id,version_id,stage,idempotency_key,run_id) values (${user},${j.version},'import_audio',${randomUUID()},${run}) returning id`;
        ids.push(row.id);
      }
      return ids;
    });
    const results = await Promise.allSettled(
      clients.map((client, i) =>
        withRealCaps(client, (tx) => reserve(tx, ids[i])),
      ),
    );
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(5);
    for (const r of results)
      if (r.status === "rejected")
        expect(r.reason).toMatchObject({ code: "MDF02" });
    const [counter] =
      await sql`select used from public.spend_counters where scope='run' and key=${run}`;
    expect(Number(counter.used)).toBe(0.05);
  } finally {
    if (user)
      await sql.begin(async (tx) => {
        // Undo only this fixture's charges, including shared global counters.
        await tx`update public.spend_counters c set used=c.used-x.amount from (
        select scope,key,provider,unit,period,window_start,sum(amount) amount
        from public.reservations r, jsonb_to_recordset(r.charges) as ch(scope text,key text,provider text,unit text,period text,window_start date,amount numeric)
        where r.user_id=${user} group by scope,key,provider,unit,period,window_start
      ) x where (c.scope,c.key,c.provider,c.unit,c.period,c.window_start)=(x.scope,x.key,x.provider,x.unit,x.period,x.window_start)`;
        await tx`delete from auth.users where id=${user}`;
        await tx`delete from public.admin_allowlist where email=${`${user}@example.test`}`;
        await tx`delete from public.spend_caps where key in (${user},${run})`;
        await tx`delete from public.spend_counters where key in (${user},${run})`;
        await tx`update public.price_book set usd_per_unit=${groqPrice} where provider='groq' and model='' and unit='audio_hour'`;
      });
    await Promise.all(clients.map((c) => c.end()));
    await sql.end();
  }
});
it("a missing price raises MDF05 and nothing is reserved", async () => {
  await fixture(async (tx) => {
    const j = await job(tx);
    await tx`delete from public.price_book where provider='kie'`;
    await refused(tx, (sp) => reserve(sp, j.id), "MDF05");
    expect(
      await tx`select id from public.reservations where job_id=${j.id}`,
    ).toHaveLength(0);
  });
});
it("the user's own row wins per (provider, unit, period); the role default applies otherwise", async () => {
  await fixture(async (tx) => {
    const j = await job(tx, "generate_song", "customer");
    await tx`insert into public.spend_caps (scope,key,provider,unit,period,"limit") values ('user',${j.user},'kie','credit','day',24)`;
    const id = await reserve(tx, j.id);
    const [r] =
      await tx`select charges from public.reservations where id=${id}`;
    expect(r.charges).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          scope: "user",
          key: j.user,
          provider: "kie",
          unit: "credit",
          amount: 12,
        }),
        expect.objectContaining({
          scope: "user",
          key: j.user,
          provider: "",
          unit: "usd",
          amount: 0.08,
        }),
      ]),
    );
    await tx`update public.spend_caps set "limit"=0 where scope='user' and key='default:customer' and unit='usd'`;
    await refused(
      tx,
      (sp) =>
        sp`select ops.extend_reservation(${id},'groq','', '{"audio_hour":0.1}')`,
      "MDF02",
    );
  });
});
it("reserve_job is idempotent per job: a second call returns the open reservation (Nit 4)", async () => {
  await fixture(async (tx) => {
    const j = await job(tx);
    const first = await reserve(tx, j.id);
    expect(await reserve(tx, j.id)).toBe(first);
    const [r] =
      await tx`select count(*)::int as n from public.reservations where job_id=${j.id}`;
    expect(r.n).toBe(1);
  });
});
it("generate_song with a task id from an older generation reserves kie (Major 5)", async () => {
  await fixture(async (tx) => {
    const j = await job(tx);
    await tx`update public.versions set kie_task_id='old', kie_generation=1,generation_count=2 where id=${j.version}`;
    const id = await reserve(tx, j.id);
    const [r] = await tx`select * from public.reservations where id=${id}`;
    expect(r).toMatchObject({ kie_submit_reserved: true, kie_generation: 2 });
    expect(r.estimate.map((e: { provider: string }) => e.provider)).toEqual([
      "kie",
      "groq",
    ]);
  });
});
it("a true resume (kie_generation = generation_count) reserves Groq only and kie_submit_reserved is false", async () => {
  await fixture(async (tx) => {
    const j = await job(tx);
    await tx`update public.versions set kie_task_id='current',kie_generation=generation_count where id=${j.version}`;
    const id = await reserve(tx, j.id);
    const [r] = await tx`select * from public.reservations where id=${id}`;
    expect(r.kie_submit_reserved).toBe(false);
    expect(r.estimate.map((e: { provider: string }) => e.provider)).toEqual([
      "groq",
    ]);
  });
});
it("window_start follows Europe/Rome across midnight and DST", async () => {
  await fixture(async (tx) => {
    for (const [instant, day, hour] of [
      ["2026-03-28T22:59:59Z", "2026-03-28", "23:59"],
      ["2026-03-28T23:30:00Z", "2026-03-29", "00:30"],
      ["2026-03-29T00:59:00Z", "2026-03-29", "01:59"],
      ["2026-03-29T01:00:00Z", "2026-03-29", "03:00"],
      ["2026-10-25T00:59:00Z", "2026-10-25", "02:59"],
      ["2026-10-25T01:00:00Z", "2026-10-25", "02:00"],
    ]) {
      const [r] =
        await tx`select ops._spend_window('day',${instant}::timestamptz)::text as day, to_char(${instant}::timestamptz at time zone 'Europe/Rome','HH24:MI') as hour`;
      expect(r).toEqual({ day, hour });
    }
    const [r] =
      await tx`select ops._spend_window('month','2026-03-31 22:30Z')::text as month,ops._spend_window('run',now())::text as run`;
    expect(r).toEqual({ month: "2026-04-01", run: "1970-01-01" });
  });
});
it("the seeded customer USD day cap is at least three times the draft_lyrics strong-writer estimate", async () => {
  await fixture(async (tx) => {
    const [r] =
      await tx`select (select "limit" from public.spend_caps where scope='user' and key='default:customer' and unit='usd' and period='day') as cap, sum(i.value::numeric*ops.price(p.provider,p.model,i.key)) as estimate from public.provider_operations p, jsonb_each_text(p.items) i where operation='draft_lyrics'`;
    expect(Number(r.cap)).toBeGreaterThanOrEqual(3 * Number(r.estimate));
    expect(Number(r.estimate)).toBeGreaterThan(0);
  });
});
it("tests that need fixed prices update the price rows explicitly (Nit 14)", async () => {
  await fixture(async (tx) => {
    const j = await job(tx, "import_audio");
    await tx`update public.price_book set usd_per_unit=0.2 where provider='groq' and unit='audio_hour'`;
    const id = await reserve(tx, j.id);
    const [r] =
      await tx`select estimate from public.reservations where id=${id}`;
    expect(r.estimate[0].usd).toBe(0.02);
    await tx`select ops.extend_reservation(${id},'groq','', '{"audio_hour":0.1}')`;
    const [extended] =
      await tx`select estimate,charges from public.reservations where id=${id}`;
    expect(extended.estimate).toHaveLength(2);
    expect(
      extended.charges
        .filter((c: { scope: string }) => c.scope === "user")
        .reduce((s: number, c: { amount: number }) => s + c.amount, 0),
    ).toBe(0.04);
    await tx`delete from public.spend_caps`;
    await refused(
      tx,
      (sp) =>
        sp`select ops.extend_reservation(${id},'groq','', '{"audio_hour":0.1}')`,
      "MDF06",
    );
  });
});
it("fake jobs, the fake stack and free stages bypass reservations; deletion marks an orphan", async () => {
  await fixture(async (tx) => {
    const j = await job(tx);
    await tx`update public.jobs set fake_providers=true where id=${j.id}`;
    expect(await reserve(tx, j.id)).toBeNull();
    await tx`update public.jobs set fake_providers=false where id=${j.id}`;
    await tx`set local mdf.force_caps='off'`;
    expect(await reserve(tx, j.id)).toBeNull();
    await tx`set local mdf.force_caps='on'`;
    expect(await reserve(tx, (await job(tx, "qa")).id)).toBeNull();
    const id = await reserve(tx, j.id);
    await tx`delete from public.jobs where id=${j.id}`;
    const [r] =
      await tx`select job_gone,job_id from public.reservations where id=${id}`;
    expect(r).toEqual({ job_gone: true, job_id: null });
  });
});
it("jobs_set_resource_class agrees with the shared map for every stage", async () => {
  await fixture(async (tx) => {
    for (const stage of STAGES) {
      const j = await job(tx, stage);
      const [r] =
        await tx`select resource_class from public.jobs where id=${j.id}`;
      expect(r.resource_class, stage).toBe(STAGE_RESOURCE_CLASS[stage]);
    }
  });
});

it("replace_section reserves the named edit only, fails closed, and skips local engines and resumes", async () => {
  await fixture(async (tx) => {
    const j = await job(tx, "replace_section");
    const [take] =
      await tx`insert into public.takes (owner_id,version_id) values (${j.user},${j.version}) returning id`;
    const [edit] =
      await tx`insert into public.section_edits (owner_id,version_id,take_id,engine,start_s,end_s,duration_s,section_lyrics,full_lyrics,old_lyrics) values (${j.user},${j.version},${take.id},'kie',0,15,60,'new','new','old') returning id`;
    await tx`update public.jobs set payload=jsonb_build_object('edit_id',${edit.id}::text) where id=${j.id}`;
    await tx
      .savepoint(async (sp) => {
        await sp`delete from public.spend_caps`;
        await refused(sp, (s) => reserve(s, j.id), "MDF06");
        // Restore seed caps by rolling back just this subtransaction.
        throw new Error("restore caps");
      })
      .catch((e: unknown) => {
        if (!(e instanceof Error) || e.message !== "restore caps") throw e;
      });
    const id = await reserve(tx, j.id);
    const [r] = await tx`select * from public.reservations where id=${id}`;
    expect(r).toMatchObject({
      section_edit_id: edit.id,
      kie_submit_reserved: true,
    });
    expect(r.estimate).toEqual([
      { provider: "kie", model: "", items: { credit: 5 }, usd: 0.025 },
    ]);
    await tx`update public.section_edits set kie_task_id='resume' where id=${edit.id}`;
    expect(await tx`select * from ops.job_spend_rule(${j.id})`).toHaveLength(0);
    await tx`update public.section_edits set kie_task_id=null,engine='ace-step' where id=${edit.id}`;
    expect(await tx`select * from ops.job_spend_rule(${j.id})`).toHaveLength(0);
  });
});
it("generation sources select their operation; local generation reserves only Groq and runs on GPU", async () => {
  await fixture(async (tx) => {
    const j = await job(tx);
    await tx`update public.provider_operations set items='{"credit":7}' where provider='kie' and operation='cover'`;
    await tx`update public.provider_operations set items='{"credit":9}' where provider='kie' and operation='extend'`;
    for (const [kind, credits] of [
      ["cover", 7],
      ["reference", 7],
      ["extend", 9],
    ] as const) {
      await tx`update public.projects set song_settings=jsonb_build_object('engine','kie','source',jsonb_build_object('mode',${kind}::text)) where id=${j.project}`;
      const [rule] =
        await tx`select * from ops.job_spend_rule(${j.id}) where provider='kie'`;
      expect(rule.items).toEqual({ credit: credits });
    }
    await tx`update public.projects set song_settings='{"engine":"ace-step"}' where id=${j.project}`;
    const rules = await tx`select * from ops.job_spend_rule(${j.id})`;
    expect(rules.map((r) => r.provider)).toEqual(["groq"]);
    const [local] =
      await tx`insert into public.jobs (owner_id,version_id,stage,idempotency_key) values (${j.user},${j.version},'generate_song',${randomUUID()}) returning resource_class`;
    expect(local.resource_class).toBe("gpu");
  });
});
it("token caps are mandatory; a refusal or invalid extension leaves every counter and reservation unchanged", async () => {
  await fixture(async (tx) => {
    const j = await job(tx, "import_audio");
    const [token] =
      await tx`insert into public.agent_tokens (owner_id,kind,name,token_hash,scopes) values (${j.user},'pat','ledger',${randomUUID()},'{read,spend}') returning id`;
    await tx`update public.jobs set token_id=${token.id} where id=${j.id}`;
    await refused(tx, (sp) => reserve(sp, j.id), "MDF06");
    await tx`insert into public.spend_caps (scope,key,unit,period,"limit") values ('token',${token.id},'usd','day',0.01)`;
    const id = await reserve(tx, j.id);
    const before =
      await tx`select * from public.spend_counters order by scope,key,provider,unit,period,window_start`;
    const [reservation] =
      await tx`select * from public.reservations where id=${id}`;
    await refused(
      tx,
      (sp) =>
        sp`select ops.extend_reservation(${id},'groq','','{"audio_hour":0.1}')`,
      "MDF02",
    );
    await refused(
      tx,
      (sp) =>
        sp`select ops.extend_reservation(${id},'missing','','{"call":1}')`,
      "MDF05",
    );
    for (const items of [{ audio_hour: -1 }, { audio_hour: "bad" }, {}, null]) {
      await refused(
        tx,
        (sp) =>
          sp`select ops.extend_reservation(${id},'groq','',${sp.json(items)})`,
        "P0001",
      );
    }
    expect(
      await tx`select * from public.spend_counters order by scope,key,provider,unit,period,window_start`,
    ).toEqual(before);
    expect(
      (await tx`select * from public.reservations where id=${id}`)[0],
    ).toEqual(reservation);
    await tx`update public.reservations set state='closed' where id=${id}`;
    await refused(tx, (sp) => reserve(sp, j.id), "P0001");
    await refused(
      tx,
      (sp) =>
        sp`select ops.extend_reservation(${id},'groq','','{"audio_hour":0.1}')`,
      "P0001",
    );
  });
});
it("price uses an exact model before the provider fallback and ledger functions are worker-only", async () => {
  await fixture(async (tx) => {
    await tx`insert into public.price_book (provider,model,unit,usd_per_unit,checked_on,source) values ('groq','exact','audio_hour',0.5,current_date,'test')`;
    const [prices] =
      await tx`select ops.price('groq','exact','audio_hour') exact,ops.price('groq','unknown','audio_hour') fallback`;
    expect(Number(prices.exact)).toBe(0.5);
    expect(Number(prices.fallback)).toBe(0.1);
    for (const fn of [
      "ops.reserve_job(uuid)",
      "ops.extend_reservation(uuid,text,text,jsonb)",
      "ops.price(text,text,text)",
      "ops.job_spend_rule(uuid)",
    ]) {
      const [r] =
        await tx`select has_function_privilege('service_role',${fn},'execute') worker,has_function_privilege('mdf_web',${fn},'execute') web,has_function_privilege('mdf_auth',${fn},'execute') auth,has_function_privilege('authenticated',${fn},'execute') cookie`;
      expect(r).toEqual({
        worker: true,
        web: false,
        auth: false,
        cookie: false,
      });
    }
    const tables =
      await tx`select relname,relrowsecurity from pg_class where relnamespace='public'::regnamespace and relname in ('price_book','provider_operations','spend_counters','reservations','spend_entries')`;
    expect(tables).toHaveLength(5);
    expect(tables.every((t) => t.relrowsecurity)).toBe(true);
  });
});
