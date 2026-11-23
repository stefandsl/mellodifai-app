import { fork } from "node:child_process";
import { randomUUID } from "node:crypto";
import { existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, it } from "vitest";
import { nativeDatabase } from "../../lib/native/backup.js";
import { nativeLayout } from "../../lib/native/layout.js";
import { withMaintenance } from "../../lib/native/maintenance.js";
import { typescriptArgs } from "../../lib/native/plan.js";
import { setAttributeSync } from "../../native/storage/fs-xattr/index.js";
import { nativeBackup } from "../../native-backup.js";
import { runStack } from "../../stack.js";
import { assertNativeTestRoot } from "./integration-env.js";

it.skipIf(process.env.MDF_NATIVE_INTEGRATION !== "1")(
  "refuses startup after real process death at each restore boundary",
  async () => {
    assertNativeTestRoot();
    const layout = nativeLayout("e2e");
    const backup = join(layout.root, `run8-source-${randomUUID()}`);
    const table = `public.crash_${randomUUID().replaceAll("-", "")}`;
    const object = join(layout.objects, `crash-${randomUUID()}.txt`);
    const journal = join(layout.root, "maintenance-journal.json");
    // The backup each interrupted restore takes of the lab before it starts.
    const safetyBackups: string[] = [];
    const pendingSafetyBackup = () => {
      const before = JSON.parse(readFileSync(journal, "utf8")).backup as string;
      if (
        resolve(dirname(before)) !== resolve(layout.root) ||
        !basename(before).startsWith("before-restore-")
      )
        throw new Error("Unexpected restore safety backup location");
      if (!safetyBackups.includes(before)) safetyBackups.push(before);
      return before;
    };
    // The lab is shared with the database and browser suites. From the first
    // write on, a failure at any step must leave no table, object or backup:
    // a leftover public table fails the database ACL test of the next run.
    try {
      await runStack("start", "e2e", { runtime: "native" });
      const db = await nativeDatabase("e2e");
      await db.execute(
        `create table ${table}(value integer); insert into ${table} values (1);`,
      );
      writeFileSync(object, "snapshot-one");
      setAttributeSync(object, "user.supabase.content-type", "text/plain");
      setAttributeSync(object, "user.supabase.cache-control", "0");
      await nativeBackup(["backup", "--env", "e2e", backup]);
      await db.execute(`update ${table} set value=2;`);
      writeFileSync(object, "snapshot-two");
      setAttributeSync(object, "user.supabase.content-type", "text/plain");
      setAttributeSync(object, "user.supabase.cache-control", "0");
      for (const boundary of [
        "during-backup",
        "database-committed",
        "between-renames",
      ]) {
        const entry = fileURLToPath(
          new URL("./fixtures/maintenance-child.ts", import.meta.url),
        );
        const child = fork(
          entry,
          ["restore", boundary, "restore", "--env", "e2e", backup],
          {
            execArgv: typescriptArgs(entry).slice(0, -1),
            stdio: ["ignore", "ignore", "ignore", "ipc"],
            windowsHide: true,
          },
        );
        try {
          await new Promise<void>((resolve, reject) => {
            const timer = setTimeout(
              () => reject(new Error(`No crash boundary: ${boundary}`)),
              120_000,
            );
            child.once("message", (value) => {
              clearTimeout(timer);
              if ((value as { error?: string }).error)
                return reject(new Error((value as { error: string }).error));
              if (
                (value as { step?: string }).step !== boundary ||
                (value as { pid?: number }).pid !== child.pid
              )
                return reject(new Error("Incorrect restore crash checkpoint"));
              resolve();
            });
            child.once("exit", () => {
              clearTimeout(timer);
              reject(new Error("Child exited before boundary"));
            });
          });
          const exited = new Promise<void>((resolve) =>
            child.once("exit", () => resolve()),
          );
          child.kill("SIGKILL");
          await exited;
          await expect(
            runStack("start", "e2e", { runtime: "native" }),
          ).rejects.toThrow(/maintenance.*recover/i);
          expect(existsSync(journal)).toBe(true);
          const before = pendingSafetyBackup();
          await nativeBackup(["recover-import", "--env", "e2e", before]);
          expect(existsSync(journal)).toBe(false);
          await withMaintenance("e2e", "verify", async (db) => {
            expect(
              (await db.execute(`select value from ${table}`)).trim(),
            ).toBe("2");
            expect(readFileSync(object, "utf8")).toBe("snapshot-two");
          });
        } finally {
          // After a failure the child may still hold the stack lease: wait
          // for its death before anything else takes the lease.
          if (child.exitCode === null && child.signalCode === null) {
            const exited = new Promise<void>((resolve) =>
              child.once("exit", () => resolve()),
            );
            child.kill("SIGKILL");
            await exited;
          }
          await runStack("stop", "e2e", { runtime: "native" });
        }
      }
    } finally {
      // A failure between a kill and its recovery leaves the restore journal.
      // Recover it before the cleanup: start refuses a lab with a pending
      // journal, and its safety backup still expects the table dropped below.
      if (existsSync(journal))
        await nativeBackup([
          "recover-import",
          "--env",
          "e2e",
          pendingSafetyBackup(),
        ]);
      await withMaintenance("e2e", "cleanup", async (db) => {
        await db.execute(`drop table if exists ${table};`);
        rmSync(object, { force: true });
      });
      for (const directory of [backup, ...safetyBackups])
        rmSync(directory, { recursive: true, force: true });
    }
  },
  600_000,
);
