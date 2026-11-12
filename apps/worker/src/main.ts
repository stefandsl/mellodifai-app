import { mkdir } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import { createClient } from "@supabase/supabase-js";
import { publishEngines } from "./comfy/availability.js";
import { COMFY_CONFIG, comfyInputDir, comfyOutputDir } from "./comfy/config.js";
import type { LocalRuntime } from "./comfy/runtime.js";
import {
  type ComfySupervisor,
  createComfySupervisor,
  nvidiaFreeVramMb,
} from "./comfy/supervisor.js";
import { SupabaseDb } from "./db.js";
import { Engine } from "./engine.js";
import { fakeStages } from "./fake/index.js";
import { fakeSongless } from "./fake/lyrics-assist.js";
import { WorkerLoop } from "./loop.js";
import { serviceLedger, validateEngineEntries } from "./providers/ledger.js";
import { workerRuntimeRoot, workerTempDir } from "./runtime.js";
import { startScheduler } from "./scheduler.js";
import { loadSecrets, type Secrets } from "./secrets.js";
import { refreshBalance } from "./stages/generate-song.js";
import { songlessStages, stages } from "./stages/index.js";
import { SupabaseStorage } from "./storage.js";
import { WorkspaceFactory } from "./workspace.js";

// Runs refresh now and every ten minutes, never two at once; the returned function stops it.
export function startPeriodicRefresh(refresh: () => Promise<void>) {
  let pending: Promise<void> | undefined;
  const tick = () => {
    if (!pending)
      pending = refresh()
        .catch(() => {})
        .finally(() => {
          pending = undefined;
        });
  };
  tick();
  const timer = setInterval(tick, 600_000);
  return async () => {
    clearInterval(timer);
    await pending;
  };
}
export const startBalanceRefresh = startPeriodicRefresh;

// The ComfyUI server belongs to the worker process: a local generate_song starts it and stops it
// at the end of the stage, and a server left by a crashed worker is adopted on start, so its
// running prompt can be followed again by the requeued job.
export async function startLocalEngines(options: {
  supervisor: Pick<ComfySupervisor, "adopt" | "stop">;
  publish: () => Promise<void>;
  report: (line: string) => void;
}) {
  try {
    if (await options.supervisor.adopt())
      options.report("Adopted the ComfyUI server already running on this PC");
  } catch (error) {
    options.report(`ComfyUI adoption failed: ${String(error)}`);
  }
  const stopPublish = startPeriodicRefresh(() =>
    options.publish().catch((error: unknown) => {
      options.report(`Engine availability refresh failed: ${String(error)}`);
    }),
  );
  return async () => {
    await stopPublish();
    // Never leave the GPU held by a server nobody will stop.
    await options.supervisor.stop().catch(() => {});
  };
}

export function installSignals(
  loop: Pick<WorkerLoop, "stop" | "forceStop">,
  source: {
    on(signal: string, listener: () => void): unknown;
    off(signal: string, listener: () => void): unknown;
  } = process,
  exit: (code: number) => void = (code) => process.exit(code),
  report: (message: string) => void = console.error,
) {
  let signals = 0;
  const handle = () => {
    signals += 1;
    const stopping = signals === 1 ? loop.stop() : loop.forceStop();
    void stopping
      .then(() => exit(0))
      .catch(() => {
        report("Worker shutdown failed after requeue attempt");
        exit(0);
      });
  };
  source.on("SIGINT", handle);
  source.on("SIGTERM", handle);
  return () => {
    source.off("SIGINT", handle);
    source.off("SIGTERM", handle);
  };
}

let startupSecrets: Secrets | undefined;
export async function reportStartupFailure(error: unknown, secrets?: Secrets) {
  const safe =
    secrets ?? (await loadSecrets({ ...process.env, WORKER_ENV_FILES: "" }));
  console.error(
    safe.redact(
      `Worker startup failed: ${error instanceof Error ? error.message : String(error)}`,
    ),
  );
}

async function main() {
  const secrets = await loadSecrets();
  startupSecrets = secrets;
  const report = (line: string) => console.error(secrets.redact(line));
  await mkdir(workerTempDir(), { recursive: true });
  const url = secrets.values.SUPABASE_URL;
  const key = secrets.values.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key)
    throw new Error("SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required");
  const workerId =
    secrets.values.WORKER_ID ?? `worker-${process.env.COMPUTERNAME ?? "pc"}`;
  const db = new SupabaseDb(url, key, secrets.values.WORKER_OWNER_ID);
  const client = createClient(url, key);
  const engine = new Engine({
    validateEntries: (entries, providers) =>
      validateEngineEntries(client, entries, providers),
    log: async (line) => console.log(secrets.redact(line)),
    secrets,
    report,
  });
  const balanceAbort = new AbortController();
  const stopBalance =
    process.env.WORKER_FAKE === "1"
      ? async () => {}
      : startBalanceRefresh(() =>
          refreshBalance({
            engine: engine.withWorkspace(
              workerRuntimeRoot(),
              async (line) => report(line),
              balanceAbort.signal,
            ),
            ws: { root: workerRuntimeRoot() },
            db,
            secrets,
            signal: balanceAbort.signal,
            log: async (line) => report(line),
          }),
        );
  const supervisor = createComfySupervisor({ secrets, report });
  const comfy: LocalRuntime = {
    supervisor,
    outputDir: comfyOutputDir(COMFY_CONFIG),
    inputDir: comfyInputDir(COMFY_CONFIG),
    freeVramMb: nvidiaFreeVramMb,
  };
  const stopLocal =
    process.env.WORKER_FAKE === "1"
      ? async () => {}
      : await startLocalEngines({
          supervisor,
          publish: () => publishEngines(db, workerId),
          report,
        });
  const loop = new WorkerLoop({
    db,
    workerId,
    stages,
    fakeStages,
    songless: songlessStages,
    fakeSongless,
    workspace: new WorkspaceFactory(),
    engine,
    storage: new SupabaseStorage(client),
    secrets,
    groqLedger: () => serviceLedger(client, null, "groq", ""),
    kieLedger: () => serviceLedger(client, null, "kie", ""),
    report,
    comfy,
  });
  const stopScheduler = startScheduler(client, workerId);
  const removeSignals = installSignals(
    {
      stop: async () => {
        stopScheduler();
        balanceAbort.abort();
        await Promise.all([loop.stop(), stopBalance()]);
        await stopLocal();
      },
      forceStop: async () => {
        stopScheduler();
        balanceAbort.abort();
        await Promise.all([loop.forceStop(), stopBalance()]);
        await stopLocal();
      },
    },
    process,
    (code) => process.exit(code),
    report,
  );
  try {
    await loop.runForever();
  } finally {
    stopScheduler();
    balanceAbort.abort();
    await stopBalance();
    await stopLocal();
    removeSignals();
  }
}
if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  void main().catch(async (error: unknown) => {
    await reportStartupFailure(error, startupSecrets);
    process.exitCode = 1;
  });
}
