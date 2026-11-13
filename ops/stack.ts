import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { composeEnvironment, prepareCompose } from "./lib/compose.js";
import { ENV_TABLE, runtimePath, type StackEnv, stackDir } from "./lib/envs.js";
import { provisionTestLogins } from "./lib/logins.js";
import { resolveRuntime } from "./lib/native/layout.js";
import { type NativeFlags, runNativeCommand } from "./lib/native/stack.js";
import { databaseUrl, ownerConnection } from "./lib/pg.js";
import { writePrivate } from "./lib/private-file.js";
import { prepareStackDir, renderConfig } from "./lib/render.js";
import {
  applyRolePasswords,
  type RolePasswords,
  readStackPasswords,
} from "./lib/roles.js";
import { type Runner, realRunner } from "./lib/run.js";
import { runtimeRoot } from "./lib/runtime.js";
import { loadSmtpEnvironment } from "./lib/smtp.js";
import { loadStackSecrets } from "./lib/stack-secrets.js";

import { assertWindowsPorts } from "./lib/windows-ports.js";

import { isRestoreAuthorization } from "./restore.js";

type Flags = { noBackup?: boolean | undefined; restore?: unknown };
const commands = [
  "render",
  "start",
  "stop",
  "migrate",
  "reset",
  "env-file",
  "db reset",
];
const repo = fileURLToPath(new URL("../", import.meta.url));

export function planStackCommand(
  cmd: string,
  env: StackEnv,
  flags: Flags,
): string[][] {
  if (!Object.hasOwn(ENV_TABLE, env) || !commands.includes(cmd))
    throw new Error("Unknown stack command or environment");
  if (
    ENV_TABLE[env].projectId === "mellodifai" &&
    (((cmd === "reset" || cmd === "db reset") &&
      !isRestoreAuthorization(flags.restore)) ||
      (cmd === "stop" && flags.noBackup))
  )
    throw new Error("Production reset is refused; use ops/restore.ts");
  if (flags.noBackup && cmd !== "stop")
    throw new Error("--no-backup is only valid for stop");
  const dir = stackDir(env);
  const compose = [
    "docker",
    "compose",
    "-p",
    ENV_TABLE[env].projectId,
    "-f",
    join(dir, "compose.json"),
  ];
  if (cmd === "start")
    return [
      [
        ...compose,
        "up",
        "-d",
        "--pull",
        "never",
        "--wait",
        "--wait-timeout",
        "180",
      ],
      [...compose, "restart", "kong"],
    ];
  // Even --no-backup preserves bind mounts. Reset is a separate explicit operation.
  if (cmd === "stop") return [[...compose, "stop"]];
  if (["migrate", "reset", "db reset"].includes(cmd)) {
    const cli = [
      process.execPath,
      createRequire(import.meta.url).resolve("supabase/dist/supabase.js"),
    ];
    return [
      [
        ...cli,
        ...(cmd === "migrate"
          ? ["migration", "up"]
          : ["db", "reset", "--yes", "--no-seed"]),
        "--workdir",
        dir,
        ...(cmd === "migrate"
          ? ["--db-url", databaseUrl("postgres", "", ENV_TABLE[env].ports.db)]
          : [
              `--remote=${databaseUrl("postgres", "", ENV_TABLE[env].ports.db)}`,
            ]),
      ],
    ];
  }
  return [];
}

export async function writeTestEnv(
  env: StackEnv,
  secrets: { postgres: string; anon: string; service: string },
  passwords: RolePasswords,
): Promise<string> {
  if (env === "prod")
    throw new Error("Production credentials cannot be exported to test.env");
  const v = ENV_TABLE[env];
  const web = databaseUrl("mdf_web", passwords.mdf_web, v.ports.db);
  const auth = databaseUrl("mdf_auth", passwords.mdf_auth, v.ports.db);
  const values = {
    SUPABASE_URL: `http://127.0.0.1:${v.ports.api}`,
    SUPABASE_ANON_KEY: secrets.anon,
    SUPABASE_SERVICE_ROLE_KEY: secrets.service,
    TEST_DB_URL: databaseUrl("postgres", secrets.postgres, v.ports.db),
    TEST_MDF_WEB_URL: web,
    TEST_MDF_AUTH_URL: auth,
    MDF_WEB_DATABASE_URL: web,
    MDF_AUTH_DATABASE_URL: auth,
    SUPABASE_INTERNAL_URL: `http://127.0.0.1:${v.ports.api}`,
    SITE_URL: v.siteUrl,
    MAILPIT_URL: `http://127.0.0.1:${v.ports.inbucket}`,
  };
  const path = join(stackDir(env), "test.env");
  const quote = (value: string) => `'${value.replaceAll("'", "'\\''")}'`;
  await writePrivate(
    path,
    `${Object.entries(values)
      .map(([key, value]) => `${key}=${quote(value)}`)
      .join("\n")}\n`,
  );
  return path;
}

interface StackActions {
  checkPorts(): Promise<void>;
  render(): Promise<void>;
  execute(plan: string[][]): Promise<void>;
  migrate(): Promise<void>;
  passwords(): Promise<void>;
  envFile(): Promise<string>;
}

function actions(env: StackEnv, runner: Runner): StackActions {
  const execute = async (plan: string[][]) => {
    if (env === "ci" && process.env.CI !== "true")
      throw new Error(
        "CI stack requires CI=true; CI ports are reserved for isolated runners",
      );
    const secrets = await loadStackSecrets(env);
    const runtime =
      env === "ci" ? dirname(stackDir(env)) : runtimePath(runtimeRoot());
    const temp = runtimePath(join(runtime, "tmp"));
    const cache = runtimePath(
      process.env.npm_config_cache ?? join(runtime, "cache/npm"),
    );
    const config = runtimePath(join(runtime, "config"));
    for (const directory of [temp, cache, config])
      mkdirSync(directory, { recursive: true });
    const privateEnv = {
      ...composeEnvironment(env, secrets),
      TEMP: temp,
      TMP: temp,
      TMPDIR: temp,
      npm_config_cache: cache,
      XDG_CONFIG_HOME: config,
      XDG_CACHE_HOME: runtimePath(join(runtime, "cache")),
      DO_NOT_TRACK: "1",
      PGPASSWORD: secrets.postgres,
      SUPABASE_DB_PASSWORD: secrets.postgres,
    };
    const smtp = plan.some(([cmd]) => cmd === "docker")
      ? await loadSmtpEnvironment(env)
      : { MDF_SMTP_PASS: "" };
    for (const [cmd, ...args] of plan) {
      if (!cmd) throw new Error("Empty stack command");
      // CLI 3 ignores PGPASSWORD for explicit URL targets. Keep credentials out
      // of the pure plan; inject only at the process boundary, never log argv.
      const privateArgs = args.map((arg, index) =>
        args[index - 1] === "--db-url"
          ? databaseUrl("postgres", secrets.postgres, ENV_TABLE[env].ports.db)
          : arg.startsWith("--remote=")
            ? `--remote=${databaseUrl("postgres", secrets.postgres, ENV_TABLE[env].ports.db)}?sslmode=disable`
            : arg,
      );
      // CLI 3 treats a URL matching config db.port as its local Docker stack.
      // Override only its local-port hints to force the explicit Compose SQL target.
      const result = await runner(cmd, privateArgs, {
        env: {
          ...privateEnv,
          ...(cmd === "docker" ? smtp : { MDF_SMTP_PASS: "" }),
          ...(args.includes("reset")
            ? {
                SUPABASE_DB_PORT: "1",
                SUPABASE_DB_SHADOW_PORT: "2",
                SUPABASE_DB_SEED_ENABLED: "false",
              }
            : {}),
        },
      });
      // CLI/database errors may include connection strings. Never echo raw output.
      if (result.code !== 0)
        throw new Error(
          `Stack command failed (exit ${result.code}); service output withheld to protect credentials`,
        );
    }
  };
  return {
    checkPorts: () => assertWindowsPorts(ENV_TABLE[env], runner),
    async render() {
      const dir = stackDir(env);
      prepareStackDir(dir);
      const toml = renderConfig(
        readFileSync(join(repo, "supabase/config.toml"), "utf8"),
        env,
        dir,
      );
      writeFileSync(join(dir, "supabase/config.toml"), toml);
      await loadStackSecrets(env, true);
      if (env !== "prod") await readStackPasswords(env);
      prepareCompose(env, toml);
    },
    execute,
    async migrate() {
      await execute(planStackCommand("migrate", env, {}));
      const secrets = await loadStackSecrets(env);
      const sql = ownerConnection(
        databaseUrl("postgres", secrets.postgres, ENV_TABLE[env].ports.db),
      );
      try {
        await sql`update public.stack_settings set fake_stack = ${ENV_TABLE[env].fakeStack} where id`;
        await sql`notify pgrst, 'reload schema'`;
      } finally {
        await sql.end();
      }
    },
    async passwords() {
      const secrets = await loadStackSecrets(env);
      const url = databaseUrl(
        "postgres",
        secrets.postgres,
        ENV_TABLE[env].ports.db,
      );
      await applyRolePasswords(url, await readStackPasswords(env));
      await provisionTestLogins(
        env,
        secrets.postgres,
        runner,
        composeEnvironment(env, secrets),
      );
      // Confirm SQL readiness instead of trusting only the container exit code.
      const sql = ownerConnection(url);
      try {
        await sql`select 1`;
      } finally {
        await sql.end();
      }
      const api = `http://127.0.0.1:${ENV_TABLE[env].ports.api}`;
      for (let attempt = 0; attempt < 30; attempt++) {
        const headers = {
          apikey: secrets.service,
          Authorization: `Bearer ${secrets.service}`,
        };
        const responses = await Promise.all([
          fetch(`${api}/rest/v1/`, {
            headers,
            signal: AbortSignal.timeout(5000),
          }),
          fetch(`${api}/auth/v1/admin/users?page=1&per_page=1`, {
            headers,
            signal: AbortSignal.timeout(5000),
          }),
        ]);
        const ready = responses.every((response) => response.ok);
        await Promise.all(responses.map((response) => response.body?.cancel()));
        if (ready) return;
        await new Promise((resolve) => setTimeout(resolve, 500));
      }
      throw new Error(
        "Stack API readiness failed after migrations and role provisioning",
      );
    },
    async envFile() {
      return writeTestEnv(
        env,
        await loadStackSecrets(env),
        await readStackPasswords(env),
      );
    },
  };
}

export async function runStackCommand(
  cmd: string,
  env: StackEnv,
  flags: Flags = {},
  dependencies?: StackActions,
): Promise<string | undefined> {
  const plan = planStackCommand(cmd, env, flags);
  const ops = dependencies ?? actions(env, realRunner);
  if (cmd === "render") await ops.render();
  else if (cmd === "env-file") return ops.envFile();
  else if (cmd === "start") {
    await ops.checkPorts();
    await ops.render();
    await ops.execute(plan);
    await ops.migrate();
    await ops.passwords();
    if (env !== "prod") await ops.envFile();
  } else if (cmd === "migrate") {
    await ops.migrate();
    await ops.passwords();
  } else {
    await ops.execute(plan);
    if (
      (cmd === "reset" || cmd === "db reset") &&
      !isRestoreAuthorization(flags.restore)
    ) {
      await ops.passwords();
      if (env !== "prod") await ops.envFile();
    }
  }
}

export interface RuntimeFlags extends Flags, NativeFlags {
  runtime?: string | undefined;
}

/** Entry for the command line and for callers that follow the configured
 * runtime: --runtime, then MELLODIFAI_RUNTIME, then native. The Docker
 * functions above keep their behaviour for callers that name them directly.
 */
export async function runStack(
  cmd: string,
  env: StackEnv,
  flags: RuntimeFlags = {},
): Promise<string | undefined> {
  if (resolveRuntime(flags.runtime) === "docker") {
    if (cmd === "install" || cmd === "status" || flags.initProduction)
      throw new Error("This stack command exists only for the native runtime");
    return runStackCommand(cmd, env, flags);
  }
  return runNativeCommand(cmd, env, flags, {
    writeEnvFile: async (target) =>
      writeTestEnv(
        target,
        await loadStackSecrets(target),
        await readStackPasswords(target),
      ),
    log: (message) => process.stderr.write(`${message}\n`),
  });
}

async function main(args: string[]) {
  const cmd = args.shift();
  let env: StackEnv | undefined;
  const flags: RuntimeFlags = {};
  if (cmd === "db" && args[0] === "reset") {
    // Recognize the dangerous alias so it receives the same explicit refusal.
    args.shift();
    return main(["db reset", ...args]);
  }
  while (args.length) {
    const arg = args.shift();
    if (arg === "--env" && !env) env = args.shift() as StackEnv;
    else if (arg === "--runtime" && flags.runtime === undefined)
      flags.runtime = args.shift() ?? "";
    else if (arg === "--no-backup") flags.noBackup = true;
    else if (arg === "--init-production") flags.initProduction = true;
    else if (arg === "--seed" && args.length)
      flags.seedDirs = [...(flags.seedDirs ?? []), args.shift() as string];
    else throw new Error("Unknown or duplicate stack argument");
  }
  if (!cmd || !env)
    throw new Error(
      "Usage: stack.ts <install|render|start|stop|status|migrate|reset|env-file> --env <env> [--runtime native|docker]",
    );
  const output = await runStack(cmd, env, flags);
  if (output) process.stdout.write(`${output}\n`);
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
)
  main(process.argv.slice(2)).catch((error: unknown) => {
    // Known operator errors contain no secrets; SQL/network errors are redacted.
    const message =
      error instanceof Error ? error.message : "Stack operation failed";
    process.stderr.write(
      `${/password|postgresql:|JWT|token/i.test(message) ? "Stack operation failed; check private provisioning and database readiness" : message}\n`,
    );
    process.exitCode = 1;
  });
