import { configDefaults, defineConfig } from "vitest/config";
import { PRODUCTION } from "./src/production-paths.js";

export default defineConfig({
  test: {
    include: ["test/**/*.test.ts"],
    exclude: [
      ...configDefaults.exclude,
      "**/*.integration.test.ts",
      "**/ledger-integration.test.ts",
    ],
    // The stage tests read sample files of the engine checkout. A worker on any root but
    // production's now defaults to <root>\engine, so the tests name the checkout they always used.
    env: {
      MELLODIFAI_ENGINE_ROOT:
        process.env.MELLODIFAI_ENGINE_ROOT ?? PRODUCTION.engineRoot,
    },
  },
});
