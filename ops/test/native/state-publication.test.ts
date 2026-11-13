import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { Worker } from "node:worker_threads";
import { expect, it } from "vitest";
import { type StackState, writeState } from "../../lib/native/processes.js";
import { fixture } from "./fixtures.js";

it.skipIf(process.platform !== "win32")(
  "publishes atomic state while another thread continuously reads it",
  async () => {
    const file = join(fixture(), "state.json");
    writeFileSync(file, "{}");
    const reader = new Worker(
      `const {parentPort,workerData}=require('node:worker_threads'); const fs=require('node:fs');parentPort.postMessage('ready');for(;;){try{JSON.parse(fs.readFileSync(workerData,'utf8'))}catch{}}`,
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
