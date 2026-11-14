import { spawn } from "node:child_process";
import { EventEmitter } from "node:events";
import {
  appendFileSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  writeFileSync,
  writeSync,
} from "node:fs";
import { join } from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import type { NativeTools } from "../../lib/native/build.js";
import { DllInitializationError } from "../../lib/native/diagnostics.js";
import { processIdentities } from "../../lib/native/host.js";
import { nativeLayout } from "../../lib/native/layout.js";
import {
  initCluster,
  postgresService,
  stopPostgres,
} from "../../lib/native/postgres.js";
import { postgresReady } from "../../lib/native/postgres-ready.js";
import { Supervisor } from "../../lib/native/processes.js";
import { recordingRunner } from "../../lib/run.js";
import { fixture } from "./fixtures.js";

vi.mock("node:child_process", () => ({ spawn: vi.fn() }));
vi.mock("../../lib/native/postgres-ready.js", () => ({
  postgresReady: vi.fn(),
}));
vi.mock("../../lib/private-file.js", () => ({
  writePrivate: async (path: string, text: string) => writeFileSync(path, text),
}));
vi.mock("../../lib/native/host.js", async (original) => ({
  ...(await original<typeof import("../../lib/native/host.js")>()),
  processIdentities: vi.fn(),
}));
afterEach(() => {
  vi.resetAllMocks();
  vi.unstubAllEnvs();
});

function setup(codes: number[], nested = false) {
  vi.stubEnv("MELLODIFAI_ROOT", fixture());
  const layout = nativeLayout("e2e");
  mkdirSync(layout.pgdata, { recursive: true });
  writeFileSync(join(layout.pgdata, "postgresql.conf"), "");
  let launches = 0;
  vi.mocked(postgresReady).mockImplementation(
    async () => launches > codes.length,
  );
  vi.mocked(spawn).mockImplementation(() => {
    const index = launches++;
    const child = Object.assign(new EventEmitter(), {
      pid: 1000 + index,
      exitCode: null as number | null,
      signalCode: null,
      kill: vi.fn(),
    });
    queueMicrotask(() => {
      child.emit("spawn");
      child.emit("message", { pid: child.pid });
      if (index < codes.length) {
        if (nested)
          appendFileSync(
            join(layout.logs, "postgres.log"),
            "LOG: child process was terminated by exception 0xC0000142\nFATAL: could not locate matching postgres executable\n",
          );
        child.exitCode = codes[index] as number;
        child.emit("exit", child.exitCode, null);
      }
    });
    return child as unknown as ReturnType<typeof spawn>;
  });
  mkdirSync(layout.logs, { recursive: true });
  const postgres = postgresService(layout, { pgBin: fixture() } as NativeTools);
  const owner = new Supervisor(
    [
      { kind: "task", id: "cluster", dependsOn: [], run: async () => {} },
      postgres,
    ],
    { pid: 99, startedAt: "test" },
    {
      statePath: join(layout.run, "state.json"),
      identify: async (pid) => ({ pid, startedAt: "test" }),
      log: (message) =>
        appendFileSync(join(layout.logs, "supervisor.log"), `${message}\n`),
    },
  );
  return {
    layout,
    service: {
      async start() {
        await owner.start();
        return { pid: owner.snapshot().services.postgres?.pid };
      },
    },
  };
}

it.each([3221225794, -1073741502])(
  "retries a PostgreSQL DLL initialization exit %i before admitting work",
  async (code) => {
    const { layout, service } = setup([code, code]);
    const child = await service.start();
    expect(child.pid).toBe(1002);
    expect(spawn).toHaveBeenCalledTimes(3);
    expect(readFileSync(join(layout.logs, "supervisor.log"), "utf8")).toContain(
      "initialization attempt 2/3",
    );
  },
);

it("recognizes PostgreSQL's nested version-check failure even when the parent exits 1", async () => {
  const { service } = setup([1], true);
  await expect(service.start()).resolves.toMatchObject({ pid: 1001 });
  expect(spawn).toHaveBeenCalledTimes(2);
});

it("bounds persistent DLL failure and retains the reason", async () => {
  const { layout, service } = setup([
    3221225794, 3221225794, 3221225794, 3221225794,
  ]);
  await expect(service.start()).rejects.toBeInstanceOf(DllInitializationError);
  expect(spawn).toHaveBeenCalledTimes(3);
  expect(readFileSync(join(layout.logs, "supervisor.log"), "utf8")).toContain(
    "exhausted 3 initialization attempts",
  );
});

it("does not retry an ordinary failure or reuse a prior launch's nested status", async () => {
  const { layout, service } = setup([1]);
  mkdirSync(layout.logs, { recursive: true });
  writeFileSync(
    join(layout.logs, "postgres.log"),
    "LOG: child process was terminated by exception 0xC0000142\nFATAL: could not locate matching postgres executable\n",
  );
  await expect(service.start()).rejects.not.toBeInstanceOf(
    DllInitializationError,
  );
  expect(spawn).toHaveBeenCalledTimes(1);
});

it("retries pg_ctl initialization with no console and logs the bound", async () => {
  const { layout } = setup([3221225794, 3221225794, 0]);
  const epoch = Math.floor(Date.now() / 1000);
  writeFileSync(
    join(layout.pgdata, "postmaster.pid"),
    `${process.pid}\n${layout.pgdata}\n${epoch}\n`,
  );
  vi.mocked(processIdentities).mockResolvedValue(
    new Map([
      [
        process.pid,
        {
          pid: process.pid,
          startedAt: new Date(epoch * 1000).toISOString(),
        },
      ],
    ]),
  );
  mkdirSync(layout.logs, { recursive: true });
  await stopPostgres(layout, { pgBin: fixture() } as NativeTools);
  expect(spawn).toHaveBeenCalledTimes(3);
  expect(vi.mocked(spawn).mock.calls[0]?.[2]).toMatchObject({
    detached: true,
    windowsHide: true,
  });
  expect(readFileSync(join(layout.logs, "pg_ctl.log"), "utf8")).toContain(
    "initialization attempt 2/3",
  );
});

it("retries initdb only when its entry point has not run, without logging tool output", async () => {
  const { layout } = setup([]);
  const runner = recordingRunner([
    { code: 3221225794, stdout: "private-output", stderr: "private-output" },
    { code: 0, stdout: "", stderr: "" },
  ]);
  await initCluster(
    layout,
    { pgBin: fixture() } as NativeTools,
    "synthetic-value",
    runner,
  );
  expect(runner.calls).toHaveLength(2);
  const text = readFileSync(join(layout.logs, "supervisor.log"), "utf8");
  expect(text).toContain("STATUS_DLL_INIT_FAILED");
  expect(text).not.toContain("private-output");
  expect(text).not.toContain("synthetic-value");
  const ordinary = recordingRunner([{ code: 1, stdout: "", stderr: "" }]);
  await expect(
    initCluster(
      layout,
      { pgBin: fixture() } as NativeTools,
      "synthetic-value",
      ordinary,
    ),
  ).rejects.toThrow("initdb failed");
  expect(ordinary.calls).toHaveLength(1);
});

it("redacts and rotates pg_ctl's own output through the service log handling", async () => {
  const { layout } = setup([]);
  const epoch = Math.floor(Date.now() / 1000);
  writeFileSync(
    join(layout.pgdata, "postmaster.pid"),
    `${process.pid}\n${layout.pgdata}\n${epoch}\n`,
  );
  vi.mocked(processIdentities).mockResolvedValue(
    new Map([
      [
        process.pid,
        {
          pid: process.pid,
          startedAt: new Date(epoch * 1000).toISOString(),
        },
      ],
    ]),
  );
  mkdirSync(layout.logs, { recursive: true });
  const log = join(layout.logs, "pg_ctl.log");
  // A full live file: the next line must rotate it, never grow it.
  writeFileSync(log, `${"old line\n".repeat((10 * 1024 * 1024) / 9)}`);
  const secret = "Synthetic-PgCtl-Password-1";
  vi.mocked(spawn).mockImplementation((_command, _args, options) => {
    const stdio = (options as { stdio: unknown[] }).stdio;
    writeSync(
      stdio[1] as number,
      `pg_ctl: could not connect postgres://supabase_admin:${secret}@127.0.0.1:45622/postgres\nwaiting for server to shut down.... done\n`,
    );
    const child = new EventEmitter();
    queueMicrotask(() => child.emit("exit", 0, null));
    return child as unknown as ReturnType<typeof spawn>;
  });
  await stopPostgres(layout, { pgBin: fixture() } as NativeTools);
  const live = readFileSync(log, "utf8");
  expect(live).not.toContain(secret);
  expect(live).toContain("waiting for server to shut down.... done");
  expect(readFileSync(`${log}.1`, "utf8")).toContain("old line");
  expect(
    readdirSync(layout.logs).filter((name) => name.startsWith("pg_ctl")),
  ).toEqual(["pg_ctl.log", "pg_ctl.log.1"]);
});
