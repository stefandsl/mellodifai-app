import { join } from "node:path";
import { ENV_TABLE, runtimePath, type StackEnv, stackDir } from "../envs.js";

export type StackRuntime = "native" | "docker";

/** Explicit flag, then MELLODIFAI_RUNTIME, then native (ruling 2). */
export function resolveRuntime(
  flag: string | undefined,
  env: Record<string, string | undefined> = process.env,
): StackRuntime {
  const value = flag ?? env.MELLODIFAI_RUNTIME ?? "native";
  if (value !== "native" && value !== "docker")
    throw new Error("Runtime must be native or docker");
  return value;
}

export interface NativePorts {
  api: number;
  db: number;
  auth: number;
  rest: number;
  storage: number;
  templates: number;
  mailHttp: number | null;
  mailSmtp: number | null;
}

export interface NativeLayout {
  env: StackEnv;
  /** All mutable native state of this stack. */
  root: string;
  pgdata: string;
  objects: string;
  logs: string;
  run: string;
  config: string;
  tmp: string;
  templates: string;
  ports: NativePorts;
}

/** Ruling 7: every listener stays inside the environment's reserved block.
 * The mail template listener (Auth fetches templates over HTTP only) takes
 * the fifth port of the block, which no environment assigns.
 */
export function nativePorts(env: StackEnv): NativePorts {
  const values = ENV_TABLE[env];
  return {
    api: values.ports.api,
    db: values.ports.db,
    auth: values.listeners.shadow,
    rest: values.listeners.inspector,
    storage: values.listeners.pooler,
    templates: values.ports.api + 4,
    mailHttp: values.ports.inbucket,
    mailSmtp: values.ports.inbucket === null ? null : values.ports.analytics,
  };
}

export function nativeLayout(env: StackEnv): NativeLayout {
  const stack = stackDir(env);
  const root = runtimePath(join(stack, "native"));
  const ports = nativePorts(env);
  const numbers = Object.values(ports).filter(
    (port): port is number => port !== null,
  );
  if (new Set(numbers).size !== numbers.length)
    throw new Error("Native stack ports collide");
  return {
    env,
    root,
    pgdata: join(root, "pgdata"),
    objects: join(root, "storage"),
    logs: join(root, "logs"),
    run: join(root, "run"),
    config: join(root, "config"),
    tmp: join(root, "tmp"),
    templates: join(stack, "compose/templates"),
    ports,
  };
}

export const loopback = (port: number) => `http://127.0.0.1:${port}`;
