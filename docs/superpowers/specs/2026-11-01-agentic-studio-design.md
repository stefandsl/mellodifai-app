# MellodifAI Agentic Studio - master design

- **Date:** 2026-11-01. **Revision:** 2 (resolves the goldfish review in
  `docs/egm/agentic-studio/goldfish_review_report.md`; dispositions in section 28).
- **Status:** approved direction, ready for planning milestone by milestone. Owner decisions
  (section 2.1) are final. Author's calls (section 2.3) hold until the owner overrules them.
- **Author:** Claude (Opus 5.5), from the owner's requests of 31/10 and 01/11, the research listed in
  section 27, and a read of the code on branch `build/studio-ui`.
- **Extends and partly supersedes:** `docs/superpowers/specs/2026-10-31-mellodifai-design.md`. The
  rules it replaces, and the control that replaces each, are listed in section 2.4.
- **Relationship to the feature plan:** `docs/egm/v2-local-engines/feature-parity-plan.md` owns the
  feature specs of T7-T22 (T-ids are glossed in section 27). This document owns the order and
  dependencies of all work, the agentic layer, the remake workflow, the quality system, the cost
  system, publishing and the daily improvement loop. It links to the plan instead of restating it.
  Where both describe the same thing, this document wins for the definition of originality
  (section 10.3) and the plan wins for UI behaviour.

## 1. Intent and success

MellodifAI is the owner's personal studio (him, family and friends; not public, but built so it
could become a SaaS later). It turns an idea, an imported song, or a **YouTube link** into a
finished song and video that is published automatically on his YouTube channel and other social
platforms, at the **lowest possible cost per video**, with quality guaranteed by juries of models
and by motion and graphic design rules enforced in code. It is **agentic**: a person can use it
through the web interface, and AI agents (Claude Code, Codex/ChatGPT, Cursor, Gemini) can drive
every function through a CLI and an MCP server, reasoning on their own subscriptions. It
**improves itself every day** with a measured, mechanically guarded loop.

Why now: the studio works (songs, takes, stems, editor, Video Studio, lyric videos, local
engines), but every video still needs the owner at each step, the YouTube publishing code has no
Google OAuth client yet, and paid generation is used where free or subscription-covered paths
exist.

**Success criterion** (measured on the golden set, section 13.4, at the end of M5): a YouTube link
or a one-line idea becomes a scheduled YouTube video (16:9 master, a 9:16 Short and a thumbnail)
with no owner action, in Autopilot, standard tier, where:

- every gate in section 10 passed (no override);
- the **median paid cost per video is under 0.15 USD**, counting every paid call of the run
  (lyrics, juries, music, images, analysis, retries, Short, thumbnail, any Claude API fallback)
  and excluding fixed subscriptions (ChatGPT plan, Blotato monthly fee, Cloudflare free plan);
- no single run exceeds the hard per-run cap of 0.25 USD (section 11.6);
- the owner can steer any step from the app or from his agent when he wants to.

## 2. Decisions

### 2.1 Owner decisions (final)

These are the owner's. Builders implement them and never re-argue them. Each is cited in the text
as "(OD n)".

| # | Date | Decision |
| --- | --- | --- |
| OD1 | 31/10, 01/11 | A remake keeps the source's **timing, structure and mood**; the lyrics are rewritten or translated to carry **the same meaning and vibe in new words**, staying on the safe side of copyright for YouTube; graphics follow motion and graphic design practice and pass the jury. |
| OD2 | 01/11 | Agents connect **locally** (CLI and stdio MCP) **and remotely** (Streamable HTTP MCP for claude.ai and ChatGPT connectors) in the **same milestone**. |
| OD3 | 01/11 | Publishing **auto-schedules with a veto window**: the owner (and his agent) is notified and can cancel before it goes live. |
| OD4 | 01/11 | The daily improvement loop is **fully autonomous, including code merges**, with no human approval step. Safety comes from enforced mechanisms (section 13). |
| OD5 | 01/11 | Image routing order: (1) Midjourney through the kie.ai reseller API (the owner accepts it is unofficial and may stop working), (2) GPT Image on his ChatGPT plan through `codex exec`, (3) Nano Banana through the cheapest official route, (4) OpenRouter image models, (5) local open models. |
| OD6 | 01/11 | Remotion is the renderer and in-app preview. Each video has a **JSON timeline document** edited by the web UI and by agents; HyperFrames is not the engine. |
| OD7 | 01/11 | Builders have full autonomy: they test, commit and push without asking. |
| OD8 | 01/11 | The app runs on his Windows PC (RTX 3070 8 GB, local Supabase in Docker, worker on the PC) and must stay portable to a future Debian GPU server. |

### 2.2 Standing owner rules (from earlier sessions, still binding)

No em dash characters anywhere; Italian UI with correct accents plus English; runtime files on
E: (C: is nearly full); **never spend kie credits in tests**; local engines are admin only; never
print or commit keys; commit messages without co-author lines; a song generation is never re-sent
after an ambiguous kie submission without the admin resolving it (`resolve_kie_submission`).
These rules bind every agent, including the daily loop (section 13.2).

### 2.3 Author's calls (the owner can overrule)

Each is cited as "(AC n)". "Default" means the value ships configured and can be changed in
Settings.

| # | Call | Status |
| --- | --- | --- |
| AC1 | Production runs on the PC behind **Cloudflare Tunnel** on mellodifai.com subdomains; Vercel plus hosted Supabase is retired as production (section 5). | in force |
| AC2 | Remote MCP authorization uses **Supabase Auth's OAuth 2.1 server**, with scope checks inside the database (section 6). | in force |
| AC3 | Agent compositions are **data only** (the timeline document); no agent-authored code is ever executed (section 9). | in force |
| AC4 | The publish **clock is owned by the app**: uploads stay private until the app flips them; YouTube `publishAt` is not used (section 12). | in force |
| AC5 | Veto window default **24 h** before the slot; one veto cancels the whole bundle. | default |
| AC6 | Loop rails, merge gate, frozen evaluator and isolation exactly as in section 13. | in force; owner has not yet confirmed them (section 22) |
| AC7 | Per-video budget split and caps in section 11.6 (target 0.15 USD median, hard cap 0.25 USD per run). | default |
| AC8 | Golden set: 5 items in M2, 10 items before the loop merges (section 13.4). | in force |
| AC9 | Two takes per generation (one kie generate call returns two), Short at most 3 minutes, thumbnails 3 candidates. | default |
| AC10 | Downloading a YouTube source with yt-dlp for **analysis only** is part of OD1's workflow; the source is never re-published, never given to a generator, and is deleted once R2 passes. | in force; owner to confirm (section 22) |
| AC11 | "Keeps timing" (OD1) is measured as: same section sequence, tempo within 5%, each section's duration within 15% of the source (section 8.4, R4). | in force; owner to confirm (section 22) |
| AC12 | Push notifications go through **ntfy** (phone app, private random topic). | default |
| AC13 | `main` becomes the production branch before the loop is enabled (section 13.6). | in force |

### 2.4 Rules of the 31/10 design that this document supersedes

| 31/10 rule | New rule | Replacement control |
| --- | --- | --- |
| Going public is a separate, explicit click per video (31/10 sections 2, 3). | Auto-schedule with veto window (OD3). | Database publish gate (every jury passed, section 10.8), app-owned clock with fail-closed behaviour, Autopilot policy row (section 6.5), flag `auto_publish_public` (section 20). |
| Every kie generation needs a confirm click (31/10 section 8). | Copilot keeps the click; Autopilot replaces it. | `reserve_spend` caps (section 11.5) and the Autopilot policy row. |
| A song generation is never re-sent without the admin asking. | **Unchanged.** | An ambiguous submission stops the run with `ambiguous_spend` (section 8.6); jury rounds only start new generations after a definite outcome. |
| GPT Image via codex first, kie as fallback. | OD5 order. | Router in section 11.3. |
| TikTok and Instagram publishing are non-goals. | They are goals, through Postiz and Blotato (T19). | Section 12.5. |
| Hosting on Vercel plus hosted Supabase. | PC plus Cloudflare Tunnel (AC1). | Section 5; README deploy section rewritten in M1. |
| No third-party secret reachable from the browser. | **Unchanged** (secrets stay in the worker and web server env files on the PC). | Section 5.4. |

## 3. Current state (verified in the code on 01/11/2026)

**Done:** T7 library, T8 player, T9 create panel, T10 playlists and details panel, T11 stems
(Demucs) and audio editor, T13 Video Studio with live preview and Remotion render; lyric videos
(VBP template, "MellodifAI Classico" preset); stable `/media` links; worker on the PC with local
Supabase in Docker.

**In progress:** T12 (songs from songs: "Riscrivi una parte" like Suno's Replace Section, import
from Suno, upload, cover, reference, transcription); VideoHive presets (branch
`feat/studio-videohive-presets`); Riffusion/Producer research (done, section 26).

**Auth model.** Supabase Auth with email one-time codes (`signInWithOtp`). A profile is created
only for emails in `admin_allowlist`, with role `admin` (the owner) or `customer` (family and
friends) (`supabase/migrations/20261031000001_core.sql:1-36`). There is no first-user superadmin.
Data access is RLS. The workflow RPCs (`create_project`, `approve_lyrics`, `pick_take`,
`approve_video`, `render_again`, `generate_again`, `enqueue_publish`, `retry_stage`) are
`security definer`, key on `auth.uid()` and are granted only to `authenticated`
(`20261031000006_web_flow.sql:12-131`). The web app calls them only from server actions through
`runAction` with the cookie session (`apps/web/lib/run-action.ts`, `lib/auth.ts`), which also
revalidates the affected pages.

**Lyric pipeline** (`apps/worker/src/stages/lyric-jury.ts`). Jev (`typesafe/jev-1.14`, called
through OpenRouter's `/api/alpha/decisions`) picks the tone and the writer strength; it is not a
cost router. Writers are Claude Opus 5.5 ("strong") and Sonnet 5.5 ("fast") through OpenRouter.
A jury of three judges (Jev, Claude Haiku 5.5, Gemini 3.8 Flash) scores five criteria (`topic`,
`language`, `singable`, `chorus`, `original`); a criterion passes when its mean reaches
`PASS_SCORE` 0.7. The jury is **fail-open by design**: when no judge returns a valid verdict,
`combine()` returns `available: false, passed: true` (lines 333-344), which is right for the
human-approved flow because a person reads every draft. **There is no devil's advocate in the
code** and **no direct Anthropic API client**.

**Publishing is already built** (`apps/worker/src/stages/publish.ts`): private upload with
captions and thumbnail, upload-state recovery, `containsSyntheticMedia: true` always, and
`scheduled` plus `publish_at` handled by `set_privacy`. `set_privacy` refuses to run without a
human `confirmed_by`, written by `confirm_publication` from `auth.uid()`
(`20261031000005_pipeline_hardening.sql:81-103`). `reserve_youtube_upload` caps uploads at 4 per
worker per Pacific day (lines 49-58); when the quota is reached the stage returns `retryLater`
until the Pacific reset. `enqueue_publish` accepts only an approved current `master` render.
`publications` is YouTube-only, one row per render. What is missing is the Google OAuth client:
`yt.py` in the engine repo exits without `YT_CLIENT_ID`.

**Other existing stages to reuse:** `qa.ts` (loudness gate -15 to -13 LUFS, true peak at most -1
dBTP, crushed words, a 20-frame contact sheet); `render.ts` (`render_master` and `render_hook`,
the latter already a 1080x1920 Short); `art.ts` (thumbnail and SRT); `storyboard.ts` (writes
`data/<lang>/storyboard.json`); `score-takes.ts`, which runs `tools/score_takes.py` in the engine
repo (its `fidelity` value is a Whisper intelligibility score). `approve_video` requires QA gates
and an override reason when one fails (`20261031000006_web_flow.sql:63-73`).

**Two Remotion projects.** `packages/visualizer` is this repo's Remotion project (Video Studio
visualizers; no kinetic lyrics). Kinetic lyrics and the VBP lyric video render from the external
engine repo `C:\Users\Asus\Documents\suno-remake` (`motion/`), whose path is hard-coded as
`ENGINE_ROOT` in `apps/worker/src/stages/utils.ts:6`.

**Queue.** `jobs.version_id` is NOT NULL; `jobs.stage` has a check list; `claim_job` is first in,
first out across all stages with `FOR UPDATE SKIP LOCKED`; `heartbeat_job` exists;
`requeue_stale` re-queues after 120 s without a heartbeat (`20261031000002_queue.sql`). Every new
stage needs a check-list migration, an entry in `STAGES` (`packages/shared/src/stages.ts`) and a
`stageAllowed` rule (used by `apps/worker/src/authorization.ts`). kie spending is guarded by
`versions.kie_submit_state` and `resolve_kie_submission` (admin only); `workers.kie_balance` holds
the last known balance.

**Web side.** `/media/[...path]` signs a storage URL as the session user, returns 404 without a
session, and redirects to the storage host (`127.0.0.1:54321`). The browser also talks to Supabase
directly for storage uploads and Realtime (`lib/studio/audio-files.ts`, `use-job-progress.ts`,
`use-live-refresh.ts`). Paid calls also start on the web side: `app/actions/format-style.ts`
(OpenRouter) and `app/api/transcribe/route.ts` (Groq). `apps/web/proxy.ts` calls
`supabase.auth.getUser()` on every request. `lib/rate-limit.ts` is an in-memory limiter. The
Settings page shows only the email; provider keys live in env files (`apps/worker/.env.local`,
`apps/web/.env.local`).

**Supabase config** (`supabase/config.toml`): default JWT secret and well-known demo keys (no
`signing_keys_path`), `site_url = http://127.0.0.1:3000`, email goes to the local mail catcher,
`[auth.oauth_server]` present but disabled (consent path `/oauth/consent`).

**Tests:** vitest per app; `test:db` runs `supabase/tests` against whatever stack is configured
(not pinned); e2e is pinned to a separate stack on port 45621 (a live run once spent kie credits);
fake stages in `apps/worker/src/fake/index.ts`.

**Hosting in practice:** everything runs on the PC; the README still describes Vercel plus hosted
Supabase. Postiz runs self-hosted at `http://localhost:4007`.

**Git:** the live checkout is on `build/studio-ui`; `main` is behind; worktrees live in
`E:/mellodifai/wt/`.

**Keys:** present: kie, OpenRouter, Groq, Higgsfield. Missing: Google OAuth client, Blotato,
Comfy Cloud, Gemini API, a guardrail-free OpenRouter key.

## 4. Goals, non-goals, anti-goals

Goals:
1. **Remake from a YouTube link** (section 8), end to end, in Copilot mode (pauses for approval)
   and Autopilot mode (runs through; stops only for the reasons in section 8.6).
2. **Agent access** (sections 6 and 7): one operations module used by the web UI, a versioned HTTP
   API, a `mellodifai` CLI and one MCP tool registry served over stdio and Streamable HTTP; an
   agent skill that teaches any agent the workflows.
3. **Quality system** (section 10): juries on lyrics, music, visuals and metadata, design rules in
   code, originality and distinctness gates; every gate enforced in the database before publish.
4. **Cost routing** (section 11): per-medium routing (images follow OD5; reasoning and music
   follow the driving agent's subscription, then free local engines, then cheap APIs), inside the
   per-video budget, with an atomic ledger and caps.
5. **Publishing** (section 12): YouTube (existing stage, connected and extended) plus Postiz and
   Blotato routes, app-owned schedule with veto window (OD3), Shorts.
6. **Daily improvement loop** (section 13), autonomous (OD4) and mechanically guarded.

Non-goals (now): public sign-up, payments, multi-tenant scaling, LoRA training, the social layer.

Anti-goals. A run that does any of these is a failure even if a video comes out; each is enforced
where stated:
- copying the source's melody, recordings, graphics, footage or exact lyrics (only structure,
  timing, mood and meaning carry over) - enforced by the originality gates (section 10.3) and by
  never giving source audio to a generator (section 8.4);
- spending money without the cost shown and within caps - enforced by `reserve_spend` (section
  11.5);
- publishing a video that failed a gate or has broken text, wrong lyrics, or silence - enforced
  by the database publish gate (section 10.8);
- mass-produced sameness (YouTube does not monetise repetitive content) - enforced by the
  distinctness gate (section 10.6);
- automating services whose terms forbid it: suno.com generation, the midjourney.com web UI,
  Google Flow, crawling. Two user-initiated fetches are allowed and stay so: the analysis-only
  download of a source the owner names (AC10) and the existing import of the owner's own Suno
  share links (`app/api/suno-link`, T12).

## 5. Deployment topology and what the tunnel exposes

### 5.1 One production topology (AC1)

Production is the owner's PC: Next.js production build (`next start` on `127.0.0.1:3000`) as a
service, the worker as a service, local Supabase in Docker, Postiz in Docker. A Cloudflare Tunnel
(`cloudflared` as a service) publishes a fixed set of hostnames. Vercel plus hosted Supabase is
retired as production; the README deploy section is rewritten in M1. The dev server (port 3001)
is never tunnelled. The same layout moves to a Debian server later (OD8, section 25): only the
service wrappers change (systemd instead of Windows services).

Prerequisite (owner action, section 22): move the mellodifai.com nameservers from Hostinger to
Cloudflare (free plan). Until then the remote half of M1 cannot pass its exit test; the local half
can.

### 5.2 Public hostnames and routes (deny by default)

| Hostname | Upstream | Allowed paths | Cloudflare Access |
| --- | --- | --- | --- |
| `app.mellodifai.com` | Next on `127.0.0.1:3000` | everything Next serves | On for UI pages (email one-time PIN, list mirrored from `admin_allowlist`). **Bypass** for `/api/v1/*`, `/api/mcp`, `/.well-known/oauth-protected-resource*`, `/m/*` (capability media links), `/api/health`. |
| `api.mellodifai.com` | Supabase gateway `127.0.0.1:54321` | `/auth/v1/*`, `/rest/v1/*`, `/storage/v1/*`, `/realtime/v1/*` only | Off (browser JavaScript and OAuth clients call it; protected like hosted Supabase: RLS, rotated keys, WAF rate limit of 20 requests per minute per IP on `/auth/v1/*`). |
| `post.mellodifai.com` | Postiz `127.0.0.1:4007` | everything Postiz serves | On for the admin UI. Bypass only for the social OAuth callback paths and the public uploads path that platforms fetch media from (exact paths listed in M4). |

The `cloudflared` ingress ends with a catch-all `http_status:404`. **Never exposed:** Postgres
54322, Supabase Studio 54323, the mail catcher 54324, the Supabase meta and functions routes,
ComfyUI (no auth), the worker, the dev server, Postiz's database and Redis, the Docker API.

### 5.3 Supabase hardening before any route goes live

1. Rotate the signing keys: asymmetric signing keys in a gitignored `signing_keys_path` file,
   a new random JWT secret, new anon and service keys. The exit test signs a `service_role` JWT
   with the public demo secret and expects 401 through `api.mellodifai.com`.
2. `site_url = https://app.mellodifai.com`; `additional_redirect_urls` = the app host plus
   `http://127.0.0.1:3000/**` and `http://localhost:3000/**` for local use; API and Auth external
   URLs set to `https://api.mellodifai.com`.
3. A real SMTP sender for one-time codes (owner action), since the mail catcher is not reachable
   from outside.
4. Postiz with `DISABLE_REGISTRATION=true` after the owner's account exists.
5. The browser's `NEXT_PUBLIC_SUPABASE_URL` becomes `https://api.mellodifai.com`; the server keeps
   the internal URL.

### 5.4 Media through the tunnel

- `/media/...` stops redirecting to the storage host: it keeps the session check and **streams**
  the file through Next (with HTTP Range support), so it works from any host and never leaks a
  storage URL.
- `/m/<token>` is a **capability link** for external fetchers (Postiz, Blotato, platforms): a
  random 256-bit token mapped to one render, expiring (default 72 h), revoked on veto and 24 h
  after the post is confirmed, streamed by Next. Only its hash is stored.
- Secrets never reach the browser; the service key never leaves the PC.

### 5.5 Session proxy

`apps/web/proxy.ts` excludes `/api/v1`, `/api/mcp`, `/m/`, `/.well-known/` and `/api/health` from
its matcher, so bearer-token routes pay no session lookup and are not blocked by it.

## 6. Identity, scopes and authorization

### 6.1 Principals

| Principal | Credential | How it reaches the database |
| --- | --- | --- |
| Person in the web UI | Supabase cookie session | Server actions through the operations module (unchanged identity). |
| Agent with a personal access token (PAT) | `Authorization: Bearer mdf_pat_...` | Operations module mints an internal JWT (6.3). |
| Remote agent (claude.ai, ChatGPT) | OAuth 2.1 access token from Supabase's OAuth server | Only at `/api/mcp`; the operations module mints an internal JWT (6.3). Direct database use is refused (6.4). |
| Autopilot | System token row, no secret outside the worker | Worker-only RPCs (6.5). |
| Worker | service role (on the PC only) | As today. |

### 6.2 Scopes and roles

- `read`: read the owner's own songs, runs, reports and costs.
- `create`: actions with no paid call (create, edit, pick, render, stems, visualizer, veto).
- `spend`: any action that reserves paid spend (section 11.5).
- `publish`: schedule publishing (always through the veto window; there is no "publish now"
  operation in the API).
- Never grantable to any token: token and grant management, caps, policies, flags, gates, the
  loop kill switch, `resolve_kie_submission`. These exist only in Settings with a cookie session
  of an `admin`.
- Role mapping: `admin` may grant all four scopes. `customer` (family and friends) may hold
  `read` and `create` only; their paid calls in the web UI are limited by a per-user daily cap
  (default 0.10 USD, enough for small text calls such as "Formatta con AI"; music generation only
  when the owner raises it); their tokens never get `spend`; never `publish`; never local engines
  (standing rule).

### 6.3 Internal JWT minted by the operations module

After the PAT hash lookup (or the OAuth grant lookup), the operations module mints a Supabase JWT
signed with the project signing key, lifetime 60 s, never returned to the caller, with claims
`sub` = the token owner, `role = authenticated`, `via = ops`, `actor` (`pat` or `oauth`),
`token_id`, `scopes`. The existing RPCs keep working unchanged because `auth.uid()` is the owner.

New SQL helper `require_scope(scope text)`: when the JWT carries `token_id`, it checks that the
scope is in the claim and that the token row is not revoked; when it carries neither `token_id`
nor `actor`, it is a first-party cookie session and passes. Every RPC that spends or publishes
calls it first (a new migration wraps them; T12's RPCs are wrapped after T12 lands).

### 6.4 Remote MCP authorization (AC2)

- **Authorization server:** Supabase Auth's OAuth 2.1 server (`[auth.oauth_server] enabled = true`,
  dynamic client registration on, consent page at `https://app.mellodifai.com/oauth/consent`),
  with PKCE required. Its metadata is served by Supabase under `https://api.mellodifai.com`; the
  exact path is confirmed in M1 and written into the protected resource metadata.
- **Resource server:** `/api/mcp` serves Protected Resource Metadata at
  `/.well-known/oauth-protected-resource` (and the path-suffixed variant for `/api/mcp`), and
  answers 401 with `WWW-Authenticate: Bearer resource_metadata=...`. It validates tokens against
  Supabase's JWKS. No token passthrough: the upstream token is never forwarded.
- **Audience binding:** if Supabase's server honours RFC 8707 resource indicators, `/api/mcp`
  requires `aud = https://app.mellodifai.com/api/mcp`. Either way, a token is accepted only when it
  maps to a live grant row (6.6), and the PostgREST pre-request hook (below) refuses OAuth tokens
  everywhere else, which gives the same effect.
- **Direct use refused:** a PostgREST `db_pre_request` function rejects any JWT that carries the
  OAuth client claim (exact claim name confirmed in M1) or a `token_id` without `via = ops`.
  Storage write policies refuse the same tokens. The M1 exit test calls PostgREST directly with an
  OAuth access token and expects a refusal.
- **Consent screen:** shows the client name, its redirect host and the requested scopes as
  checkboxes (default `read` and `create`). `spend` and `publish` are shown only to an `admin` and
  need a second confirmation (typing the client name). Consent writes the grant row.
- **Lifetimes:** access token 1 h (`jwt_expiry = 3600`), refresh rotation on. Revoking in Settings
  > Agenti ("Agents") revokes the Supabase authorization and the grant row; `/api/mcp` checks the
  row on every call, so revocation is immediate.

### 6.5 Autopilot as an explicit actor

- An `autopilot_policies` row per owner (enabled, allowed tiers, per-run cap, runs per day, premium
  budget, publish allowed, platforms). Only the owner edits it in Settings > Autopilota
  ("Autopilot").
- A system token row (`kind = autopilot`) per owner, so the ledger and audit log charge Autopilot
  by name.
- Worker-only RPCs (`autopilot_approve_lyrics`, `autopilot_pick_take`, `autopilot_approve_video`,
  `autopilot_schedule_publish`), granted to `service_role` only. Each checks: policy enabled, the
  run is in Autopilot, the latest jury report for that stage has `available = true` and
  `passed = true` with no must-fix item, and the caps hold. They record `confirmed_by` = the policy
  owner and a new column `confirmed_via = 'autopilot:<policy id>'`. `set_privacy` accepts
  `confirmed_via = autopilot` only when the bundle's veto window has expired with no veto.
- Autopilot never uses `approve_video`'s override path: a failed QA gate stops the run.

### 6.6 Token and grant records

One table `agent_tokens` holds PATs, OAuth grants and system tokens: owner, kind (`pat`, `oauth`,
`autopilot`), name (shown in the audit log), hash (PATs only; shown once at creation), OAuth client
id (grants), scopes, daily spend cap in USD, `remote` flag (PATs are local-only unless the owner
ticks "remote"; a request is remote when it arrives with the public Host), created, last used,
revoked. Managed in Settings > Agenti.

### 6.7 Rate limits

A per-token counter in Postgres at the operations layer: 60 reads per minute, 10 writes per
minute, 20 spend reservations per hour (defaults). Excess returns 429 with `Retry-After`. The
in-memory limiter stays for browser-only routes.

### 6.8 Untrusted content (prompt injection boundary)

Captions, titles, descriptions and transcripts of a source video are untrusted. They are stored
with `untrusted = true`, fill only fixed template fields in prompts (never instructions), are
wrapped and labelled in MCP resources (annotation `untrusted_source`), and are passed to the loop
only as quoted data blocks truncated to 2 KB per item. The blast radius is bounded by design: no
API operation can create tokens, raise caps, change policies, disable gates or publish without the
veto window (6.2).

## 7. Operations layer, HTTP API, CLI and MCP

### 7.1 One implementation

- `apps/web/lib/ops/*`: one server module per operation. It validates input with the shared zod
  schema, checks the scope, reserves spend when needed, calls the RPC, and revalidates the same
  paths `runAction` revalidates today. **The server actions call it**, the `/api/v1` handlers call
  it, and the MCP tools call it, so the paths cannot drift.
- Schemas move from `apps/web/app/actions/schemas.ts` to `packages/shared/src/ops/` (zod is already
  there). Several schemas belong to T12 (`SectionEditInput`, `ImportSongInput`,
  `SongSourceInput`), so the move happens **after T12 merges**; until then `packages/shared`
  re-exports nothing from the app and M1 adds only new schemas.
- One MCP tool registry (`apps/web/lib/mcp/*`) served at `/api/mcp` over Streamable HTTP.
- The CLI (`packages/cli`) is a thin HTTP client of `/api/v1`. `mellodifai mcp` is the **stdio
  transport**: a bridge that forwards MCP JSON-RPC from stdio to `/api/mcp` with the PAT. Neither
  ever talks to the database. Local agents point the CLI at `http://127.0.0.1:3000`.

### 7.2 HTTP contract

- Versioning: `/api/v1` changes are additive only; a breaking change ships as `/api/v2` and v1
  stays 90 days.
- Error envelope: `{ "error": { "code", "message", "details"?, "retry_after"? } }` with codes
  `unauthorized`, `forbidden_scope`, `not_found`, `conflict`, `validation`, `cap_exceeded`,
  `rate_limited`, `provider_unavailable`, `ambiguous_spend`, `internal`.
- `Idempotency-Key` header required on every POST that enqueues or spends; stored 24 h per token
  with the request hash and the response.
- Pagination: `?cursor=&limit=` (max 100).
- Long work returns `{ "job_id" }` or `{ "remake_id" }`. Progress: SSE at
  `/api/v1/jobs/{id}/events` from `job_events`, with a keepalive comment every 25 s (Cloudflare
  drops idle proxied connections after about 100 s); MCP clients poll `job_status`.
- `/api/mcp` runs **stateless** (no server-side session state), sends SSE keepalives every 25 s,
  and therefore survives a tunnel or Next restart.
- Uploads: `POST /api/v1/uploads` returns a signed upload URL; the file is validated after upload
  (section 9.4) before any operation uses it.

### 7.3 Operations catalogue (names are fixed now)

| Operation | HTTP | MCP tool | Scope | Spends | Returns |
| --- | --- | --- | --- | --- | --- |
| List songs | `GET /api/v1/songs` | `songs_list` | read | no | page |
| Get song (versions, takes, renders, juries, costs) | `GET /api/v1/songs/{id}` | `song_get` | read | no | object |
| Create song from an idea | `POST /api/v1/songs` | `song_create` | create, plus spend for paid lyric calls | OpenRouter, small | job |
| Approve lyrics (starts generation) | `POST /api/v1/versions/{id}/lyrics/approve` | `lyrics_approve` | spend | kie | job |
| Generate again | `POST /api/v1/versions/{id}/generate` | `song_generate_again` | spend | kie | job |
| Pick take | `POST /api/v1/versions/{id}/takes/{take}/pick` | `take_pick` | create | no | job |
| Make or re-render video | `POST /api/v1/versions/{id}/video` | `video_make` | create | no | job |
| Approve video | `POST /api/v1/versions/{id}/video/approve` | `video_approve` | create | no | object |
| Section edit: request, keep, discard | `POST /api/v1/versions/{id}/section-edits[/{e}/keep or /discard]` | `section_edit_request`, `section_edit_keep`, `section_edit_discard` | spend (request), create | kie | job |
| Stems | `POST /api/v1/versions/{id}/stems` | `stems_request` | create | no | job |
| Visualizer | `POST /api/v1/versions/{id}/visualizer` | `visualizer_request` | create | no | job |
| Upload, import audio | `POST /api/v1/uploads`, `POST /api/v1/songs/import` | `upload_create`, `song_import` | create | no | URL, job |
| Playlists, reactions, rename, trash, restore | `/api/v1/playlists/...`, `/api/v1/songs/{id}/...` | `playlist_create`, `playlist_add`, `playlist_remove`, `playlist_reorder`, `playlist_rename`, `playlist_delete`, `song_react`, `song_rename`, `song_trash`, `song_restore` | create | no | object |
| Format style | `POST /api/v1/tools/format-style` | `style_format` | spend | OpenRouter, small | object |
| Transcribe | `POST /api/v1/tools/transcribe` | `audio_transcribe` | spend | Groq, small | object |
| Start remake | `POST /api/v1/remakes` | `remake_start` | create, plus spend past R2 | analysis | remake |
| Remake status (all stages) | `GET /api/v1/remakes/{id}` | `remake_status` | read | no | object |
| Stage approve, regenerate, skip | `POST /api/v1/remakes/{id}/stages/{stage}/{action}` | `remake_stage_approve`, `remake_stage_regenerate`, `remake_stage_skip` | create (regenerate of a paid stage: spend) | depends | job |
| Driver lease | `POST/DELETE /api/v1/remakes/{id}/driver` | `remake_driver_claim`, `remake_driver_release` | create | no | object |
| Submit artefact (lyrics, timeline, image) | `PUT /api/v1/remakes/{id}/artefacts/{kind}` | `artefact_submit` | create | no | validation report |
| Timeline get, patch | `GET/PATCH /api/v1/versions/{id}/timeline` | `timeline_get`, `timeline_patch` (JSON Patch with expected revision) | read, create | no | object |
| Schedule publish | `POST /api/v1/versions/{id}/publish` | `publish_schedule` | publish | no | schedule |
| Veto | `POST /api/v1/schedules/{id}/veto` | `publish_veto` | create | no | object |
| Costs | `GET /api/v1/costs` | `costs_get` | read | no | object |
| Job progress | `GET /api/v1/jobs/{id}/events` (SSE) | `job_status` | read | no | stream, object |
| Notifications | `GET /api/v1/notifications` | `notifications_list` | read | no | page |
| Loop morning report | `GET /api/v1/reports/loop/latest` | `loop_report_get` | read | no | object |

Local engine choice is accepted only when the token owner is `admin`. MCP resources:
`mellodifai://songs/{id}`, `mellodifai://remakes/{id}`, `mellodifai://remakes/{id}/blueprint`,
`mellodifai://jury/{id}`, `mellodifai://notifications`. MCP prompts: `remake`, `new_song`,
`adapt_language`. Editor actions that T12 and later tasks add (cut, fade, normalise, replace,
regenerate a section, re-render, storyboard changes) join the catalogue with the same pattern.

### 7.4 CLI

Commands: `login`, `songs`, `create`, `remake <url>`, `status <id> --watch`, `approve`,
`regenerate`, `video`, `publish`, `veto`, `costs`, `mcp`; `--json` on all. `login` stores a PAT
created in Settings > Agenti in the OS credential store when available, else in
`%APPDATA%\mellodifai\credentials.json` (Windows, user-only ACL) or
`~/.config/mellodifai/credentials.json` (mode 0600).

### 7.5 Agent skill

A skill folder plus `AGENTS.md` (in `packages/cli/skill/`) describing the workflows, the cost
rules, the scopes, the driver lease and how to treat untrusted resources; installable in Claude
Code, Codex and Cursor.

## 8. Remake workflow ("Rifai da YouTube", "Remake from YouTube")

### 8.1 Modes

Two independent settings per run:

- **Mode** (who approves): **Copilot** pauses at the pause points (8.5) for a person or an agent
  to approve; **Autopilot** approves automatically through the Autopilot actor (6.5) and stops
  only for the reasons in 8.6. Autopilot needs the policy row enabled and is available from M5.
- **Tier** (what may cost money), defined only here:

| Tier | Allowed paid routes | Cost rule | Autopilot |
| --- | --- | --- | --- |
| free | none (ACE-Step local music, GPT Image via codex, local images, agent or local reasoning) | 0 USD; a step with no free route pauses | yes |
| standard (default) | kie Suno, OD5 image routes 1-4, cheap OpenRouter models | per-run hard cap 0.25 USD, median target 0.15 USD | yes |
| premium | standard plus Higgsfield shots and Comfy Cloud workflows | per-run budget set at start; cost shown before confirm in Copilot | only with a premium budget above 0 in the policy row |

Within a tier, image routes keep the OD5 order; the tier only removes routes (free mode skips
routes 1, 3 and 4).

### 8.2 Who reasons and who pays

| Driver | Mode | Lyrics (R3) and timeline (R5) | Juries | Paid by |
| --- | --- | --- | --- | --- |
| Person in the UI | Copilot | app's internal writers (existing pipeline) | app | owner's OpenRouter key, ledger |
| Agent holding the driver lease | Copilot or Autopilot | the agent writes and submits artefacts, or asks the app to write | app (always) | agent's own subscription for authoring; owner's key for juries |
| Nobody (lease absent or expired) | Autopilot | app's internal writers | app | owner's key |

Juries always run in the app, with the app's pinned judges; an agent can never submit its own
jury scores. The driver lease (`remakes.driver`, `driver_lease_until`) lasts 15 minutes and renews
on every call by its holder. When it expires: in Autopilot the app's writer takes over at the next
stage boundary; in Copilot the run waits at the pause point and a notification goes out.

### 8.3 Run creation and job mapping

`remake_start` creates the project and one version per target language at once (status
`analysing`, a new value of `versions.status`), plus a `remakes` row. R1 and R2 run as jobs on the
primary version (so `jobs.version_id` stays NOT NULL) and write the analysis to the remake; the
other versions start at R3 when the analysis is ready. Stage runs are tracked in `stage_runs`
(section 15).

| R-stage | Job stage | New or existing | Resource class |
| --- | --- | --- | --- |
| R1 ingest | `remake_ingest` | new | net |
| R2 analyse | `remake_analyse` | new | gpu (Demucs), then net (vision model) |
| R3 rewrite lyrics | `draft_lyrics` with a remake mode | existing, extended | net |
| R4 music | `generate_song`, then `score_takes` | existing | net |
| R4b timing of the new take | `timing`, plus section detection | existing, extended | cpu |
| R5 composition | `compose_timeline` | new | net or cpu |
| R6 images | `images` | new | net or gpu |
| R7 render | `render_master`, `render_hook`, `art`, `qa` | existing, extended to render the timeline | gpu |
| R8 visual jury | `visual_jury` | new | net |
| R9 publish | `schedule_publish`, `publish`, `set_privacy` | new plus existing | net |

Each new stage gets the check-list migration, a `STAGES` entry, a `stageAllowed` rule and a
`resource_class` (section 14).

### 8.4 Stages

#### R1 Ingest

Downloads audio, a low-resolution video for frames, captions and metadata of the named source to
`<runtime root>/remakes/<id>/` (runtime root from `MELLODIFAI_ROOT`, default `E:/mellodifai`).
Analysis only (AC10). Transcript from captions, else Whisper through Groq. Frames at scene cuts
(at most 48) plus 1 fps contact sheets. Timeout 10 minutes.

#### R2 Analyse

- Music: BPM, key, time signature, sections with timestamps and labels, downbeats, vocal type,
  instrumentation, energy curve (Demucs on the source plus a beat and section analyser chosen by
  the builder within section 24's constraints). Source audio is input to analysis tools only;
  it is **never given to a generator**.
- Lyrics: a meaning map per section (theme, story beat, imagery, emotional arc, hook idea), written
  as abstract descriptions, never as quoted lines.
- Video: the **video blueprint** (section 9.1) from the frames and contact sheets, by
  `google/gemini-3.8-flash` through OpenRouter (one call, at most 12 contact-sheet images, output
  validated against the blueprint schema), budget 0.01 USD; when an agent holds the lease it may
  submit the blueprint instead.
- On pass, the source audio and video are deleted (section 14.3); the analysis JSON stays.

#### R3 Rewrite lyrics

Per section, new lines in the target language that carry the meaning map. Syllable fit: source
syllables per line come from the word timestamps; the new line's count comes from a syllabifier
(pyphen plus language rules for Latin-script languages; morae for Japanese; characters for
Chinese) and must be within plus or minus 1 of the source line; stress is left to the jury.
Optional cultural adaptation arrives with T17 (M4). Then the originality gate (10.3) and the lyric
jury with the devil's advocate (10.2). Up to 3 rounds; failing lines are rewritten, passing lines
kept.

#### R4 Music

A new song from text only: style tags, BPM and structure from R2, lyrics from R3 (no artist
names). kie Suno by default (one generate call returns two takes, about 12 credits); ACE-Step
local in free tier (it accepts duration and BPM, so it can follow the timing more closely). The
source audio is never given to a generator (cover and reference stay only for the owner's own or
CC BY/BY-SA songs, T12, T17). Acceptance per take: Whisper word error rate against the intended
lyrics at most 0.25 (the existing `score_takes` fidelity), the timing rule of AC11 (same section
sequence, tempo within 5%, section durations within 15%), then the existing QA loudness and peak
gates after mastering. Up to 2 generations in standard tier. The kie never-resend rule holds
(section 8.6).

#### R4b Timing of the new take

The existing `timing` stage computes word timing on the chosen take; section detection maps the
take's sections to the blueprint's section ids. Kinetic lyrics and shot timing use the new take's
timing, not the source's.

#### R5 Composition

Writes the **timeline document** (section 9.2) from the blueprint retimed to the new take: each
blueprint shot carries its section id and its relative position in the section, so the same shot
rhythm lands on the new song. Built only from whitelisted building blocks (presets, kinetic lyric
styles, the VideoHive looks rebuilt in code, transitions) and generated images (R6). Author: the
lease-holding agent, or the app's internal writer: a deterministic mapper from blueprint layout
and motion tags to building blocks, with one call to the fast writer (Sonnet 5.5 through
OpenRouter, budget 0.01 USD per run) that fills only block parameters within the schema.

#### R6 Images

Prompts per shot that needs an image (the blueprint's `imageNeed`), written from the blueprint and
the meaning map, never from the source frames' content. Routed by section 11.3, at most 8
generated images per video in standard tier, 3 thumbnail candidates. Output also feeds the
thumbnail generator.

#### R7 Render

Local Remotion 16:9 master at 1080p (4K on request), 9:16 Short from the hook section (rule below)
of at most 3 minutes with a full-frame layout (not letterboxed), 3 thumbnail candidates, captions
(SRT per language from word timing), then the existing QA stage. Previews move to 1080p. Hook
section: the R2 section labelled `hook` or `chorus` with the highest energy; else the energy peak;
else the meaning map's hook idea.

#### R8 Visual jury

Section 10.4 on sampled frames, the contact sheet and the thumbnails, plus the visual originality
(10.3) and distinctness (10.6) gates. Fix and re-render until pass, up to 3 rounds.

#### R9 Publish

Section 12. In Copilot, the person or agent approves the publish kit; in Autopilot,
`autopilot_schedule_publish` does. Either way the bundle enters the veto window (OD3).

#### The Console

The song page shows every stage with inputs, outputs, jury scores, devil's advocate notes, cost so
far and the stop reason, with buttons to approve, edit, regenerate or skip; agents get the same
through `remake_status` and the remake resource.

### 8.5 Stage state machine and pause points

States of a `stage_runs` row: `pending`, `running`, `awaiting_approval`, `passed`, `failed_jury`,
`capped`, `skipped`, `cancelled`, `error`.

- `pending -> running` when the job is claimed; `running -> passed` when the stage's gates pass and
  the mode is Autopilot or the stage has no pause point; `running -> awaiting_approval` at a pause
  point in Copilot; `awaiting_approval -> passed` on approve; `running -> failed_jury` after the
  round cap; `running -> capped` when a reservation is refused; `running -> error` after the retry
  budget; any non-final state `-> cancelled` on cancel.
- **Approve** marks the stage passed and enqueues the next stage. **Edit** stores the person's or
  agent's artefact as a new revision and re-runs that stage's gates (not its generator).
  **Regenerate** starts a new round of the same stage (counts toward the round cap and reserves
  spend). **Skip** is allowed only for R6 (falls back to the preset's own art) and the optional
  T17 adaptation; **R3's originality gate, R8 and the publish gate can never be skipped**.
- Every approve, edit, regenerate or skip carries `expected_stage_version`; a mismatch returns
  `conflict`, so a person and an agent approving at once cannot both win.
- Default Copilot pause points: after R3 (lyrics, the existing `lyrics_review`), after R4 (takes,
  `takes_review`), after R8 (video, `video_review`), and before R9 (publish kit). The existing
  version-status checkpoints and `job_events.progress` are reused.
- A mode change applies at the next stage boundary. Switching to Autopilot needs the policy row and
  every earlier gate passed.
- Resume after a worker restart: jobs are re-claimed through `requeue_stale`; stages longer than
  60 s heartbeat every 30 s (`heartbeat_job`), so the 120 s threshold never re-runs a live GPU
  stage.

### 8.6 Stop reasons, errors, retries and round caps

The one Autopilot stop list (also the values of `stop_reason`): `passed`, `round_cap`
(jury failed after the cap), `jury_unavailable` (fail-closed, 10.1), `cost_cap`,
`provider_exhausted` (every allowed route failed or is exhausted), `ambiguous_spend` (a kie
submission whose outcome is unknown; never auto-resolved), `owner_cancelled` (including a veto),
`error` (permanent error, or transient errors past the retry budget). The veto window is not a
stop: R9 waits in it by design.

- Round caps: R3 3 rounds, R4 2 generations, R8 3 rounds, thumbnails 2 rounds.
- Transient errors (network, 5xx, 429, timeouts): 3 attempts with backoff of 30 s, 2 min and 10 min;
  they do not count as rounds. Permanent errors (validation, refusal, content policy, 4xx): no
  retry; image routes fall through, other stages stop with `error`.
- Timeouts that trigger the fallthrough: OpenRouter text 90 s, vision 120 s; kie submit 30 s and
  poll up to 10 minutes; Midjourney through kie 5 minutes; `codex exec` image 4 minutes; Nano
  Banana 90 s; OpenRouter image 120 s; local image 3 minutes; yt-dlp 10 minutes; Remotion master
  45 minutes with heartbeats.

### 8.7 Remake defaults

A per-user "Remake defaults" profile in Settings > Remake (owner edits; the CLI and `remake_start`
can override any field): target languages (default the source's language translated to Italian),
vocal gender and style (default from R2), engine (kie Suno), tier (standard), preset and brand
(T15 brand kit when it exists, else MellodifAI Classico), channel and platforms (default the
owner's YouTube channel only; family and friends have no publish scope, so their remakes stop
before R9), slot policy (12.2).

## 9. Video blueprint and timeline document

### 9.1 Video blueprint schema v1

Location: `packages/shared/src/remake/blueprint.ts` (one package for all remake schemas; the
task-24 brief's `packages/remake` was never created; the brief is to be updated to point here when
that task starts). For
remakes the blueprint replaces `storyboard.json`; `storyboard.json` stays for the VBP style.

```ts
const Blueprint = z.object({
  schemaVersion: z.literal(1),
  source: z.object({ videoId: z.string(), url: z.string().url(), durationS: z.number(), analysedAt: z.string() }),
  music: z.object({
    bpm: z.number(), key: z.string(), timeSig: z.string(),
    sections: z.array(z.object({
      id: z.string(),
      label: z.enum(["intro", "verse", "pre", "chorus", "hook", "bridge", "outro", "other"]),
      startS: z.number(), endS: z.number(), energy: z.number().min(0).max(1), bars: z.number().int(),
    })),
    downbeatsS: z.array(z.number()),
    vocal: z.enum(["male", "female", "duet", "choir", "none"]),
    instrumentation: z.array(z.string()).max(12),
  }),
  shots: z.array(z.object({
    id: z.string(), sectionId: z.string(),
    startS: z.number(), endS: z.number(), offsetInSection: z.number().min(0).max(1),
    layout: z.enum(["full_bleed", "centered_title", "lower_third", "split", "grid", "visualizer_center", "text_only"]),
    typographyRoles: z.array(z.object({
      role: z.enum(["title", "lyric", "caption", "credit"]), weight: z.enum(["light", "regular", "bold", "black"]),
      case: z.enum(["upper", "title", "sentence"]), position: z.enum(["top", "center", "bottom", "left", "right"]),
    })).max(4),
    palette: z.array(z.string().regex(/^#[0-9a-f]{6}$/i)).max(6),
    motion: z.object({
      camera: z.enum(["static", "push_in", "pull_out", "pan", "shake"]), cutOnBeat: z.boolean(),
      kineticText: z.enum(["none", "word_pop", "line_slide", "typewriter", "scale_pulse"]),
      visualizer: z.string().nullable(),
    }),
    transition: z.enum(["cut", "crossfade", "whip", "zoom", "glitch"]),
    overlays: z.array(z.object({ kind: z.enum(["lyric", "title", "logo_slot", "shape"]), position: z.string() })).max(6),
    imageNeed: z.enum(["none", "background", "subject"]),
  })).max(200),
  global: z.object({
    palette: z.array(z.string()).max(8), aspect: z.enum(["16:9", "9:16"]),
    typeScale: z.object({ basePx: z.number(), ratio: z.number() }),
  }),
});
```

The blueprint records style descriptors only: no source text, no source frames, no font or brand
names of the source.

### 9.2 Timeline document (OD6, AC3)

Location: `packages/shared/src/timeline/`. One generic Remotion composition `TimelineVideo` in
`packages/visualizer` draws it; the web editor (M3), agents (`timeline_patch`) and R5 edit the same
document. Revisions are append-only (`timelines` table, section 15), each with its author.

- Fields: `schemaVersion`, `fps` (30), `size`, `durationFrames`, `audio.takeId`, `palette`,
  `typeScale`, `scenes[]` (id, start and end frame, section id, `block` from an enum of
  whitelisted building blocks, `params` validated by that block's own zod schema, `layers[]` of
  kind text, image, video or shape, `transitionIn`, `transitionOut`), `assets[]` (id, kind, `ref`).
- Data only: no code, no imports, no HTML, no CSS strings, no URLs. `ref` points only into the
  app's storage buckets or the generated-images store. Fonts come from a whitelist. Text fields
  have length limits.
- Limits: at most 200 scenes, 50 assets, 10 minutes.
- Validated at the API (operations module) and again in the worker before every render. Only the
  app's own components render it.

### 9.3 Which Remotion project

`TimelineVideo` and every building block live in `packages/visualizer`. In M2 the kinetic lyric
components and the VBP and Classico lyric video move from the engine repo's `motion/` into
`packages/visualizer` as building blocks (the owner's own code). Until they move, existing lyric
videos keep rendering from the engine repo. `ENGINE_ROOT` becomes the config value
`MELLODIFAI_ENGINE_ROOT` (portability rule, section 25).

### 9.4 Agent-supplied files

Images submitted through `artefact_submit` or uploads: type sniffed (PNG, JPEG, WebP only), at
most 20 MB and 8192 px per side, decoded and re-encoded by the server (which strips metadata and
polyglot payloads), then stored. Anything else is rejected.

## 10. Quality system

### 10.1 Jury rules that apply to every jury

- Aggregation: per criterion, the mean across valid judges for text juries (as today) and the
  median for vision juries; a jury passes when every criterion reaches its threshold and no
  must-fix item is open.
- **Availability:** the existing lyric jury stays fail-open in the human-approved Copilot flow,
  and the Console shows "jury unavailable" when it happens. In Autopilot, and for every new jury,
  "jury unavailable" (no valid verdict) is a failure: the run stops with `jury_unavailable`
  (fail-closed). The Autopilot RPCs check `available = true` (6.5).
- Judge model ids are pinned in config and recorded in every `jury_reports` row with the rubric
  version.

### 10.2 Lyrics jury (existing, extended)

Today: five criteria (`topic`, `language`, `singable`, `chorus`, `original`), threshold 0.7, judges
Jev, Haiku 5.5, Gemini 3.8 Flash. Extended in M2 with `meaning_fidelity` (against the meaning map),
`timing_fit` (syllable report from R3 attached), `youtube_safety`, and a **devil's advocate**,
which is new work: one model (Claude Sonnet 5.5 through OpenRouter) prompted to argue that the
draft must not pass, returning objections tagged `must_fix` or `note`. Its power: a `must_fix`
objection in the categories originality, safety or wrong language blocks the pass and triggers the
next round; other objections are notes shown in the Console. It has no score vote.

### 10.3 Originality (the copyright safety line, owned by this document)

Starting values below are **binding** from M2. Calibration on the golden set (M3) may only tighten
them automatically; loosening any value is an owner decision. The loop can never change them
(section 13.3).

Lyrics, per new line against each source line and against a literal machine translation of the
source line into the target language:
- lexical: character 4-gram Jaccard and ROUGE-L; either above **0.35** fails the line;
- semantic: cosine similarity with LaBSE (local, CPU, Apache 2.0); above **0.80** against the
  translated source line fails the line;
- exact phrase: the new title and hook contain no sequence of 3 or more words (normalised) from
  the source title or hook or their translation.

Meaning fidelity is measured at a different level, which resolves the tension with originality:
each new **section** must reach cosine **0.55** or more against the section's meaning map (an
abstract description, not the source lines). So a section can mean the same thing while each line
is new.

Visuals, at aligned timestamps (same relative position in the same section) between the new render
and the source frames:
- pHash Hamming distance of at least **12 of 64 bits**;
- DINOv2 (ViT-S/14, Apache 2.0) cosine at most **0.85**.

Allowed to match by design: shot timing and cut points, the layout grid, palette family (not exact
colours), the motion vocabulary.

### 10.4 Visual jury

- Judges: `google/gemini-3.8-flash` and `anthropic/claude-haiku-5.5` in rounds 1 and 2;
  `anthropic/claude-opus-5.5` added in the final round only (all through OpenRouter, ids pinned).
- Input: one frame at the middle of each shot plus one at each chorus downbeat peak, at most 24
  frames at 768 px on the long side; the existing 20-frame contact sheet; each thumbnail rendered
  at 320x180 (phone size).
- Rubric v1 (scores 0 to 1, pass at 0.7 on each): hierarchy and focal point, type legibility,
  colour harmony, motion rhythm against beats, consistency across shots, brand fit (T15 brand kit
  when it exists), absence of AI artefacts.
- Computed in code, not judged: text contrast at least 4.5:1 (3:1 for text 48 px or larger),
  safe areas (16:9: text inside the 90% title-safe box; Shorts: nothing important in the bottom 20%
  or right 12% where YouTube's UI sits), minimum type size, minimum on-screen time per lyric line
  (its sung duration plus 0.2 s lead), beat-quantised cuts (within 1 frame of a downbeat when
  `cutOnBeat`).
- Must-fix (blocks regardless of scores): misspelt or garbled text (OCR on the frames against the
  intended text), AI artefacts flagged by two judges, any safe-area or contrast failure.
- Cost inside the budget of section 11.6 (0.01 USD per video for rounds 1 and 2; the final round's
  premium judge is part of the retry reserve).

### 10.5 Music checks

Per take (R4): word error rate, the AC11 timing rule, QA loudness and peak. A listening jury by a
model is not added: the measured checks cover it today; it can be a later hypothesis of the loop.

### 10.6 Distinctness (no mass-produced sameness)

The new video's contact-sheet embeddings (DINOv2) against the last 20 published videos: mean cosine
at most **0.92** (looser than the source check, because a consistent channel style is wanted), and
the same preset used in at most 2 of the last 5 published videos.

### 10.7 Design rules in code

The motion rules are copied into the repo as `docs/design/motion-rules.md` in M3 (adapted from the
owner's deck playbook `C:\Users\Asus\Documents\Claude\Projects\ita\DESIGN-MOTION.md`), so this
repo does not depend on that file. In short: animated numbers are slot-locked (fixed-width digits
that never shift the layout), decorative loops close seamlessly, every element is legible at rest
(no information visible only mid-animation), easing comes from a small fixed set, and layouts keep
fixed safe margins. Video additions: type scale from the timeline's `typeScale`, the safe areas and
timing minimums of 10.4.

### 10.8 The publish gate in the database

`approve_video` already requires QA gates. M3 extends the gate: a render can be approved, and
`enqueue_publish` and `schedule_publish` accept a version, only when the latest `jury_reports` rows
for lyrics (remakes), originality, visual jury, distinctness and thumbnail are `available` and
`passed`, and QA passed. The human override reason stays possible for a person in Copilot (it is
recorded and shown); Autopilot has no override.

## 11. Providers, routing and cost

### 11.1 Reasoning

When an agent drives, it reasons on its own subscription and the app pays nothing for authoring
(section 8.2). The app's own reasoning uses OpenRouter: Jev for tone and writer choice, Opus and
Sonnet writers, the judges above. A direct Anthropic API client (the owner holds 200 USD of Claude
API credits) is **new work** in M2, used only when OpenRouter fails for a writer call, recorded in
the ledger like any provider.

### 11.2 Music

kie Suno default (about 12 credits per generate call, two takes); ACE-Step 1.5 local (free tier);
YuE2 owner-only; Mureka or ElevenLabs Music later (T20 area) if the owner adds keys.

### 11.3 Images (OD5)

Each route falls through to the next on refusal, timeout, usage limit, error, or when the
per-video image sub-budget (11.6) is spent:

1. **Midjourney through kie.ai** (unofficial; owner accepted). One call returns a 4-image grid, so
   one call gives 4 candidates. Off until the owner confirms kie Midjourney access and price
   (section 22). "Importa da Midjourney" ("Import from Midjourney": drop or paste his own MJ
   images) stays available for hand-made picks.
2. **GPT Image through `codex exec`** on the PC, under the owner's Windows account, with the codex
   binary path and model from config (today `-m gpt-5.6-terra`). Exhaustion is detected from a
   non-zero exit plus the usage-limit message, then the route is marked exhausted until the reset
   time in the message (else 5 h). A refusal is detected when no image file is produced. 0 USD,
   counted by calls.
3. **Nano Banana** (Gemini's image model) through the Gemini API with the owner's key. M3 starts by
   recording the free-tier limit and the paid price, with source and date, in the price book; until
   then the route is off.
4. **OpenRouter image models** from an allowlist in config; a model is allowed only when its price
   is in the price book.
5. **Local open models** (T18 bake-off winner in the existing ComfyUI) as the free fallback.

Provenance: every image has an `images` row (provider, model, prompt hash, cost entry, size,
sha256) and the same data embedded in the file's metadata. The visual jury picks among candidates.

**Shared ChatGPT plan quota.** Route 2, the loop's Codex runs and the owner's own Codex use share
one plan. Rules: production image jobs have priority; the loop runs only in its night window and
stops at the first usage-limit message until the next night; route 2 marks itself exhausted as
above and falls through.

### 11.4 Video

Remotion local (free) for every tier. Premium tier adds Higgsfield API shots (owner has a key) and
Comfy Cloud workflows (T14), each with cost shown before confirm in Copilot and drawn from the
premium budget in Autopilot. Generated footage is upscaled locally (Real-ESRGAN class) before
compositing.

### 11.5 Ledger and caps (enforced)

- `price_book`: provider, unit (credit, image, 1k tokens, call), USD per unit, date checked, source.
  kie credits convert with the owner-confirmed rate (the test fixture assumes about 0.005 USD per
  credit; unverified until the owner confirms).
- `ledger_entries`: provider, estimated and actual units and USD, state (`reserved`, `settled`,
  `released`, `expired`, `ambiguous`), token id, run id, job id, version id, timestamps.
- `spend_caps` and `spend_counters` (one counter row per scope, key and window): global daily and
  monthly, per provider daily, per token daily, per run.
- `reserve_spend(provider, units, token_id, run_id, job_id)`: locks the matching counter rows
  `FOR UPDATE`, checks reserved plus settled plus the estimate against every cap, and returns a
  reservation id or raises `cap_exceeded:<scope>`. Operations that enqueue paid jobs reserve in
  the **same transaction** as the job insert, so concurrent agents, parallel takes and Autopilot
  rounds cannot overrun.
- `settle_spend(reservation, actual)` after the call (OpenRouter's reported cost, kie credits
  used). Unsettled reservations expire after 30 minutes and are released, except kie submissions
  in doubt, which stay `ambiguous` and count as spent until `resolve_kie_submission`.
- Quota providers (codex, Gemini free tier, local engines) are recorded at 0 USD with call counts.
- `jobs` gains nullable `token_id` and `run_id` columns, propagated to every child job, so child
  stages are charged to the token and run that started them; Autopilot is charged to its system
  token.
- Web-side paid calls (`format-style`, `transcribe`) reserve and settle through the operations
  module like everything else.
- `workers.kie_balance` is reconciled against the ledger daily; a mismatch notifies the owner.

Default caps (AC7, Settings > Costi, "Costs"): global 3 USD per day and 40 USD per month; kie 120
credits per day; per token 1 USD per day; per run 0.25 USD in standard tier; customers 0.10 USD unless
the owner raises it. Spend and publish scopes cannot be granted until the ledger exists (M1).

### 11.6 Per-video budget (standard tier, AC7)

| Item | Allocation (USD) |
| --- | --- |
| Music (one kie generate, two takes) | 0.07 |
| R2 analysis (vision call) | 0.01 |
| Lyrics: writer, jury rounds, devil's advocate | 0.02 |
| Images (route 1 calls, then free routes once spent) | 0.03 |
| Visual jury rounds 1 and 2 | 0.01 |
| Retry reserve (second generation share, final-round premium judge) | 0.01 |
| **Target (median over the golden set)** | **0.15** |
| **Hard per-run cap** | **0.25** |

Cheap judges run in early rounds and the premium judge only in the final round. When a line item's
allocation is spent, its stage moves to 0 USD routes (codex, local) or pauses with `cost_cap`.

## 12. Publishing

### 12.1 Connect and extend the existing YouTube stage

1. Owner creates the Google Cloud project and OAuth client (section 22). The first consent asks
   for every scope needed now and later: `youtube.upload`, `youtube.force-ssl` (captions and
   thumbnails), `youtube.readonly`, `yt-analytics.readonly`.
2. First M4 step: **re-verify the private-only lock.** The engine repo's
   `publish/README.md:42` says Google lifted it for unverified projects in October 2026 (not yet
   verified). Test: upload a short test video through the API and set it public, then private. If
   public works, Blotato is only a fallback; if not, public YouTube goes through Blotato until the
   audit passes.
3. Extend: `publications` gains `platform`, `route` (`youtube_api`, `blotato`, `postiz`), `kind`
   (`master`, `hook`, `thumbnail_only`), `schedule_id`, `external_post_id`, `external_url`; one row
   per render and platform. `enqueue_publish` accepts `hook` renders. The 4-uploads-per-day cap
   becomes a setting.
4. Throughput: the free quota is 10,000 units per day; one full upload (video about 1,600 units,
   captions about 400, thumbnail about 50) is about 2,050 units, so about 4 uploads per day, which
   is **2 remakes per day** (master plus Short). When the quota is reached the existing stage
   retries after the Pacific reset (`retryLater`).
5. **AI disclosure: always true** (as the code already does, `containsSyntheticMedia: true`). A
   route that cannot set the disclosure is not allowed for YouTube; the Blotato route is allowed
   only after M4 verifies it sets it.
6. Shorts: there is no API flag; a vertical video of at most 3 minutes is classified by YouTube.
   The description gets `#Shorts`, and `thumbnails.set` is skipped for Shorts.
7. Audit: the author prepares the YouTube API Services audit package in M4 (app description,
   privacy page, screen recording); the owner submits it.

### 12.2 Schedule and veto window (OD3, AC4, AC5)

- On entering R9 a `publish_schedules` row is created for the **bundle**: master, Short,
  thumbnail, captions and every social post of that language version.
- **Slot:** the slot policy (Settings > Pubblicazione, "Publishing") picks the next free slot at
  least the veto window away: before analytics exist, 18:00 Europe/Rome daily, at most one master
  per day and at least 20 h between masters; once 30 days of analytics exist, the best hour from
  the channel's audience activity.
- **Window:** default 24 h before the slot. The bundle is visible as "programmato, veto aperto"
  ("scheduled, veto open") with its deadline in the app, the morning report, `notifications_list`
  and a push notification (section 16).
- **The app owns the clock.** YouTube uploads happen early as **private** with `publishAt` unset;
  social posts are held in the app. At the slot the worker flips YouTube to public and hands the
  social posts to Postiz or Blotato as "post now", only when: the window expired, no veto exists,
  every gate in 10.8 still holds, and the worker is healthy. Anything else leaves it private:
  this fails closed.
- **Missed slot** (PC or tunnel down): publish late if within 6 h of the slot; otherwise move to the
  next free slot (which restarts nothing; the window has already expired) and notify.
- **Veto** (`publish_veto`, the UI button, `mellodifai veto`) cancels the whole bundle: before
  upload, the jobs are cancelled; uploaded and private, the video stays private (marked vetoed);
  after hand-off or public, a veto is no longer possible and the UI offers "Rendi privato" ("Make
  private") for YouTube instead.
- The actor of every flip is recorded (`confirmed_via`).

### 12.3 Copilot and Autopilot

In Copilot the person or agent confirms the publish kit (title, description, tags, playlist,
platforms), which schedules the bundle; the veto window still applies. In Autopilot,
`autopilot_schedule_publish` schedules it. Public auto-publishing is behind the flag
`auto_publish_public` (section 20).

### 12.4 Publish kit and metadata

Per language version (the project page is the hub, section 26): title, description, tags and
hashtags, chapters from R2 sections, captions, thumbnail, playlist, per-platform post text, all
generated from the song's own lyrics and metadata, editable, and checked by the metadata checker
(length limits, no source title or artist names, credits and licence notes, AI disclosure text).

### 12.5 Social routes (T19)

- **Postiz** (self-hosted, free, run unmodified under its AGPL licence) is the default for TikTok,
  Instagram, Facebook, X, Threads, LinkedIn. It needs the PC and the tunnel up at post time and
  until platforms have fetched the media (minutes). Media reach Postiz through `/m/<token>` links.
- **Blotato** (paid, owner's key) is the fallback: used when Postiz returns an error or the
  platform's Postiz integration is disconnected, and Blotato is allowed for that platform in
  Settings. Blotato receives the media by upload, so no PC uptime is needed after hand-off.
- Mapping back for analytics: the returned post URL is stored; for YouTube through Blotato, the
  video id is parsed from it, or else matched on the channel's uploads playlist by title and
  publish time within 1 h.

### 12.6 Analytics ingestion

A daily job at 06:00 Europe/Rome reads YouTube Analytics for videos younger than 90 days: views,
impressions, click-through rate, average view duration, audience retention curve, per video and per
thumbnail style, into `analytics_snapshots`. It feeds the loop's hypotheses only, never its revert
decisions (analytics lag 24 to 72 h and are noisy on a small channel).

## 13. Daily improvement loop (OD4)

### 13.1 Shape

An autoresearch-style ratchet every night: hypothesis, change, evaluate on a frozen set, keep only
if better beyond noise, log. Three roles, each in its own sandbox:

1. **Supervisor** (a scheduled task on the PC, code in `ops/loop/` of the production checkout):
   starts and stops the other two, reads the kill switch between steps, owns the night window.
2. **Proposer** (the coding agent): gnhf (the owner's overnight runner: it runs Codex on a
   one-sentence objective in a git checkout and stops on a condition; CLI at
   `C:\Users\Asus\Miniconda3\gnhf`, skill `~/.claude/skills/gnhf/SKILL.md`, config
   `~/.gnhf/config.yml`) or Claude Code headless, pinned versions installed in the proposer
   container.
3. **Gate** (code in `ops/loop-gate/` of the **production** checkout, never the candidate's): runs
   every check and the evaluation, and is the only role that can merge.

### 13.2 Isolation (secrets, database, queue, network)

- The proposer runs in a Docker container (Docker Desktop on WSL2 today; plain Docker on Debian
  later) from a pinned image. Mounts: its own clone of the repo only. It has **no** env files, no
  CLI credentials, no Google tokens, no Supabase keys, and cannot see the host drives. Its only
  remote is a local bare repository `<runtime root>/loop/repo.git`.
- Network: outbound only to its model API (ChatGPT for Codex, Anthropic for Claude Code) through an
  allowlisting egress proxy. Dependencies install offline from a pre-populated, read-only package
  store; the lockfile is frozen.
- The gate runs in a second container with its **own Supabase stack** (the e2e stack pattern on
  port 45621), fake providers for every paid route (section 19), and a dedicated OpenRouter key
  for evaluation judges with a provider-side credit limit of 1 USD per night, also recorded in the
  ledger as provider `openrouter-eval`. It never sees the production database, queue, worker env
  files or the engine repo's live data.
- `test:db` is pinned to the e2e stack: it refuses to run when the configured URL is the production
  port 54321. This fixes the current unpinned script for everyone, not only the loop.
- The standing owner rules (2.2) bind the loop: no kie spend (kie is faked in evaluation), never
  commit keys (the gate runs a secret scanner on the diff).
- Kill switch: a file `<runtime root>/loop/STOP` and a Settings > Miglioramento ("Improvement")
  toggle, both read by the supervisor between steps. Neither container mounts or can reach them.

### 13.3 What the loop may change

Allowlist (only these paths; new sensitive areas are protected by default):
- lyric and image prompt templates (`apps/worker/src/prompts/**`, created in M2);
- presets and building-block parameters (`packages/visualizer/src/presets/**`,
  `packages/shared/src/presets/**`);
- product rubric wording drafts (`config/rubrics/drafts/**`);
- worker stage code in `apps/worker/src/stages/**`, except the denied files below;
- new test files (adding only).

Denylist (wins over the allowlist): editing, deleting or skipping existing tests (`.skip`, `.only`,
`.todo`, `describe.skip` and equivalents in any test file are rejected); lint, TypeScript, test and
CI configuration (`biome.json`, `tsconfig*`, `vitest*`, `.github/**`); `package.json` and the
lockfile (no new dependencies); `supabase/**` (no migrations at all); `eval/**` and the frozen
evaluator; the originality, distinctness and jury thresholds; router order and cost or cap code;
auth, tokens and scopes (`lib/auth.ts`, `proxy.ts`, `apps/worker/src/authorization.ts`,
`lib/ops/**`, `lib/mcp/**`); `apps/worker/src/stages/publish.ts` and `quota.ts`; `ops/**` (the
supervisor, the gate, the deploy script, the revert monitor, the kill switch); `AGENTS.md`, the
agent skill, `CLAUDE.md`; env files; `docs/superpowers/**`.

### 13.4 Evaluation: frozen evaluator and golden set

- **Golden set:** 5 items in M2 (used to calibrate thresholds), 10 before the loop merges: YouTube
  sources the owner owns or that are CC BY, plus one-line ideas, curated by the author, with
  **frozen artefacts** (analysis, takes, stems, images, word timing) under
  `<runtime root>/golden/` and a manifest in `eval/golden/manifest.json`. Evaluation re-runs only
  the stages a change touches and reuses the frozen artefacts for the rest, so it never pays for
  music or images.
- **Frozen evaluator** (`eval/`, denylisted): its own copy of the jury prompts, rubrics and
  thresholds, with pinned judge model ids. The product's juries can change; scoring always uses the
  frozen evaluator, so making the product jury lenient cannot raise the loop's score. The evaluator
  changes only by a human commit.
- **Renders:** evaluation renders stills at the sampled timestamps (Remotion still frames) plus the
  contact sheet; a full render runs on 2 items per candidate to measure render success.
- **Composite score** (0 to 1): visual jury 0.30, lyric jury 0.25, music checks 0.15, render
  success 0.15, cost 0.10, time 0.05.
- **Noise:** each item runs k = 3 times. The noise band is measured each night by running the
  baseline against itself (the 95th percentile absolute difference of the composite; at least
  0.02).
- **Accept** when the candidate's composite beats the baseline by more than the noise band and no
  component regresses beyond its tolerance: any score component by more than 0.03, render success
  not at all, cost by more than 10%.

### 13.5 The merge gate (in order; any failure rejects the night's candidate)

1. The diff touches only allowed paths and no denied path; at most 15 files and 400 changed lines.
2. No new or changed dependency; offline install from the frozen lockfile succeeds.
3. Secret scan of the diff is clean.
4. Lint (biome), type check, every vitest suite, `test:db` on the gate's stack, the e2e smoke test.
5. Golden-set evaluation as in 13.4.
6. No earlier loop merge is still inside its watch window (13.7), so merges never stack.

### 13.6 Merge target and deploy

- Before the loop is enabled (M6), `main` becomes the production branch (AC13): human feature
  branches merge into `main`, and the production checkout tracks `main`.
- The gate squashes an accepted candidate into **one commit** on the integration branch
  `loop/main`, rebases it onto `main` and fast-forwards `main`. If the rebase conflicts with human
  work, the night's change is dropped and logged; nothing is ever force-pushed.
- Deploy script (`ops/deploy.ps1`, and `ops/deploy.sh` for Debian): wait for an idle window (no
  running job, GPU lease free) -> `pg_dump` of the local database to `<runtime root>/backups/`
  (kept 14 days) -> `git pull --ff-only` -> frozen-lockfile install -> `next build` -> restart the
  web and worker services -> health check (`/api/health`, worker heartbeat, one smoke job on fake
  providers). On failure it returns to the previous commit and redeploys automatically.

### 13.7 Watch and automatic revert

For 48 h after a loop merge, the revert monitor compares operational signals of new runs against
the previous 7 days, with at least 3 runs before deciding: job failure rate up by more than 10
percentage points, render success below 95%, mean jury score down by more than 0.05, cost per video
up by more than 20%. Any trigger: `git revert` of that one commit, deploy, notify. Because the loop
never writes migrations, a revert never leaves schema behind.

### 13.8 Enablement and reporting

- The first 7 nights run as **dry run**: the gate does everything except merge and reports "would
  merge". Merging switches on automatically after 7 consecutive dry-run nights in which the gate,
  the evaluation and the deploy rehearsal (on the gate stack) completed without a crash. This is a
  mechanical gate, not an approval.
- Night window: 01:00 to 06:00 Europe/Rome by default; production jobs preempt evaluation (14.1).
- Morning report (app, `loop_report_get`, push summary): each hypothesis with files, baseline and
  candidate scores, noise band, decision and commit; merges; reverts; open veto windows and
  deadlines; paused runs; yesterday's spend against caps; the top 5 errors.

## 14. GPU, disk and quota budgets

### 14.1 One GPU at a time, enforced

- `jobs.resource_class` (`gpu`, `cpu`, `net`) set from a stage map in `packages/shared`.
- A single `gpu_lease` row (holder job and worker, heartbeat, priority, expiry). `claim_job` hands a
  `gpu` job out only when the lease is free, and orders by priority then age: interactive and
  Copilot 0, Autopilot 1, loop evaluation 2. Evaluation checks a `yield_requested` flag between
  items and releases the lease.
- Before a Remotion or Demucs job the worker asks ComfyUI to unload its models (or stops it), and
  it claims a GPU job only when at least 6 GB of VRAM is free (so the owner's own After Effects
  sessions are respected).

### 14.2 Capacity (rough, measured again in M2)

| Work | GPU time |
| --- | --- |
| Remake: Demucs on source and take | about 5 min |
| Remake: master render 1080p, 3-minute song | about 10 min |
| Remake: Short and thumbnails | about 4 min |
| Remake: local images (free tier, 8 images) | about 8 min |
| Loop: one hypothesis (10 items, k = 3, stills, 2 full renders) | about 1 h |

So the PC handles a few remakes per day plus up to 3 loop hypotheses in the night window.

### 14.3 Disk

- A remake peaks at about 1 to 3 GB. Retention: source media deleted when R2 passes (analysis JSON
  and low-resolution contact sheets kept); unchosen takes and intermediates (frames, draft renders)
  deleted 14 days after publishing; masters, the Short, stems and the timeline kept.
- New remakes pause when E: has less than 50 GB free (notification). Every cache is pinned to
  `<runtime root>/cache/` through the worker's environment (`TMP`, `TEMP`, `HF_HOME`,
  `XDG_CACHE_HOME`, the Remotion bundle and browser caches, pip, yt-dlp). Jobs never write to C:.

## 15. Data model additions

Every migration is additive (new tables, new nullable columns, widened check lists). Names are
given; the numbers are assigned after T12's last migration.

| Entity (table) | Key fields | Relation to existing tables | Milestone, migration |
| --- | --- | --- | --- |
| `agent_tokens` | owner, kind, name, hash, oauth client id, scopes, daily cap, remote, revoked | profiles | M1 `ops_tokens` |
| `idempotency_keys`, `rate_counters` | token, key, request hash, response; window counts | agent_tokens | M1 `ops_tokens` |
| `audit_log` | token, actor, operation, argument hash, result, cost, time | agent_tokens | M1 `ops_tokens` |
| `price_book`, `ledger_entries`, `spend_caps`, `spend_counters` | section 11.5 | jobs, versions, agent_tokens | M1 `spend_ledger` |
| `jobs` columns `token_id`, `run_id`, `resource_class` | nullable | jobs | M1 `spend_ledger` |
| `require_scope()`, pre-request hook, storage policy update | section 6 | existing RPCs wrapped | M1 `ops_scopes` |
| `notifications` | user, kind, severity, title, body, link, deadline, read, delivered | profiles | M1 `notifications` |
| `app_flags` | flag, enabled, enabled_by, at | none | M1 `notifications` |
| `remakes` | owner, source url and id, mode, tier, driver, lease, defaults snapshot, status, stop reason, project, primary version, runtime dir | projects, versions | M2 `remakes` |
| `stage_runs` | remake, version, r-stage, state, round, attempt, stage version, stop reason, cost reserved and settled, driver | remakes, jobs | M2 `remakes` |
| `remake_analyses` | remake, music, meaning map, blueprint (jsonb with schema version), models, cost, `untrusted` | remakes | M2 `remakes` |
| `jury_reports` | subject kind and id, round, judges, rubric version, scores, must-fix, devil's notes, available, passed | versions, renders | M2 `jury_reports` |
| `timelines` | version, revision, document, author, created | versions | M2 `timelines` |
| `versions.status` value `analysing`; new stages in `jobs_stage_check` | | versions, jobs | M2 `remakes` |
| `golden_items` | id, kind, manifest path, curator | none | M2 `jury_reports` |
| `images` | owner, version, shot, provider, model, prompt hash, ledger entry, path, sha256 | versions, ledger | M3 `images` |
| `fingerprints` | render, frame index, pHash, DINOv2 embedding | renders | M3 `images` |
| `gpu_lease` | holder, heartbeat, priority, expiry | jobs, workers | M2 `gpu_lease` |
| `publications` columns `platform`, `route`, `kind`, `schedule_id`, `external_post_id`, `external_url`, `confirmed_via` | nullable | publications | M4 `publish_routes` |
| `publish_schedules` | owner, version, slot, veto deadline, state, vetoed by and via, decided at | versions, publications | M4 `publish_routes` |
| `capability_links` | token hash, render, expires, revoked | renders | M4 `publish_routes` |
| `analytics_snapshots` | video id, date, views, impressions, CTR, average view duration, retention | publications | M4 `analytics` |
| `autopilot_policies`, `remake_defaults` | section 6.5, 8.7 | profiles | M5 `autopilot` |
| `loop_runs`, `loop_watch` | night, hypothesis, branch, files, scores, noise band, decision, commit, revert | none | M6 `loop` |

## 16. Observability and notifications

- **Stores:** `job_events` (stage progress, existing); `audit_log` (every agent call, 180 days);
  `ledger_entries` (kept forever); `jury_reports` (kept); worker and web logs under
  `<runtime root>/logs/` (rotated, 14 days, redacted by the existing secret redaction).
- **Metrics:** SQL views (`ops_metrics_daily`): job failure rate by stage, render success, mean
  jury scores, cost per video, queue wait, GPU busy share. The revert monitor (13.7) and the morning
  report read them.
- **Notifications:** the `notifications` table, shown in the app, readable by agents through
  `notifications_list` and the notifications resource, and pushed through **ntfy** (AC12) to the
  owner's phone: paused runs, open veto windows with their deadline (when opened and 2 h before
  expiry), missed slots, cap hits, ambiguous kie submissions, loop merges and reverts, disk low.

## 17. Threat model and risks

| Risk | Surface | Likelihood / impact | Mitigation | Milestone |
| --- | --- | --- | --- | --- |
| Forged service-role JWT with the public demo secret | `api.` host | high / critical | Key rotation before exposure, exit test (5.3) | M1 |
| Private services exposed by the tunnel | tunnel | medium / critical | Hostname and path allowlist, catch-all 404, Access (5.2) | M1 |
| OAuth or PAT token used directly against the database, bypassing scopes | PostgREST, storage | medium / high | Pre-request hook, `require_scope`, storage policies (6.3, 6.4) | M1 |
| Agent-authored code execution | renders | high if code were allowed / critical | Data-only timeline (9.2), file validation (9.4) | M2 |
| Prompt injection from source captions or metadata | Autopilot writer, agents, loop | medium / medium | Untrusted labelling, template-only use, no admin operations in the API (6.8) | M2 |
| Overspend under concurrency | ledger | medium / high | Atomic `reserve_spend` in the enqueue transaction (11.5) | M1 |
| Unjudged content in Autopilot during a provider outage | juries | medium / high | Fail-closed `jury_unavailable` (10.1) | M2, M5 |
| A video goes public against a veto | publishing | low / high | App-owned clock, fails closed (12.2) | M4 |
| Loop weakens its own gates or score | loop | high without rails / high | Gate outside write scope, allowlist and denylist, frozen evaluator (13) | M6 |
| Loop reads secrets or touches live data or money | loop | medium / critical | Containers, own stack, fake providers, egress allowlist (13.2) | M6 |
| Content ID claim despite originality checks | YouTube | medium / medium | Originality gates; "Segnala claim" ("Report claim") button pauses Autopilot publishing and feeds the loop as a severe negative | M4 |
| kie or the Midjourney reseller disappears | providers | medium / low | OD5 fallthrough; ACE-Step for music | M3 |
| YouTube audit rejected or lock still applies | publishing | medium / medium | Lock re-verification, Blotato route with disclosure check (12.1) | M4 |
| GPU becomes the queue bottleneck | worker | high / medium | GPU lease and priorities, night window for the loop (14.1) | M2 |
| Disk fills | E: | medium / medium | Retention, free-space pause, caches on E: (14.3) | M2 |
| Shared ChatGPT quota starves production images | codex | medium / low | Priority rules and fallthrough (11.3) | M3 |

## 18. Alternatives considered

| Choice | Chosen | Rejected and why |
| --- | --- | --- |
| Remake rule, remote and local agents, veto window, autonomous loop, image order, Remotion with JSON timeline, PC hosting | Owner decisions OD1-OD8 | Not re-argued. |
| Hosting | PC plus tunnel (AC1) | Vercel plus hosted Supabase: the worker, GPU and local database live on the PC anyway, and a split topology doubles auth and media configuration. |
| Tunnel | Cloudflare Tunnel | Tailscale Funnel: one `*.ts.net` hostname (a different OAuth issuer and redirect host), no WAF or Access, not on the owner's domain. |
| Authorization server | Supabase OAuth 2.1 server (AC2) | A self-built server: more code and more risk; Supabase's is already in the stack. |
| Publish clock | App-owned (AC4) | YouTube `publishAt`, Blotato or Postiz schedules: a veto would need the PC online to cancel, so an offline PC would publish against a veto. |
| Agent compositions | JSON timeline (AC3) | TSX compositions in a "sandbox": remote code execution on the PC with keys in reach. |
| Loop runner | gnhf or Claude Code headless, inside a container | Either on the host as the owner's user: reads every secret. |
| stdio MCP | Bridge to `/api/mcp` | A separate stdio server talking to the database: a second implementation that skips scopes, caps and audit. |
| Push channel | ntfy (AC12) | Email (needs the SMTP setup first), Telegram (a bot to run). |

## 19. Testing strategy

All with zero kie spend.

- Fakes: extend `apps/worker/src/fake` to cover yt-dlp, kie Midjourney, codex, Nano Banana,
  OpenRouter text and image, Groq, YouTube, Blotato and Postiz, selected by env; the e2e and gate
  stacks use them always.
- Recorded fixtures for one source video (one of the owner's own videos): captions, frames, contact
  sheets, analysis JSON.
- Unit tests: blueprint and timeline schemas (including rejection of code, URLs and oversize
  documents), `reserve_spend` under concurrency (parallel reservations never exceed a cap), state
  machine transitions and `expected_stage_version` conflicts, originality metrics (a known close
  paraphrase and a literal translation must fail; a same-meaning rewrite must pass), fail-closed
  jury in Autopilot.
- Database tests: `require_scope`, the pre-request hook (OAuth token refused at PostgREST), the
  publish gate, Autopilot RPCs refusing a failed or unavailable jury. `test:db` pinned to the e2e
  stack.
- MCP: MCP Inspector over both transports; an OAuth end-to-end test (dynamic registration, PKCE,
  consent, token, tool call, revocation) against the local stack.
- Tunnel smoke test: allowed routes answer, denied ones return 404, a demo-secret JWT is refused.
- Publishing: a dry-run mode that stops before the API call, plus the lock re-verification upload
  (12.1) on the owner's channel as a private test.
- Loop: the dry-run nights (13.8) and a test that a candidate touching a denied path, skipping a
  test or adding a dependency is rejected by the gate.

## 20. Rollout, feature flags and rollback

| Flag (`app_flags`) | Turns on | Enablement gate | Kill path |
| --- | --- | --- | --- |
| `remote_mcp` | remote PATs and OAuth at `/api/mcp` on the public host | M1 exit tests pass (OAuth end-to-end, Inspector, tunnel smoke, key rotation) | Settings > Agenti "Chiudi accesso remoto" ("Close remote access"): flag off (public-host API returns 503), every OAuth grant and remote PAT revoked; hard kill: stop the `cloudflared` service |
| `autopilot` | Autopilot runs | M3 juries and M1 caps in place, 5 Copilot remakes passed every gate | flag off; running Autopilot runs finish their current stage and stop with `owner_cancelled` |
| `auto_publish_public` | the slot flip to public | M4 lock re-verification or a verified Blotato route; 3 Copilot publishes completed | flag off: bundles stay private at the slot |
| `loop_merge` | the gate's merge step | 7 dry-run nights (13.8) | kill switch file or Settings toggle; flag off |
| `premium` | premium tier | M7 acceptance | flag off |

Migrations are additive only. Rollback per milestone: redeploy the previous commit with the deploy
script; additive schema stays harmlessly in place; flags default off.

## 21. Milestones

### 21.1 Summary

| Milestone | Goals | Covers | Needs | Owner actions |
| --- | --- | --- | --- | --- |
| M0 (running) | - | T12, VideoHive presets, storyboard bug | - | - |
| M1 Safe agent access | 2, 4 (ledger part) | sections 5, 6, 7, 11.5, 16 | T12 merged before the schemas move (M1 step 4) | DNS to Cloudflare, SMTP, kie rate, ntfy |
| M2 Remake in Copilot | 1 (Copilot), 3 (lyrics, originality) | R1-R5, R4b, R7; sections 8, 9, 10.1-10.3, 14 | M1 | confirm AC10, AC11 |
| M3 Visual quality | 3 (visual), 4 (images) | R6, R8; sections 10.4-10.8, 11.3; T15, T18; thumbnails; web timeline editor | M2 | Gemini key, kie Midjourney confirmation, eval OpenRouter key |
| M4 Publishing | 5 | R9; section 12; T17, T19; project page hub | M3 | Google OAuth client, Blotato key, audit submission |
| M5 Autopilot | 1 (Autopilot), success criterion | sections 6.5, 8.7; flag `autopilot` | M1, M3, M4 | remake defaults |
| M6 Daily loop | 6 | section 13 | M5, `main` as production (AC13) | confirm AC6 (optional) |
| M7 Premium | 4 (premium) | Higgsfield, T14 Comfy Cloud | M3 | Comfy Cloud key |
| M8 Portable runtime | - | section 25 | M6 | Debian server later |
| Later | - | T11b, T16, T20, T21, T22, karaoke mode, Riffusion items | M4 | - |

The karaoke mode and other pure UI work (section 26) can run in parallel at any time after T12;
they do not depend on the agentic layer.

### 21.2 M0 (running)

T12; the VideoHive presets branch; fix the per-song storyboard bug (section 26: new songs inside an
imported project must not reuse that project's scenes, thumbnail and metadata; files
`apps/worker/src/legacy-import.ts`, `stages/draft-lyrics.ts`, `stages/utils.ts`).
**Done when** T12 is merged and a new song in the VBP project gets its own scenes, thumbnail and
title (e2e test).

### 21.3 M1 Safe agent access (local and remote together, OD2)

1. Topology: services, `cloudflared` config with the hostname table, Supabase hardening (5.3),
   `/media` streaming, `proxy.ts` matcher, README deploy rewrite.
2. Identity: `agent_tokens`, PAT creation in Settings > Agenti, internal JWT minting,
   `require_scope`, pre-request hook, Supabase OAuth server, consent page, protected resource
   metadata.
3. Ledger: `price_book`, `ledger_entries`, caps and counters, `reserve_spend` and `settle_spend`,
   `jobs.token_id` and `run_id`, web-side paid calls routed through it, Settings > Costi.
4. Operations module for the existing operations, server actions moved onto it; `/api/v1` with the
   contract of 7.2; schemas moved to `packages/shared` after T12 merges.
5. MCP registry at `/api/mcp`, `packages/cli` with `mellodifai mcp` stdio bridge, agent skill.
6. `notifications` with ntfy; `app_flags`; rate limits; audit log; `test:db` pinned.

Files: `apps/web/lib/ops/**`, `apps/web/lib/mcp/**`, `apps/web/app/api/v1/**`, `apps/web/app/api/mcp/**`,
`apps/web/app/oauth/consent/**`, `apps/web/app/m/**`, `apps/web/proxy.ts`, `apps/web/app/media/**`,
`packages/shared/src/ops/**`, `packages/cli/**`, `supabase/config.toml`, `ops/cloudflared/**`.
Migrations: `ops_tokens`, `spend_ledger`, `ops_scopes`, `notifications`.
**Done when:** Claude Code over stdio and claude.ai over remote MCP each complete create, status
and approve on a test song using fake providers; the OAuth end-to-end test and MCP Inspector pass
on both transports; a revoked token and a revoked grant are rejected on the next call; an OAuth
token is refused directly at PostgREST; a demo-secret JWT is refused at the public host; 20
parallel reservations never exceed a cap; spend and publish scopes cannot be granted to a customer.

### 21.4 M2 Remake in Copilot

R1-R5, R4b and R7 in Copilot with the existing lyric jury extended (10.2, including the new devil's
advocate), the originality gate (10.3), and a stub image source (Importa da Midjourney, or the
preset's own art). Blueprint and timeline schemas, `TimelineVideo`, the kinetic lyric components
moved into `packages/visualizer`, the driver lease and `artefact_submit`, the state machine, the
GPU lease, retention and the disk guard, 1080p previews, golden set v0 (5 items), the direct
Anthropic client. Migrations: `remakes`, `jury_reports`, `timelines`, `gpu_lease`.
**Done when:** a fixture source runs R1-R7 in Copilot on fake providers and stops at each pause
point; an agent over MCP authors the lyrics and the timeline for one run; a known close paraphrase
fails the originality gate; a timeline containing code or a URL is rejected; the source media are
deleted after R2.

### 21.5 M3 Visual quality and images

Visual jury, design rules in code (`docs/design/motion-rules.md`), distinctness gate, fingerprints,
the publish gate in the database (10.8), the OD5 image router with the price-book research for
Nano Banana, T18 local images, T15 brand kit, the thumbnail generator, the web timeline editor
(scenes, text, timing, assets), threshold calibration on the golden set (tighten only).
Migrations: `images`. **Done when:** R6 and R8 run on the fixture; a frame with misspelt text or a
safe-area violation fails; `approve_video` refuses a version without passed visual jury reports; the
router falls through on a faked refusal, timeout and usage limit, in order.

### 21.6 M4 Publishing

Section 12 in full: lock re-verification, `publications` routes, Shorts, schedule and veto window,
missed-slot policy, capability links, Postiz and Blotato routes (T19), publish kits and the project
page hub with "Aggiungi lingua" ("Add language", T17), analytics ingestion, audit package.
Migrations: `publish_routes`, `analytics`. **Done when:** a Copilot remake is scheduled; a veto
cancels the whole bundle in each state; with the worker stopped through the slot, nothing goes
public and the missed-slot policy runs on restart; a Short publishes as a hook render; analytics
snapshots arrive for a published video.

### 21.7 M5 Autopilot

Autopilot policy and system token, the Autopilot RPCs, the Autopilot stop list, remake defaults,
flag `autopilot`. Migration: `autopilot`. **Done when:** a golden-set link runs to a scheduled
bundle without any owner action; a faked jury outage stops the run with `jury_unavailable`; a cap
stops it with `cost_cap`; the success criterion (section 1) holds on the golden set.

### 21.8 M6 Daily improvement loop

Section 13 in full, after `main` becomes the production branch. Migration: `loop`.
**Done when:** 7 dry-run nights complete; the gate rejects the planted bad candidates of section
19; a planted regression after a merge is reverted automatically; the kill switch stops a night in
progress.

### 21.9 M7 Premium and M8 Portable runtime

M7: Higgsfield shots and T14 Comfy Cloud in the premium tier, each with cost before confirm.
**Done when** a premium run stays inside its pre-approved budget. M8: section 25.

## 22. Owner actions and open questions

| Item | Blocks | Who acts | Fallback while pending | Status |
| --- | --- | --- | --- | --- |
| Move mellodifai.com nameservers from Hostinger to Cloudflare; create the tunnel in his Cloudflare account | M1 remote exit | owner (author writes the config) | local stdio only, `remote_mcp` off | open |
| SMTP sender for sign-in codes | M1 remote sign-in | owner | sign-in on the PC only | open |
| kie USD rate per credit | M1 price book | owner | 0.005 USD per credit, marked unverified | open |
| ntfy app on his phone | M1 push | owner | in-app notifications only | open |
| Confirm AC10 (analysis-only download of YouTube sources) | M2 | owner | proceed under AC10 | open question |
| Confirm AC11 (meaning of "keeps timing") | M2 | owner | proceed under AC11 | open question |
| Gemini API key (Nano Banana) | M3 route 3 | owner | route 3 off | open |
| Confirm kie Midjourney access and price per call | M3 route 1 | owner | route 1 off; GPT Image via codex first | open |
| Second OpenRouter key for evaluation, with a credit limit; guardrail-free key | M3 calibration, M6 | owner | calibration on the main key within caps | open |
| Google Cloud project, OAuth client, consent screen with the four scopes of 12.1 | M4 | owner | publishing stays manual (`yt.py`) | open |
| YouTube API audit submission | public route if the lock still applies | owner submits, author prepares | Blotato with verified disclosure | open |
| Blotato API key | M4 fallback | owner | Postiz only | open |
| Veto window length | M4 | owner in Settings | 24 h (AC5) | default set |
| Remake defaults | M5 | owner in Settings | defaults of 8.7 | default set |
| Confirm the loop rails (AC6) | none (they are in force) | owner | in force | open question |
| Comfy Cloud key | M7 | owner | premium without Comfy Cloud | open |

## 23. Constraints

- Owner rules: section 2.2.
- Hardware: RTX 3070 8 GB, one GPU job at a time (enforced, 14.1); Docker Desktop on WSL2 (after
  power cuts it may need its `run` folder reset; never factory reset: it holds the local database,
  which the deploy script backs up with `pg_dump`).
- Licences: YuE2 non-commercial (owner-only); Remotion free for up to 3 people; Postiz AGPL (run
  unmodified); Audacity code not copied (GPL); UVR models need credit; VideoHive templates only
  within their Envato licence (looks are rebuilt in code, template files never shipped); LaBSE and
  DINOv2 Apache 2.0; no GPL code in the web app.
- Terms: Suno (no automation of suno.com), Midjourney web (not automated; the kie reseller is the
  owner's accepted risk, OD5), Google Flow (consumer app, not automated), YouTube (API quota and
  audit, inauthentic and repetitive content, AI disclosure always set).

## 24. Left to the builder, and builder notes

Left to the builder: exact CLI flags beyond 7.4; jury and devil's advocate prompt wording; the
beat and section analyser, constrained to: no GPL code in the web app, CPU-only or at most 2 GB of
VRAM, output that fills the blueprint's `music` fields; the Windows service wrapper.

Builder notes:
- yt-dlp needs `yt-dlp-ejs` and `--js-runtimes node`, or video downloads get 403 (captions still
  work).
- In Git Bash, paths like `/api/v1` passed as arguments can be rewritten to Windows paths; prefix
  `MSYS_NO_PATHCONV=1`.
- Worktrees go in `E:/mellodifai/wt/`; a new worktree needs the lockfile copied before install.
- The OpenRouter account has a privacy filter that replaces words with tags like `[PERSON_NAME]`;
  the lyric pipeline already detects it (`looksRedacted`), and new juries must too.

## 25. Future: portable runtime, installers, desktop apps and GPU servers (owner, 01/11)

Not built now (the owner is the only admin today), but every new piece of code must keep it
possible.

- **Any machine can be a worker.** The worker already pulls jobs from the queue, so the PC, a
  Debian GPU server, or a user's own computer are all just workers. Each worker reports its
  capabilities (GPU model, VRAM, RAM, disk, OS, installed engines and model files, versions) with
  its heartbeat; jobs carry requirements (for example "YuE2 INT8, 8 GB VRAM" or "CPU render"), and
  the queue hands a job only to a worker that meets them. The GPU lease (14.1) becomes per worker.
  Bigger servers unlock bigger models (YuE2 BF16, ACE-Step XL, larger image and video models).
- **Doctor and installer** (`mellodifai doctor`, `mellodifai install`, a shell script for
  Debian/Ubuntu over SSH, PowerShell for Windows, a macOS script): detect the hardware and software
  (nvidia-smi or Metal, CUDA, Python, Node, ffmpeg, ComfyUI), print what this machine can run per
  engine and what is missing, then download and install everything from the GitHub repo's releases
  (pinned versions, checksums), register the worker with a token, and run as services (systemd on
  Debian, a service on Windows, launchd on macOS). The owner prefers a full Debian server over
  Docker for GPU hosts.
- **Self-update:** workers and apps update themselves from signed GitHub releases on a channel
  (stable or the daily loop's channel), with automatic rollback if the health check fails.
- **Desktop apps** (Windows, Linux, macOS; a small native shell around the web app, Tauri is the
  likely choice): on first run they run the doctor; if the computer can run engines locally they
  install and start a local worker; if not, they propose (a) running on the owner's GPU servers,
  choosing the nearest by ping, or (b) bringing the user's own API keys for cloud-only mode.
- **GPU hosting:** a dedicated or virtual GPU server running Debian, sized for the bigger models;
  providers to compare include RunPod (its pods are containers), dedicated GPU servers (for example
  Hetzner's GPU line) and any VPS provider with GPU plans (check Hostinger). The PC topology of
  section 5 moves to that server unchanged; local engines keep their licence limits.
- **Portability rules for code written from now on:** no hard-coded Windows paths or drive letters
  (`MELLODIFAI_ROOT` replaces `E:/mellodifai`, `MELLODIFAI_ENGINE_ROOT` replaces the hard-coded
  `ENGINE_ROOT`), no Windows-only process handling without a POSIX path, engine and model locations
  from config, every external tool located through config or PATH, every deploy and ops script in
  both PowerShell and POSIX shell.

## 26. Owner additions of 01/11 evening, and where each lands

- **Per-song storyboard (bug found 01/11)** - M0. New songs inside the imported "Va bene, passa
  (VBP)" project reuse that project's scene template (`storyboard-l10n.json`): the lyrics are new
  and in sync, but the scenes, the thumbnail and the YouTube title and description come from the old
  song (`apps/worker/src/legacy-import.ts`, `stages/draft-lyrics.ts`, `stages/utils.ts`). Every song
  gets its own storyboard, thumbnail and metadata from its own lyrics; the VBP template stays only
  as one selectable style.
- **Preview quality** - M2. Previews are 854x480 at about 0.3 Mbit/s; masters are 1920x1080.
  Previews move to 1080p within the storage budget; masters render 1080p by default and 4K on
  request (Remotion renders vector graphics natively at 4K). A free local upscaler (Real-ESRGAN
  class, for example Video2X) is used only for generated footage before compositing (M7).
- **Project page as the publishing hub** - M4. The language chips (IT, RU, RO, JA, EN, ES, DE, ZH,
  PT, KO, FR); "Aggiungi lingua" ("Add language") generates a new language version (T17); each
  language has its publish kit (12.4).
- **Thumbnails that convert, not clickbait** - M3. Two to three candidates from the video's own key
  frames, title and generated art: one focal subject, three words or fewer of large text, strong
  contrast, readable at small size, consistent channel style, faces or characters with clear
  emotion, no misleading claims; scored by the visual jury at phone size. The loop learns from
  click-through rate per thumbnail style; YouTube's own thumbnail test is used when available.
- **Karaoke mode** (like Spotify's) - parallel UI track. Lyrics synced line by line with the
  current line and word highlighted (word timing exists), and a karaoke switch that lowers or
  removes the vocal using the stems (T11b later improves it). Owner's reference screenshots of
  Spotify (01/11): full-screen lyrics on a solid background from the cover's dominant colour, very
  large bold left-aligned lines, sung lines dimmed, the current line pure white, upcoming lines a
  light tint of the background, generous spacing, auto-scroll keeping the current line in view, a
  lyrics credit at the bottom, a top-right toolbar with a microphone toggle, a lyrics button in the
  player bar; and the main layout with a playlist header coloured from the cover, a big round play
  button, track rows with cover, title, artist, album and duration, and a right-hand "now playing"
  panel with large artwork. The app's polish should match that level.
- **Agents edit songs and videos by talking** - M1 (existing editor operations as MCP tools) and M2
  (timeline tools). The web UI stays fully labelled and accessible, so computer-use agents can
  operate it as a fallback.
- **Video editor in the project** - decided by OD6: the timeline document (9.2), its agent tools
  (M2) and the web timeline editor (M3). HyperFrames (0.8, fast-moving, its GSAP dependency's
  licence restricts visual editors) is not the engine; it may later supply pre-rendered scene clips
  as video layers after a proof of concept. Paid Remotion editor kits are not needed.
- **From the Riffusion/Producer research** - later, after M4, each through the operations
  catalogue: (1) a chat editor where the user or agent says "change the second chorus" and it
  becomes kie `replace-section` or `extend` calls (sections to seconds via word timing or kie
  `get-timestamped-lyrics`; windows at least 10 s, at most half the track); (2) "Cambia voce"
  ("Change voice") and "Cambia base" ("Change backing") from stems plus kie `add-vocals` and
  `add-instrumental`; (3) "Dalla mia voce allo studio" ("From my voice to the studio"): a dry vocal
  becomes a produced song (ACE-Step cover with a strength slider, kie `upload-and-cover-audio` as the
  paid option; Italian bake-off first); (4) a free local tier (Demucs, ffmpeg effects, ACE-Step
  repaint); (5) an optional Lyria engine through the Gemini API (about 0.08 USD per song, no edit
  endpoints).

## 27. Glossary and references

- **T-ids:** tasks of the feature plan. T7 library, T8 player, T9 create panel, T10 playlists and
  details panel, T11 stems and audio editor, T11b UVR-quality vocal removal, T12 songs from songs,
  T13 Video Studio visualizers, T14 Comfy Cloud runtime, T15 brand kit, T16 jingle mode, T17
  language and cultural adaptation, T18 local images, T19 automatic social sharing, T20 new vocals
  on an instrumental, T21 Audacity-style effects, T22 topic research before lyrics.
- **Jev:** `typesafe/jev-1.14`, a decision model on OpenRouter that picks the lyric tone and the
  writer strength (`apps/worker/src/stages/lyric-jury.ts`).
- **VBP template:** the scene template of the imported "Va bene, passa" project, rendered from the
  engine repo's `motion/`.
- **`score_takes`:** `tools/score_takes.py` in the engine repo, run by `score-takes.ts`; scores takes
  by Whisper intelligibility (`fidelity`) and other measures.
- **The `/watch` method:** download with yt-dlp, extract frames at scene cuts and 1 fps contact
  sheets with ffmpeg, take the transcript from captions or Whisper.
- **Devil's advocate:** a model prompted to argue that a draft must not pass (10.2); new work.
- **Golden set:** frozen items used to calibrate thresholds and to evaluate the loop (13.4).
- **Copilot / Autopilot:** who approves (8.1). **Tier:** what may cost money (8.1).
- **Console:** the per-stage view of a remake on the song page (8.4).
- **PAT:** personal access token (6.6). **Ledger:** section 11.5. **Veto window:** section 12.2.
- **Blueprint:** the style description of the source video (9.1). **Timeline document:** the
  editable description of the new video (9.2).
- **Engine repo:** `C:\Users\Asus\Documents\suno-remake` (motion, tools, `publish/yt.py`).
- **Runtime root:** `MELLODIFAI_ROOT`, default `E:/mellodifai`.
- **UI strings** are Italian with English glosses in parentheses where they first appear, for
  example Settings > Agenti ("Agents").

Research this design relies on (in `E:/mellodifai/research/`, owner's PC):
- `riffusion-producer-report.md`: Producer became Google Flow Music on Lyria and lost its swap and
  cover-strength features; the five ideas in section 26 come from it.
- `hyperframes-vs-remotion.md`: the evaluation behind OD6.
- `videohive/videohive-catalogue.md`: 70 looks from the owner's three VideoHive packs, 14 proposed
  presets, all buildable with the existing visualizer inputs and Adobe built-in effects only.
- `channel/channel-report.md`: the owner's channel house style (source of the Classico preset).

## 28. Review resolution

Every finding of `docs/egm/agentic-studio/goldfish_review_report.md`. All 61 are resolved; none is
rejected. Owner confirmation is still invited on AC6, AC10 and AC11 (section 22), but the design
works without it.

| Id | Disposition |
| --- | --- |
| B1 | Resolved in section 5: one topology (AC1), one tunnel provider, hostname and path table with deny-all default, key rotation with exit test, `/media` streaming and capability links, config.toml URLs, SMTP, Postiz registration off, Access placement and bypass list. |
| B2 | Resolved in 13.1, 13.3, 13.4, 13.5: gate runs from the production checkout outside the proposer's write scope, path allowlist plus denylist, frozen evaluator with pinned judges. |
| B3 | Resolved in 13.2: proposer container without secrets, gate with its own Supabase stack and fake providers, egress allowlist, `test:db` pinned, kill switch out of reach, owner rules bind the loop. |
| B4 | Resolved in 21: ledger and caps in M1 before spend and publish scopes; M2 Copilot with stub images; M3 visual jury and router; M4 publishing; M5 Autopilot; database publish gate in 10.8; "needs" column. |
| B5 | Resolved in 8.2, 8.4 (R5), 9.2, 9.4: data-only timeline validated twice, app's own components only, internal writer defined (mapper plus Sonnet with 0.01 USD budget), driver lease with timeout and hand-off, file validation. |
| B6 | Resolved in 3 (auth model corrected) and 6.1-6.5: internal 60 s JWT, `require_scope`, Autopilot actor with policy row, worker-only RPCs and `confirmed_via`, role-to-scope mapping. |
| B7 | Resolved in 6.4 and 6.6: Supabase OAuth server named, metadata, PKCE, audience binding, pre-request hook, consent screen with admin-only second confirmation, grants in `agent_tokens`, lifetimes; M1 exit criterion in 21.3. |
| B8 | Resolved in 11.5 and 11.6: `reserve_spend` under row locks in the enqueue transaction, settle and expiry, price book, quota providers at 0 USD, `token_id` and `run_id` on jobs, web-side calls routed, per-run cap, exact definition of the 0.15 USD in section 1. |
| B9 | Resolved in 12.2: app-owned clock (AC4), fail-closed flip, missed-slot policy, 24 h default (AC5), bundle veto, cancel per state, actor recorded, notifications. |
| B10 | Resolved in 8.3, 8.5, 8.6 and 15: data model table, project and versions created at start with new status `analysing`, state machine with `expected_stage_version`, pause points, unskippable gates, one stop list, R-stage to job-stage map, R4b, reuse of checkpoints. |
| B11 | Resolved in 9.1: zod schema v1 in the document, relation to `storyboard.json`, one package (`packages/shared`), R2 vision model, frame budget and cost in 8.4. |
| B12 | Resolved in 10.1-10.3: metrics, models and binding starting values, meaning fidelity measured per section against the meaning map, aggregation, devil's advocate power, round caps (8.6), golden set v0 in M2, calibration may only tighten, frozen against the loop. |
| B13 | Resolved in 13.6 and 13.7: no loop migrations, `loop/main` squash and fast-forward onto `main` (AC13), deploy script with `pg_dump` and health check, revert on operational signals with numeric limits, no stacked merges, worktree location in 24, gnhf described in 13.1. |
| B14 | Resolved in 21: summary table with goals, coverage, needs and owner actions, plus per-milestone files, migrations, tests and "done when"; success criterion tied to M5. |
| B15 | Resolved in 7: one operations module behind server actions, `/api/v1` and MCP; stdio as a bridge; catalogue table with fixed tool names; error envelope, idempotency, pagination, SSE, versioning, uploads; CLI credential storage. |
| B16 | Resolved in 14: `resource_class`, database GPU lease with priorities and yield, ComfyUI unload, VRAM check, capacity table, retention, free-space pause, caches on E:. |
| B17 | Resolved in 3 (existing publishing described) and 12.1: connect and extend, platform and route columns, hook renders, configurable cap, throughput, AI disclosure always true, Blotato mapping, Shorts rule, lock re-verification as the first M4 step, audit package. |
| M1 | Resolved in 3 (does not exist) and 10.2 (new work with role and power). |
| M2 | Resolved in 6.8 and 13.2 (quoted loop inputs). |
| M3 | Resolved in 5.4 (capability links, streaming) and 12.5 (uptime need, Blotato trigger). |
| M4 | Resolved in the header and 2.4 (superseded rules with replacement controls; never-resend kept). |
| M5 | Resolved in section 4, goal 4 reworded to per-medium routing. |
| M6 | Resolved in 11.6 (budget table, image sub-budget, cheap judges first) and section 1 (median over the golden set, retries included). |
| M7 | Resolved in 13.4: frozen artefacts, pinned judges, k = 3, measured noise band, weights, tolerances, nightly evaluation cap, golden set location and curator. |
| M8 | Resolved in 3 (fail-open by design for the human flow) and 10.1 (fail-closed in Autopilot and every new jury, shown in Copilot). |
| M9 | Resolved in 16 (notifications table, ntfy, MCP resource, veto deadlines in the morning report). |
| M10 | Resolved in 17 (threat model and risks) and 18 (alternatives considered). |
| M11 | Resolved in 24: only CLI flags, prompt wording, the constrained analyser and the service wrapper remain; contracts moved to 7, 9, 10 and 15. |
| M12 | Resolved in 8.7 (remake defaults profile with overrides) and 12.2 (slot policy). |
| M13 | Resolved in 22 (owner actions and open questions table, including Analytics scope at first consent and the Nano Banana research). |
| M14 | Resolved in 2.1-2.3: numbered owner decisions, numbered author's calls with status, loop rails marked in force and awaiting owner confirmation. |
| M15 | Resolved in 8.2 (driver by mode table; the create panel's internal writers stay). |
| M16 | Resolved in 8.1 (tiers defined in one place, Autopilot eligibility, premium budget) and 21.9 (M7 acceptance). |
| M17 | Resolved in 8.6 (round caps, retries and backoff, error classes, timeouts, stop reasons) and 8.5 (heartbeats); never-resend restated. |
| M18 | Resolved in 19 (testing strategy). |
| M19 | Resolved in 20 (flags, enablement gates, remote shutdown, additive migrations, rollback). |
| M20 | Resolved in 16 (stores, metrics, retention, alerts) and 13.8 (morning report contents). |
| M21 | Resolved in 3, 8.3, 8.4 (R7, R8 built on `qa`, `render_hook`, `art`, `score_takes`) and 9.3 (one Remotion project, kinetic lyrics moved in M2). |
| M22 | Resolved in 3 and 11.1 (Jev described correctly; direct Anthropic client listed as new work). |
| M23 | Resolved in 7.1 and 21.3 (schemas move after T12 merges; the "not T12's files" claim dropped). |
| M24 | Resolved in 8.6 (timeouts) and 11.3 (codex detection, Nano Banana research step, OpenRouter allowlist, candidates, provenance, quota sharing). |
| M25 | Resolved in 10.4 (judges, sampling, rubric version, median, code-computed checks, must-fix list, cost). |
| M26 | Resolved in 10.6 (distinctness gate and preset reuse limit). |
| M27 | Resolved in 8.4 (R3 syllable method and tolerance; R4 WER, timing rule AC11, loudness through QA, parameter mapping from R2). |
| M28 | Resolved in section 4 (anti-goal reworded, Suno share-link import allowed), AC10, and 8.4 R2 ("never given to a generator"). |
| M29 | Resolved in 12.6 (scopes, schedule, metrics, storage) and 12.5 (Blotato mapping). |
| M30 | Resolved in the header (ownership rule), 3 (T7-T11, T13 done), 21.1 (every T-id placed), 10.3 (originality owned here). |
| M31 | Resolved in 8.4 and 25 (`MELLODIFAI_ROOT`, `MELLODIFAI_ENGINE_ROOT`), 10.7 (motion rules copied into the repo), 13.1 (gnhf paths), 27 (research summaries, engine repo path). |
| N1 | Resolved in 7.2 (25 s keepalives, stateless MCP). |
| N2 | Resolved in 6.7 (Postgres counter, default limits). |
| N3 | Resolved in 27 (glossary with paths and T-id glosses). |
| N4 | Resolved in 27 and inline (English glosses for UI strings). |
| N5 | Resolved in 8.4 R7 (hook selection rule). |
| N6 | Resolved in 3 (Groq listed among present keys). |
| N7 | Resolved in 24 (yt-dlp detail moved to builder notes). |
| N8 | Resolved: milestones as tables and subsections, R-stages as headings, list layout fixed, long lines rewrapped. |
| N9 | Resolved in the header (status, supersedes) and 3 (T-ids). |
| N10 | Resolved in 3 and 10.2 (existing criteria, threshold and judges; extension stated against them). |
| N11 | Resolved in 9.1 (`packages/shared`; the task-24 brief is to be updated to match when that task starts). |
| N12 | Resolved in 3 (Settings shows only the email; keys in env files) and sections 6.6, 8.7, 11.5, 12.2, 13.2 (which Settings tab holds tokens, defaults, costs, publishing and the kill switch; provider keys stay in env files). |
| N13 | Resolved in 5.5 (matcher excludes the bearer-token routes). |
