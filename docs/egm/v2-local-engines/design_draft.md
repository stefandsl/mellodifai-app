# Design: local song engines, take scoring and covers (mellodifai v2.1)

Status: revision 2 after EGM review (zoom-out, design, implementation readiness; reports in
`goldfish_review_report.md`). Owner: the admin. Date: 2026-11-01.
Evidence: `E:/mellodifai/research/` (BRIEF.md, yue2-integration.md, yue2-studio-report.md,
ace-step-ui-report.md, last30days-music.md, videos/notes-*.md).

## 1. Problem

Every song costs 12 kie credits per generation of two takes and goes through kie and Suno. The
owner wants a free option that runs on the PC (RTX 3070, 8 GB), a cover on every song, a suggested
take, and no button that does nothing. Two open models are candidates: ACE-Step 1.5 (MIT) and
YuE2 (weights CC BY-NC 4.0 with an individual-creator waiver). Nobody has measured either in
Italian.

"Free" here means no kie credits. Local songs still use the internet for Supabase, OpenRouter
(lyrics and jury) and Groq Whisper (timing and take scoring), as kie songs do today.

## 2. Goals

- G1. The admin can generate a song with a local engine at zero credits, through the existing
  flow: lyrics review, two takes, pick take, audio only or video.
- G2. The cost is shown where credits are actually spent (the lyric approval button) and the
  create panel shows only controls the chosen engine uses.
- G3. Each take gets a lyric-fidelity score and the take window suggests one, with the reason.
- G4. Every song in the feed has a cover, including imported and audio-only songs.
- G5. A local engine becomes selectable only after it passes the bake-off (section 8) in a
  given language.

## 3. Non-goals

Local engines for non-admin users (YuE2's license forbids a paid service; one rule for all local
engines is simpler). Stems, extend, repaint, LoRA, duets. Image generation on the PC. A local
language model for lyrics. "Regenerate with the same seed" (no owner request; seeds and the
YuE2 ABC score are stored so it can be added later).

## 4. Order of work (the gate comes before the build)

| Step | What                                                                                                                | Depends on               |
| ---- | ------------------------------------------------------------------------------------------------------------------- | ------------------------ |
| 0    | Install ComfyUI and models on E:, run the bake-off by hand with the official templates, score with `score_takes.py` | owner approves downloads |
| 1    | Covers for every song (section 7)                                                                                   | nothing                  |
| 2    | Take scoring for kie songs (section 6)                                                                              | migration A              |
| 3    | Local engine adapter, only for engines that passed step 0                                                           | step 0, migration A      |
| 4    | Engine choice in the UI, engine-aware cost text and controls                                                        | step 3                   |

Steps 1 and 2 help current kie songs at once and do not wait for step 0.

## 5. Local engine (step 3)

### 5.1 Shape: a branch, not a rewrite of kie

kie's paid path (`generate-song.ts`, `kie_submit_state`, `kie_task_id`, `resolve_kie_submission`)
stays unchanged. `generate_song` reads `song_settings.engine` (default `kie`). For `yue2` or
`ace-step` it calls `generateLocal(context, engine)` in `apps/worker/src/stages/local-engine.ts`.
An interface is extracted only when a second local engine ships.

`generateLocal` must leave the workspace exactly as the kie path does, because the timing stage
(`workspace_pipeline.sh`) reads it:

- `out/<lang>/take-1.mp3`, `take-2.mp3` (ffmpeg from ComfyUI's FLAC, 320 kbps).
- `out/<lang>/aligned-take<N>.json`: `workspace_pipeline.sh` is changed to pass `--aligned`
  only when the file exists; `produce_song.py` then uses its existing `whisper_words.py`
  fallback. A stage test runs `timing` on a take with no aligned file.
- One `takes` row per take with the usual `audio_preview_path`, plus `seed`, `engine` and, for
  YuE2, `abc` (the score text from node 14).

### 5.2 Runtime: ComfyUI as a supervised process

- ComfyUI v0.43.0 Windows portable (NVIDIA build matching driver 610.88) in
  `E:\mellodifai\ComfyUI_windows_portable`, data in `E:\mellodifai\comfy-data\{output,input,temp,user}`.
- Launch flags: `-s ComfyUI\main.py --windows-standalone-build --disable-auto-launch --listen
  127.0.0.1 --port 8188 --reserve-vram 1.0 --output-directory ... --input-directory ...
  --temp-directory ... --user-directory ...`.
- A `ComfySupervisor` owned by `main.ts` (not by a job, since job processes are killed when the
  job ends) starts the server at the start of a local `generate_song`, waits up to 180 s for
  `GET /system_stats`, and stops it when the stage ends. On worker start it adopts a server it
  finds on 8188 (PID file `E:\mellodifai\state\comfy.pid`) instead of starting a second one, and
  it runs ComfyUI inside a Windows Job Object so it dies with the worker.
- GPU: stages already run one at a time and the server is stopped at the end of the stage, so
  timing (Demucs) and Remotion never share the GPU with it. If `nvidia-smi` reports less than
  6 GB free before submitting (a game), the stage returns `retryLater`.

### 5.3 Requests, recovery and hangs

- Graph: the flattened API-format graph from yue2-integration.md section 7.3, committed as
  `apps/worker/engines/comfy/yue2-text2music.api.json`. Fill map: `24.inputs.{style,lyrics,seed,
  temperature=0.9}`, `25.inputs.{style,lyrics,seed,max_duration}`, `8.inputs.seed`,
  `10.inputs.filename_prefix`. Outputs: `10.audio[0]` (FLAC), `14.text[0]` (ABC),
  `23.text[0]` (seconds). ACE-Step gets the same treatment from its template once step 0 names
  the checkpoint.
- Ids: `promptId = uuidv5(NS, "<versionId>:<generation>:<take>")`; seeds are drawn once and saved
  in `jobs.payload.seeds` before the first submit, below 2^48.
- Takes run one after the other (take 2 is submitted after take 1 finishes: ComfyUI #16416, the
  second queued YuE2 job hangs on Windows).
- Recovery on requeue, per take: `GET /api/jobs/{promptId}` (pending or running: reattach to the
  WebSocket; complete: fetch outputs), else look for the output file under the known
  `filename_prefix`, else submit. Take rows are upserted on (version_id, generation, take_number).
- Watchdog: no WebSocket event for 120 s, or more than 15 min for one take: cancel, restart the
  server, resubmit once with a new id; a second failure fails the job with an Italian message.
  Never falls back to kie.
- Progress: written at most every 2 s, mapped to four Italian stage labels (score, composing,
  rendering, decoding).

### 5.4 Length and lyrics mapping

- YuE2: `max_duration` is a ceiling: 330 s (360 s for packs above 600 words). The model stops on
  its own; a take that ends in the last 5 s of the ceiling, or whose log reports the token budget,
  is marked `truncated`.
- ACE-Step: needs an explicit target length: from the pack's `duration` when set, else 210 s.
- `toYue2Lyrics(pack)`: one tag per line, `[Final Chorus]` and `[Chorus 2]` become `[Chorus]`,
  stage directions after a colon are removed (`[Intro: Spoken Word, ...]` becomes `[Intro]`),
  lines in parentheses are dropped, `(x2)` is expanded. Fixture tests with the real packs. The
  workspace `lyrics.txt` keeps the original pack (timing needs "Final Chorus").

### 5.5 License and access

All local engines are admin-only. Enforced in SQL: `create_song` accepts `engine` values `kie`,
`ace-step`, `yue2`; non-`kie` values require `profiles.role = 'admin'`. `generate_song` repeats
the check through a new `Db.getOwnerRole(ownerId)` and fails the job with a fixed message if it
does not hold.

## 6. Take scoring (step 2)

- No new stage. At the end of `generate_song` (kie and local alike) the worker runs
  `score_takes.py` against the version workspace, wrapped like `refreshBalance`: any error is
  logged and scores stay `{}`; it never fails the version.
- `score_takes.py` is changed to take `--workspace <dir> --lang <code> --min-duration <s>` so it
  reads the worker workspace and does not reject short takes. It uses Groq Whisper, already
  used by the timing stage (key from worker secrets, not from another project's file).
- Stored per take in `takes.scores`: `{ fidelity, duration, endDropDb, weakSections, truncated }`.
- Suggested take: the higher `fidelity` if it is at least 0.6 and at least 0.03 above the other;
  otherwise the one that is not truncated and does not end abruptly; otherwise none. The take
  window shows "Consigliata" and the reason ("parole riconosciute 91%"). If the owner picks
  before scores land, nothing changes.
- Needs `Db.patchTake(id, patch)`.

## 7. Covers (step 1)

- Read time, no pipeline step, no backfill: the feed uses, in order, the chosen take's Suno image,
  the video thumbnail, a frame of the video, else a typographic cover drawn in CSS: the song
  title over the existing `artFor()` gradient, in the app font (all scripts covered by the
  browser).
- Suno image: `record.json` already contains `image_url` per take
  (`data.response.data[].image_url`). `generate_song` copies it into the version's storage folder
  as `cover-<generation>-<take>.jpg` and stores `takes.cover_path`. Existing kie songs: a one-off
  script reads their `record.json` files where they still exist.

## 8. Bake-off (step 0, gate for G5)

- Prompts: the owner's 5 real Italian topics; each engine (kie as the baseline, YuE2 INT8, and
  ACE-Step 2B in both turbo and SFT at 30 steps) generates two takes per prompt.
- Measured with `score_takes.py`: fidelity per take, duration, abrupt end.
- Also: two consecutive jobs (#16416), one 4:30 song with peak VRAM recorded, a listening check
  at 2:00 and at the end (YuE2 seam: the evidence says ComfyUI renders 3-5 minute songs in one
  chunk, so no automatic seam detector is built unless a seam is heard).
- Pass for an engine in Italian: median fidelity within 0.10 of kie's on the same prompts, no
  truncated chosen take, two consecutive jobs complete, and the owner rates at least 3 of 5 as
  usable. Results in `bakeoff.md`. Other languages need their own bake-off before the engine
  shows for them.

## 9. Data changes (migration A, before steps 2 and 3)

- `takes`: `seed bigint`, `engine text not null default 'kie'`, `cover_path text`, `abc text`.
- `SongSettingsSchema`: `engine: z.enum(["kie","ace-step","yue2"]).default("kie")` (the schema
  strips unknown keys today, so this is required).
- `workers.engines jsonb` (`{ "<id>": { installed, passedLangs: [], minutesPerAudioMinute,
  checkedAt } }`, filled from file checks, not by starting ComfyUI), plus the column grant to
  authenticated users.
- `create_song` engine validation (5.5).

## 10. UI (step 4)

- Engine selector next to the model selector, shown only to the admin and only listing engines
  with `installed` and the song's languages in `passedLangs`, and only while the worker was seen
  in the last 60 s.
- Controls per engine: kie shows all current controls; local engines hide model (v6 menu),
  weirdness, style influence, variety and exclude; ACE-Step keeps duration.
- Engine-aware text: `next.approveCost`, `next.confirm`, `create.cost`, the "Genera di nuovo (12
  crediti)" recovery button and `credits.songs`. Local: "Gratis, circa N minuti sul PC" with
  N from `minutesPerAudioMinute` and the expected length.

## 11. Alternatives considered

- YuE2-Studio `yue-server.exe` (C++, Q8): fallback if ComfyUI fails the bake-off on 8 GB.
- Official Python inference: two Python environments on Windows; ComfyUI hosts both engines.
- A `MusicEngine` interface over kie now: rejected (risks the paid path for no gain yet).
- Local faster-whisper on CPU for scoring: not needed while timing already uses Groq; revisit if
  Groq cost or privacy becomes a problem.
- Keep kie only: no free option, the owner's main request.

## 12. Risks

| Risk                                 | Mitigation                                                          |
| ------------------------------------ | ------------------------------------------------------------------- |
| Italian diction poor on both engines | Step 0 gate; engines stay hidden                                    |
| ComfyUI #16416 second-job hang       | Sequential takes, watchdog, bake-off test                           |
| Out of memory with a game open       | Free-VRAM check, `retryLater`, never fall back to kie               |
| Orphan ComfyUI after a worker crash  | Job Object, PID adoption                                            |
| YuE2 license                         | Admin-only in SQL and worker                                        |
| ComfyUI update renames nodes         | Pinned version, committed API graph, node check on start            |
| YuE2 truncation                      | 330/360 s ceiling, `truncated` flag, scoring prefers complete takes |

## 13. Owner decision

- D1. Approve the downloads for step 0 (ComfyUI portable 2.04 GB, YuE2 INT8 3.96 GB, ACE-Step
  1.5 2B checkpoints about 5 GB, all on E:, 488 GB free) and which engines enter the bake-off.

## 14. Owner decisions and bake-off outcome (2026-11-01)

- Downloads approved and done: ComfyUI 0.43.0 portable, YuE2 INT8, ACE-Step 1.5 2B (turbo, SFT,
  Qwen 1.7B and 4B text encoders, VAE): 20.8 GB on E:, more than the ~11 GB estimated because the
  2B SFT checkpoint is not on Comfy-Org and ComfyUI needs the 1.7B or 4B language model.
- Bake-off (bakeoff.md): no engine passed the numeric rule as written. Both failures were
  settings, not quality: YuE2 truncated at the 330 s ceiling, ACE-Step SFT stopped abruptly at the
  fixed 210 s length. The owner listened to the best takes and rated both engines usable in
  Italian.
- Changes from the bake-off: YuE2 `max_duration` 420 s (the model stops on its own; 330 s cut
  2 of 3 songs). ACE-Step uses SFT at 30 steps (turbo dropped: fidelity 0.71) with a target
  length computed from the lyric pack: 3.2 s per sung line plus 25 s, between 120 and 300 s,
  so the song is not cut at full volume.
- Both engines enabled for Italian (`passedLangs: ["it"]`), admin only.
