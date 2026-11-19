import { randomUUID } from "node:crypto";
import type { Sql, TransactionSql } from "postgres";
import { afterAll, expect, it } from "vitest";
import { ownerSql } from "./helpers/pg";
import { actor, call, fixture, hash } from "./helpers/token-fixture";

// "Pubblica" (migration 20261119000001): plan, approval card, standing rules, veto window and the
// slot worker's claim -> intent -> handoff -> finish protocol with crash recovery.

type Ctx = Record<string, unknown>;
type Tx = TransactionSql | Sql;
const keyed = (ctx: Ctx) =>
  ctx.actor_kind === "session"
    ? ctx
    : {
        ...ctx,
        idempotency_key: randomUUID(),
        request_hash: hash(randomUUID()),
      };
const inHours = (hours: number) =>
  new Date(Date.now() + hours * 3_600_000).toISOString();

async function agent(tx: TransactionSql, owner: Ctx, scopes: string[]) {
  const token_hash = hash(randomUUID());
  const made = await call(tx, "mdf_web", "admin_token_create", [
    owner,
    "Publish agent",
    token_hash,
    "test",
    scopes,
    false,
    false,
    null,
  ]);
  expect(made.ok).toBe(true);
  return { actor_kind: "pat", token_hash, remote: false };
}

// An approved video with an approved master render.
async function video(tx: Tx, owner: string, status = "approved") {
  const [project] =
    await tx`insert into public.projects(owner_id,topic) values(${owner},'Publish fixture') returning id`;
  const [version] =
    await tx`insert into public.versions(owner_id,project_id,lang,status,display_title)
    values(${owner},${project.id},'it',${status},'Canzone di prova') returning id`;
  // The owner's worker: a worker publishes only for its own owner.
  await tx`insert into public.workers(id,owner_id,last_seen) values(${`wpub-${owner}`},${owner},now()) on conflict do nothing`;
  const [render] =
    await tx`insert into public.renders(owner_id,version_id,kind,render_attempt,path,approved_at)
    values(${owner},${version.id},'master',(select render_attempt from public.versions where id=${version.id}),'E:/mellodifai/native-lab/fixture/master.mp4',now()) returning id`;
  return { version: version.id as string, render: render.id as string };
}

async function op(
  tx: TransactionSql,
  name: string,
  ctx: Ctx,
  ...args: unknown[]
) {
  return call(tx, "mdf_web", name, [keyed(ctx), ...args]);
}

async function plan(
  tx: TransactionSql,
  ctx: Ctx,
  version: string,
  slot = inHours(48),
) {
  const planned = await op(tx, "publish_plan", ctx, version, ["youtube"], {
    description: "Descrizione",
    tags: ["musica", "ai"],
    thumbnail_text: "Nuovo singolo",
  });
  expect(planned).toMatchObject({ ok: true, data: { state: "draft" } });
  const id = planned.data.schedule_id as string;
  expect(await op(tx, "publish_schedule", ctx, id, slot)).toMatchObject({
    ok: true,
  });
  return id;
}

// Run as the worker: the dispatch functions are granted to service_role only.
async function worker<T>(tx: Tx, query: string, args: unknown[]): Promise<T> {
  const run = async (sp: Tx) => {
    await sp.unsafe("set local role service_role");
    const [row] = await sp.unsafe(query, args as never[]);
    await sp.unsafe("reset role");
    return row.result as T;
  };
  return "savepoint" in tx
    ? (tx as TransactionSql).savepoint((sp) => run(sp))
    : tx.begin((sp) => run(sp));
}
// Every test owner's worker (wpub-<owner>) runs the step; the answers are joined.
const everyWorker = (fn: string, extra: string) =>
  `select coalesce(jsonb_agg(c),'[]'::jsonb) as result from public.workers w,
    jsonb_array_elements(ops.${fn}(w.id${extra})) c where w.id like 'wpub-%'`;
const recover = (tx: Tx) =>
  worker<Record<string, unknown>[]>(
    tx,
    everyWorker("publish_dispatch_recover", ""),
    [],
  );
const claim = (tx: Tx) =>
  worker<Record<string, string>[]>(
    tx,
    everyWorker("publish_dispatch_claim", ",5"),
    [],
  );
const intent = (tx: Tx, c: Record<string, string>) =>
  worker<boolean>(tx, "select ops.publish_dispatch_intent($1,$2) as result", [
    c.destination_id,
    c.claim_token,
  ]);
const handoff = (tx: Tx, c: Record<string, string>) =>
  worker<boolean>(tx, "select ops.publish_dispatch_handoff($1,$2) as result", [
    c.destination_id,
    c.claim_token,
  ]);
const finish = (tx: Tx, c: Record<string, string>, outcome: string) =>
  worker<null>(
    tx,
    "select ops.publish_dispatch_finish($1,$2,$3,$4,$5) as result",
    [
      c.destination_id,
      c.claim_token,
      outcome,
      outcome === "published" ? "https://youtu.be/vid-1" : null,
      outcome === "published" ? null : "fake provider",
    ],
  );

// The private upload finished and the slot came: the frozen payload follows the new slot.
async function due(tx: Tx, schedule: string, render: string, owner: string) {
  await tx`update public.jobs set status='done' where stage='publish' and payload->>'render_id'=${render}`;
  await tx`insert into public.publications(owner_id,render_id,privacy,upload_state,youtube_video_id,privacy_applied)
    values(${owner},${render},'private','uploaded','vid-1','private') on conflict do nothing`;
  await tx`update public.publish_schedules set slot_at=now()-interval '1 minute' where id=${schedule}`;
  await tx`update public.approval_requests set payload_hash=ops._publish_hash(schedule_id) where schedule_id=${schedule} and state='approved'`;
}
const state = async (tx: Tx, schedule: string) =>
  (await tx`select state from public.publish_schedules where id=${schedule}`)[0]
    .state as string;
const publishJobs = async (tx: Tx, render: string) =>
  Number(
    (
      await tx`select count(*)::int n from public.jobs where stage='publish' and payload->>'render_id'=${render}`
    )[0].n,
  );

it("plans one YouTube draft per video and refuses other platforms, customers and a second plan", async () => {
  await fixture(async (tx) => {
    const owner = await actor(tx);
    const { version } = await video(tx, owner.user_id);
    const planned = await op(
      tx,
      "publish_plan",
      owner,
      version,
      ["youtube"],
      {},
    );
    expect(planned).toMatchObject({
      ok: true,
      data: {
        state: "draft",
        veto_open: true,
        approval: null,
        destinations: [
          {
            platform: "youtube",
            provider: "native",
            state: "draft",
            draft: { title: "Canzone di prova" },
            problems: [],
          },
        ],
      },
    });
    expect(
      await op(tx, "publish_plan", owner, version, ["youtube"], {}),
    ).toMatchObject({ ok: false, code: "conflict" });
    const other = await video(tx, owner.user_id);
    expect(
      await op(tx, "publish_plan", owner, other.version, ["tiktok"], {}),
    ).toMatchObject({ ok: false, code: "validation" });
    expect(
      await op(tx, "publish_plan", owner, other.version, ["myspace"], {}),
    ).toMatchObject({ ok: false, code: "validation" });
    const customer = await actor(tx, "customer");
    const theirs = await video(tx, customer.user_id);
    expect(
      await op(tx, "publish_plan", customer, theirs.version, ["youtube"], {}),
    ).toMatchObject({ ok: false, code: "forbidden_scope" });
    expect(
      await op(tx, "publish_preview", customer, planned.data.schedule_id),
    ).toMatchObject({ ok: false });
    const draft = await video(tx, owner.user_id, "video_review");
    expect(
      await op(tx, "publish_plan", owner, draft.version, ["youtube"], {}),
    ).toMatchObject({ ok: false, code: "conflict" });
  });
});

it("refuses a draft over YouTube's limits and returns the problems in the preview", async () => {
  await fixture(async (tx) => {
    const owner = await actor(tx);
    const { version } = await video(tx, owner.user_id);
    const id = await plan(tx, owner, version);
    const edited = await op(tx, "publish_draft_edit", owner, id, "youtube", {
      title: "x".repeat(101),
      tags: ["<b>"],
    });
    expect(edited.data.destinations[0].problems).toEqual([
      { field: "title", code: "too_long", limit: 100 },
    ]);
    expect(edited.data.destinations[0].draft.tags).toEqual(["<b>"]);
    expect(edited.data.destinations[0].draft.description).toBe("Descrizione");
    expect(await op(tx, "publish_request_approval", owner, id)).toMatchObject({
      ok: false,
      code: "validation",
    });
    expect(
      await op(tx, "publish_draft_edit", owner, id, "youtube", { title: 7 }),
    ).toMatchObject({ ok: false, code: "validation" });
    expect(
      await op(tx, "publish_schedule", owner, id, inHours(-1)),
    ).toMatchObject({ ok: false, code: "validation" });
    const preview = await op(tx, "publish_preview", owner, id);
    expect(preview.data.destinations[0].problems).toHaveLength(1);
  });
});

it("an agent's request waits for the owner's yes; the agent cannot approve; reject and expiry call nothing", async () => {
  await fixture(async (tx) => {
    const owner = await actor(tx);
    const { version, render } = await video(tx, owner.user_id);
    const pat = await agent(tx, owner, ["read", "create", "spend"]);
    const id = await plan(tx, pat, version);
    expect(
      await call(tx, "mdf_web", "publish_request_approval", [
        { ...pat, request_hash: hash("x") },
        id,
      ]),
    ).toMatchObject({
      ok: false,
      code: "validation",
    });
    const createOnly = await agent(tx, owner, ["read", "create"]);
    expect(
      await op(tx, "publish_request_approval", createOnly, id),
    ).toMatchObject({ ok: false, code: "forbidden_scope" });
    const asked = await op(tx, "publish_request_approval", pat, id);
    expect(asked).toMatchObject({
      ok: true,
      data: {
        state: "awaiting_approval",
        approval: { state: "pending", price_eur: 0, platforms: ["youtube"] },
      },
    });
    expect(asked.data.approval.summary).toContain("YouTube");
    expect(await publishJobs(tx, render)).toBe(0);
    const approval = asked.data.approval.approval_id as string;
    for (const name of [
      "publish_approval_decide",
      "publish_rules_list",
      "publish_rule_save",
    ])
      expect(
        await op(
          tx,
          name,
          pat,
          ...(name === "publish_approval_decide"
            ? [approval, "approve"]
            : name === "publish_rule_save"
              ? [{}]
              : []),
        ),
        name,
      ).toMatchObject({ ok: false, code: "forbidden_scope" });
    // The owner rejects: zero external calls, zero jobs.
    expect(
      await op(tx, "publish_approval_decide", owner, approval, "reject"),
    ).toMatchObject({ ok: true, data: { state: "rejected" } });
    expect(await publishJobs(tx, render)).toBe(0);
    // A new request, then the slot passes before anyone decides: the card expires.
    expect(
      await op(tx, "publish_schedule", pat, id, inHours(30)),
    ).toMatchObject({ ok: true, data: { state: "draft" } });
    const again = await op(tx, "publish_request_approval", pat, id);
    await tx`update public.approval_requests set expires_at=now()-interval '1 second' where id=${again.data.approval.approval_id}`;
    await recover(tx);
    expect(await state(tx, id)).toBe("expired");
    expect(
      await op(
        tx,
        "publish_approval_decide",
        owner,
        again.data.approval.approval_id,
        "approve",
      ),
    ).toMatchObject({ ok: false, code: "conflict" });
    expect(await publishJobs(tx, render)).toBe(0);
    expect(await claim(tx)).toEqual([]);
  });
});

it("an edit after the card invalidates it; the owner's yes schedules a private upload only", async () => {
  await fixture(async (tx) => {
    const owner = await actor(tx);
    const { version, render } = await video(tx, owner.user_id);
    const pat = await agent(tx, owner, ["read", "create", "spend"]);
    const id = await plan(tx, pat, version);
    const first = await op(tx, "publish_request_approval", pat, id);
    expect(
      await op(tx, "publish_draft_edit", pat, id, "youtube", {
        title: "Titolo cambiato",
      }),
    ).toMatchObject({
      ok: true,
      data: {
        state: "draft",
        approval: { state: "expired", decided_via: "system" },
      },
    });
    expect(
      await op(
        tx,
        "publish_approval_decide",
        owner,
        first.data.approval.approval_id,
        "approve",
      ),
    ).toMatchObject({ ok: false, code: "conflict" });
    const second = await op(tx, "publish_request_approval", pat, id);
    const approved = await op(
      tx,
      "publish_approval_decide",
      owner,
      second.data.approval.approval_id,
      "approve",
    );
    expect(approved).toMatchObject({
      ok: true,
      data: {
        state: "scheduled",
        approval: { state: "approved", decided_via: "owner" },
      },
    });
    const [job] =
      await tx`select payload from public.jobs where stage='publish' and payload->>'render_id'=${render}`;
    expect(job.payload.metadata).toEqual({
      title: "Titolo cambiato",
      description: "Descrizione",
      tags: "musica,ai",
    });
    // Scheduled: no more edits without a veto, and no cancel either.
    expect(
      await op(tx, "publish_draft_edit", pat, id, "youtube", {
        title: "Ancora",
      }),
    ).toMatchObject({ ok: false, code: "conflict" });
    expect(await op(tx, "publish_cancel", pat, id)).toMatchObject({
      ok: false,
      code: "conflict",
    });
    // Not due yet: nothing to claim.
    expect(await claim(tx)).toEqual([]);
  });
});

it("a standing rule approves only within its veto window; the owner's own request needs no card", async () => {
  await fixture(async (tx) => {
    const owner = await actor(tx);
    const pat = await agent(tx, owner, ["read", "create", "spend"]);
    expect(
      await op(tx, "publish_rule_save", owner, {
        platform: "youtube",
        max_price_eur: 0,
        require_veto_hours: 24,
        active: true,
      }),
    ).toMatchObject({ ok: true });
    expect(
      await op(tx, "publish_rule_save", owner, {
        platform: "youtube",
        max_price_eur: 0,
        require_veto_hours: 0.5,
        active: true,
      }),
    ).toMatchObject({
      ok: false,
      code: "validation",
    });
    const soon = await video(tx, owner.user_id);
    const near = await plan(tx, pat, soon.version, inHours(3));
    expect(await op(tx, "publish_request_approval", pat, near)).toMatchObject({
      data: { state: "awaiting_approval" },
    });
    const later = await video(tx, owner.user_id);
    const far = await plan(tx, pat, later.version, inHours(30));
    expect(await op(tx, "publish_request_approval", pat, far)).toMatchObject({
      ok: true,
      data: {
        state: "scheduled",
        approval: { state: "approved", decided_via: "rule" },
      },
    });
    expect(await publishJobs(tx, later.render)).toBe(1);
    const mine = await video(tx, owner.user_id);
    const own = await plan(tx, owner, mine.version, inHours(2));
    expect(await op(tx, "publish_request_approval", owner, own)).toMatchObject({
      data: { state: "scheduled", approval: { decided_via: "owner" } },
    });
    const listed = await op(tx, "publish_rules_list", owner);
    expect(listed.data.rules).toHaveLength(1);
    expect(
      listed.data.approvals.map((a: { schedule_id: string }) => a.schedule_id),
    ).toEqual([near]);
    expect(
      await op(tx, "publish_rule_delete", owner, listed.data.rules[0].rule_id),
    ).toMatchObject({ ok: true });
  });
});

async function scheduled(tx: TransactionSql) {
  const owner = await actor(tx);
  const { version, render } = await video(tx, owner.user_id);
  const id = await plan(tx, owner, version, inHours(2));
  expect(await op(tx, "publish_request_approval", owner, id)).toMatchObject({
    data: { state: "scheduled" },
  });
  await due(tx, id, render, owner.user_id);
  return { owner, id, render, version };
}

it("the veto wins while claimed and after the intent; the handoff then refuses", async () => {
  await fixture(async (tx) => {
    const a = await scheduled(tx);
    const [claimed] = await claim(tx);
    expect(claimed).toMatchObject({
      schedule_id: a.id,
      platform: "youtube",
      external_id: "vid-1",
    });
    expect(await op(tx, "publish_veto", a.owner, a.id)).toMatchObject({
      ok: true,
      data: { state: "vetoed", veto_open: false },
    });
    expect(await intent(tx, claimed)).toBe(false);
    const b = await scheduled(tx);
    const [next] = await claim(tx);
    expect(await intent(tx, next)).toBe(true);
    expect(await op(tx, "publish_veto", b.owner, b.id)).toMatchObject({
      ok: true,
      data: { state: "vetoed" },
    });
    expect(await handoff(tx, next)).toBe(false);
    const [row] =
      await tx`select privacy from public.publications where render_id=${b.render}`;
    expect(row.privacy).toBe("private");
  });
});

it("a crash between intent and handoff leaves the veto possible; after the handoff the veto conflicts", async () => {
  await fixture(async (tx) => {
    const a = await scheduled(tx);
    const [first] = await claim(tx);
    expect(await intent(tx, first)).toBe(true);
    // The worker dies here: its lease runs out.
    await tx`update public.publish_destinations set claim_expires_at=now()-interval '1 second' where id=${first.destination_id}`;
    expect(await recover(tx)).toEqual([]);
    expect(
      await tx`select state from public.publish_destinations where id=${first.destination_id}`,
    ).toEqual([{ state: "scheduled" }]);
    expect(await intent(tx, first)).toBe(false);
    // The restarted worker claims again (new token, new attempt) and hands off.
    const [second] = await claim(tx);
    expect(second.attempt_id).not.toBe(first.attempt_id);
    expect(await intent(tx, second)).toBe(true);
    expect(await handoff(tx, second)).toBe(true);
    expect(await op(tx, "publish_veto", a.owner, a.id)).toMatchObject({
      ok: false,
      code: "conflict",
    });
    await finish(tx, second, "published");
    expect(await op(tx, "publish_status", a.owner, a.version)).toMatchObject({
      ok: true,
      data: {
        schedules: [
          {
            state: "published",
            destinations: [
              { state: "published", external_url: "https://youtu.be/vid-1" },
            ],
          },
        ],
      },
    });
    expect(
      await tx`select privacy,privacy_applied from public.publications where render_id=${a.render}`,
    ).toEqual([{ privacy: "public", privacy_applied: "public" }]);
    expect(
      await tx`select status from public.versions where id=${a.version}`,
    ).toEqual([{ status: "published" }]);
  });
});

it("a crash after the handoff is settled by the provider status only: unknown stays held, never retried", async () => {
  await fixture(async (tx) => {
    const a = await scheduled(tx);
    const [first] = await claim(tx);
    await intent(tx, first);
    await handoff(tx, first);
    await tx`update public.publish_destinations set claim_expires_at=now()-interval '1 second' where id=${first.destination_id}`;
    const [check] = await recover(tx);
    expect(check).toMatchObject({
      destination_id: first.destination_id,
      attempt_id: first.attempt_id,
      external_id: "vid-1",
    });
    expect(await claim(tx)).toEqual([]);
    await expect(finish(tx, first, "published")).rejects.toThrow(
      /current claim required/,
    );
    await finish(tx, check as Record<string, string>, "unknown");
    expect(await state(tx, a.id)).toBe("held");
    expect(await claim(tx)).toEqual([]);
    // definitely_not_accepted is the only outcome that allows a new attempt.
    const b = await scheduled(tx);
    const [other] = await claim(tx);
    await intent(tx, other);
    await handoff(tx, other);
    await finish(tx, other, "definitely_not_accepted");
    expect(await op(tx, "publish_preview", b.owner, b.id)).toMatchObject({
      data: { state: "publishing", veto_open: true },
    });
    const [retry] = await claim(tx);
    expect(retry.destination_id).toBe(other.destination_id);
  });
});

it("a slot missed by more than six hours is held, never published late; a missing upload waits", async () => {
  await fixture(async (tx) => {
    const a = await scheduled(tx);
    await tx`update public.publish_schedules set slot_at=now()-interval '7 hours' where id=${a.id}`;
    expect(await claim(tx)).toEqual([]);
    expect(await op(tx, "publish_preview", a.owner, a.id)).toMatchObject({
      data: { state: "held", held_reason: "missed_slot", veto_open: true },
    });
    const owner = await actor(tx);
    const { version } = await video(tx, owner.user_id);
    const id = await plan(tx, owner, version, inHours(2));
    await op(tx, "publish_request_approval", owner, id);
    await tx`update public.publish_schedules set slot_at=now()-interval '1 minute' where id=${id}`;
    expect(await claim(tx)).toEqual([]);
  });
});

it("a changed payload after approval fails closed at the intent", async () => {
  await fixture(async (tx) => {
    const a = await scheduled(tx);
    const [claimed] = await claim(tx);
    await tx`update public.publish_destinations set draft=jsonb_set(draft,'{title}','"altro"') where id=${claimed.destination_id}`;
    expect(await intent(tx, claimed)).toBe(false);
    expect(await op(tx, "publish_preview", a.owner, a.id)).toMatchObject({
      data: { state: "held", held_reason: "gate_failed" },
    });
  });
});

it("a worker claims only its own owner's plans; three refusals stop the retries", async () => {
  await fixture(async (tx) => {
    const a = await scheduled(tx);
    const stranger = await actor(tx);
    await video(tx, stranger.user_id);
    const theirs = await worker<Record<string, string>[]>(
      tx,
      "select ops.publish_dispatch_claim($1,5) as result",
      [`wpub-${stranger.user_id}`],
    );
    expect(theirs).toEqual([]);
    await expect(
      worker(tx, "select ops.publish_dispatch_claim('nobody',5) as result", []),
    ).rejects.toThrow(/invalid worker/);
    for (const round of [1, 2, 3]) {
      const [mine] = await worker<Record<string, string>[]>(
        tx,
        "select ops.publish_dispatch_claim($1,5) as result",
        [`wpub-${a.owner.user_id}`],
      );
      expect(mine?.schedule_id, `round ${round}`).toBe(a.id);
      await intent(tx, mine as Record<string, string>);
      await handoff(tx, mine as Record<string, string>);
      await finish(
        tx,
        mine as Record<string, string>,
        "definitely_not_accepted",
      );
    }
    expect(await state(tx, a.id)).toBe("failed");
    expect(await claim(tx)).toEqual([]);
  });
});

// Committed rows on two connections: the veto and the handoff serialize on the schedule row.
const sql = ownerSql();
afterAll(() => sql.end());
async function committed() {
  const user = randomUUID();
  const email = `${user}@example.test`;
  const session = randomUUID();
  await sql`insert into public.admin_allowlist (email, role) values (${email}, 'admin')`;
  await sql`insert into auth.users (id, email, email_confirmed_at) values (${user}, ${email}, now())`;
  await sql`insert into auth.sessions (id, user_id, created_at) values (${session}, ${user}, now())`;
  const owner = {
    actor_kind: "session",
    user_id: user,
    session_id: session,
    remote: false,
  };
  const { version, render } = await video(sql, user);
  const run = (name: string, args: Record<string, unknown>) =>
    worker<{ ok: boolean; data: Record<string, unknown>; code?: string }>(
      sql,
      "select ops._publish_run($1,$2,$3,$4,true) as result",
      [
        owner,
        name,
        args,
        name === "publish_request_approval" ? "spend" : "create",
      ],
    );
  const planned = await run("publish_plan", {
    version_id: version,
    platforms: ["youtube"],
    draft: {},
  });
  const id = planned.data.schedule_id as string;
  await run("publish_schedule", { schedule_id: id, slot_at: inHours(2) });
  expect(
    await run("publish_request_approval", { schedule_id: id }),
  ).toMatchObject({ data: { state: "scheduled" } });
  await due(sql, id, render, user);
  const [claimed] = (await claim(sql)).filter((c) => c.schedule_id === id);
  expect(await intent(sql, claimed)).toBe(true);
  const veto = () => run("publish_veto", { schedule_id: id });
  const cleanup = async () => {
    await sql`delete from auth.users where id=${user}`;
    await sql`delete from public.admin_allowlist where email=${email}`;
  };
  return { id, owner, claimed, veto, cleanup };
}

it("a handoff holding the schedule lock makes the waiting veto conflict", async () => {
  const c = await committed();
  try {
    let vetoDone: Promise<{ ok: boolean; code?: string }> | undefined;
    await sql.begin(async (tx) => {
      await tx.unsafe("set local role service_role");
      const [row] =
        await tx`select ops.publish_dispatch_handoff(${c.claimed.destination_id}, ${c.claimed.claim_token}) as result`;
      expect(row.result).toBe(true);
      vetoDone = c.veto();
      await new Promise((resolve) => setTimeout(resolve, 300));
    });
    expect(await vetoDone).toMatchObject({ ok: false, code: "conflict" });
  } finally {
    await c.cleanup();
  }
});

it("a veto holding the schedule lock makes the waiting handoff refuse", async () => {
  const c = await committed();
  try {
    let handoffDone: Promise<boolean> | undefined;
    await sql.begin(async (tx) => {
      await tx.unsafe("set local role service_role");
      const [row] =
        await tx`select ops._publish_run(${c.owner as never}::jsonb,'publish_veto',${{ schedule_id: c.id } as never}::jsonb,'create',true) as result`;
      expect(row.result).toMatchObject({ ok: true, data: { state: "vetoed" } });
      handoffDone = handoff(sql, c.claimed);
      await new Promise((resolve) => setTimeout(resolve, 300));
    });
    expect(await handoffDone).toBe(false);
  } finally {
    await c.cleanup();
  }
});

it("a veto and a handoff started together: exactly one wins", async () => {
  for (let round = 0; round < 5; round++) {
    const c = await committed();
    try {
      const [veto, handed] = await Promise.all([
        c.veto(),
        handoff(sql, c.claimed),
      ]);
      expect([veto.ok, handed].filter(Boolean)).toHaveLength(1);
      const [row] =
        await sql`select state from public.publish_schedules where id=${c.id}`;
      expect(row.state).toBe(handed ? "publishing" : "vetoed");
    } finally {
      await c.cleanup();
    }
  }
});

// Blind-review fixes (fix-brief 2026-11-19).

const rule = (tx: TransactionSql, owner: Ctx, over: Ctx = {}) =>
  op(tx, "publish_rule_save", owner, {
    platform: "youtube",
    max_price_eur: 0,
    require_veto_hours: 24,
    active: true,
    ...over,
  });

it("after a veto or a rejection a standing rule never approves that video again: the owner's card decides", async () => {
  await fixture(async (tx) => {
    const owner = await actor(tx);
    const pat = await agent(tx, owner, ["read", "create", "spend"]);
    expect(await rule(tx, owner)).toMatchObject({ ok: true });
    // Veto, then a new plan for the same video.
    const { version } = await video(tx, owner.user_id);
    const first = await plan(tx, pat, version, inHours(30));
    expect(await op(tx, "publish_request_approval", pat, first)).toMatchObject({
      data: { state: "scheduled", approval: { decided_via: "rule" } },
    });
    expect(await op(tx, "publish_veto", pat, first)).toMatchObject({
      data: { state: "vetoed" },
    });
    const second = await plan(tx, pat, version, inHours(30));
    const asked = await op(tx, "publish_request_approval", pat, second);
    expect(asked).toMatchObject({
      ok: true,
      data: { state: "awaiting_approval", approval: { state: "pending" } },
    });
    // The owner's yes clears it.
    expect(
      await op(
        tx,
        "publish_approval_decide",
        owner,
        asked.data.approval.approval_id,
        "approve",
      ),
    ).toMatchObject({
      data: { state: "scheduled", approval: { decided_via: "owner" } },
    });
    // Rejection, then the same plan edited and asked again.
    const other = await video(tx, owner.user_id);
    const third = await plan(tx, pat, other.version, inHours(3));
    const card = await op(tx, "publish_request_approval", pat, third);
    expect(card).toMatchObject({ data: { state: "awaiting_approval" } });
    expect(
      await op(
        tx,
        "publish_approval_decide",
        owner,
        card.data.approval.approval_id,
        "reject",
      ),
    ).toMatchObject({ data: { state: "rejected" } });
    expect(
      await op(tx, "publish_schedule", pat, third, inHours(30)),
    ).toMatchObject({ ok: true, data: { state: "draft" } });
    expect(await op(tx, "publish_request_approval", pat, third)).toMatchObject({
      ok: true,
      data: { state: "awaiting_approval", approval: { state: "pending" } },
    });
    expect(await publishJobs(tx, other.render)).toBe(0);
  });
});

it("a plan approved by a rule goes out only while that rule still exists and is active", async () => {
  await fixture(async (tx) => {
    const owner = await actor(tx);
    const pat = await agent(tx, owner, ["read", "create", "spend"]);
    const saved = await rule(tx, owner);
    const ruleId = saved.data.rule_id as string;
    const a = await video(tx, owner.user_id);
    const id = await plan(tx, pat, a.version, inHours(30));
    expect(await op(tx, "publish_request_approval", pat, id)).toMatchObject({
      data: { state: "scheduled", approval: { decided_via: "rule" } },
    });
    await due(tx, id, a.render, owner.user_id);
    expect(
      await rule(tx, owner, { rule_id: ruleId, active: false }),
    ).toMatchObject({ ok: true });
    const [claimed] = await claim(tx);
    expect(claimed.schedule_id).toBe(id);
    expect(await intent(tx, claimed)).toBe(false);
    expect(await op(tx, "publish_preview", owner, id)).toMatchObject({
      data: { state: "held", held_reason: "gate_failed" },
    });
    // A deleted rule: the same.
    const again = await rule(tx, owner);
    const b = await video(tx, owner.user_id);
    const id2 = await plan(tx, pat, b.version, inHours(30));
    expect(await op(tx, "publish_request_approval", pat, id2)).toMatchObject({
      data: { state: "scheduled", approval: { decided_via: "rule" } },
    });
    await due(tx, id2, b.render, owner.user_id);
    expect(
      await op(tx, "publish_rule_delete", owner, again.data.rule_id),
    ).toMatchObject({ ok: true });
    const [next] = (await claim(tx)).filter((c) => c.schedule_id === id2);
    expect(await intent(tx, next)).toBe(false);
  });
});

it("a rule covers only a plan whose real price is within its cap", async () => {
  await fixture(async (tx) => {
    const owner = await actor(tx);
    const pat = await agent(tx, owner, ["read", "create", "spend"]);
    await rule(tx, owner);
    const { version, render } = await video(tx, owner.user_id);
    const id = await plan(tx, pat, version, inHours(30));
    // A destination without a known price (a paid provider): no rule can cover it.
    await tx`insert into public.publish_destinations(schedule_id,owner_id,platform,provider,account_id,draft)
      select schedule_id,owner_id,platform,'blotato','second',draft from public.publish_destinations where schedule_id=${id}`;
    await op(tx, "publish_request_approval", pat, id);
    expect(await state(tx, id)).not.toBe("scheduled");
    expect(await publishJobs(tx, render)).toBe(0);
    // The free native plan: price 0 within a 0 cap.
    const free = await video(tx, owner.user_id);
    const ok = await plan(tx, pat, free.version, inHours(30));
    expect(await op(tx, "publish_request_approval", pat, ok)).toMatchObject({
      data: { state: "scheduled", price_eur: 0 },
    });
  });
});

it("a worker's recovery touches only its own owner's cards and claims", async () => {
  await fixture(async (tx) => {
    const mine = await actor(tx);
    await video(tx, mine.user_id);
    const owner = await actor(tx);
    const pat = await agent(tx, owner, ["read", "create", "spend"]);
    const theirs = await video(tx, owner.user_id);
    const id = await plan(tx, pat, theirs.version, inHours(3));
    const asked = await op(tx, "publish_request_approval", pat, id);
    await tx`update public.approval_requests set expires_at=now()-interval '1 second' where id=${asked.data.approval.approval_id}`;
    const b = await scheduled(tx);
    const [claimed] = await worker<Record<string, string>[]>(
      tx,
      "select ops.publish_dispatch_claim($1,5) as result",
      [`wpub-${b.owner.user_id}`],
    );
    await tx`update public.publish_destinations set claim_expires_at=now()-interval '1 second' where id=${claimed.destination_id}`;
    expect(
      await worker(tx, "select ops.publish_dispatch_recover($1) as result", [
        `wpub-${mine.user_id}`,
      ]),
    ).toEqual([]);
    expect(await state(tx, id)).toBe("awaiting_approval");
    expect(
      await tx`select state from public.publish_destinations where id=${claimed.destination_id}`,
    ).toEqual([{ state: "claimed" }]);
  });
});

it("reopening a rejected plan while another plan is open answers a clear conflict", async () => {
  await fixture(async (tx) => {
    const owner = await actor(tx);
    const pat = await agent(tx, owner, ["read", "create", "spend"]);
    const { version } = await video(tx, owner.user_id);
    const id = await plan(tx, pat, version, inHours(3));
    const card = await op(tx, "publish_request_approval", pat, id);
    await op(
      tx,
      "publish_approval_decide",
      owner,
      card.data.approval.approval_id,
      "reject",
    );
    await plan(tx, pat, version, inHours(5));
    expect(
      await op(tx, "publish_schedule", pat, id, inHours(30)),
    ).toMatchObject({
      ok: false,
      code: "conflict",
      message: "a publish plan is already open",
    });
    expect(
      await op(tx, "publish_draft_edit", pat, id, "youtube", { title: "Ancora" }),
    ).toMatchObject({
      ok: false,
      code: "conflict",
      message: "a publish plan is already open",
    });
  });
});
