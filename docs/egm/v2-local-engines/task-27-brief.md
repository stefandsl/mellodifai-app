# Task 27 brief: wire "Rifai da YouTube" and the AI lyric buttons into the app

Read this first. It is your requirements.

## Where this fits

Task 24 merged `packages/remake` (ingest, analyse, rewrite, CLI) and the zod schemas in
`packages/shared/src/remake` into `build/studio-ui` (merge 44087c1). Its report is
`E:/mellodifai/reports/task-24-report.md`: read it, including its concerns. The owner's core
workflow is "Rifai da YouTube": paste a link in the create panel, get an analysed song with new
lyrics (same meaning, vibe, timing; new words; optional other language and country), review them,
then generate with the existing song pipeline. The master design is
`docs/superpowers/specs/2026-11-01-agentic-studio-design.md` section 4 (stages R1-R3); use its stage
names and its rules for remake jobs, but do not build milestone 1 (ops schema, tokens, MCP): that is
a separate plan. The owner also reported that the create panel has no button to write or rewrite
lyrics with AI.

## Requirements

1. **Worker stages** for R1 ingest, R2 analyse, R3 rewrite that call `packages/remake` (no copy of
   its logic), as jobs in the existing job system with progress events, cancel, retry and the
   existing cost ledger. Runtime files on E: (`E:/mellodifai/remakes/<videoId>/`); source media
   deleted after analysis as the package already does. Any schema change is a new additive
   migration with database tests.
2. **Create panel**: a "Rifai da YouTube" field (paste link, target language from the app's 11,
   optional country, start). Shows stage progress, then the analysis summary (BPM, key, sections,
   mood) and the rewritten lyrics per section with jury scores and notes; the owner can edit any
   line, regenerate one section, accept, then continue into the normal song generation with the
   derived style tags. Validates the URL; clear errors for private, age-gated or too-long videos.
3. **AI lyric buttons** in the create panel lyrics editor: "Scrivi con AI" (from title/brief/style),
   "Rigenera" (whole text or the selected section), "Migliora" (keep meaning, improve singability
   and rhyme), using the worker's existing lyric pipeline and jury (`apps/worker/src/stages/`), as
   jobs. Italian and English labels plus the other app languages through the existing i18n.
4. **Fix the engine concerns from the T24 report** inside `packages/remake`:
   - the Jev judge scores "original" at 0.10-0.18 on every draft: make sure judges see source lines
     clearly labelled as reference and score only the new lyrics; add a test with a fixture where a
     clearly original draft must score high;
   - the 0.55 section-meaning gate is unreachable (the source scores 0.35-0.62 against its own map):
     calibrate it relative to the source's own self-score per section (for example pass at 0.85 of
     the source's score, floor 0.30), with tests;
   - cost per run must come under 0.05 USD for analysis plus one rewrite round: cheaper model for
     drafts and line fixes, the strong model only for the final pass and the devil's advocate;
     keep model ids configurable; log cost per stage;
   - remove the hard-coded owner env file paths in `env.ts`; read the worker's own env loading
     (`WORKER_ENV_FILES`) and fail loudly when a key is missing;
   - the OpenRouter privacy filter swaps Italian words for tags: keep the fail-closed detection and
     surface it in the UI as an actionable message ("turn off the privacy filter in OpenRouter
     settings"), never as corrupted lyrics.
5. **Tests**: unit tests with network mocked; one e2e Playwright flow on the e2e stack with the
   remake stages faked (fixture analysis and lyrics from `packages/remake/test/fixtures`), proving
   paste link, progress, review, edit a line, accept, continue. Then one real run on the dev stack
   from the browser with a short Creative Commons video (the T24 one, `49rDdMbXd_w`, is fine) up to
   reviewed lyrics, without generating the song (no kie). Screenshots at 1440x900 and 1360x600 in
   `E:/mellodifai/reports/task-27-shots/`; be picky about layout and fix what looks off.

## Constraints

- Isolated worktree on your own branch from `build/studio-ui`. Another agent edits Video Studio
  preset files (`packages/shared/src/visualizer/`, `packages/visualizer/`,
  `apps/web/components/studio/` preset lists): do not touch those.
- Never spend kie credits (the worker guard refuses `.test` owners; keep it). Playwright only on the
  e2e stack (port 3210), never on the live stack. Do not restart the shared worker or Supabase
  unless your migration requires it; if so, apply migrations to the e2e stack only and note the
  dev-stack step in the report.
- Any new relative import inside `packages/shared` needs an entry in `turbopack.resolveAlias` in
  `apps/web/next.config.ts`.
- Never print or commit keys. Runtime files on E:, never C:. GPU: check `nvidia-smi` first.
- All suites pass (`pnpm -r test`, database tests on the e2e stack), `tsc -b`, web typecheck and
  biome clean. No em dash characters. Small commits, plain messages, no co-author lines. Do not
  dispatch subagents.

## Report

`E:/mellodifai/reports/task-27-report.md`. Return only: status, branch name, commits, one-line test
summary, concerns.
