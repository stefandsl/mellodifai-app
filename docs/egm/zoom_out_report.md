# EGM Stage 5 - Initial Zoom Out Review

Target: `docs/superpowers/specs/2026-10-31-mellodifai-design.md` (full file, v1 design).
Reviewer: Skeptical Architect (zoom-out goldfish), fresh context, read-only.
Goldfish context: `docs/superpowers/plans/2026-10-31-mellodifai-platform.md`, this repo, `C:\Users\Asus\Documents\suno-remake`.
Date: 31/10/2026.

Note added by the Elephant: later the same day the user supplied the v2 studio brief
(`docs/superpowers/specs/2026-10-31-studio-brief.md`), which supersedes the "any topic" plan 2 and moves
the product toward multiple users. Findings marked (v2) below change weight under that brief.

## Verdict

Context is sufficient; objective and motivation are clear. The core trade-offs hold: third-party secrets
only on the PC, the web app writes intent only, every stage is an idempotent job, outputs are staged as
`.part` files, uploads are private with a separate click to go public. No Blockers, 7 Major, 10 Nit.
Most Majors are either the design claiming something it does not deliver, or the worker re-implementing
engine logic instead of calling it.

## Major

1. **Scope contradiction on the any-topic theme.** Section 9.1 calls the general theme the largest v1
   piece; section 2 does not list it; the plan and the user's ruling defer it to plan 2; the schema
   defaults `projects.theme` to `general` (`supabase/migrations/20261031000001_core.sql`) though only
   `vbp` works. Recommendation: move it to its own engine design, state "v1 = VBP only", default
   `theme` to `vbp` until `general` exists. (v2: the studio brief now owns this.)
2. **"v2 is an extension, not a rewrite" is unsupported.** The hard v2 problems (one PC rendering one job
   at a time, per-customer YouTube OAuth, kie metering on the admin's account, billing) are absent, while
   the cheap part (`owner_id` everywhere, composite FKs, customer-role RLS branches, `workers.owner_id`)
   is pre-built; the review log already found RPCs that check ownership but not `role='admin'`.
   Recommendation: keep `owner_id`, drop customer-role branches and composite FKs until v2, restate
   section 1. (v2: the brief makes multi-user real, so this becomes the core redesign item.)
3. **No stated reason for remote hosting in v1.** One admin whose PC must be on anyway; the cloud split
   brings storage budget and pruning, free-plan pausing and keepalive, magic-link scanner risk, the first
   login dead-end, the allowlist trigger, DNS. Recommendation: record the reason and accept the cost
   knowingly. (v2: the brief answers it: multi-user web product.)
4. **The worker re-implements or skips engine tools.** No "thin adapter" rule: lyric validation is
   rewritten in TypeScript next to `tools/lyric_gate.py`; `tools/score_takes.py` is never called (scores
   always `{}`); loudness is re-implemented in `apps/worker/src/stages/qa.ts` while `pace_meter.py`,
   `qa_sheets.py`, `qa_frames.py`, `qa_evidence.py`, `clip_whisper.py` have zero references;
   `tools/workspace_pipeline.sh` forks `lang_pipeline.sh` (which lives outside the engine repo at
   `E:\suno-remake-render\out`). Recommendation: one engine entry point per stage, move
   `lang_pipeline.sh` into the engine with an ENGINE_WORKSPACE flag and delete the fork, wire the unused
   tools, keep one source of truth for lyric gates.
5. **No single owner for the version state machine; attempts not modeled.** Transitions live in
   `packages/shared/src/status.ts`, in about 15 SQL RPCs across 12 migrations, and in the worker loop.
   Generations and re-renders became ad hoc columns on `versions`. Recommendation: Postgres RPCs are the
   authority; TypeScript only reads state; model an attempt explicitly (the job row is one spend or one
   render).
6. **The in-doubt kie submission is not designed.** The code invented `kie_submit_state='submitting'` and a
   manual `resolve_kie_submission` across migrations 7, 10 and 11. Recommendation: write the protocol
   into the design and check whether kie offers a client reference, callback or task listing for
   automatic reconciliation. (v2: the brief's webhooks and `record-info` polling address this.)
7. **Two mechanisms for chant-count and outro checks**, and neither reaches the admin (`VersionStatus` has
   no timing-review state; `qa_flags` are not shown). Recommendation: one mechanism, as must-acknowledge
   items in `video_review` with their stem clips.

## Nit

1. Multi-worker queue semantics (`SKIP LOCKED`, 2-minute stale requeue, worker registry) for one PC; also
   state the concurrency model (`loop.ts` `renderLock` vs "one Remotion job").
2. Realtime may be unnecessary for one admin; polling would remove the channel retry logic and its tests.
   (v2: the brief requires Realtime.)
3. English UI is speculative for one Italian admin. (v2: the brief requires English and Italian.)
4. Legacy import spends about 30% of the 1 GB free storage on previews already on YouTube; import
   metadata and YouTube ids instead.
5. Generated art and the Gemini jury button are not resolved in v1; state "v1 thumbnail = make_thumb.py".
6. Section 9.2 is stale (restore text, missing keepalive workflow, pg_dump called scheduled).
7. The worker reads secrets from another project (`Documents\Claude\Projects\ita\.env`); give it its own
   env file.
8. Squash the 12 same-day migrations into one baseline before the first `supabase db push`.
9. The table name `versions` is confusing; consider `tracks` or `language_versions`.
10. The engine version is never recorded (`workers.engine_version` always null); record the engine commit
    on each render.

## Key files

- `packages/shared/src/status.ts`
- `supabase/migrations/20261031000007_spend_and_staging.sql`
- `supabase/migrations/20261031000001_core.sql`
- `apps/worker/src/loop.ts`, `apps/worker/src/stages/qa.ts`
- `C:\Users\Asus\Documents\suno-remake\tools\{workspace_pipeline.sh,score_takes.py,lyric_gate.py,pace_meter.py}`
- `E:\suno-remake-render\out\lang_pipeline.sh`
- `docs/superpowers/plans/PLAN-REVIEW-LOG.md`
