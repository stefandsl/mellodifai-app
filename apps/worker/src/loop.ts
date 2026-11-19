import {
  keepsStatusOnFailure,
  type Stage,
  type VersionStatus,
} from "@mellodifai/shared";
import {
  AuthorizationDenied,
  authorizeSongless,
  authorizeStage,
} from "./authorization.js";
import type { LocalRuntime } from "./comfy/runtime.js";
import type { Db, Job, Project, Version } from "./db.js";
import type { Engine } from "./engine.js";
import {
  ensureReservation,
  isCapRefusal,
  kieLedger,
  type Ledger,
} from "./providers/ledger.js";
import type { LedgerForModel } from "./providers/openrouter.js";
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
  // message replaces the default "Progress: N%" text of the event.
  progress(pct: number, message?: string): Promise<void>;
  secrets: Secrets;
  db: Db;
  signal: AbortSignal;
  // The ComfyUI server of this PC, owned by main.ts; absent on workers without local engines.
  comfy?: LocalRuntime;
  providerLedger?: LedgerForModel;
  groqLedger?: () => Ledger;
  kieLedger?: () => Ledger;
  retryExtended?: boolean;
};
export type StageResult = {
  versionStatus?: VersionStatus;
  patch?: Partial<Version>;
  enqueue?: {
    stage: Stage;
    idempotencyKey: string;
  }[];
  retryLater?: { reason: string; notBefore: string };
};
export type StageHandler = (context: StageContext) => Promise<StageResult>;
export type StageRegistry = Partial<Record<Stage, StageHandler>>;
// A job that belongs to no song (lyrics_assist): no version, project or workspace.
export type SonglessContext = Pick<
  StageContext,
  "job" | "db" | "secrets" | "signal" | "log" | "progress" | "providerLedger"
>;
export type SonglessHandler = (
  context: SonglessContext,
) => Promise<Pick<StageResult, "retryLater">>;
export type SonglessRegistry = Partial<Record<Stage, SonglessHandler>>;
export type WorkspaceProvider = {
  forVersion(
    projectId: string,
    lang: Version["lang"],
    fake?: boolean,
    renderAttempt?: number,
  ): Promise<Workspace>;
};

export function useFakes(job: Pick<Job, "fake_providers">): boolean {
  return process.env.WORKER_FAKE === "1" || job.fake_providers === true;
}

let renderLock: Promise<void> = Promise.resolve();
class MissingRecord extends Error {}
async function exclusivelyRender<T>(operation: () => Promise<T>): Promise<T> {
  const prior = renderLock;
  let release = () => {};
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
type Active = {
  job: Job;
  controller: AbortController;
  lost: boolean;
  engine?: Engine;
};

// The worker counts as healthy while it runs and its last database check-in is this recent.
export const HEALTHY_WITHIN_MS = 60_000;

export class WorkerLoop {
  private stopping = false;
  private checkedInAt: number | undefined;
  private readonly shutdown = new AbortController();
  private readonly active = new Set<Active>();
  private readonly tasks = new Set<Promise<unknown>>();
  constructor(
    private readonly options: {
      db: Db;
      workerId: string;
      stages: StageRegistry;
      fakeStages?: StageRegistry;
      songless?: SonglessRegistry;
      fakeSongless?: SonglessRegistry;
      workspace?: WorkspaceProvider;
      engine?: Engine;
      storage?: Storage;
      secrets?: Secrets;
      engineVersion?: string;
      report?: (message: string) => void;
      comfy?: LocalRuntime;
      providerLedger?: LedgerForModel;
      groqLedger?: () => Ledger;
      kieLedger?: () => Ledger;
    },
  ) {}
  private redact(message: string) {
    return this.options.secrets?.redact(message) ?? message;
  }
  private report(error: unknown) {
    const message = this.redact(
      error instanceof Error ? error.message : String(error),
    );
    try {
      (this.options.report ?? console.error)(message);
    } catch {
      /* Reporting must never reject a background task. */
    }
  }
  async runOnce(): Promise<boolean> {
    if (this.stopping) return false;
    const task = this.claimAndRun();
    this.tasks.add(task);
    try {
      return await task;
    } finally {
      this.tasks.delete(task);
    }
  }
  private async claimAndRun(): Promise<boolean> {
    const job = await this.options.db.claim(this.options.workerId);
    if (!job) return false;
    if (this.stopping) {
      await this.options.db.requeue(job.id, this.options.workerId);
      return true;
    }
    await this.runJob(job);
    return true;
  }
  async requeueStale() {
    return this.options.db.requeueStale(120);
  }
  async stop(): Promise<void> {
    this.stopping = true;
    this.shutdown.abort();
    for (const active of this.active) active.controller.abort();
    await Promise.allSettled([...this.tasks]);
  }
  async forceStop(): Promise<void> {
    this.stopping = true;
    this.shutdown.abort();
    const results = await Promise.allSettled(
      [...this.active].map(async (active) => {
        active.controller.abort();
        if (!active.lost)
          await this.options.db.requeue(active.job.id, this.options.workerId);
      }),
    );
    for (const result of results)
      if (result.status === "rejected") this.report(result.reason);
  }
  private timer(operation: () => Promise<unknown>, milliseconds: number) {
    let pending: Promise<unknown> | undefined;
    const tick = () => {
      if (pending || this.stopping) return;
      pending = Promise.resolve()
        .then(operation)
        .catch((error: unknown) => this.report(error))
        .finally(() => {
          pending = undefined;
        });
    };
    const timer = setInterval(tick, milliseconds);
    return {
      tick,
      close: async () => {
        clearInterval(timer);
        await pending;
      },
    };
  }
  // Running and checked in with the database within HEALTHY_WITHIN_MS: the publishing clock
  // claims nothing otherwise (fail closed, everything stays private).
  healthy(now = Date.now()): boolean {
    return (
      !this.stopping &&
      this.checkedInAt !== undefined &&
      now - this.checkedInAt <= HEALTHY_WITHIN_MS
    );
  }
  async runForever(): Promise<void> {
    const worker = this.timer(async () => {
      await this.options.db.upsertWorker({
        id: this.options.workerId,
        busy_job_id: [...this.active][0]?.job.id ?? null,
        engine_version: this.options.engineVersion ?? null,
      });
      this.checkedInAt = Date.now();
    }, 15_000);
    const stale = this.timer(() => this.requeueStale(), 60_000);
    worker.tick();
    stale.tick();
    let backoff = 1000;
    try {
      while (!this.stopping) {
        try {
          const worked = await this.runOnce();
          backoff = 1000;
          if (!worked) await this.delay(3000);
        } catch (error) {
          this.report(error);
          await this.delay(backoff);
          backoff = Math.min(backoff * 2, 30_000);
        }
      }
    } finally {
      await Promise.all([worker.close(), stale.close()]);
    }
  }
  private async delay(ms: number) {
    if (this.stopping) return;
    await new Promise<void>((resolve) => {
      const finish = () => {
        clearTimeout(timer);
        this.shutdown.signal.removeEventListener("abort", finish);
        resolve();
      };
      const timer = setTimeout(finish, ms);
      this.shutdown.signal.addEventListener("abort", finish, { once: true });
    });
  }
  private async runJob(job: Job): Promise<void> {
    const { db, workerId } = this.options;
    const active: Active = {
      job,
      controller: new AbortController(),
      lost: false,
    };
    this.active.add(active);
    const signal = active.controller.signal;
    let authorized = false;
    let versionExists = false;
    const heartbeat = this.timer(async () => {
      if (!(await db.heartbeat(job.id, workerId))) {
        active.lost = true;
        active.controller.abort();
        this.report(`Lease lost for job ${job.id}`);
      }
    }, 15_000);
    const log = async (line: string) => {
      if (active.lost) return;
      try {
        await db.appendEvent(job, this.redact(line));
      } catch (error) {
        this.report(error);
      }
    };
    let abortListener = () => {};
    const aborted = new Promise<never>((_resolve, reject) => {
      abortListener = () => reject(new Error("Job interrupted"));
      signal.addEventListener("abort", abortListener, { once: true });
    });
    // A render may still be waiting for the mutex when cancellation arrives.
    void aborted.catch(() => {});
    const progress = async (pct: number, message?: string) => {
      signal.throwIfAborted();
      try {
        await db.appendEvent(
          job,
          this.redact(message ?? `Progress: ${pct}%`),
          pct,
        );
      } catch (error) {
        this.report(error);
      }
    };
    const executeSongless = async (): Promise<StageResult> => {
      const handler = (
        useFakes(job) ? this.options.fakeSongless : this.options.songless
      )?.[job.stage];
      if (!handler)
        throw new Error(
          `No handler registered for songless stage ${job.stage}`,
        );
      if (!(await authorizeSongless(db, job)))
        throw new MissingRecord(`Request of job ${job.id} not found`);
      authorized = true;
      const { secrets } = this.options;
      if (!secrets) throw new Error("Worker dependencies are not configured");
      return handler({
        job,
        db,
        secrets,
        signal,
        log,
        progress,
        ...(this.options.providerLedger
          ? { providerLedger: this.options.providerLedger }
          : {}),
      });
    };
    const execute = async (): Promise<StageResult> => {
      signal.throwIfAborted();
      if (job.version_id === null) return executeSongless();
      const version = await db.getVersion(job.version_id);
      signal.throwIfAborted();
      if (!version)
        throw new MissingRecord(`Version ${job.version_id} not found`);
      versionExists = true;
      const project = await db.getProject(version.project_id);
      signal.throwIfAborted();
      if (!project)
        throw new MissingRecord(`Project ${version.project_id} not found`);
      await authorizeStage(db, job, version, project);
      authorized = true;
      const handler = (
        useFakes(job) ? this.options.fakeStages : this.options.stages
      )?.[job.stage];
      if (!handler)
        throw new Error(`No handler registered for stage ${job.stage}`);
      const { engine, storage, secrets, workspace } = this.options;
      if (!engine || !storage || !secrets || !workspace)
        throw new Error("Worker dependencies are not configured");
      const ws = await workspace.forVersion(
        project.id,
        version.lang,
        useFakes(job),
        version.render_attempt ?? 1,
      );
      signal.throwIfAborted();
      active.engine = engine.withWorkspace(ws.root, log, signal);
      return handler({
        job,
        version,
        project,
        ws,
        engine: active.engine,
        storage,
        secrets,
        db,
        signal,
        log,
        progress,
        ...(this.options.providerLedger
          ? { providerLedger: this.options.providerLedger }
          : {}),
        ...(this.options.groqLedger
          ? { groqLedger: this.options.groqLedger }
          : {}),
        ...(this.options.kieLedger
          ? { kieLedger: this.options.kieLedger }
          : {}),
        ...(this.options.comfy ? { comfy: this.options.comfy } : {}),
      });
    };
    // Keep the render lock until child termination and pending log delivery complete.
    const operation = async () => {
      try {
        return await Promise.race([execute(), aborted]);
      } catch (error) {
        active.controller.abort();
        throw error;
      } finally {
        await active.engine?.settled();
      }
    };
    try {
      const result =
        job.stage === "render_master" ||
        job.stage === "render_hook" ||
        job.stage === "visualizer"
          ? await exclusivelyRender(operation)
          : await operation();
      signal.throwIfAborted();
      if (result.retryLater) {
        await db.requeue(
          job.id,
          workerId,
          result.retryLater.notBefore,
          result.retryLater.reason,
        );
        return;
      }
      // Check ownership again before publishing stage results.
      if (!(await db.heartbeat(job.id, workerId))) {
        active.lost = true;
        active.controller.abort();
        return;
      }
      signal.throwIfAborted();
      const versionId = job.version_id;
      if (versionId) {
        if (result.patch) await db.patchVersion(versionId, result.patch);
        signal.throwIfAborted();
        if (result.versionStatus)
          await db.patchVersion(versionId, { status: result.versionStatus });
        for (const next of result.enqueue ?? []) {
          signal.throwIfAborted();
          await db.enqueue(job.id, versionId, next.stage, next.idempotencyKey);
        }
      }
      signal.throwIfAborted();
      await db.finishJob(job.id, result, workerId);
    } catch (error) {
      if (!this.stopping && !active.lost) {
        const message = isCapRefusal(error)
          ? "cap_exceeded"
          : this.redact(error instanceof Error ? error.message : String(error));
        // Reads and authorization lookups can fail while Supabase/network is
        // transiently unavailable. Only a definite authorization denial is terminal.
        if (
          !authorized &&
          !(error instanceof AuthorizationDenied) &&
          !(error instanceof MissingRecord)
        ) {
          this.report(message);
          await db.requeue(
            job.id,
            workerId,
            new Date(Date.now() + 30_000).toISOString(),
            "temporary infrastructure error",
          );
          return;
        }
        this.report(message);
        await log(message);
        if (job.stage === "generate_song" || job.stage === "replace_section") {
          try {
            const submitting =
              job.stage === "generate_song"
                ? job.version_id &&
                  (await db.getVersion(job.version_id))?.kie_submit_state ===
                    "submitting"
                : typeof job.payload?.edit_id === "string" &&
                  (await db.getSectionEdit(job.payload.edit_id))
                    ?.kie_submit_state === "submitting";
            if (submitting) {
              if (!this.options.secrets)
                throw new Error("Worker secrets are not configured");
              const ledger = kieLedger({
                secrets: this.options.secrets,
                ...(this.options.kieLedger
                  ? { kieLedger: this.options.kieLedger }
                  : {}),
              });
              try {
                await ensureReservation(ledger, job);
                await ledger.markAmbiguous();
              } catch (failure) {
                // A previous attempt may already have marked it before failJob lost its lease.
                if (
                  !String((failure as Error).message).includes(
                    "reservation already closed or ambiguous",
                  )
                )
                  throw failure;
              }
            }
          } catch (failure) {
            this.report(failure);
            await db.requeue(
              job.id,
              workerId,
              new Date(Date.now() + 30_000).toISOString(),
              "mark_ambiguous pending",
            );
            return;
          }
        }
        try {
          await db.failJob(job.id, message, workerId);
        } catch (failure) {
          this.report(failure);
          await log(this.redact(String(failure)));
        }
        try {
          // An on-demand stage (stems) or a remake review step failing says nothing about
          // the song itself.
          if (versionExists && job.version_id && !keepsStatusOnFailure(job))
            await db.patchVersion(job.version_id, { status: "failed" });
        } catch (failure) {
          this.report(failure);
          await log(this.redact(String(failure)));
        }
      }
    } finally {
      signal.removeEventListener("abort", abortListener);
      await heartbeat.close();
      await active.engine?.settled();
      if (this.stopping && !active.lost) {
        try {
          await db.requeue(job.id, workerId);
        } catch (error) {
          this.report(error);
        }
      }
      this.active.delete(active);
    }
  }
}
