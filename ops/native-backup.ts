import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { ENV_TABLE, type StackEnv } from "./lib/envs.js";
import {
  backupNative,
  readBackup,
  restoreNativeData,
} from "./lib/native/backup.js";
import { safeFailure } from "./lib/native/diagnostics.js";
import {
  assertNoMaintenance,
  clearJournal,
  readJournal,
  saveJournal,
} from "./lib/native/journal.js";
import { nativeLayout, resolveRuntime } from "./lib/native/layout.js";
import { withStackLease } from "./lib/native/lease.js";
import { maintenanceDatabase } from "./lib/native/maintenance.js";
import { writePrivate } from "./lib/private-file.js";
import { runStack } from "./stack.js";

export async function nativeBackup(
  args: string[],
  checkpoint: (step: string) => Promise<void> = async () => {},
) {
  const [action, flag, target, path, confirm] = args;
  if (
    !action ||
    !["backup", "restore", "recover-import"].includes(action) ||
    flag !== "--env" ||
    !target ||
    !Object.hasOwn(ENV_TABLE, target) ||
    !path ||
    args.length > 5 ||
    (confirm && confirm !== "--confirm-production")
  )
    throw new Error(
      "Usage: native-backup.ts <backup|restore|recover-import> --env <env> <directory> [--confirm-production]",
    );
  const env = target as StackEnv;
  if (resolveRuntime(undefined) !== "native")
    throw new Error("Native backup requires native runtime");
  if (
    env === "prod" &&
    action !== "backup" &&
    confirm !== "--confirm-production"
  )
    throw new Error("Production restore requires --confirm-production");
  const layout = nativeLayout(env);
  return withStackLease(env, action, async () => {
    let maintenance:
      | Awaited<ReturnType<typeof maintenanceDatabase>>
      | undefined;
    let before: string | undefined;
    try {
      if (action !== "recover-import") assertNoMaintenance(layout);
      if (action === "restore") readBackup(path);
      let recoveryPhase: string | undefined;
      if (action === "recover-import") {
        const journal =
          readJournal(layout) ??
          JSON.parse(
            readFileSync(join(layout.root, "import-journal.json"), "utf8"),
          );
        if (
          resolve(journal.backup) !== resolve(path) ||
          !["preparing", "applying", "prepared"].includes(journal.phase)
        )
          throw new Error("Backup does not match interrupted import journal");
        recoveryPhase = journal.phase;
        if (recoveryPhase !== "preparing") readBackup(path);
      }
      if (action === "restore") {
        before = join(layout.root, `before-restore-${Date.now()}`);
        await saveJournal(layout, {
          format: 1,
          operation: "restore",
          phase: "preparing",
          backup: before,
        });
      }
      maintenance = await maintenanceDatabase(env);
      if (action === "backup")
        await backupNative(env, path, undefined, checkpoint);
      else {
        if (action === "restore") {
          await backupNative(env, before as string, undefined, checkpoint);
          await saveJournal(layout, {
            format: 1,
            operation: "restore",
            phase: "applying",
            backup: before as string,
          });
        }
        if (recoveryPhase !== "preparing")
          await restoreNativeData(env, path, checkpoint);
        if (action === "recover-import")
          await writePrivate(
            join(layout.root, "import-journal.json"),
            JSON.stringify({ phase: "rolled-back", backup: path }),
          );
        clearJournal(layout);
      }
      await maintenance.stop();
      maintenance = undefined;
      // Recover leaves the exact pre-import database stopped, without startup seed changes.
      if (action !== "recover-import")
        await runStack("start", env, { runtime: "native" });
      console.log(
        `Native ${action} verified: ${path}. Application writers remain stopped.`,
      );
    } catch (error) {
      if (before && existsSync(join(before, "manifest.json"))) {
        if (maintenance) await maintenance.stop();
        maintenance = await maintenanceDatabase(env);
        await restoreNativeData(env, before);
        clearJournal(layout);
        console.error(
          "Restore failed; previous data restored and stack left stopped.",
        );
      }
      throw error;
    } finally {
      if (maintenance) await maintenance.stop();
    }
  });
}
if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
)
  nativeBackup(process.argv.slice(2)).catch((error: unknown) => {
    console.error(
      "Native backup/restore failed; verify backup integrity and maintenance prerequisites. Private output withheld.",
    );
    console.error(safeFailure(error));
    process.exitCode = 1;
  });
