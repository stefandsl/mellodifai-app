# Tasks 3 and 4: ComfyUI supervisor, engine availability, local generation

Date: 2026-11-01. Branch `build/studio-ui`, commit `28e06a1`. Status: done, smoke test passed on the PC.

## Files

New:
- `apps/worker/src/comfy/config.ts`: the bake-off install (paths on E:, port 8188, version 0.43.0,
  180 s start timeout), the exact launch command and cache environment of `start_comfy.sh`, and per
  engine the model files with their exact sizes, the nodes, `passedLangs: ["it"]`,
  `minutesPerAudioMinute`, the graph file and the save node.
- `apps/worker/src/comfy/supervisor.ts`: `ComfySupervisor` (`ensureStarted`, `stop`, `restart`,
  `adopt`, `isUp`), plus the real dependencies: spawn with stdout/stderr appended to
  `E:\mellodifai\comfy-data\comfy.log`, `taskkill /PID <pid> /T /F`, a `tasklist` check that the PID
  in `E:\mellodifai\state\comfy.pid` is still `python.exe`, and `nvidia-smi` free VRAM.
- `apps/worker/src/comfy/availability.ts`: `checkEngines` (file checks only) and `publishEngines`
  (writes `workers.engines`).
- `apps/worker/src/comfy/client.ts`: the HTTP and WebSocket routes of yue2-integration.md 2.4
  (`/object_info`, `/prompt`, `/api/jobs/{id}`, `/api/jobs/{id}/cancel`, `/history`, `/view`,
  `/internal/logs/raw`, `/ws`).
- `apps/worker/src/comfy/graphs.ts`: template loading, the fill maps (YuE2 nodes 24, 25, 8, 10; ACE
  nodes 94, 98, 3, 107), `bpmAndKey` (port of `prep_packs.py bpm_key`) and `toYue2Lyrics` (port of
  `prep_packs.py to_yue2_lyrics`).
- `apps/worker/src/comfy/ids.ts`: RFC 9562 UUID v5 for prompt ids. `apps/worker/src/comfy/runtime.ts`:
  the `LocalRuntime` type and the limits (120 s, 15 min, 2 s polling, 2 s progress, 6 GB VRAM).
- `apps/worker/src/stages/local-engine.ts`: `generateLocal`, `songEngine`, `aceDuration`.
- `apps/worker/engines/comfy/yue2-text2music.api.json`, `ace15-sft-30steps.api.json`: the bake-off
  `TEMPLATE_*` graphs (reformatted by biome, values unchanged).
- Tests: `apps/worker/test/comfy.test.ts`, `local-engine.test.ts`, `fake-comfy.ts` (a fake ComfyUI
  HTTP server with a scripted WebSocket), fixtures `test/fixtures/yue2/<pack>/` (the three bake-off
  packs and their YuE2 lyrics), `packages/shared/src/song-settings.test.ts`.

Changed:
- `packages/shared`: `SONG_ENGINES`, `SongSettingsSchema.engine` (default `kie`), `sungLineCount`
  exported, `aceStepSeconds(lyrics)` = clamp(round(3.2 s x sung lines + 25), 120, 300). It is in
  shared so the studio can estimate "circa N minuti" in task 5.
- `apps/worker/src/db.ts`: `Db.getOwnerRole`, `Db.patchJobPayload(jobId, workerId, payload)`
  (filtered by job, worker and `running`, like the other job writes), `WorkerUpdate.engines` typed as
  `Record<string, EngineAvailability>`.
- `apps/worker/src/loop.ts`: `StageContext.comfy?: LocalRuntime`, passed from `WorkerLoop` options;
  `progress(pct, message?)` so a progress event can carry the Italian stage label.
- `apps/worker/src/main.ts`: creates the supervisor and the runtime, `startLocalEngines` (adopt at
  start, publish availability now and every 10 minutes, stop the server on shutdown);
  `startPeriodicRefresh` (the balance timer, now shared; `startBalanceRefresh` is an alias).
- `apps/worker/src/stages/generate-song.ts`: two lines at the top branch to `generateLocal` before
  any kie state is read. The kie path is otherwise unchanged.
- `apps/worker/src/stages/score-takes.ts`: optional `{ ceiling, truncated }`: YuE2 takes ending within
  5 s of 420 s, or whose ComfyUI log reported the token budget, are stored with `truncated: true`.
- `apps/web/lib/studio/studio.test.ts`: the parsed settings now include `engine: "kie"`.

## How generate_song runs a local engine

1. `songEngine(project.song_settings)`: missing means `kie`; an unknown value fails the job
   ("Motore sconosciuto: ..."), never falls back to kie.
2. Owner role from `profiles`; not admin: the job fails with "I motori locali sono riservati
   all'amministratore: questo brano non può essere generato sul PC."
3. Pack written to the workspace as the kie path writes it (original lyrics, so timing keeps
   "Final Chorus"). Seeds drawn once (< 2^48) and saved in `jobs.payload.seeds` before any submit.
4. If no server answers and `nvidia-smi` reports less than 6 GB free: `retryLater` 5 minutes.
5. `ensureStarted`, then a node check through `/object_info`.
6. Per take, one after the other: a done marker `out/<lang>/local-<generation>-take-N.json` plus
   `take-N.mp3` skips the take. Otherwise ids `uuidv5(NS, "<version>:<generation>:<take>")` and
   `...:retry`; if the retry id is known to the server, follow that one. Recovery: `/api/jobs/{id}`
   (pending or running: watch it; completed: fetch outputs; failed: counts as a failure), else the
   finished FLAC under the known prefix in `comfy-data/output`, else submit. Watching: WebSocket
   events with the fixed client id (ComfyUI sends progress only to the client that queued the prompt,
   so a restarted worker still hears it) and `/api/jobs` every 2 s for the state. No event for 120 s
   or more than 15 min: cancel, restart ComfyUI, resubmit once with the retry id. A second failure
   fails the job: "Il motore locale non è riuscito a creare il brano N per due volte (reason).
   Riprova più tardi." A 400 from `/prompt` fails at once, without retry.
7. FLAC to `take-N.mp3` (320 kbps, ComfyUI's graph tags stripped), stale `aligned-take<N>.json`
   removed, preview at 128k uploaded, `takes` row upserted with `engine`, `seed`, `abc` (YuE2 node 14),
   `cover_path: null`.
8. `finally`: the server is stopped (process tree killed, port closed, PID file removed). Then
   `score_takes.py` runs as for kie songs.

## Tests

- `npx biome check .`: clean. `npx tsc -b`: clean.
- `pnpm -r --if-present test`: shared 20 passed; worker 216 passed, 2 skipped (the existing DB
  integration tests); web 115 passed. Baseline before the work: 16, 165 + 2 skipped, 115.
- New tests: 29 in `comfy.test.ts` (availability with temp files, supervisor against the fake server
  and a fake spawn: start on demand, single start under concurrency, stop of the tree, adoption by PID
  file, foreign server only freed, stale PID, PID reused by another program, 180 s timeout path,
  early exit, version mismatch, restart; lyric mapping on the three real packs; fill maps; tempo and
  key; startup wiring; UUID v5 vector), 22 in `local-engine.test.ts` (full ACE and YuE2 runs, seeds
  persisted before submit, sequential takes, user duration, truncation by ceiling and by budget
  warning, YuE2-only budget, progress throttle and labels, admin refusal, unknown engine, no
  runtime, busy GPU, missing nodes, rejected graph, stall, take timeout, double failure, the four
  recovery paths, done-take skip, stale alignment), 2 in shared, 1 more case in `db.test.ts`.
- Mutation check: 13 mutations of the new code (server not stopped, ceiling 330, role check off,
  stall watchdog off, throttle off, recovery lookup off, ceiling margin, seeds not persisted, retry id
  not followed, stale alignment kept, stop not waiting for the port, PID file trusted without the
  process check, budget read for ACE): all fail at least one test. The seed mutation survived at
  first because the test shared the job object with the fake DB; the test now keeps a copy.

## Smoke test on the PC

Script `E:\mellodifai\research\bakeoff\tools\smoke_local.mts` (not committed), run from
`apps/worker` with tsx: the real `createComfySupervisor`, `ComfyClient`, ffmpeg and
`stages.generate_song` on a project with `engine: "ace-step"`, an Italian 6-line pack with a 30 s
duration, an `InMemoryDb` and a storage stub. No Supabase, no kie (no `kie.mjs` call). Logs:
`E:\mellodifai\tmp\smoke-local.log`, `smoke-local-2.log`.

| Step                                             | Run 1  | Run 2 (after the tag fix) |
| ------------------------------------------------ | ------ | ------------------------- |
| ComfyUI start to ready, node check               | 20.2 s | 10.2 s                    |
| Take 1 (30 s audio, includes loading the models) | 15.0 s | 12.9 s                    |
| Take 2 (30 s audio)                              | 10.9 s | 10.9 s                    |
| Total `generate_song` including stop             | 47.2 s | 35.0 s                    |

- `take-1.mp3` and `take-2.mp3` written (1.2 MB each, 30.02 s, 320 kbps, mean -14.0 dB, max -2.1 dB),
  two `takes` rows with `engine: "ace-step"` and their seeds, result `takes_review`.
- After the stage: `/system_stats` does not answer, the PID file is gone, no `python.exe` runs,
  port 8188 has only TIME_WAIT sockets, free VRAM back to the value before the run (6,794 / 6,761 MiB).
- Progress events seen: "Brano 1 di 2 con ACE-Step: composizione", "... rendering", about every 2 s.
- Not covered by the smoke test: scoring (the worker env files have no `GROQ_API_KEY`, so the stage
  logged "Takes not scored"; scoring is covered by the unit tests and task 1), YuE2 (covered by the
  bake-off and the unit tests), the watchdog and recovery on the real server.
- Found and fixed by the smoke test: ComfyUI stores the whole graph (lyrics, seed) as a `prompt` tag
  in the FLAC and ffmpeg copied it into the mp3 and preview; the conversion now uses `-map_metadata -1`.

The production worker was not touched. It runs the code it started with; it picks up local engines
only after the owner restarts it.

## Deviations from the design and why

1. **No Windows Job Object.** Node has no API for it (it needs a native addon or a helper process).
   It would also defeat the recovery the design asks for: a prompt that keeps running in an orphan
   server is what a requeued job reattaches to. Instead: the stage stops the server in `finally`, a
   graceful worker shutdown stops it, and the next worker start adopts it by PID file.
2. **Progress and state come from two channels.** WebSocket events drive progress and the 120 s
   watchdog; `/api/jobs/{id}` polled every 2 s decides completion, so a missed WebSocket message
   cannot hang the stage. A closed socket is reopened on the next poll.
3. **ACE-Step length.** The section 14 formula is used when the pack has no duration; a duration the
   user chose is honoured, because design 10 keeps the duration control for ACE-Step. Studio packs
   carry `duration: null` for Auto, so the formula is the default.
4. **`minutesPerAudioMinute` covers the whole generation (two takes):** bake-off median per take
   times two, rounded up: YuE2 1.6 (0.755 x 2), ACE-Step 0.8 (0.392 x 2). The studio can show
   "circa N minuti" as `minutesPerAudioMinute x expected minutes` without knowing about takes.
5. **`PYTHONIOENCODING=utf-8`** is added to the bake-off launch environment: the log is a file, and a
   non-Latin line could otherwise crash Python's logging under cp1252.
6. **A server nobody recorded** (answers on 8188, no valid PID file) is used but never killed; at the
   end of the stage it gets `POST /free` only. Killing an unknown process is worse than sharing VRAM.
7. **Node check at the start of each local stage**, not at worker start, so the worker never starts
   ComfyUI just to check it (design 12 "node check on start").
8. **Free-VRAM check only before starting the server.** Our own server holds VRAM, so checking while
   it runs (an adopted orphan) would always wait.
9. **A take recovered from the output file has no ABC**: ComfyUI's history is gone after a restart.
   The seed is still stored.
10. **Budget warnings** are read from `/internal/logs/raw` for prompts this worker submitted, YuE2 only;
    after a reattach only the 5 s ceiling rule applies.

## Open risks

- After a hard worker crash, an adopted ComfyUI keeps its VRAM until the next local stage ends or the
  worker shuts down gracefully. If the next jobs are timing or renders, Demucs and Remotion share the
  GPU with it. A later fix: `POST /free` on adoption when no local job is queued.
- The 6 GB free-VRAM gate: the bake-off saw desktop use up to 3.3 GB at times, which would make the
  stage wait; it then retries every 5 minutes. Lower it if this happens in practice.
- The stall rule assumes ComfyUI emits an event at least every 120 s. True in the bake-off and the smoke
  test (every node has a progress bar), but a cold first model load from a slow disk was not measured
  separately.
- `/internal/logs/raw` is a ring buffer; with very chatty logs a budget warning could fall out before
  it is read (the 5 s ceiling rule still applies).
- The graph templates are read from `apps/worker/engines/comfy` relative to `src`; a compiled `dist`
  build would need them copied. The worker runs with tsx from `src` today.
- The PID guard checks only that the PID is a `python.exe`; another Python program that inherited the
  PID while a different ComfyUI answers on 8188 would be killed on stop. Unlikely on this PC.
- Task 5 (engine choice in the studio) is not done: today a local song can only be created through
  `create_song` with `p_settings.engine` set by an admin.
