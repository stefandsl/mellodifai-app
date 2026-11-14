import { fork } from "node:child_process";
import { randomUUID } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, it } from "vitest";
import { nativeLayout } from "../../lib/native/layout.js";
import { typescriptArgs } from "../../lib/native/plan.js";
import { loadStackSecrets } from "../../lib/stack-secrets.js";
import { nativeBackup } from "../../native-backup.js";
import { runStack } from "../../stack.js";

it.skipIf(process.env.MDF_NATIVE_PREPARE_RACE !== "1")(
  "cannot accept an API writer between seed inspection and truncate",
  async () => {
    if (process.env.MELLODIFAI_ROOT !== "E:/mellodifai/native-lab-prod")
      throw new Error("Requires production rehearsal lab");
    const layout = nativeLayout("prod");
    await nativeBackup([
      "restore",
      "--env",
      "prod",
      "E:/mellodifai/native-lab-prod/bootstrap-backup",
      "--confirm-production",
    ]);
    const backup = join(layout.root, `prepare-race-${randomUUID()}`);
    const entry = fileURLToPath(
      new URL("./fixtures/maintenance-child.ts", import.meta.url),
    );
    const child = fork(
      entry,
      [
        "prepare",
        "before-truncate",
        "--env",
        "prod",
        backup,
        "--apply",
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
          () => reject(new Error("Preparation checkpoint timeout")),
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
          reject(new Error("Preparation exited before checkpoint"));
        });
      });
      const secrets = await loadStackSecrets("prod");
      let accepted = false;
      try {
        const response = await fetch(
          `http://127.0.0.1:${layout.ports.api}/auth/v1/admin/users`,
          {
            method: "POST",
            headers: {
              apikey: secrets.service,
              Authorization: `Bearer ${secrets.service}`,
              "content-type": "application/json",
            },
            body: JSON.stringify({
              email: `run8-${randomUUID()}@example.test`,
              password: randomUUID(),
              email_confirm: true,
            }),
            signal: AbortSignal.timeout(5000),
          },
        );
        accepted = response.ok;
        await response.body?.cancel();
      } catch {
        /* Expected: no API listener in maintenance. */
      }
      const finished = new Promise<void>((resolve) =>
        child.once("exit", () => resolve()),
      );
      child.send("continue");
      await finished;
      expect(
        accepted,
        "API accepted a new user just before preparation truncated it",
      ).toBe(false);
    } finally {
      if (child.exitCode === null && child.signalCode === null)
        child.kill("SIGKILL");
      const journal = join(layout.root, "maintenance-journal.json");
      if (existsSync(journal))
        await nativeBackup([
          "recover-import",
          "--env",
          "prod",
          JSON.parse(readFileSync(journal, "utf8")).backup,
          "--confirm-production",
        ]);
      await runStack("stop", "prod", { runtime: "native" });
    }
  },
  600_000,
);
