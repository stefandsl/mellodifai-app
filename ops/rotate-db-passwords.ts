import { randomUUID } from "node:crypto";
import { existsSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { composeEnvironment } from "./lib/compose.js";
import { ENV_TABLE, runtimePath, type StackEnv, stackDir } from "./lib/envs.js";
import { loginPasswords } from "./lib/logins.js";
import { databaseUrl } from "./lib/pg.js";
import { writePrivate } from "./lib/private-file.js";
import { applyRolePasswords, randomPassword } from "./lib/roles.js";
import { type Runner, realRunner } from "./lib/run.js";
import { runtimeRoot } from "./lib/runtime.js";
import { loadStackSecrets } from "./lib/stack-secrets.js";

function passwordFile(env: StackEnv) {
  return runtimePath(
    env === "prod"
      ? join(runtimeRoot(), "secrets/supabase/db-passwords.json")
      : join(stackDir(env), "login-passwords.json"),
  );
}

// A fresh file drops any old explicit ACL grants, then atomically replaces it.
async function replacePrivate(file: string, content: string) {
  runtimePath(file);
  const temp = `${file}.${randomUUID()}.tmp`;
  await writePrivate(temp, content);
  renameSync(temp, file);
}

function composeArgs(env: StackEnv) {
  if (
    !Object.hasOwn(ENV_TABLE, env) ||
    (env === "ci" && process.env.CI !== "true")
  )
    throw new Error("Invalid stack environment");
  return [
    "compose",
    "-p",
    ENV_TABLE[env].projectId,
    "-f",
    join(stackDir(env), "compose.json"),
  ];
}

async function sqlCommand(env: StackEnv, runner: Runner, input: string) {
  const keyPath = ENV_TABLE[env]?.signingKeysPath;
  if (
    !keyPath ||
    !existsSync(keyPath) ||
    !existsSync(join(dirname(keyPath), "stack-secrets.json"))
  )
    throw new Error("Render the stack before database provisioning");
  const args = [
    ...composeArgs(env),
    "exec",
    "-T",
    "db",
    "psql",
    "-U",
    "supabase_admin",
    "-d",
    "postgres",
    "-v",
    "ON_ERROR_STOP=1",
    "-At",
  ];
  const privateEnv = composeEnvironment(env, await loadStackSecrets(env, true));
  const result = await runner("docker", args, { env: privateEnv, input });
  if (result.code !== 0)
    throw new Error("Database provisioning command failed");
  return result.stdout;
}

export async function inventoryDbLogins(
  env: StackEnv,
  runner: Runner,
): Promise<string[]> {
  const output = await sqlCommand(
    env,
    runner,
    "select rolname from pg_roles where rolcanlogin or rolname in ('mdf_web', 'mdf_auth') order by rolname;",
  );
  const roles = output.trim().split(/\r?\n/).filter(Boolean);
  if (
    !roles.includes("postgres") ||
    roles.some((role) => !/^[a-z_][a-z0-9_]*$/.test(role))
  )
    throw new Error("Invalid database login inventory");
  return roles;
}

export function readDbPasswords(env: StackEnv): Record<string, string> {
  const data: unknown = JSON.parse(readFileSync(passwordFile(env), "utf8"));
  if (
    !data ||
    typeof data !== "object" ||
    Array.isArray(data) ||
    Object.entries(data).some(
      ([role, value]) =>
        !/^[a-z_][a-z0-9_]*$/.test(role) ||
        typeof value !== "string" ||
        !value ||
        value === "postgres" ||
        /[\0\r\n]/.test(value),
    )
  )
    throw new Error("Invalid database credential store");
  return data as Record<string, string>;
}

export async function rewriteEnvUrl(
  file: string,
  name: string,
  url: string,
): Promise<void> {
  runtimePath(file);
  if (
    !/^MDF_(WEB|AUTH)_DATABASE_URL$/.test(name) ||
    /[\r\n\0]/.test(url) ||
    new URL(url).protocol !== "postgresql:"
  )
    throw new Error("Invalid database environment entry");
  const previous = existsSync(file) ? readFileSync(file, "utf8") : "";
  const matcher = new RegExp(`^\\s*(?:export\\s+)?${name}\\s*=`);
  const lines = previous.split(/\r?\n/).filter((line) => !matcher.test(line));
  while (lines.at(-1) === "") lines.pop();
  // URL encoding prevents dotenv expansion of password punctuation.
  const parsed = new URL(url);
  parsed.password = encodeURIComponent(
    decodeURIComponent(parsed.password),
  ).replaceAll("$", "%24");
  const content = `${[...lines, `${name}="${parsed.href}"`].join("\n")}\n`;
  // services install owns the app ACLs; keep its service-account read grants.
  if (existsSync(file)) writeFileSync(file, content, { encoding: "utf8" });
  else await replacePrivate(file, content);
}

export async function rotateDbPasswords(
  env: StackEnv,
  runner: Runner,
): Promise<void> {
  const roles = await inventoryDbLogins(env, runner);
  if (!roles.includes("mdf_web") || !roles.includes("mdf_auth"))
    throw new Error(
      "Application database roles are absent; apply the roles migration",
    );
  const passwords = loginPasswords(
    [...new Set([...roles, "mdf_web", "mdf_auth"])],
    randomPassword(),
    {},
  );
  // Persist before mutation so an interrupted rotation can be re-applied.
  await replacePrivate(passwordFile(env), JSON.stringify(passwords));
  await reapplyDbPasswords(env, runner);
}

export async function reapplyDbPasswords(
  env: StackEnv,
  runner: Runner,
): Promise<void> {
  const passwords = readDbPasswords(env);
  const roles = await inventoryDbLogins(env, runner);
  if (!roles.includes("mdf_web") || !roles.includes("mdf_auth"))
    throw new Error(
      "Application database roles are absent; apply the roles migration",
    );
  if (
    [...roles, "mdf_web", "mdf_auth"].some(
      (role) => !Object.hasOwn(passwords, role),
    )
  )
    throw new Error(
      "Database credential inventory changed; rotate before starting services",
    );
  const shared = passwords.postgres;
  if (
    !shared ||
    Object.entries(loginPasswords(roles, shared, passwords)).some(
      ([role, value]) => passwords[role] !== value,
    )
  )
    throw new Error(
      "Database credentials violate the Compose service contract",
    );
  const quote = (value: string) => `'${value.replaceAll("'", "''")}'`;
  await sqlCommand(
    env,
    runner,
    `begin; set local standard_conforming_strings = on;\n${roles
      .filter((role) => role !== "mdf_web" && role !== "mdf_auth")
      .map(
        (role) =>
          `alter role "${role}" password ${quote(passwords[role] as string)};`,
      )
      .join("\n")}\ncommit;`,
  );
  const appPasswords = {
    mdf_web: passwords.mdf_web as string,
    mdf_auth: passwords.mdf_auth as string,
  };
  const applied = await applyRolePasswords(
    databaseUrl("postgres", shared, ENV_TABLE[env].ports.db),
    appPasswords,
  );
  if (applied.absent.length)
    throw new Error(
      "Application database roles are absent; apply the roles migration",
    );
  const secrets = await loadStackSecrets(env, true);
  secrets.postgres = shared;
  if (env !== "prod") {
    await replacePrivate(
      join(dirname(ENV_TABLE[env].signingKeysPath), "stack-secrets.json"),
      JSON.stringify(secrets),
    );
    await replacePrivate(
      join(stackDir(env), "role-passwords.json"),
      JSON.stringify(appPasswords),
    );
  }
  const result = await runner(
    "docker",
    [
      ...composeArgs(env),
      "up",
      "-d",
      "--pull",
      "never",
      "--wait",
      "--wait-timeout",
      "180",
    ],
    { env: composeEnvironment(env, secrets) },
  );
  if (result.code !== 0) throw new Error("Database service re-template failed");
  for (const role of [...new Set([...roles, "mdf_web", "mdf_auth"])]) {
    const login = await runner(
      "docker",
      [
        "run",
        "--rm",
        "--network",
        "bridge",
        "--add-host",
        "host.docker.internal:host-gateway",
        "-e",
        "PGPASSWORD",
        "-e",
        "PGCONNECT_TIMEOUT=5",
        "postgres:17",
        "psql",
        "-w",
        "-h",
        "host.docker.internal",
        "-p",
        String(ENV_TABLE[env].ports.db),
        "-U",
        role,
        "-d",
        "postgres",
        "-c",
        "select 1",
      ],
      {
        env: { PGPASSWORD: passwords[role] as string, PGCONNECT_TIMEOUT: "5" },
      },
    );
    if (login.code !== 0)
      throw new Error(`Database login verification failed: ${role}`);
  }
  const appRoot =
    env === "prod" ? join(runtimeRoot(), "deploy") : stackDir(env);
  for (const app of ["web", "auth"] as const)
    await rewriteEnvUrl(
      join(appRoot, "apps", app, ".env.local"),
      `MDF_${app.toUpperCase()}_DATABASE_URL`,
      databaseUrl(
        `mdf_${app}`,
        appPasswords[`mdf_${app}`],
        ENV_TABLE[env].ports.db,
      ),
    );
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  const args = process.argv.slice(2);
  const env = args[1] as StackEnv;
  if (
    args.length !== 2 ||
    args[0] !== "--env" ||
    !Object.hasOwn(ENV_TABLE, env)
  ) {
    process.stderr.write(
      "Usage: rotate-db-passwords.ts --env <prod|dev|e2e|ci>\n",
    );
    process.exitCode = 1;
  } else
    rotateDbPasswords(env, realRunner).catch(() => {
      process.stderr.write(
        "Database rotation failed; restore prerequisites and reapply the stored credentials\n",
      );
      process.exitCode = 1;
    });
}
