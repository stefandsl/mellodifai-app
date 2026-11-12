# Tasks 1 and 2: take scoring, suggested take, timing without kie alignment

Status: DONE_WITH_CONCERNS (concerns at the end). Branch `build/studio-ui`.

Commits: mellodifai `ff4c3fe`, suno-remake `8b4c137`.

## What changed

suno-remake (`tools/`)
- `score_takes.py`: `score_takes.py <lang> [--workspace <dir>] [--min-duration <s>]`. With `--workspace` it reads
  `<ws>/out/<lang>/take-N.mp3` and `<ws>/versions/<lang>/lyrics.txt` and writes `<ws>/out/<lang>/takes-score.json`.
  `--min-duration` defaults to 200 (today's behaviour); the worker passes 0. Two changes beyond the plan:
  - Only `take-<digits>.mp3` is scored. The old `take-*.mp3` glob also matched the worker's `take-N-preview.mp3`
    copies, which exist in the folder before scoring runs (seen in the first real run: 4 rows instead of 2).
  - Each row has a new `truncated` flag: almost none of the last sung lyric tokens were heard (intro, outro and
    spoken sections excluded, as for weak sections). The plan needed a `truncated` value and nothing produced one.
- `whisper_words.py`: `GROQ_API_KEY` from the environment first, then the old file lookup.
- `workspace_pipeline.sh` (task 2): `--aligned` is passed only when `aligned-take<N>.json` exists.

mellodifai
- `packages/shared/src/suggest-take.ts` (exported from `index.ts`, alias added in `apps/web/next.config.ts`):
  `TakeScoresSchema`, `parseTakeScores`, `suggestTake`. Rule as in the plan; needs scores on every take; with exactly
  one take that is whole and ends cleanly (`endDropDb > 12`, same limit as the script) the reason is "ending".
- `apps/worker/src/engine.ts`: new `EngineOptions.secretEnv: string[]`. `childEnvironment` strips every
  credential-named secret from child environments, so `options.env` could not carry `GROQ_API_KEY`. `secretEnv`
  hands a child only the named values from `secrets.values`; log output is still redacted.
- `apps/worker/src/db.ts`: `Db.patchTake(id, patch)` on `SupabaseDb` and `InMemoryDb`.
- `apps/worker/src/stages/score-takes.ts` (new): `scoreTakes(context, takes)`, called in `generate_song` after
  `refreshBalance`. Runs `python -I tools/score_takes.py <lang> --workspace <root> --min-duration 0` with
  `secretEnv: ["GROQ_API_KEY"]`, deletes the old `takes-score.json` first (via `clearOutputs`, so a previous
  generation's report is never read), maps rows to `{ fidelity, duration, endDropDb, weakSections, truncated }`, and
  patches each take. Any error is logged (redacted) and swallowed, including a down log sink. No `GROQ_API_KEY`
  in secrets means a log line and no run. Task 4 can call the same function for local engines.
- Fake mode (`src/fake/index.ts`) now stores full scores (take 1 better) so the suggestion shows in the dev studio.
- Web: `loadClips` selects `scores` and exposes `takes[].scores` (`null` while `{}`/invalid). `TakesDialog` shows a
  "Consigliata" pill with "parole riconosciute NN%" (or "finale completo" for the ending rule), preselects the
  suggestion until the owner clicks a take, and adds the suggestion to the radio's accessible name. New it/en strings.

## Tests added (all written before the code, seen failing first)

- shared `suggest-take.test.ts` (7): higher fidelity, 0.03 lead, 0.6 floor, ending fallback (truncated and abrupt),
  both/neither qualify, missing scores, `parseTakeScores`.
- worker `engine-secrets.test.ts` (1): named secret passed, others not, output redacted.
- worker `db.test.ts` (1): `patchTake` updates `takes` by id.
- worker `stages.test.ts` (8 in "take scoring ..." + 1 timing): call shape and env, scores stored per take, stale
  report removed first, key never in the log, scorer exit / garbage JSON / unusable rows / log sink down all leave
  the version at `takes_review` with no scores, no key means no run; timing with no aligned file calls the pipeline
  with `tools/workspace_pipeline.sh fr 1` only.
- web `studio.test.ts` (extended `loadClips` test) and `next-step.test.tsx` (5): badge and preselection, ending
  reason, no suggestion when scores do not decide, no badge before scoring, owner override sends the other take.

Checks: `npx biome check --write .` then `npx biome check .` clean; `npx tsc -b` clean;
`pnpm -r --if-present test`: shared 16, worker 165 (2 skipped, as before), web 115, all pass.

## Real run of score_takes.py (Groq, no kie)

Workspace `E:\mellodifai\projects\0ac445bb-6628-4ef0-8f3a-391f9b60fdc8\it` (layout checked: `out/it/take-1.mp3`,
`take-2.mp3`, `versions/it/lyrics.txt`). Before the change `--workspace` failed with a FileNotFoundError (it was
read as the language). After, with `GROQ_API_KEY` set in the environment and `--min-duration 0`:

```
take-1.mp3: 309s  -13.4 LUFS  ending fades out (21.0 dB)  lyric fidelity 95%  truncated: no  weak: none
take-2.mp3: 309s  -14.0 LUFS  ending ABRUPT? (12.0 dB)  lyric fidelity 94%  truncated: no  weak: none
RECOMMENDED: take-1.mp3
```

`takes-score.json` was written with two rows. `suggestTake` on these: lead 0.017 is under 0.03, so the ending rule
applies; take 2 (12.0 dB) is abrupt, take 1 is not, so take 1 is suggested with reason "ending". The old no-flag form
with `ENGINE_WORKSPACE` set still works (re-run on the cached words). I left `take-1.words.json`, `take-2.words.json`
and `takes-score.json` in that project's `out/it`; I deleted the two `*-preview.words.json` files my first run made.

`workspace_pipeline.sh` was checked with a stub `python` that prints its arguments: no `--aligned` without the file,
`--aligned <file>` with it. The full pipeline (demucs, beat grids) was not run.

## Concerns / not done

- `truncated` from `score_takes.py` is a lyrics-tail heuristic (tail share heard under 25%). Task 4 should also set it
  for YuE2 from its own signal (ends within 5 s of `max_duration`, budget warning), because bakeoff.md used that.
  Today `scoreTakes` only knows the script's value.
- Scoring adds two Groq uploads (about 2.5 MB each) before `generate_song` returns; the take window may open a few
  seconds later than before. It is allowed to fail, so a Groq outage costs only the suggestion.
- `next.config.ts` alias added by analogy with `song-settings.js`; I did not restart the dev server on port 3000
  (already running) to confirm it loads the new alias. `/login` returned 200 on the running server.
- `apps/web/app/(app)/projects/[id]/page.tsx` still shows raw scores JSON in `take-picker.tsx`; left alone.
- The `docs/egm/` folder is untracked and was not committed.
