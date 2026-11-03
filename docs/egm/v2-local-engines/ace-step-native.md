# ACE-Step 1.5 as a native local engine (no ComfyUI)

Status: implemented on branch `feat/ace-step-native` (unit-tested against a fake ACE-Step
server; no real install run yet). Date: 2026-11-01. Replaces sections 5.2 and 5.3 of
`design_draft.md` for ACE-Step only; everything else there (takes rows, seeds, recovery,
watchdog, GPU rule, Italian errors, kie path untouched) is reused.

## 1. Research findings

Sources: github.com/ace-step/ACE-Step-1.5 (README, `docs/en/API.md`, Musician's Guide
discussion #235), huggingface.co/ACE-Step (model API), local notes in
`E:/mellodifai/research/ace-step-ui-report.md`.

| Topic                | Finding                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| -------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Official repo        | `github.com/ace-step/ACE-Step-1.5`, org `ace-step` (also hosts awesome-ace-step); the README links the official HuggingFace org `ACE-Step` and the project page. Not a fork. Latest tag `v0.1.8` (`git ls-remote`, 2026-11-01).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| License              | MIT for the code (README) and for the weights (HuggingFace `cardData.license: mit` on `ACE-Step/Ace-Step1.5`). Commercial use allowed, including a paid service; only the MIT notice must be kept. Unlike YuE2, no reason to restrict ACE-Step to the admin.                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| Install              | `uv sync` in a clone (Python 3.11-3.12). A Windows portable 7z also exists; we use the clone because it pins to a tag.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| Built-in API         | `uv run acestep-api` or `python -m acestep.api_server`; host/port via `ACESTEP_API_HOST`/`ACESTEP_API_PORT` (default 127.0.0.1:8001), optional bearer key `ACESTEP_API_KEY`. Endpoints: `GET /health`, `POST /release_task` (prompt, lyrics, audio_duration, seed, use_random_seed, batch_size, audio_format, inference_steps, vocal_language, thinking, model) returning `task_id`, `POST /query_result` (status 0 running, 1 done, 2 failed; `result` is a JSON string with `file` = `/v1/audio?path=...`, `seed_value`), `GET /v1/audio`, `/v1/models`, `/v1/stats`. Model paths via `ACESTEP_CHECKPOINTS_DIR`, `ACESTEP_CONFIG_PATH`, `ACESTEP_LM_MODEL_PATH`, `ACESTEP_LM_BACKEND`, `ACESTEP_OFFLOAD_TO_CPU`. |
| 8 GB VRAM (RTX 3070) | README GPU table: 6-8 GB = DiT `2B turbo` + LM `acestep-5Hz-lm-0.6B` on the `pt` backend. XL (4B) needs 12 GB+ with offload: out of reach. We also enable CPU offload when idle.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| Downloads            | `ACE-Step/Ace-Step1.5` = 10.09 GB (turbo DiT 4.79, LM 1.7B 3.76, Qwen3-Embedding-0.6B 1.21, VAE 0.34). We skip the 1.7B LM and add `ACE-Step/acestep-5Hz-lm-0.6B` (1.37 GB): about 7.7 GB of models. Python env plus torch about 6-8 GB more. Budget 25 GB free on E: (488 GB free today).                                                                                                                                                                                                                                                                                                                                                                                                                         |
| Speed                | Official: under 10 s per full song on an RTX 3090, under 2 s on an A100 (turbo, 8 steps). The 3070 has about 40% of a 3090's compute and needs offload, so expect roughly 30-90 s per take plus about 1-2 minutes of model load per server start. Not measured here yet.                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| Italian              | 50+ vocal languages, Italian listed (`vocal_language: "it"`). No published per-language quality numbers; the ace-step-ui report rates 2B-turbo vocals below Suno. Italian diction is unproven: the bake-off in `design_draft.md` section 8 still applies before the owner relies on it.                                                                                                                                                                                                                                                                                                                                                                                                                            |

## 2. Design addendum: `AceStepSupervisor`

Code: `apps/worker/src/ace-step/` (`supervisor.ts`, `client.ts`, `host-script.ts`,
`runtime.ts`), stage `apps/worker/src/stages/ace-step.ts`, wired in `main.ts` and `loop.ts`.

### 2.1 Provisioning (first use, idempotent, resumable)

Everything lives in `E:\mellodifai\ace-step` (`src`, `venv`, `checkpoints`, `uv-cache`,
`python`, `hf-home`, `tmp`, `logs`, `state`). Nothing heavy goes to C:.

1. `download_code`: `git clone --depth 1 --branch v0.1.8 https://github.com/ace-step/ACE-Step-1.5.git src`.
2. `install`: `uv sync --python 3.12 --no-dev` with `UV_PROJECT_ENVIRONMENT=venv`,
   `UV_CACHE_DIR`, `UV_PYTHON_INSTALL_DIR` on E: (uv fetches its own Python 3.12 if needed;
   wheels stay in the cache so a retry resumes).
3. `download_models`: `huggingface_hub.snapshot_download` with the venv's Python, for the two
   repos above (resumes partial files). Progress = bytes on disk / expected bytes, published
   at most every 2 s.

Each step writes `state/<step>.done` when it succeeds; a retry skips finished steps. A failed
clone restarts only the clone. Concurrent first uses share one install. Under 25 GB free
the install does not start. Every failure is mapped to a fixed Italian sentence
(`ACE_STEP_TEXT` in `packages/shared/src/local-engine.ts`); the technical detail goes to the
worker log only.

Trigger: the first song created with ACE-Step. Its `generate_song` job installs the engine,
then makes the song. The user sees "Sto preparando il motore musicale (primo avvio...)"
with a percentage in the create panel.

### 2.2 Server lifetime

- `acquire()` installs if needed, then starts the server (or reuses a healthy one); `release()`
  stops it when no song uses it (`idleStopMs = 0`), so Remotion and Demucs get the GPU back.
- Start: kill any server recorded in `state/server.pid` (left by a crashed worker; its key is
  unknown), write the launcher, spawn the venv Python with `ACESTEP_API_HOST=127.0.0.1`, a
  random per-process `ACESTEP_API_KEY`, port 18001, DiT turbo, LM 0.6B, `pt`, CPU offload; poll
  `GET /health` every 2 s for up to 10 minutes (first start loads the models).
- Tie to the worker: Node cannot create a Job Object without a native module, so the launcher
  (`host-script.ts`, run with the venv Python) does it from inside: it joins a Job Object with
  `KILL_ON_JOB_CLOSE` (its own children die with it) and a thread waits on the worker's process
  handle and exits the moment the worker is gone. `main.ts` also stops it on shutdown and the
  PID file covers a hard reboot.
- Status published to `workers.engines["ace-step"]`: `not_installed`, `installing` (step, pct),
  `ready`, `running` (starting / generating), `error` (Italian message). `announce()` publishes
  the state from the markers at worker start.

### 2.3 Engine adapter (`generate_song` branch)

- `generate_song` reads `projects.song_settings.engine`; `ace-step` goes to `generateAceStep`;
  anything else stays on the untouched kie path (no credits, no kie task columns touched).
- Seeds: two seeds drawn once per generation into `out/<lang>/ace-g<N>-seeds.json`.
- Takes run one after another, `batch_size: 1`, `use_random_seed: false`, `audio_format: wav`,
  `vocal_language` = the version language, prompt = style plus "female/male vocals",
  `audio_duration` = pack duration or 210 s (10-360).
- Recovery on requeue: a finished take (`ace-g<N>-take-<T>.mp3`) is not redone; a submitted
  task id is re-polled; a task the server no longer knows (restart) is resubmitted.
- Watchdog: a failed, lost or 15-minute take restarts the server and resubmits once; a second
  failure fails the job with "Il motore musicale non è riuscito a creare la canzone. Riprova:
  non costa nulla." Never falls back to kie.
- GPU rule: if the server is not already running and `nvidia-smi` reports under 6 GB free, the
  job returns `retryLater` (5 minutes) with the Italian "scheda video occupata" message.
- Output: ffmpeg WAV to MP3 320 kbps, copied to `out/<lang>/take-<T>.mp3` (what timing reads),
  128 kbps preview uploaded as today, `takes` row with `engine: "ace-step"`, `seed`,
  `kie_task_id: null`.

### 2.4 Web

- Create panel: "Motore musicale" pill, "Suno" or "Gratis sul PC". With the free engine
  the v6 model menu is hidden, the cost line reads "Gratis: la canzone si crea sul tuo PC" and
  a status line shows the setup state in plain Italian.
- No dead button: when the PC is offline the free option explains why in a tooltip; when it is
  not installed the line says the first song sets it up by itself and how long it takes.
- Lyrics approval: "Approva · gratis" and "Il tuo PC genera due versioni della canzone: gratis".

### 2.5 Data

Migration `20261101000017_ace_step.sql`: `workers.engines jsonb` (+ column grant),
`takes.engine`, `takes.seed`. Written with `if not exists` so it coexists with migration A
(`20261101000016_engines_and_covers.sql`) being prepared in parallel.

## 3. Open points

- Real install and a real Italian bake-off on the 3070 (section 8 of `design_draft.md`).
- Migration A in the parallel work makes local engines admin-only in `create_song`. That is
  needed for YuE2's license, not for ACE-Step (MIT). The owner decides whether ACE-Step is open
  to every user.
- `workspace_pipeline.sh` (suno-remake) must accept takes with no `aligned-take<N>.json` (design
  draft 5.1); ACE-Step produces none.
- The advanced panel still shows weirdness, style influence and variety with the free engine;
  ACE-Step ignores them.
