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
    // The child crashes 100 ms after start, sooner than a WMI query answers under load: the
    // host must read what it needs before the child runs, or it dies with its child.
    writeFileSync(
      entry,
      `require('node:fs').appendFileSync(${JSON.stringify(witness)}, Date.now() + '\\n'); setTimeout(() => process.exit(7), ${lifeMs});`,
    );
    try {
      await launchHostedService({
        root,
        service: "worker",
        cmd: process.execPath,
        args: [entry],
        cwd: root,
        stateFile,
        backoffMs,
      });
      const state = readFileSync(stateFile, "utf8").replace(/^\uFEFF/, "");
      const host = JSON.parse(state).supervisorPid as number;
      // Wait for the host itself to end, so a crashed host fails at once instead of after a
      // guessed budget. The budget only guards against a hung host.
      expect(await waitFor(async () => !alive(host), 120_000, 200)).toBe(true);
      const starts = existsSync(witness)
        ? readFileSync(witness, "utf8").trim().split("\n").map(Number)
        : [];
      expect(starts, "one start and five restarts").toHaveLength(6);
      expect(existsSync(stateFile), "state removed at the restart limit").toBe(
        false,
      );
      for (let restart = 0; restart < 5; restart++)
        expect(
          (starts[restart + 1] ?? 0) - (starts[restart] ?? 0),
        ).toBeGreaterThanOrEqual(lifeMs + backoffMs * 2 ** restart);
    } finally {
      await managedService("stop", "worker", root);
      rmSync(root, { recursive: true, force: true });
    }
  },
  180_000,
);

const lifeMs = 100;
const backoffMs = 500;

function alive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}
