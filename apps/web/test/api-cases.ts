import { randomUUID } from "node:crypto";
import { defaultVisualizerParams, LyricPackSchema } from "@mellodifai/shared";

export const versionId = randomUUID();
export const jobId = randomUUID();
export const takeId = randomUUID();
export const projectId = randomUUID();
export const pack = LyricPackSchema.parse({
  title: "API test",
  lyrics: Array.from({ length: 80 }, () => "Una riga di prova").join("\n"),
  style: "pop",
  exclude: "",
  settings: { model: "V5" },
  displayMap: {},
  l10n: {},
});
export const createInput = {
  mode: "simple",
  prompt: "API fake song",
  lyrics: "",
  styles: "",
  languages: ["it"],
  vocalGender: null,
  settings: { engine: "kie" },
  count: 1,
};
export const visualizer = defaultVisualizerParams();
export const job = {
  id: jobId,
  version_id: versionId,
  stage: "timing",
  status: "queued",
  attempts: 0,
  created_at: "2026-11-06T00:00:00Z",
  started_at: null,
  finished_at: null,
  progress: null,
  error: null,
};
export const summary = {
  version_id: versionId,
  project_id: projectId,
  lang: "it",
  status: "lyrics_review",
  created_at: "2026-11-06T00:00:00Z",
  updated_at: "2026-11-06T00:00:00Z",
  test_run: true,
  title: "API test",
  take_count: 0,
  has_chosen_take: false,
  trashed: false,
};
const jobs = {
  jobs: [{ job_id: jobId, version_id: versionId, stage: "timing" }],
};

// Independent inventory of the frozen section 7.3 contract.
export const apiCases = [
  {
    name: "songs_list",
    method: "GET",
    path: "/songs",
    output: { songs: [summary], next_cursor: null },
  },
  {
    name: "song_get",
    method: "GET",
    path: "/songs/{version_id}",
    output: {
      ...summary,
      lyrics: null,
      takes: [],
      renders: [],
      active_jobs: [],
      lyric_jury: null,
      cost_usd: 0,
    },
  },
  {
    name: "job_status",
    method: "GET",
    path: "/jobs/{job_id}",
    output: { job, events: [] },
  },
  {
    name: "costs_get",
    method: "GET",
    path: "/costs",
    output: { from: "2026-11-06", to: "2026-11-06", by_provider: [], caps: [] },
  },
  {
    name: "song_create",
    method: "POST",
    path: "/songs",
    body: createInput,
    output: { project_id: projectId, ...jobs },
  },
  {
    name: "lyrics_approve",
    method: "POST",
    path: "/songs/{version_id}/lyrics/approve",
    body: { lyric_pack: pack },
    output: jobs,
  },
  {
    name: "lyrics_back",
    method: "POST",
    path: "/songs/{version_id}/lyrics/back",
    output: { version_id: versionId, status: "lyrics_review" },
  },
  {
    name: "song_generate_again",
    method: "POST",
    path: "/songs/{version_id}/generate",
    body: { generation: 1 },
    output: jobs,
  },
  {
    name: "take_pick",
    method: "POST",
    path: "/songs/{version_id}/takes/{take_id}/pick",
    output: jobs,
  },
  {
    name: "video_make",
    method: "POST",
    path: "/songs/{version_id}/video",
    output: jobs,
  },
  {
    name: "video_rerender",
    method: "POST",
    path: "/songs/{version_id}/video/rerender",
    output: jobs,
  },
  {
    name: "video_approve",
    method: "POST",
    path: "/songs/{version_id}/video/approve",
    output: { version_id: versionId, status: "approved" },
  },
  {
    name: "stage_retry",
    method: "POST",
    path: "/jobs/{job_id}/retry",
    output: jobs,
  },
  {
    name: "job_cancel",
    method: "POST",
    path: "/jobs/{job_id}/cancel",
    output: { job },
  },
  {
    name: "stems_request",
    method: "POST",
    path: "/songs/{version_id}/stems",
    output: jobs,
  },
  {
    name: "visualizer_request",
    method: "POST",
    path: "/songs/{version_id}/visualizer",
    body: { params: visualizer },
    output: jobs,
  },
] as const;

export type ApiCase = (typeof apiCases)[number];
export type Handler = (
  req: Request,
  context: { params: Promise<Record<string, string>> },
) => Promise<Response>;
export function requestFor(
  row: ApiCase,
  token: string,
  params: { version_id: string; job_id: string; take_id: string } = {
    version_id: versionId,
    job_id: jobId,
    take_id: takeId,
  },
) {
  const path = row.path.replace(
    /\{([^}]+)\}/g,
    (_, key: keyof typeof params) => params[key],
  );
  return new Request(`http://127.0.0.1:3219/api/v1${path}`, {
    method: row.method,
    headers: {
      authorization: `Bearer ${token}`,
      "Idempotency-Key": randomUUID(),
    },
    ...("body" in row ? { body: JSON.stringify(row.body) } : {}),
  });
}
