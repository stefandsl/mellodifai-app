import { existsSync, readFileSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { main as deploy } from "./deploy.js";
import { composeEnvironment } from "./lib/compose.js";
import { assertAtOrAfterFloor } from "./lib/deploy-plan.js";
import { runtimePath, type StackEnv, stackDir } from "./lib/envs.js";
import { provisionTestLogins } from "./lib/logins.js";
import { resolveRuntime } from "./lib/native/layout.js";
import { checked, recoveryDatabase, stopWriters } from "./lib/recovery.js";
import { prepareStackDir } from "./lib/render.js";
import { applyRolePasswords, readStackPasswords } from "./lib/roles.js";
import { type Runner, realRunner } from "./lib/run.js";
import { runtimeRoot } from "./lib/runtime.js";
import { loadStackSecrets } from "./lib/stack-secrets.js";
import { nativeBackup } from "./native-backup.js";
import { reapplyDbPasswords } from "./rotate-db-passwords.js";
import { runStackCommand } from "./stack.js";

const authorization = Symbol("restore");
export const isRestoreAuthorization = (value: unknown) =>
  value === authorization;
export type Step = {
  kind:
    | "validate"
    | "stop"
    | "backup"
    | "checkout"
    | "reset"
    | "import"
    | "passwords"
    | "deploy";
  target: string;
  skipMigrations: boolean;
};
export function backupTag(backup: string): string {
  // The verified pre-cutover dump predates tagged M1 backups.
  if (
    resolve(backup) ===
    resolve(
      join(runtimeRoot(), "backups", "2026-11-03-task-33-pre-cutover.sql"),
    )
  )
    return "m1-floor";
  const match =
    /^\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}-\d{3}Z-(m1-[a-zA-Z0-9._-]+)\.sql$/.exec(
      basename(backup),
    );
  if (!match?.[1])
    throw new Error("Backup filename must record an exact m1 tag");
  return match[1];
}
export function planRestore(backup: string): Step[] {
  const target = backupTag(backup);
  const kinds: Step["kind"][] = [
    "validate",
    "stop",
    "backup",
    "checkout",
    "reset",
    "import",
    "passwords",
    "deploy",
  ];
  return kinds.map((kind) => ({ kind, target, skipMigrations: true }));
}
export async function runRestore(
  backup: string,
  step: (step: Step) => Promise<void>,
) {
  for (const item of planRestore(backup)) await step(item);
}
function validateBackup(backup: string) {
  runtimePath(backup);
  if (!existsSync(backup)) throw new Error("Backup does not exist");
  const content = readFileSync(backup, "utf8");
  if (
    !content.includes("PostgreSQL database dump") ||
    !content.includes("PostgreSQL database dump complete")
  )
    throw new Error("Backup is incomplete or not a PostgreSQL data dump");
}
export async function restoreDatabase(env: StackEnv, backup: string) {
  if (env === "prod")
    throw new Error("Production restore requires the validated owner workflow");
  if (resolveRuntime(undefined) === "native")
    return nativeBackup(["restore", "--env", env, backup]);
  validateBackup(backup);
  // This capability is never exposed through stack.ts's argument parser.
  const database = await recoveryDatabase(env);
  await database.quiesce();
  await runStackCommand("reset", env, { restore: authorization });
  await database.import(backup);
  await applyRolePasswords(database.url, await readStackPasswords(env));
  const secrets = await loadStackSecrets(env);
  await provisionTestLogins(
    env,
    secrets.postgres,
    realRunner,
    composeEnvironment(env, secrets),
  );
  await database.compose([
    "up",
    "-d",
    "--pull",
    "never",
    "--wait",
    "--wait-timeout",
    "180",
  ]);
  await database.compose(["restart", "kong"]);
}
export async function productionRestore(
  backup: string,
  runner: Runner = realRunner,
) {
  if (resolveRuntime(undefined) === "native")
    throw new Error(
      "Use native-backup.ts restore --env prod <bundle> --confirm-production; schema ledgers must match",
    );
  validateBackup(backup);
  const repo = runtimePath(join(runtimeRoot(), "deploy"));
  // The invoking checkout stays fixed while only the dedicated deploy clone moves.
  if (resolve(dirname(fileURLToPath(import.meta.url)), "..") === resolve(repo))
    throw new Error(
      "Run restore from the operator checkout, not the deploy clone",
    );
  const git = (...args: string[]) =>
    checked(runner, "git", args, { cwd: repo });
  let currentTag = "";
  let targetCommit = "";
  const db = await recoveryDatabase("prod", runner);
  await runRestore(backup, async (step) => {
    switch (step.kind) {
      case "validate":
        if (
          resolve(await git("rev-parse", "--show-toplevel")) !== resolve(repo)
        )
          throw new Error("Dedicated deploy clone required");
        if (await git("status", "--porcelain", "--untracked-files=no"))
          throw new Error("Deploy clone has tracked changes");
        await git("fetch", "--tags", "origin");
        await assertAtOrAfterFloor(repo, `refs/tags/${step.target}`, runner);
        targetCommit = await git(
          "rev-parse",
          `refs/tags/${step.target}^{commit}`,
        );
        currentTag = await git("describe", "--tags", "--exact-match", "HEAD");
        backupTag(`2000-01-01T00-00-00-000Z-${currentTag}.sql`);
        prepareStackDir(stackDir("prod"), repo);
        break;
      case "stop":
        await stopWriters(runner);
        await db.quiesce();
        break;
      case "backup":
        await db.backup(
          join(
            runtimeRoot(),
            "backups",
            `${new Date().toISOString().replaceAll(/[:.]/g, "-")}-${currentTag}.sql`,
          ),
        );
        break;
      case "checkout":
        await git("checkout", "--detach", targetCommit);
        break;
      case "reset":
        await runStackCommand("reset", "prod", { restore: authorization });
        break;
      case "import":
        await db.import(backup);
        break;
      case "passwords":
        await applyRolePasswords(db.url, await readStackPasswords("prod"));
        await reapplyDbPasswords("prod", runner);
        break;
      case "deploy":
        await deploy(["--to", step.target, "--skip-migrations"]);
        break;
    }
  });
}
if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  const args = process.argv.slice(2);
  (async () => {
    if (
      args[0] === "--env" &&
      args[1] === "dev" &&
      args.length === 3 &&
      args[2]
    ) {
      await restoreDatabase("dev", args[2]);
      return;
    }
    if (args.length !== 1 || !args[0])
      throw new Error(
        "Usage: restore.ts <backup> | restore.ts --env dev <backup>",
      );
    await productionRestore(args[0]);
  })().catch(() => {
    process.stderr.write(
      "Restore failed; writers remain stopped after recovery begins. Verify backup, floor and owner prerequisites. Subprocess output withheld.\n",
    );
    process.exitCode = 1;
  });
}
