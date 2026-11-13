import { existsSync, readFileSync, renameSync } from "node:fs";
import { dirname, join } from "node:path";
import { runStack } from "../../stack.js";
import { ENV_TABLE, type StackEnv, stackDir } from "../envs.js";
import { writePrivate } from "../private-file.js";
import { randomPassword } from "../roles.js";
import { nativeDatabase } from "./backup.js";
import { NativeDiagnosticError, safeFailure } from "./diagnostics.js";
import { maintenanceDatabase } from "./maintenance.js";
import {
  applyLogins,
  roleConnection,
  superuserConnection,
} from "./postgres.js";
import { loadNativeLogins } from "./secrets.js";

export async function nativeLoginInventory(env: StackEnv): Promise<string[]> {
  const db = await nativeDatabase(env);
  const sql = superuserConnection(db.layout, db.logins);
  try {
    return (
      await sql`select rolname from pg_roles where rolcanlogin order by rolname`
    ).map((row) => row.rolname as string);
  } finally {
    await sql.end();
  }
}
export async function probeNativeLogins(env: StackEnv) {
  const db = await nativeDatabase(env);
  const { logins } = await loadNativeLogins(env);
  const failures: string[] = [];
  for (const role of await nativeLoginInventory(env)) {
    for (const [mode, password] of [
      ["current", logins[role] ?? ""],
      ["default", "postgres"],
      ["empty", ""],
    ]) {
      const sql = roleConnection(db.layout, role as string, password as string);
      try {
        await sql`select 1`;
        if (mode !== "current")
          failures.push(`${role}: ${mode} credential accepted`);
      } catch (error) {
        if (mode === "current" || (error as { code?: string }).code !== "28P01")
          failures.push(`${role}: ${mode} verification failed`);
      } finally {
        await sql.end();
      }
    }
  }
  return { ok: failures.length === 0, failures };
}
export async function reapplyNativeLogins(env: StackEnv): Promise<void> {
  const db = await nativeDatabase(env);
  const native = await loadNativeLogins(env);
  await applyLogins(db.layout, native.logins, native.passwordFor, true);
}
export async function rotateNativeLogins(env: StackEnv): Promise<void> {
  const old = (await loadNativeLogins(env)).logins;
  const roles = await nativeLoginInventory(env);
  const next = Object.fromEntries(
    roles.map((role) => [role, randomPassword()]),
  );
  const secretDir = dirname(ENV_TABLE[env].signingKeysPath);
  const files = [
    join(secretDir, "stack-secrets.json"),
    env === "prod"
      ? join(secretDir, "db-passwords.json")
      : join(stackDir(env), "role-passwords.json"),
    env === "prod"
      ? join(secretDir, "native-logins.json")
      : join(stackDir(env), "native-logins.json"),
  ];
  const previous = Object.fromEntries(
    files.map((file) => [file, readFileSync(file, "utf8")]),
  );
  const pending = join(secretDir, "native-db-rotation.json");
  if (existsSync(pending)) {
    const phase = JSON.parse(readFileSync(pending, "utf8")).phase;
    if (phase !== "rolled-back" && phase !== "complete")
      throw new Error(
        "Native database rotation journal exists; resolve it before rotating again",
      );
    renameSync(pending, `${pending}.${Date.now()}.done`);
  }
  await writePrivate(
    pending,
    JSON.stringify({ phase: "pending", previous, next }),
  );
  let maintenance: Awaited<ReturnType<typeof maintenanceDatabase>>;
  try {
    maintenance = await maintenanceDatabase(env);
  } catch (error) {
    // No ALTER ROLE or credential-store publication has run yet. Preserve the
    // failure, but do not block the next rotation with a false pending update.
    const failure = `Native database rotation failed during preparation: ${safeFailure(error)}; stored credentials unchanged`;
    await writePrivate(
      pending,
      JSON.stringify({ phase: "rolled-back", failure }),
    );
    throw new NativeDiagnosticError(failure);
  }
  const admin = superuserConnection(maintenance.db.layout, old);
  const set = async (passwords: Record<string, string>) =>
    admin.begin(async (tx) => {
      for (const role of roles) {
        const [row] =
          await tx`select format('alter role %I password %L', ${role}::text, ${passwords[role] as string}::text) as ddl`;
        await tx.unsafe(row?.ddl as string);
      }
    });
  let stage = "update roles";
  try {
    await set(next);
    stage = "publish stores";
    for (const file of files) {
      const data = JSON.parse(previous[file] as string);
      if (file.endsWith("stack-secrets.json")) data.postgres = next.postgres;
      else
        for (const role of Object.keys(data))
          if (next[role]) data[role] = next[role];
      await writePrivate(file, JSON.stringify(data));
    }
    stage = "reject old credentials";
    for (const role of roles) {
      const test = roleConnection(
        maintenance.db.layout,
        role,
        old[role] as string,
      );
      try {
        await test`select 1`;
        throw new Error("Old database credential remains accepted");
      } catch (error) {
        if ((error as { code?: string }).code !== "28P01") throw error;
      } finally {
        await test.end();
      }
    }
    await admin.end();
    await maintenance.stop();
    stage = "restart";
    await runStack("start", env, { runtime: "native" });
    stage = "probe new credentials";
    const probe = await probeNativeLogins(env);
    if (!probe.ok) {
      stage += ` (${probe.failures.join(", ")})`;
      throw new Error("New database credential verification failed");
    }
    await writePrivate(pending, JSON.stringify({ phase: "complete" }));
    // Keep a non-secret completion witness, moving the journal permits another rotation.
    renameSync(pending, `${pending}.${Date.now()}.done`);
  } catch (error) {
    const failure = `Native database rotation failed at ${stage}: ${safeFailure(error)}`;
    await admin.end().catch(() => {});
    await maintenance.stop().catch(() => {});
    // If activation has started, connect using the persisted new credentials.
    try {
      maintenance = await maintenanceDatabase(env);
      const recovery = superuserConnection(maintenance.db.layout, next);
      try {
        for (const role of roles) {
          const [row] =
            await recovery`select format('alter role %I password %L', ${role}::text, ${old[role] as string}::text) as ddl`;
          await recovery.unsafe(row?.ddl as string);
        }
        for (const [file, content] of Object.entries(previous))
          await writePrivate(file, content);
      } finally {
        await recovery.end();
        await maintenance.stop();
      }
      await runStack("start", env, { runtime: "native" });
      await writePrivate(
        pending,
        JSON.stringify({ phase: "rolled-back", failure }),
      );
    } catch (recoveryError) {
      throw new NativeDiagnosticError(
        `${failure}; recovery failed: ${safeFailure(recoveryError)}; private journal retained`,
      );
    }
    throw new NativeDiagnosticError(`${failure}; old credentials restored`);
  }
  // Application URLs must be updated by the caller before application writers start.
}
