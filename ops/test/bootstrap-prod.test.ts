import { beforeEach as beforeDockerCase, vi as legacyRuntime } from "vitest";

beforeDockerCase(() => legacyRuntime.stubEnv("MELLODIFAI_RUNTIME", "docker"));

import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
} from "node:fs";
import { join } from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import {
  bootstrapProductionSecrets,
  legacyPassword,
  rotationMarker,
} from "../lib/bootstrap-prod.js";
import type { Runner } from "../lib/run.js";

let root = "";
afterEach(() => {
  vi.unstubAllEnvs();
  if (root) rmSync(root, { recursive: true, force: true });
});

it("bootstraps the three private production stores once from the legacy container", async () => {
  const base = process.env.RUNNER_TEMP ?? "E:/mellodifai/tmp";
  mkdirSync(base, { recursive: true });
  root = mkdtempSync(join(base, "prod-bootstrap-"));
  vi.stubEnv("MELLODIFAI_ROOT", root);
  const calls: string[] = [];
  const runner: Runner = async (_command, args) => {
    calls.push(args[0] ?? "");
    return {
      code: 0,
      stdout:
        args[0] === "inspect"
          ? JSON.stringify(["POSTGRES_PASSWORD=legacy-test-password"])
          : "postgres\nsupabase_admin\nauthenticator\n",
      stderr: "",
    };
  };
  await bootstrapProductionSecrets(runner);
  const dir = join(root, "secrets/supabase");
  for (const name of [
    "signing_keys.json",
    "stack-secrets.json",
    "db-passwords.json",
  ])
    expect(existsSync(join(dir, name))).toBe(true);
  expect(existsSync(rotationMarker())).toBe(true);
  const passwords = JSON.parse(
    readFileSync(join(dir, "db-passwords.json"), "utf8"),
  );
  expect(passwords.postgres).toBe("legacy-test-password");
  expect(passwords.mdf_web).not.toBe(passwords.mdf_auth);
  await bootstrapProductionSecrets(runner);
  expect(calls).toEqual(["inspect", "exec"]);
});

it("refuses missing or ambiguous legacy credentials", () => {
  expect(() => legacyPassword([])).toThrow();
  expect(() =>
    legacyPassword(["POSTGRES_PASSWORD=a", "POSTGRES_PASSWORD=b"]),
  ).toThrow();
});
