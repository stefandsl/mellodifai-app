import { EventEmitter } from "node:events";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  KIE_AUDIO_WEIGHT,
  type LyricPack,
  LyricPackSchema,
} from "@mellodifai/shared";
import { afterEach, describe, expect, it, vi } from "vitest";
import { InMemoryDb } from "../src/db.js";
import { Engine, type Spawn } from "../src/engine.js";
import { KieClient } from "../src/kie/client.js";
import type { StageContext } from "../src/loop.js";
import { kieTrackIds } from "../src/stages/generate-song.js";
import { IMPORT_TEXT } from "../src/stages/import-audio.js";
import { stages } from "../src/stages/index.js";
import { LOCAL_TEXT } from "../src/stages/local-engine.js";
import { storeHeardTiming } from "../src/stages/score-takes.js";
import {
  kieSourceTask,
  SOURCE_TEXT,
  songSource,
  submitSourceTask,
} from "../src/stages/source-audio.js";
import type { FakeComfy } from "./fake-comfy.js";

const roots: string[] = [];
const servers: FakeComfy[] = [];
afterEach(async () => {
  vi.unstubAllGlobals();
  await Promise.all(servers.splice(0).map((server) => server.close()));
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});

const OWNER = "4b6f8d2e-1c3a-4e5f-9a7b-2c4d6e8f0a1b";
const UPLOAD = `${OWNER}/audio/7c9e1a3b-5d7f-4b2c-8e4a-6f8b0c2d4e6f.wav`;
const TAKE = "9a1b2c3d-4e5f-4a6b-8c7d-0e1f2a3b4c5d";

function pack(lyrics = "[Verse]\nUna riga\nDue righe"): LyricPack {
  return LyricPackSchema.parse({
    title: "Cover di prova",
    lyrics,
    style: "acoustic folk",
    exclude: "",
    settings: { model: "V6", vocalGender: "m", duration: null },
    displayMap: {},
    l10n: {},
  });
}

async function setup(settings: Record<string, unknown> = {}, seconds = 200) {
  const root = await mkdtemp(join(tmpdir(), "mellodifai-sfs-"));
  roots.push(root);
  const ws = {
    root,
    versionsDir: join(root, "versions", "it"),
    outDir: join(root, "out", "it"),
    publicDir: join(root, "public"),
    renderDir: join(root, "render"),
  };
  await mkdir(ws.outDir, { recursive: true });
  const calls: { cmd: string; args: string[] }[] = [];
  const spawn: Spawn = (cmd, args) => {
    calls.push({ cmd, args: [...args] });
    const child = Object.assign(new EventEmitter(), {
      stdout: new EventEmitter(),
      stderr: new EventEmitter(),
    });
    setImmediate(() => {
      void (async () => {
        if (cmd === "ffprobe") child.stdout.emit("data", `${seconds}\n`);
        for (const arg of args)
          if (/\.part\.[^.]+$/u.test(arg))
            await writeFile(arg, `made by ${cmd}`);
        if (args.some((arg) => arg.endsWith("score_takes.py")))
          await writeFile(
            join(ws.outDir, "takes-score.json"),
            JSON.stringify({
              rows: [
                {
                  take: "take-1.mp3",
                  duration: seconds,
                  fidelity: 0.9,
                  end_drop_db: 20,
                  weak_sections: [],
                  truncated: false,
                },
              ],
            }),
          );
        child.emit("close", 0);
      })().catch((error: unknown) => child.emit("error", error));
    });
    return child as unknown as ReturnType<Spawn>;
  };
  const db = new InMemoryDb();
  db.profiles.push({ id: OWNER, role: "admin" });
  const version = {
    id: "version",
    owner_id: OWNER,
    project_id: "project",
    lang: "it" as const,
    status: "song_queued" as const,
    lyric_pack: pack(),
    generation_count: 1,
  };
  const project = {
    id: "project",
    owner_id: OWNER,
    topic: "Cover di prova",
    theme: "vbp",
    song_settings: settings,
  };
  db.versions.push(version);
  db.projects.push(project);
  const storage = {
    upload: vi.fn(async () => {}),
    remove: vi.fn(async () => {}),
    download: vi.fn(async (_path: string, file: string, _bucket?: string) => {
      await writeFile(file, "source audio");
    }),
  };
  const ctx: StageContext = {
    job: {
      id: "job",
      owner_id: OWNER,
      stage: "import_audio",
      version_id: "version",
      status: "running",
      worker_id: "worker",
      idempotency_key: "import_audio:version",
      payload: { upload: UPLOAD },
      attempts: 1,
    },
    version,
    project,
    ws,
    db,
    engine: new Engine({ spawn, log: async () => {} }).withWorkspace(root),
    storage,
    log: vi.fn(async () => {}),
    progress: vi.fn(async () => {}),
    secrets: {
      values: {
        WORKER_ID: "worker",
        KIE_API_KEY: "kie-key",
        GROQ_API_KEY: "groq-key",
      },
      redact: (line) => line,
    },
    signal: new AbortController().signal,
  };
  db.jobs.push({ ...ctx.job });
  return { ctx, db, calls, storage };
}

describe("Importa da Suno", () => {
  it("turns the upload into take 1, chosen, with the song audio only", async () => {
    const { ctx, db, calls, storage } = await setup();
    const handler = stages.import_audio;
    if (!handler) throw new Error("import_audio is not registered");
    const result = await handler(ctx);
    expect(storage.download).toHaveBeenCalledWith(
      UPLOAD,
      expect.stringMatching(/source\.wav$/u),
      "uploads",
    );
    const take = db.takes[0];
    expect(take).toMatchObject({
      take_number: 1,
      generation: 1,
      engine: "import",
      audio_preview_path:
        "previews/4b6f8d2e-1c3a-4e5f-9a7b-2c4d6e8f0a1b/project/it/take-1-preview.mp3",
      source: { kind: "import", upload: UPLOAD },
    });
    expect(result).toEqual({
      versionStatus: "audio_ready",
      patch: { chosen_take_id: take?.id },
    });
    // A WAV becomes the 320k MP3 the video pipeline reads, then the 128k preview.
    const encodes = calls.filter((call) => call.args.includes("libmp3lame"));
    expect(
      encodes.map((call) => call.args[call.args.indexOf("-b:a") + 1]),
    ).toEqual(["320k", "128k"]);
    expect(
      calls.some((call) =>
        call.args.some((arg) => arg.endsWith("score_takes.py")),
      ),
    ).toBe(true);
    // The lyrics are where score_takes.py reads them.
    expect(await readFile(join(ctx.ws.versionsDir, "lyrics.txt"), "utf8")).toBe(
      "[Verse]\nUna riga\nDue righe",
    );
  });
  it("accepts only a recording in the owner's own folder", async () => {
    const { ctx } = await setup();
    ctx.job.payload = { upload: `someone-else/audio/${TAKE}.mp3` };
    const handler = stages.import_audio;
    await expect(handler?.(ctx)).rejects.toThrow(IMPORT_TEXT.invalid);
  });
  it("refuses a file without audio", async () => {
    const { ctx } = await setup({}, 0);
    await expect(stages.import_audio?.(ctx)).rejects.toThrow(
      IMPORT_TEXT.unreadable,
    );
  });
});

describe("songs from audio on kie", () => {
  it("reads the source from the song settings", () => {
    expect(songSource({ engine: "kie" })).toBeNull();
    expect(
      songSource({ source: { mode: "cover", upload: UPLOAD } })?.mode,
    ).toBe("cover");
    expect(() => songSource({ source: { mode: "cover" } })).toThrow(
      SOURCE_TEXT.invalid,
    );
  });
  it("builds cover, reference and extension requests", () => {
    const cover = kieSourceTask(
      { mode: "cover", upload: UPLOAD },
      pack(),
      "https://u",
    );
    expect(cover.model).toBe("ai-music-api/upload-and-cover-audio");
    expect(cover.input).toMatchObject({
      upload_url: "https://u",
      model: "V6",
      instrumental: false,
      lyrics: "[Verse]\nUna riga\nDue righe",
      vocal_gender: "m",
      audio_weight: KIE_AUDIO_WEIGHT.cover,
    });
    const reference = kieSourceTask(
      { mode: "reference", upload: UPLOAD },
      pack(),
      "https://u",
    );
    expect(reference.input.audio_weight).toBe(KIE_AUDIO_WEIGHT.reference);
    const extend = kieSourceTask(
      { mode: "extend", upload: UPLOAD, continueAt: 95.5 },
      pack(""),
      "https://u",
    );
    expect(extend.model).toBe("ai-music-api/upload-and-extend-audio");
    expect(extend.input).toMatchObject({
      continue_at: 95.5,
      instrumental: true,
    });
    expect(extend.input).not.toHaveProperty("lyrics");
    expect(extend.input).not.toHaveProperty("vocal_gender");
    expect(extend.input).not.toHaveProperty("audio_weight");
  });
  it("uploads the source for free and writes task.json like kie.mjs", async () => {
    const { ctx, calls } = await setup({
      source: { mode: "cover", upload: UPLOAD },
    });
    const requests: string[] = [];
    const fetchMock = (async (input: string | URL, init?: RequestInit) => {
      const url = String(input);
      requests.push(`${init?.method ?? "GET"} ${url}`);
      if (url.includes("credit"))
        return new Response(JSON.stringify({ code: 200, data: 50 }));
      if (url.includes("file-stream-upload"))
        return new Response(
          JSON.stringify({
            code: 200,
            data: { downloadUrl: "https://kie/f.mp3" },
          }),
        );
      if (url.includes("createTask"))
        return new Response(
          JSON.stringify({ code: 200, data: { taskId: "cover-1" } }),
        );
      return new Response("", { status: 404 });
    }) as typeof fetch;
    const taskId = await submitSourceTask(
      ctx,
      { mode: "cover", upload: UPLOAD },
      pack(),
      new KieClient("kie-key", fetchMock),
    );
    expect(taskId).toBe("cover-1");
    expect(
      JSON.parse(await readFile(join(ctx.ws.outDir, "task.json"), "utf8"))
        .taskId,
    ).toBe("cover-1");
    // A WAV goes as a 320k MP3.
    expect(calls.some((call) => call.args.includes("320k"))).toBe(true);
    expect(requests.map((r) => r.replace(/\?.*/u, ""))).toEqual([
      "GET https://api.kie.ai/api/v1/chat/credit",
      "POST https://kieai.redpandaai.co/api/file-stream-upload",
      "POST https://api.kie.ai/api/v1/jobs/createTask",
    ]);
  });
  it("is not charged when the balance is short or the source too long", async () => {
    const { ctx } = await setup({}, 200);
    const poor = new KieClient(
      "k",
      (async () =>
        new Response(JSON.stringify({ code: 200, data: 4 }))) as typeof fetch,
    );
    await expect(
      submitSourceTask(ctx, { mode: "cover", upload: UPLOAD }, pack(), poor),
    ).rejects.toThrow(SOURCE_TEXT.notCharged);
    const long = await setup({}, 600);
    await expect(
      submitSourceTask(
        long.ctx,
        { mode: "cover", upload: UPLOAD },
        pack(),
        poor,
      ),
    ).rejects.toThrow(/8 minuti/u);
  });
  it("keeps kie's track ids from takes.json for each take", async () => {
    const { ctx } = await setup();
    await writeFile(
      join(ctx.ws.outDir, "takes.json"),
      JSON.stringify([{ id: "a" }, { url: "x" }]),
    );
    expect(await kieTrackIds(ctx.ws.outDir)).toEqual(["a", null]);
    expect(await kieTrackIds(join(ctx.ws.root, "none"))).toEqual([]);
  });
});

describe("local engines and audio", () => {
  it("refuses a song from audio on ACE-Step before starting ComfyUI", async () => {
    const { ctx } = await setup({
      engine: "ace-step",
      source: { mode: "cover", takeId: TAKE },
    });
    const ensureStarted = vi.fn(async () => {});
    ctx.comfy = {
      supervisor: {
        baseUrl: "http://127.0.0.1:1",
        ensureStarted,
        stop: vi.fn(async () => {}),
        restart: vi.fn(async () => {}),
        isUp: vi.fn(async () => true),
      },
      outputDir: join(ctx.ws.root, "comfy-out"),
      freeVramMb: async () => 7000,
    };
    ctx.job = { ...ctx.job, stage: "generate_song", payload: {} };
    await expect(stages.generate_song?.(ctx)).rejects.toThrow(
      LOCAL_TEXT.noSource,
    );
    expect(ensureStarted).not.toHaveBeenCalled();
  });
});

describe("timed lines for the rewrite", () => {
  it("stores the words score_takes heard as each take's timing", async () => {
    const { ctx, db } = await setup();
    const take = await db.createTake({
      owner_id: OWNER,
      version_id: "version",
      generation: 1,
      take_number: 1,
    });
    await writeFile(
      join(ctx.ws.outDir, "take-1.words.json"),
      JSON.stringify([
        { word: "Una", start: 1, end: 1.5 },
        { word: "riga", start: 1.5, end: 2 },
        { word: "Due", start: 3, end: 3.5 },
        { word: "righe", start: 3.5, end: 4 },
      ]),
    );
    await storeHeardTiming(ctx, [take]);
    expect(db.takes[0]?.lyric_timing).toEqual({
      source: "whisper",
      lines: [
        { text: "Una riga", start: 1, end: 2 },
        { text: "Due righe", start: 3, end: 4 },
      ],
    });
  });
});
