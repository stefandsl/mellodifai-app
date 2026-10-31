import { SupabaseDb } from "./db.js";
import { Engine } from "./engine.js";
import { type StageRegistry, WorkerLoop } from "./loop.js";
import { loadSecrets } from "./secrets.js";
import { noStorage } from "./storage.js";
import { WorkspaceFactory } from "./workspace.js";

const stages: StageRegistry = {};
async function main() {
  const secrets = await loadSecrets();
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
    }),
    storage: noStorage,
    secrets,
  });
  process.once("SIGINT", () => loop.stop());
  await loop.runForever();
}
void main();
