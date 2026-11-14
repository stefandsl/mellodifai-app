import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import { waitFor } from "../../lib/native/processes.js";
import { launchHostedService, managedService } from "../../services.js";

afterEach(() => vi.unstubAllEnvs());
it.skipIf(process.platform !== "win32")(
  "restarts a crashing hosted process five times and then stops",
  async () => {
    const root = mkdtempSync("E:/mellodifai/tmp/native-host-test-");
    vi.stubEnv("MELLODIFAI_ROOT", root);
    vi.stubEnv("MELLODIFAI_RUNTIME", "native");
    const witness = join(root, "attempts.txt");
    const entry = join(root, "crash.cjs");
    const stateFile = join(root, "logs/worker.pid.json");
    mkdirSync(join(root, "logs"));
    mkdirSync(join(root, "config"));
    writeFileSync(join(root, "config/worker.env"), "WORKER_FAKE=1\n");
    writeFileSync(
      entry,
      `require('node:fs').appendFileSync(${JSON.stringify(witness)}, 'attempt\\n'); setTimeout(() => process.exit(7), 1500);`,
    );
    try {
      await launchHostedService({
        root,
        service: "worker",
        cmd: process.execPath,
        args: [entry],
        cwd: root,
        stateFile,
      });
      expect(
        await waitFor(
          async () =>
            existsSync(witness) &&
            readFileSync(witness, "utf8").split("attempt").length === 7 &&
            !existsSync(stateFile),
          // Backoff alone is 1+2+4+8+16 s; six hosted launches through PowerShell and CIM add
          // about 30 s more, and over 80 s under full-suite load.
          150_000,
          300,
        ),
      ).toBe(true);
      expect(readFileSync(witness, "utf8").match(/attempt/g)).toHaveLength(6);
    } finally {
      await managedService("stop", "worker", root);
      rmSync(root, { recursive: true, force: true });
    }
  },
  180_000,
);
