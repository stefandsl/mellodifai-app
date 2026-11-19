import { join } from "node:path";
import { configDefaults, defineConfig } from "vitest/config";

export default defineConfig({
  cacheDir: join(
    process.env.RUNNER_TEMP ?? process.env.MELLODIFAI_ROOT ?? "E:/mellodifai",
    "cache/ops-vitest",
  ),
  test: {
    include: ["test/**/*.test.ts"],
    exclude: [...configDefaults.exclude, "**/*.integration.test.ts"],
    // Many tests spawn PowerShell, PostgreSQL tools or file locks; on a busy PC (other agents
    // and labs on the same machine) those take more than the 5 s default, so a run fails at random.
    testTimeout: 30_000,
  },
});
