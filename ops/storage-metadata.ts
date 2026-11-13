import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parse } from "yaml";
import { ENV_TABLE, type StackEnv } from "./lib/envs.js";
import { nativeLayout } from "./lib/native/layout.js";
import { roleConnection } from "./lib/native/postgres.js";
import {
  rebuildStorageMetadata,
  type StorageRow,
  storageFileLayout,
} from "./lib/native/storage-metadata.js";
import { loadStackSecrets } from "./lib/stack-secrets.js";

export function metadataArguments(args: string[]): {
  env: StackEnv;
  apply: boolean;
} {
  let env: string | undefined;
  let mode: string | undefined;
  for (let index = 0; index < args.length; index++) {
    const arg = args[index];
    if (arg === "--env" && env === undefined) env = args[++index];
    else if ((arg === "--check" || arg === "--apply") && mode === undefined)
      mode = arg;
    else
      throw new Error(
        "Usage: storage-metadata.ts --env <env> [--check|--apply]",
      );
  }
  if (!env || !Object.hasOwn(ENV_TABLE, env))
    throw new Error("A valid --env is required");
  return { env: env as StackEnv, apply: mode === "--apply" };
}

export async function storageMetadata(args: string[]): Promise<void> {
  const { env, apply } = metadataArguments(args);
  const layout = nativeLayout(env);
  // Native plan preserves these upstream environment values. Read the source
  // directly: rendering the Compose contract would write staged templates.
  const source = parse(
    readFileSync(new URL("./compose/base.yml", import.meta.url), "utf8"),
  ) as { services: { storage: { environment: Record<string, string> } } };
  const files = storageFileLayout(
    layout.objects,
    source.services.storage.environment,
  );
  const secrets = await loadStackSecrets(env);
  const sql = roleConnection(layout, "postgres", secrets.postgres);
  try {
    const rows =
      await sql`select bucket_id, name, version, metadata from storage.objects order by bucket_id, name`;
    const report = rebuildStorageMetadata(
      files,
      rows as unknown as StorageRow[],
      apply,
    );
    process.stdout.write(
      `${JSON.stringify({ mode: apply ? "apply" : "check", ...report }, null, 2)}\n`,
    );
    if (
      report.missingFiles.length ||
      report.orphanFiles.length ||
      report.sizeMismatches.length ||
      report.invalidMetadata.length ||
      (!apply && report.attributeMismatches.length)
    )
      process.exitCode = 1;
  } finally {
    await sql.end();
  }
}
if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
)
  storageMetadata(process.argv.slice(2)).catch(() => {
    // Connection errors can embed credentials. Never print their text.
    process.stderr.write(
      "Storage metadata operation failed; check arguments, database readiness and filesystem access.\n",
    );
    process.exitCode = 1;
  });
