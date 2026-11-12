# Task 28 brief: no built-in branding in the Video Studio, the owner adds his own logos

Read this first. It is your requirements.

## Where this fits

The owner's words: "TAKE OUT THE WORD AIMELODIA from the presets and the logo, the logos I have to
have the option to add them". Today the Video Studio (shared drawing in
`packages/shared/src/visualizer/`, Remotion render in `packages/visualizer`, preview and tabs in
`apps/web/components/studio/video/`, render stage `apps/worker/src/stages/visualizer.ts`) bakes in
the owner's old channel branding:

- `defaultVisualizerParams()` sets `classico.artist = "AIMELODIA"` and
  `classico.website = "STEFANDSL.COM"` (`viz-params.ts`), and `songLines()` (`viz-kit.ts`) shows that
  artist line on every player-style preset;
- text fallbacks to "MELLODIFAI" in `viz-draw.ts` (Classico intro card) and `viz-looks.ts` (badges);
- MellodifAI Classico always draws two brand marks, the red trumpet player and the gramophone
  (`/brand/mellodifai-trumpet.png`, `/brand/mellodifai-logo.png`; `pictures.ts` TRUMPET_URL and
  GRAMOPHONE_URL, `marks`; the worker copies them from BRAND); `classico.gramophone` picks its colour;
- the frame-comparison test uses `mellodifai-logo.png` as its centre picture, so every report frame
  shows the logo.

## Requirements

1. **No built-in brand text.** Defaults for artist and website are empty. No preset ever draws
   "AIMELODIA", "STEFANDSL.COM" or "MELLODIFAI" unless the user typed it. An empty line is not
   drawn and leaves no gap; the Classico "ARTIST / PRESENTS" intro card is skipped when the artist
   is empty; badges with no text and no title are not drawn. Saved settings from before this
   change (no `logos` field) that still carry the old defaults exactly ("AIMELODIA",
   "STEFANDSL.COM") read as empty; anything else the user typed is kept. Unit tests for all of it.
2. **No built-in logos.** Remove the trumpet and gramophone marks from Classico, the
   `classico.gramophone` field and its UI, TRUMPET_URL/GRAMOPHONE_URL/`marks`, and the worker's
   brand copy. Classico's layout must still look composed without them (look at the frames). Keep
   `apps/web/public/brand/mellodifai-logo.png`: the app's own sidebar uses it.
3. **User logos.** New param `logos`: up to 2 entries `{ assetUrl, position, size, opacity }`,
   default `[]`. `assetUrl` is an upload through the existing studio upload
   (`lib/studio/visualizer/upload.ts`, same as the centre image); position is one of the four
   corners; size is a percent of the frame's short side (4-30, default 12); opacity 0-100 (default
   100). Every preset draws them, in one shared helper used by preview and render, on top of the
   preset and under the effects, contain-fit (never cropped or stretched, transparency kept), inside
   the shared 5% safe area from T26. In 9:16 the bottom corners stay clear of the Shorts UI (use the
   same rule as the badges). A logo never overlaps the badges or the title/artist text: if a corner
   is taken, show it in the frames and fix the layout rule, with a test. Normalisation reads broken
   or missing entries field by field like the rest of `normalizeVisualizerParams`.
4. **UI.** A "Loghi" / "Logos" section in the Style tab next to the centre image: "Aggiungi logo"
   upload (max 2), and per logo a thumbnail, corner chips, size and opacity sliders, and remove.
   Italian and English labels plus the other app languages through the existing i18n. Remove the
   gramophone colour control from the Text tab.
5. **Worker render.** The visualizer stage fetches the logo uploads the way it fetches the centre
   upload (`fetchStored`) and passes them to the Remotion props; a missing upload is skipped, not a
   failed render.
6. **Tests and checks.** Extend the preview/render frame comparison with logos (one corner each,
   16:9 and 9:16) and switch its fixtures to a neutral test picture and a neutral test logo you make
   (not any MellodifAI or AIMELODIA artwork). Render short clips of Classico, `playercard`,
   `dotline` and `circle`, without logos and with one test logo, at 1920x1080 and 1080x1920, under
   `E:/mellodifai/render-tmp/task28/`; look at the frames and fix what looks off. Then check the
   Style tab for real in the browser on the e2e stack (port 3210, e2e admin, never the live stack):
   add a logo, move it, resize it, remove it, at 1440x900 and 1360x600, and be picky about the
   layout. Screenshots and frames in `E:/mellodifai/reports/task-28-shots/`.

## Constraints

- Isolated worktree on your own branch from `build/studio-ui`. Another agent (Task 27) edits the
  create panel, the lyric editor, `packages/remake` and the worker's remake stages: do not touch
  those. If you both add i18n keys, keep yours in their own block so the merge is easy.
- Any new relative import inside `packages/shared` needs an entry in `turbopack.resolveAlias` in
  `apps/web/next.config.ts`.
- Do not restart the shared worker or Supabase. Check `nvidia-smi` before GPU work. Runtime files
  on E:, never C:. Never spend kie or other paid credits.
- All suites pass (`pnpm -r test`; run `pnpm install --frozen-lockfile` in the worktree first),
  `tsc -b`, web `tsc --noEmit` and biome clean. No em dash characters. Small commits, plain
  messages, no co-author lines. Do not dispatch subagents.

## Report

`E:/mellodifai/reports/task-28-report.md`. Return only: status, branch name, commits, one-line test
summary, concerns.
