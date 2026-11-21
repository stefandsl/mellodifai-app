import { spawn, spawnSync } from "node:child_process";
import { EventEmitter } from "node:events";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import { acquireLease } from "../../lib/native/lease.js";
import { fixture } from "./fixtures.js";

vi.mock("node:child_process", async (original) => ({
  ...(await original<typeof import("node:child_process")>()),
  spawn: vi.fn(),
}));
afterEach(() => {
  vi.useRealTimers();
  vi.resetAllMocks();
});

/** A PowerShell process that the test controls. */
function powershell() {
  const stream = () =>
    Object.assign(new EventEmitter(), {
      setEncoding() {
        return this;
      },
    });
  return Object.assign(new EventEmitter(), {
    pid: 4000,
    stdout: stream(),
    stderr: stream(),
    stdin: { on: vi.fn(), end: vi.fn() },
    kill: vi.fn(),
  });
}

it.runIf(process.platform === "win32")(
  "ends the lease timeout error on time when the query for the helper of a dead holder does not answer",
  async () => {
    const path = join(fixture(), "stack.lease");
    // A process id that is not in use: this process has just ended.
    const gone = spawnSync(process.execPath, ["-e", ""]).pid;
    writeFileSync(
      `${path}.holder.json`,
      JSON.stringify({ command: "import", pid: gone }),
    );
    const helper = powershell();
    const query = powershell();
    vi.mocked(spawn)
      .mockReturnValueOnce(helper as unknown as ReturnType<typeof spawn>)
      .mockReturnValueOnce(query as unknown as ReturnType<typeof spawn>);
    vi.useFakeTimers();
    const outcome = acquireLease(path, "start", 5000).then(
      () => "acquired",
      (error: Error) => error.message,
    );
    const now = () => Promise.race([outcome, Promise.resolve("waiting")]);
    // The helper starts in 3 s and gives up after its 5 s.
    await vi.advanceTimersByTimeAsync(8000);
    helper.stdout.emit("data", Buffer.from("busy\n"));
    helper.emit("exit", 2, null);
    helper.emit("close", 2, null);
    // The process query never answers. It has 15 s.
    await vi.advanceTimersByTimeAsync(14_999);
    expect(await now()).toBe("waiting");
    expect(query.kill).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(await now()).toBe(
      `Stack lease held by import (pid ${gone}); timed out after 5000ms (process ${gone} is no longer running)`,
    );
    expect(query.kill).toHaveBeenCalledOnce();
  },
);
