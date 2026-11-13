import { existsSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { runtimeRoot } from "../runtime.js";

/** Standalone pinned ops has no workspace parent. Use the deployed release,
 * or its own reviewed schema snapshot during the first move. */
export function nativeSourceRoot(): string {
  const checkout = fileURLToPath(new URL("../../../", import.meta.url));
  if (existsSync(join(checkout, "supabase/config.toml"))) return checkout;
  const deployed = join(runtimeRoot(), "deploy");
  if (existsSync(join(deployed, "supabase/config.toml"))) return deployed;
  return fileURLToPath(new URL("../../source/", import.meta.url));
}
