import { execFileSync } from "node:child_process";
import { EventEmitter } from "node:events";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  defaultVisualizerParams,
  stockBackground,
  type VisualizerParams,
} from "@mellodifai/shared";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AuthorizationDenied, authorizeStage } from "../src/authorization.js";
import { InMemoryDb } from "../src/db.js";
import { Engine, type Spawn } from "../src/engine.js";
import type { StageContext } from "../src/loop.js";
import { stages } from "../src/stages/index.js";
import { upload } from "../src/stages/utils.js";
import {
  aspectName,
  DELIVERY_LIMIT,
  deliveryKbps,
  renderedPercent,
  upscaleImage,
  VISUALIZER_PACKAGE,
} from "../src/stages/visualizer.js";

const roots: string[] = [];
afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});

type Call = { cmd: string; args: string[]; props?: Record<string, unknown> };

// A song with a chosen take and a visualizer render row, and a process runner that writes what
// ffmpeg, ffprobe and the Remotion render would.
async function setup(
  params: VisualizerParams,
  { renderCode = 0, cover = true, imageSize = "4000x4000" } = {},
) {
  const scratch =
    process.platform === "win32"
      ? "E:/mellodifai/codex-streams/rerender/tmp"
      : tmpdir();
  await mkdir(scratch, { recursive: true });
  const root = await mkdtemp(join(scratch, "visualizer-tests-"));
  roots.push(root);
  const ws = {
    root,
    versionsDir: join(root, "versions", "it"),
    outDir: join(root, "out", "it"),
    publicDir: join(root, "public"),
    renderDir: join(root, "render"),
  };
  await mkdir(ws.outDir, { recursive: true });
  await mkdir(ws.renderDir, { recursive: true });
  await writeFile(join(ws.outDir, "take-1.mp3"), "mp3");
  const calls: Call[] = [];
  const spawn: Spawn = (cmd, args) => {
    const call: Call = { cmd, args: [...args] };
    calls.push(call);
    const child = Object.assign(new EventEmitter(), {
      stdout: new EventEmitter(),
      stderr: new EventEmitter(),
    });
    setImmediate(() => {
      void (async () => {
        if (cmd === "ffprobe") {
          child.stdout.emit(
            "data",
            args.includes("format=duration") ? "4.5\n" : `${imageSize}\n`,
          );
        } else if (cmd === "ffmpeg" && args.includes("showinfo")) {
          child.stderr.emit(
            "data",
            `[Parsed_showinfo_0] n: 0 s:${imageSize}\n`,
          );
        } else if (cmd === process.execPath) {
          call.props = JSON.parse(await readFile(args[1] as string, "utf8"));
          for (const n of [0, 30, 60, 90])
            child.stdout.emit("data", `Rendered ${n}/90, time remaining: 1s\n`);
          child.stdout.emit("data", "Encoded 90/90\n");
          if (renderCode === 0)
            await writeFile(args[2] as string, "x".repeat(1000));
          child.emit("close", renderCode);
          return;
        }
        for (const arg of args)
          if (arg.endsWith(".part.f32")) {
            // 3 s of a 220 Hz tone at 48 kHz.
            const samples = new Float32Array(3 * 48000);
            for (let i = 0; i < samples.length; i++)
              samples[i] = 0.5 * Math.sin((2 * Math.PI * 220 * i) / 48000);
            await writeFile(arg, Buffer.from(samples.buffer));
          } else if (/\.part\.[^.]+$/u.test(arg)) await writeFile(arg, "file");
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
    render_attempt: 2,
    lyric_pack: { title: "Astri" },
  };
  const project = {
    id: "project",
    owner_id: "owner",
    topic: "Topic",
    theme: "vbp",
  };
  db.versions.push(version);
  db.projects.push(project);
  const take = await db.createTake({
    owner_id: "owner",
    version_id: "version",
    take_number: 1,
    generation: 1,
    engine: "kie",
    audio_preview_path: "previews/owner/project/it/take-1.mp3",
    ...(cover ? { cover_path: "previews/owner/project/it/cover-1.jpg" } : {}),
  });
  (version as { chosen_take_id?: string }).chosen_take_id = take.id;
  const render = await db.upsertRender({
    owner_id: "owner",
    version_id: "version",
    kind: "visualizer",
    aspect: params.aspect,
    render_attempt: 1,
    visualizer_params: params,
  });
  const log = vi.fn(async (_line: string) => {});
  const progress = vi.fn(async (_pct: number, _message?: string) => {});
  const storage = {
    upload: vi.fn(async (_path: string, _file: string, _type: string) => {}),
    remove: vi.fn(async (_paths: string[]) => {}),
    download: vi.fn(async (_path: string, file: string, _bucket?: string) => {
      await writeFile(file, "downloaded");
    }),
  };
  const secrets = { values: {}, redact: (line: string) => line };
  const ctx: StageContext = {
    job: {
      id: "job",
      owner_id: "owner",
      stage: "visualizer",
      version_id: "version",
      status: "running",
      idempotency_key: `visualizer:version:${params.aspect}`,
      payload: { render_id: render.id, take_id: take.id },
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
  return { ctx, db, calls, render, take, storage, log, progress };
}

describe("visualizer stage", () => {
  it("analyses the take, renders the composition with the stored look and stores the video", async () => {
    const params = {
      ...defaultVisualizerParams(),
      preset: "classico" as const,
    };
    const { ctx, db, calls, render, storage, progress, log } =
      await setup(params);
    expect(await stages.visualizer?.(ctx)).toEqual({});
    const renderCall = calls.find((c) => c.cmd === process.execPath);
    expect(renderCall?.args[0]).toBe(
      join(VISUALIZER_PACKAGE, "scripts", "render.mjs"),
    );
    expect(renderCall?.props).toMatchObject({
      params,
      title: "Astri",
      frames: 90,
      audio: "audio.mp3",
      analysis: "analysis.bin",
      background: { file: "background.jpg", kind: "image" },
      center: "cover.jpg",
      logos: [],
    });
    // Casuale reads the stock picture of the seed from the uploads bucket.
    expect(storage.download.mock.calls).toEqual(
      expect.arrayContaining([
        [
          stockBackground(params.background.seed),
          expect.any(String),
          "uploads",
        ],
        [
          "previews/owner/project/it/cover-1.jpg",
          expect.any(String),
          "previews",
        ],
      ]),
    );
    expect(storage.upload.mock.calls.map((c) => c[0])).toEqual([
      "previews/owner/project/it/visualizer-16x9.mp4",
      "previews/owner/project/it/visualizer-16x9.jpg",
    ]);
    expect(db.renders.find((r) => r.id === render.id)).toMatchObject({
      preview_path: "previews/owner/project/it/visualizer-16x9.mp4",
      path: join(ctx.ws.renderDir, "visualizer-16x9.mp4"),
    });
    const messages = progress.mock.calls.map((c) => c[1]);
    expect(messages[0]).toBe("Video: preparo l'audio");
    expect(messages).toContain("Video: rendering 100%");
    expect(messages.at(-1)).toBe("Video pronto");
    // Remotion's per-frame lines become progress, not log lines.
    expect(
      log.mock.calls.some((c) => String(c[0]).startsWith("Rendered")),
    ).toBe(false);
  });

  it("uses the uploads and the song cover as the studio chose them", async () => {
    const params = defaultVisualizerParams();
    params.aspect = "9:16";
    params.background = {
      mode: "video",
      seed: 0,
      assetUrl: "/media/uploads/owner/0b4f9c1e-1111-4b7a-9c2e-123456789abc.mp4",
      dimming: 40,
    };
    params.centerImage = {
      ...params.centerImage,
      mode: "upload",
      assetUrl: "/media/uploads/owner/0b4f9c1e-2222-4b7a-9c2e-123456789abc.png",
    };
    const { ctx, calls, storage } = await setup(params);
    await stages.visualizer?.(ctx);
    const props = calls.find((c) => c.cmd === process.execPath)?.props;
    expect(props).toMatchObject({
      background: { file: "background.mp4", kind: "video", frames: 135 },
      center: "center.png",
      logos: [],
    });
    expect(storage.download.mock.calls.map((c) => [c[0], c[2]])).toEqual(
      expect.arrayContaining([
        ["owner/0b4f9c1e-1111-4b7a-9c2e-123456789abc.mp4", "uploads"],
        ["owner/0b4f9c1e-2222-4b7a-9c2e-123456789abc.png", "uploads"],
      ]),
    );
    expect(storage.upload.mock.calls[0]?.[0]).toBe(
      "previews/owner/project/it/visualizer-9x16.mp4",
    );
  });

  it("upscales small background and centre images for a 4K frame without changing their aspect", async () => {
    const params = defaultVisualizerParams();
    params.quality = "4K";
    const { ctx, calls } = await setup(params, { imageSize: "800x400" });
    await stages.visualizer?.(ctx);
    const props = calls.find((c) => c.cmd === process.execPath)?.props;
    expect(props).toMatchObject({
      background: { file: "background-upscaled.png", kind: "image" },
      center: "cover-upscaled.png",
    });
    const scales = calls.filter(
      (c) =>
        c.cmd === "ffmpeg" && c.args.some((a) => a.includes("flags=lanczos")),
    );
    expect(scales.map((c) => c.args[c.args.indexOf("-vf") + 1])).toEqual([
      "scale=4320:2160:flags=lanczos",
      "scale=4320:2160:flags=lanczos",
    ]);
  });

  it("preserves a real JPEG's displayed aspect after EXIF rotation", async () => {
    const { ctx } = await setup(defaultVisualizerParams());
    ctx.engine = new Engine({ log: async () => {} }).withWorkspace(ctx.ws.root);
    const source = join(ctx.ws.root, "rotated.jpg");
    await ctx.engine.run("ffmpeg", [
      "-v",
      "error",
      "-y",
      "-f",
      "lavfi",
      "-i",
      "color=c=red:s=800x400",
      "-frames:v",
      "1",
      source,
    ]);
    const jpeg = await readFile(source);
    // APP1 EXIF: little-endian TIFF with orientation 6 (90 degrees clockwise).
    const exif = Buffer.from(
      "ffe1002245786966000049492a0008000000010012010300010000000600000000000000",
      "hex",
    );
    await writeFile(
      source,
      Buffer.concat([jpeg.subarray(0, 2), exif, jpeg.subarray(2)]),
    );
    const result = await upscaleImage(ctx, source, {
      width: 3840,
      height: 2160,
    });
    const dimensions = execFileSync(
      "ffprobe",
      [
        "-v",
        "error",
        "-select_streams",
        "v:0",
        "-show_entries",
        "stream=width,height",
        "-of",
        "csv=s=x:p=0",
        result,
      ],
      { encoding: "utf8", windowsHide: true },
    ).trim();
    expect(dimensions).toBe("3840x7680");
  }, 30_000);

  it.each(["1000x10", "10x1000", "2100x1000"])(
    "rejects oversized enlargement of %s before scaling or rendering",
    async (imageSize) => {
      const params = defaultVisualizerParams();
      params.quality = "4K";
      params.aspect = "9:16";
      const { ctx, calls } = await setup(params, { imageSize });
      await expect(stages.visualizer?.(ctx)).rejects.toThrow(
        "Immagine troppo allungata",
      );
      expect(
        calls.some((c) => c.args.some((a) => a.includes("flags=lanczos"))),
      ).toBe(false);
      expect(calls.some((c) => c.cmd === process.execPath)).toBe(false);
    },
  );

  it("fetches the logos like the centre upload, leaving out a missing one", async () => {
    const params = defaultVisualizerParams();
    const mine = (n: number) =>
      `/media/uploads/owner/0b4f9c1e-${n}${n}${n}${n}-4b7a-9c2e-123456789abc.png`;
    params.logos = [
      { assetUrl: mine(3), position: "top-left", size: 12, opacity: 100 },
      { assetUrl: mine(4), position: "bottom-right", size: 20, opacity: 60 },
    ];
    const { ctx, calls, storage } = await setup(params);
    storage.download.mockImplementation(async (path: string, file: string) => {
      if (path.includes("4444")) throw new Error("Object not found");
      await writeFile(file, "downloaded");
    });
    expect(await stages.visualizer?.(ctx)).toEqual({});
    const props = calls.find((c) => c.cmd === process.execPath)?.props as {
      logos: unknown;
      params: VisualizerParams;
    };
    expect(props.logos).toEqual(["logo-1.png", null]);
    expect(props.params.logos).toEqual(params.logos);
    expect(storage.download.mock.calls.map((c) => [c[0], c[2]])).toEqual(
      expect.arrayContaining([
        ["owner/0b4f9c1e-3333-4b7a-9c2e-123456789abc.png", "uploads"],
        ["owner/0b4f9c1e-4444-4b7a-9c2e-123456789abc.png", "uploads"],
      ]),
    );
  });

  it("never reads another user's file as a logo", async () => {
    const params = defaultVisualizerParams();
    params.logos = [
      {
        assetUrl:
          "/media/uploads/stranger/0b4f9c1e-5555-4b7a-9c2e-123456789abc.png",
        position: "top-left",
        size: 12,
        opacity: 100,
      },
    ];
    const { ctx, calls, storage } = await setup(params);
    await stages.visualizer?.(ctx);
    expect(calls.find((c) => c.cmd === process.execPath)?.props).toMatchObject({
      logos: [null],
    });
    expect(
      storage.download.mock.calls.some((c) =>
        String(c[0]).startsWith("stranger/"),
      ),
    ).toBe(false);
  });

  it("drops the old default artist and website of a render saved before the logos", async () => {
    const { logos: _logos, ...old } = {
      ...defaultVisualizerParams(),
      preset: "classico" as const,
      classico: {
        artist: "AIMELODIA",
        website: "STEFANDSL.COM",
        album: "Lampioni",
        gramophone: "red",
        cards: true,
      },
    };
    const { ctx, calls } = await setup(old as unknown as VisualizerParams);
    await stages.visualizer?.(ctx);
    const props = calls.find((c) => c.cmd === process.execPath)?.props as {
      params: VisualizerParams;
    };
    expect(props.params.classico).toEqual({
      artist: "",
      website: "",
      album: "Lampioni",
      cards: true,
    });
    expect(props.params.logos).toEqual([]);
  });

  it("falls back to the cover for Immagine without an upload, and to no picture without a cover", async () => {
    const params = defaultVisualizerParams();
    params.background = { mode: "image", seed: 0, assetUrl: null, dimming: 60 };
    const withCover = await setup(params);
    await stages.visualizer?.(withCover.ctx);
    expect(
      withCover.calls.find((c) => c.cmd === process.execPath)?.props,
    ).toMatchObject({
      background: { file: "cover.jpg", kind: "image" },
    });
    const without = await setup(params, { cover: false });
    await stages.visualizer?.(without.ctx);
    expect(
      without.calls.find((c) => c.cmd === process.execPath)?.props,
    ).toMatchObject({
      background: null,
      center: null,
    });
  });

  it("fails on a render error, stores nothing and leaves the song alone", async () => {
    const { ctx, db, render, storage } = await setup(
      defaultVisualizerParams(),
      {
        renderCode: 1,
      },
    );
    await expect(stages.visualizer?.(ctx)).rejects.toThrow();
    expect(storage.upload).not.toHaveBeenCalled();
    expect(
      db.renders.find((r) => r.id === render.id)?.preview_path,
    ).toBeUndefined();
    expect(db.versions[0]?.status).toBe("audio_ready");
  });

  it("refuses broken parameters and a render that is not this song's", async () => {
    const bad = await setup(defaultVisualizerParams());
    const row = bad.db.renders[0] as { visualizer_params?: unknown };
    row.visualizer_params = { preset: "nope" };
    await expect(stages.visualizer?.(bad.ctx)).rejects.toThrow(
      "Parametri del video non validi",
    );
    const gone = await setup(defaultVisualizerParams());
    gone.ctx.job.payload = { render_id: "missing" };
    await expect(stages.visualizer?.(gone.ctx)).rejects.toThrow(
      "Il video da creare non esiste più",
    );
  });
});

describe("visualizer files and cleanup", () => {
  it("keeps visualizer videos when a newer lyric video makes older renders obsolete", async () => {
    const { ctx, db, storage } = await setup(defaultVisualizerParams());
    await db.patchRender(db.renders[0]?.id as string, {
      preview_path: "previews/owner/project/it/visualizer-16x9.mp4",
    });
    db.renders.push({
      id: "old-master",
      version_id: "version",
      kind: "master",
      render_attempt: 1,
      preview_path: "previews/owner/project/it/version/1/master-preview.mp4",
    });
    const file = join(ctx.ws.root, "new.mp4");
    await writeFile(file, "x");
    await upload(ctx, file, "video/mp4");
    const removed = storage.remove.mock.calls.flatMap((c) => c[0]);
    expect(removed).toContain(
      "previews/owner/project/it/version/1/master-preview.mp4",
    );
    expect(removed).not.toContain(
      "previews/owner/project/it/visualizer-16x9.mp4",
    );
    expect(removed).not.toContain(
      "previews/owner/project/it/visualizer-16x9.jpg",
    );
  });

  it("reads Remotion's progress and names files per aspect", () => {
    expect(renderedPercent("Rendered 45/90, time remaining: 2s")).toBe(50);
    expect(renderedPercent("Encoded 45/90")).toBeNull();
    expect(aspectName("9:16")).toBe("9x16");
    // A 4-minute song fits the limit with its audio; short songs are capped.
    const kbps = deliveryKbps(240);
    expect(((kbps + 160) * 1000 * 240) / 8).toBeLessThan(DELIVERY_LIMIT);
    expect(kbps).toBeGreaterThan(1000);
    expect(deliveryKbps(10)).toBe(8000);
  });
});

describe("visualizer authorization", () => {
  it("accepts the song's own visualizer render and refuses anyone else's", async () => {
    const { ctx, db, render } = await setup(defaultVisualizerParams());
    await expect(
      authorizeStage(db, ctx.job, ctx.version, ctx.project),
    ).resolves.toBeUndefined();
    const other = {
      id: "11111111-1111-4111-8111-111111111111",
      owner_id: "someone-else",
      version_id: "version",
      kind: "visualizer" as const,
      aspect: "9:16" as const,
      render_attempt: 1,
      visualizer_params: {},
    };
    db.renders.push(other);
    for (const id of [other.id, "00000000-0000-4000-8000-000000000000"])
      await expect(
        authorizeStage(
          db,
          {
            ...ctx.job,
            payload: { render_id: id, take_id: ctx.job.payload?.take_id },
          },
          ctx.version,
          ctx.project,
        ),
      ).rejects.toBeInstanceOf(AuthorizationDenied);
    expect(db.renders.find((r) => r.id === render.id)?.owner_id).toBe("owner");
  });
});
