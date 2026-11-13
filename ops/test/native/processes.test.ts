import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import * as host from "../../lib/native/host.js";
import { nativeLayout } from "../../lib/native/layout.js";
import { verifiedPostmaster } from "../../lib/native/postgres.js";
import {
  acquireLock,
  type StackState,
  Supervisor,
} from "../../lib/native/processes.js";
import {
  assertPortsFree,
  nativeStatus,
  stopOrphans,
} from "../../lib/native/stack.js";
import type { Runner } from "../../lib/run.js";
import { fixture } from "./fixtures.js";

vi.mock("../../lib/native/host.js", async (importOriginal) => ({
  ...(await importOriginal<typeof host>()),
  processIdentities: vi.fn(
    async (pids: number[]) =>
      new Map(pids.map((pid) => [pid, { pid, startedAt: "now" }])),
  ),
  sameProcess: vi.fn(async () => false),
  terminateTree: vi.fn(async () => {}),
  portOpen: vi.fn(async () => false),
}));
afterEach(() => {
  vi.clearAllMocks();
  vi.unstubAllEnvs();
});
const self = { pid: 123, startedAt: "now" };
it("refuses a PostgreSQL pid file with a foreign creation time or data directory", async () => {
  vi.stubEnv("MELLODIFAI_ROOT", fixture());
  const layout = nativeLayout("e2e");
  mkdirSync(layout.pgdata, { recursive: true });
  const file = join(layout.pgdata, "postmaster.pid");
  const epoch = Math.floor(Date.now() / 1000);
  vi.mocked(host.processIdentities).mockResolvedValueOnce(
    new Map([
      [
        42,
        { pid: 42, startedAt: new Date((epoch - 100) * 1000).toISOString() },
      ],
    ]),
  );
  writeFileSync(file, `42\n${layout.pgdata}\n${epoch}\n`);
  expect(await verifiedPostmaster(layout)).toBeNull();
  writeFileSync(file, `42\n${join(layout.root, "foreign")}\n${epoch}\n`);
  expect(await verifiedPostmaster(layout)).toBeNull();
  vi.mocked(host.processIdentities).mockResolvedValueOnce(
    new Map([
      [42, { pid: 42, startedAt: new Date(epoch * 1000).toISOString() }],
    ]),
  );
  writeFileSync(file, `42\n${layout.pgdata}\n${epoch}\n`);
  expect(await verifiedPostmaster(layout)).toEqual({
    pid: 42,
    startedAt: new Date(epoch * 1000).toISOString(),
  });
});
it("never signals a foreign process referenced by a stale pid record", async () => {
  const actual = await vi.importActual<typeof host>("../../lib/native/host.js");
  const runner = vi.fn<Runner>().mockResolvedValue({
    code: 0,
    stdout: "123 new-creation-time\n",
    stderr: "",
  });
  await actual.terminateTree(
    { pid: 123, startedAt: "old-creation-time" },
    runner,
    "win32",
  );
  expect(runner).toHaveBeenCalledOnce();
  expect(runner.mock.calls[0]?.[0]).toBe("powershell.exe");
});
it("takes over a stale lock but refuses a live holder", async () => {
  const path = join(fixture(), "stack.lock");
  writeFileSync(path, JSON.stringify({ pid: 98765, startedAt: "old" }));
  const release = await acquireLock(path);
  expect(JSON.parse(readFileSync(path, "utf8"))).toEqual({
    pid: process.pid,
    startedAt: "now",
  });
  vi.mocked(host.sameProcess).mockResolvedValueOnce(true);
  await expect(acquireLock(path)).rejects.toThrow("Another stack operation");
  release();
});
it("refuses an occupied lab port with a clear message without opening sockets", async () => {
  vi.stubEnv("MELLODIFAI_ROOT", fixture());
  vi.mocked(host.portOpen).mockResolvedValueOnce(true);
  const runner = vi
    .fn<Runner>()
    .mockResolvedValue({ code: 0, stdout: "----- -----\n", stderr: "" });
  await expect(
    assertPortsFree("e2e", nativeLayout("e2e"), runner),
  ).rejects.toThrow("port 45621 is already in use on 127.0.0.1");
});
it("does not trust a state file pointing at a reused pid", async () => {
  vi.stubEnv("MELLODIFAI_ROOT", fixture());
  const layout = nativeLayout("e2e");
  const state: StackState = {
    supervisor: self,
    phase: "ready",
    updatedAt: "now",
    services: {
      gateway: { status: "ready", pid: 321, startedAt: "old", restarts: 0 },
    },
  };
  const { mkdirSync } = await import("node:fs");
  mkdirSync(layout.run, { recursive: true });
  writeFileSync(join(layout.run, "state.json"), JSON.stringify(state));
  expect(
    (await nativeStatus("e2e")).services.find((s) => s.id === "gateway")?.pid,
  ).toBeNull();
});
it("stops orphan records in reverse order with creation-time identities", async () => {
  vi.stubEnv("MELLODIFAI_ROOT", fixture());
  const layout = nativeLayout("e2e");
  const state: StackState = {
    supervisor: self,
    phase: "ready",
    updatedAt: "now",
    services: {
      auth: { status: "ready", pid: 10, startedAt: "auth-time", restarts: 0 },
      gateway: {
        status: "ready",
        pid: 20,
        startedAt: "gateway-time",
        restarts: 0,
      },
    },
  };
  await stopOrphans(layout, state);
  expect(vi.mocked(host.terminateTree).mock.calls).toEqual([
    [{ pid: 20, startedAt: "gateway-time" }],
    [{ pid: 10, startedAt: "auth-time" }],
  ]);
});
it("bounds repeated deaths and does not restart after the budget is exhausted", async () => {
  const deaths: (() => void)[] = [];
  const start = vi.fn(async () => ({
    pid: 100 + deaths.length,
    exited: new Promise<void>((resolve) => deaths.push(resolve)),
    stop: async () => {},
  }));
  const supervisor = new Supervisor(
    [
      {
        kind: "service",
        id: "flaky",
        dependsOn: [],
        start,
        ready: async () => true,
      },
    ],
    self,
    {
      statePath: join(fixture(), "state.json"),
      identify: async (pid) => ({ pid, startedAt: "now" }),
      policy: { maxRestarts: 2, windowMs: 60_000, backoffMs: 1 },
    },
  );
  await supervisor.start();
  for (let index = 0; index < 3; index++) {
    deaths[index]?.();
    await vi.waitFor(() => {
      if (index < 2) expect(start).toHaveBeenCalledTimes(index + 2);
      else expect(supervisor.snapshot().services.flaky?.status).toBe("failed");
    });
  }
  expect(start).toHaveBeenCalledTimes(3);
  expect(supervisor.snapshot().services.flaky?.restarts).toBe(2);
  await supervisor.stop();
});
