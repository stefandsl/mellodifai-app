import { spawn as nodeSpawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { EventEmitter } from "node:events";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { createConnection } from "node:net";
import { join } from "node:path";
import { createClient } from "@supabase/supabase-js";
import postgres from "postgres";
import { afterAll, beforeAll, expect, it } from "vitest";
import type { Job, Project, Version } from "../src/db.js";
import type { Spawn } from "../src/engine.js";
import type { StageContext, StageHandler } from "../src/loop.js";
import { startFakeProviders } from "./support/fake-servers.js";

type Scenario =
  | "normal"
  | "crash-after-submit"
  | "requeue"
  | "retry-later"
  | "resume-after-resolve"
  | "cancel";
type Charge = {
  scope: string;
  key: string;
  provider: string;
  unit: string;
  period: string;
  window_start: string;
  amount: number;
};
type Entry = {
  provider: string;
  call_key: string;
  job_id: string;
  state: string;
  usd: string | null;
  usd_est: string;
  items: Record<string, number> | null;
  items_est: Record<string, number>;
};
type Result = {
  used: number;
  expected: number;
  entries: number;
  calls: number;
  states: string[];
  paidEntries: PaidCall[];
  paidCalls: PaidCall[];
};
type PaidCall = { provider: string; jobId: string; attempt: number };

function assertCallsMatch(entries: PaidCall[], calls: PaidCall[]) {
  const identity = ({ provider, jobId, attempt }: PaidCall) =>
    JSON.stringify([provider, jobId, attempt]);
  expect(entries.map(identity).sort()).toEqual(calls.map(identity).sort());
}

it("rejects matching totals attributed to the wrong provider or attempt", () => {
  const call = { provider: "kie", jobId: "job", attempt: 1 };
  const calls = [call];
  expect(() =>
    assertCallsMatch([{ ...call, provider: "groq" }], calls),
  ).toThrow();
  expect(() => assertCallsMatch([{ ...call, attempt: 2 }], calls)).toThrow();
});

const results = new Map<Scenario, Result>();
const engineRoot =
  process.env.MELLODIFAI_ENGINE_ROOT ?? "C:/Users/Asus/Documents/suno-remake";
const runtimeRoot = process.env.MELLODIFAI_ROOT ?? "E:/mellodifai";
const oldEnv = Object.fromEntries(
  [
    "KIE_API_BASE",
    "OPENROUTER_BASE_URL",
    "GROQ_BASE_URL",
    "ALLOW_TEST_KIE",
    "MELLODIFAI_ENGINE_ROOT",
  ].map((name) => [name, process.env[name]]),
);
let sql: ReturnType<typeof postgres>;
let fakes: Awaited<ReturnType<typeof startFakeProviders>>;
let draftLyrics: StageHandler;
let generateSong: StageHandler;
let replaceSection: StageHandler;
let scoreTakes: typeof import("../src/stages/score-takes.js").scoreTakes;
let serviceLedger: typeof import("../src/providers/ledger.js").serviceLedger;
let Engine: typeof import("../src/engine.js").Engine;
let SupabaseDb: typeof import("../src/db.js").SupabaseDb;
let validateEngineEntries: typeof import("../src/providers/ledger.js").validateEngineEntries;
let stackChanged = false;

async function listening(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = createConnection({ host: "127.0.0.1", port });
    socket.setTimeout(500);
    socket.once("connect", () => {
      socket.destroy();
      resolve(true);
    });
    socket.once("error", () => {
      socket.destroy();
      resolve(false);
    });
    socket.once("timeout", () => {
      socket.destroy();
      resolve(false);
    });
  });
}

beforeAll(async () => {
  if ((await listening(3210)) || (await listening(3219)))
    throw new Error("port 3210 or 3219 is busy: e2e may be running");
  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY)
    throw new Error("load the e2e test.env");
  const databaseUrl = process.env.TEST_DB_URL;
  if (!databaseUrl) throw new Error("TEST_DB_URL is required");
  const database = new URL(databaseUrl);
  const api = new URL(process.env.SUPABASE_URL);
  if (
    database.hostname !== "127.0.0.1" ||
    database.port !== "45622" ||
    api.hostname !== "127.0.0.1" ||
    api.port !== "45621"
  )
    throw new Error("ledger test requires the loopback e2e stack");
  sql = postgres(databaseUrl, { max: 2 });
  const [setting] =
    await sql`select fake_stack from public.stack_settings where id=true`;
  if (setting?.fake_stack !== true) throw new Error("fake e2e stack required");
  await sql`update public.stack_settings set fake_stack=false where id=true`;
  stackChanged = true;
  fakes = await startFakeProviders();
  process.env.KIE_API_BASE = fakes.kie.url;
  process.env.OPENROUTER_BASE_URL = `${fakes.openrouter.url}/api`;
  process.env.GROQ_BASE_URL = `${fakes.groq.url}/openai/v1`;
  process.env.ALLOW_TEST_KIE = "1";
  process.env.MELLODIFAI_ENGINE_ROOT = engineRoot;
  ({ draftLyrics } = await import("../src/stages/draft-lyrics.js"));
  ({ generateSong } = await import("../src/stages/generate-song.js"));
  ({ replaceSection } = await import("../src/stages/replace-section.js"));
  ({ scoreTakes } = await import("../src/stages/score-takes.js"));
  ({ Engine } = await import("../src/engine.js"));
  ({ SupabaseDb } = await import("../src/db.js"));
  ({ validateEngineEntries, serviceLedger } = await import(
    "../src/providers/ledger.js"
  ));
}, 30_000);

afterAll(async () => {
  try {
    if (stackChanged)
      await sql`update public.stack_settings set fake_stack=true where id=true`;
  } finally {
    await fakes?.close();
    await sql?.end();
    for (const [name, value] of Object.entries(oldEnv)) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  }
});

async function fixture(stage: Job["stage"]) {
  const user = randomUUID();
  const run = randomUUID();
  const email = `${user}@example.test`;
  return sql.begin(async (tx) => {
    await tx`insert into public.admin_allowlist(email,role) values (${email},'admin')`;
    await tx`insert into auth.users(id,email,email_confirmed_at) values (${user},${email},now())`;
    const [session] =
      await tx`insert into auth.sessions(id,user_id,created_at) values (${randomUUID()},${user},now()) returning id`;
    const [project] =
      await tx`insert into public.projects(owner_id,topic,theme) values (${user},'ledger fake providers','vbp') returning *`;
    if (!project) throw new Error("fixture project missing");
    const [version] =
      await tx`insert into public.versions(owner_id,project_id,lang) values (${user},${project.id},'it') returning *`;
    if (!version || !session)
      throw new Error("fixture version or session missing");
    await tx`insert into public.spend_caps(scope,key,provider,unit,period,"limit") values ('run',${run},'','usd','run',10)`;
    const [job] =
      await tx`insert into public.jobs(owner_id,version_id,stage,idempotency_key,run_id,attempts) values (${user},${version.id},${stage},${randomUUID()},${run},1) returning *`;
    return {
      user,
      run,
      email,
      session: session.id as string,
      project: project as Project,
      version: version as Version,
      job: job as Job,
    };
  });
}
type Fixture = Awaited<ReturnType<typeof fixture>>;

async function contextFor(f: Fixture) {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("load the e2e test.env");
  const root = join(runtimeRoot, "tmp", `ledger-${f.job.id}`);
  const ws = {
    root,
    versionsDir: join(root, "versions", "it"),
    outDir: join(root, "out", "it"),
    publicDir: join(root, "public"),
    renderDir: join(root, "render"),
  };
  await Promise.all(
    [ws.versionsDir, ws.outDir, ws.publicDir, ws.renderDir].map((dir) =>
      mkdir(dir, { recursive: true }),
    ),
  );
  const values = {
    SUPABASE_URL: url,
    SUPABASE_SERVICE_ROLE_KEY: key,
    OPENROUTER_API_KEY: "fake-openrouter-key",
    KIE_API_KEY: "fake-kie-key",
    ALLOW_TEST_KIE: "1",
    LYRICS_JURY: "off",
    LYRICS_STATE_FILE: join(root, "lyrics-state.json"),
  };
  const secrets = { values, redact: (line: string) => line };
  const service = createClient(
    values.SUPABASE_URL,
    values.SUPABASE_SERVICE_ROLE_KEY,
  );
  const db = new SupabaseDb(
    values.SUPABASE_URL,
    values.SUPABASE_SERVICE_ROLE_KEY,
    f.user,
  );
  const engine = new Engine({
    secrets,
    validateEntries: (ids, providers) =>
      validateEngineEntries(service, ids, providers),
    log: async () => {},
  }).withWorkspace(root);
  return {
    root,
    context: {
      job: f.job,
      version: f.version,
      project: f.project,
      ws,
      db,
      engine,
      secrets,
      storage: { upload: async () => {} },
      signal: new AbortController().signal,
      log: async () => {},
      progress: async () => {},
    } as StageContext,
  };
}

function observeAttempt(context: StageContext) {
  for (const fake of [fakes.kie, fakes.openrouter, fakes.groq])
    fake.attempt = {
      jobId: context.job.id,
      attempt: context.job.attempts ?? 1,
    };
}

async function runDraft(context: StageContext, valid: boolean) {
  observeAttempt(context);
  const lyrics = await readFile(
    join(engineRoot, "versions", "it", "lyrics.txt"),
    "utf8",
  );
  const l10n = {};
  fakes.openrouter.reply = () => ({
    choices: [
      {
        message: {
          content: valid
            ? JSON.stringify({
                title: "Fake ledger song",
                lyrics,
                style: "pop",
                exclude: "",
                l10n,
              })
            : "{}",
        },
      },
    ],
    usage: { prompt_tokens: 100, completion_tokens: 20, cost: 0.0001 },
  });
  return draftLyrics(context);
}

async function crashSubmit(f: Fixture, context: StageContext) {
  observeAttempt(context);
  const lyrics = await readFile(
    join(engineRoot, "versions", "it", "lyrics.txt"),
    "utf8",
  );
  const pack = {
    title: "Fake ledger song",
    lyrics,
    style: "pop",
    exclude: "",
    l10n: {},
    displayMap: {},
    settings: {
      model: "V6",
      vocalGender: "f",
      styleWeight: 0.7,
      weirdness: 0.35,
      variety: 1,
      duration: 310,
    },
  };
  context.version.lyric_pack = pack;
  await sql`update public.versions set lyric_pack=${sql.json(pack)} where id=${f.version.id}`;
  const db = context.db;
  context.db = new Proxy(db, {
    get(target, name) {
      if (name === "patchVersion")
        return async (id: string, patch: Partial<Version>) => {
          if (patch.kie_task_id)
            throw new Error("simulated crash after kie submit");
          return db.patchVersion(id, patch);
        };
      const value = Reflect.get(target, name);
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
  await expect(generateSong(context)).rejects.toThrow(
    "simulated crash after kie submit",
  );
  context.db = db;
  await sql`update public.jobs set status='failed' where id=${f.job.id}`;
  await sql`update public.versions set status='failed' where id=${f.version.id}`;
}

async function completeGeneration(context: StageContext) {
  observeAttempt(context);
  const previousKieReply = fakes.kie.reply;
  fakes.kie.reply = (path) => {
    if (path.startsWith("/api/v1/chat/credit"))
      return { code: 200, data: 1000 };
    if (path.startsWith("/api/v1/jobs/createTask"))
      return { code: 200, data: { taskId: "fake-task" } };
    if (path.startsWith("/api/v1/jobs/recordInfo"))
      return {
        code: 200,
        data: {
          state: "success",
          response: {
            data: [1, 2].map((n) => ({
              id: `fake-take-${n}`,
              audio_url: `${fakes.kie.url}/audio/${n}.mp3`,
              duration: 60,
            })),
          },
        },
      };
    if (path.startsWith("/api/v1/generate/get-timestamped-lyrics"))
      return {
        code: 200,
        data: { alignedWords: [{ word: "fake", start: 0, end: 1 }] },
      };
    return {};
  };
  const service = createClient(
    process.env.SUPABASE_URL ?? "",
    process.env.SUPABASE_SERVICE_ROLE_KEY ?? "",
  );
  context.groqLedger = () => serviceLedger(service, null, "groq", "");
  context.secrets = {
    ...context.secrets,
    values: {
      ...context.secrets.values,
      GROQ_API_KEY: "fake-groq-key",
      WORKER_ID: `ledger-${context.job.owner_id}`,
    },
  };
  const spawn: Spawn = (command, args, options) => {
    if (command === "node" && args[0] === "tools/kie.mjs")
      return nodeSpawn(command, args, options) as unknown as ReturnType<Spawn>;
    const child = Object.assign(new EventEmitter(), {
      stdout: new EventEmitter(),
      stderr: new EventEmitter(),
    });
    setImmediate(() => {
      void (async () => {
        if (command === "ffmpeg") {
          const output = args.at(-1);
          if (!output) throw new Error("preview output missing");
          await writeFile(output, "fake preview");
        } else if (
          command === "python" &&
          args.includes("tools/score_takes.py")
        ) {
          const base = options.env?.GROQ_BASE_URL;
          if (!base)
            throw new Error("Groq base URL was not passed to the child");
          await Promise.all(
            [1, 2].map(() =>
              fetch(`${base}/audio/transcriptions`, {
                method: "POST",
                body: "fake audio",
              }),
            ),
          );
          await writeFile(
            join(context.ws.outDir, "takes-score.json"),
            JSON.stringify({
              rows: [1, 2].map((n) => ({
                take: `take-${n}.mp3`,
                duration: 60,
                provider_duration: 6,
                lufs: -14,
                end_drop_db: 3,
                fidelity: 0.9,
                weak_sections: [],
                truncated: false,
              })),
            }),
          );
        } else throw new Error(`unexpected child ${command}`);
        child.emit("close", 0);
      })().catch((error: unknown) => child.emit("error", error));
    });
    return child as unknown as ReturnType<Spawn>;
  };
  context.engine = new Engine({
    spawn,
    secrets: context.secrets,
    validateEntries: (ids, providers) =>
      validateEngineEntries(service, ids, providers),
    log: async () => {},
  }).withWorkspace(context.ws.root);
  try {
    const result = await generateSong(context);
    expect(result.versionStatus).toBe("takes_review");
    if (!result.versionStatus) throw new Error("generation status missing");
    const takes =
      await sql`select scores from public.takes where version_id=${context.version.id}`;
    expect(takes).toHaveLength(2);
    expect(takes.every((take) => take.scores !== null)).toBe(true);
    await context.db.patchVersion(context.version.id, {
      ...result.patch,
      status: result.versionStatus,
    });
    await sql`update public.jobs set status='done' where id=${context.job.id}`;
  } finally {
    fakes.kie.reply = previousKieReply;
  }
}

async function snapshot(f: Fixture): Promise<Result> {
  const reservations =
    await sql`select id,state,charges from public.reservations where user_id=${f.user}`;
  const entries = await sql<
    Entry[]
  >`select e.provider,e.call_key,r.job_id,e.state,e.usd,e.usd_est,e.items,e.items_est from public.spend_entries e join public.reservations r on r.id=e.reservation_id where r.user_id=${f.user}`;
  const [counter] =
    await sql`select coalesce(sum(used),0) as used from public.spend_counters where scope='run' and key=${f.run}`;
  if (!counter) throw new Error("run counter missing");
  const expected = reservations.some((r) => r.state === "ambiguous")
    ? reservations
        .flatMap((r) => r.charges as Charge[])
        .filter((c) => c.scope === "run")
        .reduce((n, c) => n + Number(c.amount), 0)
    : entries.reduce(
        (n, e) => n + Number(e.state === "settled" ? e.usd : e.usd_est),
        0,
      );
  const paidEntries = entries.map((e) => {
    const attempt = /:(?:a)?(\d+)$/u.exec(e.call_key)?.[1];
    if (!attempt) throw new Error(`unrecognized call key: ${e.call_key}`);
    return { provider: e.provider, jobId: e.job_id, attempt: Number(attempt) };
  });
  const paidCalls = [
    ...fakes.kie.calls
      .filter((c) => c.path.startsWith("/api/v1/jobs/createTask"))
      .map((c) => ({ ...c, provider: "kie" })),
    ...fakes.openrouter.calls.map((c) => ({ ...c, provider: "openrouter" })),
    ...fakes.groq.calls
      .filter((c) => c.path.includes("/audio/transcriptions"))
      .map((c) => ({ ...c, provider: "groq" })),
  ].map(({ provider, jobId, attempt }) => {
    if (!jobId || !attempt)
      throw new Error("HTTP call has no observed job attempt");
    return { provider, jobId, attempt };
  });
  assertCallsMatch(paidEntries, paidCalls);
  return {
    used: Number(counter.used),
    expected,
    entries: entries.length,
    calls: paidCalls.length,
    paidEntries,
    paidCalls,
    states: reservations.map((r) => String(r.state)),
  };
}

async function clean(f: Fixture) {
  const reservations =
    await sql`select id,state,charges from public.reservations where user_id=${f.user}`;
  const adjustments = new Map<string, { charge: Charge; amount: number }>();
  for (const r of reservations) {
    const entries = await sql<
      Entry[]
    >`select provider,state,usd,usd_est,items,items_est from public.spend_entries where reservation_id=${r.id}`;
    const charges = r.charges as Charge[];
    const unique = new Map(
      charges.map((c) => [
        JSON.stringify([
          c.scope,
          c.key,
          c.provider,
          c.unit,
          c.period,
          c.window_start,
        ]),
        c,
      ]),
    );
    for (const [key, c] of unique) {
      const amount =
        r.state === "ambiguous"
          ? charges
              .filter(
                (x) =>
                  JSON.stringify([
                    x.scope,
                    x.key,
                    x.provider,
                    x.unit,
                    x.period,
                    x.window_start,
                  ]) === key,
              )
              .reduce((n, x) => n + Number(x.amount), 0)
          : entries
              .filter((e) => !c.provider || e.provider === c.provider)
              .reduce(
                (n, e) =>
                  n +
                  (c.unit === "usd"
                    ? Number(e.state === "settled" ? e.usd : e.usd_est)
                    : Number(
                        (e.state === "settled" ? e.items : e.items_est)?.[
                          c.unit
                        ] ?? 0,
                      )),
                0,
              );
      const prior = adjustments.get(key);
      adjustments.set(key, {
        charge: c,
        amount: (prior?.amount ?? 0) + amount,
      });
    }
  }
  const failures: unknown[] = [];
  try {
    for (const { charge: c, amount } of adjustments.values()) {
      await sql.begin(async (tx) => {
        const [counter] =
          await tx`select used from public.spend_counters where scope=${c.scope} and key=${c.key} and provider=${c.provider} and unit=${c.unit} and period=${c.period} and window_start=${c.window_start} for update`;
        try {
          if (!counter) throw new Error("charged counter missing");
          if (c.scope === "global")
            expect(Number(counter.used)).toBeGreaterThanOrEqual(
              Number(amount.toFixed(4)),
            );
          else expect(Number(counter.used)).toBeCloseTo(amount, 4);
        } catch (error) {
          failures.push(error);
        } finally {
          // Shared counters may include newer charges from other consumers.
          await tx`update public.spend_counters set used=used-round(${amount}::numeric,4) where scope=${c.scope} and key=${c.key} and provider=${c.provider} and unit=${c.unit} and period=${c.period} and window_start=${c.window_start} and used>=round(${amount}::numeric,4)`;
        }
      });
    }
  } finally {
    await sql`delete from public.reservations where user_id=${f.user}`;
    await sql`delete from public.jobs where owner_id=${f.user}`;
    await sql`delete from public.versions where owner_id=${f.user}`;
    await sql`delete from public.projects where owner_id=${f.user}`;
    await sql`delete from auth.users where id=${f.user}`;
    await sql`delete from public.admin_allowlist where email=${f.email}`;
    await sql`delete from public.spend_caps where scope='run' and key=${f.run}`;
    await sql`delete from public.spend_counters where scope='run' and key=${f.run}`;
  }
  if (failures.length)
    throw new AggregateError(failures, "Ledger counter assertions failed");
}

async function run(scenario: Scenario): Promise<Result> {
  for (const fake of [fakes.kie, fakes.openrouter, fakes.groq])
    fake.calls.length = 0;
  const f = await fixture(
    scenario === "crash-after-submit" || scenario === "resume-after-resolve"
      ? "generate_song"
      : "draft_lyrics",
  );
  const root = join(runtimeRoot, "tmp", `ledger-${f.job.id}`);
  try {
    const { context } = await contextFor(f);
    if (scenario === "cancel") {
      await sql`select ops.reserve_job(${f.job.id})`;
      const actor = {
        actor_kind: "session",
        user_id: f.user,
        session_id: f.session,
        remote: false,
      };
      const [cancelled] =
        await sql`select ops.job_cancel(${sql.json(actor)},${f.job.id}) as result`;
      expect(cancelled?.result.ok).toBe(true);
    } else if (
      scenario === "crash-after-submit" ||
      scenario === "resume-after-resolve"
    ) {
      await crashSubmit(f, context);
      if (scenario === "resume-after-resolve") {
        const actor = {
          run_id: f.run,
          actor_kind: "session",
          user_id: f.user,
          session_id: f.session,
          remote: false,
        };
        const [resolved] =
          await sql`select ops.admin_resolve_kie_submission(${sql.json(actor)},${f.version.id},true,'fake-task',null) as result`;
        if (!resolved) throw new Error("resolution result missing");
        expect(resolved.result.ok, JSON.stringify(resolved.result)).toBe(true);
        const [next] =
          await sql`select * from public.jobs where version_id=${f.version.id} and stage='generate_song' and status='queued' order by created_at desc limit 1`;
        if (!next) throw new Error("resolved job missing");
        expect(next.run_id).toBe(f.run);
        const claimed = await context.db.claim(`ledger-${f.user}`);
        expect(claimed?.id).toBe(next.id);
        if (!claimed) throw new Error("resolved job was not claimed");
        context.job = claimed;
        const version = await context.db.getVersion(f.version.id);
        if (!version) throw new Error("resolved version missing");
        context.version = version;
        await completeGeneration(context);
        expect(fakes.groq.calls).toHaveLength(2);
        expect(
          fakes.kie.calls.filter((call) =>
            call.path.startsWith("/api/v1/jobs/createTask"),
          ),
        ).toHaveLength(1);
        const [completed] =
          await sql`select status from public.jobs where id=${next.id}`;
        expect(completed?.status).toBe("done");
        const [spend] =
          await sql`select count(*)::integer as entries from public.spend_entries e join public.reservations r on r.id=e.reservation_id where r.job_id=${next.id} and e.provider='groq' and e.state='settled'`;
        expect(spend?.entries).toBe(2);
      }
    } else if (scenario === "retry-later") {
      const { WorkerLoop } = await import("../src/loop.js");
      const errors: string[] = [];
      let executions = 0;
      let notBefore = "";
      const worker = new WorkerLoop({
        db: context.db,
        workerId: `ledger-${f.user}`,
        engine: context.engine,
        storage: context.storage,
        secrets: context.secrets,
        workspace: { forVersion: async () => context.ws },
        report: (error) => errors.push(error),
        stages: {
          draft_lyrics: async (claimed) => {
            expect(claimed.job.id).toBe(f.job.id);
            executions++;
            const result = await runDraft(claimed, true);
            if (executions === 1) {
              notBefore = new Date(Date.now() + 1500).toISOString();
              return { retryLater: { reason: "integration retry", notBefore } };
            }
            return result;
          },
        },
      });
      try {
        expect(await worker.runOnce()).toBe(true);
        expect(errors).toEqual([]);
        const [queued] =
          await sql`select status,not_before from public.jobs where id=${f.job.id}`;
        expect(queued?.status).toBe("queued");
        expect(new Date(queued?.not_before).toISOString()).toBe(notBefore);
        expect(await worker.runOnce()).toBe(false);
        expect(executions).toBe(1);
        await new Promise((resolve) =>
          setTimeout(
            resolve,
            Math.max(0, Date.parse(notBefore) - Date.now()) + 50,
          ),
        );
        await expect.poll(() => worker.runOnce(), { timeout: 5000 }).toBe(true);
        expect(errors).toEqual([]);
        expect(executions).toBe(2);
        const [done] =
          await sql`select status from public.jobs where id=${f.job.id}`;
        expect(done?.status).toBe("done");
      } finally {
        await worker.stop();
      }
    } else {
      if (scenario === "requeue") {
        await expect(runDraft(context, false)).rejects.toThrow();
        await sql`update public.jobs set status='queued',attempts=2,not_before=null where id=${f.job.id}`;
        context.job.attempts = 2;
      }
      const drafted = await runDraft(context, true);
      await sql`update public.jobs set status='done' where id=${f.job.id}`;
      if (scenario === "normal") {
        const pack = drafted.patch?.lyric_pack;
        if (!pack) throw new Error("draft did not produce a lyric pack");
        context.version.lyric_pack = pack;
        await sql`update public.versions set lyric_pack=${sql.json(pack as Parameters<typeof sql.json>[0])} where id=${f.version.id}`;
        const [job] =
          await sql`insert into public.jobs(owner_id,version_id,stage,idempotency_key,run_id,attempts)
          values (${f.user},${f.version.id},'generate_song',${randomUUID()},${f.run},1) returning *`;
        if (!job) throw new Error("generation job missing");
        context.job = job as Job;
        await completeGeneration(context);
      }
    }
    if (scenario === "retry-later") {
      const [job] =
        await sql`select attempts from public.jobs where id=${f.job.id}`;
      expect(job?.attempts).toBe(3);
    }
    return await snapshot(f);
  } finally {
    await sql`update public.jobs set status='failed' where owner_id=${f.user} and status in ('queued','running')`;
    try {
      await clean(f);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  }
}

for (const scenario of [
  "normal",
  "crash-after-submit",
  "requeue",
  "retry-later",
  "resume-after-resolve",
  "cancel",
] as const) {
  it(`counters equal settled spend plus open estimates after ${scenario}`, async () => {
    const result = await run(scenario);
    results.set(scenario, result);
    expect(result.used).toBeCloseTo(result.expected, 4);
  }, 90_000);
  it(`spend entries equal the calls the fake servers observed after ${scenario} (Major 7)`, () => {
    const result = results.get(scenario);
    if (!result) throw new Error(`missing result for ${scenario}`);
    assertCallsMatch(result.paidEntries, result.paidCalls);
  });
}
it("reservations end closed, or ambiguous for crash-after-submit", () => {
  expect(results.size).toBe(6);
  for (const [scenario, result] of results) {
    expect(result.states).toHaveLength(
      scenario === "normal" || scenario === "resume-after-resolve" ? 2 : 1,
    );
    expect(
      result.states.every(
        (state) =>
          state ===
          (scenario === "crash-after-submit" ? "ambiguous" : "closed"),
      ),
    ).toBe(true);
  }
});

it("replace_section submits through the kie fake and settles its entry", async () => {
  for (const fake of [fakes.kie, fakes.openrouter, fakes.groq])
    fake.calls.length = 0;
  const f = await fixture("replace_section");
  const root = join(runtimeRoot, "tmp", `ledger-${f.job.id}`);
  try {
    const { context } = await contextFor(f);
    const [take] =
      await sql`insert into public.takes(owner_id,version_id,engine,take_number,generation,kie_task_id,kie_audio_id,audio_preview_path)
      values (${f.user},${f.version.id},'kie',1,1,'source-task','source-audio','fake-preview') returning id`;
    if (!take) throw new Error("fixture take missing");
    const [edit] =
      await sql`insert into public.section_edits(owner_id,version_id,take_id,engine,start_s,end_s,duration_s,section_lyrics,full_lyrics,old_lyrics)
      values (${f.user},${f.version.id},${take.id},'kie',10,20,60,'new lines','new full lyrics','old lines') returning id`;
    if (!edit) throw new Error("fixture section edit missing");
    const payload = { edit_id: edit.id, take_id: take.id };
    await sql`update public.jobs set payload=${sql.json(payload)} where id=${f.job.id}`;
    context.job.payload = payload;
    await writeFile(join(context.ws.outDir, "take-1.mp3"), "fake local audio");
    const spawn: Spawn = () => {
      const child = Object.assign(new EventEmitter(), {
        stdout: new EventEmitter(),
        stderr: new EventEmitter(),
      });
      setImmediate(() => {
        child.stdout.emit("data", "60\n");
        child.emit("close", 0);
      });
      return child as unknown as ReturnType<Spawn>;
    };
    context.engine = new Engine({ spawn, log: async () => {} }).withWorkspace(
      root,
    );
    observeAttempt(context);
    await expect(replaceSection(context)).rejects.toThrow();
    await sql`update public.jobs set status='failed' where id=${f.job.id}`;
    const result = await snapshot(f);
    expect(result.used).toBeCloseTo(result.expected, 4);
    expect(result.entries).toBe(1);
    expect(result.calls).toBe(1);
    expect(result.states).toEqual(["closed"]);
  } finally {
    await sql`update public.jobs set status='failed' where owner_id=${f.user} and status in ('queued','running')`;
    try {
      await clean(f);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  }
});

it("Groq scoring sends one fake transcription per spend entry", async () => {
  for (const fake of [fakes.kie, fakes.openrouter, fakes.groq])
    fake.calls.length = 0;
  const f = await fixture("import_audio");
  const root = join(runtimeRoot, "tmp", `ledger-${f.job.id}`);
  try {
    const { context } = await contextFor(f);
    const [row] =
      await sql`insert into public.takes(owner_id,version_id,engine,take_number,generation,audio_preview_path)
      values (${f.user},${f.version.id},'kie',1,1,'fake-preview') returning *`;
    if (!row) throw new Error("fixture take missing");
    const take = row as import("../src/db.js").Take;
    const service = createClient(
      process.env.SUPABASE_URL ?? "",
      process.env.SUPABASE_SERVICE_ROLE_KEY ?? "",
    );
    context.groqLedger = () => serviceLedger(service, null, "groq", "");
    context.secrets = {
      ...context.secrets,
      values: { ...context.secrets.values, GROQ_API_KEY: "fake-groq-key" },
    };
    await context.engine.run("ffmpeg", [
      "-y",
      "-f",
      "lavfi",
      "-i",
      "sine=frequency=440:duration=6",
      "-c:a",
      "libmp3lame",
      join(context.ws.outDir, "take-1.mp3"),
    ]);
    await writeFile(
      join(context.ws.versionsDir, "lyrics.txt"),
      "[Verse]\nfake",
    );
    context.engine = new Engine({
      secrets: context.secrets,
      validateEntries: (ids, providers) =>
        validateEngineEntries(service, ids, providers),
      log: async () => {},
    }).withWorkspace(root);
    observeAttempt(context);
    await scoreTakes(context, [take]);
    expect(
      JSON.parse(
        await readFile(join(context.ws.outDir, "take-1.words.json"), "utf8"),
      ),
    ).toEqual([{ word: "fake", start: 0, end: 1 }]);
    const report = JSON.parse(
      await readFile(join(context.ws.outDir, "takes-score.json"), "utf8"),
    );
    expect(report.rows).toHaveLength(1);
    expect(report.rows[0].provider_duration).toBe(6);
    const [entry] = await sql`select e.state,e.items from public.spend_entries e
      join public.reservations r on r.id=e.reservation_id where r.user_id=${f.user}`;
    expect(entry?.state).toBe("settled");
    expect(Number(entry?.items.audio_hour)).toBeCloseTo(6 / 3600, 6);
    await sql`update public.jobs set status='done' where id=${f.job.id}`;
    const result = await snapshot(f);
    expect(result.used).toBeCloseTo(result.expected, 4);
    expect(result.entries).toBe(1);
    expect(result.calls).toBe(1);
    expect(result.states).toEqual(["closed"]);
  } finally {
    await sql`update public.jobs set status='failed' where owner_id=${f.user} and status in ('queued','running')`;
    try {
      await clean(f);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  }
});

it("cleans fixtures even when a counter assertion fails", async () => {
  const f = await fixture("draft_lyrics");
  try {
    await sql`select ops.reserve_job(${f.job.id})`;
    await sql`update public.jobs set status='failed' where id=${f.job.id}`;
    await sql`update public.spend_counters set used=used+0.01 where scope='run' and key=${f.run}`;
    await expect(clean(f)).rejects.toThrow("Ledger counter assertions failed");
    const [remaining] = await sql`select
      (select count(*) from auth.users where id=${f.user}) as users,
      (select count(*) from public.reservations where user_id=${f.user}) as reservations,
      (select count(*) from public.spend_counters where scope='run' and key=${f.run}) as counters`;
    expect(Number(remaining?.users)).toBe(0);
    expect(Number(remaining?.reservations)).toBe(0);
    expect(Number(remaining?.counters)).toBe(0);
  } finally {
    await clean(f);
  }
});

it("cleanup preserves another consumer's charge on shared counters", async () => {
  const f = await fixture("draft_lyrics");
  const root = join(runtimeRoot, "tmp", `ledger-${f.job.id}`);
  let counter: Charge | undefined;
  let cleaned = false;
  let injected = false;
  try {
    const { context } = await contextFor(f);
    await runDraft(context, true);
    const [reservation] =
      await sql`select charges from public.reservations where user_id=${f.user}`;
    if (!reservation) throw new Error("reservation missing");
    counter = (reservation.charges as Charge[]).find(
      (c) => c.scope === "global" && c.unit === "usd",
    );
    if (!counter) throw new Error("global USD charge missing");
    const c = counter;
    await sql`update public.jobs set status='done' where id=${f.job.id}`;
    const [before] =
      await sql`select used from public.spend_counters where scope=${c.scope} and key=${c.key} and provider=${c.provider} and unit=${c.unit} and period=${c.period} and window_start=${c.window_start}`;
    await sql`update public.spend_counters set used=used+0.03 where scope=${c.scope} and key=${c.key} and provider=${c.provider} and unit=${c.unit} and period=${c.period} and window_start=${c.window_start}`;
    injected = true;
    // The injected charge belongs to a separate consumer, not this fixture.
    try {
      await clean(f);
    } finally {
      cleaned = true;
    }
    const [remaining] =
      await sql`select used from public.spend_counters where scope=${c.scope} and key=${c.key} and provider=${c.provider} and unit=${c.unit} and period=${c.period} and window_start=${c.window_start}`;
    expect(Number(remaining?.used)).toBeCloseTo(
      Number(before?.used) - 0.0001 + 0.03,
      4,
    );
  } finally {
    await sql`update public.jobs set status='failed' where id=${f.job.id} and status in ('queued','running')`;
    if (!cleaned) await clean(f);
    await rm(root, { recursive: true, force: true });
    if (counter && injected) {
      const c = counter;
      await sql`update public.spend_counters set used=used-0.03 where scope=${c.scope} and key=${c.key} and provider=${c.provider} and unit=${c.unit} and period=${c.period} and window_start=${c.window_start} and used>=0.03`;
    }
  }
});
