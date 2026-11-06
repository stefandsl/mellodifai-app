import { randomUUID } from "node:crypto";
import { afterAll, afterEach, beforeEach, expect, it, vi } from "vitest";
import { opsSql } from "@/lib/db/ops-client";
import { TOKEN_OPS } from "@/lib/ops/registry";
import { newPat } from "@/lib/ops/tokens";
import {
  type ApiCase,
  apiCases,
  type Handler,
  pack,
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

it.each(apiCases)(
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
