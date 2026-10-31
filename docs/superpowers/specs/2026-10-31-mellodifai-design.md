# mellodifai - design

Status: draft for approval, 31/10/2026. Owner: the user (admin). Builder: Claude.

## 1. Intent and why

mellodifai turns a topic into a released song: AI lyrics, a Suno song, a beat-synced kinetic-typography lyric video
(16:9 master + 9:16 hook) in one or more languages, published to YouTube, kept in a project library.

Today this works only as a chain of CLI tools and hand steps in `C:\Users\Asus\Documents\suno-remake` (11 languages of
one song shipped, 31/10/2026). It takes an expert at the keyboard for hours per language. The app turns that chain
into a product: the admin fills a form, approves at a few checkpoints, and gets a video ready to publish.

Phases (user's words: "me as admin first, a sharp tool for me, then paying customers"):
- v1: a production-quality tool for the admin only.
- v2: paying customers on the same system (accounts, billing, quotas).

v1 must be built so v2 is an extension, not a rewrite: multi-tenant data model and access rules from day one.

## 2. Goals (v1)

The four features the user chose:
1. **Song from a topic.** Topic, language(s), genre/style, mood, vocal gender -> lyric pack drafted by an LLM -> admin
   reviews and edits -> Suno via kie (2 takes) -> admin listens and picks a take.
2. **Animated lyric video.** The audio + timing chain, storyboard, render (master + hook), automatic QA gates, browser
   preview. Admin approves or asks for a re-render.
3. **Publish to YouTube.** Metadata form prefilled (title, description, chapters, tags, thumbnail, captions), upload
   private. Going public, unlisted or scheduled is a separate, explicit click per video.
4. **Project library.** Every project with its languages, takes, renders, QA results, YouTube links, downloads, and a
   live status for anything still running.

Plus what "production ready" means here:
- Each long step is a resumable job: a crash, reboot or network drop never loses work or double-spends kie credits.
- The admin always sees what is running, what failed and why, and can retry a single step.
- Typed end to end, linted, tested (unit + E2E), CI on every push, versioned DB migrations, documented setup.

## 3. Non-goals (v1)

- Payments, public signup, customer accounts, quotas (v2).
- A timeline editor. Fixes happen by editing lyrics/timing fields and re-running a step.
- Cloud rendering. Rendering runs on the user's PC (user's choice).
- TikTok / Instagram publishing.

## 4. Anti-goals (a failure even if it "works")

- Any third-party secret (kie, OpenRouter, Groq, YouTube OAuth) reachable from the browser or stored on Vercel.
- A video going public without the admin's explicit click for that video.
- Shipping a video that silently failed a check (wrong chant count, cut-off outro, loudness off): every gate result
  is visible and a failed gate blocks "approve" until the admin overrides it knowingly.
- Breaking the existing suno-remake CLI pipeline or the mellodifai skill, which keep working on their own.
- Burning kie credits on retries: a song generation is never re-sent without the admin asking.

## 5. Constraints

- Renders run on the user's Windows PC (GPU, `--gl=angle`), strictly one Remotion job at a time. ~5 min per master,
  ~45 s per hook. Output and temp files on E: (C: is nearly full; never G:).
- kie: 12 credits per Suno generate (2 takes). YouTube Data API: 10 000 units/day, ~2 050 per upload (~4 uploads/day).
- The PC is the only worker: when it is off, jobs wait. The UI shows worker status ("online", "busy", "offline since").
- Hosting: Vercel (web) + domain mellodifai.com, registered at Hostinger, pointed to Vercel by DNS records.
- No em dash in any text the system writes (lyrics, titles, descriptions, reports, UI copy).
- Images: GPT Image via `codex exec -m gpt-5.6-terra` first, kie as fallback, never the direct OpenAI image API.

## 6. Architecture (decided)

```
 browser ── Next.js on Vercel (UI + server actions, no third-party secrets)
                │  Supabase JS (user session, RLS)
                ▼
          Supabase: Postgres (projects, versions, jobs, events), Auth, Storage (previews), Realtime
                ▲  service key (only on the PC)
                │  claim / heartbeat / progress / results
          worker on the user's PC (Node 22 + TypeScript daemon)
                │  subprocesses, one render at a time
                ▼
          suno-remake engine (python tools, Remotion motion/), E:\ for outputs, kie / OpenRouter / Groq / YouTube APIs
```

- **Web:** Next.js (App Router, TypeScript), Tailwind + shadcn/ui, a calm, easy UI (user's ask: "an easy frontend").
  Server actions only write intent (create project, approve, enqueue job); they never call kie, Suno, YouTube.
- **Database + auth + storage:** Supabase. Auth by email magic link; v1 signups closed (admin allowlist). Row Level
  Security on every table keyed on `owner_id` (multi-tenant from day one).
- **Queue:** a Postgres `jobs` table. The worker claims with `FOR UPDATE SKIP LOCKED`, heartbeats every 15 s, and a
  job whose heartbeat is 2 min stale goes back to `queued`. Each job is one pipeline stage with an idempotency key, so
  re-running it reuses finished outputs. Progress and log lines go to `job_events`; the UI follows them via Realtime.
- **Worker:** holds every third-party key, loaded at runtime from local env files, never logged. Starts at logon
  (Windows Task Scheduler), restarts on crash. Runs the existing tools as subprocesses with the same env as today
  (`PYTHONIOENCODING=utf-8`, TMP/TEMP on E:).
- **Files:** masters and stems stay on E:. Storage receives only what the browser needs: 720p preview, hook preview,
  thumbnail, cover, SRT, audio previews of takes. YouTube uploads go from the PC directly from E:.
- **Repo:** new monorepo `C:\Users\Asus\Documents\mellodifai` (pnpm workspaces): `apps/web`, `apps/worker`,
  `packages/shared` (types + zod schemas shared by web and worker), `supabase/` (migrations, seed). The worker calls
  the engine by path (`ENGINE_ROOT` = suno-remake). GitHub repo private.

### Data model (core)

- `profiles` (id = auth user, role admin|customer)
- `projects` (owner_id, topic, brief, style, theme, status)
- `versions` (project_id, lang, lyric pack JSON, chosen take, timing/storyboard paths, status)
- `takes` (version_id, kie task id, audio preview, scores)
- `renders` (version_id, kind master|hook, path on E:, preview url, QA results JSON, approved_at)
- `publications` (render_id, youtube video id, privacy, metadata JSON, confirmed_by, confirmed_at)
- `jobs` (owner_id, version_id, stage, status, attempts, idempotency_key, heartbeat_at, error) + `job_events`
- `workers` (id, last_seen, busy_job_id, engine version)

### Pipeline as jobs (one row per stage)

1. `draft_lyrics`: LLM writes the lyric pack (lyrics with Suno section tags, title, style, exclude, display map).
   Checkpoint: admin edits and approves.
2. `generate_song`: kie Suno V6, 2 takes. Never auto-retried after kie accepted the request.
   Checkpoint: admin listens (audio previews, take scores) and picks.
3. `timing`: produce_song, render audio, vocal stem, beat grids, timing chain (today's `lang_pipeline.sh`).
   Automatic danger-spot checks: chant count before the Final Chorus, spoken outro greeting, words crushed into
   < 0.2 s. A flag becomes a checkpoint with the stem clip to listen to.
4. `storyboard`: cut sheet from timing + theme.
5. `render_master`, `render_hook`: one at a time, progress from Remotion.
6. `qa`: loudness -14 LUFS, pace vs target, stamp overshoot, contact sheet; optional Gemini jury (~0.1 USD).
   Checkpoint: admin watches the preview and approves.
7. `art`: thumbnail and cover.
8. `publish`: private upload with captions and thumbnail; `set_privacy` only from the explicit confirm click.

## 7. Left to the builder

- Library versions, UI component details, page layout, copy (Italian first, English second).
- Exact job retry/backoff numbers, log retention, preview encoding settings.
- Test layout, CI provider details (GitHub Actions expected), error monitoring choice.

## 8. Builder's calls (from the builder check, the user can overrule)

- **Languages:** the form offers the 11 languages the engine already ships (it ru ro ja en es de zh pt ko fr).
  Adding a language stays engine work done outside the app.
- **Per-project workspace:** the engine gets an optional workspace root (env var / CLI flag) so each project version
  reads and writes under `E:\mellodifai\projects\<project>\<lang>\` instead of the shared per-language folders.
  Without the flag the engine behaves exactly as today, so the CLI and the skill keep working.
- **One song per language,** as today: each language version gets its own lyric pack and its own Suno generation.
  The UI shows the credit cost (12 per language) before any spend.
- **kie spending:** the UI shows the kie balance and every generation needs a confirm click; never auto-retried.
  LLM lyric drafts are cheap and need no confirm, with a per-day cap on the worker.
- **QA gates:** measurable gates are automatic and blocking (loudness, true peak, pace, stamp overshoot, lyric gate,
  crushed words < 0.2 s from timing). Chant count and outro greeting are flagged automatically (Whisper on the stem
  clip, `tools/clip_whisper.py`) and confirmed by the admin by listening. The Gemini jury is an optional button.
- **YouTube:** the worker wraps the existing `publish/yt.py` (no port). The OAuth app must be "In production" (a
  "Testing" app expires tokens after 7 days); the queue keeps a daily quota counter and holds uploads past ~4/day.
- **Existing work:** the VBP song and its 11 shipped languages are imported into the library as the first project
  (read-only back-fill of takes, renders, SRTs, and YouTube ids once published).

## 9. The user's answers (31/10/2026)

1. **Any topic, new look.** The engine gets a general lyric-video theme: kinetic typography, stamps, counters,
   charts and the other topic-neutral scenes, a palette per song, any number of lines, a storyboard built from the
   song's sections and beats with scene props written by the LLM from the lyrics. VBP (office satire, OKBOT, the
   80-line scene map) stays as one theme among others and keeps rendering exactly as today. This is the largest
   piece of work in v1 and gets its own quality bar: a jury pass on a test song before the theme is offered in the UI.
2. **Supabase: reuse the existing "MellodifAI" project, free plan.** Update 31/10: Supabase refuses to restore it
   ("paused for more than 400 days"), so the free-plan intent carries over to a fresh free project (0 USD/month,
   created only after the user's OK). Development and CI run on a local Supabase (Docker) meanwhile.
   Original plan: it is paused and must be restored. Its old 2025
   contents are inspected and shown to the user before anything is dropped. Free-plan limits shape the build:
   1 GB storage (previews kept small, old previews pruned), the project pauses after a week without use (the worker's
   heartbeat keeps it active while the PC is on), no daily backups (a weekly `pg_dump` from the worker to E:).
   Moving to Pro later is a plan change, not a migration.
