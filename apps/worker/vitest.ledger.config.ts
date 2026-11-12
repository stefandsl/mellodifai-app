import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["test/ledger-integration.test.ts"],
    fileParallelism: false,
  },
});
