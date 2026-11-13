import { existsSync } from "node:fs";
import { join } from "node:path";
import { runStack } from "../../stack.js";
import type { StackEnv } from "../envs.js";
import { stopWriters } from "../recovery.js";
import { realRunner } from "../run.js";
import { runtimeRoot } from "../runtime.js";
import { nativeDatabase } from "./backup.js";
import { postgresService } from "./postgres.js";
import { waitFor } from "./processes.js";

/** Keep all writers and network APIs stopped while dumping or restoring. */
export async function maintenanceDatabase(env: StackEnv) {
  if (env === "prod" && existsSync(join(runtimeRoot(), "deploy")))
    await stopWriters(realRunner);
  await runStack("stop", env, { runtime: "native" });
  const db = await nativeDatabase(env);
  const service = postgresService(db.layout, db.tools);
  const child = await service.start();
  if (!(await waitFor(() => service.ready(), 30_000, 250, child.exited))) {
    const failure =
      child.failure?.("failed maintenance readiness") ??
      new Error("Maintenance PostgreSQL readiness failed");
    await child.stop();
    throw failure;
  }
  return { db, stop: () => child.stop() };
}
