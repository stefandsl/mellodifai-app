import { spawn } from "node:child_process";
import {
  cpSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  rmdirSync,
  rmSync,
  symlinkSync,
} from "node:fs";
import { createRequire } from "node:module";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { nativeCacheRoot } from "./lib/native/artifacts.js";
import { ledgerHead } from "./lib/native/identity.js";
import { type MigrationFile, readMigrations } from "./lib/native/migrate.js";
import { runStack } from "./stack.js";
import { assertNativeIntegrationEnvironment } from "./test/native/integration-env.js";

const REHEARSAL_ROOT = "E:/mellodifai/native-lab-prod";

/** Ledger hash recorded in the rehearsal lab's verified backup. */
export function rehearsalLedgerHead(): string {
  const manifest = JSON.parse(
    readFileSync(join(REHEARSAL_ROOT, "verified-backup/manifest.json"), "utf8"),
  ) as { source?: { ledgerHead?: string } };
  return manifest.source?.ledgerHead ?? "";
}

/** How many of this checkout's migrations, in order, make the ledger the
 * rehearsal lab's backups were taken at. The lab holds production-shaped data
 * of one schema; restore and import refuse any other ledger. */
export function rehearsalMigrationCount(
  files: MigrationFile[],
  head: string,
): number {
  for (let count = files.length; count > 0; count--)
    if (ledgerHead(files.slice(0, count)) === head) return count;
  throw new Error(
    "The rehearsal lab's migration ledger is not a release of this checkout; rebuild the rehearsal lab",
  );
}

/** Copy this checkout's ops and schema to `target` as the release the
 * rehearsal lab holds: the same code, with only the migrations of the lab's
 * ledger. A migration added after the lab was built must not move its
 * database: the lab's backups and the read-only recovery data would then be
 * refused as another schema. Returns the staged ops folder. */
export function stageRehearsalRelease(target: string): string {
  const source = fileURLToPath(new URL("../", import.meta.url));
  const files = readMigrations(join(source, "supabase/migrations"));
  const kept = new Set(
    files
      .slice(0, rehearsalMigrationCount(files, rehearsalLedgerHead()))
      .map((file) => `${file.version}_${file.name}.sql`),
  );
  const links = ["node_modules", "ops/node_modules"];
  // rmdir removes a junction and never what it points at; it refuses a real
  // folder with content, so the dependencies of the checkout stay untouched.
  for (const link of links)
    if (lstatSync(join(target, link), { throwIfNoEntry: false }))
      rmdirSync(join(target, link));
  rmSync(target, { recursive: true, force: true });
  const migrations = join(target, "supabase/migrations");
  for (const directory of ["ops", "supabase"])
    cpSync(join(source, directory), join(target, directory), {
      recursive: true,
      filter: (path) =>
        !["node_modules", "dist", ".temp", ".branches"].includes(
          basename(path),
        ) &&
        !path.endsWith(".tsbuildinfo") &&
        !path.endsWith(".log") &&
        (dirname(path) !== join(source, "supabase/migrations") ||
          kept.has(basename(path))),
    });
  for (const name of ["package.json", "tsconfig.base.json"])
    cpSync(join(source, name), join(target, name));
  for (const link of links)
    symlinkSync(join(source, link), join(target, link), "junction");
  if (readMigrations(migrations).length !== kept.size)
    throw new Error("The staged rehearsal release has the wrong migrations");
  return join(target, "ops");
}

/** Environment of the rehearsal phase. The rehearsal lab holds data only, so
 * the phase names the cache of the first root explicitly and runs the
 * artifacts the e2e phase just started. Without that name the default is a
 * cache under the rehearsal root, which nothing installs, and every rehearsal
 * test stops at "not installed". */
export function rehearsalEnvironment(
  env: NodeJS.ProcessEnv,
  cache: string,
): NodeJS.ProcessEnv {
  return {
    ...env,
    MDF_NATIVE_INTEGRATION: "",
    MDF_NATIVE_REHEARSAL: "1",
    MELLODIFAI_ROOT: REHEARSAL_ROOT,
    MDF_NATIVE_REHEARSAL_PORT_BASE: "46300",
    MELLODIFAI_NATIVE_CACHE: cache,
  };
}

export interface PhaseCounts {
  files: number;
  tests: number;
  passed: number;
  failed: number;
  skipped: number;
}

/** Read vitest's JSON report. A required test that skipped (or a phase that
 * ran nothing) fails the run: an opted-in gate must not pass by skipping. */
export function phaseVerdict(
  name: string,
  report: string,
): { counts: PhaseCounts; problem?: string } {
  const json = JSON.parse(report) as {
    numTotalTestSuites?: number;
    testResults?: unknown[];
    numTotalTests: number;
    numPassedTests: number;
    numFailedTests: number;
    numPendingTests: number;
    numTodoTests: number;
  };
  const counts: PhaseCounts = {
    files: json.testResults?.length ?? 0,
    tests: json.numTotalTests,
    passed: json.numPassedTests,
    failed: json.numFailedTests,
    skipped: json.numPendingTests + json.numTodoTests,
  };
  if (counts.skipped > 0)
    return {
      counts,
      problem: `${name}: ${counts.skipped} required test(s) skipped`,
    };
  if (counts.tests === 0) return { counts, problem: `${name}: no test ran` };
  return { counts };
}

async function phase(
  name: string,
  env: NodeJS.ProcessEnv,
  reportDir: string,
  cwd = fileURLToPath(new URL("./", import.meta.url)),
): Promise<string | undefined> {
  const entry = join(
    dirname(createRequire(import.meta.url).resolve("vitest/package.json")),
    "vitest.mjs",
  );
  const report = join(reportDir, `${name}.json`);
  const child = spawn(
    process.execPath,
    [
      entry,
      "run",
      "--config",
      "vitest.native.integration.config.ts",
      "--reporter=default",
      "--reporter=json",
      `--outputFile.json=${report}`,
    ],
    {
      cwd,
      env,
      stdio: "inherit",
      windowsHide: true,
    },
  );
  const code = await new Promise<number>((resolve, reject) => {
    child.once("error", reject);
    child.once("exit", (exit) => resolve(exit ?? 1));
  });
  let verdict: ReturnType<typeof phaseVerdict>;
  try {
    verdict = phaseVerdict(name, readFileSync(report, "utf8"));
  } catch {
    return `${name}: no test report (vitest exit ${code})`;
  }
  const { counts } = verdict;
  console.log(
    `Native ${name} phase: ${counts.files} files, ${counts.tests} tests, ${counts.passed} passed, ${counts.failed} failed, ${counts.skipped} skipped, vitest exit ${code}`,
  );
  if (verdict.problem) return verdict.problem;
  if (code !== 0) return `${name}: vitest exit ${code}`;
  return undefined;
}

async function main(): Promise<void> {
  assertNativeIntegrationEnvironment();
  const temp = process.env.RUNNER_TEMP ?? "E:/mellodifai/tmp";
  const reportDir = join(temp, "native-integration-reports");
  mkdirSync(reportDir, { recursive: true });
  const problems: string[] = [];
  try {
    // The e2e lab keeps what the database and browser suites leave in it.
    // These tests back up and restore the whole lab, so their result and
    // their run time must not depend on that: start from a new, empty lab,
    // as CI does.
    console.log(
      "Native e2e phase: resetting the e2e lab (database and Storage objects)",
    );
    await runStack("reset", "e2e", { runtime: "native" });
    const e2e = await phase(
      "e2e",
      { ...process.env, MDF_NATIVE_INTEGRATION: "1", MDF_NATIVE_REHEARSAL: "" },
      reportDir,
    );
    if (e2e) problems.push(e2e);
  } finally {
    await runStack("stop", "e2e", { runtime: "native" });
  }
  // The rehearsal phase needs the production-shaped lab and the read-only
  // recovery folder, which exist only on the owner's machine.
  if (process.env.CI === "true")
    console.log(
      "Native rehearsal phase not run in CI (needs the production rehearsal lab)",
    );
  else {
    const env = rehearsalEnvironment(process.env, nativeCacheRoot());
    try {
      const release = stageRehearsalRelease(
        join(temp, "native-rehearsal-release"),
      );
      const rehearsal = await phase("rehearsal", env, reportDir, release);
      if (rehearsal) problems.push(rehearsal);
    } finally {
      // Stop the rehearsal stack with the same root, ports and cache.
      const keys = [
        "MELLODIFAI_ROOT",
        "MDF_NATIVE_REHEARSAL_PORT_BASE",
        "MELLODIFAI_NATIVE_CACHE",
      ] as const;
      const saved = keys.map((key) => process.env[key]);
      for (const key of keys) process.env[key] = env[key];
      try {
        await runStack("stop", "prod", { runtime: "native" });
      } finally {
        keys.forEach((key, index) => {
          if (saved[index] === undefined) delete process.env[key];
          else process.env[key] = saved[index];
        });
      }
    }
  }
  if (problems.length) {
    for (const problem of problems) console.error(`Native gate: ${problem}`);
    process.exitCode = 1;
  }
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
)
  main().catch((error: unknown) => {
    console.error(
      error instanceof Error ? error.message : "Native integration failed",
    );
    process.exitCode = 1;
  });
