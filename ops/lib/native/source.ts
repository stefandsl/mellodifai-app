import { cpSync, existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { runtimePath } from "../envs.js";
import { runtimeRoot } from "../runtime.js";

/** Native migrations read their source directly; preserve any Docker CLI junctions. */
export function prepareNativeSource(directory: string, source: string): void {
  runtimePath(directory);
  mkdirSync(join(directory, "supabase"), { recursive: true });
  mkdirSync(join(directory, "compose/templates"), { recursive: true });
  cpSync(
    join(source, "supabase/templates/magic_link.html"),
    join(directory, "compose/templates/magic_link.html"),
  );
}

/** Standalone pinned ops has no workspace parent. Use the deployed release,
 * or its own reviewed schema snapshot during the first move. */
export function nativeSourceRoot(): string {
  const checkout = fileURLToPath(new URL("../../../", import.meta.url));
  if (existsSync(join(checkout, "supabase/config.toml"))) return checkout;
  const deployed = join(runtimeRoot(), "deploy");
  if (existsSync(join(deployed, "supabase/config.toml"))) return deployed;
  return fileURLToPath(new URL("../../source/", import.meta.url));
}
