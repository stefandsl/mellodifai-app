import { fork } from "node:child_process";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, it } from "vitest";
import { nativeDatabase } from "../../lib/native/backup.js";
import { nativeLayout } from "../../lib/native/layout.js";
import { typescriptArgs } from "../../lib/native/plan.js";
import { realRunner } from "../../lib/run.js";
import { nativeBackup } from "../../native-backup.js";
import { prepareImport } from "../../native-prepare-import.js";
import { runStack } from "../../stack.js";

it.skipIf(process.env.MDF_NATIVE_PROD_LEASE_TESTS !== "1")(
  "blocks a concurrent stop during import and real logon during restore",
  async () => {
    const root = "E:/mellodifai/native-lab-prod";
    if (
      process.env.MELLODIFAI_ROOT !== root ||
      process.env.MDF_NATIVE_REHEARSAL_PORT_BASE !== "46300"
    )
      throw new Error("Requires production rehearsal lab");
    const layout = nativeLayout("prod");
    for (const action of ["import", "restore"]) {
      await nativeBackup([
        "restore",
        "--env",
        "prod",
        join(root, "bootstrap-backup"),
        "--confirm-production",
      ]);
      if (action === "import")
        await prepareImport([
          "--env",
          "prod",
          join(layout.root, `lease-prepare-${randomUUID()}`),
          "--apply",
          "--confirm-production",
        ]);
      const args =
        action === "import"
          ? [
              "--from",
              "E:/mellodifai/recovery/20261113",
              "--env",
              "prod",
              "--apply",
              "--replace-empty-only",
              "--confirm-production",
            ]
          : [
              "restore",
              "--env",
              "prod",
              join(root, "bootstrap-backup"),
              "--confirm-production",
            ];
      const entry = fileURLToPath(
        new URL("./fixtures/maintenance-child.ts", import.meta.url),
      );
      const child = fork(entry, [action, "during-backup", ...args], {
        execArgv: typescriptArgs(entry).slice(0, -1),
        stdio: ["ignore", "ignore", "ignore", "ipc"],
        windowsHide: true,
      });
      try {
        await new Promise<void>((resolve, reject) => {
          const timer = setTimeout(
            () => reject(new Error("Maintenance checkpoint timeout")),
            180_000,
          );
          child.once("message", (value) => {
            clearTimeout(timer);
            const error = (value as { error?: string }).error;
            if (error) reject(new Error(error));
            else resolve();
          });
          child.once("exit", () => {
            clearTimeout(timer);
            reject(new Error("Maintenance exited before checkpoint"));
          });
        });
        if (action === "import") {
          const reply = await realRunner(
            process.execPath,
            typescriptArgs(
              fileURLToPath(new URL("../../stack.ts", import.meta.url)),
            ).concat(["stop", "--env", "prod", "--runtime", "native"]),
          );
          expect(reply.code).toBe(1);
          expect(reply.stderr).toMatch(/lease held by import \(pid \d+\)/);
        } else {
          const reply = await realRunner("powershell.exe", [
            "-NoProfile",
            "-NonInteractive",
            "-ExecutionPolicy",
            "Bypass",
            "-File",
            fileURLToPath(new URL("../../logon.ps1", import.meta.url)),
            "-Action",
            "run",
            "-Root",
            root,
            "-Attempts",
            "1",
            "-RetrySeconds",
            "0",
          ]);
          expect(reply.code).toBe(1);
          expect(
            readFileSync(join(root, "logs/logon.log"), "utf8").slice(-3000),
          ).toMatch(/lease held by restore \(pid \d+\)/);
        }
        expect(
          (await (await nativeDatabase("prod")).execute("select 1")).trim(),
        ).toBe("1");
      } finally {
        const exited = new Promise<void>((resolve) =>
          child.once("exit", () => resolve()),
        );
        child.kill("SIGKILL");
        await exited;
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
        await runStack("stop", "prod", { runtime: "native" });
      }
    }
  },
  600_000,
);
