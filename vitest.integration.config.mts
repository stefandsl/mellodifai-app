import { join, resolve } from "node:path";
import { defineConfig } from "vitest/config";
import { assertTestStack } from "./ops/test-db-guard";

// Guard direct config invocations as well as the package script.
assertTestStack(process.env);

export default defineConfig({
  resolve: { alias: { "@": resolve(import.meta.dirname, "apps/web") } },
  cacheDir: join(
    process.env.RUNNER_TEMP ?? process.env.MELLODIFAI_ROOT ?? "E:/mellodifai",
    "cache/integration-vitest",
  ),
  test: {
    include: [
      "ops/test/**/*.integration.test.ts",
      "apps/*/**/*.integration.test.ts",
    ],
    fileParallelism: false,
  },
});
