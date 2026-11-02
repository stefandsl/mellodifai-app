import type { ChildProcess } from "node:child_process";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { beforeEach, expect, it, vi } from "vitest";
import { realRunner } from "../lib/run.js";
import { runtimeRoot } from "../lib/runtime.js";
import { trackServiceProcess } from "../services.js";

vi.mock("node:fs", async (original) => ({
  ...(await original<typeof import("node:fs")>()),
  writeFileSync: vi.fn(),
}));
vi.mock("../lib/run.js", () => ({ realRunner: vi.fn() }));

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(realRunner).mockResolvedValue({
    code: 0,
    stdout: "creation-time",
    stderr: "",
  });
});

it.each(["identity", "persistence"])(
  "terminates the new process tree when %s fails",
  async (failure) => {
    const child = {
      pid: 12345,
      exitCode: null,
      signalCode: null,
    } as ChildProcess;
    if (failure === "identity")
      vi.mocked(realRunner).mockResolvedValueOnce({
        code: 1,
        stdout: "",
        stderr: "",
      });
    else
      vi.mocked(writeFileSync).mockImplementationOnce(() => {
        throw new Error("PID persistence failed");
      });
    await expect(
      trackServiceProcess(child, join(runtimeRoot(), "logs/worker.pid.json")),
    ).rejects.toThrow();
    expect(realRunner).toHaveBeenLastCalledWith("taskkill.exe", [
      "/PID",
      "12345",
      "/T",
      "/F",
    ]);
    if (failure === "identity") expect(writeFileSync).not.toHaveBeenCalled();
  },
);

it("records a successful start without terminating it", async () => {
  const child = {
    pid: 12345,
    exitCode: null,
    signalCode: null,
  } as ChildProcess;
  const file = join(runtimeRoot(), "logs/worker.pid.json");
  await trackServiceProcess(child, file);
  expect(writeFileSync).toHaveBeenCalledWith(
    file,
    JSON.stringify({ pid: 12345, identity: "creation-time" }),
  );
  expect(realRunner).toHaveBeenCalledTimes(1);
});

it("does not kill a reused PID when the spawned child already exited", async () => {
  vi.mocked(writeFileSync).mockImplementationOnce(() => {
    throw new Error("PID persistence failed");
  });
  const child = { pid: 12345, exitCode: 0, signalCode: null } as ChildProcess;
  await expect(
    trackServiceProcess(child, join(runtimeRoot(), "logs/worker.pid.json")),
  ).rejects.toThrow("persistence");
  expect(realRunner).toHaveBeenCalledTimes(1);
});

it("reports unsuccessful process-tree cleanup", async () => {
  vi.mocked(realRunner).mockResolvedValue({ code: 1, stdout: "", stderr: "" });
  const child = {
    pid: 12345,
    exitCode: null,
    signalCode: null,
  } as ChildProcess;
  await expect(
    trackServiceProcess(child, join(runtimeRoot(), "logs/worker.pid.json")),
  ).rejects.toThrow("Startup cleanup failed; stop process tree 12345");
});
