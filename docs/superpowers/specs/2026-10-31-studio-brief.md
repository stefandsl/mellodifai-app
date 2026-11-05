# mellodifai v2 studio brief (user input, 31/10/2026)

This is the user's build brief for v2, kept verbatim below the line. `{{APP_NAME}}` is mellodifai.
It supersedes plan 2 ("any topic, new look") of `2026-10-31-mellodifai-design.md` and builds on the
v1 platform already in this repo.

## The user's decisions on conflicts with v1 (31/10/2026)

1. **Rendering:** the user's PC renders now (free, GPU), behind the brief's `Renderer` adapter. When the
   PC worker is offline, the app falls back to kie's quick video (`/api/v1/mp4/generate`). Cloud
   rendering (Docker on Railway/Fly or Remotion Lambda) comes later, when paying customers arrive,
   without a rewrite.
2. **Look:** the brief's layout, ergonomics and dark theme, with the MellodifAI brand: red square logo,
   red accent instead of the brief's pink/orange. Readable labels in every theme.
3. **v1 admin flow:** kept as an admin-only extra. Users get the brief's automatic flow; only the admin
   sees "Publish on YouTube" on a song (v1 privacy and quota checks). The imported VBP project stays in
   the library.
4. **Sign-in (earlier, same day):** Google and Microsoft OAuth plus email; a new user waits on an
   approval page until the admin enables them.

---

# BUILD PROMPT — AI Song + Music-Video Studio (Suno-style UX, Next.js + Supabase + Vercel, audio via KIE.ai Suno API)

> Paste everything below this line into your coding agent (Claude Code, Cursor, etc.).
> Placeholders: `{{APP_NAME}}` = your product name. Do not use the Suno name, logo or brand assets anywhere in the product.

---

## 0. Role, goal, non-goals

You are a senior full-stack engineer. Build `{{APP_NAME}}`, a web app where a user describes a song, gets two generated variants of it, and — in the same action — gets a music video for each variant. The UX must feel like Suno's `/create` page (three-panel layout, Simple/Advanced form, live feed of generating clips, persistent bottom player), extended with a first-class **Video** step that runs in parallel with audio generation.

**Scope (core only):**
- Create form: Simple + Advanced modes, model selector, lyrics editor with AI cowriter, styles with suggestion chips, More Options (exclude styles, vocal gender, duration, weirdness, style influence, variety), title, instrumental via empty lyrics.
- Video options block inside the same form (4 modes: Lyric/Visualizer, AI clips per section, Image slideshow / Ken Burns, User footage).
- Workspace feed of clips grouped by date, list/grid view, search, sort, filters, generating-state cards, card actions (play, like/dislike, share, download audio/video, rename, reuse prompt, details, move to trash).
- Song detail page with artwork, metadata, lyrics with section tags, and the video player.
- Bottom player bar with queue, shuffle/repeat, progress, volume, mini video.
- Library (all clips, liked, trash) and credits.

**Explicitly out of scope (leave UI hooks, feature-flagged off):** remix tools (extend/cover/crop/stems/remaster/replace section), personas/voices, custom models, publishing/social/explore, playlists, comments, Speech and Sounds tabs, Studio/DAW.

**Stack (fixed):** Next.js 15 App Router + TypeScript, Tailwind CSS, shadcn/ui, Supabase (Postgres, Auth, Storage, Realtime, pgmq queue), Vercel hosting. Audio generation through **KIE.ai Suno API** (`https://api.kie.ai`, Bearer key, server-side only). Video rendering through a separate **render worker** (Node + FFmpeg + Remotion, Dockerized, on Railway/Fly.io, or Remotion Lambda) with **KIE's `/api/v1/mp4/generate` as the zero-infra fallback**.

---

## 1. Reference UI — what Suno's create page looks like (observed Oct 2026) and the tokens to replicate

### 1.1 Layout (desktop ≥1280px)

Three vertical panels on a near-black canvas plus a fixed bottom bar:

```
┌──────────┬──────────────────────┬─────────────────────────────────────┐
│ Sidebar  │  CREATE PANEL        │  WORKSPACE FEED                     │
│ ~215px   │  450px fixed         │  flex-1                             │
│          │  radius 12, own      │  header: Workspaces › My Workspace  │
│ Home     │  scroll              │  toolbar: search · Filters(n) ·     │
│ Explore  │                      │           New ▾ · List/Grid         │
│ Create ● │  [Songs|Speech|Sounds│  date heading                       │
│ Studio   │  [Simple|Advanced] v6│  ┌ clip card ─────────────────────┐ │
│ Library  │  + Audio +Voice +Img │  │ art  title · v6   ...          │ │
│ profile  │  ┌ prompt / lyrics ┐ │  │ 84px style line                │ │
│          │  │                 │ │  │      👍 👎 Share Publish Remix │ │
│ Credits  │  └─────────────────┘ │  └────────────────────────────────┘ │
│ Labs     │  ┌ styles ─────────┐ │  ┌ clip card ─────────────────────┐ │
│ Notifs   │  └─────────────────┘ │  …                                  │
│ More     │  › More Options      │                                     │
│ Upgrade  │  Title (Optional)    │                                     │
│          │  Save to… Workspace  │                                     │
│          │  [🗑] [  ♪ Create  ] │                                     │
├──────────┴──────────────────────┴─────────────────────────────────────┤
│ art title/author   ⇄ ⏮ ▶ ⏭ ↻   ───────●──────── 0:00/3:04  ≡ 👍 👎 💬 ↗ ⋮ 🔊 ⓘ │
└───────────────────────────────────────────────────────────────────────┘
```

Responsive: ≥1280 three columns; 900–1279 sidebar collapses to icons, create panel 420px, feed flex; <900 single column — feed is the main page, the Create form opens as a full-height bottom sheet from a floating "Create" pill, player bar stays fixed.

### 1.2 Design tokens (backgrounds, text, radii, sizes and fonts measured from the live page's computed styles; the pink/orange accent hex values are eyeballed from screenshots — tune them by eye; use everything as CSS variables)

| Token             | Value                                                                                                                           | Where                                                                        |
| ----------------- | ------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------- |
| `--bg`            | `#101012` (rgb 16,16,18)                                                                                                        | body, create panel                                                           |
| `--surface-1`     | `#1C1C1F`                                                                                                                       | cards inside create panel (lyrics/styles/options)                            |
| `--surface-2`     | `#252529`                                                                                                                       | icon buttons, pills, chips, inputs                                           |
| `--surface-glass` | `rgba(255,255,255,0.04)`                                                                                                        | prompt box, feed cards at rest; hover `rgba(255,255,255,0.10)`               |
| `--fg`            | `#F7F4EF` (warm off-white, not pure white)                                                                                      | all primary text                                                             |
| `--fg-muted`      | `rgba(247,244,239,0.55)`                                                                                                        | placeholders, style lines, timestamps                                        |
| `--accent-pink`   | `#FF2D8A`                                                                                                                       | slider thumbs, model badge "v6", toggles ON                                  |
| `--accent-orange` | `#FF6A2B`                                                                                                                       | cowriter generate button                                                     |
| `--cta-gradient`  | horizontal "aura": `linear-gradient(90deg,#FF7A1A 0%,#FF3D8E 45%,#FF6A2B 100%)` with soft grain                                 | the Create button only                                                       |
| `--danger`        | `#E5484D`                                                                                                                       | trash hover, failed states                                                   |
| Radius            | pills/buttons `9999px`; prompt box `16px`; feed card `20px`; panels `12px`; artwork `8px`                                       |                                                                              |
| Font              | `"Neue Montreal", system-ui, -apple-system, "Segoe UI", Roboto, sans-serif` → use **Inter** or **Geist** as the free substitute | base 14px, tabs 16px/400, CTA 17px/500, nav 14px/500, detail title ~40px/500 |
| Icon button       | 32×32 circle, `--surface-2`, icon 16px                                                                                          | like/dislike/share/more                                                      |
| Create button     | full-width pill, 48px tall, gradient, music-note icon + "Create"                                                                | disabled = `--surface-2` with muted text                                     |

Dark theme only (Suno is dark-only); still define tokens on `:root` so a light theme can be added later.

### 1.3 Navigation (left sidebar)

Logo top-left, collapse button. Items with 20px icons: Home, Explore, **Create** (active = filled pill `--surface-glass`), Studio, Library, profile row (avatar + handle), separator, Earn Credits, Labs, Notifications, More, and an "Upgrade" link at the bottom. For `{{APP_NAME}}` keep: Home, Create, Library, Videos, Credits, Settings; hide the rest behind flags.

---

## 2. Create panel — exact behaviour to replicate

### 2.1 Panel header

- Tablist "What to create": **Songs** | Speech | Sounds — underline indicator on the active tab. Implement Songs; render Speech and Sounds as disabled tabs with a "Soon" badge (flag `FEATURE_SPEECH`, `FEATURE_SOUNDS`).
- Row below: segmented pill **Simple | Advanced** on the left, **model selector** on the right (`v6 ▾`, compact pill).
- Model selector dropdown (observed): a highlighted header card "Create Custom Model · Beta — Create a model based on your uploads (100 Credits) [+]" (render disabled), then "ALL MODELS" list; each row = name + optional `Pro` badge + one-line description + check on the selected one:
  - `v6` Pro — "Powerful. Versatile. Refined. Our best model yet." (default)
  - `v6-wild` Pro — "Best for experimental ideas."
  - `v6-mini` — "A free, more efficient version of premium v6 models."
    Map to KIE `model`: `V6`, `V6_WILD`, `V6_MINI`. Also expose `V5`, `V4_5PLUS`, `V4_5` under a collapsed "Older models" group.

### 2.2 Simple mode

- Attachment row of three equal buttons: **+ Audio**, **+ Voice**, **+ Image**.
  - Audio → popover: Browse (pick from your clips), Upload, Record.
  - Voice → modal "Voice": tabs My Voices | Favorites, search, highlighted "Create Voice · New — Record or upload your voice" row, empty state "No Voices — Voices let you create songs that have a similar style and voice." (render the modal, flag the creation off).
  - Image → file picker (up to 5 images, 10 MB each → KIE `imageUrls`).
- Prompt box (`--surface-glass`, radius 16, min-height 150px): a textarea with an **animated rotating placeholder** cycling through examples every ~4s with a fade ("Melodic chillwave song about a broken mirror", "Grand 2-step song about walking away for good", "Light russian pop song about escapism", "Singer-songwriter song about hookups at parties", "…rap song about falling for the wrong person"). Max 500 chars (KIE non-custom limit) with a counter that appears at 400+.
- Bottom-left "+" **Add** button → menu: Lyrics › (Write new / Use existing), Styles › (Write new / Use existing), Playlist, Image, Video, Audio › , Voice ›. Choosing Lyrics/Styles "Write new" switches to Advanced with that card focused; "Use existing" opens the saved-lyrics / saved-styles library.
- Attached items render as removable chips above the textarea (artwork thumb + name + ×).
- Drag-and-drop overlays on the panel: "Drop to attach" (files), "Drop here to remix" (a clip card dragged from the feed), "Drop here for inspiration".
- Full-width gradient **Create** button (48px). In Simple mode it is always enabled when prompt or any attachment exists.

### 2.3 Advanced mode

Attachment row becomes **+ Audio**, **+ Voice**, **+ Inspo** (inspiration from a playlist — render, flag off). Then a vertical stack of collapsible cards (`--surface-1`, radius 16, 16px padding, chevron on the left of the card title):

**Lyrics card**
- Header: "Lyrics" + toolbar on the right: Undo, Redo, New draft, Saved lyrics (library icon), Open full-screen editor (expand icon).
- Body: rich textarea, placeholder "Start writing lyrics, or leave this empty for instrumental", counter `0/5000`. Section tags like `[Verse 1]`, `[Pre-Chorus]`, `[Chorus]`, `[Bridge]`, `[Final Chorus]`, `[Outro]` are auto-highlighted (muted colour, monospace-ish) and a `/` or `[` shortcut offers tag completion.
- Empty lyrics ⇒ the request is sent as `instrumental: true`; show a small "Instrumental" hint next to the counter when empty.
- Floating sparkle button bottom-centre of the card opens the **cowriter popover** anchored inside the card: a "+ Lyricist" chip (flag off — tooltip "Create your own lyricist: add examples of your lyrics and create new lyrics with the same vibe"), a horizontally scrollable row of suggestion chips ("Write a rap verse", "Write a power ballad", "Write an indie hit", "Write a punk anthem", "Write a dance track about partying", "Write an R&B ballad") with ‹ › arrows, a one-line prompt input whose placeholder echoes the current suggestion (Tab accepts it), an orange circular submit arrow, and a × to close. Submitting calls our `/api/lyrics` (KIE `/api/v1/lyrics`), shows a skeleton, and returns 2–3 variants as cards (title + first lines) with "Use" and "Insert below" actions.

**Styles card**
- Header "Styles" + saved-styles icon.
- Textarea placeholder rotates examples ("big room house, 808 beats, call and response, natural vocals, bass-house"), counter `0/1000`.
- Below: a round **wand** button (accent) "Personalize style prompt to match your taste" → calls `/api/style/boost` (KIE `/api/v1/style/generate`, body `{content}`) and replaces/extends the text with a loading shimmer; a **refresh** button "Refresh recommended styles"; then a single-row horizontal scroller of pill chips, each `aria-label="Add style: {name}"`, clicking appends `, name` to the textarea and marks the chip selected. Seed chips: big room house, 808 beats, call and response, natural vocals, bass-house, rhythmic synth lines, tech trance, emo punk rock, rhythm & blues, low bass, sharp snares, sentimental, tenor male vocals, techno rock, soft, smooth jazz, lo-fi, spacey, cinematic, acoustic folk.

**Video card** (our addition — see §6 for behaviour; it sits between Styles and More Options and is expanded by default).

**More Options card** (collapsed by default; a trash icon in its header resets only this card)
- "Exclude styles" input (→ `negativeTags`).
- Rows with label + ⓘ tooltip on the left and a two-state segmented control on the right:
  - **Vocal Gender**: Male | Female (neither selected by default; selecting again deselects) → `vocalGender: "m" | "f"`.
  - **Duration**: Custom | **Auto** (default Auto). Custom reveals a slider 0:10–6:00 → `duration` seconds (10–360). Tooltip: "Target length; the model treats it as a hint."
  - **Max Mode**: Off | On (no API equivalent → keep UI, flag off, tooltip "Coming soon").
- Three tick sliders (11 ticks, pink thumb, label on the left, value on the right, a descriptive caption appears on hover):
  - **Weirdness** 0–100%, default 50% ("Expected results" at ≤50, "Experimental" above) → `weirdnessConstraint` 0–1.
  - **Style Influence** 0–100%, default 50% ("Moderate") → `styleWeight` 0–1.
  - **Variety** shown as a tick slider with a word value (default **Normal**, caption "Balanced variety", tooltip "Clips have slight style variation") → quantise to KIE `variety` 0–4 (Minimal, Low, Normal, High, Max).
- **Personalize**: "My Taste" | Off (flag off).

**Song Title (Optional)** — single input with a music-note icon, max 80 chars → `title`.
**Save to…** row with a folder icon and the current workspace as a pill button → `workspace_id`.

**Footer (sticky inside the panel):** round trash button "Clear all form inputs" (confirm if anything typed) + the Create button. In Advanced mode Create is **disabled until at least one of lyrics / styles / exclude-styles is filled** (KIE custom-mode rule). Show inline validation chips above the button when a limit is exceeded.

### 2.4 Form state

- One Zustand store `useCreateForm` persisted to `localStorage` per workspace (Suno keeps your draft when you navigate away).
- "Reuse prompt" from a card hydrates this store and switches to the right mode.
- Keyboard: `Cmd/Ctrl+Enter` submits.

---

## 3. Workspace feed (right panel)

### 3.1 Header & toolbar

- Breadcrumb `Workspaces › My Workspace` (clicking "Workspaces" opens a switcher), **Share** pill on the right (flag off).
- Toolbar: search input "Search" (debounced, searches title + style text), `Filters (n)` combobox (multi-select: Liked, Public, Uploads, Has video, Instrumental, Model), sort combobox `New` (newest, oldest, title, duration), view toggle **List | Grid**. Quick-filter pills row: Liked, Public, Uploads (we add **Videos**). Pagination controls (prev / page / next) at the bottom; page size 20.

### 3.2 Date grouping

Clips grouped under sticky headings formatted like "Thursday, Oct 15" (today → "Today", yesterday → "Yesterday").

### 3.3 Clip card — list view (110px tall, 12px padding, radius 20, transparent at rest, `--surface-glass` on hover/active)

Left → right:
- Select checkbox (visible on hover / when any selection exists; enables bulk Move to Trash / Download).
- 84×84 artwork with a centred play/pause overlay on hover and a duration badge bottom-right (`3:04`, dark pill). While generating: animated gradient placeholder + spinner.
- Title (one line, editable inline on click of a pencil that appears on hover — `aria-label="Edit title"`), followed by a small pink model badge `v6`.
- Second line: style text, muted, one line truncated.
- Status badges when relevant: `COVER`, `SECTION`, `CREDITS REFUNDED` — we add `VIDEO READY`, `VIDEO RENDERING 43%`, `VIDEO FAILED`.
- Action row: like, dislike (32px circles), **Share** pill, **Publish** pill (flag off), **Remix** pill (flag off), and on the far right a `…` **More options** circle.

Grid view: 2–4 columns, square artwork on top, title/model/style below, actions on hover. A clip with a ready video shows a tiny film icon on the artwork and hover-plays the muted video preview.

### 3.4 Generating state (critical to get right)

Clicking Create **immediately** inserts a new date group "Today" (if missing) with **two** placeholder cards at the top (Suno produces two variants per generation; KIE returns multiple `sunoData` items). Each placeholder shows the pending title (or "Untitled"), the style text, a shimmer artwork and a stage label that advances with the provider:
`Queued` → `Writing lyrics…` (KIE `text` / `TEXT_SUCCESS`) → `Composing…` with the play button enabled as soon as `stream_audio_url` exists (`first` / `FIRST_SUCCESS`) → final card with real artwork, title and duration (`complete` / `SUCCESS`). A parallel thin progress bar under the card shows the **video** stage (§6). On failure the card turns to a "Failed — credits refunded" badge with Retry.

### 3.5 More options menu (observed on Suno; implement the bold ones, render the rest disabled)

- Remix › Cover · Reuse Prompt · Mashup · Sample this song · Use as Inspiration · Voice — implement **Reuse Prompt** only.
- Edit › Extend · Crop · Remove Section · Reverse · Adjust Speed · Find a Collaborator · Fade In · Fade Out · Replace Section · Get Stems · Remaster · Open in Studio · Open in Editor — all flagged off.
- Publish (off) · **Share** (copies `/song/:id` link + Web Share API) · **Download** › Audio MP3 · Audio WAV (flag) · **Video MP4** · Cover image.
- Manage › **Song Details** · Create Cover Art (off) · Allow Remixes toggle (off) · Allow Comments toggle (off) · Pin to Profile (off) · **Move to Workspace**.
- **Add to Queue** · Add to Playlist (off) · Song Radio (off) · Report (off) · **Move to Trash**.
- We add: **Create video…** (if none) / **Regenerate video…** / **Open video**.

---

## 4. Song detail page `/song/[id]`

- Two-column header: 270×270 artwork on the left with hover overlay buttons **Edit** (cover) and **Download**; on the right the title as a large heading, author row (avatar + handle), the full style description paragraph with pencil (edit) and copy icons and a "– Show Summary" toggle that collapses to the first sentence, an "Add a Caption" placeholder, creation date + model badge (`15 ottobre 2026 alle ore 0:34 · v6` — use the user locale).
- Action row: play-count pill (`▶ 3`), comment, like, dislike, `…`, then on the right `+` (add to queue/playlist), share, and a large primary **Play** button.
- Our addition: a segmented control **Audio | Video** above the artwork; Video swaps the artwork for a 16:9 / 9:16 / 1:1 player (aspect from the render) with the lyric overlay burned in; a "Variants" strip lists every rendered video for this clip; a "Create another video" button opens the Video options sheet pre-filled.
- Below: lyrics rendered with section tags as muted headers, each line on its own row, a copy button top-right, and an **Edit displayed lyrics** button at the end. When word timings exist, the current word is highlighted during playback (karaoke mode toggle).

---

## 5. Bottom player bar (fixed, 72px, full width, `--bg` with top border)

- Left: 40px artwork, title (link to detail), author.
- Centre: shuffle, previous, play/pause (larger), next, repeat; below them a thin range slider with current time left and duration right. Keyboard: Space toggles, ←/→ seek 5s.
- Right: queue, like, dislike, comment (off), share, more, volume with mute, info (opens detail).
- Plays `stream_audio_url` while a clip is still generating and swaps seamlessly to the final mirrored MP3 on completion (keep `currentTime`).
- Our addition: when the current clip has a ready video, a film toggle shows a draggable **mini video** (picture-in-picture, 240px wide, bottom-right) in sync with the audio; clicking it opens the detail page in Video mode.
- Queue drawer (right side) lists upcoming clips with drag reorder.

---

## 6. Video creation — the differentiator ("a song AND a video from one Create click")

### 6.1 UX — the Video card in the create form

Present in both modes (in Simple mode as a compact row under the prompt box: toggle "Also create a video" + mode pill + aspect pill; "More…" expands the full card). Fields:

- **Mode** (segmented, icons): Off · **Lyric / Visualizer** (default) · AI clips · Slideshow · My footage.
- **Aspect**: 9:16 · 1:1 · **16:9**.
- **Visual prompt** (optional textarea, 300 chars): "Describe the look of the video". If empty, derive it automatically from the style prompt + lyrics (see 6.3).
- **Lyrics overlay**: On | Off; style preset (Kinetic, Subtitle, Karaoke); font preset; colour from cover-art palette (auto) or picker.
- Mode-specific options:
  - _Lyric / Visualizer_: theme — Aura (gradient blobs reacting to amplitude), Waveform, Particles, Minimal (artwork + text); intensity slider.
  - _AI clips_: provider (Kling 2.x / Google Veo / Higgsfield via the adapter), clips per section (1–3), clip length (5s/8s/10s), motion (Calm/Normal/Intense), "Keep a consistent character" toggle (passes a reference image across clips), content safety note.
  - _Slideshow_: source — Generate images (N per section, image provider) or Upload; transition (Cut / Crossfade / Whip); Ken Burns intensity; cut on beat toggle.
  - _My footage_: drop zone (mp4/mov/webm/jpg/png, ≤500 MB total), thumbnails with drag ordering, "Trim to beats" toggle, "Loop if too short" toggle.
- **Quick video fallback** (checkbox, on by default when the render worker is down): use the provider's own visualizer (KIE `POST /api/v1/mp4/generate`) — fastest, lowest cost, no lyric overlay customisation.
- Cost preview line: "This generation uses 10 credits for 2 songs + N credits for 2 videos".

The video settings are saved with the creation, so each of the two clip variants gets its own video with identical settings (the user can later regenerate just one).

### 6.2 Pipeline — run audio and visuals in parallel, assemble when audio is final

One Create click produces one `creations` row, two `clips` rows (placeholders) and two `videos` rows (status `queued`). Then:

1. **Audio job** → `POST https://api.kie.ai/api/v1/generate` with the mapped params (§10) and `callBackUrl = {APP_URL}/api/webhooks/kie/music/{creation_secret}`.
2. **Pre-generation of visuals starts immediately** — this is what makes the video feel simultaneous:
   - `text` callback (lyrics finalised, or immediately in Advanced mode where lyrics are user-written) → parse sections from `[Tags]` → build the **VideoPlan** skeleton (ordered sections, per-section visual prompt) → for _AI clips_ and _Slideshow (generate)_ modes, enqueue image/clip generation per section **now**, while the audio is still composing. For _Lyric/Visualizer_ nothing to pre-generate except the palette from the cover (`image_url` arrives with `first`).
   - `first` callback → `stream_audio_url` + `image_url` available → card becomes playable; extract palette from cover; start audio analysis on the stream (tempo/onsets) in the worker.
3. `complete` callback → for each clip: mirror `audio_url` and `image_url` into Supabase Storage (KIE files expire after 14 days), then call `POST /api/v1/generate/get-timestamped-lyrics` with `{taskId, audioId}` → store `alignedWords[] {word,startS,endS,success,palign}` and `waveformData[]`. Finalise the **VideoPlan** (exact section boundaries from word timings; beat grid from onset detection, with `waveformData` as fallback).
4. **Render job** per clip (worker):
   - _Lyric/Visualizer_: Remotion composition `<LyricVideo plan audioUrl cover palette theme aspect />` → MP4 H.264 + AAC, 30 fps, 1080p (1920×1080 / 1080×1080 / 1080×1920), `-movflags +faststart`.
   - _AI clips_: wait for the pre-generated clips (already done or finishing) → trim/loop each to its section length, FFmpeg concat with crossfades → mux the song → optional Remotion lyric overlay pass.
   - _Slideshow_: Remotion `<KenBurnsShow images beats />` with cuts snapped to the beat grid.
   - _My footage_: FFmpeg `scdet` scene detection on the uploads → cut list aligned to beats → concat → mux → overlay.
   - Produce `thumbnail.jpg` (frame at 25 %) and a 3-second muted `preview.mp4` for hover.
   - Upload to Storage bucket `videos/{user_id}/{clip_id}/{video_id}.mp4`, update `videos.status = ready`, `output_url`, `duration`, `width/height`.
5. **Quick fallback path**: if the worker is unavailable or the user picked "Quick video", call `POST https://api.kie.ai/api/v1/mp4/generate` `{taskId, audioId, callBackUrl, author: user.handle, domainName: APP_DOMAIN}` and finish on the `onMp4Generated` callback (`/api/webhooks/kie/mp4/{secret}`), mirroring the MP4 to Storage.

**Video state machine:** `queued → generating_assets → waiting_audio → analyzing → rendering → ready | failed` with `progress` 0–100 and `stage_message` shown under the card and in the detail page. Pre-generation can reach `waiting_audio` before the song is done; the user sees "Visuals ready — waiting for the song" on the card.

### 6.3 Auto visual prompt

When the user leaves the visual prompt empty, build it server-side (LLM call or deterministic template) from: style text (genre, mood, instruments), title, first chorus lines, and a camera/lighting vocabulary per genre (e.g. electro-pop → "neon-lit night city, glossy reflections, slow dolly, high contrast"). Produce one global prompt plus one per section (verse = calmer/wider, chorus = energetic/closer, bridge = contrasting palette). Store it on the `videos.options` so it can be edited and re-rendered.

### 6.4 Provider adapters (so engines can be swapped)

```ts
interface MusicProvider { generate(req): Promise<{taskId}>; getTask(taskId); timestampedLyrics(taskId, audioId); lyrics(prompt); boostStyle(content); quickVideo(taskId, audioId) }
interface ImageProvider { generate(prompt, {aspect, refImage?}): Promise<Asset> }
interface VideoClipProvider { textToVideo(prompt, {aspect, seconds, refImage?}): Promise<Asset>; imageToVideo(image, prompt, opts) }
interface Renderer { render(plan: VideoPlan, mode): Promise<RenderResult> }
```
Ship `KieSunoProvider` complete; ship one `VideoClipProvider` and one `ImageProvider` behind env vars with a `MockProvider` that returns stock assets so the whole flow is testable without spending credits.

---

## 7. Data model (Supabase Postgres, RLS on everything, `user_id` from `auth.uid()`)

```sql
profiles(id uuid pk → auth.users, handle text unique, avatar_url, credits int default 50, locale text default 'it', created_at)
workspaces(id, user_id, name, is_default bool, created_at)
creations(id, user_id, workspace_id, mode text check (mode in ('simple','advanced')), params jsonb,        -- the exact form snapshot
          provider text default 'kie', provider_task_id text unique, provider_status text,
          callback_secret text unique, credits_spent int, status text, error text, created_at)
clips(id, creation_id, user_id, workspace_id, provider_audio_id text, variant_index smallint,
      title text, style_text text, lyrics text, is_instrumental bool, model text,
      duration_s numeric, audio_url text, stream_audio_url text, audio_storage_path text,
      image_url text, image_storage_path text, palette jsonb, aligned_words jsonb, waveform jsonb,
      status text check (status in ('queued','text','streaming','ready','failed','refunded')),
      liked bool, disliked bool, play_count int default 0, trashed_at timestamptz, created_at)
videos(id, clip_id, user_id, mode text check (mode in ('visualizer','ai_clips','slideshow','footage','quick')),
       aspect text, options jsonb, plan jsonb, status text, progress smallint default 0, stage_message text,
       output_storage_path text, thumbnail_path text, preview_path text, duration_s numeric, width int, height int,
       provider_task_id text, error text, credits_spent int, created_at, updated_at)
video_assets(id, video_id, user_id, kind text check (kind in ('image','clip','footage','audio_analysis')),
             section_index smallint, prompt text, storage_path text, provider text, provider_task_id text,
             duration_s numeric, status text, sort_order int, created_at)
lyrics_drafts(id, user_id, title, body, source text check (source in ('user','cowriter')), created_at, updated_at)
style_presets(id, user_id null for global, text, is_favorite, created_at)
jobs(id, user_id, type text, ref_id uuid, payload jsonb, status text, attempts int, last_error text, run_after timestamptz, created_at)
credits_ledger(id, user_id, delta int, reason text, ref_type text, ref_id uuid, created_at)
webhook_events(id, provider, event_type, task_id, payload jsonb, received_at, processed_at, dedupe_key text unique)
```

- Enable **Realtime** on `clips` and `videos` (the feed and cards subscribe per workspace).
- Storage buckets: `covers`, `audio`, `uploads` (user footage/images/audio), `videos`, `video-assets`; all private, served through signed URLs (1 h) created server-side.
- Use `pgmq` (Supabase Queues) for `render_jobs` and `asset_jobs`; the worker consumes with visibility timeout and retries (3) and dead-letters to `jobs.status='failed'`.
- Indexes: `clips(workspace_id, created_at desc)`, `videos(clip_id)`, `creations(provider_task_id)`, `webhook_events(dedupe_key)`.

---

## 8. Server architecture (Next.js Route Handlers + worker)

**Env:** `KIE_API_KEY`, `APP_URL`, `APP_DOMAIN`, `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY` (server only), `RENDER_WORKER_URL`/`RENDER_WORKER_TOKEN`, `IMAGE_PROVIDER_*`, `VIDEO_PROVIDER_*`, `FEATURE_*` flags.

Routes (all validate with zod, all authenticated except webhooks):
- `POST /api/create` — validate limits (§10), compute cost, debit credits in a transaction (`credits_ledger`), insert `creations` + 2 `clips` + 2 `videos`, call KIE generate, store `provider_task_id`; on provider error refund and mark failed. Return the ids so the UI can render placeholders instantly (the UI already optimistically rendered them with a temp id — reconcile).
- `POST /api/webhooks/kie/music/[secret]` — look up creation by secret, **dedupe** on `(task_id, callbackType, audio id)`, store raw payload in `webhook_events`, **ack 200 within 15 s** and process asynchronously (enqueue); handle `text`, `first`, `complete`, `error`; map `sunoData[]` to `clips` by `variant_index`; mirror files; trigger timestamped lyrics; advance videos.
- `POST /api/webhooks/kie/lyrics/[secret]`, `POST /api/webhooks/kie/mp4/[secret]` — same pattern.
- `GET /api/creations/[id]/poll` — fallback polling of `GET /api/v1/generate/record-info?taskId=` (respect KIE's 3 req/s per task; run only if no callback for 90 s).
- `POST /api/lyrics` (cowriter), `POST /api/style/boost`, `POST /api/videos` (create/regenerate for a clip), `POST /api/videos/[id]/retry`, `POST /api/uploads/sign` (signed upload URLs for footage/images), `GET /api/download/[clipId]?type=mp3|mp4|cover` (signed URL redirect), `POST /api/clips/[id]` (rename, like, trash), `POST /api/clips/[id]/reuse` (returns form state).
- Worker (`/worker`, separate Docker image: node:20 + ffmpeg + chromium for Remotion): consumes `render_jobs`/`asset_jobs`, reports progress by updating `videos.progress/stage_message` (Realtime pushes it to the UI), uploads results with the service role key.

Rules: never expose `KIE_API_KEY` to the client; never trust provider URLs long-term (mirror); make every webhook handler idempotent; all money/credits changes in Postgres functions (`debit_credits`, `refund_credits`).

---

## 9. Frontend structure (App Router)

```
app/(app)/layout.tsx            sidebar + player bar + providers (Supabase, Zustand, Realtime)
app/(app)/create/page.tsx       three-panel page (CreatePanel | WorkspaceFeed)
app/(app)/song/[id]/page.tsx    detail
app/(app)/library/page.tsx      all clips / liked / videos / trash
app/(app)/credits/page.tsx
components/create/{CreatePanel, ModeTabs, ModelSelector, AttachmentRow, SimplePrompt, LyricsCard, Cowriter, StylesCard, StyleChips, VideoCard, MoreOptionsCard, TickSlider, TitleInput, SaveToRow, CreateFooter}
components/feed/{FeedHeader, FeedToolbar, DateGroup, ClipCard, ClipCardGenerating, ClipMoreMenu, VideoStatusBadge, GridClipCard}
components/player/{PlayerBar, ProgressSlider, VolumeControl, QueueDrawer, MiniVideo}
components/song/{SongHeader, LyricsView, VideoPlayer, VideoVariants}
lib/providers/{music/kie.ts, image/*, video/*, renderer/*}, lib/video/{plan.ts, sections.ts, beats.ts, palette.ts}
store/{createForm.ts, player.ts, selection.ts}
remotion/{LyricVideo.tsx, KenBurnsShow.tsx, Overlay.tsx, themes/*}
worker/{index.ts, render.ts, ffmpeg.ts, analyze.ts}
supabase/migrations/*.sql, supabase/functions (none required)
```
shadcn/ui primitives to use: Tabs, ToggleGroup, DropdownMenu (with sub-menus), Popover, Dialog, Sheet, Slider, Tooltip, Command (search), ScrollArea, Badge, Skeleton, Toast (sonner). Icons: lucide-react. Audio: a single `<audio>` element owned by the player store (`howler` not needed). Drag and drop: `@dnd-kit`. Forms: zod + react-hook-form only for uploads; the create form uses the Zustand store directly.

---

## 10. Mapping table — Suno UI control → KIE Suno API (`POST /api/v1/generate`)

| UI control                           | KIE param                                                                                                                                                                         | Constraint                                                       |
| ------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------- |
| Simple prompt                        | `prompt`, `customMode:false`                                                                                                                                                      | ≤500 chars                                                       |
| Lyrics (Advanced)                    | `lyrics`, `customMode:true`                                                                                                                                                       | ≤5000 (V6 family)                                                |
| Empty lyrics                         | `instrumental:true`                                                                                                                                                               | `audioWeight` unsupported without vocals                         |
| Styles                               | `style`                                                                                                                                                                           | ≤1000 (V4_5+ / V6); ≤200 on V4                                   |
| Exclude styles                       | `negativeTags`                                                                                                                                                                    | ≤1000; custom mode only                                          |
| Song Title                           | `title`                                                                                                                                                                           | ≤80; custom mode only                                            |
| Vocal Gender                         | `vocalGender: "m"\|"f"`                                                                                                                                                           | probability only                                                 |
| Weirdness %                          | `weirdnessConstraint` 0–1                                                                                                                                                         | 2 decimals                                                       |
| Style Influence %                    | `styleWeight` 0–1                                                                                                                                                                 | 2 decimals                                                       |
| Variety (5 steps)                    | `variety` 0–4                                                                                                                                                                     | default 1                                                        |
| Duration Custom                      | `duration` 10–360 s                                                                                                                                                               | V5_5 / V6 family only; omit when Auto                            |
| Model selector                       | `model: V6 \| V6_WILD \| V6_MINI \| V5 \| V4_5PLUS \| V4_5`                                                                                                                       | required                                                         |
| Voice                                | `personaId` + `personaModel: voice_persona`                                                                                                                                       | flag off                                                         |
| + Image / + Video / + Audio (Simple) | `imageUrls` (≤5, 10 MB) / `videoUrls` (1, ≤100 MB, ≤241 s) / `audioUrls` (6 s–30 min, 500 MB)                                                                                     | **non-custom mode only**; total attachments + style + lyrics ≤10 |
| Max Mode, Personalize/My Taste       | —                                                                                                                                                                                 | no equivalent → flag off                                         |
| Cowriter                             | `POST /api/v1/lyrics {prompt, callBackUrl}` → callback `audioLyricsGenerated` with 2–3 variants                                                                                   |                                                                  |
| Personalize-style wand               | `POST /api/v1/style/generate {content}`                                                                                                                                           |                                                                  |
| Word timings for karaoke/overlay     | `POST /api/v1/generate/get-timestamped-lyrics {taskId, audioId}` → `alignedWords[]`, `waveformData[]`                                                                             | none for instrumental                                            |
| Quick video                          | `POST /api/v1/mp4/generate {taskId, audioId, callBackUrl, author?, domainName?}` → `onMp4Generated`                                                                               |                                                                  |
| Task status                          | `GET /api/v1/generate/record-info?taskId=` → `PENDING, TEXT_SUCCESS, FIRST_SUCCESS, SUCCESS, CREATE_TASK_FAILED, GENERATE_AUDIO_FAILED, CALLBACK_EXCEPTION, SENSITIVE_WORD_ERROR` | 3 req/s per task                                                 |

Validation rules to enforce client- and server-side: in custom mode at least one of `style`, `lyrics`, `negativeTags`; in non-custom mode at least one of `prompt`, `imageUrls`, `videoUrls`, `audioUrls`, `style`, `lyrics`. Callbacks: must return 200 in <15 s, may repeat for the same taskId (idempotent), stop after 3 failed retries. Files expire after 14 days (always mirror).

Credits: mirror Suno's model — 10 credits per Create (2 clips); add video costs per mode (visualizer 2, slideshow 6, AI clips 20+, footage 4, quick 1) — all configurable in one `pricing.ts`.

---

## 11. Acceptance criteria

1. On `/create` at 1440×900 the layout matches §1.1 within a few px; dark tokens from §1.2 are CSS variables; no pure `#000`/`#fff`.
2. Simple → Advanced keeps typed content (prompt becomes the cowriter seed; attachments persist).
3. Clicking Create: credits debited, two placeholder cards appear in <200 ms, stages update live via Realtime, the play button works on the stream before completion, the final card shows artwork/title/duration, both videos reach `ready` without user action, badges and the progress bar reflect every stage.
4. Mock providers allow the full happy path offline (`PROVIDER=mock` env) with a 20 s simulated song and a 10 s render.
5. Webhook handler replays the same payload three times with no duplicate rows or double refunds.
6. Song detail plays audio and video in sync (drift < 60 ms), karaoke highlight follows `alignedWords`.
7. Download menu returns MP3, MP4 and cover via signed URLs; Trash soft-deletes and Library › Trash restores.
8. Responsive rules of §1.1 hold at 390×844 (iPhone) and 1024×768.
9. All interactive elements have the aria-labels listed (reuse Suno's naming: "Create song", "Like clip", "Dislike clip", "Share clip", "More options", "Edit title", "Playbar: Play button", "Add style: …", "Clear all form inputs").
10. i18n ready with `next-intl`: English and Italian strings; dates in the user locale.
11. Lighthouse a11y ≥ 95; no console errors; `pnpm typecheck && pnpm lint && pnpm test` green (Vitest unit tests for param mapping, limits, VideoPlan builder, webhook idempotency; Playwright e2e for the create flow with mock providers).

---

## 12. Build order

1. Supabase schema + RLS + buckets + pgmq; auth (email magic link + Google); seed one workspace per user.
2. App shell: sidebar, three-panel create page, player bar skeleton, tokens, fonts.
3. Create panel UI complete (both modes, all cards, validation) with the Zustand store and localStorage persistence.
4. `KieSunoProvider` + `/api/create` + webhooks + mirroring + Realtime feed with generating cards. Verify with mock, then one real generation.
5. Player (stream→final swap, queue), clip actions, detail page with lyrics.
6. Timestamped lyrics + palette + VideoPlan builder; Remotion `LyricVideo`; worker Docker image; Quick-video fallback.
7. Slideshow and AI-clips modes with pre-generation; footage mode with scene detection.
8. Library, credits page, downloads, i18n, tests, polish (hover states, tooltips, empty states, error states, skeletons).

## 13. Guardrails

- Original brand only: no Suno name, logo, "aura" image asset or copy; the gradient and layout are re-implemented, not copied.
- Do not scrape or automate suno.com; the only upstream is the KIE API.
- Respect provider ToS and content filters: surface `SENSITIVE_WORD_ERROR` as a friendly message and refund.
- Never store provider API keys client-side; never log full webhook payloads containing URLs to public logs.
- Keep every out-of-scope control visible but disabled with a "Soon" tooltip so the UI reads complete while the backend stays small.

---

## Appendix A — observed but out-of-scope Suno forms (for future tabs)

- **Speech tab:** Script textarea ("Write or paste your speech"), Tone textarea ("Describe the delivery: tone, pacing, mood and setting"), Advanced: Vocal Gender (Male/Female), Background music (Off/On), Variety slider.
- **Sounds tab:** banner "Create short samples — effects, loops, and one-shots. Ready to drop into anything.", Sound textarea ("Describe the sound you want", 0/500), Advanced Options: Type (One-Shot / Loop), BPM (number, "Auto"), Key ("Any").

## Appendix B — observed Suno copy worth reusing as placeholders / tooltips

- Lyrics placeholder: "Start writing lyrics, or leave this empty for instrumental"
- Styles placeholder example: "big room house, 808 beats, call and response, natural vocals, bass-house"
- Variety tooltip: "Clips have slight style variation."
- Weirdness caption: "Expected results" · Style Influence caption: "Moderate" · Variety caption: "Balanced variety"
- Voice empty state: "No Voices — Voices let you create songs that have a similar style and voice."
- Lyricist tooltip: "Create your own lyricist — Add examples of your lyrics and you can create new lyrics with the same vibe."
- Add menu: Lyrics › Write new / Use existing · Styles › Write new / Use existing · Playlist · Image · Video · Audio › Browse / Upload / Record · Voice ›
