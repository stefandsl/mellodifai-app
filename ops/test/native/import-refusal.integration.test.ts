import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { expect, it } from "vitest";
import { journalPath } from "../../lib/native/journal.js";
import { nativeLayout } from "../../lib/native/layout.js";
import { prepareImport } from "../../native-prepare-import.js";
import { runStack } from "../../stack.js";

it.skipIf(process.env.MDF_NATIVE_REHEARSAL !== "1")(
  "a refused preparation on the imported rehearsal lab leaves no journal and production starts normally",
  async () => {
    if (
      process.env.MELLODIFAI_ROOT !== "E:/mellodifai/native-lab-prod" ||
      process.env.MDF_NATIVE_REHEARSAL_PORT_BASE !== "46300"
    )
      throw new Error("Requires the production rehearsal lab");
    const layout = nativeLayout("prod");
    // The lab holds imported user data, so preparation must refuse it.
    await expect(
      prepareImport([
        "--env",
        "prod",
        join(layout.root, `refused-prepare-${randomUUID()}`),
        "--apply",
        "--confirm-production",
      ]),
    ).rejects.toThrow(/Not a fresh bootstrap|Missing bootstrap seed/);
    expect(existsSync(journalPath(layout))).toBe(false);
    try {
      await runStack("start", "prod", { runtime: "native" });
    } finally {
      await runStack("stop", "prod", { runtime: "native" });
    }
  },
  600_000,
);
