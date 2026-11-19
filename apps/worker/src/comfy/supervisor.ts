import { execFile, spawn as nodeSpawn } from "node:child_process";
import { closeSync, mkdirSync, openSync } from "node:fs";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, relative, resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { workerPaths } from "../paths.js";
import { childEnvironment, type Secrets } from "../secrets.js";
import {
  COMFY_CONFIG,
  type ComfyConfig,
  comfyLaunch,
  comfyUrl,
} from "./config.js";

// An error whose message is a plain Italian sentence for the studio.
export class ComfyError extends Error {}

export type ComfyProcess = {
  pid?: number | undefined;
  exited: Promise<unknown>;
};
export type SupervisorDeps = {
  spawn(
    command: string,
    args: string[],
    options: { cwd: string; env: Record<string, string>; logFile: string },
  ): ComfyProcess;
  killTree(pid: number): Promise<void>;
  // Guards the PID file against a PID that Windows gave to another program since.
  isComfyProcess(pid: number): Promise<boolean>;
  fetch?: typeof fetch;
  sleep?(ms: number): Promise<void>;
  report?(line: string): void;
};

// What the supervisor knows about the server on the port: one it can stop (started now or
// adopted from its PID file), or one somebody else started, which it only asks to free the GPU.
type Server = { kind: "owned"; pid: number } | { kind: "external" };

/**
 * Owns the ComfyUI server of this PC. It belongs to the worker process (main.ts), not to a job:
 * job child processes are killed when the job ends, and a crashed worker must find the server
 * and its running prompt again. A local generate_song starts it on demand and stops it at the
 * end of the stage, so Demucs and Remotion never share the GPU with it.
 */
export class ComfySupervisor {
  private server: Server | undefined;
  private starting: Promise<void> | undefined;
  constructor(
    private readonly deps: SupervisorDeps,
    private readonly config: ComfyConfig = COMFY_CONFIG,
    // The worker's own runtime root (MELLODIFAI_ROOT): a PID file elsewhere belongs to another
    // installation (production's server for the desktop app), which this worker never touches.
    private readonly ownRoot: string = workerPaths().root,
  ) {}
  private ownsPidFile(): boolean {
    const rel = relative(resolve(this.ownRoot), resolve(this.config.pidFile));
    return rel !== "" && !rel.startsWith("..") && !isAbsolute(rel);
  }
  private refuseForeign() {
    if (!this.ownsPidFile())
      throw new ComfyError(
        `Il file PID di ComfyUI (${this.config.pidFile}) e' fuori dalla cartella di questo worker (${this.ownRoot}): non lo uso.`,
      );
  }
  get baseUrl(): string {
    return comfyUrl(this.config);
  }
  private sleep(ms: number) {
    return this.deps.sleep ? this.deps.sleep(ms) : delay(ms);
  }
  private report(line: string) {
    try {
      (this.deps.report ?? console.error)(line);
    } catch {
      /* Diagnostics only. */
    }
  }
  private async stats(): Promise<{ version: string } | null> {
    try {
      const response = await (this.deps.fetch ?? fetch)(
        `${this.baseUrl}/system_stats`,
        { signal: AbortSignal.timeout(3000) },
      );
      if (!response.ok) return null;
      const body = (await response.json()) as {
        system?: { comfyui_version?: unknown };
      };
      return { version: String(body.system?.comfyui_version ?? "") };
    } catch {
      return null;
    }
  }
  async isUp(): Promise<boolean> {
    return (await this.stats()) !== null;
  }
  private async recordedPid(): Promise<number | null> {
    try {
      const pid = Number((await readFile(this.config.pidFile, "utf8")).trim());
      return Number.isInteger(pid) && pid > 0 ? pid : null;
    } catch {
      return null;
    }
  }
  // On worker start: take over a server found on the port instead of starting a second one.
  async adopt(): Promise<boolean> {
    if (!this.ownsPidFile()) {
      this.server = undefined;
      this.report(
        "ComfyUI belongs to another installation (PID file outside this worker's root): not adopted",
      );
      return false;
    }
    if (!(await this.isUp())) {
      this.server = undefined;
      await rm(this.config.pidFile, { force: true });
      return false;
    }
    const pid = await this.recordedPid();
    this.server =
      pid !== null && (await this.deps.isComfyProcess(pid).catch(() => false))
        ? { kind: "owned", pid }
        : { kind: "external" };
    if (this.server.kind === "external")
      this.report(
        "ComfyUI is already running without our PID file: using it, it will not be stopped",
      );
    return true;
  }
  ensureStarted(): Promise<void> {
    this.starting ??= this.start().finally(() => {
      this.starting = undefined;
    });
    return this.starting;
  }
  private checkVersion(version: string) {
    if (version !== this.config.version)
      throw new ComfyError(
        `ComfyUI ${version || "senza versione"} non è la versione provata (${this.config.version}): rifai il bake-off prima di usarla.`,
      );
  }
  private async start(): Promise<void> {
    this.refuseForeign();
    const running = await this.stats();
    if (running) {
      if (!this.server) await this.adopt();
      this.checkVersion(running.version);
      return;
    }
    this.server = undefined;
    await rm(this.config.pidFile, { force: true });
    const launch = comfyLaunch(this.config);
    await Promise.all(
      [
        ...launch.dirs,
        dirname(this.config.pidFile),
        dirname(this.config.logFile),
      ].map((dir) => mkdir(dir, { recursive: true })),
    );
    const child = this.deps.spawn(launch.command, launch.args, {
      cwd: launch.cwd,
      env: launch.env,
      logFile: this.config.logFile,
    });
    if (!child.pid) throw new ComfyError("ComfyUI non si è avviato.");
    const pid = child.pid;
    this.server = { kind: "owned", pid };
    await writeFile(this.config.pidFile, String(pid));
    let exited = false;
    void child.exited.then(() => {
      exited = true;
      if (this.server?.kind === "owned" && this.server.pid === pid) {
        this.server = undefined;
        void rm(this.config.pidFile, { force: true }).catch(() => {});
      }
    });
    const deadline = Date.now() + this.config.startTimeoutMs;
    while (Date.now() < deadline && !exited) {
      const stats = await this.stats();
      if (stats) {
        this.checkVersion(stats.version);
        return;
      }
      await this.sleep(1000);
    }
    if (exited)
      throw new ComfyError(
        `ComfyUI si è chiuso durante l'avvio: guarda ${this.config.logFile}.`,
      );
    await this.stop();
    throw new ComfyError(
      `ComfyUI non ha risposto entro ${Math.round(this.config.startTimeoutMs / 1000)} secondi: guarda ${this.config.logFile}.`,
    );
  }
  // Kills the whole process tree (python plus anything it started) and waits for the port.
  async stop(): Promise<void> {
    const server = this.server;
    this.server = undefined;
    if (!server) return;
    if (server.kind === "external") {
      try {
        await (this.deps.fetch ?? fetch)(`${this.baseUrl}/free`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ unload_models: true, free_memory: true }),
          signal: AbortSignal.timeout(10_000),
        });
      } catch {
        this.report("ComfyUI did not free the GPU");
      }
      return;
    }
    try {
      await this.deps.killTree(server.pid);
    } catch (error) {
      this.report(`ComfyUI process tree termination failed: ${String(error)}`);
    }
    for (let i = 0; i < 30 && (await this.isUp()); i += 1)
      await this.sleep(1000);
    await rm(this.config.pidFile, { force: true });
  }
  async restart(): Promise<void> {
    await this.stop();
    await this.ensureStarted();
  }
}

export function killPidTree(pid: number, secrets?: Secrets): Promise<void> {
  return new Promise((resolve, reject) => {
    const killer = nodeSpawn(
      "taskkill.exe",
      ["/PID", String(pid), "/T", "/F"],
      {
        shell: false,
        windowsHide: true,
        env: childEnvironment(process.env, secrets),
      },
    );
    killer.once("error", reject);
    // 128: the process is already gone, which is what stop wants.
    killer.once("close", (code) =>
      code === 0 || code === 128
        ? resolve()
        : reject(new Error(`taskkill exited ${code}`)),
    );
  });
}

// tasklist prints the image name of a PID: the portable server runs as python.exe.
export function isPythonProcess(pid: number): Promise<boolean> {
  return new Promise((resolve) => {
    execFile(
      "tasklist.exe",
      ["/FI", `PID eq ${pid}`, "/FO", "CSV", "/NH"],
      { windowsHide: true, timeout: 10_000 },
      (error, stdout) =>
        resolve(!error && /"python\.exe"/iu.test(String(stdout))),
    );
  });
}

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

// The real dependencies: the server inherits no worker secret and writes its log on E:.
export function createComfySupervisor(options: {
  secrets?: Secrets;
  report?: (line: string) => void;
  config?: ComfyConfig;
}): ComfySupervisor {
  return new ComfySupervisor(
    {
      spawn: (command, args, spawnOptions) => {
        mkdirSync(dirname(spawnOptions.logFile), { recursive: true });
        const log = openSync(spawnOptions.logFile, "a");
        try {
          const child = nodeSpawn(command, args, {
            cwd: spawnOptions.cwd,
            shell: false,
            windowsHide: true,
            stdio: ["ignore", log, log],
            env: {
              ...childEnvironment(process.env, options.secrets),
              ...spawnOptions.env,
            },
          });
          const exited = new Promise((resolve) => {
            child.once("exit", resolve);
            child.once("error", resolve);
          });
          return { pid: child.pid, exited };
        } finally {
          closeSync(log);
        }
      },
      killTree: (pid) => killPidTree(pid, options.secrets),
      isComfyProcess: isPythonProcess,
      ...(options.report ? { report: options.report } : {}),
    },
    options.config,
  );
}
