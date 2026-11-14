import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { ENV_TABLE, type StackEnv } from "./lib/envs.js";
import { backupNative } from "./lib/native/backup.js";
import { safeFailure } from "./lib/native/diagnostics.js";
import { dataTables, parseDump } from "./lib/native/import-data.js";
import {
  assertNoMaintenance,
  preparing,
  saveJournal,
} from "./lib/native/journal.js";
import { nativeLayout } from "./lib/native/layout.js";
import { withStackLease } from "./lib/native/lease.js";
import { maintenanceDatabase } from "./lib/native/maintenance.js";

/** Explicit removal of bootstrap seeds, never an escape hatch for user data. */
export function assertBootstrapSeeds(counts: Record<string, number>): void {
  const allowed: Record<string, number> = {
    "public.app_flags": 5,
    "public.oauth_pairing": 1,
    "public.price_book": 14,
    "public.provider_operations": 21,
    "public.scheduled_tasks": 5,
    "public.spend_caps": 6,
    "public.stack_settings": 1,
    "storage.buckets": 2,
  };
  for (const [name, count] of Object.entries(counts))
    if (count !== (allowed[name] ?? 0))
      throw new Error(`Not a fresh bootstrap: ${name}`);
  for (const name of Object.keys(allowed))
    if (counts[name] !== allowed[name])
      throw new Error(`Missing bootstrap seed: ${name}`);
}
export async function prepareImport(
  args: string[],
  checkpoint: (step: string) => Promise<void> = async () => {},
) {
  const [flag, env, backup, apply, confirm] = args;
  if (
    flag !== "--env" ||
    !env ||
    !Object.hasOwn(ENV_TABLE, env) ||
    !backup ||
    apply !== "--apply" ||
    args.length > 5 ||
    (confirm && confirm !== "--confirm-production")
  )
    throw new Error(
      "Usage: native-prepare-import.ts --env <env> <backup-directory> --apply [--confirm-production]",
    );
  if (env === "prod" && confirm !== "--confirm-production")
    throw new Error("Production preparation requires --confirm-production");
  return withStackLease(env as StackEnv, "prepare-import", async () => {
    const layout = nativeLayout(env as StackEnv);
    assertNoMaintenance(layout);
    const maintenance = await maintenanceDatabase(env as StackEnv);
    const db = maintenance.db;
    try {
      const inspect = async () => {
        const dump = parseDump(await db.dump());
        assertBootstrapSeeds(
          Object.fromEntries(
            dataTables(dump).map((table) => [table.name, table.lines.length]),
          ),
        );
        return dump;
      };
      // Every refusal before the truncate leaves no journal behind.
      await inspect();
      const dump = await preparing(
        layout,
        { format: 1, operation: "prepare-import", backup },
        async () => {
          await backupNative(env as StackEnv, backup);
          return inspect();
        },
      );
      await saveJournal(layout, {
        format: 1,
        operation: "prepare-import",
        phase: "applying",
        backup,
      });
      await checkpoint("before-truncate");
      await db.execute(
        `SET LOCAL session_replication_role=replica; TRUNCATE ${dataTables(dump)
          .map((table) => table.name)
          .join(", ")};`,
      );
      await saveJournal(layout, {
        format: 1,
        operation: "prepare-import",
        phase: "prepared",
        backup,
      });
      console.log(
        "Bootstrap seeds cleared after backup. Run native-import immediately, before restarting the stack. No user data was accepted.",
      );
    } finally {
      await maintenance.stop();
    }
  });
}
if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
)
  prepareImport(process.argv.slice(2)).catch((error: unknown) => {
    console.error(
      "Bootstrap preparation refused or failed; verify the empty stack and backup prerequisites.",
    );
    console.error(safeFailure(error));
    process.exitCode = 1;
  });
