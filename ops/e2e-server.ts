import { execFileSync, spawn, spawnSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, mkdtempSync } from "node:fs";
import { basename, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { runtimePath } from "./lib/envs.js";
import { runtimeRoot } from "./lib/runtime.js";
import { assertTestStack } from "./test-db-guard.js";

const omitted = new Set([
  "node_modules",
  ".git",
  ".claude",
  ".superpowers",
  ".next",
  "dist",
  "coverage",
  "test-results",
  "playwright-report",
]);

export function prepareE2EServer(source: string, runtime: string): string {
  const parent = runtimePath(join(runtime, "e2e-servers"));
  mkdirSync(parent, { recursive: true });
  const target = mkdtempSync(join(parent, "web-"));
  cpSync(source, target, {
    recursive: true,
    filter(path) {
      const name = basename(path);
      return (
        !omitted.has(name) &&
        !name.startsWith(".env") &&
        !name.endsWith(".tsbuildinfo") &&
        !name.endsWith(".log")
      );
    },
  });
  const changelogDataScript = join(
    source,
    "apps",
    "web",
    "scripts",
    "site-study",
    "changelog-data.mjs",
  );
  if (existsSync(join(source, ".git")) && existsSync(changelogDataScript)) {
    execFileSync(
      process.execPath,
      [
        changelogDataScript,
        "--write-snapshot",
        "--repo-root",
        source,
        "--out",
        join(target, "content", "changelog", "tags.json"),
      ],
      {
        cwd: source,
        windowsHide: true,
        stdio: ["ignore", "pipe", "pipe"],
      },
    );
  }
  return target;
}

function main() {
  assertTestStack(process.env);
  const port = Number(process.argv[2]);
  if (!Number.isInteger(port) || port < 1024 || port > 65535)
    throw new Error("A valid unprivileged E2E port is required");
  const pnpm = process.env.npm_execpath;
  if (!pnpm) throw new Error("Run e2e-server.ts through pnpm ops");
  const runtime = runtimePath(process.env.RUNNER_TEMP ?? runtimeRoot());
  const target = prepareE2EServer(
    fileURLToPath(new URL("../", import.meta.url)),
    runtime,
  );
  const temp = join(runtime, "tmp");
  mkdirSync(temp, { recursive: true });
  const env = {
    ...process.env,
    TEMP: temp,
    TMP: temp,
    TMPDIR: temp,
    npm_config_cache: join(runtime, "cache/npm"),
    NEXT_TELEMETRY_DISABLED: "1",
  };
  const install = spawnSync(
    process.execPath,
    [
      pnpm,
      "install",
      "--frozen-lockfile",
      "--ignore-scripts",
      "--store-dir",
      join(runtime, "cache/pnpm"),
    ],
    {
      cwd: target,
      env,
      windowsHide: true,
      stdio: "inherit",
    },
  );
  if (install.error || install.status !== 0)
    throw new Error("E2E runtime dependency installation failed");
  console.log(`E2E Next runtime: ${target}`);
  const child = spawn(
    process.execPath,
    [
      pnpm,
      "--filter",
      "@mellodifai/web",
      "exec",
      "next",
      "dev",
      "-H",
      "127.0.0.1",
      "-p",
      String(port),
    ],
    {
      cwd: target,
      env,
      windowsHide: true,
      stdio: "inherit",
    },
  );
  for (const signal of ["SIGINT", "SIGTERM"] as const)
    process.on(signal, () => child.kill(signal));
  child.on("error", () => {
    process.exitCode = 1;
  });
  child.on("exit", (code) => {
    process.exitCode = code ?? 1;
  });
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  try {
    main();
  } catch (error) {
    console.error(error instanceof Error ? error.message : "E2E server failed");
    process.exitCode = 1;
  }
}
