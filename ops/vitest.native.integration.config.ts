import { join } from "node:path";
import { defineConfig } from "vitest/config";

export default defineConfig({
  cacheDir: join(
    process.env.RUNNER_TEMP ?? "E:/mellodifai/tmp",
    "cache/ops-native-integration",
  ),
  test: {
    include: ["test/native/**/*.integration.test.ts"],
    maxWorkers: 1,
    fileParallelism: false,
    testTimeout: 300_000,
    hookTimeout: 60_000,
  },
});
