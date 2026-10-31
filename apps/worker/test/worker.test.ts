import { EventEmitter } from "node:events";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { InMemoryDb } from "../src/db.js";
import { Engine } from "../src/engine.js";
import { WorkerLoop } from "../src/loop.js";
import { loadSecrets } from "../src/secrets.js";

const project = { id: "project-1", topic: "Topic", theme: "general" };
const version = {
  id: "version-1",
  project_id: project.id,
  lang: "en" as const,
  status: "producing" as const,
};
const job = {
  id: "job-1",
  version_id: version.id,
  stage: "qa" as const,
  status: "queued" as const,
  idempotency_key: "qa:1",
};
const dependencies = {
  workspace: {
    forVersion: async () => ({
      root: "",
      versionsDir: "",
      outDir: "",
      publicDir: "",
      renderDir: "",
    }),
  },
  engine: new Engine({ log: async () => {} }),
  storage: { upload: async () => {} },
  secrets: { values: {}, redact: (text: string) => text },
};

describe("worker loop", () => {
  it("fails a throwing handler and marks its version failed", async () => {
    const db = new InMemoryDb([{ ...job }], [{ ...version }], [project]);
    const loop = new WorkerLoop({
      db,
      workerId: "test",
      stages: {
        qa: async () => {
          throw new Error("broken stage");
        },
      },
      ...dependencies,
    });

    await loop.runOnce();

    expect(db.jobs[0]?.status).toBe("failed");
    expect(db.jobs[0]?.error).toContain("broken stage");
    expect(db.versions[0]?.status).toBe("failed");
  });

  it("runs render jobs sequentially", async () => {
    const jobs = [
      {
        ...job,
        id: "render-1",
        stage: "render_master" as const,
        idempotency_key: "render:1",
      },
      {
        ...job,
        id: "render-2",
        stage: "render_hook" as const,
        idempotency_key: "render:2",
      },
    ];
    const db = new InMemoryDb(jobs, [{ ...version }], [project]);
    const events: string[] = [];
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const handler = async (ctx: { job: { id: string } }) => {
      events.push(`start:${ctx.job.id}`);
      if (ctx.job.id === "render-1") await gate;
      events.push(`end:${ctx.job.id}`);
      return {};
    };
    const loop = new WorkerLoop({
      db,
      workerId: "test",
      stages: { render_master: handler, render_hook: handler },
      ...dependencies,
    });
    const first = loop.runOnce();
    const second = loop.runOnce();
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(events).toEqual(["start:render-1"]);
    release();
    await Promise.all([first, second]);
    expect(events).toEqual([
      "start:render-1",
      "end:render-1",
      "start:render-2",
      "end:render-2",
    ]);
  });

  it("requeues stale jobs", async () => {
    const db = new InMemoryDb(
      [
        {
          ...job,
          status: "running" as const,
          heartbeat_at: new Date(0).toISOString(),
        },
      ],
      [{ ...version }],
      [project],
    );
    const loop = new WorkerLoop({
      db,
      workerId: "test",
      stages: {},
      ...dependencies,
    });
    await loop.requeueStale();
    expect(db.jobs[0]?.status).toBe("queued");
  });
});

describe("engine", () => {
  it("does not leave a final file after a failed process and redoes it next time", async () => {
    const dir = await mkdtemp(join(tmpdir(), "mellodifai-"));
    const output = join(dir, "video.mp4");
    let calls = 0;
    const spawn = (_cmd: string, args: readonly string[]) => {
      const child = new EventEmitter() as EventEmitter & {
        stdout: EventEmitter;
        stderr: EventEmitter;
      };
      child.stdout = new EventEmitter();
      child.stderr = new EventEmitter();
      calls += 1;
      const destination = args[0];
      if (!destination) throw new Error("output argument is missing");
      void writeFile(destination, calls === 1 ? "partial" : "complete").then(
        () => child.emit("close", calls === 1 ? 1 : 0),
      );
      return child;
    };
    const engine = new Engine({ spawn: spawn as never, log: async () => {} });
    await expect(
      engine.run("tool", [output], { outputs: [output] }),
    ).resolves.toEqual({ code: 1 });
    await expect(readFile(output)).rejects.toThrow();
    await engine.run("tool", [output], { outputs: [output] });
    expect(await readFile(output, "utf8")).toBe("complete");
  });
});

it("redacts loaded secret values from log text", async () => {
  const dir = await mkdtemp(join(tmpdir(), "mellodifai-"));
  const envFile = join(dir, "worker.env");
  await writeFile(envFile, "TOKEN=abcdefgh12345678\nSHORT=small\n");
  const secrets = await loadSecrets({ WORKER_ENV_FILES: envFile });
  expect(secrets.redact("token abcdefgh12345678 short small")).toBe(
    "token *** short small",
  );
});
