import { type ChildProcess, execFile, spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { afterAll, afterEach, beforeEach, expect, it, vi } from "vitest";
import { opsSql } from "@/lib/db/ops-client";
import { TOKEN_OPS } from "@/lib/ops/registry";
import { newPat } from "@/lib/ops/tokens";
import {
  type ApiCase,
  apiCases,
  type Handler,
  pack,
  pathParams,
  remakeUrl,
  requestFor,
} from "@/test/api-cases";
import { assertTestWebStack } from "../../../../../ops/test-db-guard";
import { ownerSql } from "../../../../../supabase/tests/helpers/pg";
import { actor } from "../../../../../supabase/tests/helpers/token-fixture";

// Only Next cache invalidation is mocked. Authentication, SQL and idempotency are real.
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
assertTestWebStack(process.env);
const sql = ownerSql();
const routes = import.meta.glob<Record<string, Handler>>("./**/route.ts");
let userId: string;
let token = newPat();
let params: { version_id: string; job_id: string; take_id: string };

beforeEach(async () => {
  token = newPat();
  await sql.begin(async (tx) => {
    const ctx = await actor(tx);
    userId = ctx.user_id;
    const [{ result }] =
      await tx`select ops.admin_token_create(${tx.json(ctx)}, 'Task 40 API', ${token.hash}, ${token.hint}, array['read','create','spend'], false, true, null) result`;
    expect(result.ok).toBe(true);
    const [project] =
      await tx`insert into public.projects(owner_id,topic) values(${userId},'Task 40 fixture') returning id`;
    const [version] =
      await tx`insert into public.versions(owner_id,project_id,lang,status,test_run,lyric_pack,generation_count) values(${userId},${project.id},'it','lyrics_review',true,${tx.json(pack)},1) returning id`;
    const [take] =
      await tx`insert into public.takes(owner_id,version_id,audio_preview_path,generation,take_number) values(${userId},${version.id},'fixture.mp3',1,1) returning id`;
    const [job] =
      await tx`insert into public.jobs(owner_id,version_id,stage,status,fake_providers,idempotency_key) values(${userId},${version.id},'timing','done',true,${randomUUID()}) returning id`;
    params = { version_id: version.id, job_id: job.id, take_id: take.id };
  });
});
afterEach(async () => {
  if (!userId) return;
  await sql`delete from public.idempotency_keys where actor_key in (select 'pat:' || id::text from public.agent_tokens where owner_id=${userId})`;
  await sql`delete from public.spend_caps where scope='token' and key in (select id::text from public.agent_tokens where owner_id=${userId})`;
  await sql`delete from auth.users where id=${userId}`;
  await sql`delete from public.admin_allowlist where email=${`${userId}@example.test`}`;
});
afterAll(async () => {
  await sql.end();
  await opsSql().end();
});

async function invoke(row: ApiCase, query = "", bearer = token.token) {
  const route = (
    await routes[`.${row.path.replace(/\{([^}]+)\}/g, "[$1]")}/route.ts`]()
  )[row.method];
  const req = requestFor(row, bearer, params);
  return route(query ? new Request(req.url + query, req) : req, {
    params: Promise.resolve(params),
  });
}

// The remake rows need a remake in a given stage: they have their own flow below.
const songCases = apiCases.filter((row) => !row.name.startsWith("remake"));

it.each(songCases)(
  "test-mode admin PAT: $method $path returns the $name shape",
  async (row) => {
    const status =
      row.name === "take_pick"
        ? "takes_review"
        : ["video_make", "stems_request", "visualizer_request"].includes(
              row.name,
            )
          ? "audio_ready"
          : ["video_rerender", "video_approve"].includes(row.name)
            ? "video_review"
            : ["lyrics_back", "stage_retry", "song_generate_again"].includes(
                  row.name,
                )
              ? "failed"
              : "lyrics_review";
    await sql`update public.versions set status=${status},chosen_take_id=${params.take_id} where id=${params.version_id}`;
    if (["video_rerender", "video_approve"].includes(row.name)) {
      await sql`insert into public.renders(owner_id,version_id,kind,render_attempt,qa_results) select owner_id,id,'master',render_attempt,'{"gates":[{"pass":true}]}'::jsonb from public.versions where id=${params.version_id}`;
    }
    if (row.name === "stage_retry" || row.name === "job_cancel") {
      await sql`update public.jobs set status=${row.name === "stage_retry" ? "failed" : "queued"} where id=${params.job_id}`;
    }
    const response = await invoke(row);
    const body = await response.json();
    expect(response.status, JSON.stringify(body)).toBe(200);
    expect(Object.keys(body)).toEqual(["data"]);
    expect(
      TOKEN_OPS.find((def) => def.name === row.name)?.output.safeParse(
        body.data,
      ).success,
    ).toBe(true);
    if ("jobs" in body.data) {
      expect(body.data.jobs.length).toBeGreaterThan(0);
      const ids = body.data.jobs.map((job: { job_id: string }) => job.job_id);
      const jobs =
        await sql`select fake_providers from public.jobs where id in ${sql(ids)}`;
      expect(jobs.every((job) => job.fake_providers)).toBe(true);
    }
  },
);

it("cursor pagination defaults to 20, caps at 100 and traverses descending tuples", async () => {
  await sql`with projects as (
      insert into public.projects(owner_id,topic)
      select ${userId},'Task 40 pagination ' || n from generate_series(1,21) as n
      returning id
    )
    insert into public.versions(owner_id,project_id,lang,status,test_run,updated_at)
    select ${userId},id,'it','lyrics_review',true,'2026-11-01T00:00:00Z'::timestamptz from projects`;
  const first = await (await invoke(apiCases[0])).json();
  expect(first.data.songs).toHaveLength(20);
  const last = first.data.songs.at(-1);
  const tuple = JSON.parse(
    Buffer.from(first.data.next_cursor, "base64").toString(),
  );
  expect(tuple).toEqual([last.updated_at, last.version_id]);
  const second = await (
    await invoke(
      apiCases[0],
      `?cursor=${encodeURIComponent(first.data.next_cursor)}&limit=20`,
    )
  ).json();
  expect(second.data.songs).toHaveLength(2);
  expect(second.data.next_cursor).toBeNull();
  const expected =
    await sql`select id from public.versions where owner_id=${userId} order by updated_at desc,id desc`;
  expect(
    [...first.data.songs, ...second.data.songs].map(
      (song: { version_id: string }) => song.version_id,
    ),
  ).toEqual(expected.map((row) => row.id));
  expect((await invoke(apiCases[0], "?limit=100")).status).toBe(200);
  expect((await invoke(apiCases[0], "?limit=101")).status).toBe(422);
});

it("an uncertain Kie submission returns ambiguous_spend with HTTP 409", async () => {
  await sql`update public.versions set status='failed',kie_submit_state='submitting',kie_task_id=null where id=${params.version_id}`;
  const response = await invoke(apiCases[7]);
  expect(response.status).toBe(409);
  expect(await response.json()).toMatchObject({
    error: { code: "ambiguous_spend" },
  });
});

it("OAuth bearer credentials are refused on every v1 route", async () => {
  for (const row of apiCases)
    expect((await invoke(row, "", "oauth-access-token")).status).toBe(401);
});

const workerSupport = fileURLToPath(
  new URL(
    "../../../../worker/test/support/fake-only-worker.ts",
    import.meta.url,
  ),
);
const workerRequire = createRequire(
  new URL("../../../../worker/package.json", import.meta.url),
);
// The worker of this test has no real stage: only jobs the database marked fake_providers run.
async function startFakeOnlyWorker(ownerId: string) {
  const workerId = `api-remake-${ownerId}`;
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    WORKER_ID: workerId,
    WORKER_OWNER_ID: ownerId,
  };
  // The routing must come from the job's fake_providers, never from the process.
  delete env.WORKER_FAKE;
  const child = spawn(
    process.execPath,
    [workerRequire.resolve("tsx/cli"), workerSupport],
    {
      cwd: fileURLToPath(new URL("../../../../worker/", import.meta.url)),
      windowsHide: true,
      env,
      stdio: "ignore",
    },
  );
  await until(
    async () =>
      (await sql`select 1 from public.workers where id=${workerId}`).length ===
      1,
    60_000,
    "the fake-only worker to register",
  );
  return { child, workerId };
}
async function stopWorker(worker: { child: ChildProcess; workerId: string }) {
  const { child } = worker;
  if (child.pid && child.exitCode === null)
    await new Promise<void>((resolve) => {
      child.once("exit", () => resolve());
      if (process.platform === "win32")
        execFile(
          "taskkill.exe",
          ["/PID", String(child.pid), "/T", "/F"],
          { windowsHide: true },
          () => {},
        );
      else child.kill("SIGTERM");
    });
  await sql`delete from public.workers where id=${worker.workerId}`;
}
async function until(
  done: () => Promise<boolean>,
  timeoutMs: number,
  what: string,
) {
  const deadline = Date.now() + timeoutMs;
  while (!(await done())) {
    if (Date.now() > deadline) throw new Error(`Timed out waiting for ${what}`);
    await new Promise((resolve) => setTimeout(resolve, 1500));
  }
}
async function remakeApi(
  name: string,
  options: { remakeId?: string; body?: unknown; bearer?: string } = {},
) {
  const row = apiCases.find((item) => item.name === name);
  if (!row) throw new Error(`No API case for ${name}`);
  const ids = {
    ...pathParams,
    ...(options.remakeId ? { remake_id: options.remakeId } : {}),
  };
  const route = (
    await routes[`.${row.path.replace(/\{([^}]+)\}/g, "[$1]")}/route.ts`]()
  )[row.method];
  const base = requestFor(row, options.bearer ?? token.token, ids);
  const response = await route(
    options.body === undefined
      ? base
      : new Request(base, { body: JSON.stringify(options.body) }),
    { params: Promise.resolve(ids) },
  );
  const body = await response.json();
  if (response.status === 200)
    expect(
      TOKEN_OPS.find((def) => def.name === name)?.output.safeParse(body.data)
        .success,
      `${name} output`,
    ).toBe(true);
  return { status: response.status, body };
}
const hasKey = (value: unknown, key: string): boolean =>
  Array.isArray(value)
    ? value.some((item) => hasKey(item, key))
    : value !== null && typeof value === "object"
      ? key in value || Object.values(value).some((item) => hasKey(item, key))
      : false;

it("a test-mode PAT drives a remake to an accepted song on fake providers only", async () => {
  const worker = await startFakeOnlyWorker(userId);
  let stopped = false;
  try {
    const started = await remakeApi("remake_start", {
      body: { url: remakeUrl, lang: "it" },
    });
    expect(started.status, JSON.stringify(started.body)).toBe(200);
    expect(started.body.data.jobs).toMatchObject([{ stage: "remake_ingest" }]);
    const remakeId = started.body.data.id as string;
    const read = async () => {
      const got = await remakeApi("remake_get", { remakeId });
      expect(got.status, JSON.stringify(got.body)).toBe(200);
      expect(got.body.data.untrusted).toBe(true);
      expect(hasKey(got.body.data, "source")).toBe(false);
      expect(hasKey(got.body.data, "literalTranslation")).toBe(false);
      return got.body.data;
    };
    const settled = async (what: string) => {
      let data = await read();
      await until(
        async () => {
          data = await read();
          if (data.stage === "failed")
            throw new Error(`The remake failed: ${data.error}`);
          return (
            data.stage === "review" && !data.pending && data.active_job === null
          );
        },
        90_000,
        what,
      );
      return data;
    };
    const review = await settled("the remake to reach the review");
    // The fixture rewrite reuses one phrase of the source: the gate holds the accept back.
    expect(review).toMatchObject({
      gate_ok: false,
      accept_ready: false,
      lang: "it",
    });
    expect(
      (await remakeApi("remakes_list")).body.data.remakes.map(
        (item: { remake_id: string }) => item.remake_id,
      ),
    ).toEqual([remakeId]);
    const refused = await remakeApi("remake_accept", {
      remakeId,
      body: {
        revision: review.revision,
        lyrics_text: review.lyrics_text,
        title: review.lyrics.title,
        style: "pop",
      },
    });
    expect(refused.status).toBe(409);
    expect(refused.body.error).toMatchObject({
      code: "conflict",
      message: "originality gate not passed",
    });
    const edit = await remakeApi("remake_edit", {
      remakeId,
      body: {
        revision: review.revision,
        lines: [{ index: 8, text: "il mondo corre e non mi vede" }],
      },
    });
    expect(edit.status, JSON.stringify(edit.body)).toBe(200);
    expect(edit.body.data).toMatchObject({
      revision: review.revision + 1,
      jobs: [{ stage: "remake_rewrite" }],
    });
    const checked = await settled("the edit check");
    expect(checked.revision).toBeGreaterThan(review.revision);
    expect(checked).toMatchObject({
      gate_ok: true,
      accept_ready: true,
    });
    expect(checked.lyrics_text).toContain("il mondo corre e non mi vede");
    // The song generation must stay queued for the assertions below.
    await stopWorker(worker);
    stopped = true;
    const accept = {
      revision: checked.revision,
      lyrics_text: checked.lyrics_text,
      title: checked.lyrics.title,
      style: "pop, 79 bpm",
    };
    const changed = await remakeApi("remake_accept", {
      remakeId,
      body: { ...accept, lyrics_text: `${accept.lyrics_text}!` },
    });
    expect(changed.status).toBe(409);
    expect(changed.body.error).toMatchObject({
      code: "conflict",
      message: "lyrics differ from the reviewed ones",
    });
    const accepted = await remakeApi("remake_accept", {
      remakeId,
      body: accept,
    });
    expect(accepted.status, JSON.stringify(accepted.body)).toBe(200);
    expect(accepted.body.data).toMatchObject({
      id: checked.version_id,
      jobs: [{ version_id: checked.version_id, stage: "generate_song" }],
    });
    expect(
      await sql`select status,fake_providers,token_id is not null as by_token from public.jobs where id=${accepted.body.data.jobs[0].job_id}`,
    ).toEqual([{ status: "queued", fake_providers: true, by_token: true }]);
    expect((await read()).stage).toBe("accepted");
    // Every job of the run was fake and none failed: nothing looked for a real stage.
    const jobs =
      await sql`select stage,status,fake_providers from public.jobs where version_id=${checked.version_id} order by created_at,id`;
    expect(jobs.map((job) => job.stage)).toEqual([
      "remake_ingest",
      "remake_analyse",
      "remake_rewrite",
      "remake_rewrite",
      "generate_song",
    ]);
    expect(jobs.every((job) => job.fake_providers)).toBe(true);
    expect(jobs.filter((job) => job.status === "failed")).toEqual([]);
    expect(
      await sql`select 1 from public.versions where id=${checked.version_id} and test_run and status='song_queued'`,
    ).toHaveLength(1);
  } finally {
    if (!stopped) await stopWorker(worker);
  }
}, 240_000);

it("a read-only PAT cannot start a remake and a live PAT cannot see a test remake", async () => {
  const reader = newPat();
  const live = newPat();
  await sql.begin(async (tx) => {
    const session = randomUUID();
    await tx`insert into auth.sessions (id, user_id, created_at) values (${session}, ${userId}, now())`;
    const ctx = {
      actor_kind: "session",
      user_id: userId,
      session_id: session,
      remote: false,
    };
    const [made] =
      await tx`select ops.admin_token_create(${tx.json(ctx)}, 'Remake API reader', ${reader.hash}, ${reader.hint}, array['read'], false, true, null) result`;
    expect(made.result.ok).toBe(true);
    const [other] =
      await tx`select ops.admin_token_create(${tx.json(ctx)}, 'Remake API live', ${live.hash}, ${live.hint}, array['read','create','spend'], false, false, null) result`;
    expect(other.result.ok).toBe(true);
  });
  const refused = await remakeApi("remake_start", {
    body: { url: remakeUrl, lang: "it" },
    bearer: reader.token,
  });
  expect(refused.status).toBe(403);
  expect(refused.body.error).toMatchObject({ code: "forbidden_scope" });
  expect(
    await sql`select 1 from public.remakes where owner_id=${userId}`,
  ).toHaveLength(0);
  expect(
    await sql`select 1 from public.jobs where owner_id=${userId} and stage like 'remake%'`,
  ).toHaveLength(0);
  // A test remake exists for the test token only.
  const started = await remakeApi("remake_start", {
    body: { url: remakeUrl, lang: "it" },
  });
  expect(started.status, JSON.stringify(started.body)).toBe(200);
  const remakeId = started.body.data.id as string;
  expect((await remakeApi("remake_get", { remakeId })).status).toBe(200);
  expect(
    (await remakeApi("remake_get", { remakeId, bearer: reader.token })).status,
  ).toBe(200);
  const hidden = await remakeApi("remake_get", {
    remakeId,
    bearer: live.token,
  });
  expect(hidden.status).toBe(404);
  expect(hidden.body.error).toMatchObject({ code: "not_found" });
  expect(
    (await remakeApi("remakes_list", { bearer: live.token })).body.data.remakes,
  ).toEqual([]);
  const blocked = await remakeApi("remake_cancel", {
    remakeId,
    bearer: live.token,
  });
  expect(blocked.status).toBe(403);
  expect(blocked.body.error).toMatchObject({
    code: "forbidden_scope",
    details: { reason: "test_rule" },
  });
  const cancelled = await remakeApi("remake_cancel", { remakeId });
  expect(cancelled.status, JSON.stringify(cancelled.body)).toBe(200);
  expect(cancelled.body.data).toEqual({ jobs: [] });
});
