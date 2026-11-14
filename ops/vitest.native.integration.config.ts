import { join } from "node:path";
import { defineConfig } from "vitest/config";

/** Tests that need the production rehearsal lab (E:/mellodifai/native-lab-prod,
 * port base 46300) and the read-only recovery folder. They run in the second
 * phase of `pnpm test:native`, with MDF_NATIVE_REHEARSAL=1. */
export const REHEARSAL_TESTS = [
  "test/native/deploy-rollback.integration.test.ts",
  "test/native/import-crash.integration.test.ts",
  "test/native/import-refusal.integration.test.ts",
  "test/native/maintenance-concurrency-prod.integration.test.ts",
  "test/native/prepare-race.integration.test.ts",
  "test/native/provenance.integration.test.ts",
];

const rehearsal = process.env.MDF_NATIVE_REHEARSAL === "1";

export default defineConfig({
  cacheDir: join(
    process.env.RUNNER_TEMP ?? "E:/mellodifai/tmp",
    "cache/ops-native-integration",
  ),
  test: {
    include: rehearsal
      ? REHEARSAL_TESTS
      : ["test/native/**/*.integration.test.ts"],
    exclude: rehearsal ? [] : REHEARSAL_TESTS,
    maxWorkers: 1,
    fileParallelism: false,
    testTimeout: 300_000,
    hookTimeout: 60_000,
  },
});
