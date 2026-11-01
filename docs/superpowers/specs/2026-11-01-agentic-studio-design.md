# MellodifAI Agentic Studio - master design

Date: 2026-11-01. Author: Claude (Opus 5.5) from the owner's requests of 31/10 and 01/11, the
research in `E:/mellodifai/research/` and the feature plan in
`docs/egm/v2-local-engines/feature-parity-plan.md` (that plan stays the source for the studio
features T7-T22; this document adds the agentic layer, the remake workflow, the quality system and
the daily improvement loop, and orders all of it).

## 1. Intent

MellodifAI is the owner's personal studio (him, family and friends; not public, but built so it
could become a SaaS later). It turns an idea, an imported song, or a **YouTube link** into a
finished song and video that is published automatically on his YouTube channel and other social
platforms, at the **lowest possible cost per video**, with quality guaranteed by a jury of models
and by motion and graphic design best practice. It is **agentic**: a person can use it through the
web interface, and AI agents (Claude Code, Codex/ChatGPT, Cursor, Gemini) can drive every function
through a CLI and an MCP server using the owner's own subscriptions. It **improves itself every
day** with a measured loop.

Why now: the owner has a working studio (songs, takes, stems, editor, Video Studio, lyric videos,
local engines) but every video still needs him at each step, YouTube publishing is not connected,
and paid generation is used where free or subscription-covered paths exist.

Success: a YouTube link or a one-line idea becomes a scheduled YouTube video (16:9 plus a 9:16
Short and a thumbnail) without the owner touching anything, for under 0.15 USD of paid usage in
standard mode, scoring at least the jury threshold, and he can steer any step from the app or from
his agent when he wants to.

## 2. Current state (01/11/2026)

- Built and tested: library, player, create panel with lyric pipeline (Jev router, Opus writer,
  jury of models, devil's advocate), kie Suno and local engines (YuE2 owner-only, ACE-Step 1.5 via
  ComfyUI), takes and scoring, playlists, details panel, search, stems (Demucs), audio editor, Video
  Studio with live preview and Remotion render (T13), lyric videos (VBP template, MellodifAI
  Classico preset), stable `/media` links, worker on the PC with Supabase local in Docker.
- In progress: T12 (rewrite a part like Suno's Replace Section, import from Suno, upload, cover,
  reference, transcription); research on Riffusion/Producer features; catalogue of the owner's
  VideoHive visualizer packs on `I:\.YT STUFF` (After Effects 2023/2024 installed).
- Installed: Postiz self-hosted (`http://localhost:4007`).
- Not connected: YouTube upload (no Google OAuth client yet; owner creates it), Blotato key,
  Comfy Cloud key, Gemini API key, OpenRouter guardrail-free key.

## 3. Goals, non-goals, anti-goals

Goals:
1. **Remake from a YouTube link** (section 4), end to end, in Copilot mode (pauses for approval)
   and Autopilot mode (runs through, pauses only on jury failure or cost cap).
2. **Agent access** (section 5): one operations API used by the web UI, a `mellodifai` CLI and an
   MCP server; an agent skill that teaches any agent the workflows.
3. **Quality system** (section 6): jury gates on lyrics, music, visuals and metadata, with
   design rules from motion and graphic design best practice; every run aims at the best outcome.
4. **Cost routing** (section 7): subscriptions first, free local engines second, cheap APIs third,
   premium (Higgsfield, Comfy Cloud) only when chosen; a cost ledger and caps.
5. **Publishing** (section 8): YouTube plus Postiz/Blotato routes, schedule, Shorts.
6. **Daily improvement loop** (section 9).

Non-goals (now): public sign-up, payments, multi-tenant scaling, LoRA training, the social layer.

Anti-goals (a run that does any of these is a failure even if a video comes out):
- copying the source's melody, recordings, graphics, footage or exact lyrics (only structure,
  timing, mood and meaning carry over);
- spending money without the cost shown and within caps;
- publishing a video that failed the jury or has broken text, wrong lyrics, or silence;
- mass-produced sameness (YouTube does not monetise repetitive, mass-produced content): every
  video must have its own look;
- automating services whose terms forbid it (suno.com, midjourney.com web UI, scraping).

## 4. Core workflow: "Rifai da YouTube" (remake)

Owner's rule (verbatim intent): the new video keeps the **timing, structure and mood** of the
original; the lyrics are translated or rewritten to transmit **the same meaning and vibe, not the
exact words**, staying on the safe side of copyright for YouTube. Graphics follow motion and
graphic design best practice and pass the jury.

Stages (each is a worker stage with progress events; each can pause in Copilot mode):

R1 Ingest: `yt-dlp` (with the `yt-dlp-ejs` + `--js-runtimes node` fix) downloads audio, video,
captions and metadata to `E:/mellodifai/remakes/<id>/` for analysis only (never re-published, never
used as model input audio). Transcript from captions, else Whisper (Groq). Frames at scene cuts
plus 1 fps contact sheets (the `/watch` skill method).

R2 Analyse:
- Music: BPM, key, time signature, sections with timestamps, vocal type, instrumentation, energy
  curve (Demucs + timing stage tools, plus a beat/section analyser).
- Lyrics: a meaning map per section (theme, story beat, imagery, emotional arc, hook idea).
- Video: a **video blueprint** (JSON, versioned schema in `packages/shared`): shot list with start
  and end times aligned to sections and beats, layout per shot, typography roles, colour palette,
  motion vocabulary (cuts, zooms, kinetic text, visualizer type), transitions, text overlays.
  Built by a vision model from frames and contact sheets.

R3 Rewrite lyrics: per section, new lines in the target language that carry the meaning map;
syllable count and stress per line fit the original timing (so the structure holds); optional
cultural adaptation (T17). **Originality check**: line-by-line lexical and semantic similarity to
the source below fixed thresholds (no line close to a translation of a source line beyond the
threshold). Jury: singability, meaning fidelity, originality, YouTube safety, plus the devil's
advocate. Rounds until pass or the round cap.

R4 Music: a new song from text only (style tags and structure from R2, lyrics from R3): kie Suno by
default, ACE-Step local for free mode; two takes, `score_takes` plus listening jury. The source
audio is never given to a generator (no cover/reference of a copyrighted source; that path is only
for the owner's own or CC BY/BY-SA songs, T12/T17).

R5 Visual composition: from the blueprint, an agent (or the app's own writer when no agent drives)
produces a **Remotion composition** with the same shot timing and mood but original graphics:
built from Video Studio building blocks (presets, kinetic lyrics, visualizers from the VideoHive
catalogue rebuilt in code, transitions) and generated images (R6). Design rules (section 6) are
enforced in code where possible (safe areas, type scale, contrast, beat-aligned motion).

R6 Images: per shot prompts written from the blueprint; routed by section 7. Output also feeds
the thumbnail generator.

R7 Render: local Remotion 16:9 master, 9:16 Short (hook section, at most 3 minutes, full-frame
layout, not letterboxed), thumbnails (two styles), captions file.

R8 Visual jury (section 6) on sampled frames, the contact sheet and the thumbnail; fix and
re-render until pass or round cap; originality check of visuals against the source (perceptual
and embedding similarity below threshold).

R9 Publish (section 8).

The "Console": the song page shows every stage with inputs, outputs, jury scores, devil's advocate
notes, cost so far, and buttons to approve, edit, regenerate or skip; agents get the same through
MCP.

## 5. Agent access: one operations API, CLI, MCP

- **Operations layer**: every action the UI can do (the existing RPCs: `create_song`,
  `approve_lyrics`, `pick_take`, `make_video`, `request_section_edit`, `request_visualizer`,
  `request_stems`, `enqueue_publish`, playlists, library, plus new remake operations) exposed as a
  versioned HTTP API `/api/v1/...` with typed schemas shared with the UI (zod in `packages/shared`).
- **Personal access tokens**: created in Settings > Agenti, scoped (read, create, spend, publish),
  shown once, stored hashed, revocable, with per-token daily spend caps; every agent call is
  logged with the token name.
- **CLI** `mellodifai` (`packages/cli`, Node): `login`, `songs`, `create`, `remake <url>`,
  `status <id> --watch`, `approve`, `regenerate`, `video`, `publish`, `costs`; JSON output flag.
- **MCP server** (`packages/mcp`): stdio transport for local agents (Claude Code, Codex CLI,
  Cursor, Gemini CLI) **and** Streamable HTTP at `/api/mcp` for claude.ai and ChatGPT connectors,
  built in the same milestone (owner's answer: both at once). Remote access needs the app on a
  public HTTPS address: the app keeps running on the PC (worker, GPU, local Supabase) and is exposed
  through a tunnel (Cloudflare Tunnel on a mellodifai.com subdomain, or Tailscale Funnel if the DNS
  cannot move); the same tunnel gives Postiz the public media URLs TikTok, Instagram and Threads
  need. Remote MCP authorization follows the MCP authorization spec (OAuth 2.1 with the app's
  sign-in), never a token in a URL. Tools mirror the operations; resources expose songs, lyrics, blueprints,
  jury reports; prompts expose the workflows (remake, new song, adapt language).
- **Bring your own brain**: tools accept agent-authored artefacts (lyrics, blueprint edits, a
  Remotion composition within a sandboxed component API, image files), so the reasoning runs on
  the agent's own subscription and costs the app nothing. The app's internal LLM calls are used
  only in Autopilot without an agent.
- **Agent skill**: a skill folder plus `AGENTS.md` describing the workflows, cost rules and
  approval etiquette, installable in Claude Code, Codex and Cursor.
- Security: tokens never logged; publish and spend scopes need explicit grant; rate limits.

## 6. Quality system (jury and design rules)

- Lyrics jury (existing, extended with originality and singability-to-timing).
- Music jury: take scoring plus listening checks (vocal clarity, lyric intelligibility via Whisper
  word error rate against the intended lyrics, loudness, structure match to the blueprint).
- **Visual jury**: several vision models (OpenRouter, Claude) score sampled frames and the
  thumbnail against a written rubric: hierarchy and focal point, type scale and legibility, safe
  areas, contrast (WCAG-level for text), colour harmony, motion rhythm against beats, consistency
  across shots, brand fit, originality against the source, absence of AI artefacts and misspelt
  text. Pass threshold and must-fix rules; the devil's advocate argues against passing.
- Design rules in code: the motion playbook already used for decks (`DESIGN-MOTION.md` in the ita
  repo: slot-locked numbers, closed loops, easing) adapted for video; type scale, safe margins,
  minimum on-screen time per word, beat-quantised cuts.
- Every run aims at the best outcome: the round cap and cost cap decide when to stop; the run
  reports why it stopped.

## 7. Providers, routing and cost

Reasoning: the driving agent's subscription (Claude via Claude Code, ChatGPT via Codex, Cursor,
Gemini) -> cheap OpenRouter models (Jev router) -> Claude API credits (owner has 200 USD) as last
fallback.

Music: kie Suno (about 12 credits per song) default; ACE-Step local free; YuE2 owner-only; Mureka
or ElevenLabs Music optional if the owner adds keys.

Images, in the owner's chosen order (answer of 01/11), each falling through to the next on
failure, refusal, timeout or cap:
1. **Midjourney through the kie.ai reseller API** (owner's favourite style; owner accepted that it
   is unofficial and may stop working). "Importa da Midjourney" (drop or paste his own MJ images)
   stays available for hand-made picks.
2. **GPT Image on the owner's ChatGPT plan** through `codex exec` on the PC (no API cost; personal
   use; other users would bring an OpenAI API key).
3. **Nano Banana** (Google's Gemini image model) through the cheapest official route found
   (Gemini API free tier or paid per image; Google Flow is a consumer web app and is not automated).
4. **OpenRouter** image-capable models with the OpenRouter API key, last.
5. Local open models (T18 bake-off) as the free offline fallback when every paid route is capped.
The router records which provider made each image and its cost; the visual jury picks among
candidates when several are generated.

Video: Remotion local (free) for standard; **premium mode** adds Higgsfield API shots (owner has a
key) and Comfy Cloud workflows for dramatic footage, each with cost shown before confirm.

Cost ledger: every paid call recorded (provider, units, price, song, token); daily and monthly caps
per provider and per token; the standard target is under 0.15 USD per video.

## 8. Publishing

- YouTube Data API through the owner's own Google Cloud project (the owner creates the OAuth
  client; until the project passes YouTube's API audit, API uploads are forced private), so: route
  public YouTube uploads through Blotato until the audit passes; prepare the audit.
- Postiz (self-hosted, free) for TikTok, Instagram, Facebook, X, Threads, LinkedIn; Blotato as the
  fast paid route and optional fallback; per-platform route choice in the publish step with
  defaults in Settings.
- Metadata: title, description and tags from templates with a checker; AI-content disclosure set
  when required; credits and licence notes; best upload time from channel analytics.
- **Owner's answer:** publishing auto-schedules with a veto window (notice in the app and to the
  agent; cancel before it goes live).

## 9. Daily improvement loop

Modelled on an autoresearch-style ratchet: hypothesis -> change -> evaluate on a fixed set ->
keep only if better -> log, repeated every night.

- Runner: the existing `gnhf` overnight runner (Codex on the owner's ChatGPT plan) or Claude Code
  headless, on a dedicated branch, in a worktree, never on the live checkout.
- Inputs: YouTube Analytics per video (views, click-through rate, average view duration,
  retention), jury scores, job failures and errors, owner feedback (likes, dislikes, edits,
  rejections), cost ledger.
- Evaluation harness: a fixed golden set (for example 10 songs and remakes with frozen inputs) and
  a composite score (jury scores, render success, cost, time); no regression allowed on any
  component beyond a tolerance.
- **Owner's answer: fully autonomous.** Any change that scores better is kept and merged,
  including code, without waiting for approval. Rails that keep autonomy safe (my calls): a change
  merges only if every test suite, the type checks, the linter and the golden-set evaluation pass
  with no component regressing beyond tolerance; it never edits secrets, env files, the loop's own
  evaluation harness or thresholds, tests' assertions to make them pass, or auth, token and
  publishing-scope code; it never runs destructive migrations; each merge is one revertable commit;
  live metrics are watched after a merge and an automatic revert fires on regression; a kill
  switch in Settings stops the loop; the morning report lists everything merged.
- Morning report in the app (and to the agent through MCP): what was tried, scores, what was kept.

## 10. Constraints

- Owner rules: no em dash characters anywhere; Italian UI with correct accents plus English;
  runtime files on E:; C: is nearly full (about 13 GB free); never spend kie credits in tests;
  local engines admin only; never print or commit keys; publish publicly only with the owner's
  configured rules; commit messages without co-author lines.
- Hardware: RTX 3070 8 GB, one GPU job at a time; Docker Desktop on WSL2 (after power cuts it may
  need its `run` folder reset; never factory reset: it holds the local database).
- Licences: YuE2 non-commercial; Remotion free up to 3 people; Postiz AGPL (run unmodified);
  Audacity code not copied (GPL); UVR models need credit; VideoHive templates only within their
  Envato licence (looks are rebuilt in code, template files never shipped).
- Terms: Suno, Midjourney web, YouTube (API audit, inauthentic content, AI disclosure).

## 11. Order of work

M0 (running): T12; VideoHive catalogue -> new Video Studio presets; Riffusion research.
M1: operations API + tokens + CLI + MCP (local stdio and remote Streamable HTTP with OAuth) +
    tunnel + agent skill. (Can start now in a worktree; touches new packages and
    `apps/web/app/api`, not T12's files.)
M2: remake pipeline R1-R9 in Copilot mode, then Autopilot (after T12 lands; shares worker stages).
M3: YouTube connected (owner's OAuth client) + Blotato/Postiz routes + scheduling + Shorts cut.
M4: visual jury, design rules in code, image routing (Midjourney import, Nano Banana, GPT Image via
    codex, local fallback), thumbnails.
M5: cost ledger and caps; daily improvement loop with the golden set and analytics ingestion.
M6: premium mode (Higgsfield, Comfy Cloud workflows).
Then the remaining feature-plan items (T15 brand kit, T16 jingles, T17 adaptation, T18-T22) folded
into the milestones where they serve the remake workflow.

## 12. Left to the builder

Exact API routes and schemas, table layouts, CLI command flags, MCP tool names, jury rubric
wording and thresholds (calibrated on the golden set), the beat/section analyser choice, and the
Remotion component API for agent-authored compositions.

## 13. Future: portable runtime, installers, desktop apps and GPU servers (owner, 01/11)

Not built now (the owner is the only admin today), but every new piece of code must keep it
possible.

- **Any machine can be a worker.** The worker already pulls jobs from the queue, so the PC, a
  Debian GPU server, or a user's own computer are all just workers. Each worker reports its
  capabilities (GPU model, VRAM, RAM, disk, OS, installed engines and model files, versions) with
  its heartbeat; jobs carry requirements (for example "YuE2 INT8, 8 GB VRAM" or "CPU render"), and
  the queue hands a job only to a worker that meets them. Bigger servers unlock bigger models
  (YuE2 BF16, ACE-Step XL, larger image and video models).
- **Doctor and installer** (`mellodifai doctor`, `mellodifai install`, a shell script for
  Debian/Ubuntu over SSH, PowerShell for Windows, a macOS script): detect the hardware and software
  (nvidia-smi / Metal, CUDA, Python, Node, ffmpeg, ComfyUI), print what this machine can run per
  engine and what is missing, then download and install everything automatically from the GitHub
  repo's releases (pinned versions, checksums), register the worker with a token, and run as
  services (systemd on Debian, a service on Windows, launchd on macOS). The owner prefers a full
  Debian server over Docker for GPU hosts.
- **Self-update**: workers and apps update themselves from signed GitHub releases on a channel
  (stable or the daily loop's channel), with automatic rollback if the health check fails after
  an update.
- **Desktop apps** (Windows, Linux, macOS; a small native shell around the web app, Tauri is the
  likely choice): on first run they run the doctor; if the computer can run engines locally they
  install and start a local worker; if not, they propose (a) running on the owner's GPU server
  infrastructure, choosing the nearest server by ping, or (b) bringing the user's own API keys
  (kie, OpenRouter, image providers) for cloud-only mode.
- **GPU hosting**: a dedicated or virtual GPU server running Debian (not a container platform),
  sized for the bigger models; providers to compare when the time comes include RunPod (note: its
  pods are containers), dedicated GPU servers (for example Hetzner's GPU line) and any VPS provider
  that offers GPU plans (check whether Hostinger does). The web app moves to that server or stays on
  Vercel with hosted Supabase; local engines keep their licence limits (YuE2 stays owner-only).
- **Portability rules for code written from now on**: no hard-coded Windows paths or drive
  letters (a configurable runtime root replaces `E:/mellodifai`), no Windows-only process
  handling without a POSIX path, engine and model locations from config, and every external tool
  located through config or PATH.

M7 (after M6): capability-aware queue, doctor, installers, self-update, then desktop apps.

## 14. Owner additions (01/11 evening) and findings

- **Per-song storyboard (bug found 01/11).** New songs inside the imported "Va bene, passa (VBP)"
  project reuse that project's scene template (`storyboard-l10n.json`): the lyrics are new and in
  sync, but the scenes (PR bar, `ssh root@prod`, review stopwatch), the thumbnail ("VBP Va bene,
  passa!") and the YouTube title and description come from the old song
  (`apps/worker/src/legacy-import.ts`, `stages/draft-lyrics.ts`, `stages/utils.ts`). Every song
  must get its own storyboard, thumbnail and metadata from its own lyrics (R5 and the publish kit
  below); the VBP template stays only as one selectable style.
- **Preview quality.** The app's video preview is an 854x480 copy at about 0.3 Mbit/s, which reads
  as low quality; masters are 1920x1080. Previews move to 1080p within the storage budget; masters
  render 1080p by default and 4K on request (Remotion renders vector graphics natively at 4K, so
  no upscaling is needed for them). A free local upscaler (Real-ESRGAN class, for example Video2X)
  is used only for generated footage (Higgsfield, ComfyUI clips) before compositing.
- **Project page as the publishing hub.** The project page with its language chips (IT, RU, RO,
  JA, EN, ES, DE, ZH, PT, KO, FR) becomes the hub: "Aggiungi lingua" generates a new language
  version (T17 adaptation), and each language has a publish kit: title, description, tags and
  hashtags, chapters, captions (auto-generated SRT from word timing, per language), thumbnail,
  target playlist, schedule, and per-platform posts (section 8), all generated, editable, checked.
- **Thumbnails that convert, not clickbait.** A thumbnail generator per video (two to three
  candidates from the video's own key frames, title and generated art), following click-through
  practice: one focal subject, three words or fewer of large text, strong contrast, readable at
  small size, consistent channel style, faces or characters with clear emotion, no misleading
  claims; scored by the visual jury on a phone-size render. The daily loop learns from YouTube
  click-through rate per thumbnail style, and YouTube's own thumbnail test is used when available.
- **Karaoke mode** (like Spotify's): the listening view shows lyrics synced line by line with the
  current line and word highlighted (word timing already exists), plus a karaoke switch that
  lowers or removes the vocal using the stems or the T11b vocal removal. Owner's reference
  screenshots of Spotify (01/11): full-screen lyrics on a solid background taken from the cover's
  dominant colour, very large bold left-aligned lines in a soft tint with the current line in full
  white, generous line spacing, auto-scroll keeping the current line in view, a lyrics credit at
  the bottom; three line states: sung lines dimmed, the current line pure white, upcoming lines a
  light tint of the background colour; a top-right toolbar with a karaoke (microphone) toggle and a
  lyrics button in the player bar; and the main layout with a playlist header whose colour comes from the cover, a big
  round play button, track rows with cover, title, artist, album and duration, and a right-hand
  "now playing" panel with large artwork. The app's polish should match that level.
- **Agents edit songs and videos by talking.** Every editor action (cut, fade, normalise, replace a
  section, regenerate a section, re-render the video, change the storyboard) is an MCP tool, so an
  agent on the user's Claude or ChatGPT subscription edits from a conversation without driving the
  screen; the web UI stays fully labelled and accessible, so computer-use agents can also operate
  it as a fallback.
- **Video editor in the project.** A timeline editor for the video (scenes, text, timing, assets)
  inside the project. Candidates: HyperFrames (HeyGen, HTML-based compositions rendered to video,
  agent-friendly) and Remotion (already used, React compositions, `@remotion/player` for in-app
  preview). An evaluation picks one, or a split (for example HyperFrames for agent-authored scenes,
  Remotion for rendering), on output quality, editability, licence, speed on the PC and fit with
  the existing pipeline.
- **From the Riffusion/Producer research** (`E:/mellodifai/research/riffusion-producer-report.md`;
  Producer became Google Flow Music on Lyria, without its old swap and cover-strength features):
  (1) a chat editor where the user or agent says "change the second chorus" and it becomes kie
  `replace-section` / `extend` calls (sections to seconds via word timing or kie
  `get-timestamped-lyrics`; windows 10 s minimum, at most half the track); (2) "Cambia voce" and
  "Cambia base" buttons from stems plus kie `add-vocals` / `add-instrumental`; (3) "Dalla mia voce
  allo studio": upload a dry vocal, get a produced song (ACE-Step cover with a strength slider,
  kie `upload-and-cover-audio` as the paid option; Italian bake-off first); (4) a free local tier
  (Demucs, ffmpeg effects, ACE-Step repaint); (5) optional Lyria engine through the Gemini API
  (about 0.08 USD per song, no edit endpoints).
