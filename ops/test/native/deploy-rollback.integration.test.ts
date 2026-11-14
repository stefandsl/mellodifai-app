import { fileURLToPath } from "node:url";
import { expect, it } from "vitest";
import { typescriptArgs } from "../../lib/native/plan.js";
import { realRunner } from "../../lib/run.js";

it.skipIf(process.env.MDF_NATIVE_ROLLBACK_TESTS !== "1")(
  "deploys a new migration then cold-starts the explicitly recorded older release",
  async () => {
    const entry = fileURLToPath(
      new URL("./fixtures/deploy-rollback-child.ts", import.meta.url),
    );
    const reply = await realRunner(process.execPath, typescriptArgs(entry));
    expect(reply.code, reply.stdout + reply.stderr).toBe(0);
    expect(reply.stdout).toContain("status green");
  },
  900_000,
);
