# Feature parity with fspecii/ace-step-ui (owner request 2026-11-01)

Source inventory: `E:/mellodifai/research/ace-step-ui-report.md` section 2 (items marked GAP).
Rule from the owner: every visible control works; nothing is a placeholder. Reimplement ideas,
do not copy code (the repo has no license file).

Out of scope, with reason (tell the owner, do not build): social layer (public profiles,
comments, follows, featured creators), LoRA loading and training (needs more than 8 GB VRAM),
the ~30 expert diffusion knobs (only the few that change local results are exposed in T9), the
zh/ja/ko interface (the app is IT/EN).

## Global constraints

Same as `implementation_plan.md` (biome, tsc -b, all tests pass after each task; never spend kie
credits in tests; every kie action that costs credits shows the cost before confirming; Italian
UI with proper accents plus English; no em dash characters; runtime files on E:; local engines
admin only). GPU jobs must not run during implementation tests while the YuE2 end-to-end test is
running (check `nvidia-smi` and the jobs table).

## T7 Library: likes, plays, rename, multi-select, trash, filters, queue position

- Migration: `version_likes` or columns on versions (`liked boolean`, `disliked boolean`,
  `play_count int`), `trashed_at timestamptz`; RPCs `set_reaction`, `count_play` (debounced:
  count after 30 s of playback), `rename_version` (owner only, 1-100 chars, stores the title in
  the lyric pack copy shown in the feed), `trash_versions(ids)`, `restore_versions(ids)`,
  `purge_trash` (older than 30 days, admin). Trashed songs leave the feed and appear in
  Library > Cestino with Restore.
- Feed: like and dislike buttons on cards and in the player; inline title rename (click the
  title's pencil, Enter saves, Esc cancels); multi-select mode with select all and bulk move to
  trash with a partial-failure toast; filter chips Mi piace, In creazione, Solo audio (plus the
  existing ones); "In coda #N" on cards whose job waits behind others.
- Tests: RLS and RPC tests, feed tests for each control.

## T8 Player: repeat one, speed, now playing, download, like

- Repeat cycles off / all / one; playback speed menu 0.5x to 2x (remembered); fullscreen "Now
  playing" view with cover, title, lyrics, controls, Esc closes (desktop and phone); download
  the current audio; like/dislike wired to T7.

## T9 Create panel: musical controls, exact sliders, seed, several songs per click

- BPM, key and time signature, each Auto by default. kie: appended to the style text as tags;
  ACE-Step: passed to its text encoder inputs (bpm, keyscale, timesignature); YuE2: style tags.
- EditableSlider: the value label is clickable to type an exact value (Enter commits, Esc
  cancels), used by duration, weirdness, style influence, variety.
- Seed for local engines: random (default) or fixed number; stored on the takes.
- Songs per click 1 to 4; the Create button reads "Crea 3 canzoni · 36 crediti" or
  "Crea 3 canzoni · gratis"; persisted; create_song creates one project per song.
- Lyrics box resizable by dragging, height remembered.
- Local-engine extras worth exposing (ACE-Step): steps and guidance in a small "Esperto" section.

## T10 Playlists, share, covers, menu

- Playlists: create, rename, delete, add/remove songs (from the card menu and multi-select),
  playlist page that plays in order; nav entry.
- Share window: copy link, WhatsApp, Telegram, X, Facebook, LinkedIn, Reddit, email.
- Procedural fallback covers: several pattern families (mesh, orbs, rays, waves, conic, blobs)
  chosen by the song id.

## T11 Stems and audio editor

- Worker stage `stems` (on demand, free, local Demucs, the one the timing stage already uses):
  4 stems (vocals, drums, bass, other) uploaded as previews; card and song page menu "Estrai
  stems" with download links when done; progress in the feed.
- Audio editor in the browser on a song: waveform, trim start and end, fade in and out, normalize,
  export WAV or MP3 download, and "Salva come nuova versione" (uploads the edited file as a new
  take of the same song).

## T12 Songs from songs: upload, reference, cover, extend, transcribe, repaint

- Upload audio in the create panel (drag and drop or file picker; mp3/wav/flac up to 50 MB) into
  a private storage bucket; library picker.
- Drag a song card onto the create panel; card menu "Cover di questa canzone" and "Usa come
  riferimento".
- Engines: kie upload-cover and upload-extend (cost shown before confirm); ACE-Step cover and
  reference through its ComfyUI audio input if the installed nodes support it (check
  /object_info); otherwise the option is not shown for that engine.
- Automatic transcription of an uploaded track (Groq Whisper) into the lyrics box, cancellable.
- Repaint a time range of an existing take: kie replace-section (cost shown) and ACE-Step
  repaint if supported; result is a new take.

## T13 Visualizer videos without lyrics

- Remotion compositions with presets (spectrum, circle, mirror, waveform, particles, minimal) and
  effects (grain, VHS, scanlines, vignette, chromatic aberration, glitch), 16:9 and 9:16, chosen
  in the Video card ("Visualizer") and from the song menu "Crea video visualizer"; rendered on the
  PC by a new stage; downloadable.

## Additions from the video (ace-ui-replica-prompt.md, 2026-11-01)

Implementers read `ace-ui-replica-prompt.md` in this folder for exact behaviour; it is part of
the requirements of each task below.

- T8: clicking the player title opens a full listening view of the song (cover, lyrics, takes as
  chips, actions); song links get OpenGraph previews (title, cover) when shared.
- T9: a clear button on each text field; "Formatta con AI" on the styles field also fills BPM,
  key and time signature (OpenRouter, the lyric pipeline's fast writer).
- T10: a persistent "Dettagli" side panel for the selected song (cover, title, tags and lyrics
  with copy, tool buttons: video, stems, editor, cover, reference, repaint), instead of jumping to
  the project page; a "Mi piace" system playlist; a private search page across songs, lyrics and
  playlists. The playing card stays highlighted.
- T11: stems open in an in-app page with a player per stem (solo/mute) and "Scarica tutti" (zip);
  the editor opens inside the app, not in a new tab.
- T13: the Video Studio has a live browser preview that uses the same parameter set as the
  Remotion render: background modes, colour presets, particles, centre image, text layers and
  per-effect intensity.
- Do differently from the source: dislike must be real (T7); one stored title with takes shown
  as chips instead of "(v1) (v2)" title chains; no decorative "online" dot, only the real worker
  status (already the case).

## T14 Comfy Cloud as a second runtime for the local engines (owner request 2026-11-01)

The owner has a Comfy Cloud subscription. Its API is compatible with local ComfyUI
(https://docs.comfy.org/development/cloud/overview): `https://cloud.comfy.org`, header
`X-API-Key`, `POST /api/prompt` with API-format graphs, WebSocket progress,
`GET /api/job/{id}/status`, `GET /api/view` (redirect), `GET /api/object_info`, model listing,
uploads; jobs draw the plan's monthly credits, run in parallel up to the plan's concurrency,
max 30 minutes each, 100 queued (https://docs.comfy.org/development/deploy/cloud-usage.md).

- Prerequisite: the owner stores `COMFY_CLOUD_API_KEY` in `apps/worker/.env.local` himself (never
  pasted in chat, never logged).
- Check first, with the key: which YuE2 and ACE-Step 1.5 checkpoints and nodes the cloud offers
  (`/api/object_info`, model endpoints) and the credits one two-take song uses; record in a short
  `comfy-cloud-check.md`.
- Runtime choice per local engine: "PC locale" or "Comfy Cloud", in the engine selector (admin
  only), with cost shown in cloud credits and minutes; the adapter gets a runtime abstraction
  (base URL, auth header, status endpoint, output download through the redirect, no supervisor
  for cloud); two takes in parallel on cloud; same idempotency (our prompt ids, recovery through
  the status endpoint) and the same watchdog; never falls back to kie or between runtimes
  silently.
- Cloud allows the larger variants (YuE2 BF16, ACE-Step XL if offered): expose them only after a
  short listening check like the bake-off.
- YuE2 stays owner-only on cloud too (license).

## From the owner's YouTube channel (E:/mellodifai/research/channel/channel-report.md, 2026-11-01)

- T13 additions: a "MellodifAI Classico" preset reproducing the channel's house template (night
  city background with slow loop, one full-width audio-reactive waveform line at about 72% height,
  red play badge with teal glow top centre, centred caps text STEFANDSL.COM or SONG / by
  AIMELODIA / ALBUM with a legibility backdrop, red trumpet player left, gramophone top right,
  lyric subtitles bottom left, intro card "AIMELODIA PRESENTS", subscribe card about 1:30, end
  card); true full-frame 9:16 Shorts (no letterboxed 16:9).
- T15 (new) Brand kit and publishing: Settings > Brand (artist name, website, email, logos, brand
  red, default album, hashtags, call-to-action lines) applied to videos, thumbnails and YouTube
  metadata; albums mapped to YouTube playlists; description and tag templates per type (music
  video, remix, jingle) with a checker (e.g. a stray "Durata: 2:18" line creates a chapter; tags
  missing); thumbnail generator in two styles (template frame, poster with big title).
- T16 (new) Jingle mode for local businesses: business name sung in the chorus, slogan at the end,
  30 s and 15 s cuts, logo end card.
- Remix credits and a fair-use notice belong to T12 (cover/remix).
- Kept from the May 2025 prototype for later: Google sign-in, Stripe subscription screen.

## Owner requests 2026-11-01 (evening)

- T12 additions: "Riscrivi una parte" on the song page and in the editor: select a range on the
  waveform, edit only the lyrics of that range, regenerate it. kie `replace-section`
  (`infillStartS`, `infillEndS`, `fullLyrics`, optional segment lyrics; cost shown before
  confirm, needs the kie task and audio ids of the take) and ACE-Step repaint locally if the
  installed nodes support it. Result is a new take next to the old one for A/B listening.
- T12 additions: "Importa da Suno": drop the MP3/WAV files downloaded from the owner's suno.com
  account (plus title, style and lyrics pasted, or transcribed), or paste the song's share link;
  the song lands in the library and goes into the normal video pipeline. No browser automation
  of suno.com: its terms forbid robots and scraping, and an automated account risks a ban.
- T17 (new) Creative Commons adaptation: source track URL, author and licence recorded per song;
  the app blocks ND licences, keeps SA songs under the same licence, flags NC licences before
  YouTube monetisation, and writes the attribution into the YouTube description automatically.
  Translation keeps syllable count, stresses and rhyme per line (lyric jury scores singability),
  then a cover of the source melody with the new lyrics (kie upload-cover or ACE-Step cover).
- T18 (new) Local images: Z-Image Turbo (6B, Apache 2.0) in the existing ComfyUI on the PC for
  thumbnail and video backgrounds; titles are drawn by our own templates, not by the model;
  Comfy Cloud for larger models once T14 is in.
- T19 (new) Automatic sharing to social platforms, Blotato style: one "Pubblica ovunque" step
  after the video (YouTube already works; add TikTok, Instagram Reels, Facebook, X, Threads,
  LinkedIn), per-platform captions and 9:16 cut, schedule, per-platform auto-post switch. Route
  through either the Blotato API (owner's account) or a self-hosted Postiz in Docker; owner to
  choose.

## Owner decisions 2026-11-01 (late evening)

- T12 "Riscrivi una parte": same UI and behaviour as Suno's Replace Section (select a range on
  the waveform, the matching lyric lines highlight and become editable, generate alternatives
  for that range, audition each in context, keep one, the rest of the song untouched). Owner
  confirmed "Importa da Suno" (manual download plus drop or share link).
- T17 replaces the CC-only scope: "Adatta in un'altra lingua" for any song, three modes in the
  UI: (1) "Nuova canzone" (default): theme, story and emotion re-written from scratch in the
  target language with cultural and anthropological adaptation for a chosen country/region
  (places, idioms, customs, references, register, local genre conventions) and a new melody
  (the source audio is never sent to the generator); an originality check compares the new
  lyrics with the source line by line and warns on close paraphrase. (2) "Adattamento fedele":
  translated lyrics on the original melody, only when the owner states the right to do it (own
  song, public domain, CC BY / BY-SA with attribution). (3) "Cover" of a song the owner has the
  right to cover. The UI shows source and adaptation side by side with per-line cultural notes,
  an adaptation-strength slider (Fedele to Libera) and the licence state.
  Legal note given to the owner: a cover or translated cover of a copyrighted song is not a
  licence workaround (it needs the publisher's licence and Content ID claims it); only mode (1)
  avoids that, because only the idea is kept.
- T18 images: run a bake-off on the PC of the current local models that render text well
  (Z-Image Turbo and the newer open models available today; check licences), same thumbnail
  prompts, jury scoring; plus "OpenAI" as an image source: the owner's Codex/ChatGPT
  subscription through `codex exec` on the PC (owner only), and for other users their own OpenAI
  API key in Settings (stored server-side, never shown again), since OpenAI offers no way for an
  app to use a customer's ChatGPT plan.
- T19 publishing: Postiz self-hosted in Docker is the default free route; Blotato API is the paid
  fast route; YouTube keeps its direct API. In the publish step each platform has a route choice
  (Diretto / Postiz gratis / Blotato veloce) with a default in Settings, plus Blotato as an
  automatic fallback when a Postiz post fails, if the owner enables it.

## Owner requests 2026-11-01 (night)

- T11b (new) UVR-quality vocal removal: headless separation with the UVR model family (GUI code
  MIT, models need credit to UVR; check each model's own terms) through a CLI wrapper on the PC,
  as a "Rimuovi voce (alta qualità)" option next to Demucs stems; output a clean instrumental and
  an a cappella. Used by T17/T20.
- T20 (new) New vocals on an instrumental ("base"): instrumental from T11b, new lyrics from T17,
  then a generator that sings on it. Candidates: Mureka API (official, paid, commercial rights on
  paid plans), ElevenLabs Music API (official, commercially cleared; section inpainting is
  Enterprise only), kie.ai endpoints for uploaded audio (verify which exist), ACE-Step locally.
  Riffusion/Producer has no official API (third-party wrappers only): take its ideas, not its
  API. Research Riffusion/Producer features missing from Suno and implement the useful ones with
  our engines.
- T21 (new) Audacity-style effects without Audacity code (Audacity is GPLv3 for binaries,
  most files GPLv2+; copying it into the web app would make the shipped app GPL): noise
  reduction, compressor, EQ, loudness to a LUFS target, silence trim, pitch and tempo, reverb,
  via ffmpeg filters on the worker or our own DSP in the editor.
- Going public checklist (owner asked to think ahead; app stays private for now): YuE2 is
  non-commercial; kie.ai is an unofficial Suno reseller; images through the owner's ChatGPT
  subscription are personal use only (users bring an API key); Remotion is free up to 3 people,
  company licence beyond; Postiz is AGPL (fine as a separate unmodified service); UVR credits.
- YouTube: check whether the owner's Google Cloud project has passed the YouTube API audit; until
  it does, API uploads are forced private. Route public YouTube uploads through Blotato (its
  verified app) until the audit passes, and prepare the audit (privacy policy, terms, demo).
  Watch YouTube monetisation rules on mass-produced content: vary visuals per song.

## From the owner's Horizons prototypes (E:/mellodifai/research/horizons-*, May 2025, mock data only)

- T22 (new) Topic research before lyrics: an optional "Ricerca" step that gathers verified facts,
  local references and vocabulary about the topic (web search with sources), shown to the owner
  as "Spunti" with links and fed to the lyric writer; also used by T17 for the target culture.
- Later (kept): Google and Microsoft sign-in (Supabase OAuth; owner creates the OAuth clients);
  subscription screen with Stripe only if the app goes public.
