import { randomInt } from "node:crypto";
import { access, copyFile, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { ACE_STEP_TEXT, type LyricPack } from "@mellodifai/shared";
import { AceStepClient } from "../ace-step/client.js";
import { AceStepError } from "../ace-step/supervisor.js";
import type { StageContext, StageResult } from "../loop.js";
import { ENGINE_ROOT, upload } from "./utils.js";

// What generate_song needs from the worker-owned ACE-Step supervisor.
export type AceStepRuntime = {
  baseUrl: string;
  apiKey: string;
  acquire(): Promise<void>;
  release(): Promise<void>;
  restart(): Promise<void>;
  isRunning(): boolean;
  freeVramMb(): Promise<number | null>;
  fetch?: typeof fetch;
};

export const ACE_STEP_LIMITS = {
  defaultSeconds: 210,
  minFreeVramMb: 6000,
  pollMs: 2000,
  takeTimeoutMs: 15 * 60_000,
  expectedTakeMs: 4 * 60_000,
  gpuRetryMs: 5 * 60_000,
};

async function exists(path: string) {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

export function aceStepStyle(pack: LyricPack): string {
  const voice =
    pack.settings.vocalGender === "f"
      ? "female vocals"
      : pack.settings.vocalGender === "m"
        ? "male vocals"
        : "";
  return [pack.style.trim(), voice].filter(Boolean).join(", ").slice(0, 1000);
}
export function aceStepSeconds(pack: LyricPack): number {
  const wanted = pack.settings.duration ?? ACE_STEP_LIMITS.defaultSeconds;
  return Math.min(360, Math.max(10, Math.round(wanted)));
}

type TaskFile = { taskId: string; attempt: number };

export async function generateAceStep(
  context: StageContext,
  pack: LyricPack,
  runtime: AceStepRuntime | undefined,
  sleep: (ms: number) => Promise<void> = (ms) =>
    new Promise((resolve) => setTimeout(resolve, ms)),
): Promise<StageResult> {
  if (!runtime) throw new AceStepError(ACE_STEP_TEXT.errorStart);
  const generation = context.version.generation_count ?? 1;
  const out = context.ws.outDir;
  const file = (name: string) => join(out, `ace-g${generation}-${name}`);
  // Seeds are drawn once per generation and kept, so a retried job redoes the same songs.
  const seedsFile = file("seeds.json");
  if (!(await exists(seedsFile)))
    await writeFile(
      seedsFile,
      JSON.stringify([randomInt(1, 2 ** 31 - 1), randomInt(1, 2 ** 31 - 1)]),
      { flag: "wx" },
    ).catch((error: NodeJS.ErrnoException) => {
      if (error.code !== "EEXIST") throw error;
    });
  const seeds = JSON.parse(await readFile(seedsFile, "utf8")) as number[];

  const missing: number[] = [];
  for (const take of [1, 2])
    if (!(await exists(file(`take-${take}.mp3`)))) missing.push(take);

  if (missing.length > 0) {
    if (!runtime.isRunning()) {
      const free = await runtime.freeVramMb().catch(() => null);
      if (free !== null && free < ACE_STEP_LIMITS.minFreeVramMb) {
        await context.log(ACE_STEP_TEXT.errorGpu);
        return {
          retryLater: {
            reason: ACE_STEP_TEXT.errorGpu,
            notBefore: new Date(
              Date.now() + ACE_STEP_LIMITS.gpuRetryMs,
            ).toISOString(),
          },
        };
      }
    }
    await context.log(ACE_STEP_TEXT.starting);
    await runtime.acquire();
    try {
      const client = new AceStepClient(
        runtime.baseUrl,
        runtime.apiKey,
        runtime.fetch,
      );
      for (const take of missing)
        await renderTake(context, client, runtime, {
          take,
          seed: seeds[take - 1] ?? randomInt(1, 2 ** 31 - 1),
          pack,
          file,
          sleep,
        });
    } finally {
      await runtime.release();
    }
  }

  const takes = [];
  for (const take of [1, 2]) {
    const master = join(out, `take-${take}.mp3`);
    await copyFile(file(`take-${take}.mp3`), master);
    const preview = join(out, `take-${take}-preview.mp3`);
    await context.engine.run(
      "ffmpeg",
      ["-y", "-i", master, "-b:a", "128k", "-f", "mp3", preview],
      { cwd: ENGINE_ROOT, outputs: [preview] },
    );
    takes.push(
      await context.db.createTake({
        ...(context.version.owner_id
          ? { owner_id: context.version.owner_id }
          : {}),
        version_id: context.version.id,
        generation,
        take_number: take,
        kie_task_id: null,
        engine: "ace-step",
        seed: seeds[take - 1] ?? null,
        audio_preview_path: await upload(context, preview, "audio/mpeg"),
      }),
    );
  }
  await context.log(`Generated ${takes.length} takes with ACE-Step`);
  return {
    versionStatus: "takes_review",
    patch: { render_attempt: context.version.render_attempt ?? 1 },
    enqueue: [],
  };
}

async function renderTake(
  context: StageContext,
  client: AceStepClient,
  runtime: AceStepRuntime,
  options: {
    take: number;
    seed: number;
    pack: LyricPack;
    file: (name: string) => string;
    sleep: (ms: number) => Promise<void>;
  },
) {
  const { take, seed, pack, file, sleep } = options;
  const taskFile = file(`take-${take}.task.json`);
  const submit = async (attempt: number): Promise<TaskFile> => {
    const taskId = await client.release({
      prompt: aceStepStyle(pack),
      lyrics: pack.lyrics,
      audioDuration: aceStepSeconds(pack),
      seed,
      vocalLanguage: context.version.lang,
    });
    const task = { taskId, attempt };
    await writeFile(taskFile, JSON.stringify(task));
    return task;
  };
  let task: TaskFile | undefined;
  try {
    task = JSON.parse(await readFile(taskFile, "utf8")) as TaskFile;
  } catch {
    task = undefined;
  }
  task ??= await submit(1);
  let started = Date.now();
  let lastProgress = 0;
  for (;;) {
    context.signal.throwIfAborted();
    let result: Awaited<ReturnType<AceStepClient["query"]>>;
    try {
      result = await client.query(task.taskId);
    } catch {
      result = { state: "unknown" };
    }
    if (result.state === "done") {
      const wav = file(`take-${take}.wav`);
      await writeFile(wav, await client.download(result.file));
      const mp3 = file(`take-${take}.mp3`);
      await context.engine.run(
        "ffmpeg",
        [
          "-y",
          "-i",
          wav,
          "-codec:a",
          "libmp3lame",
          "-b:a",
          "320k",
          "-f",
          "mp3",
          mp3,
        ],
        { cwd: ENGINE_ROOT, outputs: [mp3] },
      );
      return;
    }
    const elapsed = Date.now() - started;
    // A lost task (server restarted), a failure or a hang gets one fresh try.
    if (
      result.state === "failed" ||
      result.state === "unknown" ||
      elapsed > ACE_STEP_LIMITS.takeTimeoutMs
    ) {
      if (task.attempt >= 2) {
        await context.log(
          context.secrets.redact(
            `ACE-Step take ${take} failed: ${result.state === "failed" ? result.error : result.state}`,
          ),
        );
        throw new AceStepError(ACE_STEP_TEXT.errorTake);
      }
      await runtime.restart();
      task = await submit(task.attempt + 1);
      started = Date.now();
      continue;
    }
    if (Date.now() - lastProgress >= ACE_STEP_LIMITS.pollMs) {
      lastProgress = Date.now();
      const share = Math.min(0.95, elapsed / ACE_STEP_LIMITS.expectedTakeMs);
      await context.progress(Math.round(((take - 1 + share) / 2) * 100));
    }
    await sleep(ACE_STEP_LIMITS.pollMs);
  }
}
