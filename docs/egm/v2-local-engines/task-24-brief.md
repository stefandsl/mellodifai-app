# Task 24 brief: the remake engine (YouTube link -> analysis -> rewritten lyrics), as a package

Read this first. It is your requirements.

## Where this fits

The owner's core workflow is "Rifai da YouTube": paste a YouTube link, get a new song and video
that keep the original's **timing, structure and mood**, with lyrics that carry **the same meaning
and vibe in new words** (optionally in another language), safe for YouTube copyright. The master
design is `docs/superpowers/specs/2026-11-01-agentic-studio-design.md` (section 4, stages R1-R3,
plus sections 6, 7 and 10). This task builds R1-R3 as a standalone, tested package with a CLI. A
later task wires it into the worker and the web UI (a "Rifai da YouTube" field in the create panel
and AI lyric buttons); another agent is editing the create panel right now, so you must not touch
`apps/web` or `apps/worker`.

## What to build

`packages/remake` (TypeScript, ESM, same tooling as `packages/shared`), with Python helpers where
the audio work needs them, exposing:

1. **ingest(url, outDir)**: yt-dlp download of audio (and a low-res video for frames) plus
   captions and metadata (use `yt-dlp-ejs` and `--js-runtimes node`; see the owner's memory note:
   plain yt-dlp gets 403 on video), transcript from captions else Whisper through Groq
   (`GROQ_API_KEY` from env, never printed), scene-cut frames plus 1 fps contact sheets. Output on E:
   (`E:/mellodifai/remakes/<videoId>/`). The downloaded media is for analysis only.
2. **analyse(dir)**: BPM, key, time signature, sections with timestamps, vocal type,
   instrumentation, energy curve; lyric meaning map per section (theme, story beat, imagery,
   emotional arc, hook idea); a first **video blueprint** JSON (shots aligned to sections and
   beats, palette, typography roles, motion vocabulary) from frames via a vision model. Define the
   blueprint and analysis schemas with zod in this package.
3. **rewrite(analysis, options)**: new lyrics per section in the target language, same meaning
   map, syllable count and stress fitted to each original line's timing; optional cultural
   adaptation for a target country; style tags for the generator derived from the analysis (no
   artist names). **Originality check**: per line lexical and semantic similarity against the
   source lyrics (and against a literal translation of them when the language changes), with
   thresholds; lines above threshold are rewritten. Jury: several models score singability,
   meaning fidelity, originality and YouTube safety, plus a devil's advocate; rounds until pass or
   cap; return scores and notes.
4. A CLI `remake <url> [--lang it] [--country IT] [--out E:/...]` that runs all three and prints a
   summary plus the JSON paths.

Models: use OpenRouter (key `OPENROUTER_API_KEY` from the worker env files; there is a known
privacy filter on that account that replaces names with tags like [PERSON_NAME]: detect it and
fail loudly rather than return corrupted lyrics) with the same writer/judge models the worker's
lyric pipeline uses (`apps/worker/src/stages/lyric-jury.ts`, read it, do not modify it). Keep the
model ids configurable. Cost per run must be logged and stay small (target under 0.05 USD).

## Prior art to reuse (read first)

- `C:\Users\Asus\Documents\suno-remake`: `DECOMPOSITION.md`, `PRODUCTION-PLAN.md`,
  `tools/analyze_audio.py`, `beat_grid.py`, `beat_this_grid.py`, `whisper_words.py`,
  `align_words.py`, `filmstrips.py`, `research/edit-grammar.md`: the owner's earlier hand-run
  remake of a video (the "LGTM" song) used these. Reuse or call them rather than rewriting.
- The `/watch` skill method (frames, contact sheets, captions):
  `C:\Users\Asus\.claude\skills\watch\` if present.

## Constraints

- Work only in your worktree on your branch. Do not touch `apps/web`, `apps/worker`, migrations,
  or the running services. Do not restart the worker or Supabase.
- Tests first for the schemas, originality scoring, syllable fitting and section alignment (with
  small fixtures; network calls mocked in unit tests). One real end-to-end run on a short public
  music video (pick a Creative Commons one, for example from the YouTube Audio Library or a CC BY
  artist), showing the analysis, blueprint and rewritten lyrics, recorded in the report.
- Never print or commit keys. No em dash characters anywhere. Runtime files on E:. GPU: do not
  start GPU work if `nvidia-smi` shows another job (the owner's worker may be rendering); CPU is
  fine.
- Commit on your branch in small steps, plain messages, no co-author lines. Do not dispatch
  subagents.

## Report

Write `docs/egm/v2-local-engines/task-24-report.md` in your worktree (it will not be committed:
docs/egm is untracked; also copy it to `E:/mellodifai/reports/task-24-report.md`). Return only:
status, branch name, commits, one-line test summary, concerns.
