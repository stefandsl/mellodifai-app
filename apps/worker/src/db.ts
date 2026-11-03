import type {
  JobStatus,
  Lang,
  RemakeErrorCode,
  RemakeStage,
  Stage,
  VersionStatus,
} from "@mellodifai/shared";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { EngineAvailability } from "./comfy/availability.js";

export type Job = {
  owner_id?: string;
  payload?: Record<string, unknown>;
  not_before?: string | null;
  id: string;
  // null only for the songless lyrics_assist jobs (migration 20261102000025).
  version_id: string | null;
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
  lyric_timing?: unknown;
  lyric_jury?: unknown;
  chosen_take_id?: string | null;
  timing_path?: string | null;
  storyboard_path?: string | null;
  storyboard_sections?: unknown;
  qa_flags?: unknown;
  render_attempt?: number;
  kie_task_id?: string | null;
  kie_task_state?: "failed" | null;
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
  song_settings?: unknown;
  source?: Record<string, unknown> | null;
};
export type Remake = {
  id: string;
  owner_id: string;
  project_id: string;
  version_id: string;
  url: string;
  video_id: string;
  lang: Lang;
  country: string | null;
  stage: RemakeStage;
  error_code: RemakeErrorCode | null;
  error: string | null;
  source: Record<string, unknown> | null;
  analysis: unknown;
  lyrics: unknown;
  pending: { lines?: { index: number; text: string }[]; title?: string } | null;
  revision: number;
  cost: Record<string, number>;
};
export type LyricRequest = {
  id: string;
  owner_id: string;
  mode: string;
  lang: Lang;
  input: unknown;
  result: unknown;
  error_code: string | null;
};
export type WorkerUpdate = {
  id: string;
  owner_id?: string;
  busy_job_id?: string | null;
  engine_version?: string | null;
  kie_balance?: number | null;
  youtube_uploads_today?: number;
  youtube_quota_day?: string | null;
  // Local engines found on this PC (file checks), read by the studio's engine selector.
  engines?: Record<string, EngineAvailability>;
};
export type Take = {
  take_number?: number;
  generation?: number;
  id: string;
  created_at?: string;
  owner_id?: string;
  version_id: string;
  kie_task_id?: string | null;
  audio_preview_path?: string | null;
  scores?: unknown;
  // "edit": saved from the studio's audio editor, its audio lives only in storage.
  // "import": a recording the owner brought in (import_audio).
  engine?: "kie" | "ace-step" | "yue2" | "edit" | "import";
  seed?: number | null;
  cover_path?: string | null;
  abc?: string | null;
  // Written by the stems stage (stages/stems.ts, StemSet).
  stems?: unknown;
  // Suno's id of the track (kie record data.response.data[].id), for replace-section.
  kie_audio_id?: string | null;
  // How the take was made when it is not a plain generation (migration 20261101000023).
  source?: Record<string, unknown> | null;
  // The sung lines with their times (shared LyricTimingSchema).
  lyric_timing?: unknown;
  // The lyrics this take sings when they differ from the song's.
  lyrics?: string | null;
};
// One "Riscrivi una parte" request (migration 20261101000023).
export type SectionAlternative = {
  path: string;
  duration: number;
  kie_task_id?: string;
  kie_audio_id?: string;
  lyric_timing?: unknown;
};
export type SectionEdit = {
  id: string;
  owner_id?: string;
  version_id: string;
  take_id: string;
  engine: "kie" | "ace-step";
  start_s: number;
  end_s: number;
  duration_s: number;
  section_lines: number[];
  section_lyrics: string;
  full_lyrics: string;
  old_lyrics: string;
  alternatives: SectionAlternative[];
  kie_task_id?: string | null;
  kie_submit_state?: "submitting" | "submitted" | null;
  kept_take_id?: string | null;
  discarded_at?: string | null;
};
export type Render = {
  render_attempt?: number;
  approved_at?: string | null;
  id: string;
  owner_id?: string;
  version_id: string;
  // "visualizer": a Video Studio render, one per aspect (migration 20261101000022).
  kind: "master" | "hook" | "visualizer";
  path?: string | null;
  preview_path?: string | null;
  qa_results?: unknown;
  aspect?: "16:9" | "9:16" | null;
  visualizer_params?: unknown;
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
  previewRows(versionId: string): Promise<{ renders: Render[]; takes: Take[] }>;
  claim(workerId: string): Promise<Job | null>;
  heartbeat(jobId: string, workerId: string): Promise<boolean>;
  requeueStale(seconds: number): Promise<number>;
  finishJob(jobId: string, result: unknown, workerId: string): Promise<void>;
  failJob(jobId: string, error: string, workerId: string): Promise<void>;
  // Events belong to the job's owner (job_events_job_owner_fkey), whoever runs the worker.
  appendEvent(
    job: Pick<Job, "id" | "owner_id">,
    message: string,
    progress?: number,
  ): Promise<void>;
  upsertWorker(worker: WorkerUpdate): Promise<void>;
  getVersion(id: string): Promise<Version | null>;
  getProject(id: string): Promise<Project | null>;
  patchVersion(id: string, patch: Partial<Version>): Promise<void>;
  enqueue(
    versionId: string,
    stage: Stage,
    idempotencyKey: string,
    payload?: Record<string, unknown>,
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
  releaseUpload(
    publicationId: string,
    workerId: string,
    error: string,
  ): Promise<void>;
  createTake(take: Omit<Take, "id">): Promise<Take>;
  getTakes(versionId: string): Promise<Take[]>;
  // Any take by id (a cover's source belongs to another song of the same owner).
  getTake(id: string): Promise<Take | null>;
  patchTake(id: string, patch: Partial<Take>): Promise<void>;
  getSectionEdit(id: string): Promise<SectionEdit | null>;
  patchSectionEdit(id: string, patch: Partial<SectionEdit>): Promise<void>;
  upsertRender(render: Omit<Render, "id">): Promise<Render>;
  getRender(versionId: string, kind: Render["kind"]): Promise<Render | null>;
  getRenderById(id: string): Promise<Render | null>;
  patchRender(id: string, patch: Partial<Render>): Promise<void>;
  createPublication(publication: Omit<Publication, "id">): Promise<Publication>;
  getPublicationForVersion(versionId: string): Promise<Publication | null>;
  patchPublication(id: string, patch: Partial<Publication>): Promise<void>;
  getWorker(id: string): Promise<WorkerUpdate | null>;
  // profiles.role of a song's owner: local engines are for the admin only (design 5.5).
  getOwnerRole(ownerId: string): Promise<string | null>;
  // profiles.email of a song's owner: kie is never called for test accounts (kie/guard.ts).
  getOwnerEmail(ownerId: string): Promise<string | null>;
  // Replaces jobs.payload of a job this worker runs; local engines keep their seeds there
  // before the first submit.
  patchJobPayload(
    jobId: string,
    workerId: string,
    payload: Record<string, unknown>,
  ): Promise<void>;
  patchProject(id: string, patch: Partial<Project>): Promise<void>;
  getRemakeByVersion(versionId: string): Promise<Remake | null>;
  // Writes the patch; with ifRevision, only while the row still has that revision (the person's
  // edits bump it), and returns whether it wrote.
  patchRemake(
    id: string,
    patch: Partial<Remake>,
    ifRevision?: number,
  ): Promise<boolean>;
  getLyricRequest(id: string): Promise<LyricRequest | null>;
  patchLyricRequest(id: string, patch: Partial<LyricRequest>): Promise<void>;
}

function requireData<T>(data: T | null, error: { message: string } | null): T {
  if (error) throw new Error(error.message);
  if (data === null) throw new Error("database returned no data");
  return data;
}

export class SupabaseDb implements Db {
  async previewRows(versionId: string) {
    const { data, error } = await this.client
      .from("renders")
      .select("*")
      .eq("version_id", versionId);
    if (error) throw new Error(error.message);
    return {
      renders: (data ?? []) as Render[],
      takes: await this.getTakes(versionId),
    };
  }
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
    job: Pick<Job, "id" | "owner_id">,
    message: string,
    progress?: number,
  ): Promise<void> {
    const owner = job.owner_id ?? this.ownerId;
    const event = {
      ...(owner ? { owner_id: owner } : {}),
      job_id: job.id,
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
    payload?: Record<string, unknown>,
  ): Promise<void> {
    const { error } = await this.client.from("jobs").upsert(
      {
        owner_id: (await this.getVersion(versionId))?.owner_id,
        version_id: versionId,
        stage,
        idempotency_key: idempotencyKey,
        ...(payload ? { payload } : {}),
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
  async getTake(id: string): Promise<Take | null> {
    const { data, error } = await this.client
      .from("takes")
      .select("*")
      .eq("id", id)
      .maybeSingle();
    if (error) throw new Error(error.message);
    return (data as Take | null) ?? null;
  }
  async patchTake(id: string, patch: Partial<Take>): Promise<void> {
    const { error } = await this.client
      .from("takes")
      .update(patch)
      .eq("id", id);
    if (error) throw new Error(error.message);
  }
  async getSectionEdit(id: string): Promise<SectionEdit | null> {
    const { data, error } = await this.client
      .from("section_edits")
      .select("*")
      .eq("id", id)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!data) return null;
    const row = data as SectionEdit;
    // numeric columns arrive as strings.
    return {
      ...row,
      start_s: Number(row.start_s),
      end_s: Number(row.end_s),
      duration_s: Number(row.duration_s),
    };
  }
  async patchSectionEdit(
    id: string,
    patch: Partial<SectionEdit>,
  ): Promise<void> {
    const { error } = await this.client
      .from("section_edits")
      .update(patch)
      .eq("id", id);
    if (error) throw new Error(error.message);
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
      .eq(
        "render_attempt",
        (await this.getVersion(versionId))?.render_attempt ?? 1,
      )
      .maybeSingle();
    if (error) throw new Error(error.message);
    return data as Render | null;
  }
  async getRenderById(id: string): Promise<Render | null> {
    const { data, error } = await this.client
      .from("renders")
      .select("*")
      .eq("id", id)
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
  async getOwnerEmail(ownerId: string): Promise<string | null> {
    const { data, error } = await this.client
      .from("profiles")
      .select("email")
      .eq("id", ownerId)
      .maybeSingle();
    if (error) throw new Error(error.message);
    return (data as { email?: string } | null)?.email ?? null;
  }
  async getOwnerRole(ownerId: string): Promise<string | null> {
    const { data, error } = await this.client
      .from("profiles")
      .select("role")
      .eq("id", ownerId)
      .maybeSingle();
    if (error) throw new Error(error.message);
    return (data as { role?: string } | null)?.role ?? null;
  }
  async patchJobPayload(
    jobId: string,
    workerId: string,
    payload: Record<string, unknown>,
  ): Promise<void> {
    const { error } = await this.client
      .from("jobs")
      .update({ payload })
      .eq("id", jobId)
      .eq("worker_id", workerId)
      .eq("status", "running");
    if (error) throw new Error(error.message);
  }
  async patchProject(id: string, patch: Partial<Project>): Promise<void> {
    const { error } = await this.client
      .from("projects")
      .update(patch)
      .eq("id", id);
    if (error) throw new Error(error.message);
  }
  async getRemakeByVersion(versionId: string): Promise<Remake | null> {
    const { data, error } = await this.client
      .from("remakes")
      .select("*")
      .eq("version_id", versionId)
      .maybeSingle();
    if (error) throw new Error(error.message);
    return data as Remake | null;
  }
  async patchRemake(
    id: string,
    patch: Partial<Remake>,
    ifRevision?: number,
  ): Promise<boolean> {
    let query = this.client.from("remakes").update(patch).eq("id", id);
    if (ifRevision !== undefined) query = query.eq("revision", ifRevision);
    const { data, error } = await query.select("id");
    if (error) throw new Error(error.message);
    return (data ?? []).length > 0;
  }
  async getLyricRequest(id: string): Promise<LyricRequest | null> {
    const { data, error } = await this.client
      .from("lyric_requests")
      .select("*")
      .eq("id", id)
      .maybeSingle();
    if (error) throw new Error(error.message);
    return data as LyricRequest | null;
  }
  async patchLyricRequest(
    id: string,
    patch: Partial<LyricRequest>,
  ): Promise<void> {
    const { error } = await this.client
      .from("lyric_requests")
      .update(patch)
      .eq("id", id);
    if (error) throw new Error(error.message);
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
  async releaseUpload(
    publicationId: string,
    workerId: string,
    errorMessage: string,
  ) {
    const { error } = await this.client.rpc("release_youtube_upload", {
      p_publication: publicationId,
      p_worker: workerId,
      p_error: errorMessage,
    });
    if (error) throw new Error(error.message);
  }
}

export class InMemoryDb implements Db {
  async previewRows(versionId: string) {
    return {
      renders: this.renders.filter((r) => r.version_id === versionId),
      takes: await this.getTakes(versionId),
    };
  }
  public takes: Take[] = [];
  public renders: Render[] = [];
  public publications: Publication[] = [];
  public workers: WorkerUpdate[] = [];
  public profiles: { id: string; role: string; email?: string }[] = [];
  public sectionEdits: SectionEdit[] = [];
  public remakes: Remake[] = [];
  public lyricRequests: LyricRequest[] = [];
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
  async appendEvent(
    job: Pick<Job, "id" | "owner_id">,
    message: string,
    progress?: number,
  ) {
    const jobId = job.id;
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
  async enqueue(
    versionId: string,
    stage: Stage,
    idempotencyKey: string,
    payload?: Record<string, unknown>,
  ) {
    if (this.jobs.some((job) => job.idempotency_key === idempotencyKey)) return;
    this.jobs.push({
      ...(payload ? { payload } : {}),
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
  async getTake(id: string) {
    return this.takes.find((item) => item.id === id) ?? null;
  }
  async patchTake(id: string, patch: Partial<Take>) {
    Object.assign(this.takes.find((item) => item.id === id) ?? {}, patch);
  }
  async getSectionEdit(id: string) {
    return this.sectionEdits.find((item) => item.id === id) ?? null;
  }
  async patchSectionEdit(id: string, patch: Partial<SectionEdit>) {
    Object.assign(
      this.sectionEdits.find((item) => item.id === id) ?? {},
      patch,
    );
  }
  async upsertRender(render: Omit<Render, "id">) {
    const item = this.renders.find(
      (value) =>
        value.version_id === render.version_id &&
        value.kind === render.kind &&
        (value.render_attempt ?? 1) === (render.render_attempt ?? 1),
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
        (item) =>
          item.version_id === versionId &&
          item.kind === kind &&
          (item.render_attempt ?? 1) ===
            (this.versions.find((v) => v.id === versionId)?.render_attempt ??
              1),
      ) ?? null
    );
  }
  async getRenderById(id: string) {
    return this.renders.find((item) => item.id === id) ?? null;
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
  async getOwnerRole(ownerId: string) {
    return this.profiles.find((item) => item.id === ownerId)?.role ?? null;
  }
  async getOwnerEmail(ownerId: string) {
    // Tests that do not name an e-mail stand for a real (non-test) owner.
    return (
      this.profiles.find((item) => item.id === ownerId)?.email ??
      `${ownerId}@example.com`
    );
  }
  async patchJobPayload(
    jobId: string,
    workerId: string,
    payload: Record<string, unknown>,
  ) {
    const job = this.findJob(jobId);
    if (job.worker_id !== workerId || job.status !== "running") return;
    job.payload = { ...payload };
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
  async releaseUpload(publicationId: string, workerId: string, _error: string) {
    const publication = this.publications.find((p) => p.id === publicationId);
    if (publication?.upload_state !== "uploading") return;
    publication.upload_state = "pending";
    const worker = this.workers.find((w) => w.id === workerId);
    if (worker)
      worker.youtube_uploads_today = Math.max(
        0,
        (worker.youtube_uploads_today ?? 0) - 1,
      );
  }
  async patchProject(id: string, patch: Partial<Project>) {
    Object.assign(this.projects.find((item) => item.id === id) ?? {}, patch);
  }
  async getRemakeByVersion(versionId: string) {
    return this.remakes.find((item) => item.version_id === versionId) ?? null;
  }
  async patchRemake(id: string, patch: Partial<Remake>, ifRevision?: number) {
    const remake = this.remakes.find((item) => item.id === id);
    if (!remake || (ifRevision !== undefined && remake.revision !== ifRevision))
      return false;
    Object.assign(remake, patch);
    return true;
  }
  async getLyricRequest(id: string) {
    return this.lyricRequests.find((item) => item.id === id) ?? null;
  }
  async patchLyricRequest(id: string, patch: Partial<LyricRequest>) {
    Object.assign(
      this.lyricRequests.find((item) => item.id === id) ?? {},
      patch,
    );
  }
  private findJob(id: string) {
    const job = this.jobs.find((item) => item.id === id);
    if (!job) throw new Error(`job ${id} not found`);
    return job;
  }
}
