import { existsSync, readFileSync, unlinkSync } from "node:fs";
import { join, resolve } from "node:path";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { realRunner } from "../lib/run.js";
import { runtimeRoot } from "../lib/runtime.js";
import { managedService } from "../services.js";

vi.mock("node:fs", async (original) => ({
  ...(await original<typeof import("node:fs")>()),
  mkdirSync: vi.fn(),
  existsSync: vi.fn(),
  readFileSync: vi.fn(),
  unlinkSync: vi.fn(),
  // The filesystem is mocked: declared paths need not exist on the host.
  realpathSync: (path: string) => resolve(path),
}));
vi.mock("../lib/run.js", () => ({ realRunner: vi.fn() }));

const root = join(runtimeRoot(), "tmp", "services-stop-test");
const stateFile = resolve(root, "logs", "worker.pid.json");
const recorded = "2026-11-20T22:40:11.1803340Z";
const windows = it.skipIf(process.platform !== "win32");

/** Replies of the process inspection and of taskkill, in call order. */
function processReplies(identities: string[], taskkillCodes: number[]) {
  vi.mocked(realRunner).mockImplementation(async (cmd) =>
    cmd === "taskkill.exe"
      ? { code: taskkillCodes.shift() ?? 0, stdout: "", stderr: "" }
      : { code: 0, stdout: `${identities.shift() ?? ""}\r\n`, stderr: "" },
  );
}
const taskkills = () =>
  vi.mocked(realRunner).mock.calls.filter(([cmd]) => cmd === "taskkill.exe");
const sharing = (code: string) =>
  Object.assign(new Error(`${code}: unlink`), { code });

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(existsSync).mockReturnValue(true);
  vi.mocked(readFileSync).mockReturnValue(
    JSON.stringify({ pid: 4242, identity: recorded, supervisorPid: 4000 }),
  );
});
afterEach(() => vi.useRealTimers());

windows(
  "stop succeeds when taskkill reports a process that ended by itself",
  async () => {
    // `pnpm start` runs the service under cmd.exe, which ends as soon as its child is killed.
    // taskkill /T then finds that listed process gone and exits 255 or 128.
    for (const code of [255, 128]) {
      vi.mocked(unlinkSync).mockClear();
      processReplies([recorded, ""], [code]);
      await expect(
        managedService("stop", "worker", root),
      ).resolves.toBeUndefined();
      expect(taskkills().at(-1)?.[1]).toEqual(["/PID", "4242", "/T", "/F"]);
      expect(unlinkSync).toHaveBeenCalledExactlyOnceWith(stateFile);
    }
  },
);

windows(
  "stop fails and keeps the state when the service process survives taskkill",
  async () => {
    processReplies([recorded, recorded], [255]);
    await expect(managedService("stop", "worker", root)).rejects.toThrow(
      "Cannot stop service process tree",
    );
    expect(unlinkSync).not.toHaveBeenCalled();
  },
);

windows(
  "stop succeeds when the supervisor has already removed the state file",
  async () => {
    processReplies([recorded], [0]);
    vi.mocked(unlinkSync).mockImplementation(() => {
      throw sharing("ENOENT");
    });
    await expect(
      managedService("stop", "worker", root),
    ).resolves.toBeUndefined();
  },
);

windows(
  "stop waits for a state file that the supervisor still reads",
  async () => {
    processReplies([recorded], [0]);
    vi.mocked(unlinkSync)
      .mockImplementationOnce(() => {
        throw sharing("EBUSY");
      })
      .mockImplementationOnce(() => {
        throw sharing("EPERM");
      });
    await expect(
      managedService("stop", "worker", root),
    ).resolves.toBeUndefined();
    expect(unlinkSync).toHaveBeenCalledTimes(3);
  },
);

windows("stop reports a state file that stays locked", async () => {
  vi.useFakeTimers();
  processReplies([recorded], [0]);
  vi.mocked(unlinkSync).mockImplementation(() => {
    throw sharing("EBUSY");
  });
  const stopped = expect(
    managedService("stop", "worker", root),
  ).rejects.toMatchObject({ code: "EBUSY" });
  await vi.runAllTimersAsync();
  await stopped;
  expect(vi.mocked(unlinkSync).mock.calls.length).toBeGreaterThan(1);
});
