import { EventEmitter } from "node:events";
import {
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ACE_REWRITE_DENOISE, LyricPackSchema } from "@mellodifai/shared";
import { afterEach, describe, expect, it, vi } from "vitest";
import { authorizeStage } from "../src/authorization.js";
import { withSourceAudio } from "../src/comfy/graphs.js";
import type { LocalRuntime } from "../src/comfy/runtime.js";
import { InMemoryDb, type SectionEdit, type Take } from "../src/db.js";
import { Engine, type Spawn } from "../src/engine.js";
import type { StageContext } from "../src/loop.js";
import {
  findTracks,
  KieClient,
  KieRefused,
} from "../src/providers/kie-client.js";
import { spliceArgs } from "../src/stages/audio-util.js";
import { stages } from "../src/stages/index.js";
import { LOCAL_TEXT } from "../src/stages/local-engine.js";
import {
  KIE_RETENTION_MS,
  kieIdsOf,
  REWRITE_TEXT,
  sectionFile,
} from "../src/stages/replace-section.js";
import { materializeEditedTake, takeAudio } from "../src/stages/take-audio.js";
import { type FakeComfy, fakeComfy } from "./fake-comfy.js";
import { recordingLedger } from "./support/ledger.js";

const roots: string[] = [];
const servers: FakeComfy[] = [];
afterEach(async () => {
  vi.unstubAllGlobals();
  await Promise.all(servers.splice(0).map((server) => server.close()));
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});

const OLD = [
  "[Verse 1]",
  "Sono le nove, ho già l'aria stanca",
  "la prima mail e la voglia mi manca",
  "[Chorus]",
  "Solo un caffè, poi si va",
].join("\n");
const NEW = [
  "[Verse 1]",
  "Sono le otto, ho gli occhi chiusi",
  "il primo file e i pensieri confusi",
  "[Chorus]",
  "Solo un caffè, poi si va",
].join("\n");
const TIMING = {
  source: "timing",
  lines: [
    { text: "Sono le nove, ho già l'aria stanca", start: 21.6, end: 24.6 },
    { text: "la prima mail e la voglia mi manca", start: 24.6, end: 26.7 },
    { text: "Solo un caffè, poi si va", start: 56.4, end: 61.8 },
  ],
};

type Call = { cmd: string; args: string[] };

async function setup(
  options: {
    engine?: "kie" | "ace-step";
    takeEngine?: NonNullable<Take["engine"]>;
    role?: string;
    duration?: number;
    edit?: Partial<SectionEdit>;
    take?: Partial<Take>;
  } = {},
) {
  const root = await mkdtemp(join(tmpdir(), "mellodifai-rewrite-"));
  roots.push(root);
  const ws = {
    root,
    versionsDir: join(root, "versions", "it"),
    outDir: join(root, "out", "it"),
    publicDir: join(root, "public"),
    renderDir: join(root, "render"),
  };
  await mkdir(ws.outDir, { recursive: true });
  await writeFile(join(ws.outDir, "take-1.mp3"), "kie take 1");
  await writeFile(join(ws.outDir, "take-1.flac"), "ace take 1");
  const inputDir = join(root, "comfy-input");
  const calls: Call[] = [];
  const duration = options.duration ?? 281;
  const spawn: Spawn = (cmd, args) => {
    calls.push({ cmd, args: [...args] });
    const child = Object.assign(new EventEmitter(), {
      stdout: new EventEmitter(),
      stderr: new EventEmitter(),
    });
    setImmediate(() => {
      void (async () => {
        if (cmd === "ffprobe") child.stdout.emit("data", `${duration}\n`);
        if (args.includes("volumedetect"))
          child.stderr.emit(
            "data",
            // The new parts come out 2.5 dB quieter than the take.
            `[Parsed_volumedetect_0] mean_volume: ${/ace-\d\.flac$/u.test(args[args.indexOf("-i") + 1] ?? "") ? "-22.5" : "-20.0"} dB\n`,
          );
        for (const arg of args)
          if (/\.part\.[^.]+$/u.test(arg))
            await writeFile(arg, `made by ${cmd}`);
        child.emit("close", 0);
      })().catch((error: unknown) => child.emit("error", error));
    });
    return child as unknown as ReturnType<Spawn>;
  };
  const comfy = await fakeComfy();
  servers.push(comfy);
  comfy.state.up = false;
  comfy.state.nodes.add("LoadAudio");
  comfy.state.nodes.add("VAEEncodeAudio");
  comfy.onSubmit((promptId) =>
    setTimeout(() => {
      const prompt = comfy.state.prompts.get(promptId);
      if (!prompt) return;
      const prefix = String(prompt.graph["107"]?.inputs.filename_prefix);
      comfy.finish(promptId, {
        "107": {
          audio: [
            {
              filename: `${prefix.split("/").at(-1)}_00001.flac`,
              subfolder: prefix.split("/").slice(0, -1).join("/"),
              type: "output",
            },
          ],
        },
      });
    }, 5),
  );
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
    outputDir: join(root, "comfy-output"),
    inputDir,
    freeVramMb: vi.fn(async () => 7000),
    connect: (url) => comfy.connect(url),
    limits: { stallMs: 400, takeMs: 10_000, pollMs: 5, progressMs: 2_000 },
  };
  const db = new InMemoryDb();
  db.profiles.push({ id: "owner", role: options.role ?? "admin" });
  const pack = LyricPackSchema.parse({
    title: "Solo un caffè",
    lyrics: OLD,
    style: "Italian electro-swing pop, 124 BPM, F major",
    exclude: "metal",
    settings: { model: "V6", vocalGender: "f", duration: null },
    displayMap: {},
    l10n: {},
  });
  const version = {
    id: "version",
    owner_id: "owner",
    project_id: "project",
    lang: "it" as const,
    status: "audio_ready" as const,
    lyric_pack: pack,
    generation_count: 1,
  };
  const project = {
    id: "project",
    owner_id: "owner",
    topic: "Solo un caffè",
    theme: "vbp",
    song_settings: { engine: "ace-step" },
  };
  db.versions.push(version);
  db.projects.push(project);
  const take = await db.createTake({
    owner_id: "owner",
    version_id: "version",
    generation: 1,
    take_number: 1,
    engine: options.takeEngine ?? "ace-step",
    audio_preview_path: "previews/owner/project/it/take-1-preview.mp3",
    lyric_timing: TIMING,
    created_at: new Date().toISOString(),
    ...options.take,
  });
  const edit: SectionEdit = {
    id: "0d6b6f0e-8d39-4b8e-9d55-0f0e6f8a1c2b",
    owner_id: "owner",
    version_id: "version",
    take_id: take.id,
    engine: options.engine ?? "ace-step",
    start_s: 21,
    end_s: 33,
    duration_s: duration,
    section_lines: [1, 2],
    section_lyrics:
      "Sono le otto, ho gli occhi chiusi\nil primo file e i pensieri confusi",
    full_lyrics: NEW,
    old_lyrics: OLD,
    alternatives: [],
    kie_task_id: null,
    kie_submit_state: null,
    ...options.edit,
  };
  db.sectionEdits.push(edit);
  const storage = {
    upload: vi.fn(async () => {}),
    remove: vi.fn(async () => {}),
    download: vi.fn(async (_path: string, file: string) => {
      await writeFile(file, "downloaded");
    }),
  };
  const ctx: StageContext = {
    kieLedger: () => recordingLedger(),
    job: {
      id: "job",
      owner_id: "owner",
      stage: "replace_section",
      version_id: "version",
      status: "running",
      worker_id: "worker",
      idempotency_key: `replace_section:${edit.id}`,
      payload: { edit_id: edit.id, take_id: take.id },
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
      values: { WORKER_ID: "worker", KIE_API_KEY: "kie-test-key" },
      redact: (line) => line.replaceAll("kie-test-key", "***"),
    },
    signal: new AbortController().signal,
    comfy: runtime,
  };
  db.jobs.push({ ...ctx.job });
  return { ctx, db, edit, take, calls, comfy, supervisor, storage, inputDir };
}

const rewrite = (ctx: StageContext) => {
  const handler = stages.replace_section;
  if (!handler) throw new Error("replace_section is not registered");
  return handler(ctx);
};

describe("ACE-Step rewrite of a part", () => {
  it("regenerates a window around the part twice and splices each into the take", async () => {
    const { ctx, db, edit, calls, comfy, supervisor, storage, inputDir } =
      await setup();
    await rewrite(ctx);
    const graphs = [...comfy.state.prompts.values()].map((p) => p.graph);
    expect(graphs).toHaveLength(2);
    for (const graph of graphs) {
      expect(graph["200"]?.inputs.audio).toBe(
        `mellodifai/${edit.id}-window.flac`,
      );
      expect(graph["3"]?.inputs.denoise).toBe(ACE_REWRITE_DENOISE);
      expect(graph["3"]?.inputs.latent_image).toEqual(["201", 0]);
      // The window is 16..38: 5 s of the song each side of 21..33.
      expect(graph["94"]?.inputs.duration).toBe(22);
      expect(graph["94"]?.inputs.lyrics).toBe(
        "Sono le otto, ho gli occhi chiusi\nil primo file e i pensieri confusi",
      );
      expect(graph["98"]).toBeUndefined();
    }
    expect(graphs[0]?.["3"]?.inputs.seed).not.toBe(
      graphs[1]?.["3"]?.inputs.seed,
    );
    // The window is cut from the full-quality FLAC and taken out of ComfyUI's input afterwards.
    const cut = calls.find(
      (call) =>
        call.args.includes("-ss") &&
        call.args.includes("flac") &&
        call.args.includes("16.00"),
    );
    expect(cut?.args).toContain(join(ctx.ws.outDir, "take-1.flac"));
    expect(await readdir(join(inputDir, "mellodifai"))).toEqual([]);
    expect(supervisor.stop).toHaveBeenCalled();
    // Each part goes in at 16 s, brought to the original's level (-20 vs -22.5 dB).
    const splices = calls.filter((call) =>
      call.args.includes("-filter_complex"),
    );
    expect(splices).toHaveLength(2);
    const filter =
      splices[0]?.args[splices[0].args.indexOf("-filter_complex") + 1];
    expect(filter).toContain("atrim=4.850:17.150");
    expect(filter).toContain("volume=2.50dB");
    const saved = db.sectionEdits[0];
    expect(saved?.alternatives).toHaveLength(2);
    expect(saved?.alternatives[0]?.path).toBe(
      `previews/owner/project/it/section-${edit.id.slice(0, 8)}-1.mp3`,
    );
    expect(saved?.alternatives[0]?.lyric_timing).toMatchObject({
      source: "copied",
      lines: [
        { text: "Sono le otto, ho gli occhi chiusi", start: 21.6 },
        {},
        {},
      ],
    });
    expect(storage.upload).toHaveBeenCalledTimes(2);
    // The full-quality copies stay for the video and the stems.
    expect((await stat(sectionFile(ctx.ws.outDir, edit.id, 1))).isFile()).toBe(
      true,
    );
    expect(ctx.progress).toHaveBeenLastCalledWith(100, "Alternative pronte");
  });
  it("is for the admin only and needs the audio nodes", async () => {
    const other = await setup({ role: "customer" });
    await expect(rewrite(other.ctx)).rejects.toThrow(LOCAL_TEXT.adminOnly);
    const missing = await setup();
    missing.comfy.state.nodes.delete("VAEEncodeAudio");
    await expect(rewrite(missing.ctx)).rejects.toThrow("VAEEncodeAudio");
    expect(missing.supervisor.stop).toHaveBeenCalled();
  });
  it("waits while a game holds the GPU", async () => {
    const { ctx } = await setup();
    vi.mocked(ctx.comfy?.freeVramMb ?? vi.fn()).mockResolvedValue(1000);
    const result = await rewrite(ctx);
    expect(result.retryLater?.reason).toBe(LOCAL_TEXT.busyGpu);
  });
  it("refuses a part outside Suno's limits on the real length", async () => {
    const { ctx } = await setup({ duration: 20 });
    await expect(rewrite(ctx)).rejects.toThrow(REWRITE_TEXT.limits);
  });
  it("does nothing twice and fails cleanly on a missing request", async () => {
    const done = await setup({
      edit: { alternatives: [{ path: "x", duration: 1 }] },
    });
    expect(await rewrite(done.ctx)).toEqual({});
    expect(done.calls).toHaveLength(0);
    const gone = await setup();
    gone.ctx.job.payload = { edit_id: "5b0e7a1c-0000-4000-8000-000000000000" };
    await expect(rewrite(gone.ctx)).rejects.toThrow(REWRITE_TEXT.gone);
  });
});

type KieRoute = (url: string, init?: RequestInit) => unknown;
function stubKie(routes: Record<string, KieRoute>) {
  const requests: { url: string; body: unknown }[] = [];
  const fetchMock = vi.fn(async (input: string | URL, init?: RequestInit) => {
    const url = String(input);
    requests.push({
      url,
      body: typeof init?.body === "string" ? JSON.parse(init.body) : init?.body,
    });
    const key = Object.keys(routes).find((route) => url.includes(route));
    if (!key) return new Response("not found", { status: 404 });
    const value = routes[key]?.(url, init);
    if (value instanceof Error) throw value;
    if (value instanceof Response) return value;
    return new Response(JSON.stringify(value), { status: 200 });
  });
  vi.stubGlobal("fetch", fetchMock);
  return requests;
}

describe("kie replace-section", () => {
  const done = (tracks: unknown[]) => ({
    code: 200,
    data: { state: "success", response: { data: tracks } },
  });
  it("replaces on kie's own task and track, with the song's lyrics and style", async () => {
    const { ctx, db, edit, calls } = await setup({
      engine: "kie",
      takeEngine: "kie",
      take: { kie_task_id: "task-1", kie_audio_id: "audio-1" },
    });
    const requests = stubKie({
      "/chat/credit": () => ({ code: 200, data: 87 }),
      "/jobs/createTask": () => ({ code: 200, data: { taskId: "replace-1" } }),
      "/jobs/recordInfo": () =>
        done([
          { id: "alt-a", audio_url: "https://cdn/a.mp3", duration: 281.2 },
          { id: "alt-b", audio_url: "https://cdn/b.mp3", duration: 280.6 },
        ]),
      "cdn/": () => new Response("mp3"),
    });
    await rewrite(ctx);
    const create = requests.find((r) => r.url.includes("createTask"));
    expect(create?.body).toEqual({
      model: "ai-music-api/replace-section",
      input: {
        task_id: "task-1",
        audio_id: "audio-1",
        prompt: edit.section_lyrics,
        lyrics: edit.section_lyrics,
        full_lyrics: NEW,
        tags: "Italian electro-swing pop, 124 BPM, F major",
        title: "Solo un caffè",
        negative_tags: "metal",
        vocal_gender: "f",
        infill_start_s: 21,
        infill_end_s: 33,
      },
    });
    // Whole songs came back: nothing to splice.
    expect(calls.some((call) => call.args.includes("-filter_complex"))).toBe(
      false,
    );
    const saved = db.sectionEdits[0];
    expect(saved?.kie_task_id).toBe("replace-1");
    expect(saved?.kie_submit_state).toBe("submitted");
    expect(saved?.alternatives.map((a) => a.kie_audio_id)).toEqual([
      "alt-a",
      "alt-b",
    ]);
    expect(saved?.alternatives[0]?.kie_task_id).toBe("replace-1");
  });
  it("refuses a Kie replacement before any provider request when reservation is capped", async () => {
    const { ctx } = await setup({ engine: "kie" });
    const ledger = recordingLedger();
    ctx.kieLedger = () => ledger;
    vi.mocked(ledger.reservationFor).mockRejectedValue({ code: "MDF02" });
    const requests = stubKie({});
    await expect(rewrite(ctx)).rejects.toThrow("cap_exceeded");
    expect(requests).toHaveLength(0);
  });
  it("sends any other take as a file and splices a part that comes back alone", async () => {
    const { ctx, calls } = await setup({ engine: "kie" });
    const requests = stubKie({
      "/chat/credit": () => ({ code: 200, data: 87 }),
      "/api/file-stream-upload": () => ({
        success: true,
        code: 200,
        data: { downloadUrl: "https://kie-files/source.mp3" },
      }),
      "/jobs/createTask": () => ({ code: 200, data: { taskId: "replace-2" } }),
      "/jobs/recordInfo": () =>
        done([{ id: "alt-a", audio_url: "https://cdn/a.mp3", duration: 12 }]),
      "cdn/": () => new Response("mp3"),
    });
    await rewrite(ctx);
    const create = requests.find((r) => r.url.includes("createTask"));
    expect(create?.body).toMatchObject({
      input: { upload_url: "https://kie-files/source.mp3", model: "V6" },
    });
    expect(
      (create?.body as { input?: object } | undefined)?.input ?? {},
    ).not.toHaveProperty("task_id");
    const splice = calls.find((call) => call.args.includes("-filter_complex"));
    expect(splice?.args.join(" ")).toContain("atrim=0.000:12.150");
  });
  it("stops before spending when the balance is short or kie refuses", async () => {
    const low = await setup({ engine: "kie" });
    stubKie({ "/chat/credit": () => ({ code: 200, data: 3 }) });
    await expect(rewrite(low.ctx)).rejects.toThrow(REWRITE_TEXT.kieBalance(3));
    const refused = await setup({
      engine: "kie",
      takeEngine: "kie",
      take: { kie_task_id: "t", kie_audio_id: "a" },
    });
    stubKie({
      "/chat/credit": () => ({ code: 200, data: 87 }),
      "/jobs/createTask": () => ({ code: 422, msg: "too long" }),
    });
    await expect(rewrite(refused.ctx)).rejects.toThrow(REWRITE_TEXT.kieRefused);
    expect(refused.db.sectionEdits[0]?.kie_submit_state).toBeNull();
  });
  it("never submits twice when the answer was lost", async () => {
    const lost = await setup({
      engine: "kie",
      takeEngine: "kie",
      take: { kie_task_id: "t", kie_audio_id: "a" },
    });
    stubKie({
      "/chat/credit": () => ({ code: 200, data: 87 }),
      "/jobs/createTask": () => new Error("socket hang up"),
    });
    await expect(rewrite(lost.ctx)).rejects.toThrow(REWRITE_TEXT.kieUnknown);
    expect(lost.db.sectionEdits[0]?.kie_submit_state).toBe("submitting");
    const requests = stubKie({});
    await expect(rewrite(lost.ctx)).rejects.toThrow(REWRITE_TEXT.kieUnknown);
    expect(requests).toHaveLength(0);
  });
  it("resumes a submitted task for free", async () => {
    const { ctx, db } = await setup({
      engine: "kie",
      edit: { kie_task_id: "replace-9", kie_submit_state: "submitted" },
    });
    const requests = stubKie({
      "/jobs/recordInfo": () =>
        done([{ id: "x", audio_url: "https://cdn/x.mp3", duration: 281 }]),
      "cdn/": () => new Response("mp3"),
    });
    await rewrite(ctx);
    expect(requests.some((r) => r.url.includes("createTask"))).toBe(false);
    expect(requests.some((r) => r.url.includes("credit"))).toBe(false);
    expect(db.sectionEdits[0]?.alternatives).toHaveLength(1);
  });
  it("reads kie's track ids from the workspace and respects the 14 days", async () => {
    const { ctx, take, db } = await setup({
      takeEngine: "kie",
      take: { kie_task_id: "task-1" },
    });
    await writeFile(
      join(ctx.ws.outDir, "takes.json"),
      JSON.stringify([{ id: "track-1" }, { id: "track-2" }]),
    );
    expect(await kieIdsOf(ctx, take)).toEqual({
      taskId: "task-1",
      audioId: "track-1",
    });
    expect(db.takes[0]?.kie_audio_id).toBe("track-1");
    const old = {
      ...take,
      created_at: new Date(Date.now() - KIE_RETENTION_MS - 1000).toISOString(),
    };
    expect(await kieIdsOf(ctx, old)).toBeNull();
    expect(await kieIdsOf(ctx, { ...take, engine: "ace-step" })).toBeNull();
  });
});

describe("kie client", () => {
  it("collects each track once from any record layout", () => {
    expect(
      findTracks({
        response: {
          data: [
            {
              id: "a",
              audio_url: "https://x/a.mp3",
              duration: 3,
              image_url: "https://x/a.jpg",
            },
            { id: "a", audio_url: "https://x/a.mp3" },
          ],
          nested: '{"audioUrl":"https://x/b.mp3","audioId":"b"}',
        },
      }),
    ).toEqual([
      {
        id: "a",
        url: "https://x/a.mp3",
        duration: 3,
        image: "https://x/a.jpg",
      },
      { id: "b", url: "https://x/b.mp3" },
    ]);
  });
  it("tells a refusal from an unknown outcome", async () => {
    const refusing = new KieClient(
      "k",
      (async () =>
        new Response(
          JSON.stringify({ code: 402, msg: "no credits" }),
        )) as typeof fetch,
    );
    await expect(
      refusing.createTask({ model: "m", input: {} }),
    ).rejects.toBeInstanceOf(KieRefused);
    const dropping = new KieClient("k", (async () => {
      throw new Error("ECONNRESET");
    }) as typeof fetch);
    await expect(
      dropping.createTask({ model: "m", input: {} }),
    ).rejects.toThrow("state unknown");
    expect(() => new KieClient("")).toThrow(KieRefused);
  });
  it("polls until the task fails", async () => {
    let n = 0;
    const client = new KieClient(
      "k",
      (async () =>
        new Response(
          JSON.stringify({
            code: 200,
            data: { state: n++ === 0 ? "GENERATING" : "CREATE_TASK_FAILED" },
          }),
        )) as typeof fetch,
      async () => {},
    );
    await expect(client.wait("t")).rejects.toThrow("kie task failed");
  });
});

describe("audio of a rewritten take", () => {
  it("splices with crossfades and keeps the length", () => {
    const args = spliceArgs("orig.flac", "part.flac", "out.flac", {
      start: 21,
      end: 33,
      duration: 281,
      offset: 16,
      crossfade: 0.3,
      gainDb: -1.5,
    });
    const filter = args[args.indexOf("-filter_complex") + 1] ?? "";
    expect(filter).toContain("[1:a]aresample=48000");
    expect(filter).toContain("atrim=4.850:17.150");
    expect(filter).toContain("atrim=0:21.150");
    expect(filter).toContain("atrim=32.850");
    expect(filter).toContain("volume=-1.50dB");
    expect(args.slice(-5)).toEqual([
      "-map",
      "[out]",
      "-c:a",
      "flac",
      "out.flac",
    ]);
    // A part at the very start has no head to crossfade.
    const first = spliceArgs("o", "p", "t", {
      start: 0,
      end: 12,
      duration: 281,
      offset: 0,
      crossfade: 0.3,
      gainDb: 0,
    });
    expect(first.join(" ")).not.toContain("[head]");
  });
  it("starts an ACE-Step graph from audio", () => {
    const graph = withSourceAudio(
      {
        "3": {
          class_type: "KSampler",
          inputs: { latent_image: ["98", 0], denoise: 1 },
        },
        "98": { class_type: "EmptyAceStep1.5LatentAudio", inputs: {} },
      },
      { audio: "mellodifai/x.flac", denoise: 0.8 },
    );
    expect(graph["200"]).toEqual({
      class_type: "LoadAudio",
      inputs: { audio: "mellodifai/x.flac" },
    });
    expect(graph["201"]?.inputs).toEqual({
      audio: ["200", 0],
      vae: ["106", 0],
    });
    expect(graph["3"]?.inputs).toEqual({
      latent_image: ["201", 0],
      denoise: 0.8,
    });
    expect(graph["98"]).toBeUndefined();
  });
  it("reads a kept rewrite from its full-quality copy", async () => {
    const { ctx, edit } = await setup();
    const kept: Take = {
      id: "kept",
      version_id: "version",
      owner_id: "owner",
      generation: 1,
      take_number: 3,
      engine: "ace-step",
      audio_preview_path: "previews/x.mp3",
      source: { kind: "replace", edit_id: edit.id, alternative: 1 },
    };
    await mkdir(join(ctx.ws.outDir, "sections"), { recursive: true });
    await writeFile(sectionFile(ctx.ws.outDir, edit.id, 1), "full quality");
    expect(await takeAudio(ctx, kept, ctx.ws.root)).toBe(
      sectionFile(ctx.ws.outDir, edit.id, 1),
    );
    await writeFile(join(ctx.ws.outDir, "aligned-take3.json"), "{}");
    await materializeEditedTake(ctx, kept);
    expect(await readFile(join(ctx.ws.outDir, "take-3.mp3"), "utf8")).toBe(
      "full quality",
    );
    await expect(
      stat(join(ctx.ws.outDir, "aligned-take3.json")),
    ).rejects.toThrow();
  });
});

describe("authorization", () => {
  it("accepts the song's own rewrite request only", async () => {
    const { ctx, db, edit } = await setup();
    const project = db.projects[0];
    if (!project) throw new Error("no project");
    await expect(
      authorizeStage(db, ctx.job, ctx.version, project),
    ).resolves.toBeUndefined();
    db.sectionEdits.push({
      ...edit,
      id: "6d3c1b2a-0000-4000-8000-00000000abcd",
      version_id: "other",
    });
    await expect(
      authorizeStage(
        db,
        {
          ...ctx.job,
          payload: { edit_id: "6d3c1b2a-0000-4000-8000-00000000abcd" },
        },
        ctx.version,
        project,
      ),
    ).rejects.toThrow("Unauthorized payload id");
  });
});
