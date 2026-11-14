import { randomBytes } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { runtimePath, type StackEnv, stackDir } from "../envs.js";
import { writePrivate } from "../private-file.js";
import { randomPassword, readStackPasswords } from "../roles.js";
import { runtimeRoot } from "../runtime.js";
import { loadStackSecrets } from "../stack-secrets.js";
import type { DbLogins } from "./plan.js";

/** Login roles of the Supabase base schema that get a password of their own.
 * postgres, mdf_web and mdf_auth keep the values of the existing secret files.
 */
export const SERVICE_LOGINS = [
  "supabase_admin",
  "authenticator",
  "supabase_auth_admin",
  "supabase_storage_admin",
  "supabase_replication_admin",
  "supabase_etl_admin",
  "supabase_read_only_user",
] as const;

function loginsPath(env: StackEnv): string {
  // Production keeps every credential in the secret store; test stacks keep
  // theirs beside the role-passwords file of the same stack.
  return runtimePath(
    env === "prod"
      ? join(runtimeRoot(), "secrets/supabase/native-logins.json")
      : join(stackDir(env), "native-logins.json"),
  );
}

function readSaved(path: string): Record<string, string> {
  if (!existsSync(path)) return {};
  const saved = JSON.parse(readFileSync(path, "utf8")) as Record<
    string,
    unknown
  >;
  for (const value of Object.values(saved))
    if (typeof value !== "string" || !value || value.includes("\0"))
      throw new Error("Invalid stored native login");
  return saved as Record<string, string>;
}

function hopPath(env: StackEnv): string {
  return runtimePath(
    env === "prod"
      ? join(runtimeRoot(), "secrets/supabase/native-hop.json")
      : join(stackDir(env), "native-hop.json"),
  );
}

/**
 * The per-stack secret the gateway adds to every upstream request; Auth and
 * Storage refuse requests without it. Created at first boot, kept private
 * beside the other stack secrets, never logged and never rotated implicitly.
 */
export async function loadHopSecret(env: StackEnv): Promise<string> {
  const path = hopPath(env);
  if (existsSync(path)) {
    const saved = JSON.parse(readFileSync(path, "utf8")) as { hop?: unknown };
    if (typeof saved.hop !== "string" || !/^[0-9a-f]{64}$/.test(saved.hop))
      throw new Error("Invalid stored gateway hop secret");
    return saved.hop;
  }
  const hop = randomBytes(32).toString("hex");
  await writePrivate(path, JSON.stringify({ hop }));
  return hop;
}

export interface NativeLogins {
  logins: DbLogins;
  /** Stored password of a login role, created and saved on first request. */
  passwordFor(role: string): Promise<string>;
}

/** Distinct, persistent passwords for every database login (ruling 9). The
 * file is written once per new role and never rotated implicitly.
 */
export async function loadNativeLogins(env: StackEnv): Promise<NativeLogins> {
  const path = loginsPath(env);
  const saved = readSaved(path);
  let changed = false;
  for (const role of SERVICE_LOGINS)
    if (!saved[role]) {
      saved[role] = randomPassword();
      changed = true;
    }
  if (changed) await writePrivate(path, JSON.stringify(saved));
  const fixed: DbLogins = {
    postgres: (await loadStackSecrets(env)).postgres,
    ...(await readStackPasswords(env)),
  };
  const logins: DbLogins = { ...saved, ...fixed };
  return {
    logins,
    async passwordFor(role) {
      const known = logins[role];
      if (known) return known;
      const password = randomPassword();
      saved[role] = password;
      logins[role] = password;
      await writePrivate(path, JSON.stringify(saved));
      return password;
    },
  };
}
