import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { Worker } from "node:worker_threads";
import { expect, it } from "vitest";
import {
  STATE_PUBLICATION_MS,
  type StackState,
  writeState,
} from "../../lib/native/processes.js";
import { fixture } from "./fixtures.js";

it.skipIf(process.platform !== "win32")(
  "publishes atomic state while another thread continuously reads it",
  async () => {
    const file = join(fixture(), "state.json");
    writeFileSync(file, "{}");
    // The reader opens the file again 1 ms after each read: sharing conflicts stay frequent,
    // but under load a loop with no pause at all held the file through every one of the 21
    // rename tries, which no real status reader does.
    const reader = new Worker(
      `const {parentPort,workerData}=require('node:worker_threads'); const fs=require('node:fs');const pause=new Int32Array(new SharedArrayBuffer(4));parentPort.postMessage('ready');for(;;){try{JSON.parse(fs.readFileSync(workerData,'utf8'))}catch{}Atomics.wait(pause,0,0,1)}`,
      { eval: true, workerData: file },
    );
    try {
      await new Promise<void>((resolve, reject) => {
        reader.once("message", () => resolve());
        reader.once("error", reject);
      });
      const state: StackState = {
        supervisor: { pid: process.pid, startedAt: "test" },
        phase: "ready",
        updatedAt: "test",
        services: {},
      };
      for (let i = 0; i < 200; i++) {
        state.updatedAt = String(i);
        writeState(file, state);
      }
      expect(JSON.parse(readFileSync(file, "utf8")).updatedAt).toBe("199");
    } finally {
      await reader.terminate();
    }
  },
  30_000,
);

/** A second process that has the state file open without delete sharing,
 * as a status reader that is slow to close it. It closes the file after
 * `holdMs`, or when the returned function is called. */
async function holdOpen(file: string, holdMs?: number) {
  const wait =
    holdMs === undefined
      ? "[Console]::ReadLine() | Out-Null"
      : `[Threading.Thread]::Sleep(${holdMs})`;
  const holder = spawn(
    "powershell.exe",
    [
      "-NoProfile",
      "-NonInteractive",
      "-Command",
      `$f=[IO.File]::Open($env:MDF_TEST_STATE,[IO.FileMode]::Open,[IO.FileAccess]::Read,[IO.FileShare]::ReadWrite); try { [Console]::WriteLine('ready'); ${wait} } finally { $f.Dispose() }`,
    ],
    {
      env: { ...process.env, MDF_TEST_STATE: file },
      windowsHide: true,
      stdio: ["pipe", "pipe", "pipe"],
    },
  );
  const exited = new Promise<void>((done) => holder.once("exit", () => done()));
  // A holder with a timed hold has ended before it is told to release.
  holder.stdin.on("error", () => {});
  await new Promise<void>((done, fail) => {
    holder.stdout.once("data", () => done());
    holder.once("error", fail);
  });
  return async () => {
    holder.stdin.end("\n");
    await exited;
  };
}
const next: StackState = {
  supervisor: { pid: 1, startedAt: "test" },
  phase: "ready",
  updatedAt: "test",
  services: {},
};

it.skipIf(process.platform !== "win32")(
  "publishes when another process keeps the state file open for seconds",
  async () => {
    const file = join(fixture(), "state.json");
    writeFileSync(file, JSON.stringify({ previous: true }));
    // Longer than the 1 s that used to be the limit, shorter than the limit.
    const release = await holdOpen(file, 2500);
    try {
      const messages: string[] = [];
      const start = Date.now();
      writeState(file, next, (m) => messages.push(m));
      expect(Date.now() - start).toBeGreaterThan(1000);
      expect(JSON.parse(readFileSync(file, "utf8"))).toEqual(next);
      expect(messages.map((m) => m.replace(/\d+/g, "N"))).toEqual([
        "state: Windows sharing conflict (EPERM); retrying publication for at most Nms",
        "state: published after N Windows sharing retries (Nms)",
      ]);
    } finally {
      await release();
    }
  },
  30_000,
);

it.skipIf(process.platform !== "win32")(
  "bounds a persistent sharing denial and keeps the previous complete state",
  async () => {
    const file = join(fixture(), "state.json");
    writeFileSync(file, JSON.stringify({ previous: true }));
    const release = await holdOpen(file);
    try {
      const messages: string[] = [];
      const start = Date.now();
      expect(() => writeState(file, next, (m) => messages.push(m))).toThrow(
        /EPERM|EACCES|EBUSY/,
      );
      expect(Date.now() - start).toBeGreaterThanOrEqual(STATE_PUBLICATION_MS);
      expect(Date.now() - start).toBeLessThan(STATE_PUBLICATION_MS + 5000);
      expect(messages.some((m) => m.includes("retrying publication"))).toBe(
        true,
      );
      expect(JSON.parse(readFileSync(file, "utf8"))).toEqual({
        previous: true,
      });
    } finally {
      await release();
    }
  },
  30_000,
);

import { spawn } from "node:child_process";
