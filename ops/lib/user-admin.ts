import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { parseEnv } from "node:util";
import { createClient } from "@supabase/supabase-js";
import { readDbPasswords } from "../rotate-db-passwords.js";
import { ENV_TABLE } from "./envs.js";
import { databaseUrl, ownerConnection } from "./pg.js";

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
    readFileSync(
      fileURLToPath(new URL("../../apps/worker/.env.local", import.meta.url)),
      "utf8",
    ),
  );
  const url = file.SUPABASE_URL;
  const key = file.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key)
    throw new Error("Worker Supabase configuration is required");
  return createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  }).auth.admin;
}
