# Task 26 brief: Video Studio preset polish (titles, contrast, round-cover crop)

Read this first. It is your requirements.

## Where this fits

Task 25 added 14 Video Studio presets (`packages/shared/src/visualizer/`, rendered by
`packages/visualizer` with Remotion, previewed on canvas in `apps/web/components/studio/`). Its
report `E:/mellodifai/reports/task-25-report.md` and the frames in `E:/mellodifai/reports/task-25-shots/`
list three visible defects. Fix them.

## Requirements

1. **Titles too small** in `dotline`, `contours`, `wirering` (and any other preset where the song
   title is under about 3.2% of the frame height at 1920x1080): title and artist must be readable
   on a phone (YouTube mobile) in both 16:9 and 9:16, inside the safe area (5% margins), with a
   consistent type scale shared by all presets (one helper, not per-preset magic numbers).
2. **Contours too faint**: the contour lines must hold at least 3:1 contrast against the background
   in every existing colour preset and background mode; keep the look delicate, raise opacity or
   line weight from the param schema rather than hard-coding.
3. **Round-cover presets crop 16:9 thumbnails**: presets that draw the cover inside a circle or
   square must use a square source. When the song only has a 16:9 image, derive a square by
   centre-cropping on the most salient region (simple: centre crop with a subject bias using the
   existing image, no paid model) and never stretch. Add a param for "cover fit" (cover, contain
   with blurred fill) defaulting to cover.
4. Keep preview and Remotion render identical (extend the frame-comparison test for the changed
   presets) and check the result by rendering a short clip of each changed preset at 1920x1080 and
   1080x1920 with the visualizer package's render path from your worktree, output under
   `E:/mellodifai/render-tmp/task26/`. Look at the frames and fix what looks off.

## Constraints

- Isolated worktree on your own branch. Touch only `packages/shared/src/visualizer/`,
  `packages/visualizer/`, the Video Studio components under `apps/web/components/studio/`, their
  i18n keys and tests. Another agent edits docs; another builds `packages/remake` elsewhere.
- Any new relative import inside `packages/shared` needs an entry in `turbopack.resolveAlias` in
  `apps/web/next.config.ts`.
- Do not restart the shared worker or Supabase. Check `nvidia-smi` before GPU-heavy work and wait if
  another job runs. Runtime files on E:, never C:.
- All suites pass (`pnpm -r test`), biome and tsc clean. No em dash characters. Small commits, plain
  messages, no co-author lines. Do not dispatch subagents.

## Report

`E:/mellodifai/reports/task-26-report.md` with before/after frames in
`E:/mellodifai/reports/task-26-shots/`. Return only: status, branch name, commits, one-line test
summary, concerns.
