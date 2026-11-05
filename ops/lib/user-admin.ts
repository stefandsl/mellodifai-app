import { readFileSync } from "node:fs";
import { join } from "node:path";
import { parseEnv } from "node:util";
import { createClient } from "@supabase/supabase-js";
import { readDbPasswords } from "../rotate-db-passwords.js";
import { ENV_TABLE } from "./envs.js";
import { databaseUrl, ownerConnection } from "./pg.js";
import { runtimeRoot } from "./runtime.js";

export function validateEmail(email: string): void {
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))
    throw new Error("Invalid email");
}

export function localOwnerSql() {
  return ownerConnection(
    databaseUrl(
      "postgres",
      readDbPasswords("prod").postgres as string,
      ENV_TABLE.prod.ports.db,
    ),
  );
}

export function userAdmin() {
  const file = parseEnv(
    readFileSync(join(runtimeRoot(), "config/worker.env"), "utf8"),
  );
  const url = file.SUPABASE_URL;
  const key = file.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key)
    throw new Error("Worker Supabase configuration is required");
  return createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  }).auth.admin;
}
