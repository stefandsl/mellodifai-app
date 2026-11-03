import { EventEmitter } from "node:events";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  ACE_STEP_TEXT,
  aceStepStatusText,
  type LocalEngineStatus,
  type LyricPack,
} from "@mellodifai/shared";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AceStepClient } from "../src/ace-step/client.js";
import { HOST_SCRIPT } from "../src/ace-step/host-script.js";
import {
  type AceStepDeps,
  AceStepError,
  AceStepSupervisor,
  DEFAULT_ACE_STEP_CONFIG,
} from "../src/ace-step/supervisor.js";
import { InMemoryDb } from "../src/db.js";
import { Engine, type Spawn } from "../src/engine.js";
import type { StageContext } from "../src/loop.js";
import {
  ACE_STEP_LIMITS,
  type AceStepRuntime,
  aceStepSeconds,
  aceStepStyle,
} from "../src/stages/ace-step.js";

ACE_STEP_LIMITS.pollMs = 5;

import { generateSong } from "../src/stages/generate-song.js";

const roots: string[] = [];
const servers: Server[] = [];
afterEach(async () => {
  for (const server of servers.splice(0)) server.close();
  for (const root of roots.splice(0))
    await rm(root, { recursive: true, force: true });
});
async function tempRoot() {
  const root = await mkdtemp(join(tmpdir(), "ace-step-"));
  roots.push(root);
  return root;
}

type FakeTask = { id: string; body: Record<string, unknown>; polls: number };
// A stand-in for ACE-Step's own REST API: same paths and envelopes as docs/en/API.md.
async function fakeAceServer(options: {
  key: string;
  pollsUntilDone?: number;
  fail?: (task: FakeTask) => boolean;
}) {
  const tasks = new Map<string, FakeTask>();
  let healthy = true;
  const server = createServer((request, response) => {
    const send = (status: number, data: unknown) => {
      response.writeHead(status, { "Content-Type": "application/json" });
      response.end(JSON.stringify({ data, code: status, error: null }));
    };
    if (request.headers.authorization !== `Bearer ${options.key}`)
      return send(401, null);
    const url = new URL(request.url ?? "/", "http://127.0.0.1");
    if (url.pathname === "/health")
      return healthy
        ? send(200, { status: "ok", service: "ACE-Step API" })
        : send(503, null);
    if (url.pathname === "/v1/audio") {
      response.writeHead(200, { "Content-Type": "audio/wav" });
      return response.end(`RIFF-${url.searchParams.get("path")}`);
    }
    let raw = "";
    request.on("data", (chunk) => {
      raw += chunk;
    });
    request.on("end", () => {
      const body = JSON.parse(raw || "{}") as Record<string, unknown>;
      if (url.pathname === "/release_task") {
        const id = `task-${tasks.size + 1}`;
        tasks.set(id, { id, body, polls: 0 });
        return send(200, { task_id: id, status: "queued", queue_position: 1 });
      }
      if (url.pathname === "/query_result") {
        const ids = body.task_id_list as string[];
        return send(
          200,
          ids.flatMap((id) => {
            const task = tasks.get(id);
            if (!task) return [];
            task.polls += 1;
            if (options.fail?.(task))
              return [{ task_id: id, status: 2, result: "boom" }];
            if (task.polls < (options.pollsUntilDone ?? 2))
              return [{ task_id: id, status: 0 }];
            return [
              {
                task_id: id,
                status: 1,
                result: JSON.stringify([
                  {
                    file: `/v1/audio?path=${id}.wav`,
                    seed_value: String(task.body.seed),
                  },
                ]),
              },
            ];
          }),
        );
      }
      send(404, null);
    });
  });
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = (server.address() as AddressInfo).port;
  return {
    tasks,
    baseUrl: `http://127.0.0.1:${port}`,
    port,
    setHealthy: (value: boolean) => {
      healthy = value;
    },
  };
}

function supervisorDeps(overrides: Partial<AceStepDeps> = {}) {
  const runs: { command: string; args: string[] }[] = [];
  const statuses: LocalEngineStatus[] = [];
  const killed: number[] = [];
  const deps: AceStepDeps = {
    run: vi.fn(async (command: string, args: string[]) => {
      runs.push({ command, args });
    }),
    spawnServer: vi.fn(() => ({ pid: 4242, exited: new Promise(() => {}) })),
    killPid: vi.fn(async (pid: number) => {
      killed.push(pid);
    }),
    fetch: (input, init) => fetch(input, init),
    publish: vi.fn(async (status: LocalEngineStatus) => {
      statuses.push(status);
    }),
    freeDiskBytes: async () => 500_000_000_000,
    sleep: async () => {},
    report: () => {},
    ...overrides,
  };
  return { deps, runs, statuses, killed };
}

describe("AceStepSupervisor provisioning", () => {
  it("installs from the pinned tag on E:-style paths, once, then reports ready", async () => {
    const root = await tempRoot();
    const { deps, runs, statuses } = supervisorDeps();
    const supervisor = new AceStepSupervisor(deps, {
      ...DEFAULT_ACE_STEP_CONFIG,
      root,
    });
    await supervisor.announce();
    expect(statuses.at(-1)?.state).toBe("not_installed");
    await supervisor.ensureInstalled();
    expect(runs.map((run) => run.command)).toEqual([
      "git",
      "uv",
      join(root, "venv", "Scripts", "python.exe"),
      join(root, "venv", "Scripts", "python.exe"),
    ]);
    expect(runs[0]?.args).toEqual([
      "clone",
      "--depth",
      "1",
      "--branch",
      "v0.1.8",
      "https://github.com/ace-step/ACE-Step-1.5.git",
      join(root, "src"),
    ]);
    expect(runs[1]?.args).toEqual(["sync", "--python", "3.12", "--no-dev"]);
    expect(runs[2]?.args).toContain("ACE-Step/Ace-Step1.5");
    expect(runs[2]?.args).toContain(JSON.stringify(["acestep-5Hz-lm-1.7B/*"]));
    expect(runs[3]?.args).toContain("ACE-Step/acestep-5Hz-lm-0.6B");
    expect(statuses.map((status) => status.step).filter(Boolean)).toEqual([
      "download_code",
      "install",
      "download_models",
    ]);
    expect(statuses.at(-1)?.state).toBe("ready");
    runs.length = 0;
    await supervisor.ensureInstalled();
    expect(runs).toEqual([]);
    expect(await supervisor.installed()).toBe(true);
  });

  it("runs concurrent first uses as one installation", async () => {
    const root = await tempRoot();
    const { deps, runs } = supervisorDeps();
    const supervisor = new AceStepSupervisor(deps, {
      ...DEFAULT_ACE_STEP_CONFIG,
      root,
    });
    await Promise.all([
      supervisor.ensureInstalled(),
      supervisor.ensureInstalled(),
    ]);
    expect(runs).toHaveLength(4);
  });

  it("resumes after a failed step without redoing finished ones, in plain Italian", async () => {
    const root = await tempRoot();
    let failInstall = true;
    const { deps, runs, statuses } = supervisorDeps({
      run: vi.fn(async (command: string, args: string[]) => {
        runs.push({ command, args });
        if (command === "uv" && failInstall)
          throw new Error("uv exited 2\nerror: getaddrinfo ENOTFOUND pypi.org");
      }),
    });
    const supervisor = new AceStepSupervisor(deps, {
      ...DEFAULT_ACE_STEP_CONFIG,
      root,
    });
    const error = await supervisor.ensureInstalled().catch((e: unknown) => e);
    expect(error).toBeInstanceOf(AceStepError);
    expect((error as Error).message).toBe(ACE_STEP_TEXT.errorNetwork);
    expect(statuses.at(-1)).toMatchObject({ state: "error", step: "install" });
    expect(statuses.at(-1)?.message).not.toMatch(/uv|pypi|getaddrinfo/u);
    failInstall = false;
    runs.length = 0;
    await supervisor.ensureInstalled();
    expect(runs.map((run) => run.command)[0]).toBe("uv");
    expect(runs.some((run) => run.command === "git")).toBe(false);
  });

  it("refuses to start an install without disk space", async () => {
    const root = await tempRoot();
    const { deps, runs, statuses } = supervisorDeps({
      freeDiskBytes: async () => 1_000_000,
    });
    const supervisor = new AceStepSupervisor(deps, {
      ...DEFAULT_ACE_STEP_CONFIG,
      root,
    });
    await expect(supervisor.ensureInstalled()).rejects.toThrow(
      ACE_STEP_TEXT.errorNoSpace,
    );
    expect(runs).toEqual([]);
    expect(statuses.at(-1)?.state).toBe("error");
  });
});

async function installedSupervisor(
  port: number,
  overrides: Partial<AceStepDeps> = {},
) {
  const root = await tempRoot();
  await mkdir(join(root, "state"), { recursive: true });
  for (const name of ["code-v0.1.8", "install-v0.1.8", "models-v1"])
    await writeFile(join(root, "state", `${name}.done`), "x");
  const parts = supervisorDeps(overrides);
  const supervisor = new AceStepSupervisor(parts.deps, {
    ...DEFAULT_ACE_STEP_CONFIG,
    root,
    port,
    healthTimeoutMs: 50,
  });
  return { supervisor, root, ...parts };
}

describe("AceStepSupervisor server lifetime", () => {
  it("starts the server on 127.0.0.1 with the key, and stops it when the last user leaves", async () => {
    const port = 1;
    const { supervisor, root, deps, killed, statuses } =
      await installedSupervisor(port);
    const server = await fakeAceServer({ key: supervisor.apiKey });
    Object.assign(supervisor.config, { port: server.port });
    await supervisor.acquire();
    const call = vi.mocked(deps.spawnServer).mock.calls[0];
    expect(call?.[0]).toBe(join(root, "venv", "Scripts", "python.exe"));
    expect(call?.[1]).toContain("--parent-pid");
    expect(call?.[2].env).toMatchObject({
      ACESTEP_API_HOST: "127.0.0.1",
      ACESTEP_API_PORT: String(server.port),
      ACESTEP_API_KEY: supervisor.apiKey,
      ACESTEP_CHECKPOINTS_DIR: join(root, "checkpoints"),
      ACESTEP_LM_MODEL_PATH: "acestep-5Hz-lm-0.6B",
      ACESTEP_LM_BACKEND: "pt",
    });
    expect(await readFile(join(root, "state", "server.pid"), "utf8")).toBe(
      "4242",
    );
    expect(
      await readFile(join(root, "launcher", "acestep_host.py"), "utf8"),
    ).toBe(HOST_SCRIPT);
    expect(supervisor.isRunning()).toBe(true);
    await supervisor.acquire();
    await supervisor.release();
    expect(killed).toEqual([]);
    await supervisor.release();
    expect(killed).toEqual([4242]);
    expect(supervisor.isRunning()).toBe(false);
    expect(statuses.at(-1)?.state).toBe("ready");
  });

  it("kills a server left by a crashed worker before starting a new one", async () => {
    const { supervisor, root, killed } = await installedSupervisor(1);
    const server = await fakeAceServer({ key: supervisor.apiKey });
    Object.assign(supervisor.config, { port: server.port });
    await writeFile(join(root, "state", "server.pid"), "999");
    await supervisor.acquire();
    expect(killed).toEqual([999]);
    await supervisor.shutdown();
    expect(killed).toEqual([999, 4242]);
  });

  it("gives up with an Italian message when the server never becomes healthy", async () => {
    const { supervisor, killed, statuses } = await installedSupervisor(1);
    const server = await fakeAceServer({ key: supervisor.apiKey });
    server.setHealthy(false);
    Object.assign(supervisor.config, { port: server.port });
    await expect(supervisor.acquire()).rejects.toThrow(
      ACE_STEP_TEXT.errorStart,
    );
    expect(killed).toContain(4242);
    expect(statuses.at(-1)).toMatchObject({
      state: "error",
      message: ACE_STEP_TEXT.errorStart,
    });
  });

  it("the launcher ties the server to the worker with a Job Object and a parent watch", () => {
    expect(HOST_SCRIPT).toContain("KILL_ON_JOB_CLOSE");
    expect(HOST_SCRIPT).toContain("WaitForSingleObject");
    expect(HOST_SCRIPT).toContain('runpy.run_module("acestep.api_server"');
  });
});

describe("AceStepClient", () => {
  it("rejects audio links that point away from the local server", async () => {
    const client = new AceStepClient("http://127.0.0.1:1", "k");
    await expect(client.download("http://example.com/x.wav")).rejects.toThrow(
      /outside/u,
    );
  });
});

const pack: LyricPack = {
  title: "Prova",
  lyrics: "[Verse 1]\nCiao mare\n[Chorus]\nCanta con me",
  style: "pop italiano, chitarra",
  exclude: "",
  settings: {
    model: "V6",
    vocalGender: "f",
    duration: 95,
    styleWeight: 0.5,
    weirdness: 0.5,
    variety: 2,
  },
  displayMap: {},
  l10n: {},
};

async function stageSetup(
  server: Awaited<ReturnType<typeof fakeAceServer>>,
  key: string,
) {
  const root = await tempRoot();
  const ws = {
    root,
    versionsDir: join(root, "versions"),
    outDir: join(root, "out", "it"),
    publicDir: join(root, "public"),
    renderDir: join(root, "render"),
  };
  await mkdir(ws.outDir, { recursive: true });
  const calls: { cmd: string; args: string[] }[] = [];
  const spawn: Spawn = (cmd, args) => {
    const child = Object.assign(new EventEmitter(), {
      stdout: new EventEmitter(),
      stderr: new EventEmitter(),
    });
    calls.push({ cmd, args: [...args] });
    setImmediate(() => {
      void (async () => {
        if (cmd === "ffmpeg") await writeFile(String(args.at(-1)), "mp3");
        child.emit("close", 0);
      })();
    });
    return child as unknown as ReturnType<Spawn>;
  };
  const db = new InMemoryDb();
  db.profiles.push({ id: "owner", role: "admin" });
  const runtime: AceStepRuntime & { restarts: number; uses: number } = {
    baseUrl: server.baseUrl,
    apiKey: key,
    restarts: 0,
    uses: 0,
    acquire: async () => {
      runtime.uses += 1;
    },
    release: async () => {
      runtime.uses -= 1;
    },
    restart: async () => {
      runtime.restarts += 1;
    },
    isRunning: () => false,
    freeVramMb: async () => 7800,
  };
  const ctx: StageContext = {
    job: {
      owner_id: "owner",
      id: "job",
      stage: "generate_song",
      version_id: "version",
      status: "running",
      idempotency_key: "generate_song:version:1",
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
      topic: "Prova",
      theme: "vbp",
      song_settings: { engine: "ace-step", model: "V6" },
    },
    ws,
    db,
    engine: new Engine({ spawn, log: async () => {} }).withWorkspace(root),
    storage: { upload: vi.fn(async () => {}) },
    log: vi.fn(async () => {}),
    progress: vi.fn(async () => {}),
    secrets: { values: {}, redact: (line) => line },
    signal: new AbortController().signal,
    aceStep: runtime,
  };
  db.versions.push(ctx.version);
  db.projects.push(ctx.project);
  return { ctx, db, calls, runtime, ws };
}

describe("generate_song with ACE-Step", () => {
  it("makes two takes locally, never calls kie, and records seed and engine", async () => {
    const key = "test-key";
    const server = await fakeAceServer({ key });
    const { ctx, db, calls, runtime, ws } = await stageSetup(server, key);
    const result = await generateSong(ctx);
    expect(result.versionStatus).toBe("takes_review");
    expect(calls.some((call) => call.args.join(" ").includes("kie.mjs"))).toBe(
      false,
    );
    const bodies = [...server.tasks.values()].map((task) => task.body);
    expect(bodies).toHaveLength(2);
    expect(bodies[0]).toMatchObject({
      prompt: "pop italiano, chitarra, female vocals",
      lyrics: pack.lyrics,
      audio_duration: 95,
      vocal_language: "it",
      use_random_seed: false,
      batch_size: 1,
    });
    expect(bodies[0]?.seed).not.toBe(bodies[1]?.seed);
    const mp3 = calls.filter((call) => call.args.includes("320k"));
    expect(mp3).toHaveLength(2);
    expect(
      db.takes.map((take) => [take.take_number, take.engine, take.kie_task_id]),
    ).toEqual([
      [1, "ace-step", null],
      [2, "ace-step", null],
    ]);
    expect(db.takes.map((take) => take.seed)).toEqual(
      bodies.map((body) => body.seed),
    );
    expect(await readFile(join(ws.outDir, "take-1.mp3"), "utf8")).toBe("mp3");
    expect(runtime.uses).toBe(0);
    expect(vi.mocked(ctx.progress).mock.calls.length).toBeGreaterThan(0);
  });

  it("resumes after a requeue: finished takes and submitted tasks are not redone", async () => {
    const key = "test-key";
    const server = await fakeAceServer({ key });
    const { ctx, ws } = await stageSetup(server, key);
    await writeFile(
      join(ws.outDir, "ace-g1-seeds.json"),
      JSON.stringify([11, 22]),
    );
    await writeFile(join(ws.outDir, "ace-g1-take-1.mp3"), "old take 1");
    await generateSong(ctx);
    expect([...server.tasks.values()].map((task) => task.body.seed)).toEqual([
      22,
    ]);
    expect(await readFile(join(ws.outDir, "take-1.mp3"), "utf8")).toBe(
      "old take 1",
    );
  });

  it("retries a failed take once on a restarted server, then fails in Italian", async () => {
    const key = "test-key";
    const server = await fakeAceServer({ key, fail: () => true });
    const { ctx, runtime } = await stageSetup(server, key);
    await expect(generateSong(ctx)).rejects.toThrow(ACE_STEP_TEXT.errorTake);
    expect(runtime.restarts).toBe(1);
    expect(server.tasks.size).toBe(2);
    expect(runtime.uses).toBe(0);
  });

  it("waits instead of failing when the GPU is busy", async () => {
    const key = "test-key";
    const server = await fakeAceServer({ key });
    const { ctx, runtime } = await stageSetup(server, key);
    runtime.freeVramMb = async () => 1200;
    const result = await generateSong(ctx);
    expect(result.retryLater?.reason).toBe(ACE_STEP_TEXT.errorGpu);
    expect(server.tasks.size).toBe(0);
  });

  it("fails clearly when the worker has no ACE-Step runtime", async () => {
    const key = "test-key";
    const server = await fakeAceServer({ key });
    const { ctx } = await stageSetup(server, key);
    delete ctx.aceStep;
    await expect(generateSong(ctx)).rejects.toThrow(ACE_STEP_TEXT.errorStart);
  });

  it("maps pack settings to ACE-Step inputs", () => {
    expect(
      aceStepSeconds({
        ...pack,
        settings: { ...pack.settings, duration: null },
      }),
    ).toBe(210);
    expect(
      aceStepSeconds({
        ...pack,
        settings: { ...pack.settings, duration: 999 },
      }),
    ).toBe(360);
    expect(
      aceStepStyle({
        ...pack,
        settings: { ...pack.settings, vocalGender: undefined },
      }),
    ).toBe("pop italiano, chitarra");
  });
});

describe("status text", () => {
  it("is plain Italian and never a dead end", () => {
    expect(aceStepStatusText({ state: "ready" }, false)).toBe(
      ACE_STEP_TEXT.offline,
    );
    expect(aceStepStatusText({ state: "not_installed" }, true)).toBe(
      ACE_STEP_TEXT.notInstalled,
    );
    expect(
      aceStepStatusText(
        { state: "installing", step: "download_models", pct: 41.6 },
        true,
      ),
    ).toBe(`${ACE_STEP_TEXT.download_models} 42%`);
  });
});

describe("workers.engines entry for native ACE-Step", () => {
  it("is offered to the studio selector and carries the setup state", async () => {
    const { aceStepEntry } = await import("../src/ace-step/runtime.js");
    const entry = aceStepEntry(
      { state: "installing", step: "install", pct: 10 },
      new Date("2026-11-03T10:00:00Z"),
    );
    expect(entry).toMatchObject({
      installed: true,
      passedLangs: ["it"],
      features: [],
      state: "installing",
      step: "install",
      pct: 10,
      checkedAt: "2026-11-03T10:00:00.000Z",
    });
  });
});
