# Task 25 brief: 14 new Video Studio presets from the owner's VideoHive catalogue

Read this first. It is your requirements.

## Where this fits

The Video Studio (T13) has live-preview presets (Cerchio, Spettro, Specchio, Onda, Particelle,
Minimale, MellodifAI Classico) drawn by shared pure functions in
`packages/shared/src/visualizer/` (canvas preview) and rendered identically by Remotion in
`packages/visualizer` (frame-comparison test included). The owner made his first channel videos by
hand with three VideoHive After Effects packs and wants those looks in the app.

## Requirements

1. The catalogue `E:\mellodifai\research\videohive\videohive-catalogue.md` (70 looks, 14 proposed
   presets: Punti `dotline`, Burst `burst`, Corona `crown`, Anello a Filo `wirering`, Lente `lens`,
   Pillole `pills`, Bordi Pixel `edgebars`, Cornice Cover `coverframe`, Scheda Player `playercard`,
   Contorni `contours`, Synthwave `synthwave`, Editoriale `editorial`, Badge Rotanti `badges`
   (overlay), Particelle a Forme `shaped`). Frames and contact sheets are in
   `E:\mellodifai\research\videohive\`: look at them for each preset.
2. Implement each preset **from scratch in our own code**: never copy, trace, embed or ship
   anything from the `.aep` projects, their assets (PNG, JPG, PSD), or their fonts (Tall Fall and
   Monument Extended are restricted). Recreate the look, motion and audio reaction with our own
   geometry, our own colours from the param schema, and fonts already licensed in the app.
3. Each preset: shared pure drawing math used by both the canvas preview and the Remotion render,
   added to the param schema and the preset picker (Italian and English names and one-line
   descriptions), works in 16:9 and true 9:16, honours the existing colour presets, background
   modes, particles, centre image, text layers and effects, and passes the preview/render frame
   comparison (extend that test to every new preset).
4. Quality bar: motion and graphic design best practice (clear focal point, beat-aligned motion,
   readable text in safe areas, smooth easing, no jitter), checked by rendering a short clip of each
   preset on a test-account song and looking at the frames; fix what looks off.

## Constraints

- You are in an isolated worktree; another agent is editing `apps/web` create panel and editor
  files on the main checkout, and Task 24 builds `packages/remake` in another worktree. Touch only
  the visualizer code (`packages/shared/src/visualizer/`, `packages/visualizer/`, the Video Studio
  components under `apps/web/components/studio/` that list presets, i18n keys for the presets) and
  their tests.
- Any new relative import inside `packages/shared` needs an entry in `turbopack.resolveAlias` in
  `apps/web/next.config.ts`.
- Do not restart the shared worker or Supabase. For real renders use the visualizer package's
  render path directly from your worktree, output on E: (`E:/mellodifai/render-tmp/task25/`). Check
  `nvidia-smi` before GPU-heavy work and wait if another job runs.
- All test suites pass; biome and tsc clean. No em dash characters. Commit on your branch in small
  steps, plain messages, no co-author lines. Do not dispatch subagents.

## Report

`E:/mellodifai/reports/task-25-report.md` with a contact sheet per preset
(`E:/mellodifai/reports/task-25-shots/`). Return only: status, branch name, commits, one-line test
summary, concerns.
