import { randomBytes } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { TransactionSql } from "postgres";
import { runtimePath, type StackEnv, stackDir } from "./envs.js";
import { ownerConnection } from "./pg.js";
import { writePrivateOnce } from "./private-file.js";
import { runtimeRoot } from "./runtime.js";

export type RolePasswords = { mdf_web: string; mdf_auth: string };
export const randomPassword = () => randomBytes(32).toString("hex");

export async function readStackPasswords(
  env: StackEnv,
): Promise<RolePasswords> {
  const path = runtimePath(
    env === "prod"
      ? join(runtimeRoot(), "secrets/supabase/db-passwords.json")
      : join(stackDir(env), "role-passwords.json"),
  );
  // RUNNER_TEMP is unique to a CI job. Persist there so separate CLI invocations
  // (start, migrate, env-file) all use the same per-run values.
  if (!existsSync(path) && env !== "prod")
    await writePrivateOnce(
      path,
      JSON.stringify({ mdf_web: randomPassword(), mdf_auth: randomPassword() }),
    );
  if (!existsSync(path))
    throw new Error(
      "Production database passwords must be provisioned by Task 8",
    );
  const data = JSON.parse(readFileSync(path, "utf8")) as RolePasswords;
  for (const role of ["mdf_web", "mdf_auth"] as const)
    if (
      typeof data[role] !== "string" ||
      !data[role] ||
      data[role].includes("\0")
    )
      throw new Error("Invalid stored role password");
  return { mdf_web: data.mdf_web, mdf_auth: data.mdf_auth };
}

/** Transaction seam permits fixtures that roll back every cluster-wide change. */
export async function applyRolePasswordsInTransaction(
  sql: TransactionSql,
  passwords: RolePasswords,
) {
  const result: { set: string[]; absent: string[] } = { set: [], absent: [] };
  for (const role of ["mdf_web", "mdf_auth"] as const) {
    const rows =
      await sql`select rolname from pg_catalog.pg_roles where rolname = ${role}`;
    if (rows.length === 0) {
      result.absent.push(role);
      continue;
    }
    // Utility statements cannot bind PASSWORD parameters. PostgreSQL's own
    // format quotes both identifiers and literals, including quotes/backslashes.
    const [statement] =
      await sql`select format('alter role %I login password %L', ${role}::text, ${passwords[role]}::text) as ddl`;
    if (!statement) throw new Error("Cannot quote role statement");
    await sql.unsafe(statement.ddl);
    result.set.push(role);
  }
  return result;
}

export async function applyRolePasswords(
  ownerUrl: string,
  passwords: RolePasswords,
) {
  const sql = ownerConnection(ownerUrl);
  try {
    return await sql.begin((tx) =>
      applyRolePasswordsInTransaction(tx, passwords),
    );
  } finally {
    await sql.end();
  }
}
