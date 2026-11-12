# Task 12 report: songs from songs (Riscrivi una parte, Importa da Suno, upload, cover, reference, transcription)

Branch `build/studio-ui`. My commits, oldest first (other sessions committed docs in between):

- `1a1d6e2` fix(visualizer): stock background script passes biome
- `366fa28` feat(db): songs from songs (migration 23)
- `f05c9bc` feat(shared): rewrite limits, timed lyric lines, song source and licences, new stages
- `8f1520c` feat(worker): rewrite with kie replace-section or ACE-Step, import audio, covers and extensions from audio, timed lyric lines
- `f11799c` feat(web): Riscrivi una parte in the editor, transcription and Suno link routes, audio uploads, song sources
- `1b501b8` feat(web): Importa da Suno dialog; import writes the lyrics for the take scoring
- `67a6c74` fix(worker): never call kie for a test account or a song marked as a test (urgent request)
- `f80d79f` fix(web): e2e refuses the live Supabase stack by default (urgent request)
- `8080258` feat(web): rewrite, cover and reference from menu, details panel, listening view; take in use; Fonti
- `b472a72` feat(web): Audio card in the create panel
- `5310e4c` fix(web): lit lyric lines scroll into view
- `5550699` fix(worker): timing writes the lyric files of an imported song
- `931bd6b` test(web): rewrite panel, routes, sources, recordings (+ Suno page reader fix, phone layout, import badge)
- `5923695` fix: song source type, labelled drop area
- `32182b2` feat(web): a song can start from its audio alone
- `c775430` test(db): requeue_stale test tolerates other runs' stale jobs
- `b982cbb` fix: covers, references and extensions on kie only (migration 24)
- `459465f` chore(worker): drop imports the removed local cover left behind

A power cut stopped the PC mid-task; the work on disk was intact and was committed in the steps above.

## Research

### Suno's Replace Section (help.suno.com articles 3271873 and 6141505, guides; saved under E:/mellodifai/research/t12)

- Flow: More Actions > Edit > Replace Section. Click and drag on the waveform to highlight the part;
  the lyrics sung there are highlighted and copied into the Lyrics box; edit them; "Recreate
  Section"; a confirmation; two new versions; listen to both in the song and select one; Suno then
  makes a new whole song tagged Section / Full Song. The newer editor adds "Generate More" and
  previews alternatives in an edits library; the original stays available.
- Limits: Suno's help pages give none in numbers; guides and users quote a 10 to 30 second part.
  kie's replace-section (docs.kie.ai/suno-api/replace-section) refuses less than 10 s or more than
  50% of the track. Applied to both engines and shown under the waveform: "Da 10 a 30 secondi, al
  massimo metà del brano (qui N s)" (constants `SECTION_LIMITS`, also checked by
  `request_section_edit` and by the worker on the real length). This matches the controller's
  research note (10 s minimum, 50% maximum).

### kie endpoints (docs.kie.ai, checked 2026-11-01) and prices (kie.ai/suno-api)

- `ai-music-api/replace-section` (jobs/createTask): `task_id` + `audio_id` of the take, or
  `upload_url` + `model` for any audio; `prompt`, `lyrics` (segment), `full_lyrics`, `tags`,
  `title`, `infill_start_s`, `infill_end_s`, optional negative tags, vocal gender. 5 credits.
  The brief's camelCase names (`infillStartS`...) are the old API; the current one is snake_case.
- `ai-music-api/upload-and-cover-audio` (12 credits; `audio_weight`) and
  `ai-music-api/upload-and-extend-audio` (12 credits; `continue_at`), source up to 8 minutes.
- Free file upload `kieai.redpandaai.co/api/file-stream-upload` (deleted after 24 h): how any take
  or upload reaches kie. Generated tracks are kept 14 days, so a take older than that goes to
  replace-section as a file, not by task id.
- kie's `get-timestamped-lyrics` is already called per kie take by generate_song (aligned words);
  for the rewrite's line timing I use the word timing the pipeline already stores for every take
  (Groq Whisper words from score_takes, or the timing stage's measured lines), see below.

### ACE-Step in the installed ComfyUI 0.43.0 (/object_info, E:/mellodifai/research/t12/ace*)

- Present: `LoadAudio`, `VAEEncodeAudio`, `VAEDecodeAudio`, `ReferenceTimbreAudio`,
  `SetLatentNoiseMask`, `TrimAudioDuration`, `AudioConcat`, `AudioMerge`. No repaint node; ACE-Step
  1.5's own repaint (chunk masks) is hard-coded off in ComfyUI, and `SetLatentNoiseMask` fails on
  audio latents (it reshapes the mask to 4-D, the sampler interpolates it as 1-D).
- What works with the installed nodes (the pattern of ComfyUI's ACE-Step m2m editing template):
  the window around the part (5 s each side) is VAE-encoded and sampled again at denoise 0.5 with
  the new lyrics. Feasibility run on "Solo un caffè": Whisper heard "sono le otto ho già gli occhi
  chiusi il primo file mi confusi" where the new lyrics were "Sono le otto, ho già gli occhi chiusi
  / il primo file e i pensieri confusi"; word times stayed within 0.2 s of the original, level
  within 1 dB. The part is then spliced into the take with 0.3 s crossfades and level matching.
- Cover: `ReferenceTimbreAudio` sang no words (Whisper heard nothing). Audio-to-audio at denoise
  0.65 to 0.85 kept every word on a one-minute excerpt and moved the sound to the asked style
  (spectral centroid 1953 Hz to 1514 Hz towards "acoustic folk"), so I first built the ACE-Step
  cover that way. The end-to-end cover of the whole song (281 s) then came out as saturated noise
  (mean level 0.0 dBFS, Whisper fidelity 0.009); four settings on the whole song (denoise 0.6 and
  0.8, with and without audio codes, two tempos) gave the same. ACE-Step therefore offers no cover,
  reference or extension: the option is not shown for it (shared `sourceModesFor`, worker
  `features: ["rewrite"]`, `create_song` refuses it, migration 24). The rewrite windows (at most
  40 s) are not affected.

## What was built

### Database (migration 20261101000023_songs_from_songs)

- `jobs.stage` + `replace_section` (on demand, never changes the song status) and `import_audio`.
- `takes`: `kie_audio_id`, `source` (`{kind: "replace", from_take_id, edit_id, start, end,
  alternative}` or `{kind: "import"}`), `lyric_timing` (timed lyric lines), `lyrics` (what this
  take sings when it differs from the song); engine `import`.
- `projects.source`: kind (suno, upload, cover, reference, extend), title, author, url, licence
  (own, CC BY/BY-SA/BY-NC/BY-NC-SA/BY-ND/BY-NC-ND, CC0, public domain, licensed, unknown), library
  song, upload. Feeds the remix credits now and T17 later.
- `section_edits` (owner-read RLS, written by RPC and worker only).
- RPCs: `request_section_edit` (statuses takes_review, audio_ready, video_review, approved,
  published; current take with audio; 10 to 30 s and at most half; ACE-Step admin only; one rewrite
  per song at a time), `keep_section_edit` (new take in the same generation next to the original,
  made the chosen take with its lyrics unless the takes are still being reviewed; the original
  keeps its own lyrics), `discard_section_edit`, `choose_take` (switch back), `pick_take` and
  `keep_audio` now also bring a take's own lyrics, `my_section_queue`, `my_queue_positions` without
  rewrites, `import_song`, `set_song_source`, `create_song` with `song_settings.source` (an upload
  of the caller or one of the caller's takes, in a mode the engine has) recording
  `projects.source`. The uploads bucket also takes audio/mpeg, audio/wav, audio/flac under
  `<owner>/audio/`.

### Worker

- `kie/client.ts`: createTask (refused vs unknown outcome, never submits twice), recordInfo/wait,
  credits, free file upload, track parsing.
- `kie/guard.ts` (urgent request): every paid kie path (generate_song including cover/extend and
  timestamps, replace_section) fails at once with "Canzone di prova: kie non viene chiamato per un
  account di test (nessun credito usato)..." when the owner's e-mail ends in `.test` or the project
  is marked `song_settings.test`, unless the worker runs with `ALLOW_TEST_KIE=1`. Written test
  first (`test/kie-guard.test.ts`); removing the guard line makes it fail.
- `stages/replace-section.ts`: kie path (balance check, take's own task/track when younger than 14
  days, else uploaded file; durable submit state; whole songs back are used as they are, a part alone
  is spliced) and ACE-Step path (admin only, waits while another program holds the GPU, window in
  ComfyUI's input folder, two seeds, splice with level matching). Alternatives: 128k previews in
  storage, full-quality copies in `out/<lang>/sections/` used by `takeAudio` and the timing stage.
- `stages/import-audio.ts`: the upload becomes take 1 (MP3 kept, WAV/FLAC to 320k), preview,
  lyric files, Whisper scoring and timing.
- `stages/source-audio.ts`: covers, references (kie, audio_weight 0.3) and extensions from audio
  submit through kie's upload endpoints and write `task.json`, so the rest of generate_song runs
  unchanged. A local engine refuses a song from audio before starting ComfyUI.
- Timed lines: score_takes' Whisper words aligned to the lyric lines (`timingFromWords`, a global
  word alignment), the timing stage's measured lines for the chosen take, `kie_audio_id` stored from
  `takes.json`; `scripts/backfill-lyric-timing.ts` filled older takes once.
- Timing accepts takes 3, 4... (rewritten) and writes missing lyric files (imports).
- ComfyUI features published per engine (`features: rewrite, cover`); fake stages for both stages.

### Web

- Editor (`/editor/<id>?tab=rewrite`), tabs "Taglia e dissolvi" | "Riscrivi una parte", built on
  the T11 waveform (new `section` variant): choose the take, drag across the waveform (or type Da/A),
  limits under it in red when broken, "Ascolta la parte"; lyrics list with the lines sung in the
  part lit (from the take's timing; without timing the owner taps the lines), the lit lines scroll
  into view; "Testo della parte" holds only those lines and replaces exactly that block; engine
  "Suno (kie) · 5 crediti" or "ACE-Step · locale, gratis" (ACE-Step only for the admin with the PC
  online and the feature installed); confirmation with kie's cost and the balance (confirm disabled
  under 5 credits) or the free local run; queue place and progress; failure with Riprova and
  Scarta; alternatives heard in the song from 4 s before to 3 s after the part (Originale and each
  Alternativa), "Tieni questa", "Altre alternative", "Scarta tutte".
- Entry points: song menu (Riscrivi una parte, Cover di questa canzone, Usa come riferimento),
  details panel tools, listening view link, editor tab.
- Details panel: take chips mark the take in use; while another take plays, "Usa questa versione
  N"; rewritten takes carry a pen mark. "Fonti" with kind, title, author, "Ascolta" (the upload or
  the library song), licence chip, credit line with "Copia i crediti", licence warnings (ND, NC,
  to be checked) and "Modifica" (title, author, link, licence).
- "Importa da Suno" (Library and Create header, one dialog for the app): drop or pick MP3/WAV/FLAC
  up to 50 MB each, or paste a suno.com share link ("Recupera": one request for the public page and
  one for its MP3, at the click; nothing else touches suno.com); per song title, language, licence,
  style, lyrics with "Trascrivi il testo" (cancellable) and a player; imports each as a song.
- Create panel "Audio" card: Riferimento | Cover | Estendi with hints, "Dalla libreria" picker,
  "Carica", drop a song card from the list or a file, mini player, "Trascrivi nel testo"
  (cancellable), "Continua da" for extensions; modes an engine lacks are flagged and block Create;
  kie's 8-minute source limit too. A song can start from the audio alone.
- `/api/transcribe` (Groq Whisper large v3, the worker's key read from the same env files, 16 kHz
  mono WAV made in the browser so a 50 MB WAV fits Groq's 25 MB limit; the browser's abort cancels
  the call to Groq) and `/api/suno-link`.
- Imported songs badge "Suno" instead of a model.

### e2e stack guard (urgent request)

The "E2E flow ..." song came from the web Playwright suite (`apps/web/e2e/global-setup.ts` and
`flow.spec.ts`): at 18:37 UTC a run with SUPABASE_URL set to the live stack (54321) wiped the e2e
admin's songs and queued a song the live worker generated on kie. `e2e/local-env.ts` now refuses
port 54321 unless `E2E_ALLOW_LIVE_STACK=1`; `playwright.config.ts` checks it before starting and
runs its own dev server on `E2E_PORT` (3210) instead of reusing the owner's server on 3000 (which
talks to the live stack); Mailpit defaults to the e2e stack's 45624. Tests in `lib/e2e-env.test.ts`
(written failing first).

## Tests

- Shared 90 (rewrite limits, timing alignment, lit lines, block replacement, timing carried over,
  window lyrics, sources, audio source schema).
- Worker 285 + 2 skipped (new: rewrite 18, songs from songs 10, kie guard 4, timing import 1).
- Web 667 in 73 files (new: rewrite panel 6, routes 5, songs-from-songs 10, e2e env 4, create from
  audio, badge, take chips and tools updated).
- Database 123 (13 new; migration 24 applied on both stacks). Run against the separate e2e stack (`E:/mellodifai/ops/task12/dbtest-e2e.sh`,
  refuses any other URL); migration 23 applied there. Before the controller's message I had run
  the database suite once on the live stack: its jobs are parked at once and its owners are
  `@example.test` (now refused by the kie guard); no kie call happened.
- Visualizer 10. biome clean on apps, packages, supabase; tsc -b and web tsc clean.

## End-to-end evidence (live app, test account e2e-admin@mellodifai.test)

The test account's earlier songs had been deleted by the e2e run above, so its songs were made
again through "Importa da Suno".

- Import: "Solo un caffè (C-A-F-F-È).mp3" dropped (11 MB), "Trascrivi il testo" filled 56 lines in
  12 s, a second transcription cancelled ("Trascrizione annullata."), real lyrics pasted, imported:
  import_audio made take 1 and the song went to audio_ready. "Civico tredici, via dei
  Lampioni.mp3" (6 min) imported the same way, with 79 timed lines from Whisper. Shots
  `import-*.png`.
- Rewrite with ACE-Step from the UI on "Civico tredici": part 0:53.7 to 1:08.0, five lines lit, first
  line rewritten; kie dialog showed "costa 5 crediti kie ... Saldo attuale: 74 crediti" and was
  cancelled; ACE-Step dialog confirmed; two alternatives in 103 s; Alternativa 1 auditioned from
  0:49.7; kept: take 2 (`ace-step`, source replace) chosen, take 1 kept as "Versione 1". Length
  unchanged (357.84 s). Whisper on the result: the part is sung and joins the song cleanly, but
  alternative 1 did not sing the rewritten first line (it repeated the previous line's words);
  alternative 2 sang "ho riscritto sta riga con parole..." and shifted the next line. Shots
  `rewrite-*.png`.
- The imported, rewritten song then went through the video pipeline from its card ("Crea il
  video"): timing, storyboard, render_master, render_hook, qa and art passed on the rewritten take
  (take 2) and the song reached video_review. (An earlier
  attempt on the first import failed because imports had no lyric files; fixed in `5550699`.)
- Cover from the song menu ("Cover di questa canzone"): the Create panel got the take as audio
  (Audio card, Cover), the song "Solo un caffè (cover folk)" was created with ACE-Step and
  `projects.source = {kind: cover, versionId: ...}`, its lyrics approved ("Approva · gratis"), and
  two 281 s takes were made after the job had waited for VRAM. Both are noise (see research), which
  is why covers are now kie-only; that test song stays in takes review. The kie cover path is
  covered by mocked tests only (no credits).
- Pixel checks at 1440x900, 1360x600 and 390x844, dark and light: rewrite page, details panel with
  Fonti and take chips, import dialog, Create Audio card (`*-desktop|owner|phone-dark|light.png`).
  Fixed on the way: the part times were cut on a phone, the lit lines were out of view, imports
  showed a "v6" badge.

## Departures, with reasons

- ACE-Step's "repaint" is a window re-sampled at denoise 0.5 and spliced, not a masked repaint:
  the installed nodes have no audio mask (see research). Results vary per alternative, so the
  panel always offers two, the original for A/B, and "Altre alternative".
- Covers, references and extensions are kie-only: ACE-Step's whole-song audio-to-audio produced
  noise and its reference node no words. kie's Riferimento is upload-and-cover with audio_weight
  0.3 (Cover 0.75), since kie has no separate reference endpoint.
- Transcription runs in the web server (Groq), not on the worker: a worker job would wait behind a
  10-minute GPU job, and cancel would not be immediate. The key is read from the worker's env files
  (WORKER_ENV_FILES), as the OpenRouter key already is; nothing was copied.
- Suno's 30 s maximum is taken from guides and users; kie's own limits (10 s, half the track) are
  documented.
- Alternatives not kept stay in storage (small 128k previews) until the song's next generation.

## Open items

- ACE-Step covers on the PC: not offered until a node set that handles whole songs is installed
  (a tiled audio encode or ACE-Step's native cover/repaint pipeline). The worker's rule of 6 GB free
  VRAM made the cover job wait about an hour while desktop programs held 2.4 GB.
- ACE-Step rewrites vary: in the E2E run one of the two alternatives sang the rewritten line. More
  alternatives ("Altre alternative") or kie are the remedies; a denoise study on more songs is open.
- kie paths were driven only to the cost dialog (rule: never spend credits); the kie client and
  stage are covered by mocked tests.
- A real suno.com share link was not fetched (no owner link available; a page fetch is allowed only
  at the owner's click). The reader is tested on a synthetic page with Suno's meta tags.
- The 50 MB limit follows the local Supabase global limit until the stack restarts with 100 MiB.
