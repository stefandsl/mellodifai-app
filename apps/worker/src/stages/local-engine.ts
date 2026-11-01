import { randomInt } from "node:crypto";
import {
  access,
  copyFile,
  readdir,
  readFile,
  rm,
  writeFile,
} from "node:fs/promises";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import {
  aceStepSeconds,
  type LocalSongEngine,
  type LyricPack,
  LyricPackSchema,
  readControls,
  type SongEngine,
  SongSettingsSchema,
  styleWithout,
  withMusicTags,
} from "@mellodifai/shared";
import {
  ComfyClient,
  GraphRejected,
  type SocketLike,
} from "../comfy/client.js";
import { LOCAL_ENGINES } from "../comfy/config.js";
import {
  aceGraph,
  bpmAndKey,
  type ComfyGraph,
  loadGraph,
  toYue2Lyrics,
  yue2Graph,
} from "../comfy/graphs.js";
import { PROMPT_NAMESPACE, uuidv5 } from "../comfy/ids.js";
import {
  LOCAL_LIMITS,
  type LocalLimits,
  type LocalRuntime,
} from "../comfy/runtime.js";
import type { Take } from "../db.js";
import type { StageContext, StageResult } from "../loop.js";
import { scoreTakes } from "./score-takes.js";
import { ENGINE_ROOT, language, upload, writePack } from "./utils.js";

// Owner decision (design 14): a ceiling, not a length; YuE2 stops at its own end token.
export const YUE2_MAX_DURATION = 420;
const ENGINE_NAMES: Record<LocalSongEngine, string> = {
  yue2: "YuE2",
  "ace-step": "ACE-Step",
};
// One client id for every worker process: ComfyUI sends a prompt's progress only to the socket of
// the client that queued it, so a worker restarted after a crash still hears a running prompt.
export const COMFY_CLIENT_ID = uuidv5(PROMPT_NAMESPACE, "mellodifai-worker");

// Fixed Italian sentences for the studio; the job log keeps the technical detail.
export const LOCAL_TEXT = {
  adminOnly:
    "I motori locali sono riservati all'amministratore: questo brano non può essere generato sul PC.",
  unavailable: "Il motore locale non è disponibile su questo worker.",
  rejected:
    "ComfyUI ha rifiutato la richiesta del brano: guarda il log del lavoro.",
  busyGpu:
    "La GPU è occupata da un altro programma: riprovo tra qualche minuto.",
  missingNodes: (nodes: string[]) =>
    `In ComfyUI mancano i nodi ${nodes.join(", ")}: il motore non è installato come nel bake-off.`,
  failedTwice: (take: number, reason: string) =>
    `Il motore locale non è riuscito a creare il brano ${take} per due volte (${reason}). Riprova più tardi.`,
  unknownEngine: (engine: string) => `Motore sconosciuto: ${engine}.`,
};

// Which node runs which part of a take, and the share of the take it covers (for progress).
const STAGES: Record<
  LocalSongEngine,
  Record<string, [label: string, from: number, to: number]>
> = {
  yue2: {
    "24": ["partitura", 0, 0.15],
    "25": ["composizione", 0.15, 0.75],
    "8": ["rendering", 0.75, 0.95],
    "9": ["decodifica", 0.95, 1],
  },
  "ace-step": {
    "94": ["composizione", 0, 0.6],
    "3": ["rendering", 0.6, 0.95],
    "18": ["decodifica", 0.95, 1],
  },
};

// The engine stored with the project. Anything but a known engine stops the job: an unreadable
// value must never fall back to kie, which costs credits.
export function songEngine(songSettings: unknown): SongEngine {
  const raw =
    songSettings && typeof songSettings === "object"
      ? (songSettings as { engine?: unknown }).engine
      : undefined;
  const parsed = SongSettingsSchema.shape.engine.safeParse(raw);
  if (!parsed.success) throw new Error(LOCAL_TEXT.unknownEngine(String(raw)));
  return parsed.data;
}

// ACE-Step renders exactly the length it gets: the user's duration, else one from the lyrics.
export function aceDuration(pack: LyricPack): number {
  return pack.settings.duration ?? aceStepSeconds(pack.lyrics);
}

// A take attempt that the watchdog may retry once; the message is an Italian reason.
class TakeFailure extends Error {}

type TakeResult = {
  take: number;
  promptId: string;
  seed: number;
  abc: string | null;
  // The log said the model ran out of token budget before its end token (design 5.4).
  budget: boolean;
};

async function exists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

function validSeed(value: unknown): value is number {
  return (
    typeof value === "number" &&
    Number.isSafeInteger(value) &&
    value >= 0 &&
    value < 2 ** 48
  );
}

// Seeds are drawn once per generate_song job and saved before the first submit, so a requeued
// job rebuilds the same graphs (below 2^48: exact in JavaScript and in a bigint column). A seed
// the user fixed in the form is take 1's, and take 2 uses the next one.
async function takeSeeds(context: StageContext): Promise<[number, number]> {
  const payload = context.job.payload ?? {};
  const saved = payload.seeds as Record<string, unknown> | undefined;
  if (validSeed(saved?.["1"]) && validSeed(saved?.["2"]))
    return [saved["1"], saved["2"]];
  const fixed = readControls(context.project.song_settings).seed;
  const seeds: [number, number] =
    fixed === undefined
      ? [randomInt(0, 2 ** 48 - 1), randomInt(0, 2 ** 48 - 1)]
      : [fixed, fixed + 1];
  const next = { ...payload, seeds: { "1": seeds[0], "2": seeds[1] } };
  await context.db.patchJobPayload(
    context.job.id,
    context.job.worker_id ??
      context.secrets.values.WORKER_ID ??
      `worker-${process.env.COMPUTERNAME ?? "pc"}`,
    next,
  );
  context.job.payload = next;
  return seeds;
}

// SaveAudioAdvanced writes <prefix>_00001.flac under the output directory, and only once the take
// is complete, so any match is a finished take of this prefix.
async function findOutput(
  outputDir: string,
  prefix: string,
): Promise<string | null> {
  const parts = prefix.split("/");
  const base = parts.pop() ?? "";
  const dir = join(outputDir, ...parts);
  try {
    const pattern = new RegExp(`^${base}_\\d+_?\\.flac$`, "u");
    const found = (await readdir(dir)).filter((file) => pattern.test(file));
    const latest = found.sort().at(-1);
    return latest ? join(dir, latest) : null;
  } catch {
    return null;
  }
}

class LocalGeneration {
  private readonly client: ComfyClient;
  private readonly limits: LocalLimits;
  private readonly now: () => number;
  private lastProgress = Number.NEGATIVE_INFINITY;
  constructor(
    private readonly context: StageContext,
    private readonly runtime: LocalRuntime,
    private readonly engine: LocalSongEngine,
  ) {
    this.client = new ComfyClient(
      runtime.supervisor.baseUrl,
      runtime.fetch,
      runtime.connect,
    );
    this.limits = { ...LOCAL_LIMITS, ...runtime.limits };
    this.now = runtime.now ?? Date.now;
  }
  private sleep(ms: number) {
    return this.runtime.sleep ? this.runtime.sleep(ms) : delay(ms);
  }
  private get generation() {
    return this.context.version.generation_count ?? 1;
  }

  async checkNodes() {
    const nodes = LOCAL_ENGINES[this.engine].nodes;
    const present = await Promise.all(
      nodes.map((node) => this.client.hasNode(node)),
    );
    const missing = nodes.filter((_node, i) => !present[i]);
    if (missing.length) throw new Error(LOCAL_TEXT.missingNodes(missing));
  }

  async graph(pack: LyricPack, seed: number, prefix: string) {
    const template = await loadGraph(this.engine);
    const controls = readControls(this.context.project.song_settings);
    if (this.engine === "yue2")
      return yue2Graph(template, {
        style: withMusicTags(pack.style, controls),
        lyrics: toYue2Lyrics(pack.lyrics),
        seed,
        maxDuration: YUE2_MAX_DURATION,
        prefix,
      });
    // ACE-Step takes tempo, key and signature as encoder inputs, so a chosen value replaces the
    // one the drafted style names; Auto reads the style as before.
    const drafted = bpmAndKey(pack.style);
    return aceGraph(template, {
      style: styleWithout(pack.style, controls),
      lyrics: pack.lyrics,
      seed,
      duration: aceDuration(pack),
      bpm: controls.bpm ?? drafted.bpm,
      keyscale: controls.keyscale ?? drafted.keyscale,
      ...(controls.timeSignature
        ? { timesignature: controls.timeSignature }
        : {}),
      ...(controls.steps === undefined ? {} : { steps: controls.steps }),
      ...(controls.guidance === undefined
        ? {}
        : { guidance: controls.guidance }),
      language: language(this.context),
      prefix,
    });
  }

  // At most one progress event every 2 s, labelled with the part of the take that runs.
  private progress(take: number, node: string, value: number, max: number) {
    const stage = STAGES[this.engine][node];
    if (!stage) return;
    const now = this.now();
    if (now - this.lastProgress < this.limits.progressMs) return;
    this.lastProgress = now;
    const [label, from, to] = stage;
    const share = max > 0 ? Math.min(1, Math.max(0, value / max)) : 0;
    const pct = Math.round(((take - 1 + from + (to - from) * share) / 2) * 100);
    void this.context
      .progress(
        pct,
        `Brano ${take} di 2 con ${ENGINE_NAMES[this.engine]}: ${label}`,
      )
      .catch(() => {});
  }

  // Follows one prompt to its end: WebSocket events for progress and liveness, /api/jobs for the
  // state. A prompt with no event for 2 minutes, or longer than 15 minutes, is cancelled.
  private async watch(promptId: string, take: number): Promise<void> {
    const started = this.now();
    let lastEvent = started;
    let socket: SocketLike | undefined;
    const open = () => {
      const current = this.client.connect(COMFY_CLIENT_ID);
      socket = current;
      current.addEventListener("message", (event) => {
        if (typeof event.data !== "string") return;
        let message: { type?: unknown; data?: Record<string, unknown> };
        try {
          message = JSON.parse(event.data) as typeof message;
        } catch {
          return;
        }
        const data = message.data;
        if (data?.prompt_id !== promptId) return;
        lastEvent = this.now();
        if (typeof data.node !== "string") return;
        if (message.type === "executing") this.progress(take, data.node, 0, 1);
        if (message.type === "progress")
          this.progress(take, data.node, Number(data.value), Number(data.max));
      });
      current.addEventListener("close", () => {
        if (socket === current) socket = undefined;
      });
      current.addEventListener("error", () => {});
    };
    const giveUp = async (reason: string) => {
      await this.client.cancel(promptId).catch(() => {});
      throw new TakeFailure(reason);
    };
    open();
    let pollErrors = 0;
    try {
      for (;;) {
        await this.sleep(this.limits.pollMs);
        this.context.signal.throwIfAborted();
        if (!socket) open();
        let job: Awaited<ReturnType<ComfyClient["job"]>>;
        try {
          job = await this.client.job(promptId);
          pollErrors = 0;
        } catch {
          pollErrors += 1;
          if (pollErrors >= 3) throw new TakeFailure("ComfyUI non risponde");
          continue;
        }
        if (!job) throw new TakeFailure("ComfyUI ha perso la richiesta");
        if (job.status === "completed") return;
        if (job.status === "failed" || job.status === "cancelled")
          throw new TakeFailure(
            job.execution_error?.exception_message
              ? `errore di ComfyUI: ${job.execution_error.exception_message.slice(0, 200)}`
              : "ComfyUI ha interrotto la richiesta",
          );
        if (this.now() - lastEvent > this.limits.stallMs)
          await giveUp(
            `nessun segnale per ${Math.round(this.limits.stallMs / 1000)} s`,
          );
        if (this.now() - started > this.limits.takeMs)
          await giveUp(
            `oltre ${Math.round(this.limits.takeMs / 60_000)} minuti per un brano`,
          );
      }
    } finally {
      socket?.close();
    }
  }

  // Recovery order of design 5.3: the server's job, then the output file, then a new submit.
  private async obtain(
    promptId: string,
    graph: ComfyGraph,
    prefix: string,
    flac: string,
    take: number,
  ): Promise<{ abc: string | null; budget: boolean }> {
    const known = await this.client.job(promptId);
    let logStart: number | null = null;
    if (!known) {
      const file = await findOutput(this.runtime.outputDir, prefix);
      if (file) {
        await copyFile(file, flac);
        await this.context.log(
          `Take ${take}: recovered the finished ComfyUI output ${file}`,
        );
        return { abc: null, budget: false };
      }
      logStart = (await this.client.logs().catch(() => null))?.length ?? null;
      await this.client.submit(graph, promptId, COMFY_CLIENT_ID);
      await this.context.log(`Take ${take}: submitted prompt ${promptId}`);
      await this.watch(promptId, take);
    } else if (known.status === "pending" || known.status === "in_progress") {
      await this.context.log(
        `Take ${take}: reattached to running prompt ${promptId}`,
      );
      await this.watch(promptId, take);
    } else if (known.status !== "completed")
      throw new TakeFailure(
        known.execution_error?.exception_message
          ? `errore di ComfyUI: ${known.execution_error.exception_message.slice(0, 200)}`
          : "ComfyUI ha interrotto la richiesta",
      );
    const history = await this.client.history(promptId);
    const outputs = history?.outputs ?? {};
    const audio = outputs[LOCAL_ENGINES[this.engine].saveNode]?.audio?.[0];
    if (!audio) throw new TakeFailure("ComfyUI non ha restituito l'audio");
    await this.client.download(audio, flac);
    const score = outputs["14"]?.text?.[0];
    const logs =
      logStart === null
        ? []
        : (await this.client.logs().catch(() => [])).slice(logStart);
    return {
      abc: this.engine === "yue2" && typeof score === "string" ? score : null,
      budget:
        this.engine === "yue2" &&
        logs.some((line) => /budget|reduced to/iu.test(line)),
    };
  }

  // One take, with one restart and resubmit after a hang or a failure, never more.
  async take(pack: LyricPack, take: number, seed: number): Promise<TakeResult> {
    const { context } = this;
    const outDir = context.ws.outDir;
    const marker = join(outDir, `local-${this.generation}-take-${take}.json`);
    const mp3 = join(outDir, `take-${take}.mp3`);
    if ((await exists(marker)) && (await exists(mp3)))
      return JSON.parse(await readFile(marker, "utf8")) as TakeResult;
    const name = `${context.version.id}:${this.generation}:${take}`;
    const ids = [
      uuidv5(PROMPT_NAMESPACE, name),
      uuidv5(PROMPT_NAMESPACE, `${name}:retry`),
    ] as const;
    const prefix = `mellodifai/${context.version.id}/g${this.generation}/take-${take}`;
    const graph = await this.graph(pack, seed, prefix);
    const flac = join(outDir, `take-${take}.flac`);
    // A crash after the watchdog's resubmit: follow the second attempt, not the first.
    let attempt = (await this.client.job(ids[1])) ? 1 : 0;
    let reason = "";
    let result: TakeResult | undefined;
    for (; attempt < 2 && !result; attempt += 1) {
      const promptId = ids[attempt] ?? ids[0];
      try {
        const outcome = await this.obtain(promptId, graph, prefix, flac, take);
        result = { take, promptId, seed, ...outcome };
      } catch (error) {
        if (context.signal.aborted) throw error;
        if (error instanceof GraphRejected) {
          await context.log(context.secrets.redact(error.message));
          throw new Error(LOCAL_TEXT.rejected);
        }
        reason =
          error instanceof TakeFailure ? error.message : "ComfyUI non risponde";
        await context.log(
          context.secrets.redact(
            `Take ${take} attempt ${attempt + 1} failed: ${String(error)}`,
          ),
        );
        if (attempt === 0) {
          await this.client.cancel(promptId).catch(() => {});
          await context.log("Restarting ComfyUI before the second attempt");
          await this.runtime.supervisor.restart();
        }
      }
    }
    if (!result) throw new Error(LOCAL_TEXT.failedTwice(take, reason));
    await context.engine.run(
      "ffmpeg",
      [
        "-y",
        "-hide_banner",
        "-loglevel",
        "error",
        "-i",
        flac,
        // ComfyUI embeds the whole graph (lyrics, seed) as tags; the take carries none of it.
        "-map_metadata",
        "-1",
        "-c:a",
        "libmp3lame",
        "-b:a",
        "320k",
        mp3,
      ],
      { cwd: ENGINE_ROOT, outputs: [mp3] },
    );
    // A kie alignment of an earlier take would time this audio with the wrong words.
    await rm(join(outDir, `aligned-take${take}.json`), { force: true });
    await writeFile(marker, JSON.stringify(result));
    return result;
  }

  async saveTake(result: TakeResult): Promise<Take> {
    const { context } = this;
    const mp3 = join(context.ws.outDir, `take-${result.take}.mp3`);
    const preview = join(context.ws.outDir, `take-${result.take}-preview.mp3`);
    await context.engine.run(
      "ffmpeg",
      ["-y", "-i", mp3, "-b:a", "128k", "-f", "mp3", preview],
      { cwd: ENGINE_ROOT, outputs: [preview] },
    );
    return context.db.createTake({
      ...(context.version.owner_id
        ? { owner_id: context.version.owner_id }
        : {}),
      version_id: context.version.id,
      generation: this.generation,
      take_number: result.take,
      audio_preview_path: await upload(context, preview, "audio/mpeg"),
      engine: this.engine,
      seed: result.seed,
      abc: result.abc,
      cover_path: null,
    });
  }
}

// generate_song for a local engine (design 5.1): two takes made one after the other on this
// PC's ComfyUI, the workspace left as the kie path leaves it, never a kie call or a kie credit.
export async function generateLocal(
  context: StageContext,
  engine: LocalSongEngine,
): Promise<StageResult> {
  const ownerId = context.version.owner_id ?? context.project.owner_id;
  const role = ownerId ? await context.db.getOwnerRole(ownerId) : null;
  if (role !== "admin") throw new Error(LOCAL_TEXT.adminOnly);
  const runtime = context.comfy;
  if (!runtime) throw new Error(LOCAL_TEXT.unavailable);
  const pack = LyricPackSchema.parse(context.version.lyric_pack);
  await writePack(context, pack);
  const seeds = await takeSeeds(context);
  const run = new LocalGeneration(context, runtime, engine);
  const limits = { ...LOCAL_LIMITS, ...runtime.limits };
  // A game holding the GPU: wait for it rather than fail (design 5.2). Our own running server
  // holds VRAM too, so the check only applies before starting it.
  if (!(await runtime.supervisor.isUp())) {
    const free = await runtime.freeVramMb().catch(() => null);
    if (free !== null && free < limits.minFreeVramMb) {
      await context.log(`Only ${free} MB of VRAM free, waiting`);
      return {
        retryLater: {
          reason: LOCAL_TEXT.busyGpu,
          notBefore: new Date(Date.now() + limits.retryLaterMs).toISOString(),
        },
      };
    }
  }
  const results: TakeResult[] = [];
  const takes: Take[] = [];
  try {
    await context.log(`Starting ComfyUI for ${ENGINE_NAMES[engine]}`);
    await runtime.supervisor.ensureStarted();
    await run.checkNodes();
    // Take 2 is submitted only after take 1 ends (ComfyUI #16416).
    for (const take of [1, 2]) {
      const result = await run.take(pack, take, seeds[take - 1] ?? 0);
      results.push(result);
      takes.push(await run.saveTake(result));
    }
  } finally {
    // Demucs (timing) and Remotion need the whole GPU.
    try {
      await runtime.supervisor.stop();
    } catch (error) {
      await context
        .log(context.secrets.redact(`ComfyUI stop failed: ${String(error)}`))
        .catch(() => {});
    }
  }
  await scoreTakes(context, takes, {
    ...(engine === "yue2" ? { ceiling: YUE2_MAX_DURATION } : {}),
    truncated: new Set(results.filter((r) => r.budget).map((r) => r.take)),
  });
  await context.log(
    `Generated ${takes.length} takes with ${ENGINE_NAMES[engine]}`,
  );
  return {
    versionStatus: "takes_review",
    patch: { render_attempt: context.version.render_attempt ?? 1 },
    enqueue: [],
  };
}
