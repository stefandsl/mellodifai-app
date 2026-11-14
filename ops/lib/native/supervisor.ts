import { existsSync, mkdirSync, readFileSync, rmSync } from "node:fs";
import { createServer } from "node:http";
import { createRequire } from "node:module";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { ENV_TABLE, type StackEnv, stackDir } from "../envs.js";
import { databaseUrl } from "../pg.js";
import { writePrivate } from "../private-file.js";
import { applyRolePasswords, readStackPasswords } from "../roles.js";
import { loadSmtpEnvironment } from "../smtp.js";
import { loadStackSecrets } from "../stack-secrets.js";
import { type NativeTools, nativeTools } from "./build.js";
import { NativeDiagnosticError, safeFailure } from "./diagnostics.js";
import { processIdentities } from "./host.js";
import { assertNoMaintenance } from "./journal.js";
import { type NativeLayout, nativeLayout } from "./layout.js";
import { acquireLease } from "./lease.js";
import { applyAppMigrations, applyStackSettings } from "./migrate.js";
import {
  GATEWAY_CONFIG_FILE,
  gatewayConfig,
  migrationEnvironments,
  nativePlan,
  type ProcessSpec,
} from "./plan.js";
import {
  applyBaseSchema,
  applyLogins,
  completeFirstBoot,
  createCluster,
  firstBootState,
  postgresService,
  roleConnection,
} from "./postgres.js";
import {
  childService,
  type Definition,
  runLogged,
  type ServiceDefinition,
  Supervisor,
  writeState,
} from "./processes.js";
import { readRollback } from "./rollback.js";
import {
  loadHopSecret,
  loadNativeLogins,
  type NativeLogins,
} from "./secrets.js";
import { nativeSourceRoot } from "./source.js";

const opsDir = fileURLToPath(new URL("../../", import.meta.url));
const repo = nativeSourceRoot();

export const statePath = (layout: NativeLayout) =>
  join(layout.run, "state.json");
export const stopRequestPath = (layout: NativeLayout) =>
  join(layout.run, "stop-request");

export function tsxRuntime(): { node: string; cli: string } {
  return {
    node: process.execPath,
    cli: createRequire(import.meta.url).resolve("tsx/cli"),
  };
}

export interface NativeContext {
  env: StackEnv;
  layout: NativeLayout;
  tools: NativeTools;
  native: NativeLogins;
  specs: ProcessSpec[];
}

/** Everything a running stack needs, read from the rendered stack folder and
 * the secret store. Requires `render` to have run.
 */
export async function nativeContext(env: StackEnv): Promise<NativeContext> {
  const layout = nativeLayout(env);
  const tools = nativeTools();
  const secrets = await loadStackSecrets(env);
  const native = await loadNativeLogins(env);
  const hopSecret = await loadHopSecret(env);
  const toml = readFileSync(
    join(stackDir(env), "supabase/config.toml"),
    "utf8",
  );
  const specs = nativePlan({
    env,
    layout,
    tools,
    toml,
    secrets,
    logins: native.logins,
    hopSecret,
    smtp: await loadSmtpEnvironment(env),
    tsx: tsxRuntime(),
    opsDir,
  });
  for (const directory of [
    layout.logs,
    layout.run,
    layout.config,
    layout.tmp,
    layout.objects,
  ])
    mkdirSync(directory, { recursive: true });
  await writePrivate(
    join(layout.config, GATEWAY_CONFIG_FILE),
    JSON.stringify(gatewayConfig(env, layout, secrets, hopSecret)),
  );
  return { env, layout, tools, native, specs };
}

/** Auth fetches its mail templates over HTTP only. This loopback listener
 * serves the staged template files and nothing else.
 */
function templateService(layout: NativeLayout): ServiceDefinition {
  const url = `http://127.0.0.1:${layout.ports.templates}`;
  return {
    kind: "service",
    id: "templates",
    dependsOn: [],
    async ready() {
      const response = await fetch(`${url}/healthz`, {
        signal: AbortSignal.timeout(3_000),
      });
      await response.body?.cancel();
      return response.status === 200;
    },
    async start() {
      const server = createServer((request, response) => {
        const name = /^\/([a-z_]+\.html)$/.exec(request.url ?? "")?.[1];
        const file = name ? join(layout.templates, name) : null;
        if (request.method === "GET" && request.url === "/healthz")
          response.writeHead(200).end("ok");
        else if (request.method === "GET" && file && existsSync(file))
          response
            .writeHead(200, { "content-type": "text/html; charset=utf-8" })
            .end(readFileSync(file));
        else response.writeHead(404).end();
      });
      await new Promise<void>((done, fail) => {
        server.once("error", fail);
        server.listen(layout.ports.templates, "127.0.0.1", done);
      });
      return {
        pid: process.pid,
        // It lives exactly as long as the supervisor itself.
        exited: new Promise<void>(() => {}),
        stop: () =>
          new Promise<void>((done) => {
            server.close(() => done());
            server.closeAllConnections();
          }),
      };
    },
  };
}

async function migrateService(
  name: string,
  spec: ProcessSpec,
  args: string[],
  layout: NativeLayout,
): Promise<void> {
  const log = join(layout.logs, `${name}-migrate.log`);
  const code = await runLogged(spec.command, args, {
    cwd: spec.cwd,
    env: spec.env,
    logFile: log,
  });
  if (code !== 0)
    throw new Error(`${name} migrations failed (exit ${code}); see ${log}`);
}

/** Bring the database to the state the services expect. Only the base schema
 * is first-boot work; everything after it is idempotent and runs every start.
 */
export async function prepareDatabase(
  context: NativeContext,
  fresh: boolean,
  log: (message: string) => void,
): Promise<void> {
  const { layout, tools, native } = context;
  if (fresh) {
    log("database: applying the Supabase base schema");
    await applyBaseSchema(layout, tools, native.logins);
    completeFirstBoot(layout);
  }
  await applyLogins(layout, native.logins, native.passwordFor, false);
  const { auth, storage } = migrationEnvironments(context.specs);
  log("database: Auth migrations");
  await migrateService("auth", auth, ["migrate"], layout);
  log("database: Storage migrations");
  await migrateService(
    "storage",
    storage,
    ["dist/scripts/migrate-call.js"],
    layout,
  );
  await migrateApp(context, log);
}

/** App migrations, stack settings and login passwords: the native equivalent
 * of the Docker runtime's migrate step.
 */
export async function migrateApp(
  context: NativeContext,
  log: (message: string) => void,
): Promise<string[]> {
  const { layout, native, env } = context;
  const sql = roleConnection(
    layout,
    "postgres",
    native.logins.postgres as string,
  );
  let applied: string[];
  let stage = "app migrations";
  try {
    try {
      applied = await applyAppMigrations(
        sql,
        join(repo, "supabase/migrations"),
        log,
        readRollback(layout),
      );
      stage = "stack settings";
      await applyStackSettings(sql, ENV_TABLE[env].fakeStack);
    } finally {
      await sql.end();
    }
    // Same step as the Docker runtime: the app roles get LOGIN and their
    // stored passwords from postgres, the role that created them.
    stage = "app role credentials";
    await applyRolePasswords(
      databaseUrl(
        "postgres",
        native.logins.postgres as string,
        layout.ports.db,
      ),
      await readStackPasswords(env),
    );
    stage = "login normalization and default-login probes";
    await applyLogins(layout, native.logins, native.passwordFor, true);
    return applied;
  } catch (error) {
    throw new NativeDiagnosticError(
      `Native database preparation failed at ${stage}: ${safeFailure(error)}`,
    );
  }
}

export function nativeDefinitions(
  context: NativeContext,
  fresh: boolean,
  log: (message: string) => void,
): Definition[] {
  const { layout, tools, native } = context;
  const services: Definition[] = context.specs.map((spec) => ({
    kind: "service",
    id: spec.id,
    dependsOn: spec.dependsOn,
    ...childService(spec, join(layout.logs, `${spec.id}.log`)),
  }));
  return [
    {
      kind: "task",
      id: "cluster",
      dependsOn: [],
      async run() {
        if (fresh) {
          log("cluster: creating the PostgreSQL data folder");
          await createCluster(layout, tools, native.logins);
        }
      },
    },
    postgresService(layout, tools),
    {
      kind: "task",
      id: "database",
      dependsOn: ["postgres"],
      run: () => prepareDatabase(context, fresh, log),
    },
    templateService(layout),
    ...services,
  ];
}

async function main(env: StackEnv): Promise<void> {
  assertNoMaintenance(nativeLayout(env));
  // Separate from the command lease: this survives the initiating CLI.
  await acquireLease(
    join(nativeLayout(env).root, "supervisor.lease"),
    "supervisor",
  );
  const log = (message: string) =>
    process.stdout.write(`${new Date().toISOString()} ${message}\n`);
  const context = await nativeContext(env);
  const { layout } = context;
  const self = (await processIdentities([process.pid])).get(process.pid);
  if (!self) throw new Error("Cannot identify the supervisor process");
  const fresh = firstBootState(layout) === "new";
  rmSync(stopRequestPath(layout), { force: true });
  const supervisor = new Supervisor(
    nativeDefinitions(context, fresh, log),
    self,
    { statePath: statePath(layout), log },
  );
  let stopping = false;
  const watch = setInterval(() => {
    if (stopping || !existsSync(stopRequestPath(layout))) return;
    stopping = true;
    log("stop requested");
    supervisor
      .stop()
      .then(
        () => 0,
        () => 1,
      )
      .then((code) => {
        rmSync(stopRequestPath(layout), { force: true });
        process.exit(code);
      });
  }, 500);
  try {
    await supervisor.start();
    log("stack ready");
  } catch (error) {
    clearInterval(watch);
    log(`start failed: ${error instanceof Error ? error.message : "error"}`);
    process.exit(1);
  }
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  const env = process.argv[2] as StackEnv;
  if (!Object.hasOwn(ENV_TABLE, env)) {
    process.stderr.write("Usage: supervisor.ts <env>\n");
    process.exit(2);
  }
  main(env).catch((error: unknown) => {
    // Configuration errors are operator-safe; anything else is reduced.
    const message = error instanceof Error ? error.message : "error";
    const safe = /password|postgres:|JWT|token/i.test(message)
      ? "configuration or database error"
      : message;
    writeState(statePath(nativeLayout(env)), {
      supervisor: { pid: process.pid, startedAt: "" },
      phase: "failed",
      error: safe,
      updatedAt: new Date().toISOString(),
      services: {},
    });
    process.stdout.write(
      `${new Date().toISOString()} supervisor failed: ${safe}\n`,
    );
    process.exit(1);
  });
}
