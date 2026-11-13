import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { ENV_TABLE, type StackEnv } from "./lib/envs.js";
import {
  backupNative,
  readBackup,
  restoreNativeData,
} from "./lib/native/backup.js";
import { nativeLayout, resolveRuntime } from "./lib/native/layout.js";
import { maintenanceDatabase } from "./lib/native/maintenance.js";
import { acquireLock } from "./lib/native/processes.js";
import { writePrivate } from "./lib/private-file.js";
import { runStack } from "./stack.js";

export async function nativeBackup(args: string[]) {
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
  const release = await acquireLock(join(layout.root, "import.lock"));
  let maintenance: Awaited<ReturnType<typeof maintenanceDatabase>> | undefined;
  let before: string | undefined;
  try {
    if (action !== "backup") readBackup(path);
    if (action === "recover-import") {
      const journal = JSON.parse(
        readFileSync(join(layout.root, "import-journal.json"), "utf8"),
      );
      if (
        resolve(journal.backup) !== resolve(path) ||
        journal.phase !== "applying"
      )
        throw new Error("Backup does not match interrupted import journal");
    }
    maintenance = await maintenanceDatabase(env);
    if (action === "backup") await backupNative(env, path);
    else {
      if (action === "restore") {
        before = join(layout.root, `before-restore-${Date.now()}`);
        await backupNative(env, before);
      }
      await restoreNativeData(env, path);
      if (action === "recover-import")
        await writePrivate(
          join(layout.root, "import-journal.json"),
          JSON.stringify({ phase: "rolled-back", backup: path }),
        );
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
      console.error(
        "Restore failed; previous data restored and stack left stopped.",
      );
    }
    throw error;
  } finally {
    if (maintenance) await maintenance.stop();
    release();
  }
}
if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
)
  nativeBackup(process.argv.slice(2)).catch(() => {
    console.error(
      "Native backup/restore failed; verify backup integrity and maintenance prerequisites. Private output withheld.",
    );
    process.exitCode = 1;
  });
