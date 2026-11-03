import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { beforeEach, expect, it, vi } from "vitest";
import { realRunner } from "../lib/run.js";
import { runtimeRoot } from "../lib/runtime.js";
import { launchHostedService } from "../services.js";

vi.mock("node:fs", async (original) => ({
  ...(await original<typeof import("node:fs")>()),
  mkdirSync: vi.fn(),
  existsSync: vi.fn(),
  readFileSync: vi.fn(),
  writeFileSync: vi.fn(),
}));
vi.mock("../lib/run.js", () => ({ realRunner: vi.fn() }));

const options = {
  root: runtimeRoot(),
  service: "web" as const,
  cmd: process.execPath,
  args: ["fake.cjs"],
  cwd: runtimeRoot(),
  stateFile: join(runtimeRoot(), "logs/web.pid.json"),
};

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(realRunner).mockResolvedValue({
    code: 0,
    stdout: "creation-time",
    stderr: "",
  });
  vi.mocked(realRunner).mockResolvedValueOnce({
    code: 0,
    stdout: "12345",
    stderr: "",
  });
  vi.mocked(existsSync).mockReturnValue(true);
  vi.mocked(readFileSync).mockReturnValue(
    JSON.stringify({ supervisorPid: 12345 }),
  );
});

it("starts the assigned account and waits for its supervisor readiness", async () => {
  await launchHostedService(options);
  const manifest = JSON.parse(
    String(vi.mocked(writeFileSync).mock.calls[0]?.[1]),
  );
  expect(manifest.account).toBe("mdf-web");
  expect(manifest.command).toBe(process.execPath);
  expect(readFileSync).toHaveBeenCalledWith(options.stateFile, "utf8");
  expect(realRunner).not.toHaveBeenCalledWith(
    "taskkill.exe",
    expect.anything(),
  );
});

it("refuses a supervisor that exits before readiness", async () => {
  vi.mocked(realRunner).mockResolvedValueOnce({
    code: 0,
    stdout: "",
    stderr: "",
  });
  await expect(launchHostedService(options)).rejects.toThrow(
    "before readiness",
  );
  expect(readFileSync).not.toHaveBeenCalled();
});

it("terminates the supervisor tree when reading readiness fails", async () => {
  vi.mocked(readFileSync).mockImplementation(() => {
    throw new Error("readiness failed");
  });
  await expect(launchHostedService(options)).rejects.toThrow(
    "readiness failed",
  );
  expect(realRunner).toHaveBeenLastCalledWith("taskkill.exe", [
    "/PID",
    "12345",
    "/T",
    "/F",
  ]);
});

it("does not kill a reused supervisor PID after readiness fails", async () => {
  vi.mocked(readFileSync).mockImplementation(() => {
    vi.mocked(realRunner).mockResolvedValue({
      code: 0,
      stdout: "different-creation-time",
      stderr: "",
    });
    throw new Error("readiness failed");
  });
  await expect(launchHostedService(options)).rejects.toThrow(
    "readiness failed",
  );
  expect(realRunner).not.toHaveBeenCalledWith(
    "taskkill.exe",
    expect.anything(),
  );
});
