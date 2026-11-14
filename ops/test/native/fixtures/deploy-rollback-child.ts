import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import {
  cpSync,
  existsSync,
  mkdirSync,
  readFileSync,
  realpathSync,
  renameSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { basename, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import {
  redactServiceOutput,
  safeFailure,
} from "../../../lib/native/diagnostics.js";
import { type Runner, realRunner } from "../../../lib/run.js";
import { runStack } from "../../../stack.js";

const root = "E:/mellodifai/native-lab-prod";
const scratch = `E:/mellodifai/tmp/native-run8/rollback-${randomUUID()}`;
const workspace = fileURLToPath(new URL("../../../../", import.meta.url));
const source = process.env.MDF_NATIVE_ROLLBACK_SOURCE ?? workspace;
const operator = join(scratch, "operator");
const deploy = join(root, "deploy");
const native = join(root, "stacks/prod/native");
const origin = join(scratch, "origin");
const lockdown = "20261103080001_ops_alignment_lockdown.sql";
let stage = "setup";
let deployedStack: typeof import("../../../stack.js") | undefined;
const fetchActual = globalThis.fetch;

async function git(cwd: string, ...args: string[]) {
  const result = await realRunner("git", args, { cwd });
  if (result.code) throw new Error(`Fixture git ${args[0]} failed`);
  return result.stdout.trim();
}
try {
  assert.equal(process.env.MELLODIFAI_ROOT, root);
  assert.equal(process.env.MDF_NATIVE_REHEARSAL_PORT_BASE, "46300");
  assert.equal(resolve(realpathSync(root)), resolve(root));
  if (
    source !== workspace &&
    !resolve(source).startsWith(`${resolve("E:/mellodifai/tmp/native-run8")}\\`)
  )
    throw new Error("Baseline source must be a retained Run 8 snapshot");
  mkdirSync(scratch, { recursive: true });
  await runStack("stop", "prod", { runtime: "native" });
  // Preserve all pre-existing lab data. Only these literal validated lab paths move.
  if (existsSync(native)) renameSync(native, join(scratch, "saved-native"));
  if (existsSync(deploy)) renameSync(deploy, join(scratch, "saved-deploy"));
  mkdirSync(origin);
  for (const directory of ["ops", "supabase"])
    cpSync(join(source, directory), join(origin, directory), {
      recursive: true,
      filter: (path) =>
        !["node_modules", "dist", ".git", ".temp", ".branches"].includes(
          basename(path),
        ) &&
        !path.endsWith(".tsbuildinfo") &&
        !path.endsWith(".log"),
    });
  for (const name of ["package.json", "tsconfig.base.json"])
    cpSync(join(source, name), join(origin, name));
  writeFileSync(
    join(origin, ".gitignore"),
    "node_modules/\ndist/\n*.tsbuildinfo\n",
  );
  writeFileSync(join(origin, ".gitattributes"), "* -text\n");
  rmSync(join(origin, "supabase/migrations", lockdown)); // Task-created source copy only.
  await git(origin, "init", "-b", "main");
  await git(
    origin,
    "add",
    "--",
    "ops",
    "supabase",
    "package.json",
    "tsconfig.base.json",
    ".gitignore",
    ".gitattributes",
  );
  await git(
    origin,
    "-c",
    "user.name=NativeTest",
    "-c",
    "user.email=native@example.invalid",
    "commit",
    "-m",
    "Create the older native test release",
  );
  await git(origin, "tag", "m1-floor");
  await git(origin, "tag", "run8-old");
  cpSync(
    join(source, "supabase/migrations", lockdown),
    join(origin, "supabase/migrations", lockdown),
  );
  await git(origin, "add", "--", `supabase/migrations/${lockdown}`);
  await git(
    origin,
    "-c",
    "user.name=NativeTest",
    "-c",
    "user.email=native@example.invalid",
    "commit",
    "-m",
    "Add the lockdown migration to the test release",
  );
  await git(origin, "tag", "run8-new");
  await git(
    scratch,
    "clone",
    "--no-hardlinks",
    "--branch",
    "run8-old",
    origin,
    deploy,
  );
  cpSync(join(source, "ops"), operator, {
    recursive: true,
    filter: (path) =>
      !["node_modules", "dist", ".git"].includes(basename(path)) &&
      !path.endsWith(".tsbuildinfo"),
  });
  symlinkSync(
    join(workspace, "ops/node_modules"),
    join(operator, "node_modules"),
    "junction",
  );
  symlinkSync(
    join(workspace, "node_modules"),
    join(deploy, "node_modules"),
    "junction",
  );
  symlinkSync(
    join(workspace, "ops/node_modules"),
    join(deploy, "ops/node_modules"),
    "junction",
  );
  deployedStack = await import(pathToFileURL(join(operator, "stack.ts")).href);
  const deployment = await import(
    pathToFileURL(join(operator, "deploy.ts")).href
  );
  const { nativeDatabase } = await import(
    pathToFileURL(join(deploy, "ops/lib/native/backup.ts")).href
  );
  stage = "old release first boot";
  if (!deployedStack) throw new Error("Missing test release stack entry");
  await deployedStack.runStack("start", "prod", {
    runtime: "native",
    initProduction: true,
  });
  const db = await nativeDatabase("prod");
  assert.equal(
    (
      await db.execute(
        "select count(*) from supabase_migrations.schema_migrations",
      )
    ).trim(),
    "53",
  );
  // App build/process dispatch and app health are simulated. Native stack,
  // backup, migration, credentials, probes, Git tags and cold starts are real.
  const runner: Runner = (cmd, args, options) =>
    cmd === "git" ||
    (cmd === "powershell.exe" &&
      args.some((arg) => arg.includes("Get-NetTCPConnection")))
      ? realRunner(cmd, args, options)
      : Promise.resolve({ code: 0, stdout: "", stderr: "" });
  globalThis.fetch = async (input, init) => {
    if (String(input) === "http://127.0.0.1:3000/api/health") {
      const marker = join(native, "schema-rollback.json");
      const schema = existsSync(marker)
        ? JSON.parse(readFileSync(marker, "utf8")).latestVersion
        : deployment.newestMigration(deploy);
      return new Response(JSON.stringify({ ops: "ok", schema }));
    }
    return fetchActual(input, init);
  };
  stage = "deploy newer tag";
  await deployment.productionDeploy(
    { target: "run8-new", hasAuth: false, skipMigrations: false },
    root,
    "simulated-pnpm.cjs",
    runner,
  );
  assert.equal(
    (
      await db.execute(
        "select count(*) from supabase_migrations.schema_migrations",
      )
    ).trim(),
    "54",
  );
  stage = "deploy older tag with skip-migrations";
  await deployment.productionDeploy(
    { target: "run8-old", hasAuth: false, skipMigrations: true },
    root,
    "simulated-pnpm.cjs",
    runner,
  );
  stage = "cold start older tag";
  await deployedStack.runStack("stop", "prod", { runtime: "native" });
  await deployedStack.runStack("start", "prod", { runtime: "native" });
  const { nativeStatus } = await import(
    pathToFileURL(join(deploy, "ops/lib/native/stack.ts")).href
  );
  assert.equal((await nativeStatus("prod")).healthy, true);
  console.log(
    "S9 verified: 53 migrations -> deploy new tag -> 54 migrations -> skip-migrations rollback -> stop -> cold start -> status green",
  );
} catch (error) {
  console.error(
    `S9 failed at ${stage}: ${safeFailure(error)}; ${redactServiceOutput((error as Error).message)}`,
  );
  process.exitCode = 1;
} finally {
  globalThis.fetch = fetchActual;
  await (deployedStack?.runStack ?? runStack)("stop", "prod", {
    runtime: "native",
  });
  if (existsSync(join(scratch, "saved-native"))) {
    if (existsSync(native)) renameSync(native, join(scratch, "tested-native"));
    renameSync(join(scratch, "saved-native"), native);
  }
  if (existsSync(join(scratch, "saved-deploy"))) {
    if (existsSync(deploy)) renameSync(deploy, join(scratch, "tested-deploy"));
    renameSync(join(scratch, "saved-deploy"), deploy);
  }
  console.log(
    `S9 evidence retained in ${scratch}; prior lab restored and stopped`,
  );
}
