import type { JobStatus, Lang, Stage, VersionStatus } from "@mellodifai/shared";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

export type Job = {
  id: string;
  version_id: string;
  stage: Stage;
  status: JobStatus;
  idempotency_key: string;
  attempts?: number;
  heartbeat_at?: string | null;
  error?: string | null;
  worker_id?: string | null;
};
export type Version = {
  id: string;
  project_id: string;
  lang: Lang;
  status: VersionStatus;
  lyric_pack?: unknown;
  chosen_take_id?: string | null;
  timing_path?: string | null;
  storyboard_path?: string | null;
  qa_flags?: unknown;
};
export type Project = {
  id: string;
  topic: string;
  theme: string;
  brief?: string | null;
  style?: string | null;
};
export type WorkerUpdate = {
  id: string;
  owner_id?: string;
  busy_job_id?: string | null;
  engine_version?: string | null;
};

export interface Db {
  claim(workerId: string): Promise<Job | null>;
  heartbeat(jobId: string, workerId: string): Promise<boolean>;
  requeueStale(seconds: number): Promise<number>;
  finishJob(jobId: string, result: unknown, workerId: string): Promise<void>;
  failJob(jobId: string, error: string, workerId: string): Promise<void>;
  appendEvent(jobId: string, message: string, progress?: number): Promise<void>;
  upsertWorker(worker: WorkerUpdate): Promise<void>;
  getVersion(id: string): Promise<Version | null>;
  getProject(id: string): Promise<Project | null>;
  patchVersion(id: string, patch: Partial<Version>): Promise<void>;
  enqueue(
    versionId: string,
    stage: Stage,
    idempotencyKey: string,
  ): Promise<void>;
  requeue(jobId: string, workerId: string): Promise<void>;
}

function requireData<T>(data: T | null, error: { message: string } | null): T {
  if (error) throw new Error(error.message);
  if (data === null) throw new Error("database returned no data");
  return data;
}

export class SupabaseDb implements Db {
  private readonly client: SupabaseClient;
  constructor(
    url: string,
    serviceRoleKey: string,
    private readonly ownerId?: string,
  ) {
    this.client = createClient(url, serviceRoleKey);
  }
  async claim(workerId: string): Promise<Job | null> {
    const { data, error } = await this.client.rpc("claim_job", {
      p_worker: workerId,
    });
    if (error) throw new Error(error.message);
    return (data?.[0] as Job | undefined) ?? null;
  }
  async heartbeat(jobId: string, workerId: string): Promise<boolean> {
    const { data, error } = await this.client.rpc("heartbeat_job", {
      p_job: jobId,
      p_worker: workerId,
    });
    return requireData(data, error);
  }
  async requeueStale(seconds: number): Promise<number> {
    const { data, error } = await this.client.rpc("requeue_stale", {
      p_seconds: seconds,
    });
    return requireData(data, error);
  }
  async finishJob(
    jobId: string,
    result: unknown,
    workerId: string,
  ): Promise<void> {
    const { error } = await this.client
      .from("jobs")
      .update({
        status: "done",
        result: result ?? {},
        finished_at: new Date().toISOString(),
        heartbeat_at: null,
      })
      .eq("id", jobId)
      .eq("worker_id", workerId)
      .eq("status", "running");
    if (error) throw new Error(error.message);
  }
  async failJob(
    jobId: string,
    errorMessage: string,
    workerId: string,
  ): Promise<void> {
    const { error } = await this.client
      .from("jobs")
      .update({
        status: "failed",
        error: errorMessage,
        finished_at: new Date().toISOString(),
        heartbeat_at: null,
      })
      .eq("id", jobId)
      .eq("worker_id", workerId)
      .eq("status", "running");
    if (error) throw new Error(error.message);
  }
  async appendEvent(
    jobId: string,
    message: string,
    progress?: number,
  ): Promise<void> {
    const event = {
      job_id: jobId,
      message,
      ...(progress === undefined ? {} : { progress }),
    };
    const { error } = await this.client.from("job_events").insert(event);
    if (error) throw new Error(error.message);
  }
  async upsertWorker(worker: WorkerUpdate): Promise<void> {
    if (!this.ownerId && !worker.owner_id)
      throw new Error("WORKER_OWNER_ID is required to create a worker row");
    const { error } = await this.client.from("workers").upsert({
      ...worker,
      owner_id: worker.owner_id ?? this.ownerId,
      last_seen: new Date().toISOString(),
    });
    if (error) throw new Error(error.message);
  }
  async getVersion(id: string): Promise<Version | null> {
    const { data, error } = await this.client
      .from("versions")
      .select("*")
      .eq("id", id)
      .maybeSingle();
    if (error) throw new Error(error.message);
    return data as Version | null;
  }
  async getProject(id: string): Promise<Project | null> {
    const { data, error } = await this.client
      .from("projects")
      .select("*")
      .eq("id", id)
      .maybeSingle();
    if (error) throw new Error(error.message);
    return data as Project | null;
  }
  async patchVersion(id: string, patch: Partial<Version>): Promise<void> {
    const { error } = await this.client
      .from("versions")
      .update(patch)
      .eq("id", id);
    if (error) throw new Error(error.message);
  }
  async enqueue(
    versionId: string,
    stage: Stage,
    idempotencyKey: string,
  ): Promise<void> {
    const { error } = await this.client.from("jobs").insert({
      version_id: versionId,
      stage,
      idempotency_key: idempotencyKey,
    });
    if (error) throw new Error(error.message);
  }
  async requeue(jobId: string, workerId: string): Promise<void> {
    const { error } = await this.client
      .from("jobs")
      .update({
        status: "queued",
        worker_id: null,
        heartbeat_at: null,
        started_at: null,
      })
      .eq("id", jobId)
      .eq("worker_id", workerId)
      .eq("status", "running");
    if (error) throw new Error(error.message);
  }
}

export class InMemoryDb implements Db {
  constructor(
    public jobs: Job[] = [],
    public versions: Version[] = [],
    public projects: Project[] = [],
    public events: { jobId: string; message: string; progress?: number }[] = [],
  ) {}
  async claim(workerId: string) {
    const job = this.jobs.find((item) => item.status === "queued");
    if (!job) return null;
    job.status = "running";
    job.worker_id = workerId;
    job.attempts = (job.attempts ?? 0) + 1;
    job.heartbeat_at = new Date().toISOString();
    return job;
  }
  async heartbeat(jobId: string, workerId: string) {
    const job = this.jobs.find(
      (item) =>
        item.id === jobId &&
        item.worker_id === workerId &&
        item.status === "running",
    );
    if (!job) return false;
    job.heartbeat_at = new Date().toISOString();
    return true;
  }
  async requeueStale(seconds: number) {
    const cutoff = Date.now() - seconds * 1000;
    let count = 0;
    for (const job of this.jobs)
      if (
        job.status === "running" &&
        job.heartbeat_at &&
        Date.parse(job.heartbeat_at) < cutoff
      ) {
        job.status = "queued";
        job.worker_id = null;
        job.heartbeat_at = null;
        count += 1;
      }
    return count;
  }
  async finishJob(jobId: string, _result: unknown, workerId: string) {
    const job = this.findJob(jobId);
    if (job.worker_id !== workerId || job.status !== "running") return;
    job.status = "done";
  }
  async failJob(jobId: string, error: string, workerId: string) {
    const job = this.findJob(jobId);
    if (job.worker_id !== workerId || job.status !== "running") return;
    job.status = "failed";
    job.error = error;
  }
  async appendEvent(jobId: string, message: string, progress?: number) {
    this.events.push(
      progress === undefined
        ? { jobId, message }
        : { jobId, message, progress },
    );
  }
  async upsertWorker(_worker: WorkerUpdate) {}
  async getVersion(id: string) {
    return this.versions.find((item) => item.id === id) ?? null;
  }
  async getProject(id: string) {
    return this.projects.find((item) => item.id === id) ?? null;
  }
  async patchVersion(id: string, patch: Partial<Version>) {
    Object.assign(this.versions.find((item) => item.id === id) ?? {}, patch);
  }
  async enqueue(versionId: string, stage: Stage, idempotencyKey: string) {
    this.jobs.push({
      id: crypto.randomUUID(),
      version_id: versionId,
      stage,
      status: "queued",
      idempotency_key: idempotencyKey,
    });
  }
  async requeue(jobId: string, workerId: string) {
    const job = this.findJob(jobId);
    if (job.worker_id !== workerId || job.status !== "running") return;
    job.status = "queued";
    job.worker_id = null;
    job.heartbeat_at = null;
  }
  private findJob(id: string) {
    const job = this.jobs.find((item) => item.id === id);
    if (!job) throw new Error(`job ${id} not found`);
    return job;
  }
}
