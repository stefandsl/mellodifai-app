import { mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { runtimePath, SUPABASE_CLI_VERSION, stackDir } from "../lib/envs.js";
import { readStackPasswords } from "../lib/roles.js";
import { realRunner } from "../lib/run.js";
import { planStackCommand, runStackCommand, writeTestEnv } from "../stack.js";

const fixtureBase = runtimePath(
  process.env.RUNNER_TEMP ??
    join(process.env.MELLODIFAI_ROOT ?? "E:/mellodifai", "tmp"),
);
let root = "";
it("creates fixtures under the configured external temporary directory", () => {
  expect(dirname(root)).toBe(fixtureBase);
});
it("runs the pinned installed CLI without depending on the npm installation layout", async () => {
  const require = createRequire(import.meta.url);
  for (const command of ["migrate", "reset", "db reset"]) {
    const plan = planStackCommand(command, "e2e", {})[0];
    if (!plan?.[0] || !plan[1]) throw new Error("Missing CLI command");
    expect(plan[1]).toMatch(/supabase[\\/]dist[\\/]supabase\.js$/);
    expect(require("supabase/package.json").version).toBe(SUPABASE_CLI_VERSION);
    const result = await realRunner(plan[0], [plan[1], "--version"]);
    expect(result.code).toBe(0);
    expect(result.stdout.trim()).toBe(SUPABASE_CLI_VERSION);
  }
}, 30_000);
beforeEach(() => {
  root = "";
  const tmp = runtimePath(fixtureBase);
  mkdirSync(tmp, { recursive: true });
  root = mkdtempSync(join(tmp, "stack-test-"));
  vi.stubEnv("MELLODIFAI_ROOT", root);
  vi.stubEnv("RUNNER_TEMP", join(root, "runner"));
});
afterEach(() => {
  vi.unstubAllEnvs();
  if (root) rmSync(root, { recursive: true, force: true });
});

it("refuses reset, db reset and stop --no-backup on project mellodifai (Major 17)", () => {
  for (const cmd of ["reset", "db reset"])
    expect(() => planStackCommand(cmd, "prod", {})).toThrow(/ops\/restore\.ts/);
  expect(() => planStackCommand("stop", "prod", { noBackup: true })).toThrow();
});

it("start runs the pinned compose equivalent, passwords, then test.env", async () => {
  const calls: string[] = [];
  await runStackCommand(
    "start",
    "e2e",
    {},
    {
      checkPorts: async () => {
        calls.push("ports");
      },
      render: async () => {
        calls.push("render");
      },
      execute: async (plan) => {
        calls.push(plan[0]?.[0] ?? "missing");
      },
      migrate: async () => {
        calls.push("migration up");
      },
      passwords: async () => {
        calls.push("passwords");
      },
      envFile: async () => {
        calls.push("test.env");
        return "test.env";
      },
    },
  );
  expect(calls).toEqual([
    "ports",
    "render",
    "docker",
    "migration up",
    "passwords",
    "test.env",
  ]);
  expect(planStackCommand("start", "e2e", {})[0]).toContain("--pull");
});

it("migrate runs migration up then re-applies role passwords", async () => {
  const calls: string[] = [];
  await runStackCommand(
    "migrate",
    "e2e",
    {},
    {
      checkPorts: async () => {
        calls.push("ports");
      },
      render: async () => {},
      execute: async () => {},
      migrate: async () => {
        calls.push("migration up");
      },
      passwords: async () => {
        calls.push("passwords");
      },
      envFile: async () => "",
    },
  );
  expect(calls).toEqual(["migration up", "passwords"]);
});

it("env-file returns only a path and the file holds no prod values", async () => {
  const path = await writeTestEnv(
    "e2e",
    { postgres: "owner-test", anon: "anon-test", service: "service-test" },
    { mdf_web: "web-test", mdf_auth: "auth-test" },
  );
  expect(path).toBe(join(stackDir("e2e"), "test.env"));
  const content = readFileSync(path, "utf8");
  expect(content).toContain("http://127.0.0.1:45621");
  expect(content).toContain("TEST_MDF_AUTH_URL=");
  expect(content).not.toMatch(/44321|44322|app\.mellodifai\.com/);
  await expect(
    writeTestEnv(
      "prod",
      { postgres: "", anon: "", service: "" },
      { mdf_web: "", mdf_auth: "" },
    ),
  ).rejects.toThrow();
});

it("dev stack gets persistent random mdf_web and mdf_auth passwords too (Nit 21)", async () => {
  const first = await readStackPasswords("dev");
  expect(first).toEqual(await readStackPasswords("dev"));
  expect(first.mdf_web.length).toBeGreaterThanOrEqual(32);
  expect(first.mdf_web).not.toBe(first.mdf_auth);
  expect(first).not.toEqual(await readStackPasswords("e2e"));
});

it("concurrent first reads publish one complete password file", async () => {
  const passwords = await Promise.all(
    Array.from({ length: 4 }, () => readStackPasswords("dev")),
  );
  expect(
    passwords.every(
      (value) => JSON.stringify(value) === JSON.stringify(passwords[0]),
    ),
  ).toBe(true);
});
