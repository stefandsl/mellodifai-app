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
export const scheduleId = randomUUID();
// The answer of every publishing write ("Pubblica", migration 20261119000001).
export const scheduleView = {
  schedule_id: scheduleId,
  version_id: versionId,
  project_id: projectId,
  render_id: takeId,
  lang: "it",
  state: "awaiting_approval",
  revision: 2,
  slot_at: "2026-11-21T17:00:00+00:00",
  veto_deadline_at: "2026-11-21T17:00:00+00:00",
  veto_open: true,
  held_reason: null,
  price_eur: 0,
  created_via: "pat",
  vetoed_at: null,
  media: null,
  approval: {
    approval_id: jobId,
    state: "pending",
    summary:
      'YouTube: "API test" diventa pubblico il 21/11/2026 18:00 (ora di Roma).',
    price_eur: 0,
    platforms: ["youtube"],
    requested_via: "pat",
    expires_at: "2026-11-21T17:00:00+00:00",
    decided_at: null,
    decided_via: null,
  },
  destinations: [
    {
      destination_id: jobId,
      platform: "youtube",
      provider: "native",
      account_id: "default",
      state: "draft",
      draft: {
        title: "API test",
        description: "",
        tags: ["pop"],
        thumbnail_text: "",
      },
      problems: [],
      external_url: null,
      published_at: null,
      error: null,
    },
  ],
  events: [
    {
      at: "2026-11-19T10:00:00+00:00",
      kind: "planned",
      actor: "pat",
      detail: {},
    },
  ],
  created_at: "2026-11-19T10:00:00+00:00",
  updated_at: "2026-11-19T10:00:00+00:00",
};
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
export const mvElementId = randomUUID();
export const mvShotId = randomUUID();
export const mvTakeId = randomUUID();
const mvProjectId = randomUUID();
const mvElement = {
  id: mvElementId,
  project_id: mvProjectId,
  key: "singer",
  kind: "character",
  name: "Mara",
  description: "La cantante",
  ref_asset_ids: [],
  updated_at: "2026-11-14T00:00:00Z",
};
const mvShot = {
  id: mvShotId,
  project_id: mvProjectId,
  scene_id: randomUUID(),
  position: 0,
  segment: 0,
  start_frame: 0,
  end_frame: 90,
  kind: "lipsync-single",
  burst: [],
  size: "close-up",
  angle: "eye-level",
  movement: "static",
  lens: "50mm",
  mood: "notturno",
  lyrics: "Una riga di prova",
  energy: 0.5,
  cast_ids: [mvElementId],
  location_id: null,
  updated_at: "2026-11-14T00:00:00Z",
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
  // The music-video storyboard operations, in the order the registry lists them.
  {
    name: "music_video_plan_request",
    method: "POST",
    path: "/songs/{version_id}/music-video/plan",
    output: {
      jobs: [
        { job_id: jobId, version_id: versionId, stage: "music_video_plan" },
      ],
    },
  },
  {
    name: "music_video_storyboard",
    method: "GET",
    path: "/songs/{version_id}/music-video",
    output: { storyboard: null },
  },
  {
    name: "music_video_element_update",
    method: "POST",
    path: "/music-video/elements/{element_id}",
    body: { patch: { name: "Mara", description: "La cantante" } },
    output: { element: mvElement },
  },
  {
    name: "music_video_shot_update",
    method: "POST",
    path: "/music-video/shots/{shot_id}",
    body: { patch: { size: "close-up", mood: "notturno" } },
    output: { shot: mvShot },
  },
  {
    name: "music_video_take_request",
    method: "POST",
    path: "/music-video/shots/{shot_id}/takes",
    body: { phase: "draft" },
    output: {
      take_id: mvTakeId,
      shot_id: mvShotId,
      phase: "draft",
      model: "bytedance/seedance-2-5",
      status: "quoted",
      price: { credits: 136, seconds: 4 },
    },
  },
  {
    name: "publish_plan",
    method: "POST",
    path: "/publish/plans",
    body: {
      version_id: versionId,
      platforms: ["youtube"],
      draft: { tags: ["pop"] },
    },
    output: scheduleView,
  },
  {
    name: "publish_status",
    method: "GET",
    path: "/songs/{version_id}/publish",
    output: { version_id: versionId, schedules: [scheduleView] },
  },
  {
    name: "publish_preview",
    method: "GET",
    path: "/publish/{schedule_id}",
    output: scheduleView,
  },
  {
    name: "publish_draft_edit",
    method: "POST",
    path: "/publish/{schedule_id}/draft",
    body: { draft: { title: "API test" } },
    output: scheduleView,
  },
  {
    name: "publish_schedule",
    method: "POST",
    path: "/publish/{schedule_id}/schedule",
    body: { slot_at: "2026-11-21T18:00:00+01:00" },
    output: scheduleView,
  },
  {
    name: "publish_request_approval",
    method: "POST",
    path: "/publish/{schedule_id}/request-approval",
    output: scheduleView,
  },
  {
    name: "publish_veto",
    method: "POST",
    path: "/publish/{schedule_id}/veto",
    output: scheduleView,
  },
  {
    name: "publish_cancel",
    method: "POST",
    path: "/publish/{schedule_id}/cancel",
    output: scheduleView,
  },
] as const;

export type ApiCase = (typeof apiCases)[number];
export type Handler = (
  req: Request,
  context: { params: Promise<Record<string, string>> },
) => Promise<Response>;
export const pathParams: Record<
  | "version_id"
  | "job_id"
  | "take_id"
  | "remake_id"
  | "section_id"
  | "element_id"
  | "shot_id"
  | "schedule_id",
  string
> = {
  schedule_id: scheduleId,
  version_id: versionId,
  job_id: jobId,
  take_id: takeId,
  remake_id: remakeId,
  section_id: sectionId,
  element_id: mvElementId,
  shot_id: mvShotId,
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
