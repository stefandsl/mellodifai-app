# autoresearch: the cut planner

Adapted from karpathy/autoresearch `program.md` (MIT). The agent improves one pure function by
itself, one idea per experiment, judged by a frozen evaluator.

## Setup (once per run)

1. Run tag: a date such as `nov14`. Branch `autoresearch/<tag>-cutplan` must not exist yet;
   create it from the music-video line (`feat/music-video-line`).
2. Read the in-scope files: `packages/shared/src/music-video/cut-plan.ts` (the editable surface),
   its tests in `packages/shared/src/music-video/music-video.test.ts`, this file and
   `ops/autoresearch/eval-cutplan.ts` (frozen).
3. Golden set: `E:/mellodifai/tmp/autoresearch/golden/<song>/` with `timing.json` (word timings,
   lines, sections, duration), `master.wav` and `beats.json` (beats and downbeats computed once
   with `packages/remake/python/beats.py`, beat_this final0 on the CPU). The evaluator prints a
   sha256 of the inputs; it must stay the same for the whole run.
4. `results.tsv` at the worktree root, untracked, header only:
   `commit	score	words_cut	status	description`.
5. TEMP, TMP and TMPDIR point to `E:/mellodifai/tmp/autoresearch`. Nothing is written on C:.

## What you CAN do

- Edit `packages/shared/src/music-video/cut-plan.ts`: the pure `planCuts` function, its helpers
  and its constants. Everything in that file is fair game.
- Update its unit tests only to match an intended behaviour change. Never delete or weaken a test.

## What you CANNOT do

- Edit `ops/autoresearch/eval-cutplan.ts`, this file's formula, or the golden set.
- Edit any other file, add a dependency, or call the network or a paid service.
- Change the exported types, the schema or `checkCutPlan` in a way that breaks a caller.

## The score

Per song, from the plan the planner returns (the evaluator never trusts the planner's labels):

- `cuts` are the segment starts after the first. Each cut is checked at its time in seconds (the
  audio wrappers) and at its frame time `startFrame / 30` (the picture).
- `downbeat` = mean over cuts of the credit of the frame time: 1 when within 0.05 s of a downbeat,
  falling linearly to 0 at 0.25 s.
- `phrase` = share of cuts at a phrase end: the last word before the cut ends its lyric line, or
  the silence across the cut is at least 1.2 s, or no word is before or after it.
- `spread` = standard deviation of the segment lengths in seconds.
- Gates: a cut inside a word (seconds or frame time), a segment outside 8-15 s (seconds; frame
  length with one frame of tolerance), a coverage error (not 0 to the end, not contiguous in
  seconds and frames, a word not in exactly one segment) or a planner error makes the song 0.

`song score = 50 * downbeat + 50 * phrase - 1 * spread` (0 when gated).
`score` = mean of the song scores. Higher is better. Maximum about 100.

The evaluator also prints `raw_score_ungated` (the same formula without the gates). It is
information only, never the metric.

Simplicity is not computed: you judge it. Equal score and simpler code is a keep.

## The loop (budget: at most 25 experiments or 3 hours, whichever first)

1. Look at the git state.
2. Change `cut-plan.ts` with ONE idea.
3. `git commit` (plain message, no attribution).
4. `pnpm exec tsx ops/autoresearch/eval-cutplan.ts > run.log 2>&1` (under 2 minutes; kill and
   discard if longer).
5. `grep "^score:\|^words_cut:\|^golden:" run.log`. Empty means a crash: read `tail -n 50 run.log`.
6. Run the module's tests: `pnpm --filter @mellodifai/shared exec vitest run src/music-video`.
7. Append a row to `results.tsv` (status `keep`, `discard` or `crash`).
8. Keep (advance the branch) only if the score improves and the tests pass, or the score is equal
   and the code is simpler. Otherwise `git reset --hard` to the last kept commit.

The first run is always the baseline, the planner as it is.

## End of the run

Lint, typecheck, the tests of `packages/shared` and `apps/worker`, then re-plan the rung-1 song
("Va bene, passa", `it`) with the best version and report before and after.
