import type { Stage, VersionStatus } from "@mellodifai/shared";
import type { Db, Job, Project, Version } from "./db.js";
import type { Engine } from "./engine.js";
import type { Secrets } from "./secrets.js";
import type { Storage } from "./storage.js";
import type { Workspace } from "./workspace.js";

export type StageContext = {
  job: Job;
  version: Version;
  project: Project;
  ws: Workspace;
  engine: Engine;
  storage: Storage;
  log(line: string): Promise<void>;
  progress(pct: number): Promise<void>;
  secrets: Secrets;
};
export type StageResult = {
  versionStatus?: VersionStatus;
  patch?: Partial<Version>;
  enqueue?: { stage: Stage; idempotencyKey: string }[];
};
export type StageHandler = (context: StageContext) => Promise<StageResult>;
export type StageRegistry = Partial<Record<Stage, StageHandler>>;
export type WorkspaceProvider = {
  forVersion(projectId: string, lang: Version["lang"]): Promise<Workspace>;
};

let renderLock: Promise<void> = Promise.resolve();
async function exclusivelyRender<T>(operation: () => Promise<T>): Promise<T> {
  const prior = renderLock;
  let release!: () => void;
  renderLock = new Promise<void>((resolve) => {
    release = resolve;
  });
  await prior;
  try {
    return await operation();
  } finally {
    release();
  }
}
const isRender = (stage: Stage) =>
  stage === "render_master" || stage === "render_hook";

export class WorkerLoop {
  private stopping = false;
  constructor(
    private readonly options: {
      db: Db;
      workerId: string;
      stages: StageRegistry;
      workspace?: WorkspaceProvider;
      engine?: Engine;
      storage?: Storage;
      secrets?: Secrets;
      engineVersion?: string;
    },
  ) {}
  async runOnce(): Promise<boolean> {
    const job = await this.options.db.claim(this.options.workerId);
    if (!job) return false;
    await this.runJob(job);
    return true;
  }
  async requeueStale() {
    return this.options.db.requeueStale(120);
  }
  stop() {
    this.stopping = true;
  }
  async runForever(): Promise<void> {
    let lastStale = 0;
    let lastWorker = 0;
    while (!this.stopping) {
      const now = Date.now();
      if (now - lastStale >= 60_000) {
        await this.requeueStale();
        lastStale = now;
      }
      if (now - lastWorker >= 15_000) {
        await this.options.db.upsertWorker({
          id: this.options.workerId,
          engine_version: this.options.engineVersion ?? null,
        });
        lastWorker = now;
      }
      const didWork = await this.runOnce();
      if (!didWork) await delay(3_000);
    }
  }
  private async runJob(job: Job): Promise<void> {
    const handler = this.options.stages[job.stage];
    if (!handler) {
      await this.options.db.failJob(
        job.id,
        `No handler registered for stage ${job.stage}`,
      );
      return;
    }
    const version = await this.options.db.getVersion(job.version_id);
    if (!version) {
      await this.options.db.failJob(
        job.id,
        `Version ${job.version_id} not found`,
      );
      return;
    }
    const project = await this.options.db.getProject(version.project_id);
    if (!project) {
      await this.options.db.failJob(
        job.id,
        `Project ${version.project_id} not found`,
      );
      return;
    }
    const { engine, secrets, storage, workspace } = this.options;
    if (!engine || !secrets || !storage || !workspace) {
      await this.options.db.failJob(
        job.id,
        "Worker dependencies are not configured",
      );
      return;
    }
    const heartbeat = setInterval(() => {
      void this.options.db.heartbeat(job.id, this.options.workerId);
    }, 15_000);
    const log = async (line: string) =>
      this.options.db.appendEvent(
        job.id,
        this.options.secrets?.redact(line) ?? line,
      );
    const progress = async (pct: number) =>
      this.options.db.appendEvent(job.id, `Progress: ${pct}%`, pct);
    const execute = async () => {
      const ws = await workspace.forVersion(project.id, version.lang);
      return handler({
        job,
        version,
        project,
        ws,
        engine: engine.withWorkspace(ws.root),
        storage,
        log,
        progress,
        secrets,
      });
    };
    try {
      const result = isRender(job.stage)
        ? await exclusivelyRender(execute)
        : await execute();
      if (this.stopping) {
        await this.options.db.requeue(job.id);
        return;
      }
      if (result.patch)
        await this.options.db.patchVersion(version.id, result.patch);
      if (result.versionStatus)
        await this.options.db.patchVersion(version.id, {
          status: result.versionStatus,
        });
      for (const next of result.enqueue ?? [])
        await this.options.db.enqueue(
          version.id,
          next.stage,
          next.idempotencyKey,
        );
      await this.options.db.finishJob(job.id, result);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      await this.options.db.failJob(job.id, message);
      await this.options.db.patchVersion(version.id, { status: "failed" });
    } finally {
      clearInterval(heartbeat);
    }
  }
}
function delay(milliseconds: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, milliseconds));
}
