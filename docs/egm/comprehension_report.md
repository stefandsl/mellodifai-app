# EGM Stage 6 - Comprehension Test

Feature range: `docs/superpowers/specs/2026-10-31-mellodifai-design.md` (lines 1 to end).
Detailed range: `docs/superpowers/plans/2026-10-31-mellodifai-platform.md` (whole file; the plan is a separate document).
Reviewer: comprehension goldfish, fresh context, read-only, documents only. Date: 31/10/2026.

## What this proposes

mellodifai is a web app that runs an existing song-making pipeline for a single admin. The admin enters a
topic, languages, style, mood and vocal gender. An LLM drafts a "lyric pack", which the admin edits and
approves. Suno (through a provider named kie, 12 credits per generation) produces two takes and the admin
picks one. A pipeline on the user's PC then does timing, storyboard, a 16:9 master render, a 9:16 "hook"
render, automatic QA and thumbnail art, and the admin approves the preview. The video is uploaded to
YouTube as private; public, unlisted or scheduled takes a separate confirm click. A project library tracks
it all.

- Web: Next.js on Vercel, writes intent rows only into Supabase (Postgres with RLS, magic-link auth for an
  admin allowlist, Storage for previews, Realtime for live status).
- A Node daemon on the PC holds every secret, claims jobs from a Postgres `jobs` table (SKIP LOCKED,
  heartbeat, stale requeue, idempotency keys, `.part` files) and runs the engine as subprocesses, one
  render at a time.
- The engine repo (suno-remake) gets an optional `ENGINE_WORKSPACE` root so each project version works
  under `E:\mellodifai\projects\<id>\<lang>\` without changing today's CLI behaviour.
- v1 is admin-only but multi-tenant, so paying customers (v2) can be added later.

Plan 1 covers only the "VBP" theme; the any-topic theme (spec 9.1) is deferred to "plan 2".

## How the existing system works, per this document

One song ("VBP", expanded only in plan Task 9 as "Va bene, passa") shipped in 11 languages, made by an
expert running CLI tools and manual steps in `C:\Users\Asus\Documents\suno-remake`: Python tools
(produce_song, beat grids, `make_storyboard.py`, `make_srt.py`, `pace_meter.py`, `clip_whisper.py`), a Node
`kie.mjs` client, a Remotion project in `motion/` rendered with `r.mjs`, and `publish/yt.py`. Inputs live in
`versions/<lang>/`, render data in `motion/public/data/<lang>/`, and `lang_pipeline.sh` chains audio and
timing. A separate "mellodifai skill" also drives the engine. VBP videos use a fixed 80-line scene map with
office-satire visuals ("OKBOT"). The reviewer could not build a working model of the timing stage, the
danger-spot checks or the VBP format from the documents alone.

## Findings

1. **Major - spec 9 item 2 (lines 153-160).** Two incompatible Supabase plans follow each other ("fresh
   free project" vs "Original plan: restore the paused project"). Delete the superseded text or move it to
   a dated History note.
2. **Major - v1 vs plan 1 scope (spec 9.1 lines 148-152, spec Goal 1 line 23, plan lines 5, 93, 169).** The
   any-topic theme is "the largest piece of work in v1" yet deferred to a plan 2 that is not linked and does
   not exist; plan 1 forces 80-line VBP packs. Add a "plan 1 vs plan 2 vs v1" paragraph to both documents.
3. **Major - undefined project terms.** VBP, kie, hook, take, lyric pack (exclude/displayMap/l10n), display
   map, stamps and stamp overshoot, chant count before the Final Chorus, spoken outro greeting, danger-spot,
   pace vs reference, cut sheet, theme, Gemini jury, the mellodifai skill, builder check,
   `codex exec -m gpt-5.6-terra`. Add a one-line glossary and one sentence per QA gate on why it exists and
   what pass means.
4. **Major - timing stage (spec line 111, plan lines 122, 153).** `lang_pipeline.sh` is never located (it
   is at `E:\suno-remake-render\out\lang_pipeline.sh`, outside the engine repo). Give its path and version
   status, and list its steps with inputs and outputs.
5. **Major - plan Task 4 vs current engine state.** It says to `git init` and create `tools/paths.py`,
   `tools/workspace_pipeline.sh`, `tools/test_workspace.py`, which all already exist. Add per-task status
   lines.
6. **Major - version state machine (plan line 87-88, spec lines 105-119).** No transition table (which
   action or stage moves each status, what Re-render, Generate again and failed recovery do). The timing-flag
   checkpoint has no status; `art` order differs (spec after QA approval, plan before `video_review`). Add a
   transition table and settle the order.
7. **Major - columns missing from the spec data model.** `qa_flags`, `workers.youtube_uploads_today`,
   `workers.kie_balance`, `admin_allowlist`, the video-review override reason, the generation attempt in
   `generate:<versionId>:<attempt>` (where stored, same as `jobs.attempts`?). List every column once with
   an owner.
8. **Major - idempotency and re-runs.** How an intentional Re-render avoids reused outputs; whether the
   `.part` path is passed to tools or outputs are renamed afterwards; the crash window between kie accepting
   a request and the task id being saved. Explain each mechanism in two or three sentences.
9. **Major - auth and RLS (spec 80-81, plan 107).** "Auth hook or trigger" undecided; whether the admin
   sees every tenant's rows; how "signups closed" fits magic-link sign-in. State the mechanism and the
   visibility rule per role.
10. **Major - images and art (spec 61, 118; plan 157).** The spec requires GPT Image via codex with kie
    fallback and a cover; the plan's `art` stage is the Pillow thumbnail only. Mark generation deferred or
    add it.
11. **Nit - engine command details.** Who produces `fps30.json`; `Video-<lang>` / `Hook-<lang>` ids;
    `kie.mjs` subcommands; layout of `E:\suno-remake-render\out\final\` used by `import_legacy`.
12. **Nit - plan line 18.** Worker secrets come from another project's `ita\.env` without explanation.
13. **Nit - spec line 23, plan line 89.** Where "mood" goes (prompt or `style`) is not stated.
14. **Nit - plan line 85, spec line 119.** `set_privacy` and `import_legacy` stages missing from the spec's
    stage list.
15. **Nit - spec lines 3, 56.** Owner not named; "never G:" without a reason.
