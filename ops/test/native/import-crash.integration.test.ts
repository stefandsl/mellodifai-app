import { fork } from "node:child_process";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, it } from "vitest";
import { nativeDatabase } from "../../lib/native/backup.js";
import { assertEmptyTarget, parseDump } from "../../lib/native/import-data.js";
import { nativeLayout } from "../../lib/native/layout.js";
import { maintenanceDatabase } from "../../lib/native/maintenance.js";
import { typescriptArgs } from "../../lib/native/plan.js";
import { nativeBackup } from "../../native-backup.js";
import { prepareImport } from "../../native-prepare-import.js";
import { runStack } from "../../stack.js";

it.skipIf(process.env.MDF_NATIVE_IMPORT_CRASH_TESTS !== "1")(
  "blocks ordinary startup after killed recovery imports and restores the empty target",
  async () => {
    if (
      process.env.MELLODIFAI_ROOT !== "E:/mellodifai/native-lab-prod" ||
      process.env.MDF_NATIVE_REHEARSAL_PORT_BASE !== "46300"
    )
      throw new Error(
        "Import crash tests require the production rehearsal lab",
      );
    const layout = nativeLayout("prod");
    await runStack("start", "prod", { runtime: "native" });
    const db = await nativeDatabase("prod");
    try {
      assertEmptyTarget(parseDump(await db.dump()));
    } catch {
      await prepareImport([
        "--env",
        "prod",
        join(layout.root, `crash-bootstrap-${randomUUID()}`),
        "--apply",
        "--confirm-production",
      ]);
    }
    for (const boundary of [
      "during-backup",
      "database-committed",
      "between-renames",
    ]) {
      // The original importer preflight needs a running DB; the new maintenance path also accepts a stopped one.
      const maintenance = await maintenanceDatabase("prod");
      const entry = fileURLToPath(
        new URL("./fixtures/maintenance-child.ts", import.meta.url),
      );
      const child = fork(
        entry,
        [
          "import",
          boundary,
          "--from",
          "E:/mellodifai/recovery/20261113",
          "--env",
          "prod",
          "--apply",
          "--replace-empty-only",
          "--confirm-production",
        ],
        {
          execArgv: typescriptArgs(entry).slice(0, -1),
          stdio: ["ignore", "ignore", "ignore", "ipc"],
          windowsHide: true,
        },
      );
      try {
        await new Promise<void>((resolve, reject) => {
          const timer = setTimeout(
            () => reject(new Error(`No import crash boundary: ${boundary}`)),
            180_000,
          );
          child.once("message", () => {
            clearTimeout(timer);
            resolve();
          });
          child.once("exit", () => {
            clearTimeout(timer);
            reject(new Error("Import child exited before checkpoint"));
          });
        });
        const exited = new Promise<void>((resolve) =>
          child.once("exit", () => resolve()),
        );
        child.kill("SIGKILL");
        await exited;
        await expect(
          runStack("start", "prod", { runtime: "native" }),
        ).rejects.toThrow(/maintenance.*recover/i);
        const journal = JSON.parse(
          readFileSync(join(layout.root, "maintenance-journal.json"), "utf8"),
        );
        await nativeBackup([
          "recover-import",
          "--env",
          "prod",
          journal.backup,
          "--confirm-production",
        ]);
        const verify = await maintenanceDatabase("prod");
        try {
          assertEmptyTarget(parseDump(await verify.db.dump()));
        } finally {
          await verify.stop();
        }
      } finally {
        child.kill("SIGKILL");
        await maintenance.stop();
        await runStack("stop", "prod", { runtime: "native" });
      }
    }
  },
  900_000,
);
