import {
  appendFileSync,
  cpSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { createRequire } from "node:module";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parse, stringify } from "yaml";
import { rotationMarker } from "./lib/bootstrap-prod.js";
import {
  assertAtOrAfterFloor,
  type DeployActions,
  type DeployInput,
  type DeployStep,
  runDeploy,
} from "./lib/deploy-plan.js";
import { ENV_TABLE, runtimePath, stackDir } from "./lib/envs.js";
import { databaseUrl, ownerConnection } from "./lib/pg.js";
import { prepareStackDir } from "./lib/render.js";
import { type Runner, realRunner } from "./lib/run.js";
import { runtimeRoot } from "./lib/runtime.js";
import { SERVICE_ORDER, serviceCommand } from "./lib/services.js";
import { loadStackSecrets } from "./lib/stack-secrets.js";
import { probe } from "./probe.js";
import {
  reapplyDbPasswords,
  rotateDbPasswords,
} from "./rotate-db-passwords.js";
import { presentServices } from "./services.js";

const here = dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);

function runtimeEnv(root: string): Record<string, string> {
  const temp = runtimePath(join(root, "tmp"));
  mkdirSync(temp, { recursive: true });
  return {
    MELLODIFAI_ROOT: root,
    TEMP: temp,
    TMP: temp,
    TMPDIR: temp,
    npm_config_cache: runtimePath(join(root, "cache/npm")),
    npm_config_store_dir: runtimePath(join(root, "cache/pnpm")),
    XDG_CACHE_HOME: runtimePath(join(root, "cache")),
    XDG_CONFIG_HOME: runtimePath(join(root, "config")),
    DO_NOT_TRACK: "1",
  };
}

async function checked(
  runner: Runner,
  cmd: string,
  args: string[],
  cwd: string,
  env?: Record<string, string>,
): Promise<string> {
  const reply = await runner(cmd, args, { cwd, ...(env ? { env } : {}) });
  if (reply.code !== 0)
    throw new Error(
      "Deploy command failed; subprocess output withheld to protect credentials",
    );
  return reply.stdout.trim();
}

export async function pinOps(
  checkout: string,
  root: string,
  runner: Runner,
  pnpm: string,
  stamp = new Date().toISOString().replaceAll(/[:.]/g, "-"),
): Promise<string> {
  const pinned = runtimePath(join(root, "ops-pinned", stamp));
  if (existsSync(pinned))
    throw new Error("Pinned ops destination already exists");
  cpSync(join(checkout, "ops"), pinned, {
    recursive: true,
    filter(path) {
      const name = basename(path);
      return (
        !["node_modules", "dist", ".git"].includes(name) &&
        !/^tsconfig.*\.json$/.test(name) &&
        !name.startsWith(".env") &&
        !name.endsWith(".log") &&
        !name.endsWith(".tsbuildinfo")
      );
    },
  });
  // Keep exact resolutions while making ops independent of the invoking workspace.
  const lock = parse(readFileSync(join(checkout, "pnpm-lock.yaml"), "utf8"));
  if (!lock.importers?.ops) throw new Error("Ops lockfile importer is missing");
  lock.importers = { ".": lock.importers.ops };
  writeFileSync(join(pinned, "pnpm-lock.yaml"), stringify(lock));
  await checked(
    runner,
    process.execPath,
    [
      pnpm,
      "install",
      "--ignore-workspace",
      "--frozen-lockfile",
      "--ignore-scripts",
      "--store-dir",
      join(root, "cache/pnpm"),
    ],
    pinned,
    runtimeEnv(root),
  );
  return pinned;
}

export function newestMigration(repo: string): string {
  const versions = readdirSync(join(repo, "supabase/migrations"))
    .flatMap((name) => /^(\d+)_.*\.sql$/.exec(name)?.[1] ?? [])
    .sort();
  const latest = versions.at(-1);
  if (!latest) throw new Error("Target has no migrations");
  return latest;
}

export async function checkHealth(
  schema: string,
  request: typeof fetch = fetch,
): Promise<void> {
  for (let attempt = 0; attempt < 30; attempt++) {
    try {
      const response = await request("http://127.0.0.1:3000/api/health", {
        signal: AbortSignal.timeout(2000),
        redirect: "error",
      });
      const data = (await response.json()) as { ops?: string; schema?: string };
      if (response.ok && data.ops === "ok" && data.schema === schema) return;
    } catch {
      /* Next can still be starting. Never retain response bodies. */
    }
    if (attempt < 29) await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  throw new Error("Local ops/schema health check failed");
}

// Retain only backups this tool recorded; do not delete unrelated owner files.
export function retainBackup(directory: string, file: string) {
  const manifest = join(directory, ".deploy-backups.json");
  const records: { file: string; created: number }[] = existsSync(manifest)
    ? JSON.parse(readFileSync(manifest, "utf8"))
    : [];
  records.push({ file: basename(file), created: Date.now() });
  const keep = records.filter((record) => {
    if (basename(record.file) !== record.file || !record.file.endsWith(".sql"))
      throw new Error("Invalid backup manifest");
    if (record.created >= Date.now() - 14 * 86400000) return true;
    const path = runtimePath(join(directory, record.file));
    if (existsSync(path)) unlinkSync(path);
    return false;
  });
  writeFileSync(manifest, JSON.stringify(keep));
}

export function deployCommands(
  step: DeployStep,
  repo: string,
  pinned: string,
  pnpm: string,
): { cmd: string; args: string[]; cwd: string }[] {
  const tool = (file: string, args: string[]) => ({
    cmd: process.execPath,
    args: [
      createRequire(join(pinned, "package.json")).resolve("tsx/cli"),
      join(pinned, file),
      ...args,
    ],
    cwd: repo,
  });
  switch (step.kind) {
    case "checkout":
      return [
        { cmd: "git", args: ["fetch", "--tags", "origin"], cwd: repo },
        { cmd: "git", args: ["checkout", "--detach", step.target], cwd: repo },
      ];
    case "check-no-keys":
      return [
        tool("check-no-keys.ts", [
          "--root",
          repo,
          "--root",
          join(runtimeRoot(), "stacks"),
        ]),
      ];
    case "install":
      return [
        {
          cmd: process.execPath,
          args: [pnpm, "install", "--frozen-lockfile", "--ignore-scripts"],
          cwd: repo,
        },
      ];
    case "set-owner":
      return [tool("set-owner.ts", [])];
    case "build-ops":
      return [
        {
          cmd: process.execPath,
          args: [pnpm, "--dir", join(repo, "ops"), "exec", "tsc", "--build"],
          cwd: repo,
        },
      ];
    case "build-web":
    case "build-auth":
      return [
        {
          cmd: process.execPath,
          args: [
            pnpm,
            "--dir",
            join(repo, "apps", step.kind === "build-web" ? "web" : "auth"),
            "build",
          ],
          cwd: repo,
        },
      ];
    default:
      return [];
  }
}

export async function productionDeploy(
  input: DeployInput,
  root: string,
  pnpm: string,
  commandRunner: Runner = realRunner,
) {
  const repo = runtimePath(join(root, "deploy"));
  const env = runtimeEnv(root);
  const runner: Runner = (cmd, args, opts) =>
    commandRunner(cmd, args, {
      ...opts,
      cwd: repo,
      env: { ...env, ...opts?.env },
    });
  const git = (...args: string[]) => checked(runner, "git", args, repo);
  // Refuse an unprovisioned or dirty deploy clone before stopping any writers.
  if (resolve(await git("rev-parse", "--show-toplevel")) !== resolve(repo))
    throw new Error("Dedicated deploy clone required");
  if (await git("status", "--porcelain", "--untracked-files=no"))
    throw new Error("Deploy clone has tracked changes");
  await git("fetch", "--tags", "origin");
  const ref =
    input.target === "main"
      ? "refs/remotes/origin/main"
      : `refs/tags/${input.target}`;
  await assertAtOrAfterFloor(repo, ref, runner);
  const target = await git("rev-parse", "--verify", `${ref}^{commit}`);
  const previous = await git("rev-parse", "HEAD");
  const previousTag = (
    await git("describe", "--tags", "--always", "HEAD")
  ).replaceAll(/[^a-zA-Z0-9._-]/g, "_");
  const tree = await git(
    "ls-tree",
    "-r",
    "--name-only",
    target,
    "apps/auth/package.json",
  );
  input = { ...input, target, hasAuth: Boolean(tree) };
  const secrets = await loadStackSecrets("prod");
  const url = databaseUrl(
    "postgres",
    secrets.postgres,
    ENV_TABLE.prod.ports.db,
  );
  const sql = ownerConnection(url);
  const cli = require.resolve("supabase/dist/supabase.js");
  const dbCommand = (args: string[]) =>
    checked(
      runner,
      process.execPath,
      [cli, ...args, "--workdir", stackDir("prod"), "--db-url", url],
      repo,
    );
  const actions: DeployActions = {
    async migrations() {
      const rows =
        await sql`select version from supabase_migrations.schema_migrations order by version`;
      return rows.map((row) => String(row.version));
    },
    async fakeStack() {
      const [table] =
        await sql`select to_regclass('public.stack_settings') as name`;
      if (!table?.name) return false; // First M1 deploy creates this table.
      const rows = await sql`select fake_stack from public.stack_settings`;
      return rows.some((row) => row.fake_stack !== false);
    },
    async step(step) {
      switch (step.kind) {
        case "stop":
          for (const service of [...SERVICE_ORDER].reverse())
            if (service !== "supabase")
              await serviceCommand(runner, "stop", service, root);
          break;
        case "backup": {
          const directory = runtimePath(join(root, "backups"));
          mkdirSync(directory, { recursive: true });
          const file = runtimePath(
            join(
              directory,
              `${new Date().toISOString().replaceAll(/[:.]/g, "-")}-${previousTag}.sql`,
            ),
          );
          await dbCommand([
            "db",
            "dump",
            "--data-only",
            "--schema",
            "public,auth,storage",
            "-f",
            file,
          ]);
          retainBackup(directory, file);
          break;
        }
        case "migrate":
          prepareStackDir(stackDir("prod"), repo);
          await dbCommand(["migration", "up", "--include-all"]);
          break;
        case "passwords":
          if (existsSync(rotationMarker())) {
            await rotateDbPasswords("prod", runner);
            unlinkSync(rotationMarker());
          } else await reapplyDbPasswords("prod", runner);
          break;
        case "start": {
          if (!(await probe("prod", runner)).ok)
            throw new Error("Production probe failed");
          const present = presentServices(root);
          for (const service of SERVICE_ORDER) {
            if (service === "supabase" || (service === "auth" && !step.hasAuth))
              continue;
            if (present.has(service))
              await serviceCommand(runner, "start", service, root);
          }
          break;
        }
        case "health":
          await checkHealth(newestMigration(repo));
          break;
        default:
          for (const command of deployCommands(step, repo, here, pnpm))
            await checked(runner, command.cmd, command.args, command.cwd);
      }
    },
    async rollback() {
      await assertAtOrAfterFloor(repo, previous, runner);
      await git("checkout", "--detach", previous);
      const hasAuth = existsSync(join(repo, "apps/auth/package.json"));
      const kinds: DeployStep["kind"][] = [
        "check-no-keys",
        "install",
        "passwords",
        "set-owner",
        "build-ops",
        "build-web",
      ];
      if (hasAuth) kinds.push("build-auth");
      kinds.push("start", "health");
      for (const kind of kinds)
        await actions.step({ kind, target: previous, hasAuth });
    },
    async log(message) {
      const logs = runtimePath(join(root, "logs"));
      mkdirSync(logs, { recursive: true });
      appendFileSync(
        join(logs, "deploy.log"),
        `${new Date().toISOString()} ${message}\n`,
      );
    },
  };
  try {
    await runDeploy(input, actions);
  } finally {
    await sql.end();
  }
}

export async function main(args: string[]) {
  if (
    args[0] !== "--to" ||
    !/^[a-zA-Z0-9][a-zA-Z0-9._/-]*$/.test(args[1] ?? "") ||
    args[1]?.includes("..") ||
    args.length > 3 ||
    (args[2] && args[2] !== "--skip-migrations")
  )
    throw new Error("Usage: deploy.ts --to <tag|main> [--skip-migrations]");
  const root = runtimePath(runtimeRoot());
  const pnpm = process.env.npm_execpath;
  if (!pnpm || !existsSync(pnpm))
    throw new Error("Run deploy through pnpm ops");
  if (resolve(dirname(here)) !== resolve(join(root, "ops-pinned"))) {
    const pinned = await pinOps(dirname(here), root, realRunner, pnpm);
    await checked(
      realRunner,
      process.execPath,
      [
        createRequire(join(pinned, "package.json")).resolve("tsx/cli"),
        join(pinned, "deploy.ts"),
        ...args,
      ],
      pinned,
      runtimeEnv(root),
    );
    return;
  }
  await productionDeploy(
    {
      target: args[1] as string,
      hasAuth: false,
      skipMigrations: args[2] === "--skip-migrations",
    },
    root,
    pnpm,
  );
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
)
  main(process.argv.slice(2)).catch(() => {
    process.stderr.write(
      "Deploy failed; inspect logs/deploy.log and verify floor, clone and owner prerequisites. Subprocess output withheld.\n",
    );
    process.exitCode = 1;
  });
