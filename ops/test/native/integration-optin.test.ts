import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, expect, it, vi } from "vitest";
import { realRunner } from "../../lib/run.js";
import { fixture } from "./fixtures.js";
import { assertNativeTestRoot } from "./integration-env.js";

afterEach(() => vi.unstubAllEnvs());

it("accepts an isolated CI root and refuses a root outside its temporary volume", () => {
  const root = fixture();
  const outside = fixture();
  vi.stubEnv("CI", "true");
  vi.stubEnv("RUNNER_TEMP", root);
  vi.stubEnv("MELLODIFAI_ROOT", root);
  vi.stubEnv("MDF_NATIVE_REHEARSAL_PORT_BASE", "");
  expect(() => assertNativeTestRoot()).not.toThrow();
  vi.stubEnv("MELLODIFAI_ROOT", outside);
  expect(() => assertNativeTestRoot()).toThrow("within RUNNER_TEMP");
});

it("fails the opted-in native suite when credentials or its endpoint are missing", async () => {
  const vitest = join(
    dirname(createRequire(import.meta.url).resolve("vitest/package.json")),
    "vitest.mjs",
  );
  const result = await realRunner(
    process.execPath,
    [
      vitest,
      "run",
      "--config",
      "vitest.native.integration.config.ts",
      "test/native/storage.integration.test.ts",
    ],
    {
      cwd: fileURLToPath(new URL("../../", import.meta.url)),
      env: {
        MDF_NATIVE_INTEGRATION: "1",
        MELLODIFAI_ROOT: "E:/mellodifai/native-lab",
        SUPABASE_URL: "",
        SUPABASE_SERVICE_ROLE_KEY: "",
        SUPABASE_ANON_KEY: "",
        TEST_DB_URL: "",
      },
    },
  );
  expect(
    result.code,
    "Opted-in missing prerequisites must not be skipped",
  ).not.toBe(0);
  expect(result.stdout + result.stderr).toContain(
    "Native integration prerequisites missing",
  );
}, 30_000);
