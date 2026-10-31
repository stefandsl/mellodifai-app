import type { JobStatus, Lang, Stage, VersionStatus } from "@mellodifai/shared";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

export type Job = {
  owner_id?: string;
  payload?: Record<string, unknown>;
  not_before?: string | null;
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
  generation_count?: number;
  kie_generation?: number;
  kie_submit_state?: string | null;
  id: string;
  owner_id?: string;
  project_id: string;
  lang: Lang;
  status: VersionStatus;
  lyric_pack?: unknown;
  chosen_take_id?: string | null;
  timing_path?: string | null;
  storyboard_path?: string | null;
  qa_flags?: unknown;
  render_attempt?: number;
  kie_task_id?: string | null;
};
export type Project = {
  owner_id?: string;
  mood?: string | null;
  vocal_gender?: string | null;
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
  kie_balance?: number | null;
  youtube_uploads_today?: number;
  youtube_quota_day?: string | null;
};
export type Take = {
  take_number?: number;
  generation?: number;
  id: string;
  owner_id?: string;
  version_id: string;
  kie_task_id?: string | null;
  audio_preview_path?: string | null;
  scores?: unknown;
};
export type Render = {
  id: string;
  owner_id?: string;
  version_id: string;
  kind: "master" | "hook";
  path?: string | null;
  preview_path?: string | null;
  qa_results?: unknown;
};
export type Publication = {
  upload_state?: string;
  privacy_applied?: string | null;
  publish_at?: string | null;
  created_at?: string;
  id: string;
  owner_id?: string;
  render_id: string;
  youtube_video_id?: string | null;
  privacy: "private" | "public" | "unlisted" | "scheduled";
  metadata?: unknown;
  confirmed_at?: string | null;
  confirmed_by?: string | null;
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
  requeue(
    jobId: string,
    workerId: string,
    notBefore?: string,
    reason?: string,
  ): Promise<void>;
  reserveUpload(
    render: Render,
    workerId: string,
  ): Promise<{
    kind: "reserved" | "quota" | "uploading" | "uploaded";
    publication?: Publication;
  }>;
  createTake(take: Omit<Take, "id">): Promise<Take>;
  getTakes(versionId: string): Promise<Take[]>;
  upsertRender(render: Omit<Render, "id">): Promise<Render>;
  getRender(versionId: string, kind: Render["kind"]): Promise<Render | null>;
  patchRender(id: string, patch: Partial<Render>): Promise<void>;
  createPublication(publication: Omit<Publication, "id">): Promise<Publication>;
  getPublicationForVersion(versionId: string): Promise<Publication | null>;
  patchPublication(id: string, patch: Partial<Publication>): Promise<void>;
  getWorker(id: string): Promise<WorkerUpdate | null>;
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
      ...(this.ownerId ? { owner_id: this.ownerId } : {}),
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
    const { error } = await this.client.from("jobs").upsert(
      {
        owner_id: (await this.getVersion(versionId))?.owner_id,
        version_id: versionId,
        stage,
        idempotency_key: idempotencyKey,
      },
      { onConflict: "idempotency_key", ignoreDuplicates: true },
    );
    if (error) throw new Error(error.message);
  }
  async requeue(
    jobId: string,
    workerId: string,
    notBefore?: string,
    reason?: string,
  ): Promise<void> {
    const { error } = await this.client
      .from("jobs")
      .update({
        status: "queued",
        worker_id: null,
        heartbeat_at: null,
        started_at: null,
        ...(notBefore ? { not_before: notBefore, error: reason ?? null } : {}),
      })
      .eq("id", jobId)
      .eq("worker_id", workerId)
      .eq("status", "running");
    if (error) throw new Error(error.message);
  }
  async createTake(take: Omit<Take, "id">): Promise<Take> {
    const { data, error } = await this.client
      .from("takes")
      .upsert(take, { onConflict: "version_id,generation,take_number" })
      .select()
      .single();
    return requireData(data as Take | null, error);
  }
  async getTakes(versionId: string): Promise<Take[]> {
    const { data, error } = await this.client
      .from("takes")
      .select("*")
      .eq("version_id", versionId);
    if (error) throw new Error(error.message);
    return (data ?? []) as Take[];
  }
  async upsertRender(render: Omit<Render, "id">): Promise<Render> {
    const existing = await this.getRender(render.version_id, render.kind);
    if (existing) {
      await this.patchRender(existing.id, render);
      return { ...existing, ...render };
    }
    const { data, error } = await this.client
      .from("renders")
      .insert(render)
      .select()
      .single();
    return requireData(data as Render | null, error);
  }
  async getRender(
    versionId: string,
    kind: Render["kind"],
  ): Promise<Render | null> {
    const { data, error } = await this.client
      .from("renders")
      .select("*")
      .eq("version_id", versionId)
      .eq("kind", kind)
      .maybeSingle();
    if (error) throw new Error(error.message);
    return data as Render | null;
  }
  async patchRender(id: string, patch: Partial<Render>): Promise<void> {
    const { error } = await this.client
      .from("renders")
      .update(patch)
      .eq("id", id);
    if (error) throw new Error(error.message);
  }
  async createPublication(
    publication: Omit<Publication, "id">,
  ): Promise<Publication> {
    const { data, error } = await this.client
      .from("publications")
      .insert(publication)
      .select()
      .single();
    return requireData(data as Publication | null, error);
  }
  async getPublicationForVersion(
    versionId: string,
  ): Promise<Publication | null> {
    const { data, error } = await this.client
      .from("publications")
      .select("*, renders!inner(version_id)")
      .eq("renders.version_id", versionId)
      .order("created_at", { ascending: false })
      .order("id", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (error) throw new Error(error.message);
    return data as Publication | null;
  }
  async patchPublication(
    id: string,
    patch: Partial<Publication>,
  ): Promise<void> {
    const { error } = await this.client
      .from("publications")
      .update(patch)
      .eq("id", id);
    if (error) throw new Error(error.message);
  }
  async getWorker(id: string): Promise<WorkerUpdate | null> {
    const { data, error } = await this.client
      .from("workers")
      .select("*")
      .eq("id", id)
      .maybeSingle();
    if (error) throw new Error(error.message);
    return data as WorkerUpdate | null;
  }
  async reserveUpload(render: Render, workerId: string) {
    const { data, error } = await this.client.rpc(
      "reserve_publication_upload",
      { p_render: render.id, p_worker: workerId },
    );
    if (error) throw new Error(error.message);
    return data as {
      kind: "reserved" | "quota" | "uploading" | "uploaded";
      publication?: Publication;
    };
  }
}

export class InMemoryDb implements Db {
  public takes: Take[] = [];
  public renders: Render[] = [];
  public publications: Publication[] = [];
  public workers: WorkerUpdate[] = [];
  constructor(
    public jobs: Job[] = [],
    public versions: Version[] = [],
    public projects: Project[] = [],
    public events: { jobId: string; message: string; progress?: number }[] = [],
  ) {}
  async claim(workerId: string) {
    const job = this.jobs.find(
      (item) =>
        item.status === "queued" &&
        (!item.not_before || Date.parse(item.not_before) <= Date.now()),
    );
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
  async upsertWorker(worker: WorkerUpdate) {
    const existing = this.workers.find((item) => item.id === worker.id);
    if (existing) Object.assign(existing, worker);
    else this.workers.push({ ...worker });
  }
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
    if (this.jobs.some((job) => job.idempotency_key === idempotencyKey)) return;
    this.jobs.push({
      ...((await this.getVersion(versionId))?.owner_id
        ? { owner_id: (await this.getVersion(versionId))?.owner_id as string }
        : {}),
      id: crypto.randomUUID(),
      version_id: versionId,
      stage,
      status: "queued",
      idempotency_key: idempotencyKey,
    });
  }
  async requeue(
    jobId: string,
    workerId: string,
    notBefore?: string,
    reason?: string,
  ) {
    const job = this.findJob(jobId);
    if (job.worker_id !== workerId || job.status !== "running") return;
    job.status = "queued";
    job.worker_id = null;
    job.heartbeat_at = null;
    if (notBefore) {
      job.not_before = notBefore;
      job.error = reason ?? null;
    }
  }
  async createTake(take: Omit<Take, "id">) {
    const existing = this.takes.find(
      (t) =>
        t.version_id === take.version_id &&
        t.generation === take.generation &&
        t.take_number === take.take_number &&
        take.take_number !== undefined,
    );
    if (existing) {
      Object.assign(existing, take);
      return existing;
    }
    const item = { ...take, id: crypto.randomUUID() };
    this.takes.push(item);
    return item;
  }
  async getTakes(versionId: string) {
    return this.takes.filter((item) => item.version_id === versionId);
  }
  async upsertRender(render: Omit<Render, "id">) {
    const item = this.renders.find(
      (value) =>
        value.version_id === render.version_id && value.kind === render.kind,
    );
    if (item) {
      Object.assign(item, render);
      return item;
    }
    const created = { ...render, id: crypto.randomUUID() };
    this.renders.push(created);
    return created;
  }
  async getRender(versionId: string, kind: Render["kind"]) {
    return (
      this.renders.find(
        (item) => item.version_id === versionId && item.kind === kind,
      ) ?? null
    );
  }
  async patchRender(id: string, patch: Partial<Render>) {
    Object.assign(this.renders.find((item) => item.id === id) ?? {}, patch);
  }
  async createPublication(publication: Omit<Publication, "id">) {
    const item = {
      created_at: new Date().toISOString(),
      ...publication,
      id: crypto.randomUUID(),
    };
    this.publications.push(item);
    return item;
  }
  async getPublicationForVersion(versionId: string) {
    const renderIds = new Set(
      this.renders
        .filter((item) => item.version_id === versionId)
        .map((item) => item.id),
    );
    return (
      this.publications
        .filter((item) => renderIds.has(item.render_id))
        .sort(
          (a, b) =>
            (b.created_at ?? "").localeCompare(a.created_at ?? "") ||
            b.id.localeCompare(a.id),
        )[0] ?? null
    );
  }
  async patchPublication(id: string, patch: Partial<Publication>) {
    Object.assign(
      this.publications.find((item) => item.id === id) ?? {},
      patch,
    );
  }
  async getWorker(id: string) {
    return this.workers.find((item) => item.id === id) ?? null;
  }
  async reserveUpload(
    render: Render,
    workerId: string,
  ): Promise<{
    kind: "reserved" | "quota" | "uploading" | "uploaded";
    publication?: Publication;
  }> {
    // No await before both reservations: mirrors the atomic database transaction.
    const prior = this.publications.find(
      (p) =>
        p.render_id === render.id &&
        ["uploading", "uploaded"].includes(p.upload_state ?? ""),
    );
    if (prior)
      return {
        kind: prior.upload_state as "uploading" | "uploaded",
        publication: prior,
      };
    const day = new Intl.DateTimeFormat("en-CA", {
      timeZone: "America/Los_Angeles",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(new Date());
    let worker = this.workers.find((w) => w.id === workerId);
    if (!worker) {
      worker = { id: workerId };
      this.workers.push(worker);
    }
    const count =
      worker.youtube_quota_day === day
        ? (worker.youtube_uploads_today ?? 0)
        : 0;
    if (count >= 4) return { kind: "quota" };
    worker.youtube_quota_day = day;
    worker.youtube_uploads_today = count + 1;
    const publication: Publication = {
      id: crypto.randomUUID(),
      render_id: render.id,
      privacy: "private",
      upload_state: "uploading",
      created_at: new Date().toISOString(),
      ...(render.owner_id ? { owner_id: render.owner_id } : {}),
    };
    this.publications.push(publication);
    return { kind: "reserved", publication };
  }
  private findJob(id: string) {
    const job = this.jobs.find((item) => item.id === id);
    if (!job) throw new Error(`job ${id} not found`);
    return job;
  }
}
