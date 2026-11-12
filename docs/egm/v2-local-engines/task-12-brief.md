# Task 12 brief: songs from songs (rewrite a part, import from Suno, upload, cover, reference)

Read this first. It is your requirements, with the exact values to use verbatim.

## Where this fits

mellodifai is the owner's song-and-video studio (pnpm monorepo at
`C:\Users\Asus\Documents\mellodifai`, branch `build/studio-ui`). T7 to T11 and T13 (Video Studio)
are done. The owner asked for this task directly: "I want the same UI, the same functionality as
in Suno" for regenerating a part of a song with new lyrics, plus importing the songs he makes on
his own suno.com account.

## Requirements (binding)

1. `docs/egm/v2-local-engines/feature-parity-plan.md`: section "T12 Songs from songs", the "T12
   additions" under "Owner requests 2026-11-01 (evening)" and the T12 line under "Owner decisions
   2026-11-01 (late evening)". Also `ace-ui-replica-prompt.md` in the same folder wherever it
   covers upload, reference, cover, repaint or transcription.
2. **"Riscrivi una parte"** (priority 1), modelled on Suno's Replace Section. Research Suno's
   current Replace Section UI and limits first (help pages, videos; record what you find in the
   report) and match its flow: on the song (song page, details panel, editor) the owner selects
   a range on the waveform; the lyric lines sung in that range highlight (use the word timing the
   timing stage already produces when it exists, else let him mark the lines); he edits only
   those lines; he picks the engine; the cost shows before confirm for kie; generation makes
   alternatives for that range; he auditions each one inside the song (pre-roll and post-roll
   around the range) and keeps one; the kept result becomes a new take of the same song, the
   original stays available. Engines: kie Replace Section
   (https://docs.kie.ai/suno-api/replace-section: `infillStartS`, `infillEndS`, `fullLyrics`,
   optional segment `lyrics`, needs the kie `taskId` and `audioId` of the take, so store those on
   takes if they are not stored yet) and ACE-Step repaint locally if the installed ComfyUI nodes
   support it (check `/object_info`); hide an engine that cannot do it.
3. **"Importa da Suno"**: drop MP3/WAV/FLAC files (up to 50 MB each, which is the current local
   storage limit) or paste a suno.com song share link; title, style and lyrics pasted or
   transcribed; the song lands in the library as a normal song and can go on to the video
   pipeline. No automation of suno.com (its terms forbid robots and scraping): a pasted link is
   resolved with one plain request for that song's public page/audio only, at the owner's click.
4. Upload into the create panel, "Usa come riferimento" and "Cover di questa canzone" from the
   song menu and details panel, kie upload-cover / upload-extend (verify current endpoints in
   docs.kie.ai), ACE-Step cover/reference if supported, automatic transcription (Groq Whisper, the
   key is already in the worker env) into the lyrics box, cancellable.
5. Remix credits and a source/licence field on songs made from other audio (feeds T17 later).

Every visible control works; nothing is a placeholder.

## Existing code to build on

- Worker: `apps/worker/src/stages/` (`generate-song.ts` and `kie` client usage, `local-engine.ts`
  for ComfyUI/ACE-Step, `take-audio.ts`, `timing.ts` for word timing, `stems.ts`,
  `visualizer.ts`); stages are listed in `STAGES` in `packages/shared/src/stages.ts`.
- Web: `apps/web/components/studio/` (details-panel, editor/audio-editor.tsx with its waveform,
  create/ panel, feed cards), `apps/web/lib/studio/`, server actions in `apps/web/app/actions/`.
- Link every stored file through `mediaUrl(path)` from `apps/web/lib/media.ts` (uploads bucket
  paths go through `/media/uploads/...`, see `apps/web/app/media/[...path]/route.ts`).
- Any new relative import inside `packages/shared` needs a matching entry in
  `turbopack.resolveAlias` in `apps/web/next.config.ts`, or every page breaks with "Module not
  found". Check the dev server renders after each shared change; the owner uses it live.
- Migrations in `supabase/migrations/` (latest from T13); add RLS/RPC tests like the existing
  database tests.
- Next.js 16 with breaking changes: read `apps/web/node_modules/next/dist/docs/` before writing
  routes or pages.

## Global constraints

- `npx biome check`, every `tsc`, and every test suite (shared, worker, web, database, visualizer)
  pass after your work. Tests first for new logic.
- **Never spend kie credits.** Mock kie in tests. End-to-end, drive the kie paths up to the cost
  confirmation dialog and stop; do the real end-to-end generation with ACE-Step locally (free).
  Never start GPU work while another GPU job runs (`nvidia-smi`, `jobs` table).
- Local engines are admin only. Italian UI with correct accents plus English via the i18n files.
  Never write the em dash character anywhere; use a plain dash.
- Runtime files and scripts on E: (`E:/mellodifai/...`); C: has little space.
- Commit on `build/studio-ui`, plain messages, no co-author or attribution lines. Never commit
  `apps/web/AGENTS.md` or anything under `docs/egm/`. Do not dispatch subagents.

## Testing in the real app (required)

- Dev server `http://localhost:3000`; Mailpit `http://127.0.0.1:54324`; test account
  `e2e-admin@mellodifai.test` via magic link. Scripts: `E:/mellodifai/ops/shot.mjs` (`SIZES` env),
  `E:/mellodifai/ops/play.mjs`, `E:/mellodifai/ops/task11/login.mjs` (saves a storage state).
  Use only the test account's songs.
- Git Bash gotchas: prefix `MSYS_NO_PATHCONV=1` when passing routes like `/library`; write scripts
  containing regexes with the Write tool (heredocs collapse backslashes); no `pgrep`.
- The worker runs as a background node process appending to `E:/mellodifai/worker.log`. To load
  new stages, restart it only when no job runs: stop that node process, then start it in the
  background with
  ```
  export WORKER_ENV_FILES='C:\Users\Asus\Documents\Claude\Projects\ita\.env;C:\Users\Asus\Documents\suno-remake\publish\.env;C:\Users\Asus\Documents\mellodifai\apps\worker\.env.local' && cd /c/Users/Asus/Documents/mellodifai/apps/worker && node node_modules/tsx/dist/cli.mjs src/main.ts >> E:/mellodifai/worker.log 2>&1
  ```
  Never print env file contents. Leave the worker running.
- Pixel check at 1440x900, the owner's 1360x600 and phone 390x844, dark and light.

## Report

Full report to `docs/egm/v2-local-engines/task-12-report.md`, screenshots in
`docs/egm/v2-local-engines/task-12-shots/`: what you built and where, the Suno research, test
counts, end-to-end evidence, departures with reasons, open items. Return only: status, commits, a
one-line test summary, concerns.
