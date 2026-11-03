import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { ENV_TABLE } from "./envs.js";
import { loginPasswords } from "./logins.js";
import { writePrivateOnce } from "./private-file.js";
import { type Runner, realRunner } from "./run.js";
import { loadStackSecrets } from "./stack-secrets.js";

const secretDir = () => dirname(ENV_TABLE.prod.signingKeysPath);
export const rotationMarker = () => join(secretDir(), "rotation-pending");

export function legacyPassword(env: string[]): string {
  const values = env.filter((entry) => entry.startsWith("POSTGRES_PASSWORD="));
  if (values.length !== 1 || !values[0]?.slice(18))
    throw new Error("Legacy database password is unavailable");
  return values[0].slice(18);
}

export async function bootstrapProductionSecrets(runner: Runner = realRunner) {
  const dbFile = join(secretDir(), "db-passwords.json");
  if (existsSync(dbFile)) {
    await loadStackSecrets("prod");
    return;
  }
  const inspected = await runner("docker", [
    "inspect",
    "supabase_db_mellodifai",
    "--format",
    "{{json .Config.Env}}",
  ]);
  if (inspected.code !== 0) throw new Error("Cannot inspect legacy database");
  const shared = legacyPassword(JSON.parse(inspected.stdout) as string[]);
  const inventory = await runner("docker", [
    "exec",
    "supabase_db_mellodifai",
    "psql",
    "-U",
    "postgres",
    "-d",
    "postgres",
    "-Atc",
    "select rolname from pg_roles where rolcanlogin order by rolname",
  ]);
  if (inventory.code !== 0)
    throw new Error("Cannot inventory legacy database roles");
  const roles = inventory.stdout.trim().split(/\r?\n/u).filter(Boolean);
  if (
    !roles.includes("postgres") ||
    roles.some((role) => !/^[a-z_][a-z0-9_]*$/u.test(role))
  )
    throw new Error("Invalid legacy database role inventory");
  await loadStackSecrets("prod", true);
  await writePrivateOnce(rotationMarker(), "pending\n");
  await writePrivateOnce(
    dbFile,
    JSON.stringify(
      loginPasswords(
        [...new Set([...roles, "mdf_web", "mdf_auth"])],
        shared,
        {},
      ),
    ),
  );
}
