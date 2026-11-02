import { join } from "node:path";
import { defineConfig } from "vitest/config";

export default defineConfig({
  cacheDir: join(
    process.env.RUNNER_TEMP ?? process.env.MELLODIFAI_ROOT ?? "E:/mellodifai",
    "cache/ops-vitest",
  ),
  test: { include: ["test/**/*.test.ts"] },
});
