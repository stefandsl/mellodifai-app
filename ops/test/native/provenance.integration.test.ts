import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { expect, it, vi } from "vitest";
import { nativeLayout } from "../../lib/native/layout.js";
import { nativeBackup } from "../../native-backup.js";
import { runStack } from "../../stack.js";

it.skipIf(process.env.MDF_NATIVE_REHEARSAL !== "1")(
  "refuses a real same-schema e2e backup as production data before shutdown",
  async () => {
    const prod = "E:/mellodifai/native-lab-prod";
    if (
      process.env.MELLODIFAI_ROOT !== prod ||
      process.env.MDF_NATIVE_REHEARSAL_PORT_BASE !== "46300"
    )
      throw new Error("Requires production rehearsal lab");
    const before = join(
      nativeLayout("prod").root,
      `provenance-before-${randomUUID()}`,
    );
    await nativeBackup(["backup", "--env", "prod", before]);
    let bundle: string;
    try {
      vi.stubEnv("MELLODIFAI_ROOT", "E:/mellodifai/native-lab");
      vi.stubEnv("MDF_NATIVE_REHEARSAL_PORT_BASE", undefined);
      bundle = join(
        nativeLayout("e2e").root,
        `provenance-test-${randomUUID()}`,
      );
      await runStack("start", "e2e", { runtime: "native" });
      await nativeBackup(["backup", "--env", "e2e", bundle]);
      await runStack("stop", "e2e", { runtime: "native" });
      vi.stubEnv("MELLODIFAI_ROOT", prod);
      vi.stubEnv("MDF_NATIVE_REHEARSAL_PORT_BASE", "46300");
      await expect(
        nativeBackup([
          "restore",
          "--env",
          "prod",
          bundle,
          "--confirm-production",
        ]),
      ).rejects.toThrow(/production.*identity/i);
      const manifest = JSON.parse(
        readFileSync(join(bundle, "manifest.json"), "utf8"),
      );
      expect(manifest.source).toMatchObject({ env: "e2e", fakeStack: true });
      expect(manifest.source.stackId).toMatch(/^[a-f0-9-]{36}$/);
      expect(manifest.source.ledgerHead).toMatch(/^[a-f0-9]{64}$/);
    } finally {
      vi.stubEnv("MELLODIFAI_ROOT", "E:/mellodifai/native-lab");
      vi.stubEnv("MDF_NATIVE_REHEARSAL_PORT_BASE", undefined);
      await runStack("stop", "e2e", { runtime: "native" });
      vi.stubEnv("MELLODIFAI_ROOT", prod);
      vi.stubEnv("MDF_NATIVE_REHEARSAL_PORT_BASE", "46300");
      await nativeBackup([
        "restore",
        "--env",
        "prod",
        before,
        "--confirm-production",
      ]);
      await runStack("stop", "prod", { runtime: "native" });
      vi.unstubAllEnvs();
    }
  },
  600_000,
);
