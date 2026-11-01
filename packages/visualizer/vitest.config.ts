import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["test/**/*.test.ts"],
    // Bundling the composition and starting Chrome take a while.
    testTimeout: 600_000,
    hookTimeout: 600_000,
  },
});
