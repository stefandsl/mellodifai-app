import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import { afterEach, expect, it, vi } from "vitest";
import { InMemoryDb } from "../src/db.js";
import { Engine } from "../src/engine.js";
import { type StageHandler, WorkerLoop } from "../src/loop.js";
import { installSignals, reportStartupFailure } from "../src/main.js";
import { loadSecrets } from "../src/secrets.js";

afterEach(() => vi.useRealTimers());
function setup(handler?: StageHandler) {
  const db = new InMemoryDb(
    [
      {
        id: "j",
        owner_id: "owner",
        version_id: "v",
        stage: "qa",
        status: "queued",
        idempotency_key: "k",
      },
    ],
    [
      {
        id: "v",
        owner_id: "owner",
        project_id: "p",
        lang: "en",
        status: "producing",
      },
    ],
    [{ id: "p", owner_id: "owner", topic: "topic", theme: "general" }],
  );
  const errors: string[] = [];
  const loop = new WorkerLoop({
    db,
    workerId: "w",
    stages: handler ? { qa: handler } : {},
    workspace: {
      forVersion: async () => ({
        root: "workspace",
        versionsDir: "",
        outDir: "",
        publicDir: "",
        renderDir: "",
      }),
    },
    engine: new Engine({ log: async () => {} }),
    storage: { upload: async () => {} },
    secrets: {
      values: {},
      redact: (line) => line.replaceAll("secret-value", "***"),
    },
    report: (line) => errors.push(line),
  });
  return { db, loop, errors };
}
const pending: StageHandler = () => new Promise(() => {});
it("redacts the startup cause with the loaded secrets", async () => {
  const secrets = await loadSecrets({ API_KEY: "startup-secret-value" });
  const log = vi.spyOn(console, "error").mockImplementation(() => {});
  await reportStartupFailure(
    new Error("startup-secret-value unavailable"),
    secrets,
  );
  expect(log).toHaveBeenCalledWith("Worker startup failed: *** unavailable");
  log.mockRestore();
});
it.each(["getVersion", "getProject"] as const)(
  "fails missing %s instead of requeueing",
  async (method) => {
    const { db, loop } = setup(async () => ({}));
    vi.spyOn(db, method).mockResolvedValue(null);
    const patch = vi.spyOn(db, "patchVersion");
    await loop.runOnce();
    expect(db.jobs[0]).toMatchObject({
      status: "failed",
      error: expect.stringContaining("not found"),
    });
    if (method === "getProject") expect(db.versions[0]?.status).toBe("failed");
    else expect(patch).not.toHaveBeenCalled();
  },
);
it.each(["getVersion", "getProject", "getTakes"] as const)(
  "requeues transient %s failures for 30 seconds with attempts preserved",
  async (method) => {
    const { db, loop } = setup(async () => ({}));
    if (method === "getTakes" && db.jobs[0])
      db.jobs[0].payload = { take_id: "take" };
    vi.spyOn(db, method).mockRejectedValueOnce(
      new Error("network unavailable"),
    );
    const before = Date.now();
    await loop.runOnce();
    expect(db.jobs[0]).toMatchObject({ status: "queued", attempts: 1 });
    expect(Date.parse(db.jobs[0]?.not_before ?? "")).toBeGreaterThanOrEqual(
      before + 30_000,
    );
    expect(db.versions[0]?.status).toBe("producing");
  },
);
it("fails both the job and version on authorization denial", async () => {
  const { db, loop } = setup(async () => ({}));
  if (db.jobs[0]) db.jobs[0].owner_id = "intruder";
  await loop.runOnce();
  expect(db.jobs[0]?.status).toBe("failed");
  expect(db.versions[0]?.status).toBe("failed");
});
it("fails both job and version when no handler exists", async () => {
  const { db, loop } = setup();
  await loop.runOnce();
  expect(db.jobs[0]?.error).toContain("No handler");
  expect(db.versions[0]?.status).toBe("failed");
});
it("redacts thrown errors and still patches the version when failJob fails", async () => {
  const { db, loop, errors } = setup(async () => {
    throw new Error("secret-value");
  });
  const fail = vi
    .spyOn(db, "failJob")
    .mockRejectedValue(new Error("fail secret-value"));
  await loop.runOnce();
  expect(fail.mock.calls[0]?.[1]).toBe("***");
  expect(db.versions[0]?.status).toBe("failed");
  expect(JSON.stringify([errors, db.events])).not.toContain("secret-value");
  expect(errors.join()).toContain("fail ***");
});
it("heartbeats and maintains worker and stale timers during a long job", async () => {
  vi.useFakeTimers();
  const { db, loop } = setup(pending);
  const heartbeat = vi.spyOn(db, "heartbeat");
  const online = vi.spyOn(db, "upsertWorker");
  const stale = vi.spyOn(db, "requeueStale");
  const running = loop.runForever();
  await vi.advanceTimersByTimeAsync(60_000);
  expect(heartbeat).toHaveBeenCalledTimes(4);
  expect(online.mock.calls.length).toBeGreaterThanOrEqual(4);
  expect(stale.mock.calls.length).toBeGreaterThanOrEqual(2);
  await loop.stop();
  await running;
  expect(db.jobs[0]?.status).toBe("queued");
  expect(db.jobs[0]?.attempts).toBe(1);
});
it("lease loss aborts a pending handler without finishing or failing", async () => {
  vi.useFakeTimers();
  const { db, loop } = setup(pending);
  vi.spyOn(db, "heartbeat").mockResolvedValue(false);
  const finish = vi.spyOn(db, "finishJob");
  const fail = vi.spyOn(db, "failJob");
  const running = loop.runOnce();
  await vi.advanceTimersByTimeAsync(15_000);
  await running;
  expect(finish).not.toHaveBeenCalled();
  expect(fail).not.toHaveBeenCalled();
  expect(db.versions[0]?.status).toBe("producing");
});
it("backs off on transient claim errors and recovers", async () => {
  vi.useFakeTimers();
  const { db, loop } = setup(pending);
  const claim = vi
    .spyOn(db, "claim")
    .mockRejectedValueOnce(new Error("offline"))
    .mockRejectedValueOnce(new Error("offline"));
  const running = loop.runForever();
  await vi.advanceTimersByTimeAsync(999);
  expect(claim).toHaveBeenCalledTimes(1);
  await vi.advanceTimersByTimeAsync(1);
  expect(claim).toHaveBeenCalledTimes(2);
  await vi.advanceTimersByTimeAsync(2000);
  expect(claim).toHaveBeenCalledTimes(3);
  await loop.stop();
  await running;
});
it("catches heartbeat and maintenance failures while continuing to run", async () => {
  vi.useFakeTimers();
  const { db, loop, errors } = setup(pending);
  vi.spyOn(db, "heartbeat").mockRejectedValueOnce(
    new Error("heartbeat offline"),
  );
  vi.spyOn(db, "upsertWorker").mockRejectedValueOnce(
    new Error("worker offline"),
  );
  vi.spyOn(db, "requeueStale").mockRejectedValueOnce(
    new Error("sweep offline"),
  );
  const running = loop.runForever();
  await vi.advanceTimersByTimeAsync(30_000);
  expect(errors.join()).toContain("heartbeat offline");
  expect(errors.join()).toContain("worker offline");
  expect(errors.join()).toContain("sweep offline");
  await loop.stop();
  await running;
});
it.each(["SIGINT", "SIGTERM"])(
  "%s requeues even when the handler rejects on abort",
  async (signal) => {
    let entered = () => {};
    const ready = new Promise<void>((resolve) => {
      entered = resolve;
    });
    const { db, loop } = setup(async (ctx) => {
      entered();
      await new Promise<void>((_resolve, reject) =>
        ctx.signal.addEventListener(
          "abort",
          () => reject(new Error("killed")),
          { once: true },
        ),
      );
      return {};
    });
    const source = new EventEmitter();
    const exit = vi.fn();
    const remove = installSignals(loop, source, exit);
    const running = loop.runOnce();
    await ready;
    source.emit(signal);
    await running;
    await loop.stop();
    expect(db.jobs[0]?.status).toBe("queued");
    expect(db.jobs[0]?.attempts).toBe(1);
    expect(db.versions[0]?.status).toBe("producing");
    await Promise.resolve();
    expect(exit).toHaveBeenCalledWith(0);
    expect(await loop.runOnce()).toBe(false);
    remove();
  },
);
it("a second signal attempts requeue before forcing exit", async () => {
  const source = new EventEmitter();
  let attempted = false;
  const exit = vi.fn(() => expect(attempted).toBe(true));
  const stop = vi.fn(() => new Promise<void>(() => {}));
  const forceStop = vi.fn(async () => {
    attempted = true;
  });
  const remove = installSignals({ stop, forceStop }, source, exit);
  source.emit("SIGINT");
  source.emit("SIGTERM");
  await Promise.resolve();
  expect(forceStop).toHaveBeenCalledOnce();
  expect(exit).toHaveBeenCalledWith(0);
  remove();
});
it("guards terminal writes and requeue against another worker's lease", async () => {
  const { db } = setup();
  await db.claim("new-worker");
  await db.finishJob("j", {}, "old-worker");
  await db.failJob("j", "oops", "old-worker");
  await db.requeue("j", "old-worker");
  expect(db.jobs[0]?.status).toBe("running");
  expect(db.jobs[0]?.worker_id).toBe("new-worker");
});
it.each(["stop", "lease loss"])(
  "routes engine output into redacted job events and kills children on %s",
  async (reason) => {
    vi.useFakeTimers();
    const child = Object.assign(new EventEmitter(), {
      stdout: new PassThrough(),
      stderr: new PassThrough(),
      kill: vi.fn(() => true),
    });
    let entered = () => {};
    const ready = new Promise<void>((resolve) => {
      entered = resolve;
    });
    const { db } = setup();
    const finish = vi.spyOn(db, "finishJob");
    const fail = vi.spyOn(db, "failJob");
    if (reason === "lease loss")
      vi.spyOn(db, "heartbeat").mockResolvedValue(false);
    // Supply the fake child to the stage's engine through the loop dependency.
    const engine = new Engine({
      spawn: () => child,
      log: async () => {
        throw new Error("wrong sink");
      },
    });
    const testLoop = new WorkerLoop({
      db,
      workerId: "w",
      stages: {
        qa: async (ctx) => {
          const run = ctx.engine.run("tool", []);
          entered();
          await run;
          return {};
        },
      },
      engine,
      workspace: {
        forVersion: async () => ({
          root: "ws",
          versionsDir: "",
          outDir: "",
          publicDir: "",
          renderDir: "",
        }),
      },
      storage: { upload: async () => {} },
      secrets: {
        values: {},
        redact: (line) => line.replaceAll("secret-value", "***"),
      },
    });
    const running = testLoop.runOnce();
    await ready;
    child.stdout.write("secret-value\n");
    if (reason === "stop") await testLoop.stop();
    else await vi.advanceTimersByTimeAsync(15_000);
    await running;
    expect(child.kill).toHaveBeenCalled();
    expect(db.events.some((event) => event.message === "***")).toBe(true);
    expect(finish).not.toHaveBeenCalled();
    expect(fail).not.toHaveBeenCalled();
    expect(db.jobs[0]?.status).toBe(reason === "stop" ? "queued" : "running");
  },
);

it("redacts and reports both failed error writes and failed version patches", async () => {
  const { db, loop, errors } = setup(async () => {
    throw new Error("secret-value");
  });
  vi.spyOn(db, "failJob").mockRejectedValue(new Error("job secret-value"));
  vi.spyOn(db, "patchVersion").mockRejectedValue(
    new Error("version secret-value"),
  );
  vi.spyOn(db, "appendEvent").mockRejectedValue(
    new Error("event secret-value"),
  );
  await expect(loop.runOnce()).resolves.toBe(true);
  expect(errors).toContain("job ***");
  expect(errors).toContain("version ***");
  expect(errors).toContain("event ***");
  expect(errors.join()).not.toContain("secret-value");
});

it("requeues when the handler resolves after shutdown", async () => {
  let entered = () => {};
  const ready = new Promise<void>((resolve) => {
    entered = resolve;
  });
  const { db, loop } = setup(async (ctx) => {
    entered();
    await new Promise<void>((resolve) =>
      ctx.signal.addEventListener("abort", () => resolve(), { once: true }),
    );
    return { versionStatus: "published" };
  });
  const running = loop.runOnce();
  await ready;
  await loop.stop();
  await running;
  expect(db.jobs[0]?.status).toBe("queued");
  expect(db.versions[0]?.status).toBe("producing");
});
