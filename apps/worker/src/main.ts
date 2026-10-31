import { mkdir } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import { SupabaseDb } from "./db.js";
import { Engine } from "./engine.js";
import { type StageRegistry, WorkerLoop } from "./loop.js";
import { loadSecrets } from "./secrets.js";
import { noStorage } from "./storage.js";
import { WorkspaceFactory } from "./workspace.js";

const stages: StageRegistry = {};
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

async function main() {
  const secrets = await loadSecrets();
  const report = (line: string) => console.error(secrets.redact(line));
  await mkdir("E:\\mellodifai\\tmp", { recursive: true });
  const url = secrets.values.SUPABASE_URL;
  const key = secrets.values.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key)
    throw new Error("SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required");
  const workerId =
    secrets.values.WORKER_ID ?? `worker-${process.env.COMPUTERNAME ?? "pc"}`;
  const db = new SupabaseDb(url, key, secrets.values.WORKER_OWNER_ID);
  const loop = new WorkerLoop({
    db,
    workerId,
    stages,
    workspace: new WorkspaceFactory(),
    engine: new Engine({
      log: async (line) => console.log(secrets.redact(line)),
      env: { ...secrets.values },
      report,
    }),
    storage: noStorage,
    secrets,
    report,
  });
  const removeSignals = installSignals(
    loop,
    process,
    (code) => process.exit(code),
    report,
  );
  try {
    await loop.runForever();
  } finally {
    removeSignals();
  }
}
if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  void main().catch(() => {
    console.error("Worker startup failed; check configuration and local paths");
    process.exitCode = 1;
  });
}
