# Task 13 report: Video Studio with live preview and visualizer render

Branch `build/studio-ui`. Commits:

- `1fedd64` test(db): customer preview read test uses the previews/<owner>/ layout of migration 21
- `94c3050` feat: visualizer videos rendered on the PC from the Video Studio's parameters (T13)
- `1dd3934` feat(web): Video Studio with live preview, from the song card, details panel, Video page and Create (T13)
- `feaaac5` fix(shared): Classico 9:16 keeps the ruler clear of the intro card

## What was built

### One parameter set, one renderer (packages/shared/src/visualizer)

- `viz-params.ts`: `VisualizerParams` (zod) exactly as item G lists it: `preset`, `aspect`,
  `background {mode: random|image|video, seed, assetUrl, dimming 0-100}`, `colors {primary,
  secondary}`, `particles 0-100`, `centerImage {mode: cover|upload|none}`, `textLayers [{text, x,
  y, size, color}]`, `effects [{id, enabled, intensity 0-100}]`, plus `centerImage.assetUrl` and a
  `classico` block (artist, website, album, gramophone red/black, cards) for the channel preset.
  Strict schema for the server and worker, a field-by-field `normalizeVisualizerParams` for
  localStorage and old rows. Ten colour presets (the first, "MellodifAI", from the brand red
  `#f2333d` and the badge's teal glow), stock list, upload limits.
- `viz-audio.ts`: the render PC has no Web Audio, so `frequencyBytes`/`timeBytes` reproduce
  `getByteFrequencyData`/`getByteTimeDomainData` from samples per the Web Audio spec (Blackman
  window, radix-2 FFT, |X|/N, dB, bytes between -100 and -30 dB). Bands (64, log spaced), the
  waveform (oscilloscope-triggered so it stands still and matches in both places), time-based
  smoothing (same envelope at 60 fps preview and 30 fps render), bass level, and `analyseSong`,
  which the worker writes per frame.
- `viz-draw.ts`: `createVisualizerRenderer(makeCanvas)(ctx, scene)` draws a whole frame on a 2D
  canvas: background (stock picture, upload, video frame or cover, slow drift) with dimming,
  particles (a pure function of time), the preset, text layers, then the effects in order. Grain
  and glitch are seeded by the frame number, so the preview and the render draw the same noise.
- Presets: MellodifAI Classico, Cerchio (spectrum ring round the cover, the NCS look), Spettro,
  Specchio, Onda, Particelle, Minimale. Effects: grana, VHS, linee di scansione, vignettatura,
  aberrazione cromatica (true red/cyan channel split), glitch; each with intensity, stackable.
- MellodifAI Classico (channel-report.md section 3): full-width mirrored glow waveform at 72%,
  red play badge with teal glow at 13%, text stack in one order (`SONG: TITLE` / `by ARTIST` /
  `ALBUM` / website) on a legibility plate, red trumpet player left, gramophone top right (red or
  black), a tick ruler whose red marker moves with the song, intro lower third `ARTIST / PRESENTS`
  with the gold bar (first 5 s), `SUBSCRIBE` callout with purple bars beside the badge at 1:30
  (45% of shorter songs), end card in the last 6 s. Choosing it brings the channel's blue to
  magenta colours. 9:16 is a real full-frame layout (badge, stack, marks, wave and ruler placed
  again for the tall frame; long titles shrink, then wrap), never a letterboxed 16:9.

### Render on the PC (packages/visualizer, apps/worker)

- `packages/visualizer`: Remotion 4.0.535 (the engine repo's version) composition `Visualizer`
  that draws the same renderer on a `<canvas>` per frame, from the analysis file, with
  `<OffthreadVideo onVideoFrame>` feeding a looping background video into the canvas.
  `scripts/render.mjs` runs the CLI with temp files on E:, `--gl=angle`, and reuses the engine
  repo's Chrome Headless Shell (no second download on C:).
- Worker stage `visualizer` (on demand, in `STAGES`, `ON_DEMAND_STAGES`, the stage index and the
  render lock): reads the render row and validates its params, takes the chosen take's audio,
  decodes it at 48 kHz, writes the per-frame analysis, fetches the stock picture / uploads / cover
  and brand marks, renders, makes a delivery copy under 45 MB (the bucket holds 1 GB in all),
  a poster frame, uploads both and stores `preview_path`; the full-quality master stays on E:.
  Progress messages for the timeline: "Video: preparo l'audio", "analizzo l'audio", "preparo le
  immagini", "rendering N%", "preparo il file da scaricare", "caricamento", "Video pronto".
  Authorization accepts the song's own visualizer render id; the preview cleanup never deletes
  visualizer files when a lyric video moves to a new render attempt. The fake worker has the
  stage too.

### Database (migration 20261101000022_visualizer)

- `jobs` stage `visualizer`; `renders.kind` `visualizer` with `renders.aspect` and
  `renders.visualizer_params` (shape check; one row per song and aspect).
- `request_visualizer(version, params)`: chosen take with audio required (same statuses as
  stems), validates aspect and every uploaded asset (caller's folder, exists, picture up to 10 MB
  or video up to 100 MB), stores the params on the render row and queues the job; a waiting job
  keeps its place with the new look, a finished or failed one is queued again (Riprova and
  re-renders), a running one is refused.
- `my_visualizer_queue()` for "In coda #N"; `my_queue_positions` leaves on-demand stages out.
- Private bucket `uploads` (100 MB, pictures and videos only) with owner-folder policies and a
  readable `stock/` folder; `/media/uploads/...` signs from it.

### Web

- `VideoStudio` modal (`components/studio/video/`), one component for every entry point: header
  with the song, tabs **Preset | Stile | Testo | Effetti**, live preview on the right (on top on a
  phone, full height), 16:9 / 9:16 Shorts switch, round play/pause driving the shared player.
  - Preset: tiles with icon and hint; a click redraws the preview at once while the song plays.
  - Stile: Casuale / Immagine / Video (Casuale re-rolls on each click and with "Un'altra
    immagine"; Immagine and Video upload with type and size checks, without a file the cover is
    used), Oscuramento, 10 swatches, primary/secondary colour pickers with hex fields,
    Particelle, centre image Copertina / Caricata / Nessuna with upload and Ripristina.
  - Testo: Classico lines (artist, album, website, gramophone colour, cards switch) while
    Classico is chosen; text layers (add up to 6, text, X/Y, size, colour, delete).
  - Effetti: six cards, switch plus Intensità.
  - Footer: "Renderizza video (MP4)" turns into "In coda #N" / "Rendering 42%" with a progress
    fill; "Ultimo video 16:9" downloads the last render; a failed render shows its reason.
- Live preview: the player's single `<audio>` (now `crossOrigin="anonymous"`) is tapped once
  through `createMediaElementSource` (lib/studio/visualizer/audio-tap.ts, kept for the page's
  life), so the song keeps playing while looks change and the studio can close and reopen.
- `VisualizerWatcher` (in the shell) follows renders started in this browser anywhere in the app:
  toast "Video pronto" with **Scarica**, or the reason with **Riprova**.
- Last look remembered in localStorage; a song opens with the look of its last render of that
  aspect (the `visualizer_params` column), so re-renders reuse it.

## Entry points

- Song card: clapperboard button (list and grid; a dot while a render is on its way) and menu
  item "Crea video visualizer".
- Details panel tool strip: "Crea video visualizer".
- Create panel, Video card: mode **No | Video con testo | Visualizer**; Visualizer shows the
  remembered look and "Apri Video Studio" (setup mode: same studio, preview with whatever plays,
  footer "Usa questo look"). Songs created this way get "Crea video visualizer" as the first
  choice when their take is picked (keep audio plus queue the visualizer with that look).
- Sidebar "Video" (`/library?tab=videos`): every song with audio, its lyric video and
  visualizers inline (play, download, live render state), and "Apri Video Studio" per song. The
  library's "Con video" filter and the "VIDEO PRONTO" badge count visualizers too.

## Tests

- Shared: 67 (params, analyser emulation against a DFT and the spec's byte mapping, smoothing
  rate independence, every preset and aspect, effects and intensity, particles, Classico layout,
  cards and text wrapping).
- Visualizer package: 10, the item G snapshot test: frame 75 of every preset (plus Classico 9:16
  and Spettro with four effects) rendered by the Remotion composition against the same frame from
  the preview path in Chrome (a real `AnalyserNode` on the same samples read by the studio's own
  `readAnalyser`, then the shared renderer); mean difference under 4/255 and under 2% of pixels
  off by more than 48; plus a negative control that must fail the tolerance.
- Worker: 252 (+2 skipped), 8 new for the stage (props, uploads and cover fallbacks, progress,
  failure, bad params, cleanup, authorization, delivery bitrate).
- Web: 642 across 70 files, new: studio controls (every tab and control, render queue and
  progress, failure, setup), entry points (card button and menu, filter, Video page, Create card,
  take picker), audio tap, live frame, pictures, uploads, visualizersOf, /media uploads bucket.
- Database: 110 (7 new: request_visualizer, asset ownership and limits, queue, shapes, bucket
  policies). The pre-existing failure "allows customers to read only their own preview paths"
  (broken by migration 21's previews/<owner>/ layout) was fixed in `1fedd64`.
- `biome check` clean on all committed files; `tsc -b` (shared, worker), web `tsc --noEmit`,
  visualizer `tsc --noEmit` clean.

## End-to-end evidence (test account song "Civico tredici, via dei Lampioni", 6:13)

- Rendered from the studio UI on the real worker: 16:9 Cerchio on a Casuale background (job
  16:47:03 to 16:55:34, render 5 min plus the delivery copy) and 9:16 MellodifAI Classico with
  vignette (17:11:19 to 17:15:46, rendered again after the last layout fix), each downloaded through the app's Scarica link: 1920x1080 and
  1080x1920, 30 fps, AAC audio, about 41 MB.
- Preview against video: `E:/mellodifai/ops/vs-compare.mjs` plays the song in the studio, grabs
  the preview canvas with the audio time, extracts the video frame at that time and compares:
  16:9 mean 3.0 to 4.6/255 (1.2 to 2.9% of pixels off by more than 48), 9:16 Classico mean 3.2 to
  3.4/255 (1.7 to 1.9%). The differences are bar heights from the live analyser's timing.
  Shots: `compare-16x9-preview-vs-render.png`, `compare-9x16-classico-preview-vs-render.png`
  (preview left or top, video right or bottom).
- A looping background video was rendered through the CLI with a test pattern
  (`video-background-loop.png`: the clip's frame counter repeats every 3 s).
- Screens checked at 1440x900, 1360x600 and 390x844, dark and light (shots folder). Fixed along
  the way: swatches too big at 1360x600, size field that could not be typed, Classico title cut
  in 9:16, ruler colliding with the trumpet and then with the intro card in 9:16.

## Departures from the spec, with reasons

- `assetUrl` holds the stable app link `/media/uploads/<path>`, never a signed storage URL (they
  expire); the worker reads the path from it.
- Presets: the six of T13 with Cerchio and Specchio as the circle and mirror presets, plus
  MellodifAI Classico (seven). Read "plus Cerchio and Specchio" as naming those two.
- Classico's burned-in lyric subtitles are not drawn: T13 visualizers are "without lyrics" and
  have no word timing for audio-only songs; synced lyrics stay the lyric video's job. The rest of
  the template is there.
- "Casuale" draws from twelve backgrounds made for this app (procedural, so royalty-free by
  construction: night city, bokeh, aurora, synthwave, dusk sea, nebula, moonlit mountains, neon
  tunnel, stage beams, rainy lights, desert road, warm orbs), not stock photos. A deploy uploads
  them once with `apps/worker/scripts/visualizer-stock.ts` (README updated).
- The 9:16 Short is the whole song in a tall layout; cutting it to the chorus (about 30 s) is not
  in this task.
- Renders are kept under 45 MB for the 1 GB bucket, so a long song (6 min) gets about 0.7 Mbit/s
  in the stored copy; the full-quality master stays on E: next to the lyric video's.

## Left open

- Local Supabase still runs with the old global 50 MB upload limit; `supabase/config.toml` now
  says 100 MiB, which applies after `supabase stop && supabase start` (not done, the owner was
  using the stack). Until then video backgrounds over 50 MB fail to upload locally. A hosted free
  project caps uploads at 50 MB whatever the bucket says.
- Uploaded files are not cleaned up when replaced (they stay in the owner's folder).
- Brand kit (T15) will feed artist, website and album; today they are fields in the studio.
