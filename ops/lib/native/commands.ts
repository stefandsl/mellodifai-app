import { join } from "node:path";
import { pathToFileURL } from "node:url";
import type { StackEnv } from "../envs.js";

/** Stay in the deployment process so nested commands retain its OS lease.
 * No inherited environment variable can grant lease ownership to a stranger.
 */
export async function nativeEntry(
  entry: string,
  args: string[],
  from: string,
): Promise<void> {
  const module = await import(pathToFileURL(join(from, entry)).href);
  if (entry === "native-backup.ts") await module.nativeBackup(args);
  else if (entry === "stack.ts")
    await module.runStack(args[0], args[2] as StackEnv, { runtime: "native" });
  else throw new Error("Unsupported native deployment entry");
}
