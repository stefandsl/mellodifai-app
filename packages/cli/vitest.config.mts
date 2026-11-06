import { defineConfig } from "vitest/config";
import { testRuntimeRoot } from "./test/runtime.js";

export default defineConfig({
  cacheDir: `${testRuntimeRoot()}/cache/vite`,
  test: { include: ["test/**/*.test.ts"] },
});
