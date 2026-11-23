import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import {
  appendFileSync,
  closeSync,
  existsSync,
  mkdirSync,
  openSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { basename, join, resolve } from "node:path";
import postgres, { type Sql } from "postgres";
import { writePrivate } from "../private-file.js";
import { type Runner, realRunner } from "../run.js";
import { nativeAssets } from "./artifacts.js";
import type { NativeTools } from "./build.js";
import {
  DllInitializationError,
  dllInitializationExit,
  logOffset,
  observeService,
} from "./diagnostics.js";
import {
  executable,
  type ProcessIdentity,
  pidAlive,
  processIdentities,
} from "./host.js";
import type { NativeLayout } from "./layout.js";
import { serviceLog } from "./logs.js";
import { baseEnvironment, type DbLogins } from "./plan.js";
import { postgresLaunch } from "./postgres-host.js";
import { postgresReady } from "./postgres-ready.js";
import {
  followOutput,
  type ServiceDefinition,
  waitFor,
  withOutput,
} from "./processes.js";
import { retryInitialization } from "./start-retry.js";

const SUPERUSER = "supabase_admin";
const INCLUDE = "include = 'mellodifai.conf'";

/** Markers for the one part of first boot that cannot be resumed: creating
 * the cluster and the Supabase base schema. "pending" without "done" means
 * that part was cut short and the data directory cannot be trusted.
 */
export const witness = (layout: NativeLayout) => ({
  pending: join(layout.root, "first-boot.pending"),
  done: join(layout.root, "first-boot.done"),
});

export function firstBootState(layout: NativeLayout): "new" | "done" {
  const marks = witness(layout);
  const hasData =
    existsSync(layout.pgdata) && readdirSync(layout.pgdata).length > 0;
  if (existsSync(marks.pending))
    throw new Error(
      "The first boot of this native database did not finish. Run stack.ts reset for a test stack, or restore the database, before starting again.",
    );
  if (existsSync(marks.done)) {
    if (!hasData)
      throw new Error(
        "The native database folder is missing although first boot completed; restore it before starting",
      );
    return "done";
  }
  if (hasData)
    throw new Error(
      "The native database folder holds data this stack did not create; refusing to initialise over it",
    );
  return "new";
}

function tool(tools: NativeTools, name: string): string {
  return join(tools.pgBin, executable(name));
}

function toolEnvironment(layout: NativeLayout): Record<string, string> {
  // LC_MESSAGES keeps tool output in English whatever the desktop language.
  return { ...baseEnvironment(layout), LC_MESSAGES: "C", LANG: "C" };
}

async function runTool(
  name: string,
  layout: NativeLayout,
  operation: () => ReturnType<Runner>,
): ReturnType<Runner> {
  return retryInitialization(
    async () => {
      const result = await operation();
      if (dllInitializationExit(result.code))
        throw new DllInitializationError(
          `${name} parent ${process.pid}: STATUS_DLL_INIT_FAILED 0xC0000142 before entry point; windowsHide=true`,
        );
      return result;
    },
    (message) => {
      mkdirSync(layout.logs, { recursive: true });
      appendFileSync(
        join(layout.logs, "supervisor.log"),
        `${new Date().toISOString()} ${message}\n`,
      );
    },
  );
}

/** Settings that must hold on every start live in a file this module owns,
 * rewritten each time; postgresql.conf itself only gains one include line.
 */
export function serverConfig(layout: NativeLayout): string {
  return [
    "# Written by ops/lib/native/postgres.ts on every start. Do not edit.",
    "listen_addresses = '127.0.0.1'",
    `port = ${layout.ports.db}`,
    "password_encryption = 'scram-sha-256'",
    // The Supabase image runs in UTC; time zone names in data must not
    // depend on the desktop's region.
    "timezone = 'UTC'",
    "log_timezone = 'UTC'",
    // Ruling 3: no logical replication, so no slot can pin WAL on disk.
    "wal_level = replica",
    "max_replication_slots = 0",
    // Logs must never hold statements, parameters or row values (finding
    // S1). The server writes to stderr; the supervisor redacts each line and
    // rotates the file. Client errors (ERROR, WARNING) are not logged: their
    // text can quote values. LOG, FATAL and PANIC stay, without DETAIL,
    // HINT, QUERY or CONTEXT.
    "logging_collector = off",
    "log_destination = 'stderr'",
    "log_min_messages = log",
    "log_error_verbosity = terse",
    "log_statement = 'none'",
    "log_min_error_statement = panic",
    "log_min_duration_statement = -1",
    "log_parameter_max_length = 0",
    "log_parameter_max_length_on_error = 0",
    "",
  ].join("\n");
}

export function writeServerConfig(layout: NativeLayout): void {
  writeFileSync(join(layout.pgdata, "mellodifai.conf"), serverConfig(layout));
  const main = join(layout.pgdata, "postgresql.conf");
  if (!readFileSync(main, "utf8").split(/\r?\n/).includes(INCLUDE))
    appendFileSync(main, `\n${INCLUDE}\n`);
}

/** Create the cluster. UTF8 with the ICU en-US collation matches the Supabase
 * Linux image (ICU en_US.UTF-8), so text ordering and a later dump of that
 * database behave the same here; the libc locale only labels messages.
 */
export async function initCluster(
  layout: NativeLayout,
  tools: NativeTools,
  superPassword: string,
  runner: Runner = realRunner,
): Promise<void> {
  mkdirSync(layout.config, { recursive: true });
  mkdirSync(layout.tmp, { recursive: true });
  const passwordFile = join(layout.config, "initdb-password");
  await writePrivate(passwordFile, superPassword);
  try {
    const result = await runTool("initdb.exe", layout, () =>
      runner(
        tool(tools, "initdb"),
        [
          "-D",
          layout.pgdata,
          "-U",
          SUPERUSER,
          `--pwfile=${passwordFile}`,
          "-A",
          "scram-sha-256",
          "-E",
          "UTF8",
          "--locale-provider=icu",
          "--icu-locale=en-US",
          `--locale=${process.platform === "win32" ? "en-US" : "en_US.UTF-8"}`,
        ],
        { env: toolEnvironment(layout) },
      ),
    );
    if (result.code !== 0)
      throw new Error("PostgreSQL initdb failed; the data folder is unusable");
  } finally {
    rmSync(passwordFile, { force: true });
  }
}

/** pg_ctl never gets a pipe: on Windows a server it started would inherit it
 * and the caller would wait for a handle that stays open for the server's
 * lifetime. It writes into a private capture file in the log folder instead;
 * once it exits, every captured line goes through the same redacting,
 * rotating log as the services (pg_ctl.log) and the capture is removed.
 */
async function pgCtl(
  tools: NativeTools,
  layout: NativeLayout,
  args: string[],
): Promise<number> {
  mkdirSync(layout.logs, { recursive: true });
  const environment = toolEnvironment(layout);
  const sink = serviceLog(join(layout.logs, "pg_ctl.log"), environment);
  try {
    return await retryInitialization(
      async () => {
        const capture = join(
          layout.logs,
          `pg_ctl.${process.pid}.${randomUUID()}.capture`,
        );
        try {
          return await pgCtlOnce(tools, environment, args, capture);
        } finally {
          try {
            const text = readFileSync(capture, "utf8");
            const lines = sink.stream();
            lines.write(text);
            lines.end();
          } catch {
            /* No output was captured. */
          }
          rmSync(capture, { force: true });
        }
      },
      (message) =>
        sink.line(`${new Date().toISOString()} ${message.replace(/\n/g, " ")}`),
    );
  } finally {
    sink.close();
  }
}

function pgCtlOnce(
  tools: NativeTools,
  environment: Record<string, string>,
  args: string[],
  capture: string,
): Promise<number> {
  const out = openSync(capture, "w", 0o600);
  return new Promise<number>((resolve, reject) => {
    const child = spawn(tool(tools, "pg_ctl"), args, {
      // Next's ambient ProcessEnv requires NODE_ENV, even for PostgreSQL tools.
      env: environment as NodeJS.ProcessEnv,
      stdio: ["ignore", out, out],
      windowsHide: true,
      // File stdio plus windowsHide alone can allocate a hidden console.
      detached: true,
    });
    child.on("error", reject);
    child.on("exit", (code) => {
      if (dllInitializationExit(code))
        reject(
          new DllInitializationError(
            `pg_ctl.exe pid ${child.pid}, parent ${process.pid}: STATUS_DLL_INIT_FAILED 0xC0000142 before entry point; detached=true windowsHide=true`,
          ),
        );
      else resolve(code ?? 1);
    });
  }).finally(() => closeSync(out));
}

export function postmasterPid(layout: NativeLayout): number | null {
  try {
    const [first] = readFileSync(
      join(layout.pgdata, "postmaster.pid"),
      "utf8",
    ).split(/\r?\n/);
    const pid = Number(first);
    return Number.isInteger(pid) && pid > 0 ? pid : null;
  } catch {
    return null;
  }
}

/** A pid file alone is not authority to stop an arbitrary process. PostgreSQL
 * records its data directory and start epoch beside the pid. Check both. */
export async function verifiedPostmaster(
  layout: NativeLayout,
): Promise<ProcessIdentity | null> {
  try {
    const [pidText, directory, epochText] = readFileSync(
      join(layout.pgdata, "postmaster.pid"),
      "utf8",
    ).split(/\r?\n/);
    const pid = Number(pidText);
    const epoch = Number(epochText);
    if (
      !Number.isInteger(pid) ||
      pid < 1 ||
      !directory ||
      resolve(directory) !== resolve(layout.pgdata) ||
      !Number.isFinite(epoch) ||
      epoch <= 0
    )
      return null;
    const live = (await processIdentities([pid])).get(pid);
    if (
      !live ||
      Math.abs(Date.parse(live.startedAt) / 1000 - epoch) > 2 ||
      !Number.isFinite(Date.parse(live.startedAt))
    )
      return null;
    return live;
  } catch {
    return null;
  }
}

/** Fast shutdown: sessions are ended and a checkpoint is written, so the
 * next start needs no recovery. A timeout is an error, never a kill.
 */
export async function stopPostgres(
  layout: NativeLayout,
  tools: NativeTools,
): Promise<void> {
  if (!(await verifiedPostmaster(layout))) return;
  const code = await pgCtl(tools, layout, [
    "stop",
    "-D",
    layout.pgdata,
    "-m",
    "fast",
    "-w",
    "-t",
    "120",
  ]);
  const pid = postmasterPid(layout);
  if (code !== 0 && pid !== null && pidAlive(pid))
    throw new Error("PostgreSQL did not shut down cleanly within 120 seconds");
}

export function postgresService(
  layout: NativeLayout,
  tools: NativeTools,
): ServiceDefinition {
  let initialized = false;
  return {
    kind: "service",
    id: "postgres",
    dependsOn: ["cluster"],
    readyTimeoutMs: 120_000,
    async start() {
      initialized = false;
      writeServerConfig(layout);
      // The Windows host owns one hidden console shared by all backends.
      // Its lifetime follows PostgreSQL, not the initiating CLI process.
      const logFile = join(layout.logs, "postgres.log");
      const sink = serviceLog(logFile);
      const offset = logOffset(logFile);
      const launch = postgresLaunch(tool(tools, "postgres"), [
        "-D",
        layout.pgdata,
      ]);
      const child = spawn(launch.command, launch.args, {
        env: {
          ...toolEnvironment(layout),
          ...launch.env,
        } as NodeJS.ProcessEnv,
        // The server and every backend inherit this pipe; the supervisor
        // reads it for their whole lifetime.
        stdio: [
          "ignore",
          "pipe",
          "pipe",
          ...(launch.ipc ? ["ipc" as const] : []),
        ],
        detached: true,
        windowsHide: true,
      });
      const observed = withOutput(
        observeService(child, "postgres", logFile, offset),
        followOutput(child, sink),
      );
      let timer: ReturnType<typeof setTimeout> | undefined;
      let pid: number;
      try {
        pid = await new Promise<number>((resolve, reject) => {
          child.once("spawn", () => {
            if (!launch.ipc) resolve(child.pid as number);
          });
          child.once("message", (message: unknown) => {
            const value = (message as { pid?: unknown })?.pid;
            if (
              typeof value === "number" &&
              Number.isInteger(value) &&
              value > 0
            )
              resolve(value);
            else reject(observed.failure("invalid console host identity"));
          });
          void observed.exited.then(() =>
            reject(
              observed.failure("exited before identifying the postmaster"),
            ),
          );
          // The restricted-token launcher compiles its helper before it starts
          // the postmaster: about a second, several under load.
          timer = setTimeout(
            () => reject(observed.failure("console host identity timed out")),
            30_000,
          );
        });
      } catch (error) {
        if (child.exitCode === null && child.signalCode === null) {
          child.kill();
          await observed.exited;
        }
        throw error;
      } finally {
        clearTimeout(timer);
      }
      return {
        pid,
        ...observed,
        failure: (reason: string) =>
          observed.failure(
            `${reason}; postmaster pid ${pid}, host pid ${child.pid}, sharedConsole=${launch.ipc}, windowsHide=true`,
          ),
        async stop() {
          await stopPostgres(layout, tools);
          // pg_ctl observes the postmaster; the console host may need one more
          // event-loop turn to forward that exit and release its own handles.
          if (initialized)
            await waitFor(
              async () => child.exitCode !== null || child.signalCode !== null,
              2000,
              25,
            );
          if (child.exitCode === null && child.signalCode === null) {
            if (initialized)
              throw new Error(
                "PostgreSQL shutdown could not be verified; refusing a hard stop of an initialized server",
              );
            // No postmaster.pid means this owned child failed before the
            // server initialized. It still must not outlive a failed start.
            child.kill();
            await observed.exited;
          }
        },
      };
    },
    async ready() {
      const ready = await postgresReady(layout.ports.db);
      initialized ||= ready;
      return ready;
    },
    async stopOrphan(_identity: ProcessIdentity) {
      await stopPostgres(layout, tools);
    },
  };
}

export function roleConnection(
  layout: NativeLayout,
  role: string,
  password: string,
): Sql {
  return postgres({
    host: "127.0.0.1",
    port: layout.ports.db,
    database: "postgres",
    user: role,
    password,
    max: 1,
    connect_timeout: 10,
    onnotice: () => {},
  });
}

export function superuserConnection(layout: NativeLayout, logins: DbLogins) {
  return roleConnection(layout, SUPERUSER, logins[SUPERUSER] as string);
}

async function psqlFile(
  layout: NativeLayout,
  tools: NativeTools,
  role: string,
  password: string,
  file: string,
  runner: Runner,
): Promise<void> {
  const result = await runTool("psql.exe", layout, () =>
    runner(
      tool(tools, "psql"),
      [
        "-X",
        "-q",
        "-w",
        "-v",
        "ON_ERROR_STOP=1",
        "-h",
        "127.0.0.1",
        "-p",
        String(layout.ports.db),
        "-U",
        role,
        "-d",
        "postgres",
        "-f",
        file,
      ],
      {
        env: {
          ...toolEnvironment(layout),
          PGPASSWORD: password,
          PGCLIENTENCODING: "UTF8",
        },
      },
    ),
  );
  if (result.code !== 0) {
    // The pinned scripts hold no credentials, so their first error is safe
    // to show and saves a trip to the server log.
    const reason = /ERROR:\s+(.*)/.exec(result.stderr)?.[1]?.trim();
    throw new Error(
      `Database base script failed: ${basename(file)}${reason ? ` (${reason})` : ""}`,
    );
  }
}

interface BaseSource {
  commit: string;
  skip: Record<string, string>;
}

export function baseScripts(directory = join(nativeAssets, "postgres")): {
  init: string[];
  migrations: string[];
  supplement: string[];
  skipped: string[];
} {
  const source = JSON.parse(
    readFileSync(join(directory, "source.json"), "utf8"),
  ) as BaseSource;
  const list = (folder: string) =>
    readdirSync(join(directory, folder))
      .filter((name) => name.endsWith(".sql"))
      .sort()
      .map((name) => join(directory, folder, name));
  const all = list("migrations");
  const skipped = Object.keys(source.skip);
  for (const name of skipped)
    if (!all.some((file) => basename(file) === name))
      throw new Error(`Skipped base migration does not exist: ${name}`);
  return {
    init: list("init-scripts"),
    migrations: all.filter((file) => !skipped.includes(basename(file))),
    supplement: list("supplement"),
    skipped,
  };
}

/** Supabase roles, schemas and grants on a new cluster, in the order of the
 * pinned migrate.sh: init scripts as postgres, migrations as the superuser.
 * The supplement holds what plain PostgreSQL needs in place of supautils.
 */
export async function applyBaseSchema(
  layout: NativeLayout,
  tools: NativeTools,
  logins: DbLogins,
  runner: Runner = realRunner,
): Promise<void> {
  const admin = superuserConnection(layout, logins);
  try {
    // Utility statements cannot bind a password; format() quotes it.
    const [row] =
      await admin`select format('create role postgres superuser login password %L', ${logins.postgres as string}::text) as ddl`;
    if (!row) throw new Error("Cannot quote role statement");
    await admin.unsafe(row.ddl as string);
    await admin`alter database postgres owner to postgres`;
  } finally {
    await admin.end();
  }
  const scripts = baseScripts();
  for (const file of scripts.init)
    await psqlFile(
      layout,
      tools,
      "postgres",
      logins.postgres as string,
      file,
      runner,
    );
  for (const file of [...scripts.migrations, ...scripts.supplement])
    await psqlFile(
      layout,
      tools,
      SUPERUSER,
      logins[SUPERUSER] as string,
      file,
      runner,
    );
}

/** Give every login role its own stored password. With probe, also prove
 * that none of them still accepts the well-known default.
 */
export async function applyLogins(
  layout: NativeLayout,
  logins: DbLogins,
  passwordFor: (role: string) => Promise<string>,
  probe: boolean,
): Promise<void> {
  const admin = superuserConnection(layout, logins);
  let roles: string[];
  try {
    roles = (
      await admin`select rolname from pg_catalog.pg_roles where rolcanlogin order by rolname`
    ).map((row) => row.rolname as string);
    const passwords = new Map<string, string>();
    for (const role of roles) passwords.set(role, await passwordFor(role));
    await admin.begin(async (tx) => {
      for (const role of roles) {
        const password = passwords.get(role) as string;
        const [row] =
          await tx`select format('alter role %I password %L', ${role}::text, ${password}::text) as ddl`;
        if (!row) throw new Error("Cannot quote role statement");
        await tx.unsafe(row.ddl as string);
      }
    });
  } finally {
    await admin.end();
  }
  if (!probe) return;
  for (const role of roles) {
    const attempt = roleConnection(layout, role, "postgres");
    try {
      await attempt`select 1`;
      throw new Error("Default database password remains accepted");
    } catch (error) {
      if ((error as { code?: string }).code !== "28P01") throw error;
    } finally {
      await attempt.end();
    }
  }
}

/** First boot only. The pending marker is written before anything exists and
 * replaced by the done marker only after the base schema is complete.
 */
export async function createCluster(
  layout: NativeLayout,
  tools: NativeTools,
  logins: DbLogins,
): Promise<void> {
  const marks = witness(layout);
  mkdirSync(layout.root, { recursive: true });
  writeFileSync(marks.pending, new Date().toISOString());
  await initCluster(layout, tools, logins[SUPERUSER] as string);
  writeServerConfig(layout);
}

export function completeFirstBoot(layout: NativeLayout): void {
  const marks = witness(layout);
  renameSync(marks.pending, marks.done);
}
