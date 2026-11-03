import { EventEmitter } from "node:events";
import {
  mkdir,
  mkdtemp,
  readFile,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { aceStepSeconds, LyricPackSchema } from "@mellodifai/shared";
import { afterEach, describe, expect, it, vi } from "vitest";
import { toYue2Lyrics } from "../src/comfy/graphs.js";
import { PROMPT_NAMESPACE, uuidv5 } from "../src/comfy/ids.js";
import type { LocalRuntime } from "../src/comfy/runtime.js";
import { InMemoryDb } from "../src/db.js";
import { Engine, type Spawn } from "../src/engine.js";
import type { StageContext } from "../src/loop.js";
import { stages } from "../src/stages/index.js";
import {
  COMFY_CLIENT_ID,
  LOCAL_TEXT,
  YUE2_MAX_DURATION,
} from "../src/stages/local-engine.js";
import { type FakeComfy, fakeComfy } from "./fake-comfy.js";
import { recordingLedger } from "./support/ledger.js";

const roots: string[] = [];
const servers: FakeComfy[] = [];
afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => server.close()));
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});

const GROQ = "groq-test-secret";
const lyrics = await readFile(
  join(import.meta.dirname, "fixtures", "yue2", "a-vbp-passa", "lyrics.txt"),
  "utf8",
);
const id = (take: number, retry = false) =>
  uuidv5(PROMPT_NAMESPACE, `version:1:${take}${retry ? ":retry" : ""}`);
const saveNode = { "ace-step": "107", yue2: "10" } as const;

async function setup(
  engine: "ace-step" | "yue2" = "ace-step",
  options: {
    role?: string;
    duration?: number | null;
    settings?: Record<string, unknown>;
  } = {},
) {
  const root = await mkdtemp(join(tmpdir(), "mellodifai-local-"));
  roots.push(root);
  const ws = {
    root,
    versionsDir: join(root, "versions", "it"),
    outDir: join(root, "out", "it"),
    publicDir: join(root, "public"),
    renderDir: join(root, "render"),
  };
  await Promise.all(
    [ws.versionsDir, ws.outDir, join(ws.publicDir, "data", "it")].map((dir) =>
      mkdir(dir, { recursive: true }),
    ),
  );
  const comfy = await fakeComfy();
  servers.push(comfy);
  comfy.state.up = false;
  const outputDir = join(root, "comfy-output");
  // Each prompt runs through its nodes and saves its FLAC like ComfyUI; tests may replace this.
  const autoRun = (promptId: string) => {
    const prompt = comfy.state.prompts.get(promptId);
    if (!prompt) return;
    prompt.status = "in_progress";
    const nodes =
      engine === "yue2" ? ["24", "25", "8", "9"] : ["94", "3", "18"];
    for (const node of nodes) {
      comfy.emit(promptId, "executing", { node });
      comfy.emit(promptId, "progress", { node, value: 1, max: 2 });
    }
    const prefix = String(
      prompt.graph[saveNode[engine]]?.inputs.filename_prefix,
    );
    const outputs: Record<string, unknown> = {
      [saveNode[engine]]: {
        audio: [
          {
            filename: `${prefix.split("/").at(-1)}_00001.flac`,
            subfolder: prefix.split("/").slice(0, -1).join("/"),
            type: "output",
          },
        ],
      },
    };
    if (engine === "yue2") {
      outputs["14"] = { text: [`X:1\nabc of ${promptId}`] };
      outputs["23"] = { text: ["244.0"] };
    }
    comfy.finish(promptId, outputs);
  };
  comfy.onSubmit((promptId) => setTimeout(() => autoRun(promptId), 5));
  const supervisor = {
    baseUrl: comfy.url,
    ensureStarted: vi.fn(async () => {
      comfy.state.up = true;
    }),
    stop: vi.fn(async () => {
      comfy.state.up = false;
    }),
    restart: vi.fn(async () => {
      comfy.state.up = true;
    }),
    isUp: vi.fn(async () => comfy.state.up),
  };
  const runtime: LocalRuntime = {
    supervisor,
    outputDir,
    freeVramMb: vi.fn(async () => 7000),
    connect: (url) => comfy.connect(url),
    limits: { stallMs: 400, takeMs: 10_000, pollMs: 5, progressMs: 2_000 },
  };
  const calls: { cmd: string; args: string[]; env: NodeJS.ProcessEnv }[] = [];
  const scores = {
    rows: [1, 2].map((take) => ({
      take: `take-${take}.mp3`,
      duration: take === 1 ? 244 : 418,
      end_drop_db: 30,
      fidelity: take === 1 ? 0.88 : 0.8,
      weak_sections: [],
      truncated: false,
    })),
  };
  const spawn: Spawn = (cmd, args, spawnOptions) => {
    calls.push({ cmd, args: [...args], env: spawnOptions.env ?? {} });
    const child = Object.assign(new EventEmitter(), {
      stdout: new EventEmitter(),
      stderr: new EventEmitter(),
    });
    setImmediate(() => {
      void (async () => {
        for (const arg of args)
          if (/\.part\.[^.]+$/u.test(arg)) await writeFile(arg, "mp3 fixture");
        if (args.some((arg) => arg.endsWith("score_takes.py")))
          await writeFile(
            join(ws.outDir, "takes-score.json"),
            JSON.stringify(scores),
          );
        child.emit("close", 0);
      })().catch((error: unknown) => child.emit("error", error));
    });
    return child as unknown as ReturnType<Spawn>;
  };
  const db = new InMemoryDb();
  db.profiles.push({ id: "owner", role: options.role ?? "admin" });
  const pack = LyricPackSchema.parse({
    title: "Va bene, passa",
    lyrics,
    style: "Italian pop rock, 118 BPM, E-flat major, female vocals",
    exclude: "",
    settings: {
      model: "V6",
      duration: options.duration === undefined ? null : options.duration,
    },
    displayMap: {},
    l10n: {},
  });
  const ctx: StageContext = {
    groqLedger: () => recordingLedger(),
    job: {
      owner_id: "owner",
      id: "job",
      stage: "generate_song",
      version_id: "version",
      status: "running",
      worker_id: "worker",
      idempotency_key: "generate_song:version:1",
      payload: {},
      attempts: 1,
    },
    version: {
      id: "version",
      owner_id: "owner",
      project_id: "project",
      lang: "it",
      status: "song_queued",
      lyric_pack: pack,
      generation_count: 1,
    },
    project: {
      id: "project",
      owner_id: "owner",
      topic: "Test",
      theme: "vbp",
      song_settings: { model: "V6", engine, ...options.settings },
    },
    ws,
    db,
    engine: new Engine({ spawn, log: async () => {} }),
    storage: { upload: vi.fn(async () => {}) },
    log: vi.fn(async () => {}),
    progress: vi.fn(async () => {}),
    secrets: {
      values: { WORKER_ID: "worker", GROQ_API_KEY: GROQ },
      redact: (line) => line.replaceAll(GROQ, "***"),
    },
    signal: new AbortController().signal,
    comfy: runtime,
  };
  ctx.engine = new Engine({
    validateEntries: async () => true,
    spawn,
    log: async () => {},
    secrets: ctx.secrets,
  }).withWorkspace(root);
  // A copy: what the stage persists must reach the row, not only the claimed object.
  db.jobs.push({ ...ctx.job });
  db.versions.push(ctx.version);
  db.projects.push(ctx.project);
  const kieCalls = () =>
    calls.filter((call) => call.args.some((arg) => arg.includes("kie.mjs")));
  return {
    ctx,
    db,
    comfy,
    supervisor,
    runtime,
    calls,
    kieCalls,
    scores,
    pack,
    outputDir,
    autoRun,
  };
}
const generate = (ctx: StageContext) => {
  const handler = stages.generate_song;
  if (!handler) throw new Error("generate_song is not registered");
  return handler(ctx);
};

describe("generate_song with a local engine", () => {
  it("makes two ACE-Step takes one after the other and leaves the workspace as kie does", async () => {
    const { ctx, db, comfy, supervisor, calls, kieCalls, pack } =
      await setup("ace-step");
    const order: string[] = [];
    comfy.onSubmit((promptId) => {
      // Seeds are saved before the first submit; take 2 only after take 1 is done.
      const seeds = db.jobs[0]?.payload?.seeds as Record<string, number>;
      order.push(
        `${promptId}:${[...comfy.state.prompts.values()].filter((p) => p.status === "completed").length}:${seeds?.["1"] !== undefined}`,
      );
      setTimeout(() => {
        const prompt = comfy.state.prompts.get(promptId);
        if (!prompt) return;
        prompt.status = "in_progress";
        comfy.emit(promptId, "executing", { node: "94" });
        comfy.finish(promptId, {
          "107": {
            audio: [
              { filename: "x_00001.flac", subfolder: "s", type: "output" },
            ],
          },
        });
      }, 5);
    });
    const result = await generate(ctx);
    expect(result).toMatchObject({ versionStatus: "takes_review" });
    expect(order).toEqual([`${id(1)}:0:true`, `${id(2)}:1:true`]);
    const graph = comfy.state.prompts.get(id(1))?.graph;
    const seeds = db.jobs[0]?.payload?.seeds as Record<string, number>;
    expect(graph?.["94"]?.inputs).toMatchObject({
      lyrics: pack.lyrics,
      tags: pack.style,
      seed: seeds["1"],
      duration: aceStepSeconds(pack.lyrics),
      bpm: 118,
      keyscale: "Eb major",
      language: "it",
    });
    expect(graph?.["98"]?.inputs.seconds).toBe(aceStepSeconds(pack.lyrics));
    expect(graph?.["107"]?.inputs.filename_prefix).toBe(
      "mellodifai/version/g1/take-1",
    );
    expect(comfy.state.prompts.get(id(2))?.graph["3"]?.inputs.seed).toBe(
      seeds["2"],
    );
    expect(seeds["1"]).toBeLessThan(2 ** 48);
    expect(comfy.state.prompts.get(id(1))?.clientId).toBe(COMFY_CLIENT_ID);
    for (const take of [1, 2])
      expect(
        await readFile(join(ctx.ws.outDir, `take-${take}.mp3`), "utf8"),
      ).toBe("mp3 fixture");
    const conversions = calls.filter(
      (call) => call.cmd === "ffmpeg" && call.args.includes("320k"),
    );
    expect(conversions[0]?.args).toEqual([
      "-y",
      "-hide_banner",
      "-loglevel",
      "error",
      "-i",
      join(ctx.ws.outDir, "take-1.flac"),
      "-map_metadata",
      "-1",
      "-c:a",
      "libmp3lame",
      "-b:a",
      "320k",
      join(ctx.ws.outDir, "take-1.part.mp3"),
    ]);
    expect(conversions.map((call) => call.args.at(-1))).toEqual([
      join(ctx.ws.outDir, "take-1.part.mp3"),
      join(ctx.ws.outDir, "take-2.part.mp3"),
    ]);
    expect(
      db.takes.map(({ take_number, engine, seed, abc, generation }) => ({
        take_number,
        engine,
        seed,
        abc,
        generation,
      })),
    ).toEqual([
      {
        take_number: 1,
        engine: "ace-step",
        seed: seeds["1"],
        abc: null,
        generation: 1,
      },
      {
        take_number: 2,
        engine: "ace-step",
        seed: seeds["2"],
        abc: null,
        generation: 1,
      },
    ]);
    expect(db.takes.every((take) => take.audio_preview_path)).toBe(true);
    expect(supervisor.ensureStarted).toHaveBeenCalledTimes(1);
    expect(supervisor.stop).toHaveBeenCalledTimes(1);
    expect(kieCalls()).toEqual([]);
    expect(ctx.version.kie_submit_state).toBeUndefined();
    // The workspace pack keeps the original lyrics: timing needs "Final Chorus".
    expect(await readFile(join(ctx.ws.versionsDir, "lyrics.txt"), "utf8")).toBe(
      pack.lyrics,
    );
  });
  it("scores both takes once the server is stopped", async () => {
    const { ctx, db, calls, supervisor } = await setup("ace-step");
    await generate(ctx);
    const scoring = calls.findIndex((call) =>
      call.args.some((arg) => arg.endsWith("score_takes.py")),
    );
    expect(scoring).toBeGreaterThan(-1);
    expect(calls[scoring]?.env.GROQ_API_KEY).toBe(GROQ);
    expect(supervisor.stop).toHaveBeenCalled();
    expect(
      db.takes.map((take) => (take.scores as { fidelity: number }).fidelity),
    ).toEqual([0.88, 0.8]);
  });
  it("uses the duration the user chose for ACE-Step", async () => {
    const { ctx, comfy } = await setup("ace-step", { duration: 95 });
    await generate(ctx);
    expect(comfy.state.prompts.get(id(1))?.graph["98"]?.inputs.seconds).toBe(
      95,
    );
  });
  it("hands ACE-Step the chosen tempo, key, time signature, steps and guidance", async () => {
    const { ctx, comfy } = await setup("ace-step", {
      settings: {
        bpm: 96,
        keyscale: "G minor",
        timeSignature: "3",
        steps: 50,
        guidance: 9,
      },
    });
    await generate(ctx);
    const graph = comfy.state.prompts.get(id(1))?.graph;
    expect(graph?.["94"]?.inputs).toMatchObject({
      bpm: 96,
      keyscale: "G minor",
      timesignature: "3",
    });
    // The drafted style said 118 BPM and E-flat major: the choice wins, not both.
    expect(graph?.["94"]?.inputs.tags).toBe(
      "Italian pop rock, E-flat major, female vocals",
    );
    expect(graph?.["3"]?.inputs).toMatchObject({ steps: 50, cfg: 9 });
    expect(comfy.state.prompts.get(id(2))?.graph["3"]?.inputs).toMatchObject({
      steps: 50,
      cfg: 9,
    });
  });
  it("leaves the style and the template defaults alone when everything is Auto", async () => {
    const { ctx, comfy, pack } = await setup("ace-step");
    await generate(ctx);
    const inputs = comfy.state.prompts.get(id(1))?.graph["94"]?.inputs;
    expect(inputs?.tags).toBe(pack.style);
    expect(inputs?.timesignature).toBe("4");
    expect(comfy.state.prompts.get(id(1))?.graph["3"]?.inputs).toMatchObject({
      steps: 30,
      cfg: 7,
    });
  });
  it("ignores a stored control that is out of range", async () => {
    const { ctx, comfy } = await setup("ace-step", {
      settings: { bpm: 5000, steps: 3, keyscale: "H major" },
    });
    await generate(ctx);
    expect(comfy.state.prompts.get(id(1))?.graph["94"]?.inputs).toMatchObject({
      bpm: 118,
      keyscale: "Eb major",
    });
    expect(comfy.state.prompts.get(id(1))?.graph["3"]?.inputs.steps).toBe(30);
  });
  it("uses a fixed seed for take 1 and the next one for take 2, and stores both", async () => {
    const { ctx, comfy, db } = await setup("ace-step", {
      settings: { seed: 424242 },
    });
    await generate(ctx);
    expect(comfy.state.prompts.get(id(1))?.graph["3"]?.inputs.seed).toBe(
      424242,
    );
    expect(comfy.state.prompts.get(id(2))?.graph["3"]?.inputs.seed).toBe(
      424243,
    );
    expect(comfy.state.prompts.get(id(1))?.graph["94"]?.inputs.seed).toBe(
      424242,
    );
    expect(db.takes.map((take) => take.seed)).toEqual([424242, 424243]);
    expect(db.jobs[0]?.payload?.seeds).toEqual({ "1": 424242, "2": 424243 });
  });
  it("gives YuE2 the tempo, key and signature as style tags", async () => {
    const { ctx, comfy } = await setup("yue2", {
      settings: { bpm: 100, keyscale: "A minor", timeSignature: "6" },
    });
    await generate(ctx);
    expect(comfy.state.prompts.get(id(1))?.graph["24"]?.inputs.style).toBe(
      "Italian pop rock, E-flat major, female vocals, 100 BPM, A minor, 6/8 time",
    );
  });
  it("sends YuE2 the mapped lyrics with the 420 s ceiling and keeps the ABC score", async () => {
    const { ctx, db, comfy, pack } = await setup("yue2");
    await generate(ctx);
    const graph = comfy.state.prompts.get(id(1))?.graph;
    expect(graph?.["24"]?.inputs).toMatchObject({
      lyrics: toYue2Lyrics(pack.lyrics),
      style: pack.style,
      temperature: 0.9,
    });
    expect(graph?.["25"]?.inputs).toMatchObject({
      lyrics: toYue2Lyrics(pack.lyrics),
      max_duration: YUE2_MAX_DURATION,
    });
    expect(YUE2_MAX_DURATION).toBe(420);
    expect(graph?.["8"]?.inputs.seed).toBe(graph?.["24"]?.inputs.seed);
    expect(db.takes.map((take) => take.abc)).toEqual([
      `X:1\nabc of ${id(1)}`,
      `X:1\nabc of ${id(2)}`,
    ]);
    expect(db.takes.every((take) => take.engine === "yue2")).toBe(true);
    // Take 2 ends at 418 s, within 5 s of the ceiling: the engine cut it.
    expect(
      db.takes.map((take) => (take.scores as { truncated: boolean }).truncated),
    ).toEqual([false, true]);
  });
  it("marks a YuE2 take truncated when its log reports the token budget", async () => {
    const { ctx, db, comfy, autoRun, scores } = await setup("yue2");
    if (scores.rows[1]) scores.rows[1].duration = 300;
    comfy.onSubmit((promptId) => {
      if (promptId === id(1))
        comfy.state.logs.push(
          "[WARNING] YuE2 semantic reached its token budget before the end token.",
        );
      setTimeout(() => autoRun(promptId), 5);
    });
    await generate(ctx);
    expect(
      db.takes.map((take) => (take.scores as { truncated: boolean }).truncated),
    ).toEqual([true, false]);
  });
  it("reads token-budget warnings only for YuE2, which has an end token of its own", async () => {
    const { ctx, db, comfy, autoRun } = await setup("ace-step");
    comfy.onSubmit((promptId) => {
      comfy.state.logs.push("token budget reduced to 1500");
      setTimeout(() => autoRun(promptId), 5);
    });
    await generate(ctx);
    expect(
      db.takes.map((take) => (take.scores as { truncated: boolean }).truncated),
    ).toEqual([false, false]);
  });
  it("publishes at most one progress event every 2 s, with an Italian stage label", async () => {
    const { ctx, runtime, comfy } = await setup("yue2");
    let clock = 0;
    runtime.now = () => clock;
    runtime.limits = { ...runtime.limits, stallMs: 1e12, takeMs: 1e12 };
    comfy.onSubmit((promptId) => {
      setTimeout(() => {
        const prompt = comfy.state.prompts.get(promptId);
        if (!prompt) return;
        prompt.status = "in_progress";
        for (let value = 0; value < 50; value += 1) {
          clock += 100;
          comfy.emit(promptId, "progress", { node: "25", value, max: 100 });
        }
        comfy.finish(promptId, {
          "10": {
            audio: [
              { filename: "x_00001.flac", subfolder: "s", type: "output" },
            ],
          },
        });
      }, 5);
    });
    await generate(ctx);
    const events = vi.mocked(ctx.progress).mock.calls;
    // 50 events 100 ms apart per take, 10 s in all: one event every 2 s at most.
    expect(events).toHaveLength(5);
    expect(events[0]).toEqual([8, "Brano 1 di 2 con YuE2: composizione"]);
    expect(events.at(-1)?.[1]).toBe("Brano 2 di 2 con YuE2: composizione");
  });
});

describe("local engine safety", () => {
  it("refuses a song whose owner is not the admin, with a fixed message and no work", async () => {
    const { ctx, comfy, supervisor, kieCalls } = await setup("yue2", {
      role: "customer",
    });
    await expect(generate(ctx)).rejects.toThrow(LOCAL_TEXT.adminOnly);
    expect(supervisor.ensureStarted).not.toHaveBeenCalled();
    expect(comfy.state.submitted).toEqual([]);
    expect(kieCalls()).toEqual([]);
  });
  it("never falls back to kie for an unknown engine value", async () => {
    const { ctx, kieCalls, supervisor } = await setup();
    ctx.project.song_settings = { engine: "suno-v9" };
    await expect(generate(ctx)).rejects.toThrow("Motore sconosciuto: suno-v9");
    expect(kieCalls()).toEqual([]);
    expect(supervisor.ensureStarted).not.toHaveBeenCalled();
  });
  it("fails without a ComfyUI runtime instead of using kie", async () => {
    const { ctx, kieCalls } = await setup();
    delete ctx.comfy;
    await expect(generate(ctx)).rejects.toThrow(LOCAL_TEXT.unavailable);
    expect(kieCalls()).toEqual([]);
  });
  it("waits instead of starting when a game holds the GPU", async () => {
    const { ctx, runtime, supervisor } = await setup();
    vi.mocked(runtime.freeVramMb).mockResolvedValue(3000);
    const result = await generate(ctx);
    expect(result.retryLater?.reason).toBe(LOCAL_TEXT.busyGpu);
    expect(Date.parse(result.retryLater?.notBefore ?? "")).toBeGreaterThan(
      Date.now(),
    );
    expect(supervisor.ensureStarted).not.toHaveBeenCalled();
  });
  it("fails when ComfyUI lacks the engine's nodes, and still stops the server", async () => {
    const { ctx, comfy, supervisor } = await setup("yue2");
    comfy.state.nodes.delete("YuE2GenerateMusic");
    await expect(generate(ctx)).rejects.toThrow(
      LOCAL_TEXT.missingNodes(["YuE2GenerateMusic"]),
    );
    expect(supervisor.stop).toHaveBeenCalledTimes(1);
  });
  it("does not retry a graph that ComfyUI rejects", async () => {
    const { ctx, comfy, supervisor } = await setup();
    comfy.state.rejectNext = true;
    await expect(generate(ctx)).rejects.toThrow(LOCAL_TEXT.rejected);
    expect(supervisor.restart).not.toHaveBeenCalled();
    expect(supervisor.stop).toHaveBeenCalledTimes(1);
  });
});

describe("local engine watchdog", () => {
  it("cancels a prompt that sends no event for the stall limit, restarts and resubmits once", async () => {
    const { ctx, comfy, supervisor, autoRun } = await setup();
    comfy.onSubmit((promptId) => {
      // The first prompt hangs like ComfyUI #16416: queued, then silent.
      if (promptId !== id(1)) setTimeout(() => autoRun(promptId), 5);
    });
    await expect(generate(ctx)).resolves.toMatchObject({
      versionStatus: "takes_review",
    });
    expect(comfy.state.cancelled).toContain(id(1));
    expect(supervisor.restart).toHaveBeenCalledTimes(1);
    expect(comfy.state.submitted).toEqual([id(1), id(1, true), id(2)]);
  });
  it("cancels a take that runs past the per-take limit even while events flow", async () => {
    const { ctx, comfy, runtime, supervisor, autoRun } = await setup();
    runtime.limits = { ...runtime.limits, takeMs: 150 };
    comfy.onSubmit((promptId) => {
      if (promptId !== id(1))
        return void setTimeout(() => autoRun(promptId), 5);
      const prompt = comfy.state.prompts.get(promptId);
      if (prompt) prompt.status = "in_progress";
      const timer = setInterval(() => {
        if (prompt?.status !== "in_progress") return clearInterval(timer);
        comfy.emit(promptId, "progress", { node: "3", value: 1, max: 30 });
      }, 20);
    });
    await generate(ctx);
    expect(comfy.state.cancelled).toContain(id(1));
    expect(supervisor.restart).toHaveBeenCalledTimes(1);
  });
  it("fails the job in Italian after a second failure and still stops the server", async () => {
    const { ctx, comfy, supervisor } = await setup();
    comfy.onSubmit((promptId) => {
      const prompt = comfy.state.prompts.get(promptId);
      if (!prompt) return;
      prompt.status = "failed";
      prompt.error = "CUDA out of memory";
    });
    await expect(generate(ctx)).rejects.toThrow(
      LOCAL_TEXT.failedTwice(1, "errore di ComfyUI: CUDA out of memory"),
    );
    expect(comfy.state.submitted).toEqual([id(1), id(1, true)]);
    expect(supervisor.restart).toHaveBeenCalledTimes(1);
    expect(supervisor.stop).toHaveBeenCalledTimes(1);
  });
});

describe("local engine recovery after a requeue", () => {
  it("reattaches to the prompt the crashed worker left running instead of submitting it again", async () => {
    const { ctx, comfy, autoRun } = await setup();
    ctx.job.payload = { seeds: { "1": 11, "2": 22 } };
    const { prompts } = comfy.state;
    prompts.set(id(1), {
      graph: {},
      clientId: COMFY_CLIENT_ID,
      status: "in_progress",
    });
    comfy.state.up = true;
    setTimeout(() => {
      const prompt = prompts.get(id(1));
      if (prompt)
        prompt.graph = {
          "107": {
            inputs: { filename_prefix: "mellodifai/version/g1/take-1" },
          },
        };
      autoRun(id(1));
    }, 50);
    await generate(ctx);
    expect(comfy.state.submitted).toEqual([id(2)]);
    expect(comfy.state.prompts.get(id(2))?.graph["3"]?.inputs.seed).toBe(22);
  });
  it("fetches a prompt that finished while no worker was watching", async () => {
    const { ctx, comfy } = await setup();
    comfy.state.prompts.set(id(1), {
      graph: {},
      clientId: COMFY_CLIENT_ID,
      status: "completed",
      outputs: {
        "107": {
          audio: [{ filename: "a_00001.flac", subfolder: "s", type: "output" }],
        },
      },
    });
    await generate(ctx);
    expect(comfy.state.submitted).toEqual([id(2)]);
    expect(await readFile(join(ctx.ws.outDir, "take-1.flac"), "utf8")).toBe(
      "FLAC a_00001.flac",
    );
  });
  it("uses the output file when a restarted server no longer knows the prompt", async () => {
    const { ctx, comfy, outputDir } = await setup();
    const dir = join(outputDir, "mellodifai", "version", "g1");
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, "take-1_00001.flac"), "FLAC from disk");
    await generate(ctx);
    expect(comfy.state.submitted).toEqual([id(2)]);
    expect(await readFile(join(ctx.ws.outDir, "take-1.flac"), "utf8")).toBe(
      "FLAC from disk",
    );
  });
  it("follows the watchdog's second attempt when the worker crashed after resubmitting", async () => {
    const { ctx, comfy, autoRun } = await setup();
    comfy.state.prompts.set(id(1, true), {
      graph: {
        "107": { inputs: { filename_prefix: "mellodifai/version/g1/take-1" } },
      },
      clientId: COMFY_CLIENT_ID,
      status: "in_progress",
    });
    setTimeout(() => autoRun(id(1, true)), 30);
    await generate(ctx);
    expect(comfy.state.submitted).toEqual([id(2)]);
  });
  it("skips a take that was already converted, and keeps the saved seeds", async () => {
    const { ctx, comfy, db } = await setup();
    ctx.job.payload = { seeds: { "1": 11, "2": 22 } };
    const patch = vi.spyOn(db, "patchJobPayload");
    await writeFile(join(ctx.ws.outDir, "take-1.mp3"), "done before");
    await writeFile(
      join(ctx.ws.outDir, "local-1-take-1.json"),
      JSON.stringify({
        take: 1,
        promptId: id(1),
        seed: 11,
        abc: null,
        budget: false,
      }),
    );
    await generate(ctx);
    expect(comfy.state.submitted).toEqual([id(2)]);
    expect(patch).not.toHaveBeenCalled();
    expect(db.takes.map((take) => take.seed)).toEqual([11, 22]);
  });
  it("removes a stale kie alignment so timing hears the local take", async () => {
    const { ctx } = await setup();
    await writeFile(join(ctx.ws.outDir, "aligned-take1.json"), "{}");
    await generate(ctx);
    await expect(
      stat(join(ctx.ws.outDir, "aligned-take1.json")),
    ).rejects.toThrow();
  });
});
