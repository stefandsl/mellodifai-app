import { type ChildProcess, fork, spawnSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, it } from "vitest";
import { acquireLease } from "../../lib/native/lease.js";
import { typescriptArgs } from "../../lib/native/plan.js";
import { fixture } from "./fixtures.js";

it.runIf(process.platform === "win32")(
  "hands a dead lease helper to the owner's stop handler instead of exiting at once",
  async () => {
    const path = join(fixture(), "supervisor.lease");
    let lost = () => {};
    const notified = new Promise<void>((resolve) => {
      lost = resolve;
    });
    await acquireLease(path, "supervisor", 5000, () => lost());
    // Kill the PowerShell helper this process started, as if it crashed.
    const found = spawnSync(
      "powershell.exe",
      [
        "-NoProfile",
        "-NonInteractive",
        "-Command",
        `Get-CimInstance Win32_Process -Filter "ParentProcessId=${process.pid} and Name='powershell.exe'" | Where-Object { $_.ProcessId -ne $PID -and $_.CommandLine -like '*lease.ps1*' } | ForEach-Object { $_.ProcessId }`,
      ],
      { encoding: "utf8", windowsHide: true },
    );
    const pids = found.stdout.split(/\s+/).filter(Boolean);
    expect(pids.length).toBe(1);
    spawnSync("taskkill", ["/F", "/PID", pids[0] as string], {
      windowsHide: true,
    });
    await notified;
  },
  30_000,
);

it("serializes simultaneous stale-state takeovers and releases ownership after a real kill", async () => {
  const path = join(fixture(), "stack.lease");
  writeFileSync(path, "stale state from a dead command");
  writeFileSync(
    `${path}.holder.json`,
    JSON.stringify({ command: "dead", pid: 999999 }),
  );
  const entry = fileURLToPath(
    new URL("./fixtures/lease-child.ts", import.meta.url),
  );
  const children: ChildProcess[] = [];
  const launch = (command: string) => {
    const child = fork(entry, [path, command], {
      execArgv: typescriptArgs(entry).slice(0, -1),
      stdio: ["ignore", "ignore", "ignore", "ipc"],
      windowsHide: true,
    });
    children.push(child);
    const result = new Promise<{ acquired: boolean; error?: string }>(
      (resolve, reject) => {
        child.once("message", (value) =>
          resolve(value as { acquired: boolean; error?: string }),
        );
        child.once("error", reject);
      },
    );
    return { child, result };
  };
  try {
    const a = launch("start");
    const b = launch("start");
    const results = await Promise.all([a.result, b.result]);
    expect(results.filter((result) => result.acquired)).toHaveLength(1);
    expect(results.find((result) => !result.acquired)?.error).toMatch(
      /lease held by start \(pid \d+\)/,
    );
    const winner = results[0]?.acquired ? a.child : b.child;
    const exited = new Promise<void>((resolve) =>
      winner.once("exit", () => resolve()),
    );
    winner.kill("SIGKILL");
    await exited;
    const next = launch("stop");
    expect((await next.result).acquired).toBe(true);
    const finished = new Promise<void>((resolve) =>
      next.child.once("exit", () => resolve()),
    );
    next.child.send("release");
    await finished;
  } finally {
    for (const child of children)
      if (child.exitCode === null && child.signalCode === null)
        child.kill("SIGKILL");
  }
}, 30_000);

it.runIf(process.platform === "win32")(
  "reports the helper's own error when it cannot take the lease",
  async () => {
    // A folder at the lease path makes File.Open fail inside the helper.
    const path = fixture();
    await expect(acquireLease(path, "supervisor", 1000)).rejects.toThrow(
      /^Stack lease helper exited before acquisition: .*UnauthorizedAccessException/,
    );
  },
  30_000,
);
