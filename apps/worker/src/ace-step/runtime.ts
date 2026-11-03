import { execFile, spawn } from "node:child_process";
import { closeSync, mkdirSync, openSync } from "node:fs";
import { statfs } from "node:fs/promises";
import { dirname, parse } from "node:path";
import type { LocalEngineStatus } from "@mellodifai/shared";
import type { EngineAvailability } from "../comfy/availability.js";
import { LOCAL_ENGINES } from "../comfy/config.js";
import type { Db } from "../db.js";
import type { Engine } from "../engine.js";
import { childEnvironment, type Secrets } from "../secrets.js";
import {
  type AceStepConfig,
  type AceStepDeps,
  AceStepSupervisor,
  DEFAULT_ACE_STEP_CONFIG,
  killPidTree,
} from "./supervisor.js";

export function nvidiaFreeVramMb(): Promise<number | null> {
  return new Promise((resolve) => {
    execFile(
      "nvidia-smi",
      ["--query-gpu=memory.free", "--format=csv,noheader,nounits"],
      { windowsHide: true, timeout: 10_000 },
      (error, stdout) => {
        if (error) return resolve(null);
        const value = Number(String(stdout).split(/\r?\n/u)[0]?.trim());
        resolve(Number.isFinite(value) ? value : null);
      },
    );
  });
}

// workers.engines["ace-step"]: the availability the studio's engine selector reads plus the
// native setup state. Native ACE-Step installs itself on the first song, so it is offered as
// installed; the setup state says what the PC is doing. No rewrite or cover without ComfyUI.
export function aceStepEntry(
  status: LocalEngineStatus,
  now: Date = new Date(),
): EngineAvailability & LocalEngineStatus {
  const spec = LOCAL_ENGINES["ace-step"];
  return {
    installed: true,
    passedLangs: [...spec.passedLangs],
    minutesPerAudioMinute: spec.minutesPerAudioMinute,
    features: [],
    checkedAt: now.toISOString(),
    ...status,
  };
}

// Real dependencies for the worker process.
export function createAceStepSupervisor(options: {
  engine: Engine;
  db: Pick<Db, "upsertWorker">;
  workerId: string;
  secrets: Secrets;
  config?: Partial<AceStepConfig>;
}): AceStepSupervisor {
  const config = { ...DEFAULT_ACE_STEP_CONFIG, ...options.config };
  const deps: AceStepDeps = {
    run: async (command, args, runOptions) => {
      await options.engine.run(command, args, {
        ...(runOptions.cwd ? { cwd: runOptions.cwd } : {}),
        ...(runOptions.env ? { env: runOptions.env } : {}),
      });
    },
    spawnServer: (command, args, spawnOptions) => {
      mkdirSync(dirname(spawnOptions.logFile), { recursive: true });
      const log = openSync(spawnOptions.logFile, "a");
      const child = spawn(command, args, {
        cwd: spawnOptions.cwd,
        shell: false,
        windowsHide: true,
        stdio: ["ignore", log, log],
        env: {
          ...childEnvironment(process.env, options.secrets),
          ...spawnOptions.env,
        },
      });
      closeSync(log);
      const exited = new Promise((resolve) => {
        child.once("exit", resolve);
        child.once("error", resolve);
      });
      return { pid: child.pid, exited };
    },
    killPid: killPidTree,
    fetch: (input, init) => fetch(input, init),
    publish: (status: LocalEngineStatus) =>
      options.db.upsertWorker({
        id: options.workerId,
        engines: { "ace-step": aceStepEntry(status) },
      }),
    freeDiskBytes: async (path) => {
      const stats = await statfs(parse(path).root);
      return Number(stats.bavail) * Number(stats.bsize);
    },
    freeVramMb: nvidiaFreeVramMb,
  };
  return new AceStepSupervisor(deps, config);
}
