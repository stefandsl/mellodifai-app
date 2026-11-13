import { spawn } from "node:child_process";
import {
  closeSync,
  existsSync,
  mkdirSync,
  openSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { ENV_TABLE, type StackEnv, stackDir } from "../envs.js";
import { prepareStackDir, renderConfig } from "../render.js";
import { readStackPasswords } from "../roles.js";
import { type Runner, realRunner } from "../run.js";
import { loadStackSecrets } from "../stack-secrets.js";
import { assertWindowsPorts } from "../windows-ports.js";
import { seedDirsFromEnv } from "./artifacts.js";
import { installNative, nativeTools } from "./build.js";
import {
  assertObjectMetadataSupport,
  assertSystemDiskFree,
  pidAlive,
  portOpen,
  processIdentities,
  sameProcess,
  terminateTree,
} from "./host.js";
import { loopback, type NativeLayout, nativeLayout } from "./layout.js";
import { baseEnvironment } from "./plan.js";
import { postmasterPid, stopPostgres, witness } from "./postgres.js";
import {
  acquireLock,
  readState,
  type StackState,
  waitFor,
} from "./processes.js";
import {
  migrateApp,
  nativeContext,
  statePath,
  stopRequestPath,
  tsxRuntime,
} from "./supervisor.js";

const repo = fileURLToPath(new URL("../../../", import.meta.url));
const supervisorEntry = fileURLToPath(
  new URL("./supervisor.ts", import.meta.url),
);

export interface NativeFlags {
  noBackup?: boolean | undefined;
  /** Allow the first boot of an empty production database (ruling 10). */
  initProduction?: boolean | undefined;
  seedDirs?: string[] | undefined;
}

export interface NativeDependencies {
  /** Writes test.env for a non-production stack and returns its path. */
  writeEnvFile(env: StackEnv): Promise<string>;
  runner?: Runner | undefined;
  log?: ((message: string) => void) | undefined;
}

export const NATIVE_COMMANDS = [
  "install",
  "render",
  "start",
  "stop",
  "status",
  "migrate",
  "reset",
  "env-file",
] as const;

/** Same refusals as the Docker runtime, checked before anything is touched. */
export function assertNativeCommand(
  cmd: string,
  env: StackEnv,
  flags: NativeFlags,
): void {
  if (!Object.hasOwn(ENV_TABLE, env))
    throw new Error("Unknown stack command or environment");
  if (cmd === "db reset") cmd = "reset";
  if (!(NATIVE_COMMANDS as readonly string[]).includes(cmd))
    throw new Error("Unknown stack command or environment");
  if (
    ENV_TABLE[env].projectId === "mellodifai" &&
    (cmd === "reset" || (cmd === "stop" && flags.noBackup))
  )
    throw new Error("Production reset is refused; use ops/restore.ts");
  if (flags.noBackup && cmd !== "stop")
    throw new Error("--no-backup is only valid for stop");
  if (env === "ci" && process.env.CI !== "true" && cmd !== "install")
    throw new Error(
      "CI stack requires CI=true; CI ports are reserved for isolated runners",
    );
}

/** Stack folder, CLI-compatible config and secrets, shared with Docker. */
export async function renderNative(env: StackEnv): Promise<NativeLayout> {
  const dir = stackDir(env);
  prepareStackDir(dir);
  writeFileSync(
    join(dir, "supabase/config.toml"),
    renderConfig(
      readFileSync(join(repo, "supabase/config.toml"), "utf8"),
      env,
      dir,
    ),
  );
  await loadStackSecrets(env, true);
  if (env !== "prod") await readStackPasswords(env);
  return nativeLayout(env);
}

async function supervisorAlive(state: StackState | null): Promise<boolean> {
  return (
    state !== null &&
    state.supervisor.startedAt !== "" &&
    (await sameProcess(state.supervisor))
  );
}

/** Stop whatever a dead supervisor left behind, newest dependency first.
 * Every process is matched by pid and creation time before it is touched.
 */
async function stopOrphans(
  layout: NativeLayout,
  state: StackState | null,
): Promise<void> {
  const records = Object.entries(state?.services ?? {})
    .filter(
      ([id, service]) =>
        id !== "postgres" &&
        service.pid !== undefined &&
        service.pid !== state?.supervisor.pid &&
        service.startedAt !== undefined,
    )
    .reverse();
  for (const [, service] of records)
    await terminateTree({
      pid: service.pid as number,
      startedAt: service.startedAt as string,
    });
  if (postmasterPid(layout) !== null && existsSync(layout.pgdata))
    await stopPostgres(layout, nativeTools());
}

async function stopNative(layout: NativeLayout): Promise<void> {
  const state = readState(statePath(layout));
  if (state && (await supervisorAlive(state))) {
    mkdirSync(layout.run, { recursive: true });
    writeFileSync(stopRequestPath(layout), new Date().toISOString());
    const gone = await waitFor(
      async () => !pidAlive(state.supervisor.pid),
      180_000,
      500,
    );
    // A supervisor that ignores the request is ended; its services follow.
    if (!gone) await terminateTree(state.supervisor);
  }
  rmSync(stopRequestPath(layout), { force: true });
  await stopOrphans(layout, readState(statePath(layout)));
}

function assertInside(parent: string, child: string): void {
  const rel = relative(resolve(parent), resolve(child));
  if (rel === "" || rel.startsWith(`..${sep}`) || rel === "..")
    throw new Error("Refusing to remove a path outside the native stack");
}

/** Remove the database and objects of a test stack. Only folders this
 * runtime created (proved by its first-boot markers) are removed.
 */
function wipeNative(layout: NativeLayout): void {
  const marks = witness(layout);
  const ours = existsSync(marks.done) || existsSync(marks.pending);
  if (existsSync(layout.pgdata) && !ours)
    throw new Error(
      "The native database folder was not created by this stack; refusing to reset it",
    );
  for (const path of [
    layout.pgdata,
    layout.objects,
    layout.run,
    layout.tmp,
    marks.done,
    marks.pending,
  ]) {
    assertInside(layout.root, path);
    rmSync(path, { recursive: true, force: true, maxRetries: 5 });
  }
}

async function assertPortsFree(
  env: StackEnv,
  layout: NativeLayout,
  runner: Runner,
): Promise<void> {
  const ports = Object.values(layout.ports).filter(
    (port): port is number => port !== null,
  );
  // The template listener is native-only; check it with the shared ports.
  const listeners = {
    ...ENV_TABLE[env].listeners,
    templates: layout.ports.templates,
  };
  await assertWindowsPorts({ ports: ENV_TABLE[env].ports, listeners }, runner);
  for (const port of ports)
    if (await portOpen(port))
      throw new Error(
        `Native stack start refused: port ${port} is already in use on 127.0.0.1`,
      );
}

async function apiReady(env: StackEnv, layout: NativeLayout): Promise<void> {
  const secrets = await loadStackSecrets(env);
  const headers = {
    apikey: secrets.service,
    Authorization: `Bearer ${secrets.service}`,
  };
  const api = loopback(layout.ports.api);
  const ready = await waitFor(
    async () => {
      const responses = await Promise.all(
        [
          "/rest/v1/",
          "/auth/v1/admin/users?page=1&per_page=1",
          "/storage/v1/bucket",
        ].map((path) =>
          fetch(`${api}${path}`, { headers, signal: AbortSignal.timeout(5000) }),
        ),
      );
      await Promise.all(responses.map((response) => response.body?.cancel()));
      return responses.every((response) => response.ok);
    },
    30_000,
    500,
  );
  if (!ready)
    throw new Error("Native stack API readiness failed after start");
}

async function startNative(
  env: StackEnv,
  flags: NativeFlags,
  dependencies: NativeDependencies,
): Promise<void> {
  const log = dependencies.log ?? (() => {});
  assertSystemDiskFree();
  nativeTools();
  const layout = await renderNative(env);
  const previous = readState(statePath(layout));
  if (await supervisorAlive(previous)) {
    if (previous?.phase !== "ready")
      throw new Error(
        `The native stack is ${previous?.phase}; run stop before starting again`,
      );
    await apiReady(env, layout);
    log("native stack is already running");
    return;
  }
  // A supervisor that died leaves services behind; clear them first.
  await stopOrphans(layout, previous);
  await assertPortsFree(env, layout, dependencies.runner ?? realRunner);
  const marks = witness(layout);
  if (
    env === "prod" &&
    !existsSync(marks.done) &&
    !existsSync(marks.pending) &&
    !flags.initProduction
  )
    throw new Error(
      "The native production database does not exist yet. Moving production is an explicit, backup-first step; pass --init-production only as part of that move.",
    );
  mkdirSync(layout.objects, { recursive: true });
  assertObjectMetadataSupport(layout.objects);
  for (const directory of [layout.logs, layout.run, layout.tmp])
    mkdirSync(directory, { recursive: true });
  rmSync(statePath(layout), { force: true });
  rmSync(stopRequestPath(layout), { force: true });

  const tsx = tsxRuntime();
  const out = openSync(join(layout.logs, "supervisor.log"), "a");
  let exitCode: number | null = null;
  try {
    const child = spawn(tsx.node, [tsx.cli, supervisorEntry, env], {
      cwd: dirname(supervisorEntry),
      detached: true,
      stdio: ["ignore", out, out],
      windowsHide: true,
      env: {
        ...baseEnvironment(layout),
        ...Object.fromEntries(
          [
            "MELLODIFAI_ROOT",
            "MELLODIFAI_NATIVE_CACHE",
            "RUNNER_TEMP",
            "CI",
            "E2E_PORT",
          ]
            .filter((name) => process.env[name] !== undefined)
            .map((name) => [name, process.env[name] as string]),
        ),
      },
    });
    child.once("exit", (code) => {
      exitCode = code ?? 1;
    });
    child.unref();
  } finally {
    closeSync(out);
  }
  log("native stack starting (first boot applies every migration)");
  let state: StackState | null = null;
  const settled = await waitFor(
    async () => {
      state = readState(statePath(layout));
      return (
        exitCode !== null ||
        state?.phase === "ready" ||
        state?.phase === "failed"
      );
    },
    20 * 60_000,
    500,
  );
  const final = state as StackState | null;
  if (!settled || final?.phase !== "ready") {
    // Never leave half a stack behind a failed start.
    await stopNative(layout).catch(() => {});
    throw new Error(
      `Native stack start failed: ${final?.error ?? (settled ? "the supervisor exited" : "timed out")}. See ${join(layout.logs, "supervisor.log")}`,
    );
  }
  await apiReady(env, layout);
  if (env !== "prod") await dependencies.writeEnvFile(env);
}

export interface ServiceReport {
  id: string;
  state: string;
  pid: number | null;
  port: number | null;
  restarts: number;
}

/** What is actually true right now: every recorded pid is checked against
 * the host process table and every port is probed.
 */
export async function nativeStatus(env: StackEnv): Promise<{
  phase: string;
  healthy: boolean;
  services: ServiceReport[];
}> {
  const layout = nativeLayout(env);
  const state = readState(statePath(layout));
  const ports: Record<string, number | null> = {
    postgres: layout.ports.db,
    templates: layout.ports.templates,
    mailpit: layout.ports.mailHttp,
    auth: layout.ports.auth,
    rest: layout.ports.rest,
    storage: layout.ports.storage,
    gateway: layout.ports.api,
  };
  const recorded = state?.services ?? {};
  const live = await processIdentities([
    ...(state ? [state.supervisor.pid] : []),
    ...Object.values(recorded).flatMap((service) =>
      service.pid === undefined ? [] : [service.pid],
    ),
  ]);
  const supervisorUp =
    state !== null &&
    live.get(state.supervisor.pid)?.startedAt === state.supervisor.startedAt;
  const services: ServiceReport[] = [];
  for (const [id, port] of Object.entries(ports)) {
    if (port === null) continue;
    const service = recorded[id];
    const alive =
      service?.pid !== undefined &&
      live.get(service.pid)?.startedAt === service.startedAt;
    const listening = await portOpen(port);
    services.push({
      id,
      state:
        alive && listening
          ? "running"
          : alive
            ? "not listening"
            : listening
              ? "port taken by an unknown process"
              : "stopped",
      pid: alive ? (service?.pid ?? null) : null,
      port,
      restarts: service?.restarts ?? 0,
    });
  }
  const healthy =
    supervisorUp &&
    state?.phase === "ready" &&
    services.every((service) => service.state === "running");
  const phase = healthy
    ? "ready"
    : services.every((service) => service.state === "stopped") && !supervisorUp
      ? "stopped"
      : supervisorUp && state?.phase === "starting"
        ? "starting"
        : "degraded";
  return { phase, healthy, services };
}

export function formatStatus(
  env: StackEnv,
  status: Awaited<ReturnType<typeof nativeStatus>>,
): string {
  const rows = status.services.map(
    (service) =>
      `  ${service.id.padEnd(10)} ${service.state.padEnd(14)} port ${service.port}${service.pid === null ? "" : `  pid ${service.pid}`}${service.restarts ? `  restarts ${service.restarts}` : ""}`,
  );
  return [`native stack ${env}: ${status.phase}`, ...rows].join("\n");
}

export async function runNativeCommand(
  cmd: string,
  env: StackEnv,
  flags: NativeFlags,
  dependencies: NativeDependencies,
): Promise<string | undefined> {
  assertNativeCommand(cmd, env, flags);
  if (cmd === "db reset") cmd = "reset";
  const log = dependencies.log ?? (() => {});
  if (cmd === "install") {
    assertSystemDiskFree();
    await installNative({ seedDirs: flags.seedDirs ?? seedDirsFromEnv(), log });
    return;
  }
  if (cmd === "env-file") return dependencies.writeEnvFile(env);
  if (cmd === "status") {
    const status = await nativeStatus(env);
    if (!status.healthy) process.exitCode = 1;
    return formatStatus(env, status);
  }
  if (cmd === "render") {
    await renderNative(env);
    return;
  }
  const layout = nativeLayout(env);
  const release = await acquireLock(join(layout.root, "stack.lock"));
  try {
    if (cmd === "start") await startNative(env, flags, dependencies);
    else if (cmd === "stop") await stopNative(layout);
    else if (cmd === "migrate") {
      const state = readState(statePath(layout));
      if (!(await supervisorAlive(state)) || state?.phase !== "ready")
        throw new Error("The native stack must be running to migrate");
      await migrateApp(await nativeContext(env), log);
      if (env !== "prod") await dependencies.writeEnvFile(env);
    } else if (cmd === "reset") {
      await stopNative(layout);
      wipeNative(layout);
      await startNative(env, flags, dependencies);
    }
  } finally {
    release();
  }
}
