import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { runStack } from "./stack.js";
import { assertNativeIntegrationEnvironment } from "./test/native/integration-env.js";

async function main(): Promise<void> {
  assertNativeIntegrationEnvironment();
  process.env.MDF_NATIVE_INTEGRATION = "1";
  const entry = join(
    dirname(createRequire(import.meta.url).resolve("vitest/package.json")),
    "vitest.mjs",
  );
  try {
    const child = spawn(
      process.execPath,
      [entry, "run", "--config", "vitest.native.integration.config.ts"],
      {
        cwd: fileURLToPath(new URL("./", import.meta.url)),
        env: process.env,
        stdio: "inherit",
        windowsHide: true,
      },
    );
    process.exitCode = await new Promise<number>((resolve, reject) => {
      child.once("error", reject);
      child.once("exit", (code) => resolve(code ?? 1));
    });
  } finally {
    await runStack("stop", "e2e", { runtime: "native" });
  }
}
main().catch((error: unknown) => {
  console.error(
    error instanceof Error ? error.message : "Native integration failed",
  );
  process.exitCode = 1;
});
