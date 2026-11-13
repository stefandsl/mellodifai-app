import { realpathSync } from "node:fs";
import { resolve } from "node:path";
import { ENV_TABLE } from "../envs.js";
import { runtimeRoot } from "../runtime.js";

/** Deliberately restricted test seam, never a production port setting. */
export function rehearsalPorts(root: string, value: string): number {
  if (
    resolve(root).toLowerCase() !==
    resolve("E:/mellodifai/native-lab-prod").toLowerCase()
  )
    throw new Error(
      "Native rehearsal ports require E:/mellodifai/native-lab-prod",
    );
  if (realpathSync(root).toLowerCase() !== resolve(root).toLowerCase())
    throw new Error("Native rehearsal root must not be a filesystem link");
  const base = Number(value);
  if (!/^463[0-9]0$/.test(value) || base > 46390)
    throw new Error("Native rehearsal port block must stay inside 46300-46399");
  return base;
}

export function applyRehearsalPorts(): void {
  const value = process.env.MDF_NATIVE_REHEARSAL_PORT_BASE;
  if (value === undefined) return;
  const base = rehearsalPorts(runtimeRoot(), value);
  Object.assign(ENV_TABLE.prod.ports, { api: base + 1, db: base + 2 });
  Object.assign(ENV_TABLE.prod.listeners, {
    shadow: base,
    inspector: base + 8,
    pooler: base + 9,
  });
}
