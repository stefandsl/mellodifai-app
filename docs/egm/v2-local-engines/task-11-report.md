# Task 11 report: stems and audio editor

Branch `build/studio-ui`. Plan: `feature-parity-plan.md` T11, the T11 bullets of "Additions from the video" and item H of
`ace-ui-replica-prompt.md`.

## What was built

### Database (migration `20261101000020_stems_and_editor.sql`, applied locally and recorded)

- `jobs.stage` accepts `stems`; `takes.stems jsonb` (object only, written by the worker; RLS lets only the owner read it);
  `takes.engine` accepts `edit`.
- `request_stems(version)`: queues the separation of the chosen take, idempotency key `stems:<version>:<take>`. Asking again
  returns the same job; a failed or cancelled job is queued again (the "Riprova" button). Allowed while the song has a chosen
  take with audio: `audio_ready`, `producing`, `video_review`, `approved`, `publishing`, `published` (`stems_allowed_status`).
- `my_stems_queue()` gives the place in the queue of the caller's stems jobs; `my_queue_positions()` now leaves stems jobs out,
  so a stems request does not put "In coda" on the song itself (stems jobs still count as work ahead of other songs).
- Editor uploads: three storage policies on `previews/edits/<owner>/...` (insert and read by the owner, delete only while no take
  uses the file) and `save_edited_take(version, path)`: checks the path shape and that the object exists as `audio/mpeg`, then
  inserts a take `engine = 'edit'` in a new generation (keeping the cover) and makes it the chosen take. Allowed in
  `audio_ready`, `video_review`, `approved`, `published` (never while the PC is producing or publishing).

### Worker

- Stage `stems` (`apps/worker/src/stages/stems.ts`): Demucs `htdemucs`, `--shifts=0`, the same venv the timing stage uses
  (`E:/suno-remake-archive/.venv-stems`, a CPU torch build, so it never competes with ComfyUI for the GPU). Source: the local
  FLAC of a local engine, else the 320k MP3 in the workspace, else (edited takes, older generations, missing files) the stored
  file downloaded through the new `Storage.download`. Four MP3s at 192 kbps uploaded as previews, plus 600 peak values per stem
  for the waveforms, written to `takes.stems` with duration and how long it took. Progress: tqdm lines become throttled progress
  events (5 to 85%, then one step per encoded stem), the other output goes to the log. WAV files are deleted at the end.
- On-demand stages (`ON_DEMAND_STAGES` in shared) never change the song status, not even when they fail.
- The preview cleanup drops the stems of superseded takes with their audio. `timing` writes an edited take into
  `out/<lang>/take-N.mp3` (and drops the kie word alignment of the original) before the pipeline runs, so a video can be made
  from an edit. Fake stage with the same shape.

### Web

- **Card menu, details panel, listening view**: "Modifica audio" and "Estrai stems" (menu items disabled where they do not
  apply; panel tools via `registerSongTool`, orders 20 and 30; links in the listening view under the actions). "Estrai stems"
  asks for the stems unless they exist or are on their way, then opens the stems page.
- **Feed progress**: a badge on the card while stems are queued ("Stems in coda #2"), running ("Stems 42%", live from the job
  events) or failed; ready stems show a green "Stems" chip in the details panel only. Every badge links to the stems page.
- **Stems page** (`/stems/[id]`, in-app with Indietro): start card, "In coda #N", "Separazione in corso" with a progress bar,
  elapsed time and an estimate, "Dettagli tecnici" log, failure with the reason and "Riprova". When done: "Completato in 1:08",
  a transport (play the mix, seek, "Tutte le tracce" to reset), "Scarica tutto (ZIP)", and one row per stem (Voce, Batteria,
  Basso, Altro) with a colour token, a waveform that is also its seek bar, play (the stem alone), Solo, Muto and MP3 download.
  The four stems always run together on one clock (drift corrected), so solo and mute are instant and in sync; the main player
  stops when the stems play and the other way round. Re-opening shows the stems at once.
- **Audio editor** (`/editor/[id]`, in-app): waveform with draggable (and keyboard) trim handles, a click moves the position,
  start and end fields (m:ss.s or seconds), fade in and out (0 to 10 s, exact values typeable), normalise to -1 dBFS, preview
  through Web Audio with the same envelope the export uses, "Annulla le modifiche", "Scarica WAV" (16-bit), "Scarica MP3"
  (320 kbps, LAME in WebAssembly via `wasm-media-encoders` 0.7.0, MIT, loaded only when needed), and "Salva come nuova
  versione" behind a confirmation that says the edit replaces the current takes and that a video already made stays as it is.
- Shared `stage.stems` label (fixes the `tsc --noEmit` break in apps/web); 78 new studio strings in Italian and English.

## Bug found and fixed on the way (pre-existing)

**No job of any user other than the worker's owner could log or report progress.** `SupabaseDb.appendEvent` wrote
`owner_id = WORKER_OWNER_ID`, but `job_events_job_owner_fkey` ties `(job_id, owner_id)` to the job, so every event of a job owned
by someone else (the e2e admin, any customer) was refused (`violates foreign key constraint`, repeated in `E:\mellodifai\worker.log`).
Found during the real stems run: the page sat at "Separazione in corso" with no percentage. Events are now written under the
job's owner (`appendEvent(job, ...)`), with a unit test that fails on the old code. After the fix the second real run showed
5%, 31%, 59%, 76%... live in the page and on the card.

## Real runs on this PC

- **Stems of "Solo un caffè (C-A-F-F-È)"** (e2e-admin, ACE-Step, 4:41) from the stems page: done in 68.4 s on the CPU
  (torch 2.5.1+cpu). Four MP3s of 6.7 MB each (192 kbps, 281.05 s). Driven in Chromium: playing one stem alone, then bass and
  drums on solo with vocals muted, then a seek to 2:00: all four elements within 0.02 s of each other, muted flags as expected,
  pause stops all four. "Scarica tutto (ZIP)": a valid archive (`zipfile.testzip()` clean, UTF-8 names, stored entries).
  These stems stay on the song.
- **Editor save** on a throwaway copy ("Prova editor T11", removed afterwards with its files): trim 0:10.5 to 1:00.0, fades 2 s
  and 3 s, normalise. WAV 49.5 s, peak exactly -1.0 dB, first 0.1 s at -47.7 dB; MP3 320 kbps 49.54 s. Saved: a take
  `engine = edit`, generation 2, chosen; the library played it. Then "Estrai stems" from the details panel on that edit:
  downloaded from storage, separated in 18 s, with live progress on the page and "Stems 31%" on the card.
- The worker was restarted twice while idle (to load the stage, then the event fix); it now runs from my session in the
  background with the same command and environment as before, appending to `E:\mellodifai\worker.log`.

## Tests

- DB `supabase/tests/stems.test.ts` (part of 102 DB tests): request rules per status, idempotency and retry, foreign and anonymous
  callers, no direct job insert, stage and engine checks, stems RLS (owner reads, nobody but the service role writes),
  `my_stems_queue` and its separation from `my_queue_positions`, `save_edited_take` (path, object, mime, repeat, statuses),
  edit storage policies.
- Worker `test/stems.test.ts` (18): command line, sources (FLAC, kie MP3, edit and missing file downloaded, older generation),
  idempotency, Demucs failure cleanup, progress mapping and log filtering, loop behaviour (status never changes, failures do not
  fail the song, every allowed status), fake stage, preview cleanup of stems, timing on an edit, helpers. `db.test.ts`: event owner.
- Web (new): `zip`, `audio-edit`, `mp3` (including a real WebAssembly encode checked for MPEG frame sync), `stem-mix`, `stems`
  (availability and loader), `stems-state`, `edit-save`, `actions/audio-tools`, `stems-view` (13), `stems-badge` (7),
  `audio-editor` (8); extended `details-panel`, `feed-details`, `now-playing`, `studio` (loader).
- Results: `biome check` clean, `tsc -b` and `tsc --noEmit` clean, shared 34, worker 244 + 2 skipped, web 601, DB 102.
- Mutation check: 12 mutations of the new logic (failed/cancelled mapping, row play toggle, solo over mute, progress of the current
  run only, no re-request while running, cleanup of a refused upload, edit statuses, fade out, ZIP UTF-8 flag, preview fade ramp,
  main player stop, edit path regex). Two survived at first (the ZIP test read flags only from the central directory; the action
  test had no bad last path segment); both tests were strengthened and now kill them.

## Screenshots

`task-11-shots/` (19, desktop 1440 and phone 390, dark and light): stems start, running, card badge, finished (three views),
solo and mute, log, card menu, details panel, listening view (desktop, phone), editor (desktop dark and light, phone), playing
with trim and fades, save confirmation (desktop, phone), library after saving. No console errors in any run.

## Deviations and concerns

1. **Stems are MP3 192 kbps, not WAV**, and the per-stem button says "MP3". Four WAV stems of a 4-minute song are about 170 MB
   against the 1 GB storage of the hosted project; MP3 stems are about 27 MB.
2. **"Scarica tutto (ZIP)" is built in the browser** from the four stored files (stored, not compressed, as MP3 does not
   compress), not by the worker, so the stems are not kept twice in storage. Same result for the user.
3. **The time readout is shown once**, in the transport, not on every stem row: the four stems share one clock, so four identical
   readouts added nothing.
4. **The editor works on the 128 kbps preview**, the only audio the browser can reach; the saved edit is encoded at 320 kbps to
   avoid a second loss, but cannot be better than its source. A lossless path would mean storing the full-quality take or
   applying the edit on the PC (a worker stage taking trim/fade/normalise parameters); not done.
5. **Saving an edit supersedes the current takes**: the next upload of that song removes their previews and stems (the existing
   generation cleanup). The confirmation says so. There is no undo.
6. The stems log ("Dettagli tecnici") shows the worker's raw lines, including local paths on the render PC.
7. **Observed, not fixed (outside this task)**: the storage read policy for customers compares the first folder of the object name
   with the user id, but previews are stored as `previews/<owner>/...`, so a customer probably cannot read their own previews
   (admins can). Worth a separate check before customers use the app.
