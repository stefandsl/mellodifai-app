import { EventEmitter } from "node:events";
import {
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { InMemoryDb, type Take, type Version } from "../src/db.js";
import { Engine, type Spawn } from "../src/engine.js";
import { createFakeStages, fakePack } from "../src/fake/index.js";
import { type StageContext, WorkerLoop } from "../src/loop.js";
import { stages } from "../src/stages/index.js";
import {
  DEMUCS_PYTHON,
  demucsPercent,
  PEAK_COUNT,
  peaksOf,
  type StemSet,
  stemsComplete,
} from "../src/stages/stems.js";
import { stemPaths, upload } from "../src/stages/utils.js";

const roots: string[] = [];
afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});

type Call = { cmd: string; args: string[] };

// A workspace, an in-memory database with an audio-only song and a fake process runner that
// writes what Demucs and ffmpeg would.
async function setup({
  engine = "ace-step" as NonNullable<Take["engine"]>,
  demucsCode = 0,
  files = ["take-1.flac", "take-1.mp3"],
} = {}) {
  const root = await mkdtemp(join(tmpdir(), "stems-tests-"));
  roots.push(root);
  const ws = {
    root,
    versionsDir: join(root, "versions", "it"),
    outDir: join(root, "out", "it"),
    publicDir: join(root, "public"),
    renderDir: join(root, "render"),
  };
  await mkdir(ws.outDir, { recursive: true });
  for (const file of files) await writeFile(join(ws.outDir, file), file);
  const calls: Call[] = [];
  const spawn: Spawn = (cmd, args) => {
    calls.push({ cmd, args: [...args] });
    const child = Object.assign(new EventEmitter(), {
      stdout: new EventEmitter(),
      stderr: new EventEmitter(),
    });
    setImmediate(() => {
      void (async () => {
        if (cmd === DEMUCS_PYTHON) {
          const out = args[args.indexOf("-o") + 1] as string;
          const source = args.at(-1) as string;
          const name = (source.split(/[\\/]/u).at(-1) as string).replace(
            /\.[^.]+$/u,
            "",
          );
          const dir = join(out, "htdemucs", name);
          await mkdir(dir, { recursive: true });
          for (const stem of ["vocals", "drums", "bass", "other"])
            await writeFile(join(dir, `${stem}.wav`), `${stem} of ${source}`);
          child.stdout.emit("data", `Separating track ${source}\n`);
          for (const pct of [0, 10, 50, 100])
            child.stderr.emit(
              "data",
              `${String(pct).padStart(3)}%|####      | ${pct}/100 [00:01<00:02, 7.0seconds/s]\r`,
            );
          child.emit("close", demucsCode);
          return;
        }
        for (const arg of args) {
          if (arg.endsWith(".part.s16")) {
            // 3 s of mono 8 kHz audio peaking at half scale in the first second.
            const samples = new Int16Array(24_000);
            samples[10] = 16_384;
            await writeFile(arg, Buffer.from(samples.buffer));
          } else if (/\.part\.[^.]+$/u.test(arg)) await writeFile(arg, "mp3");
        }
        child.emit("close", 0);
      })().catch((error: unknown) => child.emit("error", error));
    });
    return child as unknown as ReturnType<Spawn>;
  };
  const db = new InMemoryDb();
  const version = {
    id: "version",
    owner_id: "owner",
    project_id: "project",
    lang: "it" as const,
    status: "audio_ready" as const,
    generation_count: 1,
    render_attempt: 1,
  };
  const project = {
    id: "project",
    owner_id: "owner",
    topic: "Solo un caffè",
    theme: "vbp",
  };
  db.versions.push(version);
  db.projects.push(project);
  const take = await db.createTake({
    owner_id: "owner",
    version_id: "version",
    take_number: 1,
    generation: 1,
    engine,
    audio_preview_path: "previews/owner/project/it/take-1-preview.mp3",
  });
  (version as { chosen_take_id?: string }).chosen_take_id = take.id;
  const log = vi.fn(async (_line: string) => {});
  const progress = vi.fn(async (_pct: number, _message?: string) => {});
  const storage = {
    upload: vi.fn(
      async (_path: string, _file: string, _contentType: string) => {},
    ),
    remove: vi.fn(async (_paths: string[]) => {}),
    download: vi.fn(async (_path: string, file: string) => {
      await writeFile(file, "downloaded");
    }),
  };
  const secrets = { values: {}, redact: (line: string) => line };
  const ctx: StageContext = {
    job: {
      id: "job",
      owner_id: "owner",
      stage: "stems",
      version_id: "version",
      status: "running",
      idempotency_key: `stems:version:${take.id}`,
      payload: { take_id: take.id },
    },
    version,
    project,
    ws,
    db,
    engine: new Engine({ spawn, log, secrets }).withWorkspace(root),
    storage,
    log,
    progress,
    secrets,
    signal: new AbortController().signal,
  };
  return { ctx, db, calls, take, storage, log, progress, spawn, ws };
}

describe("stems stage", () => {
  it("separates the chosen take into four stems with htdemucs and stores them on the take", async () => {
    const { ctx, db, calls, take, storage, log, progress } = await setup();
    const result = await stages.stems?.(ctx);
    // On demand: the song keeps its status.
    expect(result).toEqual({});
    const demucs = calls.filter((c) => c.cmd === DEMUCS_PYTHON);
    expect(demucs).toHaveLength(1);
    expect(demucs[0]?.args).toEqual([
      "-I",
      "-X",
      "utf8",
      "-m",
      "demucs",
      "-n",
      "htdemucs",
      "--shifts=0",
      "-o",
      join(ctx.ws.root, "stems", "separate", take.id),
      // The lossless file of a local engine.
      join(ctx.ws.outDir, "take-1.flac"),
    ]);
    expect(demucs[0]?.args).not.toContain("--two-stems=vocals");
    const encodes = calls.filter(
      (c) => c.cmd === "ffmpeg" && c.args.includes("libmp3lame"),
    );
    expect(encodes).toHaveLength(4);
    expect(encodes[0]?.args).toEqual(
      expect.arrayContaining(["-b:a", "192k", "-map_metadata", "-1"]),
    );
    expect(storage.upload.mock.calls.map((c) => c[0])).toEqual(
      ["vocals", "drums", "bass", "other"].map(
        (name) => `previews/owner/project/it/stems-${take.id}-${name}.mp3`,
      ),
    );
    const stored = db.takes.find((t) => t.id === take.id)?.stems as StemSet;
    expect(stemsComplete(stored)).toBe(true);
    expect(stored).toMatchObject({
      model: "htdemucs",
      format: "mp3",
      bitrate: 192,
      duration: 3,
    });
    expect(stored.tracks.vocals.peaks).toHaveLength(PEAK_COUNT);
    expect(stored.tracks.vocals.peaks[0]).toBe(0.5);
    expect(stored.tracks.vocals.peaks.at(-1)).toBe(0);
    expect(db.versions[0]?.status).toBe("audio_ready");
    // Progress: start, the separation (throttled), each stem, done.
    const values = progress.mock.calls.map((c) => c[0]);
    expect(values[0]).toBe(2);
    expect(values.at(-1)).toBe(100);
    expect(values).toContain(5);
    expect(values).toContain(85);
    expect([...values].sort((a, b) => a - b)).toEqual(values);
    expect(progress.mock.calls.map((c) => c[1])).toContain(
      "Stems: separazione 100%",
    );
    // The tqdm lines are progress, not log lines; the rest of the output is logged.
    const lines = log.mock.calls.map((c) => c[0]);
    expect(lines.some((line) => line.includes("%|"))).toBe(false);
    expect(lines.some((line) => line.startsWith("Separating track"))).toBe(
      true,
    );
    // The WAV files are gone.
    await expect(
      readdir(join(ctx.ws.root, "stems", "separate", take.id)),
    ).rejects.toThrow();
  });

  it("uses the 320k mp3 of a kie take", async () => {
    const { ctx, calls } = await setup({ engine: "kie" });
    await stages.stems?.(ctx);
    expect(calls.find((c) => c.cmd === DEMUCS_PYTHON)?.args.at(-1)).toBe(
      join(ctx.ws.outDir, "take-1.mp3"),
    );
  });

  it("downloads an edited take, or a take whose workspace file is gone, from storage", async () => {
    for (const [engine, files] of [
      ["edit", ["take-1.mp3"]],
      ["kie", []],
    ] as const) {
      const { ctx, calls, take, storage } = await setup({
        engine,
        files: [...files],
      });
      await stages.stems?.(ctx);
      const source = join(
        ctx.ws.root,
        "stems",
        "separate",
        take.id,
        "take-source.mp3",
      );
      expect(storage.download).toHaveBeenCalledWith(
        "previews/owner/project/it/take-1-preview.mp3",
        source,
      );
      expect(calls.find((c) => c.cmd === DEMUCS_PYTHON)?.args.at(-1)).toBe(
        source,
      );
    }
  });

  it("downloads a take of an older generation instead of trusting the workspace", async () => {
    const { ctx, storage } = await setup({ engine: "kie" });
    ctx.version.generation_count = 2;
    await stages.stems?.(ctx);
    expect(storage.download).toHaveBeenCalled();
  });

  it("does nothing when the take already has its stems", async () => {
    const { ctx, calls, db, take } = await setup();
    await stages.stems?.(ctx);
    const count = calls.length;
    const before = db.takes.find((t) => t.id === take.id)?.stems;
    await expect(stages.stems?.(ctx)).resolves.toEqual({});
    expect(calls).toHaveLength(count);
    expect(db.takes.find((t) => t.id === take.id)?.stems).toBe(before);
  });

  it("fails on a Demucs error, stores nothing and cleans up", async () => {
    const { ctx, db, take, storage } = await setup({ demucsCode: 1 });
    await expect(stages.stems?.(ctx)).rejects.toThrow("exited 1");
    expect(db.takes.find((t) => t.id === take.id)?.stems).toBeUndefined();
    expect(storage.upload).not.toHaveBeenCalled();
    await expect(
      readdir(join(ctx.ws.root, "stems", "separate", take.id)),
    ).rejects.toThrow();
  });

  it("fails clearly for a take that no longer exists or has no stored audio", async () => {
    const missing = await setup();
    missing.ctx.job.payload = { take_id: "gone" };
    await expect(stages.stems?.(missing.ctx)).rejects.toThrow(
      "La versione da separare non esiste più",
    );
    const silent = await setup({ engine: "edit" });
    silent.take.audio_preview_path = null;
    await expect(stages.stems?.(silent.ctx)).rejects.toThrow(
      "La versione scelta non ha un audio",
    );
  });

  it("separates the chosen take when the job names none", async () => {
    const { ctx, db, take } = await setup();
    ctx.job.payload = {};
    await stages.stems?.(ctx);
    expect(stemsComplete(db.takes.find((t) => t.id === take.id)?.stems)).toBe(
      true,
    );
  });
});

describe("stems through the worker loop", () => {
  async function loopFor(setupResult: Awaited<ReturnType<typeof setup>>) {
    const { ctx, db } = setupResult;
    db.jobs.push({ ...ctx.job, status: "queued" });
    return new WorkerLoop({
      db,
      workerId: "worker",
      stages,
      engine: new Engine({
        spawn: setupResult.spawn,
        log: async () => {},
        secrets: ctx.secrets,
      }),
      storage: ctx.storage,
      secrets: ctx.secrets,
      workspace: { forVersion: async () => ctx.ws },
    });
  }

  it("finishes the job and leaves the song status alone", async () => {
    const s = await setup();
    const loop = await loopFor(s);
    await loop.runOnce();
    expect(s.db.jobs[0]?.status).toBe("done");
    expect(s.db.versions[0]?.status).toBe("audio_ready");
    expect(stemsComplete(s.db.takes[0]?.stems)).toBe(true);
  });

  it("never marks the song failed when the separation fails", async () => {
    const s = await setup({ demucsCode: 2 });
    const loop = await loopFor(s);
    await loop.runOnce();
    expect(s.db.jobs[0]?.status).toBe("failed");
    expect(s.db.jobs[0]?.error).toContain("exited 2");
    expect(s.db.versions[0]?.status).toBe("audio_ready");
  });

  it("refuses stems for a song without a final take, still without failing it", async () => {
    const s = await setup();
    s.db.versions[0] = {
      ...(s.db.versions[0] as Version),
      status: "takes_review",
    };
    const loop = await loopFor(s);
    await loop.runOnce();
    expect(s.db.jobs[0]?.status).toBe("failed");
    expect(s.db.jobs[0]?.error).toContain("not allowed");
    expect(s.db.versions[0]?.status).toBe("takes_review");
  });

  it("runs in every status that has a chosen take", async () => {
    for (const status of [
      "producing",
      "video_review",
      "approved",
      "publishing",
      "published",
    ] as const) {
      const s = await setup();
      s.db.versions[0] = { ...(s.db.versions[0] as Version), status };
      const loop = await loopFor(s);
      await loop.runOnce();
      expect(s.db.jobs[0]?.status, status).toBe("done");
      expect(s.db.versions[0]?.status).toBe(status);
    }
  });

  it("has a fake stage with the same shape", async () => {
    const s = await setup();
    const fake = createFakeStages({ sleep: async () => {} });
    const ffmpeg: Spawn = (cmd, args) => {
      const child = Object.assign(new EventEmitter(), {
        stdout: new EventEmitter(),
        stderr: new EventEmitter(),
      });
      setImmediate(() => {
        void (async () => {
          await writeFile(args.at(-1) as string, "fake");
          child.emit("close", cmd === "ffmpeg" ? 0 : 1);
        })();
      });
      return child as unknown as ReturnType<Spawn>;
    };
    s.ctx.engine = new Engine({ spawn: ffmpeg, log: async () => {} });
    await expect(fake.stems?.(s.ctx)).resolves.toEqual({});
    expect(stemsComplete(s.db.takes[0]?.stems)).toBe(true);
  });
});

describe("preview cleanup", () => {
  it("drops the stems of a superseded take with its audio, and keeps the current ones", async () => {
    const { ctx, db, storage } = await setup();
    db.takes.push({
      id: "old",
      version_id: "version",
      generation: 1,
      take_number: 2,
      audio_preview_path: "old.mp3",
      stems: { tracks: { vocals: { path: "old-vocals.mp3" } } },
    });
    db.takes.push({
      id: "edit",
      version_id: "version",
      generation: 2,
      take_number: 1,
      engine: "edit",
      audio_preview_path: "edit.mp3",
      stems: { tracks: { vocals: { path: "edit-vocals.mp3" } } },
    });
    ctx.version.generation_count = 2;
    const file = join(ctx.ws.root, "x.mp3");
    await writeFile(file, "x");
    await upload(ctx, file, "audio/mpeg");
    const removed = storage.remove.mock.calls[0]?.[0] as unknown as string[];
    expect(removed).toEqual(
      expect.arrayContaining(["old.mp3", "old-vocals.mp3"]),
    );
    expect(removed).not.toContain("edit-vocals.mp3");
    expect(removed).not.toContain("edit.mp3");
  });

  it("reads stem paths defensively", () => {
    expect(stemPaths(null)).toEqual([]);
    expect(stemPaths({ tracks: [1] })).toEqual([]);
    expect(
      stemPaths({ tracks: { a: { path: "" }, b: { path: "b" } } }),
    ).toEqual(["b"]);
  });
});

describe("timing on an edited take", () => {
  it("writes the edited audio where the pipeline reads it and drops the old alignment", async () => {
    const { ctx, db, take, storage, ws } = await setup({ engine: "edit" });
    await writeFile(join(ws.outDir, "aligned-take1.json"), "{}");
    ctx.job = { ...ctx.job, stage: "timing", payload: {} };
    ctx.version.status = "producing";
    ctx.version.lyric_pack = fakePack;
    db.takes[0] = { ...take };
    // The pipeline itself is out of scope here: stop right after the audio is in place.
    vi.spyOn(ctx.engine, "run").mockRejectedValueOnce(new Error("stop"));
    await expect(stages.timing?.(ctx)).rejects.toThrow("stop");
    expect(storage.download).toHaveBeenCalledWith(
      "previews/owner/project/it/take-1-preview.mp3",
      join(ws.outDir, "take-1.mp3"),
    );
    expect(await readFile(join(ws.outDir, "take-1.mp3"), "utf8")).toBe(
      "downloaded",
    );
    await expect(
      readFile(join(ws.outDir, "aligned-take1.json")),
    ).rejects.toThrow();
  });
});

describe("helpers", () => {
  it("reads the Demucs progress bar", () => {
    expect(demucsPercent(" 45%|####      | 87.8/195.0 [00:12<00:14]")).toBe(45);
    expect(demucsPercent("100%|##########| 195/195")).toBe(100);
    expect(demucsPercent("Separating track take-1.flac")).toBeNull();
  });
  it("computes peaks per slice", () => {
    const samples = new Int16Array([0, 32767, -16384, 0, 8192, 0]);
    expect(peaksOf(samples, 3)).toEqual([1, 0.5, 0.25]);
    expect(peaksOf(new Int16Array(0), 2)).toEqual([0, 0]);
    expect(peaksOf(new Int16Array([100]), 4)).toHaveLength(4);
  });
});
