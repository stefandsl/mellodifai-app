import { z } from "zod";
import { LANGS, STAGES } from "../stages.js";
import type { JobStatus as JobState } from "../status.js";

// Preserve the existing shared status type alongside the new read schema.
export type JobStatus = JobState;

const Id = z.string().uuid();
const Timestamp = z.iso.datetime({ offset: true });
export const JobRef = z.object({
  job_id: Id,
  version_id: Id.nullable(),
  stage: z.enum(STAGES),
});
export const JobStatus = z.object({
  id: Id,
  version_id: Id.nullable(),
  stage: z.enum(STAGES),
  status: z.enum(["queued", "running", "done", "failed", "cancelled"]),
  attempts: z.number().int().nonnegative(),
  created_at: Timestamp,
  started_at: Timestamp.nullable(),
  finished_at: Timestamp.nullable(),
  progress: z.number().min(0).max(1).nullable(),
  error: z.string().max(300).nullable(),
});
export const JobEvent = z.object({
  id: z.number().int(),
  at: Timestamp,
  level: z.string(),
  message: z.string().max(300),
  progress: z.number().min(0).max(100).nullable(),
});
export const SongSummary = z.object({
  version_id: Id,
  project_id: Id,
  lang: z.enum(LANGS),
  status: z.string(),
  created_at: Timestamp,
  updated_at: Timestamp,
  test_run: z.boolean(),
  title: z.string(),
  take_count: z.number().int().nonnegative(),
  has_chosen_take: z.boolean(),
  trashed: z.boolean(),
});
export const SongDetail = SongSummary.extend({
  lyrics: z.unknown().nullable(),
  takes: z.array(
    z.object({
      id: Id,
      generation: z.number().int(),
      take_number: z.number().int(),
      engine: z.string(),
      chosen: z.boolean(),
    }),
  ),
  renders: z.array(
    z.object({
      id: Id,
      kind: z.string(),
      render_attempt: z.number().int(),
      approved: z.boolean(),
      qa_passed: z.boolean(),
    }),
  ),
  active_jobs: z.array(JobStatus),
  lyric_jury: z
    .object({
      available: z.boolean(),
      passed: z.boolean(),
      scores: z.record(z.string(), z.number()),
    })
    .nullable(),
  cost_usd: z.number().nonnegative(),
});
export const CostsSummary = z.object({
  from: z.iso.date(),
  to: z.iso.date(),
  by_provider: z.array(
    z.object({
      provider: z.string(),
      usd: z.number(),
      units: z.record(z.string(), z.number()),
    }),
  ),
  caps: z.array(
    z.object({
      scope: z.enum(["global", "user", "token", "run"]),
      provider: z.string(),
      unit: z.string(),
      period: z.enum(["day", "month", "run"]),
      limit: z.number(),
      used: z.number(),
    }),
  ),
});
