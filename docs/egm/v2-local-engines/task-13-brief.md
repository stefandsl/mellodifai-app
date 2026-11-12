# Task 13 brief: Video Studio with live preview and visualizer render

Read this first. It is your requirements, with the exact values to use verbatim.

## Where this fits

mellodifai is the owner's song-and-video studio (pnpm monorepo at
`C:\Users\Asus\Documents\mellodifai`, branch `build/studio-ui`). Tasks T7 to T11 of the feature
parity plan are done (library, player, create panel, playlists, details panel, stems, audio
editor). The owner said today: "I still don't see the video studio and other core functionalities
that we have there" (in fspecii/ace-step-ui). This task delivers the Video Studio.

## Requirements (all of these are binding)

1. `docs/egm/v2-local-engines/feature-parity-plan.md`: section "T13 Visualizer videos without
   lyrics", the T13 line under "Additions from the video", and the T13 additions under "From the
   owner's YouTube channel" (the "MellodifAI Classico" preset and true full-frame 9:16 Shorts).
2. `docs/egm/v2-local-engines/ace-ui-replica-prompt.md`: the "Video Studio (modal)" description
   (around line 85) and item **G. Visualizer studio with live preview** (around line 198). Item G
   is the main spec: the `VisualizerParams` schema in `packages/shared`, canvas preview driven by
   the Web Audio analyser of the current track, Remotion render from the same params, shared pure
   preset/effect math, tabs "Preset | Stile | Testo | Effetti", 16:9 / 9:16 switch, colour presets
   (10 swatches, one from the MellodifAI red) plus custom hex colours, background
   Casuale/Immagine/Video with dimming, particles, centre image, text layers, effects with a switch
   and "Intensità" each, footer "Renderizza video (MP4)" with queue position and progress, toasts
   with "Scarica" / "Riprova", last params remembered (localStorage plus a `visualizer_params`
   column so re-renders reuse them).
3. The channel house template for "MellodifAI Classico": `E:/mellodifai/research/channel/channel-report.md`.
4. Source of the original behaviour, read only, do not copy code (no licence):
   `E:/mellodifai/research/ace-step-ui` (`VideoGeneratorModal.tsx`) and
   `E:/mellodifai/research/ace-step-ui-report.md`.

Entry points the owner must find without searching: the song card's video icon / menu
"Crea video visualizer", the details panel tool strip, the create panel's Video card, and the
sidebar "Video" entry (`/library?tab=videos`, which today only filters the library; give it a clear
way into the studio for a song). Every visible control must work; nothing is a placeholder.

## Existing code to build on (explore before designing)

- Lyric videos already render on the PC: `apps/worker/src/stages/render.ts` (and `storyboard.ts`,
  `timing.ts`, `art.ts`) drive Remotion in the engine repo `C:\Users\Asus\Documents\suno-remake`.
  Reuse that Remotion setup and its render invocation; a new stage (for example `visualizer`)
  goes into `STAGES` in `packages/shared` and the worker's stage index.
- Web: `apps/web/components/studio/` (details-panel, feed, create/video-card.tsx, player-bar with
  the single `<audio>` element and `store/player.ts`), `apps/web/lib/studio/`.
- Stored files: link every stored file through `mediaUrl(path)` from `apps/web/lib/media.ts`
  (route `apps/web/app/media/[...path]/route.ts`). Never put a signed storage URL in the page:
  they expire after an hour (this was a bug fixed today, commit 707c440).
- Jobs, RPCs and RLS: `supabase/migrations/` (latest is 20261101000021). Add a migration for the
  new stage, the uploads bucket policies and `visualizer_params`; write RLS/RPC tests like the
  existing ones in the database test suite.
- Next.js here is version 16 with breaking changes: read the relevant guide in
  `apps/web/node_modules/next/dist/docs/` before writing route handlers or pages.

## Global constraints

- `npx biome check`, `tsc` (web and worker, `tsc -b` where configured) and every test suite
  (shared, worker, web, database) pass after your work. Write tests first for the shared param
  math and every new control; include the preview/render frame comparison test from item G.
- Italian UI with correct accents plus English, through the existing i18n files. Never write the
  em dash character anywhere (code, copy, commits, reports); use a plain dash.
- Never spend kie credits. The render stage is local and free. Local engines stay admin only.
- Runtime files, renders, temp files and scripts go on drive E: (`E:/mellodifai/...`); C: is
  nearly full.
- Commit on `build/studio-ui` with plain messages and no co-author or attribution lines. Never
  commit `apps/web/AGENTS.md` (written by `next dev`) or anything under `docs/egm/`.
- Do not dispatch subagents.

## Testing in the real app (required before you report done)

- Dev server: `http://localhost:3000` (already running). Supabase local is in Docker; Mailpit at
  `http://127.0.0.1:54324`. Test account `e2e-admin@mellodifai.test`, signed in through the
  Mailpit magic link. Ready scripts: `E:/mellodifai/ops/shot.mjs` (screenshots, `SIZES` env for
  custom viewports) and `E:/mellodifai/ops/play.mjs` (plays a song and reports the audio element).
  Use the test account's songs only; never touch the owner's songs.
- Gotchas: in Git Bash prefix `MSYS_NO_PATHCONV=1` when passing routes like `/library`, or they
  become `C:/Program Files/Git/library`. Heredocs collapse double backslashes: write scripts with
  regexes through the Write tool. `pgrep` does not exist; use `tasklist`.
- The production worker runs as a background node process (`src/main.ts`) appending to
  `E:/mellodifai/worker.log`. To load your new stage, restart it only when no job is running
  (check the `jobs` table): stop that node process, then start it again in the background with
  ```
  export WORKER_ENV_FILES='C:\Users\Asus\Documents\Claude\Projects\ita\.env;C:\Users\Asus\Documents\suno-remake\publish\.env;C:\Users\Asus\Documents\mellodifai\apps\worker\.env.local' && cd /c/Users/Asus/Documents/mellodifai/apps/worker && node node_modules/tsx/dist/cli.mjs src/main.ts >> E:/mellodifai/worker.log 2>&1
  ```
  Never print or log the contents of those env files. Leave the worker running when you finish.
  Do not start GPU work while a YuE2 or ACE-Step job is running (`nvidia-smi`, `jobs` table).
- Render at least one real visualizer video end to end (16:9 and 9:16) on a test-account song,
  download it, and check frames from it against the live preview with the same params.
- Be picky about pixels: check desktop 1440x900, the owner's window 1360x600, and phone 390x844,
  dark and light theme. Fix anything that looks off.

## Report

Write the full report to `docs/egm/v2-local-engines/task-13-report.md` with screenshots in
`docs/egm/v2-local-engines/task-13-shots/`: what you built, where each entry point is, test
counts, the end-to-end render evidence, any departure from the spec with the reason, and anything
left open. Return only: status (DONE, DONE_WITH_CONCERNS, BLOCKED), commits, a one-line test
summary, and concerns.
