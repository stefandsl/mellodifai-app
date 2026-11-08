# Implementation plan: local engines, take scoring (mellodifai v2.1)

Spec: `docs/egm/v2-local-engines/design_draft.md` (revision 2 plus section 14). Branch:
`build/studio-ui`. Done already: covers (design section 7) and migration A (commit 747b2ab).

## Global constraints

- pnpm monorepo; `npx biome check .`, `npx tsc -b` and `pnpm -r --if-present test` must pass
  after every task. DB tests: `supabase/tests` against the local Supabase (see existing tests).
- Never spend kie credits in tests or manual runs. Never fall back from a local engine to kie.
- Never print or log secrets; worker secrets come from `context.secrets.values`.
- Drive C: is nearly full: runtime files, temp and outputs go under `E:\mellodifai\`.
- Italian user-facing messages; code comments in English, matching the surrounding style.
- No em dash characters anywhere.
- Repos: this one, plus `C:\Users\Asus\Documents\suno-remake` (engine tools) where a task says so.

## Task 1: take scoring and the suggested take (design section 6)

- `suno-remake/tools/score_takes.py`: add `--workspace <dir> --lang <code> --min-duration <s>`
  (default keeps today's behaviour); with `--workspace` it reads `<ws>/out/<lang>/take-*.mp3` and
  `<ws>/versions/<lang>/lyrics.txt` and writes `<ws>/out/<lang>/takes-score.json`. The Groq key
  comes from the `GROQ_API_KEY` environment variable when set (the worker passes it), else the
  current file lookup.
- Worker: at the end of `generate_song` (after takes are created, kie path now, local path in
  task 4), run it through `context.engine.run` with `GROQ_API_KEY` from secrets, read the JSON,
  and write `takes.scores = { fidelity, duration, endDropDb, weakSections, truncated }` per take
  with a new `Db.patchTake(id, patch)`. Wrapped like `refreshBalance`: errors are logged, never
  fail the version.
- Suggested take rule (shared helper `suggestTake(scores)` in packages/shared): the higher
  fidelity if >= 0.6 and >= 0.03 above the other; else the take that is not truncated and does
  not end abruptly (endDropDb); else none.
- Web: `loadClips` exposes `scores` per take; the take window (`next-step.tsx` TakesDialog)
  marks the suggested take "Consigliata" with the reason "parole riconosciute NN%", and
  preselects it.
- Tests: suggestTake rules (shared), patchTake + non-fatal scoring in the stage (worker, fake
  engine), the badge and preselection (web).

## Task 2: timing works for takes with no kie alignment (design 5.1)

- `suno-remake/tools/workspace_pipeline.sh`: pass `--aligned` only when the file exists.
- Worker stage test: `timing` runs on a version whose take has no `aligned-take<N>.json` and
  calls the pipeline without that argument (fake engine).

## Task 3: ComfyUI supervisor and engine availability (design 5.2, 9)

- `apps/worker/src/comfy/supervisor.ts`, owned by `main.ts`: `ensureStarted()`, `stop()`,
  adoption of a server already on 127.0.0.1:8188 (PID file `E:\mellodifai\state\comfy.pid`),
  launch flags exactly as design 5.2, 180 s start timeout on `GET /system_stats`, log to
  `E:\mellodifai\comfy-data\comfy.log`, the process tree killed on stop (`taskkill /T /F`).
- Availability: on worker start and every 10 minutes, without starting ComfyUI, check that the
  model files exist with the expected sizes and write `workers.engines` =
  `{ "yue2": { installed, passedLangs: ["it"], minutesPerAudioMinute }, "ace-step": {...} }`
  (minutes per audio minute from bakeoff.md medians). Config (paths, file names, sizes) in one
  module `apps/worker/src/comfy/config.ts` read from the bake-off install.
- Tests: supervisor against a fake HTTP server and a fake spawn; availability with temp files.

## Task 4: local generation in generate_song (design 5.1, 5.3, 5.4, 5.5, section 14)

- `apps/worker/src/stages/local-engine.ts`: `generateLocal(context, engine)`.
  - Graph templates copied from `E:\mellodifai\research\bakeoff\graphs\TEMPLATE_yue2-int8-text2music.api.json`
    and `TEMPLATE_ace15-2b-sft-30steps.api.json` into `apps/worker/engines/comfy/`; fill maps as
    in the bake-off tools (`E:\mellodifai\research\bakeoff\tools\run_bakeoff.py`, `prep_packs.py`).
  - YuE2: `max_duration` 420, score temperature 0.9, `toYue2Lyrics(pack)` (design 5.4).
  - ACE-Step SFT 30 steps: target length = clamp(3.2 s x sung lines + 25, 120, 300).
  - ids `uuidv5(NS, "<version>:<generation>:<take>")`, seeds saved in the job payload before the
    first submit (< 2^48), takes one after the other, recovery `/api/jobs/{id}` then output file
    then submit, watchdog 120 s without events or 15 min per take, one restart, Italian errors.
  - Outputs: `out/<lang>/take-N.mp3` (320k from FLAC), preview upload, `createTake` with
    `engine`, `seed`, `abc` (YuE2), progress every 2 s at most.
  - `generate_song` branches on `song_settings.engine`; non-kie engines check the owner role
    (`Db.getOwnerRole`) and never touch kie state or credits; scoring (task 1) runs for both.
- `SongSettingsSchema.engine: z.enum(["kie","ace-step","yue2"]).default("kie")`.
- Tests: adapter against a fake ComfyUI (submit, progress, history, cancel, recovery after a
  crash finds the running prompt, watchdog), lyric mapping fixtures, role refusal, no kie calls.

## Task 5: engine choice in the studio (design 10)

- Create panel: engine selector next to the model selector, admin only, listing engines with
  `installed` and all chosen languages in `passedLangs`, worker seen in the last 60 s.
- Controls per engine: local engines hide the model menu, weirdness, style influence, variety,
  exclude; ACE-Step keeps duration.
- Engine-aware text: `next.approveCost`, `next.confirm`, `create.cost`, the recovery "Genera di
  nuovo (12 crediti)" button, `credits.songs`. Local: "Gratis · circa N minuti sul PC".
- Tests for visibility rules, hidden controls and texts.

## Task 6: end-to-end on the real PC

Create one short Italian song with each local engine from the studio as the admin, approve the
lyrics (no credits), pick a take, keep audio only for one and render the video for the other.
Record times and screenshots in `docs/egm/v2-local-engines/e2e.md`.
