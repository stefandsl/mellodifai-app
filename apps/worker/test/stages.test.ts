import { EventEmitter } from "node:events";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { runtimeRoot } from "@mellodifai/remake";
import { LyricPackSchema, type Stage } from "@mellodifai/shared";
import { afterEach, describe, expect, it, vi } from "vitest";
import { InMemoryDb } from "../src/db.js";
import { Engine, type Spawn } from "../src/engine.js";
import { createFakeStages, fakePack } from "../src/fake/index.js";
import { type StageContext, WorkerLoop } from "../src/loop.js";
import { startBalanceRefresh } from "../src/main.js";
import { childEnvironment, loadSecrets } from "../src/secrets.js";
import { refreshBalance } from "../src/stages/generate-song.js";
import { stages } from "../src/stages/index.js";
import { nextPacificQuotaTime } from "../src/stages/quota.js";
import { ENGINE_ROOT, writePack } from "../src/stages/utils.js";

vi.mock("node:fs/promises", async (importOriginal) => {
  const fs = await importOriginal<typeof import("node:fs/promises")>();
  return {
    ...fs,
    readFile: (...args: Parameters<typeof fs.readFile>) =>
      String(args[0]).includes("suno-remake")
        ? Promise.resolve(
            String(args[0]).endsWith("lyrics.txt")
              ? Array.from({ length: 80 }, () => "reference pack fixture").join(
                  "\n",
                )
              : "reference pack fixture",
          )
        : fs.readFile(...args),
  };
});

const roots: string[] = [];
it.each([0, 1, 2, 3])(
  "handles Kie wait exit %s without resubmitting",
  async (code) => {
    const { ctx, calls, db } = await setup();
    ctx.secrets.redact = (s) => s.replaceAll("secret-value", "***");
    const run = ctx.engine.run.bind(ctx.engine);
    const wait = vi
      .spyOn(ctx.engine, "run")
      .mockImplementation(async (cmd, args, opts) => {
        if (args[1] === "wait" && code !== 0) {
          opts?.onStderr?.(
            `failed: {"reason":"secret-value rejected ${"x".repeat(400)}"}`,
          );
          return { code, stdout: "", stderr: "" };
        }
        return run(cmd, args, opts);
      });
    if (code === 0) {
      await expect(stages.generate_song?.(ctx)).resolves.toMatchObject({
        versionStatus: "takes_review",
      });
      return;
    }
    const result = await stages.generate_song?.(ctx).catch((e: Error) => e);
    expect(result).toBeInstanceOf(Error);
    const message = (result as Error).message;
    expect(ctx.version.kie_task_id).toBe("task-1");
    if (code === 2) {
      expect(db.versions[0]).toMatchObject({ kie_task_state: "failed" });
      expect(message).toContain("*** rejected");
      expect(message).not.toContain("secret-value");
      expect(message.length).toBeLessThanOrEqual(300);
      const count = wait.mock.calls.length;
      await expect(stages.generate_song?.(ctx)).rejects.toThrow(
        "kie task failed",
      );
      expect(wait.mock.calls).toHaveLength(count);
      ctx.version.generation_count = 2;
      wait.mockImplementation(run);
      await expect(stages.generate_song?.(ctx)).resolves.toMatchObject({
        versionStatus: "takes_review",
      });
      expect(ctx.version.kie_task_state).not.toBe("failed");
    } else {
      expect(message).toBe(
        "kie task still pending: Retry checks again for free",
      );
      expect(ctx.version.kie_task_state).not.toBe("failed");
      wait.mockImplementation(run);
      await expect(stages.generate_song?.(ctx)).resolves.toMatchObject({
        versionStatus: "takes_review",
      });
      expect(calls.filter((c) => c.args[1] === "generate")).toHaveLength(1);
    }
  },
);
it.each(["list", "remove"])(
  "does not fail an uploaded preview on prune %s error",
  async (failure) => {
    const { ctx, db } = await setup();
    ctx.log = vi.fn(async () => {});
    ctx.storage.remove = vi.fn(async () => {});
    if (failure === "list")
      vi.spyOn(db, "previewRows").mockRejectedValue(
        new Error("list unavailable"),
      );
    else
      vi.mocked(ctx.storage.remove).mockRejectedValue(
        new Error("remove unavailable"),
      );
    await expect(stages.render_master?.(ctx)).resolves.toBeDefined();
    expect(ctx.log).toHaveBeenCalledWith(
      expect.stringContaining("Preview cleanup failed"),
    );
  },
);
it("prunes only superseded previews of this version after upload succeeds", async () => {
  const { ctx, db } = await setup();
  ctx.version.generation_count = 2;
  db.renders.push({
    id: "old",
    version_id: "version",
    kind: "master",
    render_attempt: 6,
    preview_path: "previews/owner/project/fr/version/6/master-preview.mp4",
    qa_results: {
      assets: {
        thumbnail_path: "previews/owner/project/fr/version/6/thumbnail.png",
      },
    },
  });
  db.renders.push({
    id: "foreign",
    version_id: "other",
    kind: "master",
    render_attempt: 1,
    preview_path: "other.mp4",
  });
  db.takes.push({
    id: "old-take",
    version_id: "version",
    generation: 1,
    audio_preview_path: "previews/owner/project/fr/old-take.mp3",
  });
  const remove = vi.fn(async () => {});
  ctx.storage.remove = remove;
  vi.mocked(ctx.storage.upload).mockRejectedValueOnce(new Error("offline"));
  await expect(stages.render_master?.(ctx)).rejects.toThrow("offline");
  expect(remove).not.toHaveBeenCalled();
  await stages.render_master?.(ctx);
  expect(remove).toHaveBeenCalledWith(
    expect.arrayContaining([
      "previews/owner/project/fr/version/6/master-preview.mp4",
      "previews/owner/project/fr/version/6/thumbnail.png",
      "previews/owner/project/fr/old-take.mp3",
    ]),
  );
  expect(JSON.stringify(remove.mock.calls)).not.toContain("other.mp4");
  expect(JSON.stringify(remove.mock.calls)).not.toContain(
    "/7/master-preview.mp4",
  );
});
it("retains the preview of a published render after rerendering", async () => {
  const { ctx, db } = await setup();
  db.renders.push({
    id: "published",
    version_id: ctx.version.id,
    kind: "master",
    render_attempt: 6,
    preview_path: "previews/owner/project/fr/version/6/master-preview.mp4",
    qa_results: {
      assets: {
        thumbnail_path: "previews/owner/project/fr/version/6/thumbnail.png",
      },
    },
  });
  db.publications.push({
    id: "publication",
    render_id: "published",
    privacy: "private",
  });
  const remove = vi.fn(async () => {});
  ctx.storage.remove = remove;
  await stages.render_master?.(ctx);
  expect(JSON.stringify(remove.mock.calls)).not.toContain(
    "previews/owner/project/fr/version/6/master-preview.mp4",
  );
  expect(JSON.stringify(remove.mock.calls)).not.toContain(
    "previews/owner/project/fr/version/6/thumbnail.png",
  );
});
it("never prunes a render path outside its own attempt", async () => {
  const { ctx, db } = await setup();
  db.renders.push({
    id: "tampered",
    version_id: ctx.version.id,
    kind: "master",
    render_attempt: 6,
    preview_path: "previews/other/project/fr/version/6/master-preview.mp4",
    qa_results: {
      assets: {
        thumbnail_path: "previews/owner/project/fr/another/6/thumbnail.png",
      },
    },
  });
  const remove = vi.fn(async () => {});
  ctx.storage.remove = remove;
  await stages.render_master?.(ctx);
  expect(JSON.stringify(remove.mock.calls)).not.toContain("previews/other/");
  expect(JSON.stringify(remove.mock.calls)).not.toContain("/another/");
});
it("keeps an approved thumbnail until it has been copied to the new attempt", async () => {
  const { ctx, db } = await setup();
  const thumbnail = "previews/owner/project/fr/version/6/thumbnail.png";
  const current = db.renders.find((r) => r.render_attempt === 7);
  if (!current) throw new Error("Current render missing");
  current.qa_results = { assets: { thumbnail_path: thumbnail } };
  db.renders.push({
    id: "old",
    version_id: ctx.version.id,
    kind: "master",
    render_attempt: 6,
    preview_path: "previews/owner/project/fr/version/6/master-preview.mp4",
    qa_results: { assets: { thumbnail_path: thumbnail } },
  });
  const remove = vi.fn(async () => {});
  ctx.storage.remove = remove;
  await stages.render_master?.(ctx);
  expect(JSON.stringify(remove.mock.calls)).not.toContain(thumbnail);
});
it.each([
  [4, "balance 3 credits < 12 needed", true],
  [1, "Error: HTTP 503 /api/v1/chat/credit: unavailable", true],
  [1, 'Error: HTTP 200 /api/v1/jobs/createTask: {"code":402}', true],
  [1, 'Error: HTTP 400 /api/v1/jobs/createTask: {"code":400}', true],
  [1, 'Error: HTTP 400 /api/v1/jobs/createTask: {"code":"402"}', false],
  [
    1,
    'Error: HTTP 400 /api/v1/jobs/createTask: {"code":200,"data":{"taskId":"accepted"}}',
    false,
  ],
  [1, 'Error: HTTP 400 /api/v1/jobs/createTask: {"code":false}', false],
  [1, 'Error: HTTP 400 /api/v1/jobs/createTask: {"code":[]}', false],
  [1, 'Error: HTTP 400 /api/v1/jobs/createTask: {"code":"invalid"}', false],
  [1, "Error: HTTP 500 /api/v1/jobs/createTask: unavailable", false],
  [1, 'Error: HTTP 200 /api/v1/jobs/createTask: {"code":500}', false],
  [1, 'Error: HTTP 400 /api/v1/jobs/createTask: {"code":500}', false],
  [1, 'Error: HTTP 502 /api/v1/jobs/createTask: {"code":402}', false],
  [1, 'Error: HTTP 200 /api/v1/jobs/createTask: {"code":', false],
  [
    1,
    `Error: HTTP 400 /api/v1/jobs/createTask: ${JSON.stringify({ code: 500, msg: "x".repeat(600) }).slice(0, 500)}`,
    false,
  ],
  [1, "TypeError: fetch failed", false],
  [1, "process crashed after POST", false],
  [1, "", false],
] as const)(
  "classifies Kie exit %s stderr %s safely",
  async (code, stderr, notCharged) => {
    const { ctx, output, calls, db } = await setup();
    output.submitCode = code;
    output.submitError = stderr;
    await expect(stages.generate_song?.(ctx)).rejects.toThrow(
      notCharged ? "not charged" : "unknown",
    );
    expect(ctx.version.kie_submit_state).toBe(notCharged ? null : "submitting");
    if (notCharged) {
      output.submitCode = 0;
      await expect(stages.generate_song?.(ctx)).resolves.toMatchObject({
        versionStatus: "takes_review",
      });
    } else {
      expect(db.versions[0]?.kie_submit_state).toBe("submitting");
      await expect(
        readFile(
          join(
            ctx.ws.outDir,
            `submitting-${ctx.version.generation_count ?? 1}.json`,
          ),
          "utf8",
        ),
      ).resolves.toContain('"state":"submitting"');
      await expect(stages.generate_song?.(ctx)).rejects.toThrow("unknown");
      expect(calls.filter((c) => c.args[1] === "generate")).toHaveLength(1);
    }
  },
);
describe("take scoring at the end of generate_song", () => {
  const GROQ = "groq-test-secret-value";
  async function scoringSetup() {
    const result = await setup();
    result.ctx.secrets.values = {
      ...result.ctx.secrets.values,
      GROQ_API_KEY: GROQ,
    };
    result.ctx.secrets.redact = (line) => line.replaceAll(GROQ, "***");
    return result;
  }
  const scoreCalls = (calls: Awaited<ReturnType<typeof setup>>["calls"]) =>
    calls.filter((call) =>
      call.args.some((arg) => arg.endsWith("score_takes.py")),
    );

  it("adds the chosen tempo, key and time signature to the style kie receives", async () => {
    const { ctx } = await scoringSetup();
    ctx.project.song_settings = {
      engine: "kie",
      bpm: 128,
      keyscale: "F# minor",
      timeSignature: "3",
    };
    await stages.generate_song?.(ctx);
    const style = await readFile(join(ctx.ws.versionsDir, "style.txt"), "utf8");
    expect(style).toBe(`${pack.style}, 128 BPM, F# minor, 3/4 time`);
    // The stored lyric pack keeps the style as drafted.
    expect((ctx.version.lyric_pack as { style: string }).style).toBe(
      pack.style,
    );
  });
  it("sends kie the style as drafted when tempo, key and signature are Auto", async () => {
    const { ctx } = await scoringSetup();
    await stages.generate_song?.(ctx);
    expect(await readFile(join(ctx.ws.versionsDir, "style.txt"), "utf8")).toBe(
      pack.style,
    );
  });
  it("scores both takes with Groq and stores the scores on each take", async () => {
    const { ctx, db, calls } = await scoringSetup();
    const result = await stages.generate_song?.(ctx);
    expect(result?.versionStatus).toBe("takes_review");
    const [call, ...others] = scoreCalls(calls);
    expect(others).toHaveLength(0);
    expect(call).toMatchObject({
      cmd: "python",
      args: [
        "-I",
        "-X",
        "utf8",
        "tools/score_takes.py",
        "fr",
        "--workspace",
        ctx.ws.root,
        "--min-duration",
        "0",
      ],
      cwd: ENGINE_ROOT,
      env: { GROQ_API_KEY: GROQ },
    });
    const generated = db.takes.filter(
      (take) => take.generation === 1 && take.take_number,
    );
    expect(generated.map((take) => take.scores)).toEqual([
      {
        fidelity: 0.91,
        duration: 212.4,
        endDropDb: 30.5,
        weakSections: [],
        truncated: false,
      },
      {
        fidelity: 0.62,
        duration: 198,
        endDropDb: 4,
        weakSections: ["Bridge 20%"],
        truncated: true,
      },
    ]);
  });
  it("removes the previous report first so an old generation is never read", async () => {
    const { ctx } = await scoringSetup();
    const run = vi.spyOn(ctx.engine, "run");
    await stages.generate_song?.(ctx);
    const options = run.mock.calls.find(([, args]) =>
      args.some((arg) => arg.endsWith("score_takes.py")),
    )?.[2];
    expect(options?.clearOutputs).toEqual([
      join(ctx.ws.outDir, "takes-score.json"),
    ]);
  });
  it("never lets the Groq key reach the log", async () => {
    const { ctx } = await scoringSetup();
    const run = ctx.engine.run.bind(ctx.engine);
    vi.spyOn(ctx.engine, "run").mockImplementation(async (cmd, args, opts) => {
      if (args.some((arg) => arg.endsWith("score_takes.py")))
        throw new Error(`Groq HTTP 401 for ${GROQ}`);
      return run(cmd, args, opts);
    });
    await stages.generate_song?.(ctx);
    const logged = vi.mocked(ctx.log).mock.calls.map(([line]) => line);
    expect(logged.some((line) => line.includes("Take scoring failed"))).toBe(
      true,
    );
    expect(logged.join(" ")).not.toContain(GROQ);
  });
  it.each([
    ["the scorer exits with an error", "exit"],
    ["takes-score.json is not JSON", "garbage"],
    ["takes-score.json has no usable rows", "empty"],
  ])("still finishes the version when %s", async (_name, failure) => {
    const { ctx, db, output } = await scoringSetup();
    if (failure === "garbage") output.scores = "not json at all";
    if (failure === "empty") output.scores = { rows: [{ take: "take-9.mp3" }] };
    if (failure === "exit") {
      const run = ctx.engine.run.bind(ctx.engine);
      vi.spyOn(ctx.engine, "run").mockImplementation(
        async (cmd, args, opts) => {
          if (args.some((arg) => arg.endsWith("score_takes.py")))
            throw new Error("python exited 1");
          return run(cmd, args, opts);
        },
      );
    }
    await expect(stages.generate_song?.(ctx)).resolves.toMatchObject({
      versionStatus: "takes_review",
    });
    const generated = db.takes.filter(
      (take) => take.generation === 1 && take.take_number,
    );
    expect(generated).toHaveLength(2);
    expect(generated.every((take) => take.scores === undefined)).toBe(true);
  });
  it("tolerates a log sink that is down while scoring fails", async () => {
    const { ctx } = await scoringSetup();
    const run = ctx.engine.run.bind(ctx.engine);
    vi.spyOn(ctx.engine, "run").mockImplementation(async (cmd, args, opts) => {
      if (args.some((arg) => arg.endsWith("score_takes.py")))
        throw new Error("python exited 1");
      return run(cmd, args, opts);
    });
    const log = ctx.log;
    ctx.log = async (line) => {
      if (line.includes("Take scoring failed")) throw new Error("log down");
      return log(line);
    };
    await expect(stages.generate_song?.(ctx)).resolves.toMatchObject({
      versionStatus: "takes_review",
    });
  });
  it("does not score, and says so, when the worker has no Groq key", async () => {
    const { ctx, calls } = await setup();
    await stages.generate_song?.(ctx);
    expect(scoreCalls(calls)).toHaveLength(0);
    expect(
      vi
        .mocked(ctx.log)
        .mock.calls.some(([line]) => line.includes("GROQ_API_KEY")),
    ).toBe(true);
  });
});
describe("round 2 hardening", () => {
  it("balance refresh also tolerates an unavailable log sink", async () => {
    const { ctx } = await setup();
    ctx.log = async () => {
      throw new Error("log unavailable");
    };
    await expect(refreshBalance(ctx)).resolves.toBeUndefined();
  });
  it("refuses historical client-written publication ids without worker upload provenance", async () => {
    const { ctx, db, calls } = await setup();
    const render = db.renders[0];
    if (!render) throw new Error("missing fixture");
    await db.createPublication({
      render_id: render.id,
      privacy: "public",
      youtube_video_id: "forged",
      upload_state: "pending",
      confirmed_by: "owner",
      confirmed_at: new Date().toISOString(),
    });
    await expect(stages.set_privacy?.(ctx)).rejects.toThrow("uploaded");
    expect(calls).toHaveLength(0);
  });
  it("archives the previous generation only on explicit generation_count change", async () => {
    const { ctx, db } = await setup();
    await stages.generate_song?.(ctx);
    await writeFile(join(ctx.ws.outDir, "take-1.mp3"), "old take");
    ctx.version.generation_count = 2;
    await stages.generate_song?.(ctx);
    expect(
      JSON.parse(
        await readFile(join(ctx.ws.outDir, "gen-1", "task.json"), "utf8"),
      ),
    ).toMatchObject({ taskId: "task-1" });
    expect(
      await readFile(join(ctx.ws.outDir, "gen-1", "take-1.mp3"), "utf8"),
    ).toBe("old take");
    expect(db.takes.filter((t) => t.generation === 2)).toHaveLength(2);
  });
  it("refuses a local submitting marker even when the database state was lost", async () => {
    const { ctx, calls } = await setup();
    await writeFile(join(ctx.ws.outDir, "submitting-1.json"), "{}");
    await expect(stages.generate_song?.(ctx)).rejects.toThrow(
      "kie submission state unknown",
    );
    expect(calls).toHaveLength(0);
  });
  it.each([false, true])(
    "restores an admin-resolved task before wait (stale file: %s)",
    async (stale) => {
      const { ctx, calls } = await setup();
      ctx.version.kie_task_id = "recovered-task";
      ctx.version.kie_submit_state = "submitted";
      await writeFile(join(ctx.ws.outDir, "submitting-1.json"), "{}");
      if (stale)
        await writeFile(
          join(ctx.ws.outDir, "task.json"),
          JSON.stringify({ taskId: "stale-task" }),
        );
      const run = ctx.engine.run.bind(ctx.engine);
      vi.spyOn(ctx.engine, "run").mockImplementation(
        async (cmd, args, opts) => {
          if (args[1] === "wait")
            expect(
              JSON.parse(
                await readFile(join(ctx.ws.outDir, "task.json"), "utf8"),
              ),
            ).toMatchObject({ taskId: "recovered-task" });
          return run(cmd, args, opts);
        },
      );
      await stages.generate_song?.(ctx);
      expect(calls.some((c) => c.args.includes("generate"))).toBe(false);
      expect(calls.some((c) => c.args.includes("wait"))).toBe(true);
    },
  );
  it("limits concurrent quota reservations and deduplicates the same render", async () => {
    const { db } = await setup();
    const renders = await Promise.all(
      Array.from({ length: 5 }, (_, n) =>
        db.upsertRender({ version_id: `v${n}`, kind: "master" }),
      ),
    );
    const results = await Promise.all(
      renders.map((r) => db.reserveUpload(r, "worker")),
    );
    expect(results.filter((r) => r.kind === "reserved")).toHaveLength(4);
    expect(results.filter((r) => r.kind === "quota")).toHaveLength(1);
    const first = renders[0];
    if (!first) throw new Error("fixture missing");
    expect((await db.reserveUpload(first, "worker")).kind).toBe("uploading");
    expect((await db.getWorker("worker"))?.youtube_uploads_today).toBe(4);
  });
  it("refreshes balance at startup so the badge is never blank", async () => {
    vi.useFakeTimers();
    const refresh = vi.fn(async () => {});
    const stop = startBalanceRefresh(refresh);
    expect(refresh).toHaveBeenCalledTimes(1);
    await stop();
  });
  it("refreshes balance every ten minutes without overlapping or leaking a timer", async () => {
    vi.useFakeTimers();
    let release = () => {};
    const refresh = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          release = resolve;
        }),
    );
    const stop = startBalanceRefresh(refresh);
    await vi.advanceTimersByTimeAsync(600000);
    expect(refresh).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(600000);
    expect(refresh).toHaveBeenCalledTimes(1);
    release();
    await stop();
    await vi.advanceTimersByTimeAsync(600000);
    expect(refresh).toHaveBeenCalledTimes(1);
  });
  it.each([
    ["2026-11-01T08:30:00Z", "2026-11-02T08:05:00.000Z"],
    ["2026-03-08T09:30:00Z", "2026-03-09T07:05:00.000Z"],
  ])("defers to Pacific midnight across DST (%s)", (now, expected) => {
    expect(nextPacificQuotaTime(new Date(now))).toBe(expected);
  });
  it("rejects foreign payload ids even when the stage and row ownership are valid", async () => {
    const { ctx, db, calls } = await setup();
    db.jobs.push({ ...ctx.job, payload: { take_id: "foreign" } });
    const loop = new WorkerLoop({
      db,
      workerId: "worker",
      stages,
      engine: ctx.engine,
      storage: ctx.storage,
      secrets: ctx.secrets,
      workspace: { forVersion: async () => ctx.ws },
    });
    await loop.runOnce();
    expect(db.jobs[0]?.error).toContain("payload");
    expect(calls).toHaveLength(0);
  });
  it("clears old timing before a failed pipeline and never exposes old files", async () => {
    const { ctx } = await setup();
    const path = join(ctx.ws.publicDir, "data", "fr", "timing.json");
    ctx.engine = new Engine({
      log: async () => {},
      spawn: () => {
        const child = new EventEmitter();
        setImmediate(() => child.emit("close", 3));
        return child;
      },
    });
    await expect(stages.timing?.(ctx)).rejects.toThrow("bash exited 3");
    await expect(readFile(path)).rejects.toThrow();
  });
  it("throws on nonzero exit with only the last 20 redacted lines and deletes stale outputs", async () => {
    const { ctx } = await setup();
    const file = join(ctx.ws.renderDir, "video.mp4");
    await writeFile(file, "old");
    const engine = new Engine({
      secrets: {
        values: { KEY: "long-secret" },
        redact: (s) => s.replaceAll("long-secret", "***"),
      },
      log: async () => {},
      spawn: () => {
        const child = Object.assign(new EventEmitter(), {
          stdout: new EventEmitter(),
        });
        setImmediate(() => {
          for (let i = 0; i < 25; i++)
            child.stdout.emit("data", `line-${i}:long-secret\n`);
          child.emit("close", 2);
        });
        return child as unknown as ReturnType<Spawn>;
      },
    });
    await expect(
      engine.run("ffmpeg", [file], { outputs: [file] }),
    ).rejects.toThrow("ffmpeg exited 2");
    await expect(readFile(file)).rejects.toThrow();
    try {
      await engine.run("ffmpeg", []);
    } catch (error) {
      const message = String(error);
      expect(message).toContain("line-24:***");
      expect(message).not.toContain("line-4:");
      expect(message).not.toContain("long-secret");
    }
  });
  it("preserves system paths despite short private values", () => {
    expect(
      childEnvironment(
        {
          PATH: "C:\\python1",
          SystemRoot: "C:\\Windows",
          WORKER_FAKE: "1",
          ALIAS: "prefix-long-secret",
        },
        {
          values: { WORKER_FAKE: "1", KEY: "long-secret" },
          secretNames: ["WORKER_FAKE", "KEY"],
          redact: (s) => s,
        },
      ),
    ).toMatchObject({
      PATH: "C:\\python1",
      SystemRoot: "C:\\Windows",
      ALIAS: "prefix-long-secret",
    });
  });
  it("rejects unauthorized stages and foreign payload ids before engine invocation", async () => {
    const { ctx, db, calls } = await setup();
    ctx.version.status = "drafting";
    ctx.job.owner_id = "owner";
    ctx.project.owner_id = "owner";
    db.jobs.push({
      ...ctx.job,
      stage: "publish",
      payload: { version_id: "foreign" },
    });
    const loop = new WorkerLoop({
      db,
      workerId: "worker",
      stages,
      engine: ctx.engine,
      storage: ctx.storage,
      secrets: ctx.secrets,
      workspace: { forVersion: async () => ctx.ws },
    });
    await loop.runOnce();
    expect(calls).toHaveLength(0);
    expect(db.jobs[0]?.error).toMatch(/not allowed|payload/u);
  });
  it("defers claims until not_before", async () => {
    const { ctx, db } = await setup();
    db.jobs.push({
      ...ctx.job,
      not_before: new Date(Date.now() + 60000).toISOString(),
    });
    expect(await db.claim("worker")).toBeNull();
  });
  it.each(["private", "unlisted", "public", "scheduled"] as const)(
    "applies %s before changing version visibility",
    async (privacy) => {
      const { ctx, db } = await setup();
      const render = db.renders[0];
      if (!render) throw new Error("missing fixture");
      await db.createPublication({
        render_id: render.id,
        privacy,
        confirmed_by: "owner",
        confirmed_at: new Date().toISOString(),
        youtube_video_id: "abc123",
        upload_state: "uploaded",
        publish_at: new Date(Date.now() + 3600000).toISOString(),
      });
      expect((await stages.set_privacy?.(ctx))?.versionStatus).toBe(
        privacy === "public" || privacy === "scheduled"
          ? "published"
          : "approved",
      );
      expect(db.publications[0]?.privacy_applied).toBe(privacy);
    },
  );
  it.each(["uploading", "uploaded"] as const)(
    "never repeats an upload in state %s",
    async (state) => {
      const { ctx, db, calls } = await setup();
      await db.createPublication({
        render_id: db.renders[0]?.id ?? "",
        privacy: "private",
        upload_state: state,
        youtube_video_id: state === "uploaded" ? "abc123" : null,
      });
      if (state === "uploading")
        await expect(stages.publish?.(ctx)).rejects.toThrow(
          "upload state unknown, check YouTube Studio",
        );
      else await stages.publish?.(ctx);
      expect(calls).toHaveLength(0);
    },
  );
  it("reserves publication and quota before upload, even when the response is lost", async () => {
    const { ctx, db } = await setup();
    const original = ctx.engine.withWorkspace.bind(ctx.engine);
    vi.spyOn(ctx.engine, "withWorkspace").mockImplementation((...args) => {
      const e = original(...args);
      vi.spyOn(e, "run").mockImplementation(async () => {
        expect(db.publications[0]?.upload_state).toBe("uploading");
        expect((await db.getWorker("worker"))?.youtube_uploads_today).toBe(1);
        throw new Error("connection lost");
      });
      return e;
    });
    await expect(stages.publish?.(ctx)).rejects.toThrow("connection lost");
    await expect(stages.publish?.(ctx)).rejects.toThrow("upload state unknown");
  });
  it("rejects publishing paths outside workspace", async () => {
    const { ctx, db, calls } = await setup();
    if (!db.renders[0]) throw new Error("missing fixture");
    db.renders[0].path = "C:\\private\\video.mp4";
    await expect(stages.publish?.(ctx)).rejects.toThrow("workspace");
    expect(calls).toHaveLength(0);
  });
  it("schedules from private and requires a future publish_at", async () => {
    const { ctx, db, calls } = await setup();
    const pub = await db.createPublication({
      render_id: db.renders[0]?.id ?? "",
      privacy: "scheduled",
      upload_state: "uploaded",
      youtube_video_id: "abc123",
      confirmed_at: "2026-01-01",
      confirmed_by: "owner",
      publish_at: "2000-01-01T00:00:00Z",
    });
    await expect(stages.set_privacy?.(ctx)).rejects.toThrow("future");
    pub.publish_at = new Date(Date.now() + 3600000).toISOString();
    await stages.set_privacy?.(ctx);
    expect(calls.at(-1)?.args).toEqual([
      "-I",
      "-X",
      "utf8",
      "publish/yt.py",
      "privacy",
      "abc123",
      "private",
      "--publish-at",
      pub.publish_at,
      "--confirm",
    ]);
  });
  it("does not resubmit ambiguous Kie submissions", async () => {
    const { ctx, calls } = await setup();
    ctx.version.kie_submit_state = "submitting";
    await expect(stages.generate_song?.(ctx)).rejects.toThrow(
      "kie submission state unknown, check the kie dashboard",
    );
    expect(calls.some((c) => c.args.includes("generate"))).toBe(false);
  });
  it("persists Kie task before wait and upserts numbered takes", async () => {
    const { ctx, db } = await setup();
    const run = ctx.engine.run.bind(ctx.engine);
    vi.spyOn(ctx.engine, "run").mockImplementation(async (cmd, args, opts) => {
      if (args[1] === "generate")
        expect(ctx.version.kie_submit_state).toBe("submitting");
      if (args[1] === "wait") expect(ctx.version.kie_task_id).toBe("task-1");
      return run(cmd, args, opts);
    });
    await stages.generate_song?.(ctx);
    await stages.generate_song?.(ctx);
    expect(db.takes.filter((t) => t.take_number)).toHaveLength(2);
  });
  it("balance failures do not fail generation", async () => {
    const { ctx } = await setup();
    const original = ctx.engine.withWorkspace.bind(ctx.engine);
    vi.spyOn(ctx.engine, "withWorkspace").mockImplementation((...args) => {
      const e = original(...args);
      vi.spyOn(e, "run").mockRejectedValue(new Error("balance unavailable"));
      return e;
    });
    expect((await stages.generate_song?.(ctx))?.versionStatus).toBe(
      "takes_review",
    );
  });
  it("uses take_number and cuts before Final Chorus", async () => {
    const { ctx, db, calls } = await setup();
    if (!db.takes[0]) throw new Error("missing fixture");
    db.takes[0].take_number = 2;
    await writeFile(
      join(ctx.ws.publicDir, "data", "fr", "timing.json"),
      JSON.stringify({
        duration: 100,
        sections: [
          {
            name: "Final Chorus",
            lines: [{ words: [{ start: 60, end: 61 }] }],
          },
        ],
      }),
    );
    const result = await stages.timing?.(ctx);
    expect(calls[0]?.args).toEqual(["tools/workspace_pipeline.sh", "fr", "2"]);
    expect(calls[1]?.args).toContain("52");
    expect(result?.versionStatus).toBe("producing");
  });
  it("times a take that has no kie alignment without passing an aligned file", async () => {
    const { ctx, calls } = await setup();
    // A local engine leaves only out/<lang>/take-N.mp3; kie also writes aligned-take<N>.json.
    await writeFile(join(ctx.ws.outDir, "take-1.mp3"), "audio");
    await expect(
      readFile(join(ctx.ws.outDir, "aligned-take1.json")),
    ).rejects.toThrow();
    const result = await stages.timing?.(ctx);
    expect(result?.versionStatus).toBe("producing");
    expect(calls[0]?.args).toEqual(["tools/workspace_pipeline.sh", "fr", "1"]);
    expect(calls.flatMap((call) => call.args).join(" ")).not.toContain(
      "aligned",
    );
  });
  it("art creates and uploads SRT before video_review", async () => {
    const { ctx, calls } = await setup();
    await stages.art?.(ctx);
    expect(calls.some((c) => c.args.includes("tools/make_srt.py"))).toBe(true);
    expect(ctx.storage.upload).toHaveBeenCalledTimes(2);
  });
  it("QA fails closed and samples the real duration without exposing video_review", async () => {
    const { ctx, db, calls } = await setup();
    ctx.version.qa_flags = [];
    const result = await stages.qa?.(ctx);
    expect(result?.versionStatus).toBeUndefined();
    expect(calls.at(-1)?.args).toContain("fps=20/10,scale=320:-1,tile=5x4");
    expect(JSON.stringify(db.renders[0]?.qa_results)).toContain("not measured");
  });
  it("includes mood and vocal gender in the draft prompt", async () => {
    const { ctx } = await setup();
    ctx.project.mood = "hopeful";
    ctx.project.vocal_gender = "m";
    const fetch = vi.fn(async () => respond(pack));
    vi.stubGlobal("fetch", fetch);
    await stages.draft_lyrics?.(ctx);
    const request = (fetch.mock.calls as unknown[][])[0]?.[1] as
      | RequestInit
      | undefined;
    const body = String(request?.body);
    expect(body).toContain("hopeful");
    expect(body).toContain("Vocal gender: m");
  });
  it("names the exact pack keys in the draft prompt", async () => {
    const { ctx } = await setup();
    const fetch = vi.fn(async () => respond(pack));
    vi.stubGlobal("fetch", fetch);
    await stages.draft_lyrics?.(ctx);
    const request = (fetch.mock.calls as unknown[][])[0]?.[1] as RequestInit;
    const body = JSON.parse(String(request.body)) as {
      messages: { content: string }[];
    };
    for (const key of ['"title"', '"lyrics"', '"style"', '"exclude"'])
      expect(body.messages[0]?.content).toContain(key);
    expect(body.messages[0]?.content).not.toContain('"l10n"');
  });
  it("asks for the user's topic and uses the reference only as a format", async () => {
    // Live test 2026-10-31: "office coffee machine" came back as another VBP song about AI approvals.
    const { ctx } = await setup();
    ctx.project.topic = "la macchinetta del caffe in ufficio";
    ctx.project.style = "italo disco";
    const fetch = vi.fn(async () => respond(pack));
    vi.stubGlobal("fetch", fetch);
    await stages.draft_lyrics?.(ctx);
    const request = (fetch.mock.calls as unknown[][])[0]?.[1] as RequestInit;
    const [system, user] = (
      JSON.parse(String(request.body)) as { messages: { content: string }[] }
    ).messages;
    expect(system?.content).not.toContain("VBP lyric pack");
    expect(system?.content).toMatch(/format only/u);
    expect(system?.content).toMatch(
      /never reuse the reference's (topic|title)/iu,
    );
    expect(user?.content).toContain(
      "Topic: la macchinetta del caffe in ufficio",
    );
    expect(user?.content.indexOf("Topic:")).toBeLessThan(
      user?.content.indexOf("Reference") ?? 0,
    );
  });
  it("routes, judges and rewrites a rejected draft before lyrics review", async () => {
    const { ctx } = await setup();
    ctx.secrets.values = { ...ctx.secrets.values, LYRICS_JURY: "on" };
    let judgeRound = 0;
    const scores = (topic: number) => ({
      topic,
      language: 0.9,
      singable: 0.9,
      chorus: 0.9,
      original: 0.9,
    });
    const fetch = vi.fn(async (url: string, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body)) as {
        model: string;
        questions?: Record<string, unknown>;
      };
      if (url.endsWith("/decisions")) {
        if (body.questions?.writer)
          return new Response(
            JSON.stringify({
              answers: {
                tone: { choice: "ironic", confidence: 0.9 },
                writer: { choice: "fast", confidence: 0.9 },
              },
            }),
          );
        judgeRound += 1;
        const topic = judgeRound === 1 ? 0.2 : 0.95;
        return new Response(
          JSON.stringify({
            answers: {
              ...Object.fromEntries(
                Object.entries(scores(topic)).map(([k, v]) => [k, { noul: v }]),
              ),
              improver: { choice: "strong" },
            },
          }),
        );
      }
      if (body.model.includes("haiku") || body.model.includes("gemini"))
        return respond({
          scores: scores(judgeRound === 1 ? 0.3 : 0.9),
          issues: ["the song is about AI approvals, not the coffee machine"],
          improver: "strong",
        });
      return respond(pack);
    });
    vi.stubGlobal("fetch", fetch);
    const result = await stages.draft_lyrics?.(ctx);
    const writerCalls = (fetch.mock.calls as unknown as [string, RequestInit][])
      .map(
        ([, init]) =>
          JSON.parse(String(init.body)) as {
            model: string;
            messages?: { content: string }[];
          },
      )
      .filter(
        (body) => body.model.includes("opus") || body.model.includes("sonnet"),
      );
    expect(writerCalls.map((body) => body.model)).toEqual([
      "anthropic/claude-sonnet-5.5",
      "anthropic/claude-opus-5.5",
    ]);
    expect(writerCalls[0]?.messages?.[1]?.content).toContain("Tone: Ironic");
    expect(writerCalls[1]?.messages?.[1]?.content).toContain(
      "The jury rejected the previous draft",
    );
    expect(writerCalls[1]?.messages?.[1]?.content).toContain(
      "not the coffee machine",
    );
    expect(result?.versionStatus).toBe("lyrics_review");
    expect(result?.patch?.lyric_jury).toMatchObject({
      passed: true,
      available: true,
      route: { tone: "ironic", writer: "fast" },
      rounds: [{ passed: false }, { passed: true }],
    });
  });
  it("keeps the best draft and flags it when the jury never approves", async () => {
    const { ctx } = await setup();
    ctx.secrets.values = {
      ...ctx.secrets.values,
      LYRICS_JURY: "on",
      LYRICS_JUDGES: "anthropic/claude-haiku-5.5",
    };
    const fetch = vi.fn(async (url: string, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body)) as { model: string };
      if (url.endsWith("/decisions"))
        return new Response("down", { status: 503 });
      if (body.model.includes("haiku"))
        return respond({
          scores: {
            topic: 0.4,
            language: 0.9,
            singable: 0.9,
            chorus: 0.9,
            original: 0.9,
          },
          issues: ["off topic"],
        });
      return respond(pack);
    });
    vi.stubGlobal("fetch", fetch);
    const result = await stages.draft_lyrics?.(ctx);
    expect(result?.versionStatus).toBe("lyrics_review");
    expect(result?.patch?.lyric_jury).toMatchObject({
      passed: false,
      failing: ["topic"],
      route: { writer: "strong" },
    });
    expect(result?.patch?.lyric_jury).toHaveProperty("rounds.length", 3);
  });
  it("builds a full pack from a realistic reply with only the creative fields", async () => {
    // Real models answer with the creative fields only (observed 2026-10-31);
    // settings come from the project and the display map from the reference.
    const { ctx } = await setup();
    ctx.project.vocal_gender = "m";
    const { title, lyrics, style, exclude } = pack;
    const reply = `\`\`\`json\n${JSON.stringify({ title, lyrics, style, exclude })}\n\`\`\``;
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(
            JSON.stringify({ choices: [{ message: { content: reply } }] }),
          ),
      ),
    );
    const result = await stages.draft_lyrics?.(ctx);
    expect(result?.versionStatus).toBe("lyrics_review");
    expect(result?.patch?.lyric_pack).toMatchObject({
      title,
      settings: { model: "V6", vocalGender: "m" },
      displayMap: {},
      l10n: {},
    });
  });
  it("applies the studio form settings stored on the project", async () => {
    const { ctx } = await setup();
    ctx.project.vocal_gender = null;
    ctx.project.song_settings = {
      model: "V6_WILD",
      title: "Lunedi",
      exclude: "metal",
      weirdness: 0.6,
      styleWeight: 0.4,
      variety: 3,
      duration: null,
    };
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => respond(pack)),
    );
    const result = await stages.draft_lyrics?.(ctx);
    const drafted = result?.patch?.lyric_pack as
      | { settings: Record<string, unknown> }
      | undefined;
    const settings = drafted?.settings;
    expect(result?.patch?.lyric_pack).toMatchObject({
      title: "Lunedi",
      exclude: "metal",
    });
    expect(settings).toEqual({
      model: "V6_WILD",
      styleWeight: 0.4,
      weirdness: 0.6,
      variety: 3,
      duration: null,
    });
  });
  it("omits Auto duration and an unset vocal gender from the kie settings", async () => {
    const { ctx } = await setup();
    const { vocalGender: _v, ...rest } = pack.settings;
    await writePack(
      ctx,
      LyricPackSchema.parse({
        ...pack,
        settings: { ...rest, variety: 4, duration: null },
      }),
    );
    expect(
      JSON.parse(
        await readFile(join(ctx.ws.versionsDir, "settings.json"), "utf8"),
      ),
    ).toEqual({
      model: "V6",
      style_weight: 0.7,
      weirdness_constraint: 0.35,
      variety: 4,
    });
  });
  it("writes the setting names kie.mjs reads", async () => {
    const { ctx } = await setup();
    await writePack(ctx, LyricPackSchema.parse(pack));
    expect(
      JSON.parse(
        await readFile(join(ctx.ws.versionsDir, "settings.json"), "utf8"),
      ),
    ).toEqual({
      model: "V6",
      vocal_gender: "f",
      style_weight: 0.7,
      weirdness_constraint: 0.35,
      variety: 1,
      duration: 310,
    });
  });
  it("selects the latest publication deterministically", async () => {
    const { ctx, db } = await setup();
    const render_id = db.renders[0]?.id ?? "";
    await db.createPublication({
      render_id,
      privacy: "private",
      created_at: "2000-01-01",
    });
    const latest = await db.createPublication({
      render_id,
      privacy: "private",
      created_at: "2020-01-01",
    });
    expect((await db.getPublicationForVersion(ctx.version.id))?.id).toBe(
      latest.id,
    );
  });
});
afterEach(async () => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.useRealTimers();
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});
const pack = {
  title: "Test song",
  lyrics: Array.from({ length: 80 }, (_, i) => `Line ${i}`).join("\n"),
  style: "pop",
  exclude: "",
  settings: {
    model: "V6",
    vocalGender: "f",
    styleWeight: 0.7,
    weirdness: 0.35,
    duration: 310,
  },
  displayMap: {},
  l10n: {},
};
async function setup() {
  const scratch = join(runtimeRoot(), "tmp");
  await mkdir(scratch, { recursive: true });
  const root = await mkdtemp(join(scratch, "stage-tests-"));
  roots.push(root);
  const ws = {
    root,
    versionsDir: join(root, "versions", "fr"),
    outDir: join(root, "out", "fr"),
    publicDir: join(root, "public"),
    renderDir: join(root, "render"),
  };
  await Promise.all(
    [
      ws.versionsDir,
      ws.outDir,
      ws.renderDir,
      join(ws.publicDir, "data", "fr"),
    ].map((dir) => mkdir(dir, { recursive: true })),
  );
  await writeFile(
    join(ws.publicDir, "data", "fr", "timing.json"),
    JSON.stringify({
      duration: 10,
      words: [{ start: 0, end: 0.1 }],
      lines: [
        {
          section: "Verse 1",
          text: "First line",
          words: [{ start: 0, end: 0.1 }],
        },
        {
          section: "Chorus",
          text: "Second line",
          words: [{ start: 5, end: 5.5 }],
        },
      ],
    }),
  );
  const calls: {
    cmd: string;
    args: string[];
    cwd: unknown;
    env: NodeJS.ProcessEnv;
  }[] = [];
  await writeFile(join(ws.renderDir, "video.mp4"), "fixture");
  const output = {
    submitCode: 0,
    submitError: "",
    lufs: -14,
    peak: -1.5,
    sizes: [1000],
    duration: 10,
    timing: {
      duration: 10,
      words: [{ start: 0, end: 0.1 }],
      lines: [
        {
          section: "Verse 1",
          text: "First line",
          words: [{ start: 0, end: 0.1 }],
        },
        {
          section: "Chorus",
          text: "Second line",
          words: [{ start: 5, end: 5.5 }],
        },
      ],
      sections: [
        { name: "Final Chorus", lines: [{ words: [{ start: 60, end: 61 }] }] },
      ],
    } as unknown,
    // takes-score.json as score_takes.py writes it.
    scores: {
      rows: [
        {
          take: "take-1.mp3",
          duration: 212.4,
          lufs: -14,
          end_drop_db: 30.5,
          fidelity: 0.91,
          weak_sections: [],
          truncated: false,
        },
        {
          take: "take-2.mp3",
          duration: 198,
          lufs: -13.1,
          end_drop_db: 4,
          fidelity: 0.62,
          weak_sections: ["Bridge 20%"],
          truncated: true,
        },
      ],
      recommended: "take-1.mp3",
    } as unknown,
  };
  const spawn: Spawn = (cmd, args, options) => {
    calls.push({
      cmd,
      args: [...args],
      cwd: options.cwd,
      env: options.env ?? {},
    });
    const child = Object.assign(new EventEmitter(), {
      stdout: new EventEmitter(),
      stderr: new EventEmitter(),
    });
    setImmediate(() => {
      void (async () => {
        if (args[1] === "generate" && output.submitCode !== 0) {
          child.stderr.emit("data", `${output.submitError}\n`);
          child.emit("close", output.submitCode);
          return;
        }
        if (args.some((arg) => arg.endsWith("score_takes.py")))
          await writeFile(
            join(ws.outDir, "takes-score.json"),
            JSON.stringify(output.scores),
          );
        if (cmd === "bash")
          await writeFile(
            join(ws.publicDir, "data", "fr", "timing.json"),
            JSON.stringify(output.timing),
          );
        for (const arg of args)
          if (/\.part\.[^.]+$/u.test(arg)) await writeFile(arg, "fixture");
        if (args[1] === "generate")
          await writeFile(join(ws.outDir, "task.json"), '{"taskId":"task-1"}');
        // Same shape as the real `kie.mjs credit` output.
        if (args[1] === "credit")
          child.stdout.emit(
            "data",
            `${JSON.stringify({ credits: 88, usd: 0.44, generate_calls_affordable: 7 })}\n`,
          );
        if (args.includes("ebur128=peak=true"))
          child.stderr.emit(
            "data",
            `I: ${output.lufs} LUFS\nPeak: ${output.peak} dBFS\n`,
          );
        if (cmd === "ffprobe")
          child.stdout.emit(
            "data",
            `${args.includes("format=size") ? (output.sizes.length > 1 ? output.sizes.shift() : output.sizes[0]) : output.duration}\n`,
          );
        if (args.includes("upload"))
          child.stdout.emit(
            "data",
            "video id abc123  https://youtu.be/abc123\n",
          );
        if (args.includes("render"))
          child.stdout.emit("data", "Rendered 50/100\nRendered 100/100\n");
        child.emit("close", 0);
      })().catch((error: unknown) => child.emit("error", error));
    });
    return child as unknown as ReturnType<Spawn>;
  };
  const db = new InMemoryDb();
  const ctx: StageContext = {
    job: {
      owner_id: "owner",
      id: "job",
      stage: "timing",
      version_id: "version",
      status: "queued",
      idempotency_key: "timing:version:7",
      attempts: 99,
    },
    version: {
      id: "version",
      owner_id: "owner",
      project_id: "project",
      lang: "fr",
      status: "producing",
      lyric_pack: pack,
      render_attempt: 7,
      qa_flags: [
        { kind: "crushed_words", count: 0 },
        { kind: "timing_duration", value: 10 },
      ],
    },
    project: { id: "project", owner_id: "owner", topic: "Test", theme: "vbp" },
    ws,
    db,
    engine: new Engine({ spawn, log: async () => {} }).withWorkspace(root),
    storage: { upload: vi.fn(async () => {}) },
    log: vi.fn(async () => {}),
    progress: vi.fn(async () => {}),
    secrets: {
      values: {
        WORKER_ID: "worker",
        OPENROUTER_API_KEY: "test-only-key",
        LYRICS_STATE_FILE: join(root, "lyrics-state.json"),
        // Writer-only tests; the router and the jury have their own tests.
        LYRICS_JURY: "off",
      },
      redact: (line) => line,
    },
    signal: new AbortController().signal,
  };
  ctx.engine = new Engine({
    spawn,
    log: async () => {},
    secrets: ctx.secrets,
  }).withWorkspace(root);
  db.versions.push(ctx.version);
  db.projects.push(ctx.project);
  const take = await db.createTake({
    owner_id: "owner",
    version_id: "version",
    take_number: 1,
    generation: 1,
  });
  ctx.version.chosen_take_id = take.id;
  await db.upsertRender({
    version_id: "version",
    render_attempt: 7,
    kind: "master",
    owner_id: "owner",
    path: join(ws.renderDir, "video.mp4"),
  });
  return { ctx, calls, output, db };
}
function command(cmd: string, args: string[], cwd: string = ENGINE_ROOT) {
  return { cmd, args, cwd };
}
function commands(calls: Awaited<ReturnType<typeof setup>>["calls"]) {
  return calls.map(({ cmd, args, cwd }) => ({ cmd, args, cwd }));
}
function respond(value: unknown) {
  return new Response(
    JSON.stringify({
      choices: [{ message: { content: JSON.stringify(value) } }],
    }),
  );
}

describe("stage safety and behavior", () => {
  it("preserves historical renders and selects only the current attempt", async () => {
    const { ctx, db } = await setup();
    const oldId = db.renders[0]?.id;
    ctx.version.render_attempt = 8;
    expect(await db.getRender(ctx.version.id, "master")).toBeNull();
    await db.upsertRender({
      version_id: ctx.version.id,
      kind: "master",
      render_attempt: 8,
    });
    expect(db.renders).toHaveLength(2);
    expect((await db.getRender(ctx.version.id, "master"))?.id).not.toBe(oldId);
  });
  it("uses the reviewed publication metadata in the upload file", async () => {
    const { ctx } = await setup();
    ctx.job.payload = {
      metadata: {
        title: "Reviewed title",
        description: "Reviewed credits",
        tags: "pop, fr",
        chapters: "0:00 Intro\n0:20 Verse",
      },
    };
    await stages.publish?.(ctx);
    const meta = JSON.parse(
      await readFile(join(ctx.ws.root, "publish", "meta", "fr.json"), "utf8"),
    );
    expect(meta).toMatchObject({
      title: "Reviewed title",
      description: "Reviewed credits\n\n0:00 Intro\n0:20 Verse",
      tags: ["pop", "fr"],
      privacyStatus: "private",
    });
  });
  it("fills a title-only publish job from its render snapshot", async () => {
    const { ctx, db } = await setup();
    ctx.project.brief = "Old project brief";
    ctx.version.lyric_pack = {
      ...pack,
      title: "Current title",
      lyrics: "Current lyrics",
    };
    ctx.job.payload = { metadata: { title: "Reviewed title" } };
    await db.patchRender(db.renders[0]?.id ?? "", {
      qa_results: {
        assets: {
          lyric_pack: {
            ...pack,
            title: "Rendered title",
            lyrics: "Une lumière sur le port",
          },
          lang: "fr",
          mood: "Pop luminoso",
        },
      },
    });
    await stages.publish?.(ctx);
    const meta = JSON.parse(
      await readFile(join(ctx.ws.root, "publish", "meta", "fr.json"), "utf8"),
    );
    expect(meta.title).toBe("Reviewed title");
    expect(meta.description).toContain("Une lumière sur le port");
    expect(meta.description).toContain("lumineux");
    expect(meta.description).not.toContain("Old project brief");
    expect(meta.description).not.toContain("Current lyrics");
    expect(meta.tags).toContain("lumineux");
  });
  it("strips loaded secrets from child environment, including overridden aliases", async () => {
    const { ctx, calls } = await setup();
    const file = join(ctx.ws.root, "fixture.env");
    await writeFile(
      file,
      "CUSTOM_CREDENTIAL=fixture-secret-value\nOPAQUE=opaque-private-value\n",
    );
    const secrets = await loadSecrets({
      WORKER_ENV_FILES: file,
      OPENROUTER_API_KEY: "test-router-secret",
      SUPABASE_SERVICE_ROLE_KEY: "fixture-service-key",
    });
    vi.stubEnv("CUSTOM_CREDENTIAL", "fixture-secret-value");
    vi.stubEnv("ALIAS", "fixture-secret-value");
    vi.stubEnv("opaque", "opaque-private-value");
    vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "fixture-service-key");
    const spawn: Spawn = (cmd, args, opts) => {
      calls.push({ cmd, args: [...args], cwd: opts.cwd, env: opts.env ?? {} });
      const child = new EventEmitter();
      setImmediate(() => child.emit("close", 0));
      return child;
    };
    const engine = new Engine({ spawn, log: async () => {}, secrets });
    await engine
      .withWorkspace(ctx.ws.root)
      .run("node", ["tools/kie.mjs", "credit"], {
        env: { CUSTOM_CREDENTIAL: "fixture-secret-value" },
      });
    const env = calls[0]?.env;
    expect(env).not.toHaveProperty("CUSTOM_CREDENTIAL");
    expect(env).not.toHaveProperty("OPENROUTER_API_KEY");
    expect(env).not.toHaveProperty("SUPABASE_SERVICE_ROLE_KEY");
    expect(env).not.toHaveProperty("opaque");
    expect(JSON.stringify(env)).not.toContain("fixture-secret-value");
    expect(JSON.stringify(env)).not.toContain("opaque-private-value");
    expect(env?.PATH ?? env?.Path).toBeTruthy();
    expect(env).toMatchObject({
      ENGINE_WORKSPACE: ctx.ws.root,
      TMP: "E:\\mellodifai\\tmp",
      TEMP: "E:\\mellodifai\\tmp",
      PYTHONIOENCODING: "utf-8",
    });
  });
  it.each(["file", "stored"])(
    "never generates when the task is %s",
    async (guard) => {
      const { ctx, calls } = await setup();
      if (guard === "file")
        await writeFile(
          join(ctx.ws.outDir, "task.json"),
          '{"taskId":"existing"}',
        );
      else ctx.version.kie_task_id = "existing";
      await stages.generate_song?.(ctx);
      expect(calls.filter((c) => c.cmd === "node").map((c) => c.args)).toEqual([
        ["tools/kie.mjs", "wait", "fr"],
        ["tools/kie.mjs", "lyrics-ts", "fr", "1"],
        ["tools/kie.mjs", "lyrics-ts", "fr", "2"],
        ["tools/kie.mjs", "credit"],
      ]);
    },
  );
  it("generates once across retries and persists balance", async () => {
    const { ctx, calls, db } = await setup();
    await stages.generate_song?.(ctx);
    await stages.generate_song?.(ctx);
    expect(calls.filter((c) => c.args[1] === "generate")).toHaveLength(1);
    expect((await db.getWorker("worker"))?.kie_balance).toBe(88);
  });
  it("retries an invalid lyric pack and includes the validation errors", async () => {
    const { ctx } = await setup();
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(
        respond({ ...pack, title: `bad${String.fromCodePoint(0x2014)}` }),
      )
      .mockResolvedValueOnce(respond(pack));
    vi.stubGlobal("fetch", fetch);
    expect((await stages.draft_lyrics?.(ctx))?.versionStatus).toBe(
      "lyrics_review",
    );
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(fetch.mock.calls[1]?.[1].body).toContain(
      "title contains an em dash",
    );
    expect(fetch.mock.calls[0]?.[0]).toBe(
      "https://openrouter.ai/api/v1/chat/completions",
    );
    expect(JSON.parse(fetch.mock.calls[0]?.[1].body)).toMatchObject({
      model: "anthropic/claude-opus-5.5",
      response_format: { type: "json_object" },
    });
  });
  it("fails after exactly two retries with validation errors", async () => {
    const { ctx } = await setup();
    const fetch = vi.fn(async () =>
      respond({ ...pack, title: String.fromCodePoint(0x2014) }),
    );
    vi.stubGlobal("fetch", fetch);
    await expect(stages.draft_lyrics?.(ctx)).rejects.toThrow(
      "title contains an em dash",
    );
    expect(fetch).toHaveBeenCalledTimes(3);
  });
  it("enforces daily cap before every request including retries", async () => {
    const { ctx } = await setup();
    ctx.secrets.values = { ...ctx.secrets.values, LYRICS_DAILY_CAP: "1" };
    const fetch = vi.fn(async () => respond({}));
    vi.stubGlobal("fetch", fetch);
    await expect(stages.draft_lyrics?.(ctx)).rejects.toThrow(
      "daily lyrics cap",
    );
    expect(fetch).toHaveBeenCalledTimes(1);
    await expect(stages.draft_lyrics?.(ctx)).rejects.toThrow(
      "daily lyrics cap",
    );
    expect(fetch).toHaveBeenCalledTimes(1);
  });
  it("counts failed network requests against the daily cap", async () => {
    const { ctx } = await setup();
    ctx.secrets.values = { ...ctx.secrets.values, LYRICS_DAILY_CAP: "1" };
    const fetch = vi.fn(async () => {
      throw new Error("offline");
    });
    vi.stubGlobal("fetch", fetch);
    await expect(stages.draft_lyrics?.(ctx)).rejects.toThrow("offline");
    await expect(stages.draft_lyrics?.(ctx)).rejects.toThrow(
      "daily lyrics cap",
    );
    expect(fetch).toHaveBeenCalledTimes(1);
  });
  it("resets the lyrics count on the next UTC day", async () => {
    const { ctx } = await setup();
    await writeFile(
      ctx.secrets.values.LYRICS_STATE_FILE ?? "",
      JSON.stringify({ day: "2000-01-01", count: 50 }),
    );
    const fetch = vi.fn(async () => respond(pack));
    vi.stubGlobal("fetch", fetch);
    await stages.draft_lyrics?.(ctx);
    expect(fetch).toHaveBeenCalledTimes(1);
  });
  it.each([
    [-10, -1.5, 0, "integrated_loudness"],
    [-14, -0.5, 0, "true_peak"],
    [-14, -1.5, 1, "crushed_words"],
  ] as const)(
    "fails QA at %s LUFS, %s peak, %s crushed",
    async (lufs, peak, crushed, gate) => {
      const { ctx, db, output } = await setup();
      output.lufs = lufs;
      output.peak = peak;
      ctx.version.qa_flags = [
        { kind: "crushed_words", count: crushed },
        { kind: "timing_duration", value: 10 },
      ];
      await stages.qa?.(ctx);
      const results = (await db.getRender("version", "master"))?.qa_results as {
        gates: { name: string; pass: boolean }[];
      };
      expect(results.gates.find((g) => g.name === gate)?.pass).toBe(false);
    },
  );
  it("holds the fifth Pacific-day upload queued, then allows the next day", async () => {
    const { ctx, db, calls } = await setup();
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-10-31T06:30:00Z"));
    await db.upsertWorker({
      id: "worker",
      youtube_quota_day: "2026-10-30",
      youtube_uploads_today: 4,
    });
    ctx.version.status = "approved";
    db.jobs.push({ ...ctx.job, stage: "publish" });
    const loop = new WorkerLoop({
      db,
      workerId: "worker",
      stages,
      engine: ctx.engine,
      storage: ctx.storage,
      secrets: ctx.secrets,
      workspace: { forVersion: async () => ctx.ws },
    });
    await loop.runOnce();
    expect(db.jobs[0]?.status).toBe("queued");
    expect(calls).toHaveLength(0);
    expect(db.jobs[0]?.error).toContain("quota");
    expect(db.jobs[0]?.not_before).toBe("2026-10-31T07:05:00.000Z");
    expect(await loop.runOnce()).toBe(false);
    vi.setSystemTime(new Date("2026-10-31T08:00:00Z"));
    await loop.runOnce();
    expect(db.jobs[0]?.status).toBe("done");
    expect(await db.getWorker("worker")).toMatchObject({
      youtube_quota_day: "2026-10-31",
      youtube_uploads_today: 1,
    });
  });
  it.each([{}, { confirmed_at: "2026-10-31" }, { confirmed_by: "owner" }])(
    "refuses privacy without both confirmations: %j",
    async (confirmation) => {
      const { ctx, db, calls } = await setup();
      await db.createPublication({
        render_id: db.renders[0]?.id ?? "",
        youtube_video_id: "abc123",
        privacy: "public",
        ...confirmation,
      });
      await expect(stages.set_privacy?.(ctx)).rejects.toThrow("confirmed");
      expect(calls).toHaveLength(0);
    },
  );
  it("increments the current Pacific-day counter after a private upload", async () => {
    const { ctx, db } = await setup();
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-10-31T18:00:00Z"));
    await db.upsertWorker({
      id: "worker",
      youtube_quota_day: "2026-10-31",
      youtube_uploads_today: 3,
    });
    await stages.publish?.(ctx);
    expect(await db.getWorker("worker")).toMatchObject({
      youtube_quota_day: "2026-10-31",
      youtube_uploads_today: 4,
    });
    expect(db.publications[0]).toMatchObject({
      privacy: "private",
      youtube_video_id: "abc123",
    });
    expect(
      JSON.parse(
        await readFile(join(ctx.ws.root, "publish", "meta", "fr.json"), "utf8"),
      ),
    ).toMatchObject({
      privacyStatus: "private",
      publishAt: null,
      containsSyntheticMedia: true,
    });
  });
  it("computes the crushed-word count from timing and uploads both listen clips", async () => {
    const { ctx } = await setup();
    const result = await stages.timing?.(ctx);
    expect(result?.patch?.qa_flags).toEqual(
      expect.arrayContaining([
        { kind: "crushed_words", blocking: true, count: 1 },
      ]),
    );
    expect(ctx.storage.upload).toHaveBeenCalledTimes(2);
  });
  it("stores the selected take's storyboard and thumbnail on its render", async () => {
    const { ctx, db } = await setup();
    ctx.project.mood = "wistful";
    ctx.version.storyboard_path = join(
      ctx.ws.publicDir,
      "data",
      "fr",
      "storyboard-7.json",
    );
    ctx.version.chosen_take_id = "take-one";
    await stages.art?.(ctx);
    const render = await db.getRender(ctx.version.id, "master");
    expect(render?.qa_results).toMatchObject({
      assets: {
        storyboard_path: ctx.version.storyboard_path,
        thumbnail_path: "previews/owner/project/fr/version/7/thumbnail.png",
        chosen_take_id: "take-one",
        lyric_pack: ctx.version.lyric_pack,
        storyboard_sections: ctx.version.storyboard_sections,
        title: "Test song",
        lang: "fr",
        mood: "wistful",
      },
    });
  });
  it("uses lyric style when both project moods are blank", async () => {
    const { ctx, db } = await setup();
    ctx.project.mood = "  ";
    ctx.project.song_settings = { mood: "" };
    ctx.version.lyric_pack = { ...pack, style: "sad dark" };
    const storyboard = await stages.storyboard?.(ctx);
    expect(storyboard?.patch?.storyboard_sections).toBeTruthy();
    const scenes = JSON.parse(
      await readFile(
        join(ctx.ws.publicDir, "data", "fr", "storyboard.json"),
        "utf8",
      ),
    );
    expect(scenes.shots[0].mood).toBe("ink");
    await stages.art?.(ctx);
    expect(
      (await db.getRender(ctx.version.id, "master"))?.qa_results,
    ).toMatchObject({
      assets: { mood: "sad dark" },
    });
  });
  it("writes the lyric files an imported song never had before timing it", async () => {
    const { ctx } = await setup();
    ctx.version.lyric_pack = fakePack;
    await rm(ctx.ws.versionsDir, { recursive: true, force: true });
    await stages.timing?.(ctx);
    expect(await readFile(join(ctx.ws.versionsDir, "title.txt"), "utf8")).toBe(
      fakePack.title,
    );
  });
  it("refreshes stale lyric files before the production timing command after a take switch", async () => {
    const { ctx, db, output } = await setup();
    await writeFile(join(ctx.ws.versionsDir, "title.txt"), "Previous title");
    await writeFile(join(ctx.ws.versionsDir, "lyrics.txt"), "Previous lyrics");
    const run = ctx.engine.run.bind(ctx.engine);
    const observed: string[] = [];
    vi.spyOn(ctx.engine, "run").mockImplementation(
      async (cmd, args, options) => {
        if (cmd === "bash") {
          const lyrics = await readFile(
            join(ctx.ws.versionsDir, "lyrics.txt"),
            "utf8",
          );
          observed.push(lyrics);
          output.timing = {
            duration: 10,
            sections: [
              {
                name: "Final Chorus",
                lines: [{ words: [{ start: 60, end: 61 }] }],
              },
            ],
            lines: [
              { section: "Verse", text: lyrics, words: [{ start: 0, end: 9 }] },
            ],
          };
        }
        return run(cmd, args, options);
      },
    );
    for (const lyrics of ["New take lyrics", "Original take lyrics"]) {
      const take = await db.createTake({
        version_id: ctx.version.id,
        take_number: 2,
        generation: 1,
        lyrics,
      });
      ctx.version.chosen_take_id = take.id;
      ctx.version.lyric_pack = { ...fakePack, lyrics };
      await stages.timing?.(ctx);
      const storyboard = await stages.storyboard?.(ctx);
      expect(JSON.stringify(storyboard?.patch?.storyboard_sections)).toContain(
        lyrics,
      );
      const timing = await readFile(
        join(ctx.ws.publicDir, "data", "fr", "timing.json"),
        "utf8",
      );
      expect(timing).toContain(lyrics);
      expect(timing).not.toContain("Previous lyrics");
      expect(
        await readFile(join(ctx.ws.versionsDir, "title.txt"), "utf8"),
      ).toBe(fakePack.title);
    }
    expect(observed).toEqual(["New take lyrics", "Original take lyrics"]);
  });
  it("re-encodes a preview over 40 MB using ffprobe size", async () => {
    const { ctx, calls, output } = await setup();
    output.sizes = [41 * 1024 * 1024, 1000];
    await stages.render_master?.(ctx);
    expect(
      calls
        .filter((c) => c.args.includes("-crf"))
        .map((c) => c.args[c.args.indexOf("-crf") + 1]),
    ).toEqual(["30", "32"]);
  });
  it("never uploads an oversize preview after exhausting retries", async () => {
    const { ctx, output } = await setup();
    output.sizes = [41 * 1024 * 1024];
    await expect(stages.render_hook?.(ctx)).rejects.toThrow("exceeds 15 MB");
    expect(ctx.storage.upload).not.toHaveBeenCalled();
  });
  it("runs the producing chain using the version render attempt", async () => {
    const { ctx, db } = await setup();
    db.jobs.push(ctx.job);
    const loop = new WorkerLoop({
      db,
      workerId: "worker",
      stages,
      engine: ctx.engine,
      storage: ctx.storage,
      secrets: ctx.secrets,
      workspace: { forVersion: async () => ctx.ws },
    });
    for (let i = 0; i < 6; i++) await loop.runOnce();
    expect(db.jobs.map((j) => j.stage)).toEqual([
      "timing",
      "storyboard",
      "render_master",
      "render_hook",
      "qa",
      "art",
    ]);
    expect(
      db.jobs.every(
        (j) =>
          j.idempotency_key === `${j.stage}:version:7` && j.status === "done",
      ),
    ).toBe(true);
    expect(ctx.version.status).toBe("video_review");
  });
});

it("fake stages generate playable temporary media, persist rows and advance the complete chain", async () => {
  const { ctx, db } = await setup();
  db.takes = [];
  db.renders = [];
  ctx.engine = new Engine({
    log: async () => {},
    secrets: ctx.secrets,
  }).withWorkspace(ctx.ws.root);
  const sleep = vi.fn(async () => {});
  const registry = createFakeStages({ tempRoot: ctx.ws.root, sleep });
  vi.stubGlobal(
    "fetch",
    vi.fn(() => {
      throw new Error("Fake mode must not call a paid API");
    }),
  );
  const run = async (stage: Stage) => {
    const result = await registry[stage]?.(ctx);
    Object.assign(ctx.version, result?.patch);
    if (result?.versionStatus) ctx.version.status = result.versionStatus;
    return result;
  };
  await run("draft_lyrics");
  expect(ctx.version.status).toBe("lyrics_review");
  await run("generate_song");
  expect(ctx.version.status).toBe("takes_review");
  expect(db.takes).toHaveLength(2);
  for (const [stage, next] of [
    ["timing", "storyboard"],
    ["storyboard", "render_master"],
    ["render_master", "render_hook"],
    ["render_hook", "qa"],
    ["qa", "art"],
  ] as const)
    expect((await run(stage))?.enqueue).toEqual([
      { stage: next, idempotencyKey: `${next}:version:7` },
    ]);
  await run("art");
  expect(ctx.version.status).toBe("video_review");
  expect(db.renders).toHaveLength(2);
  for (const [file, codec, width] of [
    [join(ctx.ws.outDir, "take-1.mp3"), "mp3", undefined],
    [join(ctx.ws.renderDir, "video.mp4"), "h264", 1280],
    [join(ctx.ws.renderDir, "thumbnail.png"), "png", 1280],
  ] as const) {
    let output = "";
    const probe = ctx.engine.withWorkspace(ctx.ws.root, async (line) => {
      output += line;
    });
    expect(
      (
        await probe.run("ffprobe", [
          "-v",
          "error",
          "-show_streams",
          "-show_format",
          "-of",
          "json",
          file,
        ])
      ).code,
    ).toBe(0);
    const info = JSON.parse(output) as {
      streams: { codec_name: string; width?: number; height?: number }[];
      format: { duration?: string };
    };
    expect(info.streams[0]?.codec_name).toBe(codec);
    if (width) expect(info.streams[0]).toMatchObject({ width, height: 720 });
    if (codec !== "png")
      expect(Number(info.format.duration)).toBeCloseTo(10, 0);
  }
  await run("publish");
  expect(db.publications[0]?.privacy).toBe("private");
  await expect(run("set_privacy")).rejects.toThrow("confirmed");
  await db.patchPublication(db.publications[0]?.id ?? "", {
    confirmed_at: new Date().toISOString(),
    confirmed_by: "owner",
    privacy: "public",
  });
  await run("set_privacy");
  expect(ctx.version.status).toBe("published");
  ctx.version.render_attempt = 8;
  const replacement = await db.upsertRender({
    version_id: ctx.version.id,
    kind: "master",
    render_attempt: 8,
    path: join(ctx.ws.renderDir, "video.mp4"),
  });
  await run("publish");
  expect(db.publications).toHaveLength(2);
  expect(db.publications[1]?.render_id).toBe(replacement.id);
  await run("publish");
  expect(db.publications).toHaveLength(2);
  expect(sleep).toHaveBeenCalledTimes(13);
  expect(ctx.storage.upload).toHaveBeenCalledWith(
    "previews/owner/project/fr/version/7/master-preview.mp4",
    join(ctx.ws.renderDir, "master-preview.mp4"),
    "video/mp4",
  );
}, 30_000);

it("runs master-only lyric alignment through the fake worker", async () => {
  const { ctx, db } = await setup();
  db.takes = [];
  db.jobs.push({
    ...ctx.job,
    stage: "align_lyrics",
    payload: { source: "master" },
    idempotency_key: "align_lyrics:master:version",
  });
  const loop = new WorkerLoop({
    db,
    workerId: "worker",
    stages: createFakeStages({ tempRoot: ctx.ws.root, sleep: async () => {} }),
    engine: ctx.engine,
    storage: ctx.storage,
    secrets: ctx.secrets,
    workspace: { forVersion: async () => ctx.ws },
  });
  expect(await loop.runOnce()).toBe(true);
  expect(db.jobs[0]?.status).toBe("done");
  expect(db.versions[0]?.lyric_timing).toMatchObject({
    source: "whisper",
    lines: [
      { words: [{ word: "A" }, { word: "little" }, { word: "brighter" }] },
    ],
  });
  expect(db.versions[0]?.status).toBe("producing");
});

describe("exact stage subprocess contracts", () => {
  it.each([
    "generate_song",
    "timing",
    "storyboard",
    "render_master",
    "render_hook",
    "qa",
    "art",
    "publish",
    "set_privacy",
  ] as Stage[])("%s arguments, cwd, environment", async (stage) => {
    const { ctx, calls, db } = await setup();
    if (stage === "art") ctx.version.lyric_pack = { ...pack, title: "--Night" };
    if (stage === "set_privacy")
      await db.createPublication({
        render_id: db.renders[0]?.id ?? "",
        youtube_video_id: "abc123",
        privacy: "unlisted",
        upload_state: "uploaded",
        confirmed_at: "2026-10-31",
        confirmed_by: "owner",
      });
    await stages[stage]?.(ctx);
    const out = (name: string) => join(ctx.ws.outDir, name);
    const render = (name: string) => join(ctx.ws.renderDir, name);
    const stem = join(ctx.ws.root, "stems", "htdemucs", "fr", "vocals.wav");
    const expected: Partial<Record<Stage, ReturnType<typeof command>[]>> = {
      generate_song: [
        command("node", ["tools/kie.mjs", "job", "fr"]),
        command("node", ["tools/kie.mjs", "generate", "fr"]),
        command("node", ["tools/kie.mjs", "wait", "fr"]),
        ...[1, 2].map((n) =>
          command("node", ["tools/kie.mjs", "lyrics-ts", "fr", String(n)]),
        ),
        ...[1, 2].map((n) =>
          command("ffmpeg", [
            "-y",
            "-i",
            out(`take-${n}.mp3`),
            "-b:a",
            "128k",
            "-f",
            "mp3",
            out(`take-${n}-preview.part.mp3`),
          ]),
        ),
        command("node", ["tools/kie.mjs", "credit"]),
      ],
      timing: [
        command("bash", ["tools/workspace_pipeline.sh", "fr", "1"]),
        command("ffmpeg", [
          "-y",
          "-ss",
          "52",
          "-i",
          stem,
          "-t",
          "8",
          "-f",
          "mp3",
          render("chant-listen.part.mp3"),
        ]),
        command("ffmpeg", [
          "-y",
          "-sseof",
          "-12",
          "-i",
          stem,
          "-f",
          "mp3",
          render("outro-listen.part.mp3"),
        ]),
      ],
      storyboard: [],
      art: [
        command("ffmpeg", [
          "-y",
          "-ss",
          "0.5",
          "-i",
          render("video.mp4"),
          "-frames:v",
          "1",
          render("thumbnail-frame.part.jpg"),
        ]),
        command(
          "python",
          [
            "-I",
            "-X",
            "utf8",
            fileURLToPath(
              new URL("../src/stages/thumbnail.py", import.meta.url),
            ),
            "--title=--Night",
            "--lang",
            "fr",
            "--source",
            render("thumbnail-frame.jpg"),
            "--out",
            render("thumbnail.part.png"),
          ],
          ctx.ws.root,
        ),
        command("python", [
          "-I",
          "-X",
          "utf8",
          "tools/make_srt.py",
          "fr",
          render("fr.part.srt"),
        ]),
      ],
      publish: [
        command("python", [
          "-I",
          "-X",
          "utf8",
          "publish/yt.py",
          "upload",
          join(ctx.ws.root, "publish", "meta", "fr.json"),
        ]),
      ],
      set_privacy: [
        command("python", [
          "-I",
          "-X",
          "utf8",
          "publish/yt.py",
          "privacy",
          "abc123",
          "unlisted",
          "--confirm",
        ]),
      ],
      qa: [
        command("ffmpeg", [
          "-i",
          render("video.mp4"),
          "-filter_complex",
          "ebur128=peak=true",
          "-f",
          "null",
          "-",
        ]),
        command("ffprobe", [
          "-v",
          "error",
          "-show_entries",
          "format=duration",
          "-of",
          "default=noprint_wrappers=1:nokey=1",
          render("video.mp4"),
        ]),
        command("ffmpeg", [
          "-y",
          "-i",
          render("video.mp4"),
          "-vf",
          "fps=20/10,scale=320:-1,tile=5x4",
          "-frames:v",
          "1",
          "-f",
          "image2",
          render("contact-sheet.part.jpg"),
        ]),
      ],
    };
    for (const kind of ["master", "hook"] as const)
      expected[kind === "master" ? "render_master" : "render_hook"] = [
        command(
          "node",
          [
            "scripts/r.mjs",
            "render",
            `${kind === "master" ? "Video" : "Hook"}-fr`,
            render(kind === "master" ? "video.part.mp4" : "hook.part.mp4"),
            `--props=${join(ctx.ws.root, "fps30.json")}`,
            "--gl=angle",
            "--log=error",
          ],
          join(ENGINE_ROOT, "motion"),
        ),
        command("ffmpeg", [
          "-y",
          "-i",
          render(kind === "master" ? "video.mp4" : "hook.mp4"),
          "-vf",
          "scale=-2:480",
          "-c:v",
          "libx264",
          "-crf",
          "30",
          "-c:a",
          "aac",
          "-b:a",
          "96k",
          "-movflags",
          "+faststart",
          "-f",
          "mp4",
          render(`${kind}-preview.part.mp4`),
        ]),
        command("ffprobe", [
          "-v",
          "error",
          "-show_entries",
          "format=size",
          "-of",
          "default=noprint_wrappers=1:nokey=1",
          render(`${kind}-preview.mp4`),
        ]),
      ];
    expect(commands(calls)).toEqual(expected[stage]);
    for (const call of calls) {
      expect(call.env).toMatchObject({
        ENGINE_WORKSPACE: ctx.ws.root,
        PYTHONIOENCODING: "utf-8",
        TMP: "E:\\mellodifai\\tmp",
        TEMP: "E:\\mellodifai\\tmp",
      });
      expect(JSON.stringify(call.args)).not.toContain("test-only-key");
      expect(JSON.stringify(call.env)).not.toContain("test-only-key");
    }
    if (stage.startsWith("render_"))
      expect(ctx.progress).toHaveBeenLastCalledWith(100);
    if (stage === "generate_song")
      expect(
        JSON.parse(
          await readFile(join(ctx.ws.versionsDir, "settings.json"), "utf8"),
        ),
      ).toMatchObject({ model: "V6", vocal_gender: "f", style_weight: 0.7 });
  });
});

describe("local lyric alignment", () => {
  it("aligns a master preview when no take audio exists", async () => {
    const { ctx, db } = await setup();
    ctx.job.payload = { source: "master" };
    ctx.version.lyric_pack = { lyrics: "Hello world" };
    await db.upsertRender({
      version_id: ctx.version.id,
      kind: "master",
      render_attempt: ctx.version.render_attempt ?? 1,
      preview_path: "previews/owner/master.mp4",
    });
    const download = vi.fn(async (_path: string, file: string) => {
      await writeFile(file, "fake preview");
    });
    ctx.storage.download = download;
    vi.spyOn(ctx.engine, "run").mockImplementation(async (_command, args) => {
      await writeFile(
        args[3] as string,
        JSON.stringify([
          { word: "Hello", start: 0, end: 1 },
          { word: "world", start: 1, end: 2 },
        ]),
      );
      return { code: 0, stdout: "", stderr: "" };
    });
    await expect(stages.align_lyrics?.(ctx)).resolves.toEqual({});
    expect(download).toHaveBeenCalledWith(
      "previews/owner/master.mp4",
      expect.stringContaining("master-preview.mp4"),
    );
    expect(db.versions[0]?.lyric_timing).toMatchObject({
      source: "whisper",
      lines: [{ words: [{ word: "Hello" }, { word: "world" }] }],
    });
    await expect(
      readFile(join(ctx.ws.root, "align-lyrics", "master", "words.json")),
    ).rejects.toThrow();
  });
  it.each(["success", "engine failure", "unmatched"])(
    "handles %s and cleans its workspace",
    async (result) => {
      const { ctx, db } = await setup();
      ctx.job.payload = { take_id: "alignment-take" };
      db.takes.push({
        id: "alignment-take",
        version_id: ctx.version.id,
        take_number: 1,
        lyrics: "Hello world",
      });
      await writeFile(join(ctx.ws.outDir, "take-1.mp3"), "fake audio");
      const run = vi
        .spyOn(ctx.engine, "run")
        .mockImplementation(async (_cmd, args) => {
          if (result === "engine failure")
            throw new Error("local engine failed");
          if (!args[3]) throw new Error("Missing output path");
          await writeFile(
            args[3],
            JSON.stringify(
              result === "unmatched"
                ? []
                : [
                    { word: "Hello", start: 0, end: 1 },
                    { word: "world", start: 1, end: 2 },
                  ],
            ),
          );
          return { code: 0, stdout: "", stderr: "" };
        });
      const status = ctx.version.status;
      if (result === "success") {
        await expect(stages.align_lyrics?.(ctx)).resolves.toEqual({});
        expect(
          db.takes.find((t) => t.id === "alignment-take")?.lyric_timing,
        ).toMatchObject({
          source: "whisper",
          lines: [{ words: [{ word: "Hello" }, { word: "world" }] }],
        });
      } else {
        await expect(stages.align_lyrics?.(ctx)).rejects.toThrow();
        expect(
          db.takes.find((t) => t.id === "alignment-take")?.lyric_timing,
        ).toBeUndefined();
      }
      expect(ctx.version.status).toBe(status);
      expect(run).toHaveBeenCalledTimes(1);
      await expect(
        readFile(
          join(ctx.ws.root, "align-lyrics", "alignment-take", "words.json"),
        ),
      ).rejects.toThrow();
    },
  );
});

it.each(["w", "word", "missing"])(
  "preserves pipeline lyric timing with %s word fields",
  async (field) => {
    const { ctx, db, output } = await setup();
    const measured = [
      { start: 60, end: 60.2 },
      { start: 60.7, end: 62 },
    ];
    output.timing = {
      duration: 70,
      lines: [
        {
          section: "Final Chorus",
          text: "Hello world",
          words: measured.map((time, index) => ({
            ...time,
            ...(field === "missing"
              ? {}
              : { [field]: ["Hello", "world"][index] }),
          })),
        },
      ],
    };
    await stages.timing?.(ctx);
    expect(
      db.takes.find((take) => take.id === ctx.version.chosen_take_id)
        ?.lyric_timing,
    ).toEqual({
      source: "timing",
      lines: [
        {
          text: "Hello world",
          start: 60,
          end: 62,
          ...(field === "missing"
            ? {}
            : {
                words: [
                  { word: "Hello", ...measured[0] },
                  { word: "world", ...measured[1] },
                ],
              }),
        },
      ],
    });
  },
);
