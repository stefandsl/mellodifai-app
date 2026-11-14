import { realpathSync } from "node:fs";
import { isAbsolute, relative, resolve, sep } from "node:path";
import { runtimePath } from "../../lib/envs.js";

export function assertNativeTestRoot(): void {
  if (process.platform !== "win32")
    throw new Error("Native integration requires Windows");
  const root = runtimePath(process.env.MELLODIFAI_ROOT ?? "");
  if (process.env.MDF_NATIVE_REHEARSAL_PORT_BASE)
    throw new Error("Native e2e integration refuses a rehearsal port override");
  if (resolve(root) === resolve("E:/mellodifai/native-lab")) return;
  if (process.env.CI !== "true" || !process.env.RUNNER_TEMP)
    throw new Error(
      "Native integration requires the isolated e2e lab or a CI root",
    );
  const base = realpathSync(runtimePath(process.env.RUNNER_TEMP));
  const rel = relative(base, realpathSync(root));
  if (isAbsolute(rel) || rel === ".." || rel.startsWith(`..${sep}`))
    throw new Error("Native integration CI root must stay within RUNNER_TEMP");
}

export function assertNativeIntegrationEnvironment(): void {
  const required = [
    "SUPABASE_URL",
    "SUPABASE_SERVICE_ROLE_KEY",
    "SUPABASE_ANON_KEY",
    "TEST_DB_URL",
  ];
  if (required.some((name) => !process.env[name]))
    throw new Error(
      "Native integration prerequisites missing: export the private e2e test.env first",
    );
  assertNativeTestRoot();
  if (process.env.SUPABASE_URL !== "http://127.0.0.1:45621")
    throw new Error("Native integration requires the e2e API endpoint");
  const db = new URL(process.env.TEST_DB_URL as string);
  if (
    !["postgres:", "postgresql:"].includes(db.protocol) ||
    db.hostname !== "127.0.0.1" ||
    db.port !== "45622" ||
    db.pathname !== "/postgres" ||
    db.search ||
    db.hash
  )
    throw new Error("Native integration requires the e2e database endpoint");
}
