import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import {
  childService,
  Supervisor,
  waitFor,
} from "../../lib/native/processes.js";
import { fixture } from "./fixtures.js";

afterEach(() => vi.unstubAllGlobals());

it("uses the service credential for readiness and refuses an unavailable database", async () => {
  const fetchMock = vi.fn(
    async (_url: string, init: RequestInit) =>
      new Response(null, {
        status:
          (init.headers as Record<string, string>).Authorization ===
          "Bearer synthetic"
            ? 200
            : 401,
      }),
  );
  vi.stubGlobal("fetch", fetchMock);
  const service = childService(
    {
      id: "storage",
      command: "unused",
      args: [],
      env: {},
      cwd: fixture(),
      dependsOn: [],
      ready: "http://127.0.0.1:46309/bucket",
      readyHeaders: { Authorization: "Bearer synthetic" },
    },
    "unused.log",
  );
  expect(await service.ready()).toBe(true);
  fetchMock.mockResolvedValueOnce(new Response(null, { status: 503 }));
  expect(await service.ready()).toBe(false);
});

it("reports a child that exits before identification with its code and last 50 safe log lines", async () => {
  const dir = fixture();
  const log = join(dir, "rest.log");
  const secret = "synthetic-password-with-special/@chars";
  const definition = {
    kind: "service" as const,
    id: "rest",
    dependsOn: [],
    ...childService(
      {
        id: "rest",
        command: process.execPath,
        cwd: dir,
        args: [
          "-e",
          `for(let i=0;i<60;i++) console.log('line-'+i); console.log(process.env.PGRST_DB_URI); process.exitCode=23;`,
        ],
        env: {
          ...process.env,
          PGRST_DB_URI: `postgres://user:${encodeURIComponent(secret)}@127.0.0.1/test`,
        } as Record<string, string>,
        ready: "http://127.0.0.1:1/",
        dependsOn: [],
      },
      log,
    ),
  };
  const supervisor = new Supervisor(
    [definition],
    { pid: process.pid, startedAt: "test" },
    {
      statePath: join(dir, "state.json"),
      identify: async () => {
        throw new Error("Process exited before it was recorded");
      },
    },
  );
  const error = await supervisor.start().catch((e) => e as Error);
  expect(error).toBeInstanceOf(Error);
  const message = (error as Error).message;
  expect(message).toContain("Native service rest");
  expect(message).toContain("exit code 23");
  expect(message).toContain(log);
  expect(message).toContain("line-59");
  expect(message).not.toContain("line-10\n");
  expect(message).not.toContain(secret);
  expect(message).not.toContain(encodeURIComponent(secret));
  expect(message).not.toContain("postgres://user:");
  expect(JSON.parse(readFileSync(join(dir, "state.json"), "utf8")).error).toBe(
    message,
  );
}, 15_000);

it("does not accept a successful readiness response after the service died", async () => {
  let die!: () => void;
  const exited = new Promise<void>((resolve) => {
    die = resolve;
  });
  const check = vi.fn(async () => {
    die();
    await Promise.resolve();
    return true;
  });
  expect(await waitFor(check, 1000, 1, exited)).toBe(false);
});

it("does not mark a dead service ready or launch its dependent", async () => {
  let die!: () => void;
  const exited = new Promise<void>((resolve) => {
    die = resolve;
  });
  const dependent = vi.fn(async () => {});
  const stop = vi.fn(async () => {});
  const supervisor = new Supervisor(
    [
      {
        kind: "service",
        id: "rest",
        dependsOn: [],
        start: async () => ({ pid: 123, exited, stop }),
        ready: async () => {
          die();
          await Promise.resolve();
          return true;
        },
      },
      { kind: "task", id: "dependent", dependsOn: ["rest"], run: dependent },
    ],
    { pid: process.pid, startedAt: "test" },
    {
      statePath: join(fixture(), "state.json"),
      identify: async (pid) => ({ pid, startedAt: "test" }),
    },
  );
  await expect(supervisor.start()).rejects.toThrow(
    "rest exited during startup",
  );
  expect(dependent).not.toHaveBeenCalled();
  expect(stop).toHaveBeenCalledOnce();
});
