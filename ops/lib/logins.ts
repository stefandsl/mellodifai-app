import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import postgres from "postgres";
import { ENV_TABLE, type StackEnv, stackDir } from "./envs.js";
import { resolveRuntime } from "./native/layout.js";
import { databaseUrl } from "./pg.js";
import { writePrivate } from "./private-file.js";
import { randomPassword, readStackPasswords } from "./roles.js";
import type { Runner } from "./run.js";

const active = new Set([
  "postgres",
  "supabase_admin",
  "authenticator",
  "supabase_auth_admin",
  "supabase_storage_admin",
]);
export function loginPasswords(
  roles: string[],
  shared: string,
  saved: Record<string, string>,
): Record<string, string> {
  return Object.fromEntries(
    roles.map((role) => [
      role,
      active.has(role) ? shared : (saved[role] ?? randomPassword()),
    ]),
  );
}

/** Compose fallback from Spike 2: active services share POSTGRES_PASSWORD.
 * Production rotation/probes are owned by Tasks 8/10, never bootstrap defaults.
 */
export async function provisionTestLogins(
  env: StackEnv,
  shared: string,
  runner: Runner,
  privateEnv: Record<string, string>,
  runtime = resolveRuntime(undefined),
): Promise<void> {
  if (runtime === "native")
    throw new Error(
      "Docker login provisioning is unavailable on native; use stack.ts start",
    );
  if (env === "prod") return;
  const dir = stackDir(env);
  const args = [
    "compose",
    "-p",
    ENV_TABLE[env].projectId,
    "-f",
    join(dir, "compose.json"),
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
  const inventory = await runner("docker", args, {
    env: privateEnv,
    input: "select rolname from pg_roles where rolcanlogin order by rolname;",
  });
  if (inventory.code !== 0)
    throw new Error("Cannot inventory stack login roles");
  const roles = inventory.stdout.trim().split(/\r?\n/).filter(Boolean);
  if (!roles.includes("postgres"))
    throw new Error("Invalid stack login inventory");
  const path = join(dir, "login-passwords.json");
  const saved = existsSync(path) ? JSON.parse(readFileSync(path, "utf8")) : {};
  const passwords = loginPasswords(roles, shared, {
    ...saved,
    ...(await readStackPasswords(env)),
  });
  await writePrivate(path, JSON.stringify(passwords));
  const quoteIdentifier = (value: string) => `"${value.replaceAll('"', '""')}"`;
  const quoteLiteral = (value: string) => `'${value.replaceAll("'", "''")}'`;
  const input = `set standard_conforming_strings = on;\n${Object.entries(
    passwords,
  )
    .map(
      ([role, password]) =>
        `alter role ${quoteIdentifier(role)} password ${quoteLiteral(password)};`,
    )
    .join("\n")}`;
  const changed = await runner("docker", args, { env: privateEnv, input });
  if (changed.code !== 0) throw new Error("Cannot provision stack login roles");
  for (const [role, password] of Object.entries(passwords)) {
    const sql = postgres(databaseUrl(role, password, ENV_TABLE[env].ports.db), {
      max: 1,
      connect_timeout: 5,
      onnotice: () => {},
    });
    try {
      await sql`select 1`;
    } finally {
      await sql.end();
    }
    const defaultSql = postgres(
      databaseUrl(role, "postgres", ENV_TABLE[env].ports.db),
      { max: 1, connect_timeout: 5, onnotice: () => {} },
    );
    let rejected = false;
    try {
      await defaultSql`select 1`;
    } catch (error) {
      if ((error as { code?: string }).code === "28P01") rejected = true;
      else throw error;
    } finally {
      await defaultSql.end();
    }
    if (!rejected)
      throw new Error("Default stack login password remains accepted");
  }
}
