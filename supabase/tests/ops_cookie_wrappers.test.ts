import { randomUUID } from "node:crypto";
import type { TransactionSql } from "postgres";
import { expect, it } from "vitest";
import { withRealCaps } from "./helpers/caps";
import { ownerSql } from "./helpers/pg";
import { actor, call, fixture, hash, pat } from "./helpers/token-fixture";

async function song(tx: TransactionSql, user: string, status = "takes_review") {
  const [p] =
    await tx`insert into public.projects(owner_id,topic) values(${user},'Cookie fixture') returning id`;
  const [v] =
    await tx`insert into public.versions(owner_id,project_id,lang,status) values(${user},${p.id},'it',${status}) returning id`;
  const [t] =
    await tx`insert into public.takes(owner_id,version_id,audio_preview_path) values(${user},${v.id},'fixture.mp3') returning id`;
  return { version: v.id as string, take: t.id as string };
}

const adminCalls = (id: string): [string, unknown[]][] => [
  ["admin_resolve_kie_submission", [id, false, null]],
  ["admin_resolve_upload", [id, false, null]],
  ["admin_enqueue_publish", [id, { title: "Test" }]],
  ["admin_confirm_publication", [id, "private", null]],
  ["admin_video_approve_override", [id, "Test override"]],
  ["admin_project_create", ["Test", "Brief", ["it"], "Pop", "Bright", "f"]],
];

it("claim injection in either setting cannot rename another user's version", async () => {
  await fixture(async (tx) => {
    const a = await actor(tx);
    const b = await actor(tx);
    const { version } = await song(tx, b.user_id);
    for (const setting of ["request.jwt.claim.sub", "request.jwt.claims"]) {
      await tx`set local role mdf_web`;
      await tx`select set_config(${setting},${setting.endsWith("sub") ? b.user_id : JSON.stringify({ sub: b.user_id, role: "authenticated" })},false)`;
      await tx`reset role`;
      expect(
        await call(tx, "mdf_web", "song_rename", [a, version, "Injected"]),
      ).toMatchObject({ ok: false, code: "not_found" });
      expect(
        (
          await tx`select display_title from public.versions where id=${version}`
        )[0].display_title,
      ).toBeNull();
      const [claims] =
        await tx`select current_setting('request.jwt.claim.sub',true) as sub, current_setting('request.jwt.claims',true) as claims`;
      expect(claims).toEqual({ sub: "", claims: "" });
    }
  });
});

it.each([
  ["style_format_check", "style_format", 20],
  ["transcribe_check", "transcribe", 10],
] as const)(
  "%s enforces the customer daily limit until Rome midnight",
  async (op, tool, limit) => {
    await fixture(async (tx) => {
      const a = {
        ...(await actor(tx, "customer")),
        idempotency_key: randomUUID(),
        request_hash: hash("same tool request still counts each call"),
      };
      await tx`insert into public.web_tool_usage(user_id,tool,day,used) values(${a.user_id},${tool},(now() at time zone 'Europe/Rome')::date-1,999)`;
      for (let n = 0; n < limit; n++)
        expect(await call(tx, "mdf_web", op, [a])).toMatchObject({ ok: true });
      const result = await call(tx, "mdf_web", op, [a]);
      const [expected] =
        await tx`select ceil(extract(epoch from (((now() at time zone 'Europe/Rome')::date+1)::timestamp at time zone 'Europe/Rome')-now()))::integer as seconds`;
      expect(result).toMatchObject({
        ok: false,
        code: "rate_limited",
        retry_after: expected.seconds,
      });
      expect(
        (
          await tx`select used from public.web_tool_usage where user_id=${a.user_id} and tool=${tool} and day=(now() at time zone 'Europe/Rome')::date`
        )[0].used,
      ).toBe(limit);
    });
  },
);

it("admins are not counted against daily web tool limits", async () => {
  await fixture(async (tx) => {
    const a = await actor(tx);
    for (const op of ["style_format_check", "transcribe_check"]) {
      for (let n = 0; n < 22; n++)
        expect(await call(tx, "mdf_web", op, [a])).toMatchObject({ ok: true });
    }
    expect(
      await tx`select 1 from public.web_tool_usage where user_id=${a.user_id}`,
    ).toHaveLength(0);
  });
});

it("every admin wrapper refuses PATs, customer sessions, remote and stale sessions", async () => {
  await fixture(async (tx) => {
    const a = await actor(tx);
    const c = await actor(tx, "customer");
    expect((await pat(tx, a)).ok).toBe(true);
    const stale = await actor(tx);
    await tx`update auth.sessions set created_at=now()-interval '2 hours' where id=${stale.session_id}`;
    for (const [op, args] of adminCalls(randomUUID())) {
      for (const ctx of [
        c,
        { ...a, remote: true },
        { actor_kind: "pat", token_hash: hash("test-pat") },
      ]) {
        expect(await call(tx, "mdf_web", op, [ctx, ...args]), op).toMatchObject(
          { ok: false, code: "forbidden_scope" },
        );
      }
      for (const ctx of [stale, { ...a, session_id: randomUUID() }]) {
        expect(await call(tx, "mdf_web", op, [ctx, ...args]), op).toMatchObject(
          { ok: false, code: "unauthorized" },
        );
      }
    }
  });
});

it("admin_confirm_publication refuses scheduled", async () => {
  await fixture(async (tx) => {
    const a = await actor(tx);
    expect(
      await call(tx, "mdf_web", "admin_confirm_publication", [
        a,
        randomUUID(),
        "scheduled",
        new Date(Date.now() + 86400000),
      ]),
    ).toMatchObject({ ok: false, code: "validation" });
    expect(
      await tx`select 1 from public.jobs where owner_id=${a.user_id}`,
    ).toHaveLength(0);
  });
});

it("take_choose enforces current take, ownership, status and test rules", async () => {
  await fixture(async (tx) => {
    const a = await actor(tx, "customer");
    const { version, take } = await song(tx, a.user_id, "audio_ready");
    expect(
      await call(tx, "mdf_web", "take_choose", [a, version, take]),
    ).toMatchObject({ ok: true });
    expect(
      (
        await tx`select chosen_take_id from public.versions where id=${version}`
      )[0].chosen_take_id,
    ).toBe(take);
    const b = await actor(tx);
    expect(
      await call(tx, "mdf_web", "take_choose", [b, version, take]),
    ).toMatchObject({ code: "not_found" });
    await tx`update public.versions set test_run=true where id=${version}`;
    expect(
      await call(tx, "mdf_web", "take_choose", [a, version, take]),
    ).toMatchObject({ code: "forbidden_scope" });
    await tx`update public.versions set test_run=false,status='producing' where id=${version}`;
    expect(
      await call(tx, "mdf_web", "take_choose", [a, version, take]),
    ).toMatchObject({ code: "conflict" });
    await tx`update public.versions set status='audio_ready',generation_count=2 where id=${version}`;
    expect(
      (await call(tx, "mdf_web", "take_choose", [a, version, take])).ok,
    ).toBe(false);
  });
});

it("admin_project_create validates and creates each language with jobs", async () => {
  await fixture(async (tx) => {
    const a = await actor(tx);
    expect(
      await call(tx, "mdf_web", "admin_project_create", [
        a,
        "",
        "",
        ["it"],
        "Pop",
        "Bright",
        "f",
      ]),
    ).toMatchObject({ code: "validation" });
    const args = ["Test", "Brief", ["it", "en"], "Pop", "Bright", "f"];
    const ctx = {
      ...a,
      idempotency_key: randomUUID(),
      request_hash: hash("project"),
    };
    const result = await call(tx, "mdf_web", "admin_project_create", [
      ctx,
      ...args,
    ]);
    expect(result).toMatchObject({
      ok: true,
      data: { jobs: [{ stage: "draft_lyrics" }, { stage: "draft_lyrics" }] },
    });
    expect(
      await call(tx, "mdf_web", "admin_project_create", [ctx, ...args]),
    ).toEqual(result);
    expect(
      await tx`select 1 from public.projects where owner_id=${a.user_id}`,
    ).toHaveLength(1);
  });
});

it("audio_keep reserves Groq for any timing job under withRealCaps and rolls back at the cap", async () => {
  const sql = ownerSql();
  const rollback = new Error("rollback fixture");
  try {
    await withRealCaps(sql, async (tx) => {
      await tx`grant mdf_web to postgres with set true`;
      const a = await actor(tx);
      // The current RPC does not enqueue timing. Exercise that contract transaction-locally.
      await tx.unsafe(`create or replace function public.keep_audio(p_version uuid,p_take uuid) returns void
        language plpgsql security definer set search_path='' as $$
        begin
          perform public.web_version(p_version);
          update public.versions set chosen_take_id=p_take,status='audio_ready' where id=p_version;
          insert into public.jobs(owner_id,version_id,stage,idempotency_key) values(auth.uid(),p_version,'timing','timing:'||p_version);
        end; $$`);
      const first = await song(tx, a.user_id);
      expect(
        await call(tx, "mdf_web", "audio_keep", [a, first.version, first.take]),
      ).toMatchObject({ ok: true, data: { jobs: [{ stage: "timing" }] } });
      const [r] =
        await tx`select r.* from public.reservations r join public.jobs j on j.id=r.job_id where j.version_id=${first.version}`;
      expect(r.estimate).toEqual([
        expect.objectContaining({ provider: "groq" }),
      ]);
      await tx`insert into public.spend_caps(scope,key,provider,unit,period,"limit") values('user',${a.user_id},'groq','usd','day',0)`;
      const second = await song(tx, a.user_id);
      expect(
        await call(tx, "mdf_web", "audio_keep", [
          a,
          second.version,
          second.take,
        ]),
      ).toMatchObject({ code: "cap_exceeded" });
      expect(
        await tx`select 1 from public.jobs where version_id=${second.version}`,
      ).toHaveLength(0);
      expect(
        (
          await tx`select status from public.versions where id=${second.version}`
        )[0].status,
      ).toBe("takes_review");
      throw rollback;
    }).catch((e: unknown) => {
      if (e !== rollback) throw e;
    });
  } finally {
    await sql.end();
  }
});

it("cookie library wrappers preserve playlist, reaction, rename, trash and restore behavior", async () => {
  await fixture(async (tx) => {
    const a = await actor(tx, "customer");
    const { version } = await song(tx, a.user_id, "audio_ready");
    const playlist = await call(tx, "mdf_web", "playlist_create", [a, "First"]);
    expect(playlist.ok).toBe(true);
    const id = playlist.data.playlist_id;
    for (const [op, args] of [
      ["playlist_rename", [id, "Renamed"]],
      ["playlist_add", [id, [version]]],
      ["playlist_reorder", [id, [version]]],
      ["reaction_set", [version, "like"]],
      ["song_rename", [version, "New title"]],
      ["play_count", [version]],
      ["songs_trash", [[version]]],
      ["songs_restore", [[version]]],
      ["playlist_remove", [id, [version]]],
      ["playlist_delete", [id]],
    ] as [string, unknown[]][]) {
      expect(await call(tx, "mdf_web", op, [a, ...args]), op).toMatchObject({
        ok: true,
      });
    }
    expect(
      (
        await tx`select display_title,play_count,trashed_at from public.versions where id=${version}`
      )[0],
    ).toEqual({ display_title: "New title", play_count: 1, trashed_at: null });
    expect(
      await tx`select 1 from public.playlists where id=${id}`,
    ).toHaveLength(0);
    await tx`update public.versions set test_run=true where id=${version}`;
    expect(
      await call(tx, "mdf_web", "songs_trash", [a, [version]]),
    ).toMatchObject({ code: "forbidden_scope" });
  });
});

it("imports, edited takes and source metadata stay owned and section edits keep their transitions", async () => {
  await fixture(async (tx) => {
    const a = await actor(tx);
    const upload = `${a.user_id}/audio/${randomUUID()}.mp3`;
    await tx`insert into storage.objects(bucket_id,name,metadata) values('uploads',${upload},'{"mimetype":"audio/mpeg"}')`;
    const imported = await call(tx, "mdf_web", "song_import", [
      a,
      "Imported",
      "Pop",
      "Words",
      "it",
      upload,
      { kind: "upload" },
    ]);
    expect(imported).toMatchObject({
      ok: true,
      data: { jobs: [{ stage: "import_audio" }] },
    });
    const { version, take } = await song(tx, a.user_id, "audio_ready");
    await tx`update public.versions set chosen_take_id=${take} where id=${version}`;
    expect(
      await call(tx, "mdf_web", "song_source_set", [
        a,
        version,
        { title: "Source", licence: "own" },
      ]),
    ).toMatchObject({ ok: true });
    const path = `edits/${a.user_id}/${version}/${randomUUID()}.mp3`;
    await tx`insert into storage.objects(bucket_id,name,metadata) values('previews',${path},'{"mimetype":"audio/mpeg"}')`;
    const edited = await call(tx, "mdf_web", "take_save_edit", [
      a,
      version,
      path,
    ]);
    expect(edited.ok).toBe(true);
    const request = await call(tx, "mdf_web", "section_edit_request", [
      a,
      version,
      edited.data.take_id,
      "kie",
      10,
      25,
      120,
      [0],
      "New words",
      "All new words",
    ]);
    expect(request).toMatchObject({
      ok: true,
      data: { jobs: [{ stage: "replace_section" }] },
    });
    const edit = request.data.edit_id;
    await tx`update public.section_edits set alternatives='[{"path":"replacement.mp3"}]' where id=${edit}`;
    await tx`update public.jobs set status='done' where version_id=${version}`;
    expect(
      await call(tx, "mdf_web", "section_edit_keep", [a, edit, 0]),
    ).toMatchObject({ ok: true });
    expect(
      await call(tx, "mdf_web", "section_edit_discard", [a, edit]),
    ).toMatchObject({ code: "conflict" });
    const next = await call(tx, "mdf_web", "section_edit_request", [
      a,
      version,
      edited.data.take_id,
      "kie",
      10,
      25,
      120,
      [0],
      "Other words",
      "All other words",
    ]);
    expect(next.ok).toBe(true);
    expect(
      await call(tx, "mdf_web", "section_edit_discard", [a, next.data.edit_id]),
    ).toMatchObject({ ok: true });
  });
});

it("admin publication and video wrappers perform the existing local transitions", async () => {
  await fixture(async (tx) => {
    const a = await actor(tx);
    const { version } = await song(tx, a.user_id, "video_review");
    const [render] =
      await tx`insert into public.renders(owner_id,version_id,kind,qa_results) values(${a.user_id},${version},'master','{"gates":[{"pass":false}]}') returning id`;
    expect(
      await call(tx, "mdf_web", "admin_video_approve_override", [
        a,
        version,
        "Approved by owner",
      ]),
    ).toMatchObject({ ok: true });
    expect(
      await call(tx, "mdf_web", "admin_enqueue_publish", [
        a,
        render.id,
        { title: "Test" },
      ]),
    ).toMatchObject({ ok: true, data: { jobs: [{ stage: "publish" }] } });
    await tx`update public.jobs set status='done' where version_id=${version}`;
    const [p] =
      await tx`insert into public.publications(owner_id,render_id,privacy,upload_state) values(${a.user_id},${render.id},'private','uploading') returning id`;
    expect(
      await call(tx, "mdf_web", "admin_resolve_upload", [
        a,
        p.id,
        true,
        "test_video",
      ]),
    ).toMatchObject({ ok: true });
    expect(
      await call(tx, "mdf_web", "admin_confirm_publication", [
        a,
        p.id,
        "scheduled",
        new Date(Date.now() + 86400000),
      ]),
    ).toMatchObject({ code: "validation" });
    expect(
      (
        await tx`select privacy,confirmed_at from public.publications where id=${p.id}`
      )[0],
    ).toEqual({ privacy: "private", confirmed_at: null });
    expect(
      await call(tx, "mdf_web", "admin_confirm_publication", [
        a,
        p.id,
        "unlisted",
      ]),
    ).toMatchObject({ ok: true, data: { jobs: [{ stage: "set_privacy" }] } });
  });
});

it.each([true, false])(
  "Kie admin resolution closes the matching ambiguous reservation, charged=%s",
  async (charged) => {
    await fixture(async (tx) => {
      await tx`set local mdf.force_caps='on'`;
      const a = await actor(tx);
      const { version } = await song(tx, a.user_id, "song_queued");
      const [job] =
        await tx`insert into public.jobs(owner_id,version_id,stage,idempotency_key) values(${a.user_id},${version},'generate_song',${randomUUID()}) returning id`;
      const [reserved] = await tx`select ops.reserve_job(${job.id}) as id`;
      await tx`update public.versions set status='failed',kie_generation=1,kie_submit_state='submitting' where id=${version}`;
      await tx`update public.jobs set status='failed' where id=${job.id}`;
      expect(
        (
          await tx`select state from public.reservations where id=${reserved.id}`
        )[0].state,
      ).toBe("ambiguous");
      const result = await call(tx, "mdf_web", "admin_resolve_kie_submission", [
        a,
        version,
        charged,
        charged ? "confirmed-task" : null,
      ]);
      expect(result).toMatchObject({ ok: true });
      const [r] =
        await tx`select * from public.reservations where id=${reserved.id}`;
      expect(r.state).toBe("closed");
      const entries =
        await tx`select * from public.spend_entries where reservation_id=${r.id} and provider='kie'`;
      expect(entries).toHaveLength(charged ? 1 : 0);
      if (charged) {
        expect(entries[0].state).toBe("settled");
        expect(Number(entries[0].usd)).toBeGreaterThan(0);
        const [resume] =
          await tx`select r.estimate from public.reservations r join public.jobs j on j.id=r.job_id where j.version_id=${version} and j.id<>${job.id}`;
        expect(resume.estimate).toEqual([
          expect.objectContaining({ provider: "groq" }),
        ]);
      } else {
        expect(r.charges.every((c: { amount: number }) => c.amount === 0)).toBe(
          true,
        );
      }
    });
  },
);

it("all 27 new wrappers reject token actors and have exact web-only grants", async () => {
  await fixture(async (tx) => {
    const a = await actor(tx);
    expect((await pat(tx, a)).ok).toBe(true);
    const names = [
      "style_format_check",
      "transcribe_check",
      "take_save_edit",
      "song_import",
      "song_source_set",
      "audio_keep",
      "take_choose",
      "playlist_create",
      "playlist_rename",
      "playlist_delete",
      "playlist_add",
      "playlist_remove",
      "playlist_reorder",
      "reaction_set",
      "song_rename",
      "songs_trash",
      "songs_restore",
      "play_count",
      "section_edit_request",
      "section_edit_keep",
      "section_edit_discard",
      ...adminCalls(randomUUID()).map(([name]) => name),
    ];
    const functions =
      await tx`select p.oid,p.proname,p.pronargs,p.prosecdef,p.proconfig,pg_get_userbyid(p.proowner) as owner from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='ops' and p.proname=any(${names})`;
    expect(functions).toHaveLength(27);
    for (const fn of functions) {
      expect(fn.prosecdef).toBe(true);
      expect(fn.owner).toBe("postgres");
      expect(fn.proconfig).toEqual(
        expect.arrayContaining(['search_path=""', "TimeZone=UTC"]),
      );
      const [acl] =
        await tx`select has_function_privilege('mdf_web',${fn.oid}::oid,'EXECUTE') as web, has_function_privilege('mdf_auth',${fn.oid}::oid,'EXECUTE') as auth, has_function_privilege('service_role',${fn.oid}::oid,'EXECUTE') as worker, has_function_privilege('anon',${fn.oid}::oid,'EXECUTE') as anon, has_function_privilege('authenticated',${fn.oid}::oid,'EXECUTE') as authenticated`;
      expect(acl).toEqual({
        web: true,
        auth: false,
        worker: false,
        anon: false,
        authenticated: false,
      });
      expect(
        await call(tx, "mdf_web", fn.proname, [
          { actor_kind: "pat", token_hash: hash("test-pat") },
          ...Array(fn.pronargs - 1).fill(null),
        ]),
        fn.proname,
      ).toMatchObject({ code: "forbidden_scope" });
    }
  });
});

it.each([true, false])(
  "Kie resolution also closes an ambiguous section edit, charged=%s",
  async (charged) => {
    await fixture(async (tx) => {
      await tx`set local mdf.force_caps='on'`;
      const a = await actor(tx);
      const { version, take } = await song(tx, a.user_id, "audio_ready");
      const request = await call(tx, "mdf_web", "section_edit_request", [
        a,
        version,
        take,
        "kie",
        10,
        25,
        120,
        [0],
        "New words",
        "All words",
      ]);
      expect(request.ok).toBe(true);
      const edit = request.data.edit_id;
      const job = request.data.jobs[0].job_id;
      await tx`update public.section_edits set kie_submit_state='submitting' where id=${edit}`;
      await tx`update public.jobs set status='failed' where id=${job}`;
      const [r] =
        await tx`select id,state from public.reservations where job_id=${job}`;
      expect(r.state).toBe("ambiguous");
      expect(
        await call(tx, "mdf_web", "admin_resolve_kie_submission", [
          a,
          version,
          charged,
          charged ? "section-task" : null,
          edit,
        ]),
      ).toMatchObject({ ok: true });
      expect(
        (await tx`select state from public.reservations where id=${r.id}`)[0]
          .state,
      ).toBe("closed");
      expect(
        await tx`select 1 from public.spend_entries where reservation_id=${r.id} and provider='kie'`,
      ).toHaveLength(charged ? 1 : 0);
      expect(
        (await tx`select status from public.versions where id=${version}`)[0]
          .status,
      ).toBe("audio_ready");
      const [e] =
        await tx`select kie_submit_state,kie_task_id from public.section_edits where id=${edit}`;
      expect(e).toEqual({
        kie_submit_state: charged ? "submitted" : null,
        kie_task_id: charged ? "section-task" : null,
      });
      expect(
        await tx`select 1 from public.jobs where version_id=${version} and status='queued'`,
      ).toHaveLength(charged ? 1 : 0);
    });
  },
);

it.each(
  ["generate_song", "replace_section"].flatMap((stage) =>
    [true, false].flatMap((charged) =>
      ["open", "settled"].map((state) => ({ stage, charged, state })),
    ),
  ),
)(
  "Kie recovery reconciles an existing $state entry for $stage, charged=$charged",
  async ({ stage, charged, state }) => {
    await fixture(async (tx) => {
      await tx`set local mdf.force_caps='on'`;
      const a = await actor(tx);
      await tx`insert into public.spend_caps(scope,key,provider,unit,period,"limit") values('user',${a.user_id},'kie','credit','day',100)`;
      const { version, take } = await song(
        tx,
        a.user_id,
        stage === "generate_song" ? "song_queued" : "audio_ready",
      );
      let edit: string | null = null;
      let job: string;
      if (stage === "replace_section") {
        const request = await call(tx, "mdf_web", "section_edit_request", [
          a,
          version,
          take,
          "kie",
          10,
          25,
          120,
          [0],
          "New words",
          "All words",
        ]);
        expect(request.ok).toBe(true);
        edit = request.data.edit_id;
        job = request.data.jobs[0].job_id;
      } else {
        const [row] =
          await tx`insert into public.jobs(owner_id,version_id,stage,idempotency_key) values(${a.user_id},${version},'generate_song',${randomUUID()}) returning id`;
        job = row.id;
        await tx`select ops.reserve_job(${job})`;
      }
      const [reservation] =
        await tx`select id,estimate from public.reservations where job_id=${job}`;
      const estimate = reservation.estimate.find(
        (e: { provider: string }) => e.provider === "kie",
      );
      const [opened] =
        await tx`select ops.spend_entry_open(${reservation.id},'kie:submit','kie',${estimate.model},${tx.json(estimate.items)}) as id`;
      if (state === "settled") {
        const items = Object.fromEntries(
          Object.entries(estimate.items as Record<string, number>).map(
            ([key, amount]) => [key, amount / 2],
          ),
        );
        await tx`select ops.settle_spend(${opened.id},${tx.json(items)},${Number(estimate.usd) / 2})`;
      }
      const [before] =
        await tx`select * from public.spend_entries where id=${opened.id}`;
      // An unrelated ambiguous reservation must keep its open entry and charge estimate.
      const [other] =
        await tx`insert into public.reservations(user_id,estimate,state,kie_submit_reserved) values(${a.user_id},${tx.json([estimate])},'ambiguous',true) returning id`;
      const [unrelated] =
        await tx`insert into public.spend_entries(reservation_id,call_key,provider,model,items_est,usd_est) values(${other.id},'kie:submit','kie',${estimate.model},${tx.json(estimate.items)},${estimate.usd}) returning *`;
      if (edit) {
        await tx`update public.section_edits set kie_submit_state='submitting' where id=${edit}`;
      } else {
        await tx`update public.versions set status='failed',kie_generation=1,kie_submit_state='submitting' where id=${version}`;
      }
      await tx`update public.jobs set status='failed' where id=${job}`;
      const [ambiguous] =
        await tx`select state from public.reservations where id=${reservation.id}`;
      expect(ambiguous.state).toBe("ambiguous");
      expect(
        await call(tx, "mdf_web", "admin_resolve_kie_submission", [
          a,
          version,
          charged,
          charged ? "confirmed-task" : null,
          edit,
        ]),
      ).toMatchObject({ ok: true });
      const [after] =
        await tx`select * from public.spend_entries where id=${opened.id}`;
      const fraction = state === "settled" ? 0.5 : charged ? 1 : 0;
      const items = Object.fromEntries(
        Object.entries(estimate.items as Record<string, number>).map(
          ([key, amount]) => [key, amount * fraction],
        ),
      );
      expect(after).toMatchObject({ state: "settled", items });
      expect(Number(after.usd)).toBeCloseTo(Number(estimate.usd) * fraction, 4);
      expect(after.settled_at).not.toBeNull();
      if (state === "settled") expect(after).toEqual(before);
      expect(
        await tx`select 1 from public.spend_entries where reservation_id=${reservation.id} and provider='kie'`,
      ).toHaveLength(1);
      const [closed] =
        await tx`select state,charges from public.reservations where id=${reservation.id}`;
      expect(closed.state).toBe("closed");
      expect(
        closed.charges.filter(
          (c: { provider: string; unit: string }) =>
            c.provider === "kie" && c.unit === "credit",
        ),
      ).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ amount: items.credit }),
        ]),
      );
      const [counter] =
        await tx`select used from public.spend_counters where scope='user' and key=${a.user_id} and provider='kie' and unit='credit'`;
      expect(Number(counter.used)).toBe(items.credit);
      expect(
        (
          await tx`select * from public.spend_entries where id=${unrelated.id}`
        )[0],
      ).toEqual(unrelated);
      expect(
        (
          await tx`select state from public.reservations where id=${other.id}`
        )[0].state,
      ).toBe("ambiguous");
    });
  },
);
