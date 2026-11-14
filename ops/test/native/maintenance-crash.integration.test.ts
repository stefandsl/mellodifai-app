import { fork } from "node:child_process";
import { randomUUID } from "node:crypto";
import { existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, it } from "vitest";
import { nativeDatabase } from "../../lib/native/backup.js";
import { nativeLayout } from "../../lib/native/layout.js";
import { maintenanceDatabase } from "../../lib/native/maintenance.js";
import { typescriptArgs } from "../../lib/native/plan.js";
import { setAttributeSync } from "../../native/storage/fs-xattr/index.js";
import { nativeBackup } from "../../native-backup.js";
import { runStack } from "../../stack.js";

it.skipIf(process.env.MDF_NATIVE_CRASH_TESTS !== "1")(
  "refuses startup after real process death at each restore boundary",
  async () => {
    if (
      process.env.MELLODIFAI_ROOT?.replaceAll("\\", "/") !==
      "E:/mellodifai/native-lab"
    )
      throw new Error("Crash tests require the isolated e2e lab");
    const layout = nativeLayout("e2e");
    const backup = join(layout.root, `run8-source-${randomUUID()}`);
    await runStack("start", "e2e", { runtime: "native" });
    const db = await nativeDatabase("e2e");
    const table = `public.crash_${randomUUID().replaceAll("-", "")}`;
    const object = join(layout.objects, `crash-${randomUUID()}.txt`);
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
    try {
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
          const journal = join(layout.root, "maintenance-journal.json");
          expect(existsSync(journal)).toBe(true);
          const before = JSON.parse(readFileSync(journal, "utf8"))
            .backup as string;
          await nativeBackup(["recover-import", "--env", "e2e", before]);
          expect(existsSync(journal)).toBe(false);
          const maintenance = await maintenanceDatabase("e2e");
          try {
            expect(
              (
                await maintenance.db.execute(`select value from ${table}`)
              ).trim(),
            ).toBe("2");
            expect(readFileSync(object, "utf8")).toBe("snapshot-two");
          } finally {
            await maintenance.stop();
          }
        } finally {
          if (child.exitCode === null) child.kill("SIGKILL");
          await runStack("stop", "e2e", { runtime: "native" });
        }
      }
    } finally {
      const maintenance = await maintenanceDatabase("e2e");
      try {
        await maintenance.db.execute(`drop table ${table};`);
        rmSync(object, { force: true });
      } finally {
        await maintenance.stop();
      }
    }
  },
  600_000,
);
