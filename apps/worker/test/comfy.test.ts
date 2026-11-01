import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { checkEngines, publishEngines } from "../src/comfy/availability.js";
import {
  COMFY_CONFIG,
  type ComfyConfig,
  comfyLaunch,
  LOCAL_ENGINES,
} from "../src/comfy/config.js";
import {
  aceGraph,
  bpmAndKey,
  loadGraph,
  toYue2Lyrics,
  yue2Graph,
} from "../src/comfy/graphs.js";
import { PROMPT_NAMESPACE, uuidv5 } from "../src/comfy/ids.js";
import {
  ComfySupervisor,
  type SupervisorDeps,
} from "../src/comfy/supervisor.js";
import { InMemoryDb } from "../src/db.js";
import { startLocalEngines } from "../src/main.js";
import { type FakeComfy, fakeComfy } from "./fake-comfy.js";

const roots: string[] = [];
const servers: FakeComfy[] = [];
afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => server.close()));
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});
async function temp() {
  const root = await mkdtemp(join(tmpdir(), "mellodifai-comfy-"));
  roots.push(root);
  return root;
}

describe("engine availability from files", () => {
  async function install(root: string, version = "0.43.0") {
    await mkdir(join(root, "python_embeded"), { recursive: true });
    await mkdir(join(root, "ComfyUI", "models", "checkpoints"), {
      recursive: true,
    });
    await writeFile(join(root, "python_embeded", "python.exe"), "");
    await writeFile(join(root, "ComfyUI", "main.py"), "");
    await writeFile(
      join(root, "ComfyUI", "comfyui_version.py"),
      `# generated\n__version__ = "${version}"\n`,
    );
  }
  const engines = {
    yue2: {
      ...LOCAL_ENGINES.yue2,
      files: [{ path: "checkpoints\\yue2.safetensors", bytes: 5 }],
    },
    "ace-step": {
      ...LOCAL_ENGINES["ace-step"],
      files: [{ path: "checkpoints\\ace.safetensors", bytes: 3 }],
    },
  };
  it("reports an engine installed only when every model file has its exact size", async () => {
    const root = await temp();
    await install(root);
    await writeFile(
      join(root, "ComfyUI", "models", "checkpoints", "yue2.safetensors"),
      "12345",
    );
    // A partial download: right name, wrong size.
    await writeFile(
      join(root, "ComfyUI", "models", "checkpoints", "ace.safetensors"),
      "12",
    );
    const now = new Date("2026-11-01T10:00:00Z");
    const result = await checkEngines({ ...COMFY_CONFIG, root }, engines, now);
    expect(result).toEqual({
      yue2: {
        installed: true,
        passedLangs: ["it"],
        minutesPerAudioMinute: 1.6,
        features: [],
        checkedAt: "2026-11-01T10:00:00.000Z",
      },
      "ace-step": {
        installed: false,
        passedLangs: ["it"],
        minutesPerAudioMinute: 0.8,
        features: ["rewrite", "cover"],
        checkedAt: "2026-11-01T10:00:00.000Z",
      },
    });
  });
  it("reports nothing installed when ComfyUI is another version than the one tested", async () => {
    const root = await temp();
    await install(root, "0.44.0");
    await writeFile(
      join(root, "ComfyUI", "models", "checkpoints", "yue2.safetensors"),
      "12345",
    );
    const result = await checkEngines({ ...COMFY_CONFIG, root }, engines);
    expect(result.yue2.installed).toBe(false);
  });
  it("names the bake-off model files with the sizes measured there", () => {
    expect(LOCAL_ENGINES.yue2.files).toEqual([
      {
        path: "checkpoints\\yue2_3b_int8_convrot.safetensors",
        bytes: 3_960_938_800,
      },
    ]);
    expect(LOCAL_ENGINES["ace-step"].files.map((file) => file.path)).toContain(
      "diffusion_models\\acestep_v1.5_sft.safetensors",
    );
  });
  it("publishes the result on the worker row without starting anything", async () => {
    const db = new InMemoryDb();
    const check = vi.fn(async () => ({
      yue2: {
        installed: true,
        passedLangs: ["it" as const],
        minutesPerAudioMinute: 1.6,
        features: [],
        checkedAt: "x",
      },
    }));
    await publishEngines(db, "worker-1", check);
    expect(db.workers).toEqual([
      { id: "worker-1", engines: await check.mock.results[0]?.value },
    ]);
  });
});

describe("ComfySupervisor", () => {
  async function setup(options: { up?: boolean; pid?: number } = {}) {
    const root = await temp();
    const comfy = await fakeComfy();
    servers.push(comfy);
    comfy.state.up = options.up ?? false;
    const config: ComfyConfig = {
      ...COMFY_CONFIG,
      root: join(root, "portable"),
      dataDir: join(root, "data"),
      logFile: join(root, "data", "comfy.log"),
      pidFile: join(root, "state", "comfy.pid"),
      port: comfy.port,
      startTimeoutMs: 1_000,
    };
    if (options.pid) {
      await mkdir(join(root, "state"), { recursive: true });
      await writeFile(config.pidFile, String(options.pid));
    }
    let exit: (code: number) => void = () => {};
    const killed: number[] = [];
    const deps = {
      spawn: vi.fn<SupervisorDeps["spawn"]>(() => {
        // The real server answers /system_stats a few seconds after the launch.
        setTimeout(() => {
          comfy.state.up = true;
        }, 30);
        return {
          pid: 4321,
          exited: new Promise<unknown>((resolve) => {
            exit = resolve;
          }),
        };
      }),
      killTree: vi.fn(async (pid: number) => {
        killed.push(pid);
        setTimeout(() => {
          comfy.state.up = false;
          exit(1);
        }, 20);
      }),
      isComfyProcess: vi.fn(async () => true),
      sleep: (ms: number) =>
        new Promise<void>((resolve) => setTimeout(resolve, Math.min(ms, 10))),
      report: vi.fn(),
    } satisfies SupervisorDeps;
    const supervisor = new ComfySupervisor(deps, config);
    return {
      supervisor,
      deps,
      comfy,
      config,
      killed,
      exit: (code: number) => exit(code),
    };
  }

  it("starts the server on demand with the bake-off command and waits for /system_stats", async () => {
    const { supervisor, deps, config } = await setup();
    await supervisor.ensureStarted();
    const launch = comfyLaunch(config);
    expect(deps.spawn).toHaveBeenCalledTimes(1);
    expect(deps.spawn).toHaveBeenCalledWith(
      launch.command,
      launch.args,
      expect.objectContaining({
        cwd: config.root,
        logFile: config.logFile,
        env: expect.objectContaining({
          HF_HOME: join(config.dataDir, "cache\\hf"),
          TEMP: join(config.dataDir, "temp"),
        }),
      }),
    );
    expect(launch.args).toEqual([
      "-s",
      "ComfyUI\\main.py",
      "--windows-standalone-build",
      "--disable-auto-launch",
      "--listen",
      "127.0.0.1",
      "--port",
      String(config.port),
      "--reserve-vram",
      "1.0",
      "--output-directory",
      join(config.dataDir, "output"),
      "--input-directory",
      join(config.dataDir, "input"),
      "--temp-directory",
      join(config.dataDir, "temp"),
      "--user-directory",
      join(config.dataDir, "user"),
    ]);
    expect(await readFile(config.pidFile, "utf8")).toBe("4321");
    await supervisor.ensureStarted();
    expect(deps.spawn).toHaveBeenCalledTimes(1);
  });
  it("starts only once when two callers ask at the same time", async () => {
    const { supervisor, deps } = await setup();
    await Promise.all([supervisor.ensureStarted(), supervisor.ensureStarted()]);
    expect(deps.spawn).toHaveBeenCalledTimes(1);
  });
  it("stops the whole process tree, waits for the port to close and forgets the PID", async () => {
    const { supervisor, killed, comfy, config } = await setup();
    await supervisor.ensureStarted();
    await supervisor.stop();
    expect(killed).toEqual([4321]);
    expect(comfy.state.up).toBe(false);
    await expect(readFile(config.pidFile, "utf8")).rejects.toThrow();
    await supervisor.stop();
    expect(killed).toEqual([4321]);
  });
  it("adopts a server it started before a crash instead of starting a second one", async () => {
    const { supervisor, deps, killed } = await setup({ up: true, pid: 777 });
    expect(await supervisor.adopt()).toBe(true);
    await supervisor.ensureStarted();
    expect(deps.spawn).not.toHaveBeenCalled();
    expect(deps.isComfyProcess).toHaveBeenCalledWith(777);
    await supervisor.stop();
    expect(killed).toEqual([777]);
  });
  it("uses a server nobody recorded but never kills it: it only frees the GPU", async () => {
    const { supervisor, deps, killed, comfy } = await setup({ up: true });
    await supervisor.ensureStarted();
    expect(deps.spawn).not.toHaveBeenCalled();
    await supervisor.stop();
    expect(killed).toEqual([]);
    expect(comfy.state.freed).toBe(1);
  });
  it("does not trust a PID file whose process is no longer ComfyUI", async () => {
    const { supervisor, deps, killed } = await setup({ up: true, pid: 999 });
    deps.isComfyProcess.mockResolvedValue(false);
    await supervisor.ensureStarted();
    await supervisor.stop();
    expect(killed).toEqual([]);
  });
  it("removes a stale PID file when nothing answers and starts a fresh server", async () => {
    const { supervisor, deps, config } = await setup({ pid: 555 });
    expect(await supervisor.adopt()).toBe(false);
    await expect(readFile(config.pidFile, "utf8")).rejects.toThrow();
    await supervisor.ensureStarted();
    expect(deps.spawn).toHaveBeenCalledTimes(1);
    expect(deps.killTree).not.toHaveBeenCalledWith(555);
  });
  it("gives up after the start timeout, kills what it started and says so in Italian", async () => {
    const { supervisor, deps, killed, config } = await setup();
    deps.spawn.mockImplementation(() => ({
      pid: 4321,
      exited: new Promise(() => {}),
    }));
    await expect(supervisor.ensureStarted()).rejects.toThrow(
      "ComfyUI non ha risposto entro 1 secondi",
    );
    expect(killed).toEqual([4321]);
    await expect(readFile(config.pidFile, "utf8")).rejects.toThrow();
  });
  it("fails at once when the server process exits while starting", async () => {
    const { supervisor, deps } = await setup();
    deps.spawn.mockImplementation(() => ({
      pid: 4321,
      exited: Promise.resolve(1),
    }));
    const started = Date.now();
    await expect(supervisor.ensureStarted()).rejects.toThrow(
      "ComfyUI si è chiuso durante l'avvio",
    );
    expect(Date.now() - started).toBeLessThan(900);
  });
  it("refuses a server of another version than the tested one", async () => {
    const { supervisor, comfy } = await setup({ up: true });
    comfy.state.version = "0.44.0";
    await expect(supervisor.ensureStarted()).rejects.toThrow(
      "ComfyUI 0.44.0 non è la versione provata (0.43.0)",
    );
  });
  it("restarts by stopping and starting again", async () => {
    const { supervisor, deps, killed } = await setup();
    await supervisor.ensureStarted();
    await supervisor.restart();
    expect(killed).toEqual([4321]);
    expect(deps.spawn).toHaveBeenCalledTimes(2);
    expect(await supervisor.isUp()).toBe(true);
  });
});

describe("YuE2 lyric mapping (design 5.4)", () => {
  it.each(["a-vbp-passa", "b-effe-esse", "c-vbp-pazienza"])(
    "maps the bake-off pack %s exactly as the bake-off did",
    async (pack) => {
      const dir = join(import.meta.dirname, "fixtures", "yue2", pack);
      const lyrics = await readFile(join(dir, "lyrics.txt"), "utf8");
      const expected = await readFile(join(dir, "yue2_lyrics.txt"), "utf8");
      expect(toYue2Lyrics(lyrics)).toBe(expected.replaceAll("\r\n", "\n"));
    },
  );
  it("merges chorus tags, drops directions and parenthesised lines, expands (x2)", () => {
    expect(
      toYue2Lyrics(
        [
          "[Intro: Spoken Word, calmo]",
          "(respiro)",
          "Ciao a tutti",
          "",
          "[Chorus 2]",
          "Va bene (x2)",
          "[Final Chorus]",
          "Passa",
          "[Shouted, gang vocals]",
          "Ehi",
        ].join("\n"),
      ),
    ).toBe(
      [
        "[Intro]",
        "Ciao a tutti",
        "",
        "[Chorus]",
        "Va bene",
        "Va bene",
        "",
        "[Chorus]",
        "Passa",
        "",
        "[Shouted]",
        "Ehi",
        "",
      ].join("\n"),
    );
  });
});

describe("graph fill maps", () => {
  it("fills the YuE2 template on the nodes of design 5.3", async () => {
    const graph = yue2Graph(await loadGraph("yue2"), {
      style: "Italian pop, 92 BPM",
      lyrics: "[Verse]\nCiao\n",
      seed: 12345,
      maxDuration: 420,
      prefix: "mellodifai/v/g1/take-1",
    });
    expect(graph["24"]?.inputs).toMatchObject({
      style: "Italian pop, 92 BPM",
      lyrics: "[Verse]\nCiao\n",
      seed: 12345,
      temperature: 0.9,
    });
    expect(graph["25"]?.inputs).toMatchObject({
      style: "Italian pop, 92 BPM",
      lyrics: "[Verse]\nCiao\n",
      seed: 12345,
      max_duration: 420,
    });
    expect(graph["8"]?.inputs.seed).toBe(12345);
    expect(graph["10"]?.inputs).toMatchObject({
      filename_prefix: "mellodifai/v/g1/take-1",
      format: "flac",
    });
    // The template itself is not modified by a fill.
    expect((await loadGraph("yue2"))["25"]?.inputs.max_duration).toBe(330);
  });
  it("fills the ACE-Step SFT template with length, tempo, key and language", async () => {
    const graph = aceGraph(await loadGraph("ace-step"), {
      style: "Pop, 124 BPM, F major",
      lyrics: "[Verse]\nCiao",
      seed: 7,
      duration: 153,
      bpm: 124,
      keyscale: "F major",
      language: "it",
      prefix: "mellodifai/v/g1/take-2",
    });
    expect(graph["94"]?.inputs).toMatchObject({
      tags: "Pop, 124 BPM, F major",
      lyrics: "[Verse]\nCiao",
      seed: 7,
      bpm: 124,
      duration: 153,
      keyscale: "F major",
      language: "it",
    });
    expect(graph["98"]?.inputs.seconds).toBe(153);
    expect(graph["3"]?.inputs).toMatchObject({ seed: 7, steps: 30, cfg: 7 });
    expect(graph["104"]?.inputs.unet_name).toBe("acestep_v1.5_sft.safetensors");
    expect(graph["107"]?.inputs.filename_prefix).toBe("mellodifai/v/g1/take-2");
  });
  it("passes the time signature, steps and guidance to ACE-Step when they are chosen", async () => {
    const graph = aceGraph(await loadGraph("ace-step"), {
      style: "Pop",
      lyrics: "[Verse]\nCiao",
      seed: 7,
      duration: 153,
      bpm: 90,
      keyscale: "D minor",
      timesignature: "3",
      steps: 45,
      guidance: 9.5,
      language: "it",
      prefix: "p",
    });
    expect(graph["94"]?.inputs).toMatchObject({
      bpm: 90,
      keyscale: "D minor",
      timesignature: "3",
    });
    expect(graph["3"]?.inputs).toMatchObject({ steps: 45, cfg: 9.5 });
  });
  it("keeps the template's 4/4, 30 steps and guidance 7 when they are Auto", async () => {
    const graph = aceGraph(await loadGraph("ace-step"), {
      style: "Pop",
      lyrics: "x",
      seed: 7,
      duration: 153,
      bpm: 90,
      keyscale: "D minor",
      language: "it",
      prefix: "p",
    });
    expect(graph["94"]?.inputs.timesignature).toBe("4");
    expect(graph["3"]?.inputs).toMatchObject({ steps: 30, cfg: 7 });
  });
  it.each([
    ["Italian pop, 118 BPM, E-flat major", 118, "Eb major"],
    ["124 BPM, F major groove", 124, "F major"],
    ["A minor ballad", 120, "A minor"],
    ["no tempo given", 120, "C major"],
    ["Cb major, 500 BPM", 300, "C major"],
  ])("reads tempo and key from %j", (style, bpm, keyscale) => {
    expect(bpmAndKey(style)).toEqual({ bpm, keyscale });
  });
});

describe("local engines in the worker process", () => {
  it("adopts a running server, publishes availability at once and every ten minutes, and stops the server on shutdown", async () => {
    vi.useFakeTimers();
    try {
      const supervisor = {
        adopt: vi.fn(async () => true),
        stop: vi.fn(async () => {}),
      };
      const publish = vi.fn(async () => {});
      const report = vi.fn();
      const stop = await startLocalEngines({ supervisor, publish, report });
      expect(supervisor.adopt).toHaveBeenCalledTimes(1);
      expect(publish).toHaveBeenCalledTimes(1);
      await vi.advanceTimersByTimeAsync(600_000);
      expect(publish).toHaveBeenCalledTimes(2);
      await stop();
      await vi.advanceTimersByTimeAsync(600_000);
      expect(publish).toHaveBeenCalledTimes(2);
      expect(supervisor.stop).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });
  it("keeps the worker running when adoption or publishing fails", async () => {
    const report = vi.fn();
    const stop = await startLocalEngines({
      supervisor: {
        adopt: vi.fn(async () => {
          throw new Error("port busy");
        }),
        stop: vi.fn(async () => {}),
      },
      publish: vi.fn(async () => {
        throw new Error("supabase down");
      }),
      report,
    });
    await stop();
    expect(report.mock.calls.flat().join(" ")).toContain("port busy");
    expect(report.mock.calls.flat().join(" ")).toContain("supabase down");
  });
});

describe("prompt ids", () => {
  it("are RFC 9562 version 5 UUIDs, so a requeued job finds its own prompt", () => {
    expect(
      uuidv5("6ba7b810-9dad-11d1-80b4-00c04fd430c8", "www.example.com"),
    ).toBe("2ed6657d-e927-568b-95e1-2665a8aea6a2");
    expect(uuidv5(PROMPT_NAMESPACE, "v:1:1")).toBe(
      uuidv5(PROMPT_NAMESPACE, "v:1:1"),
    );
    expect(uuidv5(PROMPT_NAMESPACE, "v:1:1")).not.toBe(
      uuidv5(PROMPT_NAMESPACE, "v:1:2"),
    );
  });
});
