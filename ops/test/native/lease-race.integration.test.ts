import { fork } from "node:child_process";
import { randomUUID } from "node:crypto";
import { existsSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, it } from "vitest";
import { nativeLayout } from "../../lib/native/layout.js";
import { typescriptArgs } from "../../lib/native/plan.js";
import { nativeStatus } from "../../lib/native/stack.js";
import { runStack } from "../../stack.js";
import { assertNativeTestRoot } from "./integration-env.js";

it.skipIf(
  process.env.MDF_NATIVE_LEASE_TESTS !== "1" &&
    process.env.MDF_NATIVE_INTEGRATION !== "1",
)(
  "start cannot stop a live backup postmaster",
  async () => {
    assertNativeTestRoot();
    const layout = nativeLayout("e2e");
    const entry = fileURLToPath(
      new URL("./fixtures/maintenance-child.ts", import.meta.url),
    );
    const child = fork(
      entry,
      [
        "backup",
        "during-backup",
        "backup",
        "--env",
        "e2e",
        join(layout.root, `race-${randomUUID()}`),
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
          () => reject(new Error("Backup checkpoint timeout")),
          120_000,
        );
        child.once("message", () => {
          clearTimeout(timer);
          resolve();
        });
        child.once("exit", () => {
          clearTimeout(timer);
          reject(new Error("Backup exited before checkpoint"));
        });
      });
      await expect(
        runStack("start", "e2e", { runtime: "native" }),
      ).rejects.toThrow(/lease.*backup.*pid/i);
    } finally {
      const exited = new Promise<void>((resolve) =>
        child.once("exit", () => resolve()),
      );
      child.kill("SIGKILL");
      await exited;
      await runStack("stop", "e2e", { runtime: "native" });
    }
  },
  300_000,
);

it.skipIf(
  process.env.MDF_NATIVE_LEASE_TESTS !== "1" &&
    process.env.MDF_NATIVE_INTEGRATION !== "1",
)(
  "two actual starts from stale state cannot both own the stack",
  async () => {
    assertNativeTestRoot();
    const path = join(nativeLayout("e2e").root, "stack.lock");
    if (existsSync(path))
      throw new Error("Preserve pre-existing legacy lock fixture");
    writeFileSync(path, JSON.stringify({ pid: 999999, startedAt: "stale" }));
    const entry = fileURLToPath(
      new URL("./fixtures/stack-child.ts", import.meta.url),
    );
    const children = [0, 1].map(() =>
      fork(entry, ["start", "e2e"], {
        execArgv: typescriptArgs(entry).slice(0, -1),
        stdio: ["ignore", "ignore", "ignore", "ipc"],
        windowsHide: true,
      }),
    );
    try {
      const results = await Promise.all(
        children.map(
          (child) =>
            new Promise<{ ok: boolean; message?: string }>((resolve) =>
              child.once("message", (value) =>
                resolve(value as { ok: boolean; message?: string }),
              ),
            ),
        ),
      );
      expect(results.filter((value) => value.ok)).toHaveLength(1);
      expect(results.find((value) => !value.ok)?.message).toMatch(
        /lease held by start \(pid \d+\)/,
      );
      expect((await nativeStatus("e2e")).healthy).toBe(true);
    } finally {
      for (const child of children)
        if (child.exitCode === null && child.signalCode === null)
          child.kill("SIGKILL");
      await runStack("stop", "e2e", { runtime: "native" });
      rmSync(path);
    }
  },
  180_000,
);
