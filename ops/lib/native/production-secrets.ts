import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { ENV_TABLE } from "../envs.js";

/** Production initialization is not authorization to replace historical keys. */
export function assertProductionSecrets(): void {
  const key = ENV_TABLE.prod.signingKeysPath;
  for (const path of [
    key,
    join(dirname(key), "stack-secrets.json"),
    join(dirname(key), "db-passwords.json"),
  ]) {
    if (!existsSync(path))
      throw new Error(
        "Native production requires the existing Supabase signing, stack and database secret files; restore them before initialization",
      );
  }
}
