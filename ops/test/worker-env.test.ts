import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { createClient } from "@supabase/supabase-js";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { runtimePath } from "../lib/envs.js";
import { runtimeRoot } from "../lib/runtime.js";
import { userAdmin } from "../lib/user-admin.js";
import { workerEnvFile } from "../lib/worker-env.js";

vi.mock("@supabase/supabase-js", () => ({
  createClient: vi.fn(() => ({ auth: { admin: {} } })),
}));
vi.mock("node:fs", async (original) => {
  const fs = await original<typeof import("node:fs")>();
  return { ...fs, readFileSync: vi.fn(fs.readFileSync) };
});

let root: string;
let canonical: string;
let fallback: string;
beforeEach(() => {
  const temp = runtimePath(
    join(process.env.RUNNER_TEMP ?? runtimeRoot(), "tmp"),
  );
  mkdirSync(temp, { recursive: true });
  root = mkdtempSync(join(temp, "worker-env-"));
  canonical = join(root, "deploy/apps/worker/.env.local");
  fallback = join(root, "config/worker.env");
  mkdirSync(join(root, "deploy/apps/worker"), { recursive: true });
  mkdirSync(join(root, "config"));
  vi.stubEnv("MELLODIFAI_ROOT", root);
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.clearAllMocks();
  rmSync(root, { recursive: true, force: true });
});

it("prefers the repaired canonical file for worker startup and user administration", () => {
  writeFileSync(
    canonical,
    "SUPABASE_URL=http://127.0.0.1:45621\nSUPABASE_SERVICE_ROLE_KEY=canonical-test-key",
  );
  writeFileSync(
    fallback,
    "SUPABASE_URL=http://127.0.0.1:1\nSUPABASE_SERVICE_ROLE_KEY=fallback-test-key",
  );
  expect(workerEnvFile(root)).toBe(canonical);
  userAdmin();
  expect(createClient).toHaveBeenCalledWith(
    "http://127.0.0.1:45621",
    "canonical-test-key",
    expect.any(Object),
  );
});

it.each([false, true])(
  "uses the temporary fallback when canonical is absent or empty (%s)",
  (empty) => {
    if (empty) writeFileSync(canonical, "\n");
    writeFileSync(
      fallback,
      "SUPABASE_URL=http://127.0.0.1:45621\nSUPABASE_SERVICE_ROLE_KEY=fallback-test-key",
    );
    expect(workerEnvFile(root)).toBe(fallback);
    userAdmin();
    expect(createClient).toHaveBeenCalledWith(
      "http://127.0.0.1:45621",
      "fallback-test-key",
      expect.any(Object),
    );
  },
);

it("fails without disclosing configuration when neither file is usable", () => {
  expect(() => workerEnvFile(root)).toThrow(
    "Worker environment file is required",
  );
});

it.each(["EACCES", "EPERM"])(
  "uses the temporary fallback while the canonical ACL denies access (%s)",
  (code) => {
    writeFileSync(fallback, "temporary-config");
    vi.mocked(readFileSync).mockImplementationOnce(() => {
      throw Object.assign(new Error("Access denied"), { code });
    });
    expect(workerEnvFile(root)).toBe(fallback);
  },
);

it("does not hide unexpected filesystem failures", () => {
  writeFileSync(fallback, "temporary-config");
  vi.mocked(readFileSync).mockImplementationOnce(() => {
    throw Object.assign(new Error("I/O failure"), { code: "EIO" });
  });
  expect(() => workerEnvFile(root)).toThrow("I/O failure");
});
