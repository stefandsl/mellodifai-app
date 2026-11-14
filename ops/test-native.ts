import { spawn } from "node:child_process";
import { mkdirSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { runStack } from "./stack.js";
import { assertNativeIntegrationEnvironment } from "./test/native/integration-env.js";

const REHEARSAL_ROOT = "E:/mellodifai/native-lab-prod";

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
      cwd: fileURLToPath(new URL("./", import.meta.url)),
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
  const reportDir = join(
    process.env.RUNNER_TEMP ?? "E:/mellodifai/tmp",
    "native-integration-reports",
  );
  mkdirSync(reportDir, { recursive: true });
  const problems: string[] = [];
  try {
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
    const env = {
      ...process.env,
      MDF_NATIVE_INTEGRATION: "",
      MDF_NATIVE_REHEARSAL: "1",
      MELLODIFAI_ROOT: REHEARSAL_ROOT,
      MDF_NATIVE_REHEARSAL_PORT_BASE: "46300",
    };
    try {
      const rehearsal = await phase("rehearsal", env, reportDir);
      if (rehearsal) problems.push(rehearsal);
    } finally {
      const saved = {
        root: process.env.MELLODIFAI_ROOT,
        base: process.env.MDF_NATIVE_REHEARSAL_PORT_BASE,
      };
      process.env.MELLODIFAI_ROOT = REHEARSAL_ROOT;
      process.env.MDF_NATIVE_REHEARSAL_PORT_BASE = "46300";
      try {
        await runStack("stop", "prod", { runtime: "native" });
      } finally {
        process.env.MELLODIFAI_ROOT = saved.root;
        if (saved.base === undefined)
          delete process.env.MDF_NATIVE_REHEARSAL_PORT_BASE;
        else process.env.MDF_NATIVE_REHEARSAL_PORT_BASE = saved.base;
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
