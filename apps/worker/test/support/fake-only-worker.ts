// A worker for integration tests of test-mode tokens. It has no real stage at all: a job only
// finds a handler when the database marked it fake_providers (the work of a test-mode token),
// so a job that would reach a paid provider fails here instead. WORKER_FAKE stays unset, which
// is the point: the routing must come from the job, not from the process.
import { createClient } from "@supabase/supabase-js";
import { SupabaseDb } from "../../src/db.js";
import { Engine } from "../../src/engine.js";
import { fakeStages } from "../../src/fake/index.js";
import { fakeSongless } from "../../src/fake/lyrics-assist.js";
import { WorkerLoop } from "../../src/loop.js";
import { loadSecrets } from "../../src/secrets.js";
import { SupabaseStorage } from "../../src/storage.js";
import { WorkspaceFactory } from "../../src/workspace.js";

if (process.env.WORKER_FAKE === "1")
  throw new Error("WORKER_FAKE must stay unset for the fake-only worker");
const url = process.env.SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
const workerId = process.env.WORKER_ID;
const ownerId = process.env.WORKER_OWNER_ID;
if (!url || !key || !workerId || !ownerId)
  throw new Error(
    "SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, WORKER_ID and WORKER_OWNER_ID are required",
  );
const secrets = await loadSecrets({ ...process.env, WORKER_ENV_FILES: "" });
const loop = new WorkerLoop({
  db: new SupabaseDb(url, key, ownerId),
  workerId,
  stages: {},
  songless: {},
  fakeStages,
  fakeSongless,
  workspace: new WorkspaceFactory(),
  engine: new Engine({ log: async () => {}, secrets }),
  storage: new SupabaseStorage(createClient(url, key)),
  secrets,
  report: (line) => console.error(secrets.redact(line)),
});
for (const signal of ["SIGINT", "SIGTERM"] as const)
  process.on(signal, () => void loop.stop());
await loop.runForever();
