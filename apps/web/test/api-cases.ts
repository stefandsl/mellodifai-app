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
export const remakeId = randomUUID();
export const sectionId = "verse-1";
export const remakeUrl = "https://youtu.be/49rDdMbXd_w";
const remakeJobs = {
  jobs: [{ job_id: jobId, version_id: versionId, stage: "remake_rewrite" }],
};
const remakeSummary = {
  remake_id: remakeId,
  project_id: projectId,
  version_id: versionId,
  stage: "review",
  lang: "it",
  title: "Mille volti",
  error_code: null,
  created_at: "2026-11-06T00:00:00Z",
  updated_at: "2026-11-06T00:00:00Z",
};
export const remakeLyricsText = "[Verse 1]\nUna riga di prova\nUn'altra riga";
export const remakeDetail = {
  remake_id: remakeId,
  project_id: projectId,
  version_id: versionId,
  stage: "review",
  lang: "it",
  country: null,
  video_id: "49rDdMbXd_w",
  url: remakeUrl,
  error_code: null,
  revision: 3,
  pending: false,
  gate_ok: true,
  accept_ready: true,
  analysis: { title: "Source title", bpm: 79 },
  lyrics: {
    title: "Mille volti",
    sections: [
      {
        id: sectionId,
        label: "Verse 1",
        lines: [
          { index: 0, text: "Una riga di prova" },
          { index: 1, text: "Un'altra riga" },
        ],
      },
    ],
  },
  lyrics_text: remakeLyricsText,
  cost: { analysisUsd: 0.01 },
  active_job: {
    job_id: jobId,
    stage: "remake_rewrite",
    status: "running",
    mode: "check",
    progress: 40,
  },
  failed_job: null,
  untrusted: true,
  created_at: "2026-11-06T00:00:00Z",
  updated_at: "2026-11-06T00:00:00Z",
};
export const remakeAcceptBody = {
  revision: 3,
  lyrics_text: remakeLyricsText,
  title: "Mille volti",
  style: "rock, 79 bpm",
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
  // The remake operations of section 7.3b, in the order the registry lists them.
  {
    name: "remakes_list",
    method: "GET",
    path: "/remakes",
    output: { remakes: [remakeSummary] },
  },
  {
    name: "remake_get",
    method: "GET",
    path: "/remakes/{remake_id}",
    output: remakeDetail,
  },
  {
    name: "remake_start",
    method: "POST",
    path: "/remakes",
    body: { url: remakeUrl, lang: "it" },
    output: {
      id: remakeId,
      jobs: [{ job_id: jobId, version_id: versionId, stage: "remake_ingest" }],
    },
  },
  {
    name: "remake_edit",
    method: "POST",
    path: "/remakes/{remake_id}/lyrics",
    body: { revision: 3, lines: [{ index: 0, text: "Una riga nuova" }] },
    output: { revision: 4, ...remakeJobs },
  },
  {
    name: "remake_regenerate_section",
    method: "POST",
    path: "/remakes/{remake_id}/sections/{section_id}/regenerate",
    body: { revision: 3 },
    output: remakeJobs,
  },
  {
    name: "remake_accept",
    method: "POST",
    path: "/remakes/{remake_id}/accept",
    body: remakeAcceptBody,
    output: {
      id: versionId,
      jobs: [{ job_id: jobId, version_id: versionId, stage: "generate_song" }],
    },
  },
  {
    name: "remake_retry",
    method: "POST",
    path: "/remakes/{remake_id}/retry",
    output: remakeJobs,
  },
  {
    name: "remake_cancel",
    method: "POST",
    path: "/remakes/{remake_id}/cancel",
    output: { jobs: [] },
  },
  {
    name: "remake_dismiss",
    method: "POST",
    path: "/remakes/{remake_id}/dismiss",
    output: { jobs: [] },
  },
] as const;

export type ApiCase = (typeof apiCases)[number];
export type Handler = (
  req: Request,
  context: { params: Promise<Record<string, string>> },
) => Promise<Response>;
export const pathParams: Record<
  "version_id" | "job_id" | "take_id" | "remake_id" | "section_id",
  string
> = {
  version_id: versionId,
  job_id: jobId,
  take_id: takeId,
  remake_id: remakeId,
  section_id: sectionId,
};
export function requestFor(
  row: ApiCase,
  token: string,
  given: Partial<typeof pathParams> = {},
) {
  const params = { ...pathParams, ...given };
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
