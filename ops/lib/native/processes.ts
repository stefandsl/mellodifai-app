import { type ChildProcess, spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import {
  closeSync,
  existsSync,
  mkdirSync,
  openSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { dirname } from "node:path";
import { logOffset, observeService } from "./diagnostics.js";
import {
  type ProcessIdentity,
  processIdentities,
  sameProcess,
  terminateTree,
} from "./host.js";
import type { ProcessSpec } from "./plan.js";

export interface RunningService {
  pid: number;
  /** Settles when the process is gone, for any reason. */
  exited: Promise<void>;
  failure?(reason: string): Error;
  stop(): Promise<void>;
}

export interface ServiceDefinition {
  kind: "service";
  id: string;
  dependsOn: string[];
  start(): Promise<RunningService>;
  ready(): Promise<boolean>;
  readyTimeoutMs?: number;
  /** Stop a recorded process whose supervisor is gone. */
  stopOrphan?(identity: ProcessIdentity): Promise<void>;
}

/** A step that must finish before its dependents start (migrations). */
export interface TaskDefinition {
  kind: "task";
  id: string;
  dependsOn: string[];
  run(): Promise<void>;
}

export type Definition = ServiceDefinition | TaskDefinition;

export type ServiceStatus =
  | "pending"
  | "starting"
  | "ready"
  | "restarting"
  | "failed"
  | "stopped"
  | "done";

export interface ServiceState {
  status: ServiceStatus;
  pid?: number | undefined;
  startedAt?: string | undefined;
  restarts: number;
}

export interface StackState {
  supervisor: ProcessIdentity;
  phase: "starting" | "ready" | "stopping" | "stopped" | "failed";
  /** Operator-safe reason, including redacted service diagnostics when available. */
  error?: string | undefined;
  updatedAt: string;
  services: Record<string, ServiceState>;
}

export interface RestartPolicy {
  maxRestarts: number;
  windowMs: number;
  backoffMs: number;
}

export const DEFAULT_RESTART_POLICY: RestartPolicy = {
  maxRestarts: 5,
  windowMs: 10 * 60_000,
  backoffMs: 1_000,
};

/** Dependencies first; refuses unknown names and cycles. */
export function orderDefinitions<T extends { id: string; dependsOn: string[] }>(
  definitions: T[],
): T[] {
  const byId = new Map(definitions.map((item) => [item.id, item]));
  if (byId.size !== definitions.length)
    throw new Error("Duplicate native service id");
  const ordered: T[] = [];
  const state = new Map<string, "visiting" | "done">();
  const visit = (item: T) => {
    if (state.get(item.id) === "done") return;
    if (state.get(item.id) === "visiting")
      throw new Error(`Native service dependency cycle at ${item.id}`);
    state.set(item.id, "visiting");
    for (const name of item.dependsOn) {
      const dependency = byId.get(name);
      if (!dependency)
        throw new Error(`Native service ${item.id} depends on unknown ${name}`);
      visit(dependency);
    }
    state.set(item.id, "done");
    ordered.push(item);
  };
  for (const item of definitions) visit(item);
  return ordered;
}

export function writeState(
  path: string,
  state: StackState,
  log: (message: string) => void = console.warn,
): void {
  mkdirSync(dirname(path), { recursive: true });
  const temp = `${path}.${randomUUID()}.tmp`;
  writeFileSync(temp, JSON.stringify(state, null, 2));
  try {
    for (let attempt = 0; ; attempt++) {
      try {
        renameSync(temp, path);
        if (attempt)
          log(`state: published after ${attempt} Windows sharing retries`);
        return;
      } catch (error) {
        const code = (error as NodeJS.ErrnoException).code;
        // Windows can reject replacement while a status reader holds the old
        // file. Keep the old complete snapshot and retry this same publication,
        // never a service launch or database operation. Persistent denial fails.
        if (
          process.platform !== "win32" ||
          !["EPERM", "EACCES", "EBUSY"].includes(code ?? "") ||
          attempt >= 20
        )
          throw error;
        if (!attempt)
          log(
            `state: Windows sharing conflict (${code}); retrying publication for at most 1000ms`,
          );
        Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 50);
      }
    }
  } finally {
    rmSync(temp, { force: true });
  }
}

export function readState(path: string): StackState | null {
  try {
    return JSON.parse(readFileSync(path, "utf8")) as StackState;
  } catch {
    return null;
  }
}

const sleep = (ms: number) =>
  new Promise<void>((resolve) => setTimeout(resolve, ms));

export async function waitFor(
  check: () => Promise<boolean>,
  timeoutMs: number,
  intervalMs = 250,
  abort?: Promise<unknown>,
): Promise<boolean> {
  let aborted = false;
  abort?.then(
    () => {
      aborted = true;
    },
    () => {
      aborted = true;
    },
  );
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline && !aborted) {
    if (await check().catch(() => false)) return !aborted;
    await sleep(intervalMs);
  }
  return false;
}

export async function httpReady(
  url: string,
  headers: Record<string, string> = {},
): Promise<boolean> {
  const response = await fetch(url, {
    headers,
    signal: AbortSignal.timeout(3_000),
  });
  await response.body?.cancel();
  return response.status === 200;
}

export interface SupervisorOptions {
  statePath: string;
  identify?: (pid: number) => Promise<ProcessIdentity>;
  policy?: RestartPolicy;
  log?: (message: string) => void;
}

async function identify(pid: number): Promise<ProcessIdentity> {
  const found = (await processIdentities([pid])).get(pid);
  if (!found) throw new Error(`Process ${pid} exited before it was recorded`);
  return found;
}

/** Owns the service processes of one stack: ordered start with readiness
 * probes, bounded restarts, reverse-order stop and a truthful state file.
 */
export class Supervisor {
  private readonly ordered: Definition[];
  private readonly running = new Map<string, RunningService>();
  private readonly restarts = new Map<string, number[]>();
  private readonly state: StackState;
  private stopping = false;
  private readonly identify: (pid: number) => Promise<ProcessIdentity>;
  private readonly policy: RestartPolicy;
  private readonly log: (message: string) => void;

  constructor(
    definitions: Definition[],
    supervisor: ProcessIdentity,
    private readonly options: SupervisorOptions,
  ) {
    this.ordered = orderDefinitions(definitions);
    this.identify = options.identify ?? identify;
    this.policy = options.policy ?? DEFAULT_RESTART_POLICY;
    this.log = options.log ?? (() => {});
    this.state = {
      supervisor,
      phase: "starting",
      updatedAt: new Date().toISOString(),
      services: Object.fromEntries(
        this.ordered.map((item) => [
          item.id,
          { status: "pending", restarts: 0 },
        ]),
      ),
    };
    this.save();
  }

  snapshot(): StackState {
    return structuredClone(this.state);
  }

  private save(): void {
    this.state.updatedAt = new Date().toISOString();
    writeState(this.options.statePath, this.state, this.log);
  }

  private set(id: string, patch: Partial<ServiceState>): void {
    this.state.services[id] = {
      ...(this.state.services[id] ?? { status: "pending", restarts: 0 }),
      ...patch,
    };
    this.save();
  }

  /** Start everything in dependency order. On any failure every process
   * already started is stopped again before the error is reported.
   */
  async start(): Promise<void> {
    try {
      for (const definition of this.ordered) {
        if (this.stopping) throw new Error("Stack start was interrupted");
        if (definition.kind === "task") {
          this.set(definition.id, { status: "starting" });
          this.log(`${definition.id}: running`);
          await definition.run();
          this.set(definition.id, { status: "done" });
        } else await this.launch(definition);
      }
      this.state.phase = "ready";
      this.save();
    } catch (error) {
      const reason = error instanceof Error ? error.message : "start failed";
      await this.stop("failed", reason);
      throw error;
    }
  }

  private async launch(definition: ServiceDefinition): Promise<void> {
    this.log(`${definition.id}: starting`);
    this.set(definition.id, { status: "starting" });
    const service = await definition.start();
    this.running.set(definition.id, service);
    let gone = false;
    void service.exited.then(() => {
      gone = true;
    });
    try {
      const identity = await this.identify(service.pid);
      this.set(definition.id, {
        pid: identity.pid,
        startedAt: identity.startedAt,
      });
      const ready = await waitFor(
        () => definition.ready(),
        definition.readyTimeoutMs ?? 90_000,
        250,
        service.exited,
      );
      if (!ready || gone)
        throw new Error(
          gone
            ? `Native service ${definition.id} exited during startup`
            : `Native service ${definition.id} did not become ready`,
        );
    } catch (error) {
      // Capture before stopping: our own termination must not replace the
      // original exit status with the cleanup signal.
      const failure =
        service.failure?.(
          gone ? "exited during startup" : "failed during startup",
        ) ?? error;
      this.running.delete(definition.id);
      await service.stop().catch(() => {});
      this.set(definition.id, { status: "failed" });
      this.log(
        failure instanceof Error
          ? failure.message
          : `${definition.id}: startup failed`,
      );
      throw failure;
    }
    this.set(definition.id, { status: "ready" });
    this.log(`${definition.id}: ready`);
    void service.exited.then(() => {
      if (this.stopping || this.running.get(definition.id) !== service) return;
      this.log(
        service.failure?.("exited after readiness").message ??
          `${definition.id}: exited after readiness`,
      );
      this.running.delete(definition.id);
      void this.recover(definition);
    });
  }

  /** Restart a service that exited on its own, within the restart budget. */
  private async recover(definition: ServiceDefinition): Promise<void> {
    while (!this.stopping) {
      const now = Date.now();
      const recent = (this.restarts.get(definition.id) ?? []).filter(
        (time) => now - time < this.policy.windowMs,
      );
      if (recent.length >= this.policy.maxRestarts) {
        this.log(`${definition.id}: restart limit reached, giving up`);
        this.set(definition.id, { status: "failed", pid: undefined });
        return;
      }
      recent.push(now);
      this.restarts.set(definition.id, recent);
      this.set(definition.id, {
        status: "restarting",
        pid: undefined,
        restarts: (this.state.services[definition.id]?.restarts ?? 0) + 1,
      });
      this.log(`${definition.id}: exited, restart ${recent.length}`);
      await sleep(this.policy.backoffMs * 2 ** (recent.length - 1));
      if (this.stopping) return;
      try {
        await this.launch(definition);
        return;
      } catch {
        // launch recorded the failure; the next round counts it.
      }
    }
  }

  /** Stop in reverse dependency order. Safe to call more than once. */
  async stop(
    phase: "stopped" | "failed" = "stopped",
    error?: string,
  ): Promise<void> {
    this.stopping = true;
    this.state.phase = "stopping";
    this.save();
    const failures: string[] = [];
    for (const definition of [...this.ordered].reverse()) {
      const service = this.running.get(definition.id);
      if (!service) continue;
      this.log(`${definition.id}: stopping`);
      try {
        await service.stop();
        this.running.delete(definition.id);
        this.set(definition.id, { status: "stopped", pid: undefined });
      } catch {
        failures.push(definition.id);
      }
    }
    this.state.phase = failures.length ? "failed" : phase;
    this.state.error = failures.length
      ? `Could not stop: ${failures.join(", ")}`
      : error;
    this.save();
    if (failures.length) throw new Error(this.state.error);
  }
}

/** Turn a process description into a supervised child. Output goes to a log
 * file; the child never holds a pipe to the supervisor.
 */
export function childService(
  spec: ProcessSpec,
  logFile: string,
  options: { stopGraceMs?: number } = {},
): Pick<ServiceDefinition, "start" | "ready"> {
  return {
    ready: () => httpReady(spec.ready, spec.readyHeaders),
    async start() {
      mkdirSync(dirname(logFile), { recursive: true });
      const offset = logOffset(logFile);
      const out = openSync(logFile, "a");
      let child: ChildProcess;
      try {
        child = spawn(spec.command, spec.args, {
          cwd: spec.cwd,
          // Process specs are complete OS environments, independent of Next's
          // ambient requirement for NODE_ENV. Preserve their exact contents.
          env: spec.env as NodeJS.ProcessEnv,
          stdio: ["ignore", out, out, ...(spec.ipc ? ["ipc" as const] : [])],
          // A separate Windows process group survives the parent's console
          // teardown long enough to handle IPC disconnect and drain cleanly.
          detached: true,
          windowsHide: true,
        });
      } finally {
        closeSync(out);
      }
      const observed = observeService(
        child,
        spec.id,
        logFile,
        offset,
        spec.env,
      );
      const { exited } = observed;
      await new Promise<void>((resolve, reject) => {
        child.once("spawn", resolve);
        child.once("error", () => reject(observed.failure("could not spawn")));
      });
      const pid = child.pid as number;
      const identity = await identify(pid).catch(() => null);
      return {
        pid,
        ...observed,
        async stop() {
          if (spec.ipc && child.connected) {
            // The only graceful stop a Windows parent can send a windowless
            // child: close the channel and let it drain.
            child.disconnect();
            const timer = sleep(options.stopGraceMs ?? 10_000);
            await Promise.race([exited, timer]);
          }
          if (identity) await terminateTree(identity);
          else child.kill();
          await Promise.race([exited, sleep(5_000)]);
        },
      };
    },
  };
}

/** One stack operation at a time. A lock whose holder is gone is taken over;
 * a holder is recognised by pid and creation time, never by name.
 */
export async function acquireLock(path: string): Promise<() => void> {
  mkdirSync(dirname(path), { recursive: true });
  const self = await identify(process.pid);
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      writeFileSync(path, JSON.stringify(self), { flag: "wx" });
      return () => {
        try {
          const holder = JSON.parse(
            readFileSync(path, "utf8"),
          ) as ProcessIdentity;
          if (holder.pid === self.pid && holder.startedAt === self.startedAt)
            rmSync(path);
        } catch {
          // Already released.
        }
      };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
    }
    let holder: ProcessIdentity | null = null;
    try {
      holder = JSON.parse(readFileSync(path, "utf8")) as ProcessIdentity;
    } catch {
      // Unreadable lock: its writer died mid-write.
    }
    if (holder && (await sameProcess(holder)))
      throw new Error(
        `Another stack operation is running for this stack (pid ${holder.pid})`,
      );
    if (existsSync(path)) rmSync(path);
  }
  throw new Error("Cannot take the stack lock");
}

/** Run a one-shot tool with its output appended to a log file. Returns the
 * exit code; the caller decides what a failure means.
 */
export async function runLogged(
  command: string,
  args: string[],
  options: { cwd: string; env: Record<string, string>; logFile: string },
): Promise<number> {
  mkdirSync(dirname(options.logFile), { recursive: true });
  const out = openSync(options.logFile, "a");
  try {
    return await new Promise<number>((resolve, reject) => {
      const child = spawn(command, args, {
        cwd: options.cwd,
        env: options.env as NodeJS.ProcessEnv,
        stdio: ["ignore", out, out],
        windowsHide: true,
      });
      child.on("error", reject);
      child.on("close", (status) => resolve(status ?? 1));
    });
  } finally {
    closeSync(out);
  }
}
