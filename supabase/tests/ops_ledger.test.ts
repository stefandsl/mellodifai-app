import { randomUUID } from "node:crypto";
import type { TransactionSql } from "postgres";
import { expect, it } from "vitest";
import { STAGE_RESOURCE_CLASS, STAGES } from "../../packages/shared/src/stages";
import { withRealCaps } from "./helpers/caps";
import { ownerSql } from "./helpers/pg";
import { actor, call } from "./helpers/token-fixture";

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

async function entry(
  tx: TransactionSql,
  reservation: string | null,
  key = randomUUID(),
  hours = 0.1,
) {
  const [r] =
    await tx`select ops.spend_entry_open(${reservation},${key},'groq','',${tx.json({ audio_hour: hours })}) id`;
  return r.id as string;
}
async function used(tx: TransactionSql, user: string) {
  const [r] =
    await tx`select coalesce(sum(used),0) used from public.spend_counters where scope='user' and key=${user} and unit='usd' and period='day'`;
  return Number(r.used);
}
it("spend_entry_open refuses with MDF07 when open plus settled estimates exceed the charge, and succeeds after extend_reservation (Major 8)", async () => {
  await fixture(async (tx) => {
    const j = await job(tx, "import_audio");
    const r = await reserve(tx, j.id);
    const e = await entry(tx, r, "first");
    expect(await entry(tx, r, "first")).toBe(e);
    await refused(tx, (sp) => entry(sp, r), "MDF07");
    await tx`select ops.settle_spend(${e},'{"audio_hour":0.01}')`;
    await refused(tx, (sp) => entry(sp, r), "MDF07");
    await tx`select ops.extend_reservation(${r},'groq','','{"audio_hour":0.1}')`;
    expect(await entry(tx, r)).toBeTruthy();
  });
});
it("settle_spend records an actual 5 times the estimate, flags over_estimate and charges the excess (Major 8)", async () => {
  await fixture(async (tx) => {
    const j = await job(tx, "import_audio");
    const r = await reserve(tx, j.id);
    const e = await entry(tx, r);
    await tx`update public.spend_caps set "limit"=0`;
    await tx`select ops.settle_spend(${e},'{"audio_hour":0.5}')`;
    const [row] =
      await tx`select usd,over_estimate,state from public.spend_entries where id=${e}`;
    expect(row).toMatchObject({ over_estimate: true, state: "settled" });
    expect(Number(row.usd)).toBe(0.05);
    expect(await used(tx, j.user)).toBe(0.05);
    await tx`update public.jobs set status='done' where id=${j.id}`;
    expect(await used(tx, j.user)).toBe(0.05);
  });
});
it("settle_spend rejects a negative amount; a second settle is a no-op", async () => {
  await fixture(async (tx) => {
    const j = await job(tx, "import_audio");
    const r = await reserve(tx, j.id);
    const e = await entry(tx, r);
    await refused(
      tx,
      (sp) => sp`select ops.settle_spend(${e},'{"audio_hour":0.1}',-1)`,
      "P0001",
    );
    await refused(
      tx,
      (sp) => sp`select ops.settle_spend(${e},'{"audio_hour":-1}')`,
      "P0001",
    );
    await tx`select ops.settle_spend(${e},'{"audio_hour":0.1}',0.02)`;
    await tx`select ops.settle_spend(${e},'{"audio_hour":1}',1)`;
    expect(await used(tx, j.user)).toBe(0.02);
  });
});
it("a job moving to done closes its reservation through the trigger (Major 9)", async () => {
  await fixture(async (tx) => {
    const j = await job(tx);
    const r = await reserve(tx, j.id);
    await entry(tx, r);
    await tx`select ops.close_reservation(${r})`;
    expect(
      (await tx`select state from public.reservations where id=${r}`)[0].state,
    ).toBe("open");
    await tx`update public.jobs set status='done' where id=${j.id}`;
    expect(
      (await tx`select state from public.reservations where id=${r}`)[0].state,
    ).toBe("closed");
    expect(await used(tx, j.user)).toBe(0.01);
    await tx`select ops.close_reservation(${r})`;
    expect(await used(tx, j.user)).toBe(0.01);
  });
});
it("close does not write a kie entry for a Groq-only resume job or a cancelled generate-again job (Major 6)", async () => {
  await fixture(async (tx) => {
    for (const resume of [true, false]) {
      const j = await job(tx);
      await tx`update public.versions set generation_count=2,kie_generation=${resume ? 2 : 1},kie_task_id='old',kie_submit_state='submitted' where id=${j.version}`;
      const r = await reserve(tx, j.id);
      await tx`update public.jobs set status='cancelled' where id=${j.id}`;
      expect(
        await tx`select id from public.spend_entries where reservation_id=${r}`,
      ).toHaveLength(0);
      expect(await used(tx, j.user)).toBe(0);
    }
  });
});
it("close writes the kie submit entry for a submitted kie job of the same generation", async () => {
  await fixture(async (tx) => {
    const j = await job(tx);
    const r = await reserve(tx, j.id);
    await tx`update public.versions set kie_task_id='accepted',kie_submit_state='submitted',kie_generation=generation_count where id=${j.version}`;
    await tx`update public.jobs set status='failed' where id=${j.id}`;
    const rows =
      await tx`select provider,state,usd from public.spend_entries where reservation_id=${r}`;
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ provider: "kie", state: "settled" });
    expect(Number(rows[0].usd)).toBe(0.06);
    expect(await used(tx, j.user)).toBe(0.06);
  });
});
it("a submitting kie job closes as ambiguous and keeps its charges", async () => {
  await fixture(async (tx) => {
    for (const mark of [false, true]) {
      const j = await job(tx);
      const r = await reserve(tx, j.id);
      await tx`update public.versions set kie_submit_state='submitting',kie_generation=generation_count where id=${j.version}`;
      if (mark) await tx`select ops.mark_ambiguous(${r})`;
      await tx`update public.jobs set status='failed' where id=${j.id}`;
      expect(
        (await tx`select state from public.reservations where id=${r}`)[0]
          .state,
      ).toBe("ambiguous");
      expect(await used(tx, j.user)).toBe(0.08);
    }
  });
});
it("two concurrent expiries close a reservation once (Nit 32)", async () => {
  const sql = ownerSql();
  const other = ownerSql();
  let user = "";
  let id: string | null = null;
  try {
    await withRealCaps(sql, async (tx) => {
      const j = await job(tx, "import_audio");
      user = j.user;
      id = await reserve(tx, j.id);
      await tx`delete from public.jobs where id=${j.id}`;
    });
    const results = await Promise.all([
      sql`select ops.expire_reservations() n`,
      other`select ops.expire_reservations() n`,
    ]);
    expect(results.reduce((n, r) => n + r[0].n, 0)).toBe(1);
    expect(
      (await sql`select state from public.reservations where id=${id}`)[0]
        .state,
    ).toBe("closed");
    expect(
      Number(
        (
          await sql`select used from public.spend_counters where scope='user' and key=${user}`
        )[0].used,
      ),
    ).toBe(0);
  } finally {
    if (user) {
      await sql`update public.spend_counters c set used=c.used-x.amount from (
        select scope,key,provider,unit,period,window_start,sum(amount) amount
        from public.reservations r,jsonb_to_recordset(r.charges) ch(scope text,key text,provider text,unit text,period text,window_start date,amount numeric)
        where r.user_id=${user} group by scope,key,provider,unit,period,window_start
      ) x where (c.scope,c.key,c.provider,c.unit,c.period,c.window_start)=(x.scope,x.key,x.provider,x.unit,x.period,x.window_start)`;
      await sql`delete from auth.users where id=${user}`;
      await sql`delete from public.admin_allowlist where email=${`${user}@example.test`}`;
      await sql`delete from public.spend_counters where key=${user}`;
    }
    await sql.end();
    await other.end();
  }
});
it("costs_get month caps report used from the month window (Nit 13) and list over_estimate entries", async () => {
  await fixture(async (tx) => {
    const ctx = await actor(tx);
    const j = await job(tx, "import_audio");
    // Use the fixture's authenticated owner for the read.
    await tx`update auth.sessions set user_id=${j.user} where id=${ctx.session_id}`;
    ctx.user_id = j.user;
    const r = await reserve(tx, j.id);
    const e = await entry(tx, r);
    await tx`select ops.settle_spend(${e},'{"audio_hour":0.5}')`;
    await tx`update public.spend_counters set used=7 where scope='global' and unit='usd' and period='month'`;
    await tx`grant mdf_web to postgres with set true`;
    const result = await call(tx, "mdf_web", "costs_get", [ctx, null, null]);
    expect(result.ok).toBe(true);
    expect(result.data.caps).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ scope: "global", period: "month", used: 7 }),
      ]),
    );
    expect(result.data.by_provider).toEqual([
      { provider: "groq", usd: 0.05, units: { audio_hour: 0.5 } },
    ]);
    expect(result.data.over_estimate).toEqual(
      expect.arrayContaining([expect.objectContaining({ id: e })]),
    );
    const invalid = await call(tx, "mdf_web", "costs_get", [
      ctx,
      "2026-01-01",
      "2026-03-01",
    ]);
    expect(invalid).toMatchObject({ ok: false, code: "validation" });
    const stranger = await actor(tx);
    const own = await call(tx, "mdf_web", "costs_get", [stranger, null, null]);
    expect(own.data.by_provider).toEqual([]);
    expect(own.data.over_estimate).toEqual([]);
  });
});
it("worker_enqueue copies token, run, fake flag and priority and raises MDF02 when the child cannot reserve", async () => {
  await fixture(async (tx) => {
    const j = await job(tx, "qa");
    const run = randomUUID();
    const [token] =
      await tx`insert into public.agent_tokens(owner_id,kind,name,token_hash,scopes) values (${j.user},'pat','child',${randomUUID()},'{read,spend}') returning id`;
    await tx`update public.jobs set token_id=${token.id},run_id=${run},fake_providers=true,priority=3 where id=${j.id}`;
    const key = randomUUID();
    const [child] =
      await tx`select ops.worker_enqueue(${j.id},${j.version},'import_audio',${key}) id`;
    expect(
      (
        await tx`select token_id,run_id,fake_providers,priority,resource_class from public.jobs where id=${child.id}`
      )[0],
    ).toEqual({
      token_id: token.id,
      run_id: run,
      fake_providers: true,
      priority: 3,
      resource_class: "net",
    });
    expect(
      (
        await tx`select ops.worker_enqueue(${j.id},${j.version},'import_audio',${key}) id`
      )[0].id,
    ).toBe(child.id);
    await tx`update public.jobs set fake_providers=false,token_id=null where id=${j.id}`;
    await tx`update public.spend_caps set "limit"=0`;
    const refusedKey = randomUUID();
    await refused(
      tx,
      (sp) =>
        sp`select ops.worker_enqueue(${j.id},${j.version},'import_audio',${refusedKey})`,
      "MDF02",
    );
    expect(
      await tx`select id from public.jobs where idempotency_key=${refusedKey}`,
    ).toHaveLength(0);
  });
});
it("expire_reservations never touches a queued or running job's reservation", async () => {
  await fixture(async (tx) => {
    for (const status of ["queued", "running"]) {
      const j = await job(tx);
      const r = await reserve(tx, j.id);
      await tx`update public.jobs set status=${status} where id=${j.id}`;
      await tx`update public.reservations set created_at=now()-interval '30 days' where id=${r}`;
      await tx`select ops.expire_reservations()`;
      expect(
        (await tx`select state from public.reservations where id=${r}`)[0]
          .state,
      ).toBe("open");
      expect(await used(tx, j.user)).toBe(0.08);
    }
  });
});
it("kie settlement charges actual credits and USD without releasing another provider's estimate", async () => {
  await fixture(async (tx) => {
    const j = await job(tx);
    const r = await reserve(tx, j.id);
    const [e] =
      await tx`select ops.spend_entry_open(${r},'kie:generate:1','kie','','{"credit":12}') id`;
    await tx`select ops.settle_spend(${e.id},'{"credit":60}')`;
    expect(await used(tx, j.user)).toBe(0.32);
    const [charged] =
      await tx`select sum((c->>'amount')::numeric) amount from public.reservations r,jsonb_array_elements(r.charges) c where r.id=${r} and c->>'unit'='credit'`;
    expect(Number(charged.amount)).toBe(60);
    await tx`update public.jobs set status='done' where id=${j.id}`;
    expect(await used(tx, j.user)).toBe(0.3);
    expect(
      await tx`select id from public.spend_entries where reservation_id=${r}`,
    ).toHaveLength(1);
  });
});
it("replacement close uses the reservation's edit, including after job deletion", async () => {
  await fixture(async (tx) => {
    const j = await job(tx, "replace_section");
    const [take] =
      await tx`insert into public.takes(owner_id,version_id) values (${j.user},${j.version}) returning id`;
    const [edit] =
      await tx`insert into public.section_edits(owner_id,version_id,take_id,engine,start_s,end_s,duration_s,section_lyrics,full_lyrics,old_lyrics) values (${j.user},${j.version},${take.id},'kie',0,15,60,'new','new','old') returning id`;
    await tx`update public.jobs set payload=jsonb_build_object('edit_id',${edit.id}::text) where id=${j.id}`;
    const r = await reserve(tx, j.id);
    await tx`update public.section_edits set kie_task_id='accepted',kie_submit_state='submitted' where id=${edit.id}`;
    await tx`delete from public.jobs where id=${j.id}`;
    await tx`select ops.expire_reservations()`;
    expect(await used(tx, j.user)).toBe(0.025);
    expect(
      (
        await tx`select items from public.spend_entries where reservation_id=${r}`
      )[0].items,
    ).toEqual({ credit: 5 });
  });
});
it("a late settlement after close replaces the open estimate with actual spend", async () => {
  await fixture(async (tx) => {
    const j = await job(tx, "import_audio");
    const r = await reserve(tx, j.id);
    const e = await entry(tx, r);
    await tx`update public.jobs set status='failed' where id=${j.id}`;
    expect(await used(tx, j.user)).toBe(0.01);
    await tx`select ops.settle_spend(${e},'{"audio_hour":0.5}')`;
    expect(await used(tx, j.user)).toBe(0.05);
    await tx`select ops.close_reservation(${r})`;
    expect(await used(tx, j.user)).toBe(0.05);
  });
});
it("close reconciles extensions across recorded windows and preserves other reservations", async () => {
  await fixture(async (tx) => {
    const j = await job(tx, "import_audio");
    const r = await reserve(tx, j.id);
    // Move this reservation's charges to yesterday, then extend in today's window.
    await tx`update public.spend_counters set window_start=window_start-1 where (scope,key,provider,unit,period,window_start) in (
      select scope,key,provider,unit,period,window_start from public.reservations r,jsonb_to_recordset(r.charges) c(scope text,key text,provider text,unit text,period text,window_start date) where r.id=${r})`;
    await tx`update public.reservations set charges=(select jsonb_agg(c || jsonb_build_object('window_start',(c->>'window_start')::date-1)) from jsonb_array_elements(charges) c) where id=${r}`;
    await tx`select ops.extend_reservation(${r},'groq','','{"audio_hour":0.1}')`;
    const e = await entry(tx, r);
    await tx`select ops.settle_spend(${e},'{"audio_hour":0.15}')`;
    await tx`update public.jobs set status='done' where id=${j.id}`;
    expect(await used(tx, j.user)).toBe(0.015);
    const rows =
      await tx`select used from public.spend_counters where scope='user' and key=${j.user} order by window_start`;
    expect(rows.map((x) => Number(x.used))).toEqual([0.01, 0.005]);
  });
});
it("new ledger functions have hardened worker grants and costs is web-only with read scope", async () => {
  await fixture(async (tx) => {
    for (const name of [
      "spend_entry_open",
      "settle_spend",
      "mark_ambiguous",
      "close_reservation",
      "expire_reservations",
      "worker_enqueue",
      "jobs_close_reservation",
      "_reconcile_spend",
      "costs_get",
    ]) {
      const [fn] =
        await tx`select p.prosecdef,p.proconfig,pg_get_userbyid(p.proowner) owner,
        has_function_privilege('service_role',p.oid,'execute') worker,has_function_privilege('mdf_web',p.oid,'execute') web,
        has_function_privilege('mdf_auth',p.oid,'execute') auth,has_function_privilege('anon',p.oid,'execute') anon,
        has_function_privilege('authenticated',p.oid,'execute') authenticated
        from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='ops' and p.proname=${name}`;
      expect(fn).toMatchObject({
        prosecdef: true,
        owner: "postgres",
        worker: name !== "costs_get",
        web: name === "costs_get",
        auth: false,
        anon: false,
        authenticated: false,
      });
      expect(fn.proconfig).toEqual(
        expect.arrayContaining(['search_path=""', "TimeZone=UTC"]),
      );
    }
    const ctx = await actor(tx);
    const tokenHash = randomUUID();
    const [token] =
      await tx`insert into public.agent_tokens(owner_id,kind,name,token_hash,scopes) values (${ctx.user_id},'pat','no read',${tokenHash},'{create}') returning id`;
    await tx`insert into public.spend_caps(scope,key,unit,period,"limit") values ('token',${token.id},'usd','day',1)`;
    await tx`grant mdf_web to postgres with set true`;
    expect(
      await call(tx, "mdf_web", "costs_get", [
        { actor_kind: "pat", token_hash: tokenHash },
      ]),
    ).toMatchObject({ ok: false, code: "forbidden_scope" });
    expect(await call(tx, "mdf_web", "costs_get", [{}])).toMatchObject({
      ok: false,
      code: "unauthorized",
    });
  });
});

it("fast writer has verified prices and opens a covered entry", async () => {
  await fixture(async (tx) => {
    const prices =
      await tx`select unit, usd_per_unit, verified from public.price_book
      where provider='openrouter' and model='anthropic/claude-sonnet-5.5' order by unit`;
    expect(
      prices.map((p) => ({ ...p, usd_per_unit: Number(p.usd_per_unit) })),
    ).toEqual([
      { unit: "mtok_in", usd_per_unit: 2, verified: true },
      { unit: "mtok_out", usd_per_unit: 10, verified: true },
    ]);
    const j = await job(tx, "draft_lyrics");
    const reservation = await reserve(tx, j.id);
    const [entry] =
      await tx`select ops.spend_entry_open(${reservation}, 'openrouter:writer:0:0:a1',
      'openrouter', 'anthropic/claude-sonnet-5.5', '{"mtok_in":0.008,"mtok_out":0.004}'::jsonb) as id`;
    expect(entry.id).toBeTruthy();
  });
});
