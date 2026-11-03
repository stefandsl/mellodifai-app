import { randomUUID } from "node:crypto";
import type { TransactionSql } from "postgres";
import { expect, it } from "vitest";
import {
  CookieCreateSongInput,
  CreateSongInput,
} from "../../packages/shared/src/ops/inputs";
import {
  CostsSummary,
  JobEvent,
  JobStatus,
  SongDetail,
  SongSummary,
} from "../../packages/shared/src/ops/reads";
import { withRealCaps } from "./helpers/caps";
import { ownerSql } from "./helpers/pg";
import { actor, call, fixture, hash } from "./helpers/token-fixture";

const create = {
  mode: "simple",
  prompt: "Wrapper test",
  lyrics: "",
  styles: "",
  languages: ["it"],
  vocalGender: null,
  settings: { engine: "kie" },
  count: 1,
};
async function song(tx: TransactionSql, user: string, status = "failed") {
  const [p] =
    await tx`insert into public.projects(owner_id,topic) values(${user},'Wrapper fixture') returning id`;
  const [v] =
    await tx`insert into public.versions(owner_id,project_id,lang,status) values(${user},${p.id},'it',${status}) returning id`;
  return v.id as string;
}
async function token(
  tx: TransactionSql,
  ctx: object,
  scopes = ["read", "create", "spend"],
  test = false,
) {
  const token_hash = hash(randomUUID());
  const result = await call(tx, "mdf_web", "admin_token_create", [
    ctx,
    "Wrapper test",
    token_hash,
    "test",
    scopes,
    false,
    test,
    null,
  ]);
  expect(result.ok).toBe(true);
  return {
    actor_kind: "pat",
    token_hash,
    idempotency_key: randomUUID(),
    request_hash: hash("request"),
  };
}
it("claim injection cannot act on user B through lyrics_back, song_get, songs_list, job_status or costs_get", async () => {
  await fixture(async (tx) => {
    const a = await actor(tx);
    const b = await actor(tx);
    const version = await song(tx, b.user_id);
    const [job] =
      await tx`insert into public.jobs(owner_id,version_id,stage,idempotency_key) values(${b.user_id},${version},'timing',${randomUUID()}) returning id`;
    const [reservation] =
      await tx`insert into public.reservations(user_id,version_id,estimate) values(${b.user_id},${version},'[]') returning id`;
    await tx`insert into public.spend_entries(reservation_id,call_key,provider,items_est,usd_est,items,usd,state,settled_at) values(${reservation.id},'fixture','groq','{}',1,'{"audio_hour":1}',1,'settled',now())`;
    for (const setting of ["request.jwt.claim.sub", "request.jwt.claims"]) {
      for (const [op, args] of [
        ["lyrics_back", [version]],
        ["song_get", [version]],
        ["job_status", [job.id]],
      ] as const) {
        await tx`select set_config(${setting},${setting.endsWith("sub") ? b.user_id : JSON.stringify({ sub: b.user_id, role: "authenticated" })},true)`;
        expect(await call(tx, "mdf_web", op, [a, ...args])).toMatchObject({
          ok: false,
          code: "not_found",
        });
      }
      await tx`select set_config(${setting},${setting.endsWith("sub") ? b.user_id : JSON.stringify({ sub: b.user_id, role: "authenticated" })},true)`;
      expect((await call(tx, "mdf_web", "songs_list", [a])).data.songs).toEqual(
        [],
      );
      await tx`select set_config(${setting},${setting.endsWith("sub") ? b.user_id : JSON.stringify({ sub: b.user_id, role: "authenticated" })},true)`;
      expect(
        (await call(tx, "mdf_web", "costs_get", [a])).data.by_provider,
      ).toEqual([]);
    }
    expect(
      (await tx`select status from public.versions where id=${version}`)[0]
        .status,
    ).toBe("failed");
  });
});

it("all checkpoint wrappers return their documented jobs or version status", async () => {
  await fixture(async (tx) => {
    const a = await actor(tx);
    const v = await song(tx, a.user_id, "lyrics_review");
    expect(
      await call(tx, "mdf_web", "lyrics_approve", [
        a,
        v,
        { title: "Test", lyrics: "Test" },
      ]),
    ).toMatchObject({ ok: true, data: { jobs: [{ stage: "generate_song" }] } });
    await tx`update public.jobs set status='done' where version_id=${v}`;
    await tx`update public.versions set status='takes_review' where id=${v}`;
    const [take] =
      await tx`insert into public.takes(owner_id,version_id,audio_preview_path) values(${a.user_id},${v},'fixture.mp3') returning id`;
    expect(
      await call(tx, "mdf_web", "take_pick", [a, v, take.id]),
    ).toMatchObject({ ok: true, data: { jobs: [{ stage: "timing" }] } });
    await tx`update public.jobs set status='done' where version_id=${v}`;
    await tx`update public.versions set status='audio_ready',render_attempt=render_attempt+1 where id=${v}`;
    expect(await call(tx, "mdf_web", "video_make", [a, v])).toMatchObject({
      ok: true,
      data: { jobs: [{ stage: "timing" }] },
    });
    await tx`update public.jobs set status='done' where version_id=${v}`;
    await tx`update public.versions set status='video_review' where id=${v}`;
    await tx`insert into public.renders(owner_id,version_id,kind,render_attempt) select owner_id,id,'master',render_attempt from public.versions where id=${v}`;
    expect(await call(tx, "mdf_web", "video_rerender", [a, v])).toMatchObject({
      ok: true,
      data: { jobs: [{ stage: "timing" }] },
    });
    await tx`update public.jobs set status='done' where version_id=${v}`;
    await tx`update public.versions set status='video_review' where id=${v}`;
    await tx`insert into public.renders(owner_id,version_id,kind,render_attempt) select owner_id,id,'master',render_attempt from public.versions v where id=${v} and not exists(select 1 from public.renders r where r.version_id=v.id and r.kind='master' and r.render_attempt=v.render_attempt)`;
    await tx`update public.renders r set qa_results=coalesce(r.qa_results,'{}'::jsonb) || '{"gates":[{"pass":true}]}'::jsonb from public.versions v where v.id=${v} and r.version_id=v.id and r.kind='master' and r.render_attempt=v.render_attempt`;
    expect(await call(tx, "mdf_web", "video_approve", [a, v])).toMatchObject({
      ok: true,
      data: { version_id: v, status: "approved" },
    });
    await tx`update public.versions set status='failed' where id=${v}`;
    const [failed] =
      await tx`insert into public.jobs(owner_id,version_id,stage,status,idempotency_key) values(${a.user_id},${v},'timing','failed',${randomUUID()}) returning id`;
    expect(
      await call(tx, "mdf_web", "stage_retry", [a, failed.id]),
    ).toMatchObject({ ok: true, data: { jobs: [{ stage: "timing" }] } });
    await tx`update public.jobs set status='done' where version_id=${v}`;
    await tx`update public.versions set status='failed' where id=${v}`;
    expect(await call(tx, "mdf_web", "lyrics_back", [a, v])).toMatchObject({
      ok: true,
      data: { version_id: v, status: "lyrics_review" },
    });
  });
});

it("create keeps advanced prompt fallback, language fanout and count; trashed reads stay hidden", async () => {
  await fixture(async (tx) => {
    const a = await actor(tx);
    const result = await call(tx, "mdf_web", "song_create", [
      a,
      {
        ...create,
        mode: "advanced",
        prompt: "",
        lyrics: "[Verse]\nTitle from lyrics",
        languages: ["it", "en"],
        count: 2,
      },
    ]);
    expect(result.ok).toBe(true);
    expect(result.data.jobs).toHaveLength(4);
    expect(
      await tx`select id from public.projects where owner_id=${a.user_id} and topic='Title from lyrics'`,
    ).toHaveLength(2);
    const v = result.data.jobs[0].version_id;
    await tx`update public.versions set trashed_at=now() where id=${v}`;
    expect(await call(tx, "mdf_web", "song_get", [a, v])).toMatchObject({
      ok: false,
      code: "not_found",
    });
    expect(
      (await call(tx, "mdf_web", "songs_list", [a])).data.songs,
    ).toHaveLength(3);
    expect(
      (await call(tx, "mdf_web", "songs_list", [a, null, 20, null, true])).data
        .songs,
    ).toHaveLength(4);
    expect(
      await call(tx, "mdf_web", "songs_list", [a, "not-base64"]),
    ).toMatchObject({ ok: false, code: "validation" });
  });
});
it("reads return only the resolved actor's rows and paginate without duplicates", async () => {
  await fixture(async (tx) => {
    const a = await actor(tx);
    const b = await actor(tx);
    const ids = [await song(tx, a.user_id), await song(tx, a.user_id)];
    await song(tx, b.user_id);
    const first = await call(tx, "mdf_web", "songs_list", [a, null, 1]);
    const second = await call(tx, "mdf_web", "songs_list", [
      a,
      first.data.next_cursor,
      1,
    ]);
    expect(
      [first.data.songs[0].version_id, second.data.songs[0].version_id].sort(),
    ).toEqual(ids.sort());
    expect(second.data.next_cursor).toBeNull();
    expect(
      (await call(tx, "mdf_web", "song_get", [a, ids[0]])).data,
    ).toMatchObject({
      version_id: ids[0],
      takes: [],
      renders: [],
      active_jobs: [],
    });
  });
});
it("a create-only PAT gets forbidden_scope on lyrics_approve and stage_retry of publish", async () => {
  await fixture(async (tx) => {
    const a = await actor(tx);
    const t = await token(tx, a, ["create"]);
    const v = await song(tx, a.user_id);
    expect(
      await call(tx, "mdf_web", "lyrics_approve", [
        t,
        v,
        { title: "Test", lyrics: "Test" },
      ]),
    ).toMatchObject({ ok: false, code: "forbidden_scope" });
    const [j] =
      await tx`insert into public.jobs(owner_id,version_id,stage,status,idempotency_key) values(${a.user_id},${v},'publish','failed',${randomUUID()}) returning id`;
    expect(await call(tx, "mdf_web", "stage_retry", [t, j.id])).toMatchObject({
      ok: false,
      code: "forbidden_scope",
    });
  });
});
it("test tokens cannot use real versions and created versions get test_run", async () => {
  await fixture(async (tx) => {
    const a = await actor(tx);
    const t = await token(tx, a, undefined, true);
    const v = await song(tx, a.user_id);
    expect(await call(tx, "mdf_web", "song_get", [t, v])).toMatchObject({
      ok: false,
      code: "forbidden_scope",
    });
    const result = await call(tx, "mdf_web", "song_create", [t, create]);
    expect(result.ok).toBe(true);
    const [created] =
      await tx`select test_run from public.versions where project_id=${result.data.project_id}`;
    expect(created.test_run).toBe(true);
    const [j] =
      await tx`select fake_providers,token_id from public.jobs where id=${result.data.jobs[0].job_id}`;
    expect(j.fake_providers).toBe(true);
    expect(j.token_id).toBeTruthy();
    expect(
      await call(tx, "mdf_web", "song_get", [
        a,
        result.data.jobs[0].version_id,
      ]),
    ).toMatchObject({ ok: false, code: "forbidden_scope" });
  });
});
it("jobs_stamp_ctx does nothing without context and never clears fake_providers or token_id", async () => {
  await fixture(async (tx) => {
    const a = await actor(tx);
    const t = await token(tx, a, undefined, true);
    const result = await call(tx, "mdf_web", "song_create", [t, create]);
    expect(result.ok).toBe(true);
    const id = result.data.jobs[0].job_id;
    const [before] =
      await tx`select token_id,run_id,fake_providers from public.jobs where id=${id}`;
    const [settingsBefore] =
      await tx`select current_setting('mdf.job_ids',true) ids`;
    await tx`update public.jobs set priority=1 where id=${id}`;
    expect(
      (
        await tx`select token_id,run_id,fake_providers from public.jobs where id=${id}`
      )[0],
    ).toEqual(before);
    expect(
      (await tx`select current_setting('mdf.job_ids',true) ids`)[0],
    ).toEqual(settingsBefore);
    await tx`select set_config('mdf.job_ctx','{"token_id":null,"fake_providers":false}',true)`;
    await tx`update public.jobs set priority=2,fake_providers=false,token_id=null where id=${id}`;
    expect(
      (
        await tx`select token_id,fake_providers from public.jobs where id=${id}`
      )[0],
    ).toEqual({ token_id: before.token_id, fake_providers: true });
  });
});

it("unsupported paid remake retries require spend and remain blocked until metered", async () => {
  await fixture(async (tx) => {
    const a = await actor(tx);
    const createOnly = await token(tx, a, ["create"]);
    const spender = await token(tx, a, ["create", "spend"]);
    for (const stage of ["remake_analyse", "remake_rewrite"]) {
      const v = await song(tx, a.user_id);
      const [j] =
        await tx`insert into public.jobs(owner_id,version_id,stage,status,idempotency_key) values(${a.user_id},${v},${stage},'failed',${randomUUID()}) returning id`;
      for (const [ctx, code] of [
        [createOnly, "forbidden_scope"],
        [spender, "conflict"],
        [a, "conflict"],
      ] as const) {
        expect(
          await call(tx, "mdf_web", "stage_retry", [ctx, j.id]),
        ).toMatchObject({ ok: false, code });
        expect(
          (await tx`select status from public.versions where id=${v}`)[0]
            .status,
        ).toBe("failed");
        expect(
          await tx`select id from public.jobs where version_id=${v}`,
        ).toHaveLength(1);
        expect(
          await tx`select id from public.reservations where version_id=${v}`,
        ).toHaveLength(0);
      }
    }
  });
});

it("cancelling a running job leaves the job and its reservation unchanged", async () => {
  await realCaps(async (tx) => {
    const a = await actor(tx, "customer");
    const result = await call(tx, "mdf_web", "song_create", [a, create]);
    expect(result.ok).toBe(true);
    const id = result.data.jobs[0].job_id;
    await tx`update public.jobs set status='running',started_at=now() where id=${id}`;
    const [beforeJob] = await tx`select * from public.jobs where id=${id}`;
    const [beforeReservation] =
      await tx`select * from public.reservations where job_id=${id}`;
    expect(beforeReservation.state).toBe("open");
    expect(await call(tx, "mdf_web", "job_cancel", [a, id])).toMatchObject({
      ok: false,
      code: "conflict",
    });
    expect((await tx`select * from public.jobs where id=${id}`)[0]).toEqual(
      beforeJob,
    );
    expect(
      (await tx`select * from public.reservations where job_id=${id}`)[0],
    ).toEqual(beforeReservation);
  });
});
it("admin operations refuse remote, stale and unknown sessions", async () => {
  await fixture(async (tx) => {
    const a = await actor(tx);
    expect(
      await call(tx, "mdf_web", "admin_tokens_list", [{ ...a, remote: true }]),
    ).toMatchObject({ ok: false, code: "forbidden_scope" });
    expect(
      await call(tx, "mdf_web", "admin_tokens_list", [
        { ...a, session_id: randomUUID() },
      ]),
    ).toMatchObject({ ok: false, code: "unauthorized" });
    await tx`update auth.sessions set refreshed_at=now()-interval '2 hours' where id=${a.session_id}`;
    expect(await call(tx, "mdf_web", "admin_tokens_list", [a])).toMatchObject({
      ok: false,
      code: "unauthorized",
    });
  });
});
async function realCaps(work: (tx: TransactionSql) => Promise<void>) {
  const sql = ownerSql();
  const rollback = new Error("rollback");
  try {
    await withRealCaps(sql, async (tx) => {
      await tx`grant mdf_web to postgres with set true`;
      await work(tx);
      throw rollback;
    }).catch((e) => {
      if (e !== rollback) throw e;
    });
  } finally {
    await sql.end();
  }
}
it("customer approval hits kie cap 0 while creation succeeds under USD cap", async () => {
  await realCaps(async (tx) => {
    const a = await actor(tx, "customer");
    const v = await song(tx, a.user_id, "lyrics_review");
    expect(
      await call(tx, "mdf_web", "lyrics_approve", [
        a,
        v,
        { title: "Test", lyrics: "Test" },
      ]),
    ).toMatchObject({ ok: false, code: "cap_exceeded" });
    expect(
      (await tx`select status from public.versions where id=${v}`)[0].status,
    ).toBe("lyrics_review");
    expect(await call(tx, "mdf_web", "song_create", [a, create])).toMatchObject(
      { ok: true },
    );
  });
});
it("customer generate_again with an old task id returns cap_exceeded", async () => {
  await realCaps(async (tx) => {
    const a = await actor(tx, "customer");
    const v = await song(tx, a.user_id);
    await tx`update public.versions set kie_task_id='old',kie_task_state='failed',kie_generation=1,generation_count=1 where id=${v}`;
    expect(
      await call(tx, "mdf_web", "song_generate_again", [a, v, 1]),
    ).toMatchObject({ ok: false, code: "cap_exceeded" });
  });
});
it("token actors must send an idempotency key", async () => {
  await fixture(async (tx) => {
    const a = await actor(tx);
    const t = await token(tx, a);
    const v = await song(tx, a.user_id);
    expect(
      await call(tx, "mdf_web", "lyrics_back", [
        { ...t, idempotency_key: undefined },
        v,
      ]),
    ).toMatchObject({ ok: false, code: "validation" });
  });
});

it("read schemas match database results, event cursors and redacted errors", async () => {
  await fixture(async (tx) => {
    const a = await actor(tx);
    const v = await song(tx, a.user_id);
    const [j] =
      await tx`insert into public.jobs(owner_id,version_id,stage,idempotency_key,error) values(${a.user_id},${v},'timing',${randomUUID()},${`Bearer fixture-secret https://example.test/private?key=fixture ${"x".repeat(400)}`}) returning id`;
    const [e] =
      await tx`insert into public.job_events(owner_id,job_id,message,progress) values(${a.user_id},${j.id},'first',25) returning id`;
    await tx`insert into public.job_events(owner_id,job_id,message,progress) values(${a.user_id},${j.id},${"m".repeat(400)},75)`;
    const result = await call(tx, "mdf_web", "job_status", [a, j.id, e.id]);
    expect(JobStatus.safeParse(result.data.job).success).toBe(true);
    expect(result.data.job.progress).toBe(0.75);
    expect(result.data.job.error).not.toContain("fixture-secret");
    expect(result.data.job.error).not.toContain("example.test");
    expect(result.data.events).toHaveLength(1);
    expect(JobEvent.safeParse(result.data.events[0]).success).toBe(true);
    const detail = await call(tx, "mdf_web", "song_get", [a, v]);
    expect(SongDetail.safeParse(detail.data).success).toBe(true);
    expect(
      SongSummary.safeParse(
        (await call(tx, "mdf_web", "songs_list", [a])).data.songs[0],
      ).success,
    ).toBe(true);
    expect(
      CostsSummary.safeParse((await call(tx, "mdf_web", "costs_get", [a])).data)
        .success,
    ).toBe(true);
  });
});

it("idempotency replays success, rejects hash changes and removes failed work", async () => {
  await fixture(async (tx) => {
    const a = await actor(tx);
    const t = await token(tx, a);
    expect(
      await call(tx, "mdf_web", "idem_begin", [
        t,
        t.idempotency_key,
        t.request_hash,
      ]),
    ).toMatchObject({ ok: true });
    const result = await call(tx, "mdf_web", "song_create", [t, create]);
    expect(result.ok).toBe(true);
    expect(await call(tx, "mdf_web", "song_create", [t, create])).toEqual(
      result,
    );
    expect(
      await call(tx, "mdf_web", "song_create", [
        { ...t, request_hash: hash("different") },
        create,
      ]),
    ).toMatchObject({ ok: false, code: "idempotency_mismatch" });
    expect(
      await tx`select result from public.audit_log where owner_id=${a.user_id} and operation='song_create' and result='ok'`,
    ).toHaveLength(2);
    expect(
      await tx`select error_code from public.audit_log where owner_id=${a.user_id} and operation='song_create' and error_code='idempotency_mismatch'`,
    ).toHaveLength(1);
    expect(
      await tx`select id from public.projects where owner_id=${a.user_id}`,
    ).toHaveLength(1);
    const bad = { ...t, idempotency_key: randomUUID() };
    await call(tx, "mdf_web", "idem_begin", [
      bad,
      bad.idempotency_key,
      bad.request_hash,
    ]);
    expect(
      await call(tx, "mdf_web", "song_create", [
        bad,
        { ...create, languages: ["invalid"] },
      ]),
    ).toMatchObject({ ok: false, code: "validation" });
    expect(
      await tx`select key from public.idempotency_keys where key=${bad.idempotency_key}`,
    ).toHaveLength(0);
    const [settings] =
      await tx`select current_setting('mdf.job_ctx',true) ctx,current_setting('request.jwt.claim.sub',true) sub,current_setting('request.jwt.claims',true) claims`;
    expect(settings).toEqual({ ctx: "", sub: "", claims: "" });
  });
});

it("stems and visualizer requeues stamp reused job rows without reserving phantom inserts", async () => {
  await fixture(async (tx) => {
    const a = await actor(tx);
    const t = await token(tx, a, undefined, true);
    const made = await call(tx, "mdf_web", "song_create", [t, create]);
    expect(made.ok).toBe(true);
    const v = made.data.jobs[0].version_id;
    const [take] =
      await tx`insert into public.takes(owner_id,version_id,audio_preview_path) values(${a.user_id},${v},'fixture.mp3') returning id`;
    await tx`update public.versions set status='audio_ready',chosen_take_id=${take.id} where id=${v}`;
    for (const [op, args] of [
      ["stems_request", [v]],
      [
        "visualizer_request",
        [
          v,
          {
            aspect: "16:9",
            background: { mode: "solid" },
            centerImage: { mode: "none" },
          },
        ],
      ],
    ] as const) {
      const first = await call(tx, "mdf_web", op, [
        { ...t, idempotency_key: randomUUID() },
        ...args,
      ]);
      expect(first.ok).toBe(true);
      const id = first.data.jobs[0].job_id;
      await tx`update public.jobs set status='failed' where id=${id}`;
      const retry = await call(tx, "mdf_web", op, [
        { ...t, idempotency_key: randomUUID() },
        ...args,
      ]);
      expect(retry).toMatchObject({
        ok: true,
        data: { jobs: [{ job_id: id }] },
      });
      expect(
        (
          await tx`select fake_providers,token_id is not null token from public.jobs where id=${id}`
        )[0],
      ).toEqual({ fake_providers: true, token: true });
    }
  });
});

it("cancel closes reservations and paid retries require spend even on a fake stack", async () => {
  await realCaps(async (tx) => {
    const a = await actor(tx, "customer");
    const made = await call(tx, "mdf_web", "song_create", [a, create]);
    expect(made.ok).toBe(true);
    const id = made.data.jobs[0].job_id;
    expect(await call(tx, "mdf_web", "job_cancel", [a, id])).toMatchObject({
      ok: true,
      data: { job: { status: "cancelled" } },
    });
    expect(
      (await tx`select state from public.reservations where job_id=${id}`)[0]
        .state,
    ).toBe("closed");
  });
  await fixture(async (tx) => {
    const a = await actor(tx);
    const t = await token(tx, a, ["create"]);
    const v = await song(tx, a.user_id);
    const [j] =
      await tx`insert into public.jobs(owner_id,version_id,stage,status,idempotency_key) values(${a.user_id},${v},'timing','failed',${randomUUID()}) returning id`;
    expect(await call(tx, "mdf_web", "stage_retry", [t, j.id])).toMatchObject({
      ok: false,
      code: "forbidden_scope",
    });
  });
});

it("token create rejects uploads while cookie schema preserves the existing create panel", async () => {
  const input = {
    ...create,
    mode: "advanced",
    settings: {
      engine: "kie",
      source: {
        mode: "cover",
        upload: `${randomUUID()}/audio/${randomUUID()}.mp3`,
      },
    },
  };
  expect(CookieCreateSongInput.safeParse(input).success).toBe(true);
  expect(CreateSongInput.safeParse(input).success).toBe(false);
  await fixture(async (tx) => {
    const a = await actor(tx);
    const t = await token(tx, a);
    expect(await call(tx, "mdf_web", "song_create", [t, input])).toMatchObject({
      ok: false,
      code: "validation",
    });
  });
});
