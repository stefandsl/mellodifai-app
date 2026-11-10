# MellodifAI Agentic Studio - master design

- **Date:** 2026-11-01, revised 2026-11-02. **Revision:** 6. It answers five goldfish reviews
  (`docs/egm/agentic-studio/goldfish_review_report.md`, `goldfish_review_round2.md`,
  `goldfish_review_round3_m1.md`, `goldfish_review_round4_m1.md`,
  `goldfish_review_round5_m1.md`); section 28 gives the disposition of every finding and the
  coordinator's rulings on rounds 4 and 5. Round 5 was the last review: what it left is either a
  revision-6 edit here or a task in `docs/superpowers/plans/2026-11-02-m1-agent-access.md`.
- **Status:** M1 is ready to plan from 21.2, its single checklist, which points to sections 5, 6,
  7, 11.5, 14.4, 15.1, 19 and 20. Revision 5 made M1 smaller: what agent access does not need
  moved to M2a or W1 (21.2). M2-M6 have their contracts here; each needs its file list written
  before it is planned. Owner decisions (2.1) are final; author's calls (2.3) hold until the
  owner overrules them.
- **Author:** Claude (Opus 5.5), from the owner's requests of 31/10 and 01/11, the research listed
  in section 27, and a read of the code on branch `build/studio-ui`.
- **Extends and partly supersedes:** `docs/superpowers/specs/2026-10-31-mellodifai-design.md`
  (replaced rules and their replacement controls in section 2.4).
- **Relationship to the feature plan:** `docs/egm/v2-local-engines/feature-parity-plan.md` owns
  the feature specs and UI behaviour of T7-T22 (T-ids glossed in section 27). This document owns
  the order and dependencies of all work, the agentic layer, the remake workflow, the quality and
  cost systems, publishing mechanics and the daily improvement loop. Where both touch the same
  thing, this document wins for originality (10.3) and security, the plan wins for UI behaviour.

## 1. Intent and success

MellodifAI is the owner's personal studio (him, family and friends; not public, but built so it
could become a SaaS later). It turns an idea, an imported song, or a **YouTube link** into a
finished song and video that is published automatically on his YouTube channel and other social
platforms, at the **lowest possible cost per video**, with quality guaranteed by juries of models
and by motion and graphic design rules enforced in code. It is **agentic**: a person can use it
through the web interface, and AI agents (Claude Code, Codex/ChatGPT, Cursor, Gemini) can drive
it through a CLI and an MCP server, reasoning on their own subscriptions. It **improves itself
every day** with a measured, mechanically guarded loop.

Why now: the studio works (songs, takes, stems, editor, Video Studio, lyric videos, local
engines), but every video still needs the owner at each step, the YouTube publishing code has no
Google OAuth client yet, and paid generation is used where free or subscription-covered paths
exist.

**Success criterion** (measured on the golden set, section 13.4, at the end of M5): a YouTube link
or a one-line idea becomes a scheduled YouTube video (16:9 master, a 9:16 Short and a thumbnail)
with no owner action, in Autopilot, standard tier, where:

- every gate required for that content kind (10.8) passed, with no override;
- the **median paid cost per video is under 0.15 USD**, counting every paid call of the run
  (lyrics, juries, music, images, analysis, composition, metadata, retries, Short, thumbnail, any
  fallback) and excluding fixed subscriptions (ChatGPT plan, Blotato monthly fee);
- no single run exceeds the hard per-run cap of 0.25 USD (11.6);
- the owner can steer any step from the app or from his agent when he wants to.

## 2. Decisions

### 2.1 Owner decisions (final)

These are the owner's. Builders implement them and never re-argue them. Cited as "(OD n)".

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
These rules bind every agent, including the daily loop (13.2) and image route 2 (11.3).

### 2.3 Author's calls (the owner can overrule)

Cited as "(AC n)". "Default" means the value ships configured and can be changed in Settings.

| # | Call | Status |
| --- | --- | --- |
| AC1 | Production runs on the PC behind a **Cloudflare Tunnel** on mellodifai.com subdomains; Vercel plus hosted Supabase is retired as production (section 5). | in force |
| AC2 | Remote MCP authorization uses a **small authorization server of our own** (`apps/auth` on `oidc-provider`, running as `mdf-auth`) that issues **opaque** tokens, so OAuth tokens can never be used against Supabase; registration only in an admin pairing window; consent bound to the starting browser by a nonce cookie. Fallback if the M1 spike fails: the same service on `@node-oauth/oauth2-server` (6.4). | in force (changed in revisions 3, 4 and 5) |
| AC3 | Agent compositions are **data only** (the timeline document); no agent-authored code is ever executed (section 9). | in force |
| AC4 | The publish **clock is owned by the app**: uploads stay private until the app flips them; YouTube `publishAt` is not used and the `scheduled` privacy path is retired (section 12). | in force |
| AC5 | Veto window default **24 h** before the slot; one veto cancels the whole bundle. | default |
| AC6 | Loop rails, merge gate, frozen evaluator and isolation exactly as in section 13. | in force; owner may confirm (section 22) |
| AC7 | Per-video budget and caps in 11.6 (target 0.15 USD median, hard cap 0.25 USD per run). | default |
| AC8 | Golden set: 5 items in M2a, 10 items plus canaries before the loop merges (13.4). | in force |
| AC9 | Two takes per generation (one kie generate call returns two), Short at most 3 minutes, thumbnails 3 candidates. | default |
| AC10 | Downloading a YouTube source with yt-dlp for **analysis only** is part of OD1's workflow; the source media are never re-published, never given to a generator, and deleted once R2 passes (derived fingerprints and transcript are kept, 8.4). | in force; owner may confirm (section 22) |
| AC11 | "Keeps timing" (OD1) is measured as: same section sequence, tempo within 5%, each section's duration within 15% of the source (8.4, R4). | in force; owner may confirm (section 22) |
| AC12 | Push notifications go through **ntfy** (public ntfy.sh server, private random topic). | default |
| AC13 | `main` becomes the production branch before the loop is enabled (13.6). | in force |
| AC14 | Every write to the database by people and agents goes through the **operations layer** (schema `ops`, called by Next as the Postgres role `mdf_web` and by `apps/auth` as `mdf_auth`, neither of which can call any `public` function); the `authenticated` role keeps only reads under RLS (6.3). | in force (new in revision 3, roles split in revision 4) |
| AC15 | M1 is safe agent access only: the tunnel exposes the MCP, API, OAuth and sign-in routes (5.2); the remote web UI is W1; every M1 feature that agent access does not need moved to M2a (21.2). | in force (narrowed in revision 5) |

### 2.4 Rules of the 31/10 design that this document supersedes

| 31/10 rule | New rule | Replacement control |
| --- | --- | --- |
| Going public is a separate, explicit click per video (31/10 sections 2, 3). | Kept until M4; then auto-schedule with veto window (OD3). | Until M4: admin-only, cookie-only `confirm_publication` (6.3). From M4: publish gate (10.8), app-owned clock (12.2), Autopilot policy row (6.5), flag `auto_publish_public` (20). |
| Every kie generation needs a confirm click (31/10 section 8). | Copilot keeps the click; Autopilot replaces it. | `ops.reserve_job` caps inside the RPCs (11.5) and the Autopilot policy row. |
| A song generation is never re-sent without the admin asking. | **Unchanged.** | A kie submit timeout or unknown outcome stops the run with `ambiguous_spend` and is never retried (8.6). |
| GPT Image via codex first, kie as fallback. | OD5 order. | Router in 11.3. |
| TikTok and Instagram publishing are non-goals. | Goals, through Postiz and Blotato (T19). | 12.5. |
| Hosting on Vercel plus hosted Supabase. | PC plus Cloudflare Tunnel (AC1). | Section 5; README deploy section and `.github/workflows/keepalive.yml` retired in M1. |
| No third-party secret reachable from the browser. | **Unchanged.** | 5.4. |

## 3. Current state (verified in the code on 02/11/2026)

**Done:** T7 library, T8 player, T9 create panel, T10 playlists and details panel, T11 stems
(Demucs) and audio editor, T13 Video Studio with live preview and Remotion render, the VideoHive
looks (T25, merged 02/11 into `packages/shared/src/visualizer/viz-looks.ts`); lyric videos (VBP
template, "MellodifAI Classico" preset); stable `/media` links; worker on the PC with local
Supabase in Docker.

**T12** (songs from songs) is in the checkout: migrations `20261101000023_songs_from_songs.sql` and
`20261101000024_covers_on_kie_only.sql` and `apps/web/app/actions/songs-from-songs.ts`. M1 builds
on top of it (7.1).

**Auth model, as the code really is.** Supabase Auth with email one-time codes, sent from the
browser (`components/login-form.tsx` calls `signInWithOtp`). A profile is created only for emails
in `admin_allowlist` (a table with just an `email` column), by the trigger
`create_allowlisted_profile` (`20261031000003_security.sql:1-26`), and **it always inserts the
role `admin`**: nothing in the code ever creates a `customer`, so today every allowlisted person
is an admin, and admins can read every object in the `previews` bucket
(current policy in `20261101000021_customer_preview_read.sql`). Revision 3 fixes this in M1
(6.2).

**Database privileges today.** `authenticated` holds a column INSERT grant on `public.jobs`
(`20261031000005_pipeline_hardening.sql:25-26`) and the policy "owners enqueue jobs"
(`20261031000008_perf_indexes.sql:22-33`) lets any signed-in user insert jobs for the stages
`draft_lyrics`, `generate_song`, `timing`, `publish` and `set_privacy` directly. `authenticated`
can also insert versions and update `versions.lyric_pack` (`pipeline_hardening.sql:23-24`). Every
workflow RPC is `security definer`, keys on `auth.uid()` and is granted to `authenticated` with no
role check, including the paid ones (`create_song`, `approve_lyrics`, `generate_again`,
`request_section_edit`, `import_song`, `retry_stage`) and the publishing ones (`enqueue_publish`,
`confirm_publication`, which also accepts `public` at once). The functions that check for `admin`
today are `resolve_kie_submission`, `resolve_upload` (`20261031000009_final_fixes.sql:66`), and
`create_song` and `request_section_edit` for local engines (`024:27`, `023:127`). Other direct
grants still in place: INSERT on `projects` (`core.sql:237`; update and delete were revoked in
`final_fixes.sql:2`) and `update (status)` on `jobs` with the policy "owners cancel queued jobs"
(`security.sql:31,47-51`). `versions.lyric_pack` UPDATE was already revoked (`web_flow.sql:8`).
`create_allowlisted_profile` is one function behind two triggers (on insert and on email
confirmation), and `[auth] enable_signup = false` (`config.toml:177`). Supabase's own default
privileges grant `anon` and `authenticated` on new objects created by `postgres`
(`final_fixes.sql:79-81`), which is why existing migrations revoke function by function.
Today PostgREST is reachable only on the PC, so this is safe; once anything Supabase is reachable
from outside it is not, which is why M1 changes it first (6.3). The web app writes nothing to
tables directly: every write is an RPC from a server action through `runAction`
(`apps/web/lib/run-action.ts`), which also revalidates the affected pages. The create panel calls
`create_song`; `create_project` is the older entry point.

**Lyric pipeline** (`apps/worker/src/stages/lyric-jury.ts`). Jev (`typesafe/jev-1.14`, through
OpenRouter's `/api/alpha/decisions`) picks the tone and the writer strength; it is not a cost
router. Writers are Claude Opus 5.5 ("strong") and Sonnet 5.5 ("fast") through OpenRouter. A jury
of three judges (Jev, Claude Haiku 5.5, Gemini 3.8 Flash) scores five criteria (`topic`,
`language`, `singable`, `chorus`, `original`); a criterion passes when its mean reaches
`PASS_SCORE` 0.7. The jury is **fail-open by design**: when no judge returns a valid verdict,
`combine()` returns `available: false, passed: true` (lines 333-344), which is right for the
human-approved flow because a person reads every draft. Reports are stored in
`versions.lyric_jury` (`20261101000015_lyric_jury.sql`, written by `stages/draft-lyrics.ts`, read
by `apps/web/lib/studio/clips.ts`). **There is no devil's advocate in the code** and **no direct
Anthropic API client**.

**Publishing is already built** (`apps/worker/src/stages/publish.ts`): private upload with
captions and thumbnail, upload-state recovery, `containsSyntheticMedia: true` always, and the
`scheduled` plus `publish_at` path in `set_privacy`. The stage always loads the version's
`master` render (line 12) and ignores `payload.render_id`; publications are looked up per version,
latest row only (`apps/worker/src/db.ts:495-507`, `authorization.ts:70`), so a master and a Short
of one version cannot both be published. `set_privacy` refuses to run without a human
`confirmed_by`, written by `confirm_publication` (`pipeline_hardening.sql:81-103`).
`reserve_youtube_upload` caps uploads at 4 per worker per Pacific day; at the cap the stage returns
`retryLater`. `enqueue_publish(render_id, metadata)` accepts only an approved current `master`.
`publications` is YouTube-only, one row per render, `render_id` NOT NULL. The engine repo's
`publish/yt.py` hard-codes two scopes (`youtube.upload`, `youtube.force-ssl`, line 20), keeps its
token in `publish/.secrets/` unless `YT_TOKEN_FILE` says otherwise (line 74), and exits without
`YT_CLIENT_ID`: the Google OAuth client is what is missing.

**Other existing stages to reuse:** `qa.ts` (master only: loudness -15 to -13 LUFS, true peak at
most -1 dBTP, crushed words, a 20-frame contact sheet); `render.ts` (`render_master` and
`render_hook`, the latter already 1080x1920); `visualizer.ts` with
`packages/visualizer/scripts/render.mjs` (renders this repo's Remotion project); `art.ts` (thumbnail
and SRT; it sets the version to `video_review`, line 30); `storyboard.ts` (writes
`data/<lang>/storyboard.json`). `score_takes` is not a stage: it is `tools/score_takes.py` in the
engine repo, called inside `generate_song`, `import-audio.ts:66` and `local-engine.ts:569`; its
`fidelity` value is in-order token recall of the intended lyrics in a Whisper transcript.
`approve_video` requires QA gates and an override reason when one fails
(`20261031000006_web_flow.sql:63-73`).

**Two Remotion projects.** `packages/visualizer` is this repo's (Video Studio). Kinetic lyrics and
the VBP lyric video render from the engine repo `C:\Users\Asus\Documents\suno-remake` (`motion/`:
`components/LyricText.tsx`, `WordPop.tsx`, `FontGate.tsx`, `layers/`, `scenes/Kinetic.tsx` and the
VBP scenes), whose path is hard-coded as `ENGINE_ROOT` in `apps/worker/src/stages/utils.ts:6`.

**Queue.** `jobs.version_id` is NOT NULL; `jobs.stage` has a check list; the current `claim_job`
(`20261101000018_library_reactions_trash.sql:30-42`) is first in, first out with `FOR UPDATE SKIP
LOCKED` and skips trashed songs; the worker heartbeats every running job every 15 s
(`apps/worker/src/loop.ts:211-217`) and `requeue_stale` re-queues after 120 s. A new stage needs a
check-list migration, an entry in `STAGES` and a `STAGE_STATUS` entry
(`packages/shared/src/stages.ts`, `status.ts:102-109`), a `stageAllowed` rule and registration in
`apps/worker/src/stages/index.ts`. The worker enqueues child jobs with the service role through
`db.enqueue` (`db.ts:344-359`), which carries no token or run. kie spending is guarded by
`versions.kie_submit_state` and `resolve_kie_submission`; `workers.kie_balance` holds the last
known balance.

**Web side.** `/media/[...path]` signs a storage URL as the session user, returns 404 without a
session, and redirects to the storage host (`127.0.0.1:44321`). Some pages build signed URLs on the
server too (`lib/studio/clips.ts:498`, `lib/studio/stems.ts:153`,
`app/(app)/projects/[id]/page.tsx:66,143`). The browser talks to Supabase directly for sign-in,
storage uploads and Realtime. All three Supabase clients read `NEXT_PUBLIC_SUPABASE_URL`
(`proxy.ts:21`, `lib/supabase/server.ts:7`, `lib/supabase/browser.ts:7`). Paid calls also start on
the web side: `app/actions/format-style.ts` (OpenRouter) and `app/api/transcribe/route.ts` (Groq).
`proxy.ts` calls `supabase.auth.getUser()` on every request. `lib/rate-limit.ts` is an in-memory
limiter. The Settings page shows only the email; provider keys live in env files
(`apps/worker/.env.local`, `apps/web/.env.local`).

**Hard-coded paths** (to remove under the portability rule, section 25): `utils.ts:6`
(`ENGINE_ROOT`), `engine.ts:153-154` (TMP), `workspace.ts:15-16`, `comfy/config.ts:19-22`,
`stems.ts:12`, `visualizer.ts:340`, `draft-lyrics.ts:179`.

**Supabase config** (`supabase/config.toml`): default JWT secret and well-known demo keys, local
Postgres password `postgres`, `site_url = http://127.0.0.1:3000`, email to the local mail catcher,
`[auth.oauth_server]` present but disabled.

**Tests:** vitest per app; `test:db` (root `package.json:13`) runs `supabase/tests` against
whatever stack is configured; e2e is pinned to a separate stack on port 45621 by the guard in
`apps/web/e2e/local-env.ts` (a live run once spent kie credits); fake stages in
`apps/worker/src/fake/index.ts`.

**Hosting in practice:** everything runs on the PC; the README still describes Vercel plus hosted
Supabase, and `.github/workflows/keepalive.yml` keeps the hosted project awake. Postiz runs at
`http://localhost:4007`. **Git:** the live checkout is on `build/studio-ui`; `main` is behind;
worktrees live in `E:/mellodifai/wt/`. **Keys present:** kie, OpenRouter, Groq, Higgsfield.
**Missing:** Google OAuth client, Blotato, Comfy Cloud, Gemini API, a guardrail-free OpenRouter key.

## 4. Goals, non-goals, anti-goals

Goals:
1. **Remake from a YouTube link** (section 8), end to end, in Copilot mode (pauses for approval)
   and Autopilot mode (stops only for the reasons in 8.6).
2. **Agent access** (sections 6 and 7): one operations layer used by the web UI, a versioned HTTP
   API, a `mellodifai` CLI and one MCP tool registry over stdio and Streamable HTTP; an agent
   skill.
3. **Quality system** (section 10): juries on lyrics, visuals and metadata, design rules in code,
   originality and distinctness gates, all enforced in the database before publish.
4. **Cost routing** (section 11), per medium and per tier (8.1): images follow OD5; music is kie
   Suno in the standard tier and ACE-Step local in the free tier; reasoning comes from the driving
   agent's subscription when an agent drives, otherwise from the app's OpenRouter models; all
   inside the per-video budget, with an atomic ledger and caps.
5. **Publishing** (section 12): the existing YouTube stage connected early (track P0) and
   extended, plus Postiz and Blotato, an app-owned schedule with veto window (OD3), Shorts.
6. **Daily improvement loop** (section 13), autonomous (OD4) and mechanically guarded.

Non-goals (now): public sign-up, payments, multi-tenant scaling, LoRA training, the social layer.

Anti-goals. A run that does any of these is a failure even if a video comes out; each is enforced
where stated:
- copying the source's melody, recordings, graphics, footage or exact lyrics (only structure,
  timing, mood and meaning carry over) - originality gates (10.3), source audio never given to a
  generator (8.4);
- spending money without the cost shown and within caps - a capped reservation for every job
  with paid calls, and a spend entry for every paid call in a stage (11.5);
- publishing a video that failed a required gate or has broken text, wrong lyrics, or silence -
  database publish gate (10.8);
- mass-produced sameness - distinctness gate (10.6);
- automating services whose terms forbid it: suno.com generation, the midjourney.com web UI,
  Google Flow, crawling. Two user-initiated fetches are allowed: the analysis-only download of a
  source the owner names (AC10) and the existing import of the owner's own Suno share links
  (`app/api/suno-link`, T12).

## 5. Deployment topology and what the tunnel exposes

### 5.1 One production topology (AC1)

Production is the owner's PC, with these services. Every service runs from the deploy clone
`<runtime root>/deploy` (revision 6; below) unless noted; no checkout holds key material (5.3).

| Service | Listens on | Windows account | Can read |
| --- | --- | --- | --- |
| Next (`next start -H 127.0.0.1 -p 3000`) | `127.0.0.1:3000` | `mdf-web` | the checkout, `apps/web/.env.local` |
| Edge proxy (`ops/edge-proxy.ts`, run with `tsx`) | `127.0.0.1:3080` | `mdf-web` | the checkout |
| Authorization server (`apps/auth`, `HOST=127.0.0.1`) | `127.0.0.1:3010` | `mdf-auth` | the checkout, `apps/auth/.env.local`, `<runtime root>/secrets/auth/` |
| Worker | none | the owner's account | everything, as today |
| Supabase (Docker) | `127.0.0.1:44321-44329` | Docker Desktop (owner) | its own volumes; `<runtime root>/secrets/supabase/` |
| `cloudflared` | outbound only | service | `<runtime root>/secrets/cloudflared/` |

- NTFS ACLs (set by `ops/services.ts install`, owner action because it needs administrator
  rights): `apps/web/.env.local` readable by the owner and `mdf-web` only;
  `apps/auth/.env.local` and `<runtime root>/secrets/auth/` by the owner and `mdf-auth` only;
  `apps/worker/.env.local` and every other folder under `<runtime root>/secrets/` by the owner only.
- **Deploy checkout and runtime root (revision 6, round-5 Major 1).** Production services run from
  a dedicated clone, `<runtime root>/deploy`, detached at the deployed tag; the owner's development
  checkout is never used by production. `ops/services.ts acl` removes inheritance on
  `<runtime root>` (owner and SYSTEM only). `ops/services.ts install` grants `mdf-web` and
  `mdf-auth` read and execute on the deploy clone and the Node install, write only on
  `apps/web/.next/cache`, and grants the `cloudflared` service account its own folder. An `icacls`
  probe, run as each service account, fails the install if either account can read any secret,
  any file under `<runtime root>/stacks` or `<runtime root>/backups`, or write any path the worker
  executes from (the deploy clone, `ComfyUI_windows_portable`, `tmp`, worktrees).
- **Port ownership (revision 6, round-5 Major 26).** `ops/services.ts` checks the owning account of
  each listening port (3000, 3010, 3080) at start and every 60 seconds, and stops `cloudflared` on a
  mismatch.
- Fallback if the owner does not create `mdf-web` and `mdf-auth`: every service runs as the
  owner's account. That voids every ACL claim above, and section 17 records that a compromise of
  Next or `apps/auth` is then a compromise of the PC.
- The dev server also binds loopback only (`next dev -H 127.0.0.1 -p 3001`) and is never tunnelled.
- **Remote** means "arrived through the tunnel": Next and `apps/auth` treat a request as remote
  when any of `x-mdf-remote: 1` (set by the edge proxy, overwriting any incoming value),
  `cf-connecting-ip` or `cf-ray` is present. Code already running on the PC, including Docker
  containers reaching the host through `host.docker.internal`, counts as local by design: the
  local-only rules (6.6) protect against use from the internet, not against code on the PC.
- `ops/services.ts` (a TypeScript script run with `tsx`, in the workspace package `@mellodifai/ops`)
  installs and starts the services in this order: Docker and Supabase, worker, `apps/auth`, Next,
  edge proxy, `cloudflared`. Before starting `cloudflared` it compares the live ingress file with
  `ops/cloudflared/config.template.yml` and refuses to start on a difference (tunnel drift).
- Vercel plus hosted Supabase is retired; M1 rewrites the README deploy section and deletes
  `.github/workflows/keepalive.yml`.
- Prerequisite (owner action, 22): move the mellodifai.com nameservers to Cloudflare and create
  the tunnel. Until then the remote half of M1 cannot pass its exit test; the local half can.

### 5.2 Public hostnames and routes (deny by default)

`cloudflared` points every public hostname at the edge proxy; the edge proxy forwards only the
paths below and returns 404 for everything else; the `cloudflared` ingress ends with
`http_status:404`.

| Step | Hostname | Allowed paths | Upstream |
| --- | --- | --- | --- |
| M1 | `app.mellodifai.com` | `/api/mcp`, `/api/v1/*`, `/.well-known/oauth-protected-resource`, `/.well-known/oauth-protected-resource/api/mcp`, `/login`, `/auth/confirm`, `/consent`, `/api/health`, `/_next/static/*`, `/_next/image`, `/favicon.ico` | Next |
| M1 | `app.mellodifai.com` | `/oauth/*`, `/.well-known/oauth-authorization-server/oauth`, `/.well-known/openid-configuration/oauth` | `apps/auth` |
| W1 | `app.mellodifai.com` | every UI page | Next |
| W1 | `api.mellodifai.com` | `/auth/v1/*`, `/rest/v1/*`, `/storage/v1/*`, `/realtime/v1/*` | Supabase gateway |
| M4 | `app.mellodifai.com` | `/m/*` | Next |
| M4 | `post.mellodifai.com` | the Postiz paths listed in the M4 plan | Postiz |

- **Credentials per route.** `/api/v1/*` accepts only a PAT in `Authorization: Bearer`. `/api/mcp`
  accepts a PAT or an OAuth access token. Neither ever accepts a cookie, so a remote cookie session
  reaches no operation through them. `/login`, `/auth/confirm` and `/consent` use the cookie.
- **Server actions.** Next dispatches server actions on a POST to any page, so an allowed page could
  reach every action. The control is in `runAction` (`apps/web/lib/run-action.ts`): it refuses
  (`forbidden_scope`) any call made remotely. Only the actions that `remoteAction` wraps run
  remotely: `sendSignInLink` (5.4) and `consentDecide` (6.4). A unit test scans every module that
  starts with `"use server"` and fails if an exported function is wrapped by neither; actions that
  return their own result type (`formatStyle`) call the same remote check directly. The edge proxy
  also refuses a `Next-Action` header outside `/login` and `/consent` as an extra filter (multipart
  action posts carry no such header, which is why `runAction` is the real control).
- `next.config` sets `experimental.serverActions.allowedOrigins` to `app.mellodifai.com`,
  `127.0.0.1:3000` and `localhost:3000`.
- **Never exposed:** Postgres 44322, Supabase Studio 44323, the mail catcher 44324, the Supabase
  meta and functions routes, ComfyUI, the worker, the dev server, the Docker API. A Windows
  Firewall rule (owner action) blocking LAN access to 3000, 3001, 3010, 3080, 4007, 8188 and
  44321-44329 is defence in depth against the LAN only; against containers the controls are the
  rotated database passwords and the probe (5.3).
- **Unauthenticated Supabase services are off in production (revision 6, round-5 Major 2).** The
  prod render sets `[studio]`, `[inbucket]` and `[analytics]` to `enabled = false`; the probe
  asserts that 44323, 44324 and 44327 refuse connections from a container and from `mdf-web`.
  Until SMTP is set up, the owner-run `ops/sign-in-link.ts <email>` prints a local sign-in link
  (service key, `auth.admin.generateLink`) as the no-SMTP fallback.

### 5.3 Supabase hardening (M1, before any route goes live)

1. **One rendered working folder per stack, outside the checkout.** `ops/stack.ts render
   --env <prod|e2e|ci|dev>` writes `<stack folder>/supabase/config.toml` from the repo's
   `supabase/config.toml` plus the per-environment values below, and links the repo's
   `supabase/migrations`, `supabase/seed.sql` and `supabase/templates`. Every `supabase` CLI call
   for that stack uses `--workdir <stack folder>`. Stack folders: production
   `<runtime root>/stacks/prod`, e2e `<runtime root>/stacks/e2e`, CI `$RUNNER_TEMP/stack`, dev
   `<runtime root>/stacks/dev`. The repo's own `config.toml` stays valid for a plain `supabase
   start` and holds no production values.

   | Value | dev | e2e | CI | prod |
   | --- | --- | --- | --- | --- |
   | `project_id` (revision 6, round-5 Major 17) | `mellodifai_dev` | `mellodifai_e2e` | `mellodifai_ci` | `mellodifai` (today's live stack, unchanged) |
   | `SITE_URL` (`auth.site_url`, and Next's server-only `SITE_URL`) | `http://127.0.0.1:3001` (revision 6, round-5 Major 18) | `http://127.0.0.1:3210` | `http://127.0.0.1:3210` | `https://app.mellodifai.com` |
   | `additional_redirect_urls` | `http://127.0.0.1:3001/**`, `http://localhost:3001/**` | `http://127.0.0.1:3210/**`, `http://127.0.0.1:3212/**` | `http://127.0.0.1:3210/**`, `http://127.0.0.1:3212/**` | `https://app.mellodifai.com/**`, `http://127.0.0.1:3000/**`, `http://localhost:3000/**` |
   | OAuth issuer (`apps/auth`, revision 6, round-5 Major 16) | not run (OAuth is tested on the e2e topology) | `http://127.0.0.1:3212/oauth` | `http://127.0.0.1:3212/oauth` | `https://app.mellodifai.com/oauth` |
   | Port block: API, db, Studio, mail catcher, analytics (revision 6) | 55321, 55322, 55323, 55324, 55327 | 45621, 45622, 45623, 45624, 45627 | 54321, 54322, 54323, 54324, 54327 | 44321, 44322, Studio off, mail catcher off, analytics off |
   | SMTP | mail catcher | mail catcher (45624) | mail catcher (54324) | the owner's SMTP sender (owner action); `email_sent = 30` per hour |
   | `signing_keys_path` | throwaway key in the stack folder | throwaway key in the stack folder | throwaway key in `$RUNNER_TEMP` | `<runtime root>/secrets/supabase/signing_keys.json` |
   | `jwt_secret` | default | default | default | `env(MDF_SUPABASE_JWT_SECRET)`, read from `<runtime root>/secrets/supabase/` at start; never written into the stack folder (revision 6, round-5 Major 1) |
   | `[auth.sessions]` | default | default | default | `timebox = "168h"`, `inactivity_timeout = "24h"` |
   | `public.stack_settings.fake_stack` (revision 6, replaces the `app.fake_stack` database setting; round-5 Major 3) | off | on | on | off (the deploy refuses to run if on) |

   **Production port note (2026-11-08).** Production uses 44321-44329, outside
   Windows dynamic TCP range 49152-65535. API=44321, DB=44322, shadow=44326,
   inspector=44328, pooler=44329; Studio, mail and analytics remain disabled.
   Windows stack start checks every configured port against that dynamic range
   and netsh exclusions before rendering or starting containers. Dev and CI
   historical ports remain unchanged and are refused on Windows; CI runs on Linux.

   **Revision 6 (round-5 Major 17).** `ops/stack.ts` refuses `reset`, `db reset` and
   `stop --no-backup` on the project id `mellodifai`; the only path that may reset the production
   database is `ops/restore.ts` (20). Moving today's live stack under `--workdir
   <runtime root>/stacks/prod` is a one-time cutover, `ops/cutover.ts`: data backup, stop, render
   with the same `project_id`, start with `--workdir`, compare the row count of every `public`,
   `auth` and `storage` table with the counts taken before the stop, and refuse to continue on any
   difference.

2. **Signing key outside the checkout (ruling 4).** `ops/rotate-supabase-keys.ts` generates an
   ES256 key with `supabase gen signing-key --algorithm ES256` directly into
   `<runtime root>/secrets/supabase/signing_keys.json` (readable by the owner only), sets a new JWT
   secret in the rendered production config, restarts, reads the new anon and service keys from
   `supabase status -o json` without printing them, and writes them into
   `apps/worker/.env.local` (`SUPABASE_SERVICE_ROLE_KEY`) and `apps/web/.env.local`
   (`NEXT_PUBLIC_SUPABASE_ANON_KEY`). `ops/check-no-keys.ts` (run in CI, by `ops/deploy.ts` and by a
   pre-commit hook) fails when a file named `signing_keys*.json` or `*jwks*.json`, or a JSON file
   holding a private JWK (`"d":`), exists anywhere in the working tree, tracked or not; from
   revision 6 it also scans `<runtime root>/stacks/` (round-5 Major 1). Exit test: a
   `service_role` JWT signed with the public demo secret is refused by the local gateway.
3. **Every database login password rotated (ruling 8).** Spike 2 lists every login role in the
   pinned Supabase Postgres image (`select rolname from pg_roles where rolcanlogin`; expected at
   least `postgres`, `supabase_admin`, `authenticator`, `supabase_auth_admin`,
   `supabase_storage_admin`, `supabase_functions_admin`, `supabase_replication_admin`,
   `supabase_read_only_user`, `pgbouncer`, plus `mdf_web` and `mdf_auth`) and records how the
   service containers receive their passwords. `ops/rotate-db-passwords.ts` sets a new random
   password for every one of them, stored in `<runtime root>/secrets/supabase/db-passwords.json`,
   and re-templates the service containers to use them. If the CLI-managed stack cannot take
   per-role passwords, spike 2's written fallback runs the production database stack from
   Supabase's pinned self-hosting compose files, which template every service role from one
   `POSTGRES_PASSWORD`, rendered into `<runtime root>/stacks/prod`. **Exit probe:** from a throwaway
   container on Docker's default bridge network, a login to `host.docker.internal:44322` as every
   listed role with the default password `postgres` must fail; so must `mdf_web` and `mdf_auth`
   without their passwords. M1 does not exit until it does.
   **Revision 6 (round-5 Major 20).** The CLI recreates its service containers with built-in
   credentials on every `supabase start`, so `ops/services.ts start` (and `ops/deploy.ts`) re-apply
   the stored passwords and run the probe on every start, and refuse to start `cloudflared` when the
   probe fails. If spike 2 takes the compose fallback, its write-up gives the compose equivalent of
   `supabase gen signing-key`, `status -o json`, `signing_keys_path`, the email template's
   `content_path`, `[auth.sessions]` and the restore's stop and start before step 1 of the plan
   starts.
4. `[auth] enable_signup = false` stays (`config.toml:177`).
5. Postiz gets `DISABLE_REGISTRATION=true` in M4.

### 5.4 Sign-in

- `components/login-form.tsx` calls the server action `sendSignInLink(email, next)` (wrapped by
  `remoteAction`). It validates `next` (below), builds `emailRedirectTo` per request with
  `lib/redirect-url.ts` (revision 6, round-5 Major 18: the request's own origin for a local
  request, accepted only when it matches that environment's `additional_redirect_urls` (5.3) and
  refused otherwise; `SITE_URL` for a remote one; then `/auth/confirm?next=<encoded next>`), and
  runs `signInWithOtp` with
  `shouldCreateUser: false` on the server. It answers the same way whether or not the email is
  allowlisted, and limits 5 calls per 15 minutes per email.
- **Email template** `supabase/templates/magic_link.html` (Create; named in the rendered config as
  `[auth.email.template.magic_link] content_path`): its link is
  `{{ .RedirectTo }}&token_hash={{ .TokenHash }}&type=email`, so the link always returns to the
  origin the request came from (ruling 6). **Revision 6 (round-5 Major 15):** the email also
  carries the 6-digit `{{ .Token }}`, and `/login` accepts that code (`verifyOtp`, type `email`), so
  an owner whose mail app opens links in another browser signs in inside the browser that started
  the OAuth flow; the README states that the link only works in the starting browser.
- `app/auth/confirm/route.ts` (Modify) accepts `token_hash` plus `type` (`verifyOtp`) or `code`
  (`exchangeCodeForSession`), then redirects to the validated `next`.
- **`next` rule:** a relative path. Remote requests accept only `/consent?uid=<id>`; local
  requests accept any app path. Anything else becomes `/create` (local) or `/login` (remote).
- `lib/redirect-url.ts` (Modify) builds absolute URLs from the request's origin for local requests
  and from the server-only `SITE_URL` for remote ones; `NEXT_PUBLIC_SITE_URL` is replaced by
  `SITE_URL` in Next, `playwright.config.ts` and `ci.yml`.
- `proxy.ts` keeps its rewrite of stray `?code=` requests to `/auth/confirm`, takes Supabase's
  URL from the new server-only `SUPABASE_INTERNAL_URL`, and excludes `/api/v1`, `/api/mcp`,
  `/.well-known/`, `/api/health` and `/api/transcribe` from its matcher (the last because the proxy
  buffers at most 10 MB and silently truncates larger transcription uploads today).
- New users: there is no sign-up and no in-app way to add people in M1. `ops/add-user.ts <email>
  <role>` (owner, local, service key) inserts the allowlist row and creates the auth user with
  `auth.admin.createUser({ email, email_confirm: true })`. Inviting from Settings is M2a.

### 5.5 Cloudflare setup

The owner runs `cloudflared tunnel login` and `cloudflared tunnel create mellodifai` once. The
credentials JSON and the live `config.yml` live in `<runtime root>/secrets/cloudflared/`; the repo
holds `ops/cloudflared/config.template.yml`. No Access application and no WAF rule in M1.

### 5.6 Health

`/api/health` returns `{ web: "ok" }` to remote callers. Local callers also get `db`, `ops`
(`ops.health()` called as `mdf_web`, which writes and reads back a heartbeat row, so a read-only or
broken ops layer is unhealthy), `worker_heartbeat_age_s`, `queue_depth`, `version` and `schema`
(the newest applied migration).

### 5.7 Moved out of M1

`/media` streaming, the browser Supabase URL switch and cookie-name pinning go to W1 (they matter
only once UI pages are remote). Capability links stay M4.

## 6. Identity, scopes and authorization

### 6.1 Principals

| Principal | Credential | Reaches the database through |
| --- | --- | --- |
| Person in the web UI | Supabase cookie session | Reads: supabase-js under RLS, as today. Writes: `ops` functions as `mdf_web` (6.3). |
| Agent with a personal access token (PAT) | `Authorization: Bearer mdf_pat_...` | `ops` functions only, reads included. |
| Remote agent (claude.ai, ChatGPT) | opaque OAuth access token from `apps/auth` | `ops` functions only, through `/api/mcp`. |
| Authorization server `apps/auth` | Postgres role `mdf_auth` | Only the `ops.oauth_*` functions of 6.4. |
| Worker | service role | As today, plus the worker ledger and scheduler functions (11.5, 14.4). |
| Autopilot (M5) | system token row | Worker-only functions (6.5). |

### 6.2 Scopes and roles

- `read`: read the actor's own songs, jobs and costs.
- `create`: actions with no kie or other generation spend. They may reserve bounded incidental
  transcription (Groq take scoring for `take_pick`, `video_make`, `video_rerender`; at most the
  `provider_operations` estimate, counted against the caps like any spend).
- `spend`: actions that reserve generation spend (`song_create`, `lyrics_approve`,
  `song_generate_again`, a retry of a paid stage).
- `publish`: not grantable before M4.
- **Who holds tokens in M1: admins only.** `ops.admin_token_create` and `ops.oauth_consent` refuse
  an owner whose role is not `admin` (exit test). Customers use the web UI only.
- **Admin operations** (6.3.6) need a cookie session of an admin, made locally, with a recently
  refreshed session (6.3.4).
- **Roles** (migration `ops_roles`, 15.1): `admin_allowlist` gains `role` (default `customer`) and
  a unique index on `lower(email)`; the migration copies today's roles from `profiles`, then
  `create_allowlisted_profile` inserts the allowlist row's role. `ops/set-owner.ts` (run by
  `ops/deploy.ts` after migrations, as the database owner) sets `admin` for
  `MELLODIFAI_OWNER_EMAIL` and `customer` for every other row in both tables, and aborts the deploy
  unless exactly one admin exists. There is no role editing in the app in M1, so nothing is undone
  at the next deploy. `supabase/seed.sql` inserts `('admin@mellodifai.local', 'admin')`;
  `apps/web/e2e/global-setup.ts` creates the e2e admin with role `admin` and a second e2e user with
  role `customer`.
- Customers are never granted `publish` or local engines; their UI spending is bounded by the
  `default:customer` caps (11.5).

### 6.3 The operations layer in the database (AC14)

No role used by Next or `apps/auth` can call a mutating `public` function, so scopes, caps,
reservations, idempotency, audit and the admin rules cannot be skipped by anything that holds those
credentials.

#### 6.3.1 Roles and connections

| Role | Used by | Connection env var |
| --- | --- | --- |
| `mdf_web` | Next (`apps/web/lib/db/ops-client.ts`, `postgres` npm client) | `MDF_WEB_DATABASE_URL` in `apps/web/.env.local` |
| `mdf_auth` | `apps/auth` | `MDF_AUTH_DATABASE_URL` in `apps/auth/.env.local` |

The migration creates both roles only if they do not exist (`do $$ begin if not exists (select 1
from pg_roles where rolname = 'mdf_web') then create role mdf_web nologin noinherit; end if; ...`),
because roles are cluster-wide and a `db reset` can keep them. `ops/rotate-db-passwords.ts` (prod)
and `ops/stack.ts` (e2e, CI) set `LOGIN PASSWORD`. Neither role owns anything or is a member of
any role. There is no JWT signing key in Next or `apps/auth`.

#### 6.3.2 Grants

```sql
-- Global default: no new function is executable by PUBLIC (the per-schema form cannot remove the
-- built-in PUBLIC EXECUTE on functions; this global form can).
alter default privileges for role postgres revoke execute on functions from public;
-- Supabase's per-schema defaults grant anon and authenticated directly
-- (20261031000009_final_fixes.sql:79-81); reverse them for both schemas.
alter default privileges for role postgres in schema public revoke execute on functions from anon, authenticated;
alter default privileges for role postgres in schema public revoke all on tables, sequences from anon, authenticated;
alter default privileges for role postgres in schema ops    revoke execute on functions from anon, authenticated, service_role;
alter default privileges for role postgres in schema ops    revoke all on tables, sequences from anon, authenticated, service_role;
create schema ops;
revoke all on schema ops from public;
grant usage on schema ops to mdf_web, mdf_auth, service_role;
-- Every ops function: security definer, owner postgres, set search_path = '', and EXECUTE granted
-- by name to exactly one of mdf_web, mdf_auth, service_role (6.3.6, 6.4, 11.5, 14.4) after an
-- explicit revoke from public.
```

The lockdown (migration `ops_lockdown`, the last M1 migration, 21.2):

```sql
revoke execute on all functions in schema public from public, anon, authenticated;
grant execute on function public.my_playlists(), public.my_queue_positions(),
  public.my_section_queue(), public.my_stems_queue(), public.my_visualizer_queue(),
  public.playlist_membership(uuid[]) to authenticated;   -- the UI's six read RPCs
-- No RLS or storage policy in the repo calls a public function, so nothing else is re-granted.
revoke insert on public.jobs from authenticated;                 -- security.sql:30
revoke update on public.jobs from authenticated;                 -- security.sql:31
drop policy "owners enqueue jobs" on public.jobs;                -- perf_indexes.sql:22-33
drop policy "owners cancel queued jobs" on public.jobs;          -- security.sql:47-51
revoke insert on public.projects from authenticated;             -- core.sql:237
revoke insert on public.versions from authenticated;             -- pipeline_hardening.sql:23
drop function public.resolve_kie_submission(uuid, text);        -- the old overload, 007:52-75
```

`service_role` keeps EXECUTE on the `public` functions it has today (Supabase grants it every
function; `final_fixes.sql:102` adds some explicitly). That is not a hole, since the service key
already bypasses RLS; `acl-allowlist.json` lists those grants rather than the migration revoking
them. Storage write policies used by the cookie UI stay unchanged ("owners upload studio files",
"owners delete studio files" with a profile check added, "owners upload edited audio", "owners
delete unsaved edited audio").

#### 6.3.3 ACL test (CI, `supabase/tests/ops_acl.test.ts`)

Connects as the database owner and compares with `supabase/tests/acl-allowlist.json`:
- for every function, table, view and sequence in `public` and `ops`: `has_function_privilege`,
  `has_table_privilege`, `has_sequence_privilege` for `anon`, `authenticated`, `mdf_web`,
  `mdf_auth`, `service_role`;
- column grants from `information_schema.column_privileges` for the same five roles;
- schema USAGE for `mdf_web` and `mdf_auth` in every non-system schema;
- the `storage.objects` policy names and definitions;
- `pg_auth_members` rows where `mdf_web` or `mdf_auth` is the member (expected: none);
- every `ops` function is `security definer` with an empty `search_path`.
Any difference fails, so a new callable object needs a reviewed change to the allowlist file.

#### 6.3.4 How a wrapper works

An `ops` function that acts for a user has the form `ops.<op>(p_ctx jsonb, ...) returns jsonb` and
returns `{"ok": true, "data": ...}` or `{"ok": false, "code": ..., "message": ...}`. `p_ctx` holds
`actor_kind` (`session`, `pat`, `oauth`), `user_id` and `session_id` (sessions), `token_hash` or
`access_token_hash` (tokens), `remote`, `request_id`, `idempotency_key`, `request_hash`. Steps:

1. **Resolve the actor.**
   - Session: Next reads `session_id` and `sub` with `supabase.auth.getClaims()` (which verifies
     the access token); the wrapper requires an `auth.sessions` row with that `id` and `user_id`,
     `not_after` null or future, and `coalesce(refreshed_at, created_at)` within the last 65 minutes
     (the access-token lifetime plus margin; refreshing the cookie updates it). Production sessions
     also end by the `timebox` and `inactivity_timeout` of 5.3. Spike 2 confirms that a
     `postgres`-owned definer function can read `auth.sessions`.
   - PAT: `agent_tokens.token_hash = token_hash`, not revoked, not expired; if `remote` is true and
     the token's `remote` is false, refuse.
   - OAuth: as 6.4, and only while the `remote_mcp` flag is on (read in the database).
2. **Check** the profile, the scope, the role rule, the admin rule (`actor_kind = 'session'`, role
   `admin`, `remote = false`), and the test rule: a `test_mode` token may act only on versions with
   `test_run = true`, and any other actor only on versions with `test_run = false`.
3. **Idempotency** (operations that enqueue or spend): for token actors the key is required
   (`validation` if missing). Next has opened the key in its own committed transaction (7.2).
4. **Work**, inside `begin ... exception ... end` (a savepoint):
   - set, transaction-locally, **all three** claim settings (ruling 2):
     `set_config('request.jwt.claim.sub', actor, true)`,
     `set_config('request.jwt.claim.role', 'authenticated', true)` and
     `set_config('request.jwt.claims', json_build_object('sub', actor, 'role', 'authenticated')::text, true)`,
     then assert `auth.uid() = actor` (raises `MDF03` otherwise);
   - set `mdf.job_ctx` locally to `{token_id, run_id, fake_providers}` (`fake_providers` from the
     token's `test_mode`, never from `p_ctx`);
   - call the `public` RPC. The trigger `jobs_stamp_ctx` (`before insert or update` on `jobs`)
     stamps every job row the RPC inserts or re-queues (including `request_stems` and
     `request_visualizer` reusing an old row) with the context and appends its id to the
     transaction-local `mdf.job_ids`;
   - call `ops.reserve_job(job_id)` for each id in `mdf.job_ids` (11.5);
   - mark the idempotency key `done` with the response.
5. **On failure** (any exception in the savepoint): the work is rolled back, and in the same
   transaction the wrapper deletes the idempotency key row (so a corrected retry with the same key
   runs) and writes an `error` audit row. **On success** it writes an `ok` audit row. Then it
   clears the three claim settings and `mdf.job_ctx`.

**Revision 6 (round-5 Major 3): caller-settable settings are never trusted.** Every `ops` function,
reads included, starts by resetting `mdf.job_ids`, `mdf.job_ctx` and the three claim settings
locally, and carries `set timezone = 'UTC'`, so session recency is compared in UTC whatever the
caller's `TimeZone`. Read functions filter only by the actor id resolved in step 1 and never call a
helper that reads `auth.uid()`. The fake-stack switch is the row `public.stack_settings.fake_stack`,
writable only by `postgres` (15.1); a transaction-local `mdf.force_caps = 'on'` may turn real caps
on for one transaction (the database tests use it) but nothing can turn them off.

**Revision 6 (round-5 Major 21): `jobs_stamp_ctx` on context-free updates.** When `mdf.job_ctx` is
unset (the worker's PostgREST requeues), the trigger does nothing. When it is set, it never flips
`fake_providers` from true to false and never sets `token_id` to null.

`request_hash` is the SHA-256 of the canonical JSON (keys sorted, no whitespace) of
`{"op": <operation>, "input": <validated input>}`.

#### 6.3.5 Error codes (frozen; additive only)

| Code | HTTP | Meaning |
| --- | --- | --- |
| `unauthorized` | 401 | no or bad credential, unknown or stale session |
| `forbidden_scope` | 403 | missing scope, wrong role, admin, remote or test rule |
| `not_found` | 404 | object missing or not the actor's |
| `conflict` | 409 | the object is not in the needed state |
| `idempotency_mismatch` | 409 | same key, different request |
| `in_progress` | 409 | same key, request still running (`retry_after` 2) |
| `ambiguous_spend` | 409 | a kie submission's outcome is unknown |
| `validation` | 422 | bad input |
| `cap_exceeded` | 402 | a cap refused the reservation (`details`: scope, provider, unit, period) |
| `rate_limited` | 429 | rate limit (`retry_after`) |
| `internal` | 500 | anything unmapped |

**`MDF` SQLSTATEs (revision 6, round-5 Major 11).** `ops.map_error` checks the SQLSTATE before any
message rule, so rule 7 below runs first:

| SQLSTATE | Condition | Public code | `details.reason` |
| --- | --- | --- | --- |
| `MDF01` | idempotency key missing for a token actor | `validation` | `idempotency_key_required` |
| `MDF02` | a cap refused a reservation or an extension | `cap_exceeded` | `cap` (plus scope, provider, unit, period) |
| `MDF03` | claim mismatch (`auth.uid()` differs from the actor) or `oauth_upsert` refusal | `unauthorized` | `claim` or `consent` |
| `MDF04` | test rule (test token on a real version, or the reverse) | `forbidden_scope` | `test_rule` |
| `MDF05` | price missing | `internal` | `price_missing` |
| `MDF06` | no cap row (fail closed, 11.5), including a token without its token cap row | `cap_exceeded` | `no_cap` |
| `MDF07` | spend entry beyond what the reservation charged and the extension was refused (11.5) | `cap_exceeded` | `entry_beyond_reservation` |
| `MDF08`-`MDF12` | reserved; any use needs a row here first | - | - |

1. `authentication required`, `profile required` -> `unauthorized`.
2. `admin required`, `local engines are admin only` -> `forbidden_scope`.
3. `owned % required`, `% not found`, `render missing`, `source take required`,
   `failed job required` -> `not_found`.
4. `kie submission state unknown%`, `resolve unknown submission first`,
   `kie task may still succeed%` -> `ambiguous_spend`.
5. `invalid %`, `%too long`, `too many %`, `% must %`, `a part is %`, `range outside the take`,
   `an upload or a take, not both`, `title required`, `language required`, `metadata required`,
   `prompt or title required`, `task id required`, `video id required`,
   `override reason required`, `lyrics of the part required`,
   `publish_at requires scheduled privacy` -> `validation`.
6. any other message ending in `required` or containing ` already `, plus `transition not
   allowed`, `version not approved`, `rewrite discarded`, `song not ready for a rewrite`,
   `the song has new takes since this rewrite`, `this engine cannot start from audio in this way`
   -> `conflict`.
7. SQLSTATEs `MDF01`-`MDF12` -> their codes (`packages/shared/src/ops/errors.ts`).
8. anything else -> `internal`.

Test (`supabase/tests/ops_errors.test.ts`): starting from every `ops` function, it follows
`public.<name>(` references in `pg_proc.prosrc` transitively, collects every `raise exception '...'`
text of the functions reached, and fails if one maps to `internal`.

#### 6.3.6 Which role may call what

- `mdf_web`, cookie operations (every server action, one wrapper each): the M1 rows of 7.3 plus
  `ops.style_format_check` and `ops.transcribe_check` (rate and role checks for the two web-side
  tools, 6.7), `ops.take_save_edit`, `ops.song_import`, `ops.song_source_set`, the playlist,
  reaction, rename, trash, restore and play wrappers, the section-edit wrappers, and (revision 6,
  round-5 Major 24) `ops.audio_keep` (the `keep_audio` action; it may enqueue `timing`, which
  reserves Groq by the 11.5 rule), `ops.take_choose` (the `choose_take` action, next to the
  section-edit wrappers). The older `create_project` action is routed to
  `ops.admin_project_create`.
- `mdf_web`, token operations: exactly the rows of 7.3 whose MCP tool is not "none".
- `mdf_web`, admin (cookie, admin, local): `ops.admin_token_create`, `ops.admin_token_revoke`,
  `ops.admin_tokens_list`, `ops.admin_flag_set`, `ops.admin_pairing_open`,
  `ops.admin_resolve_kie_submission`, `ops.admin_resolve_upload`, `ops.admin_enqueue_publish`,
  `ops.admin_confirm_publication` (refuses `scheduled`), `ops.admin_video_approve_override`,
  `ops.admin_project_create`.
- `mdf_web`, infrastructure: `ops.idem_begin`, `ops.resolve_access_token`, `ops.oauth_consent_info`,
  `ops.oauth_consent`, `ops.flags`, `ops.health`.
- `mdf_auth`: the `ops.oauth_*` storage functions of 6.4.
- `service_role`: the ledger and scheduler functions of 11.5 and 14.4, `ops.worker_enqueue`.
`ops.stage_retry` refuses the stages `publish` and `set_privacy` for token actors and non-admin
sessions.

#### 6.3.7 Exit tests (database, M1)

- `mdf_web` and `mdf_auth` hold EXECUTE on no `public` function; `mdf_web` cannot call any
  `ops.oauth_*` storage function and `mdf_auth` cannot call any other `ops` function.
- **Claim injection (ruling 2):** as `mdf_web`, `set_config('request.jwt.claim.sub', <user B>,
  false)`, then `ops.song_rename` with user A's valid context on user B's version returns
  `not_found`, and B's row is unchanged; the same with `request.jwt.claims` preset.
- With a customer session JWT against the local PostgREST: a direct `jobs` insert, a `jobs` update,
  a `projects` insert, `approve_lyrics`, `generate_again`, `enqueue_publish` and
  `confirm_publication` are refused; the same with an admin session JWT.
- Through `ops` as a customer session: `ops.lyrics_approve` returns `cap_exceeded` (kie credit cap
  0); `ops.song_create` succeeds under the customer USD cap with the pinned test prices.
- A customer cannot get a PAT or complete `ops.oauth_consent` (`forbidden_scope`).
- A PAT with `create` only: `ops.lyrics_approve` and `ops.stage_retry` on a `publish` job return
  `forbidden_scope`; a `test_mode` PAT on a real version returns `forbidden_scope`.
- An admin operation with `remote = true`, a stale session (`refreshed_at` 2 hours ago) or an
  unknown session id is refused.
- The ACL test and the error-map test pass.

### 6.4 Remote MCP authorization (AC2)

**Service.** `apps/auth`, a small Node service on `oidc-provider` (panva, MIT), running as the
Windows account `mdf-auth` (ruling 5) on `127.0.0.1:3010`. Wiring (confirmed in step 0 spike 1):
- issuer `https://app.mellodifai.com/oauth`, mounted under `/oauth`, `proxy: true` (it sits behind
  the edge proxy and reads `x-forwarded-*`);
- discovery: the library serves `/oauth/.well-known/openid-configuration`; `apps/auth` also serves
  the RFC 8414 path-insertion forms `/.well-known/oauth-authorization-server/oauth` and
  `/.well-known/openid-configuration/oauth` with the same document (both on the edge allowlist);
- features: dynamic client registration, PKCE required (S256), authorization code grant only,
  resource indicators required and limited to `https://app.mellodifai.com/api/mcp`, opaque access
  tokens (the library's default random format; 1 h) and rotating refresh tokens (30 days); no
  custom token prefix;
- the issuer is per environment (5.3 table, revision 6), read from `MDF_AUTH_ISSUER`;
- **revision 6 (round-5 Major 13):** `interactions.url` returns `/oauth/interaction/<uid>`, served
  by `apps/auth`, so the library's interaction cookie is scoped under `/oauth` and reaches the
  resume route. That handler sets `mdf_flow`, stores `sha256(nonce)` through
  `ops.oauth_flow_nonce_set(uid, nonce_hash)` (the interaction row already exists, because the
  library saves it before computing the URL), and redirects to `/consent?uid=<uid>`. The resume
  route is `apps/auth`'s own handler at `/oauth/interaction/:uid/resume`, which calls
  `provider.interactionFinished`. Spike 1 confirms the cookie reaches the resume route;
- keys: ID-token signing keys in `<runtime root>/secrets/auth/jwks.json` (generated by
  `ops/rotate-auth-keys.ts`, readable by the owner and `mdf-auth` only); cookie keys
  `MDF_AUTH_COOKIE_KEYS` and `MDF_AUTH_DATABASE_URL` in `apps/auth/.env.local`.

**Pairing window (registration only on purpose).** Dynamic registration is accepted only while a
pairing window is open: the admin clicks "Collega un agente" ("Connect an agent") in Settings >
Agenti on the PC, which calls `ops.admin_pairing_open(p_ctx)` and opens a 10-minute window;
`apps/auth` claims it with `ops.oauth_registration_claim(...)` (revision 6, below) before accepting
a registration. The edge proxy
also limits registrations to 10 per hour per `cf-connecting-ip`. Redirect URIs must be on
`apps/auth/redirect-allowlist.json` (the claude.ai and ChatGPT connector callbacks recorded by the
spike, and `http://127.0.0.1:<port>/...` or `http://localhost:<port>/...` for local clients).
**Revision 6 (round-5 Major 27):** `apps/auth` calls `ops.oauth_registration_claim(client_id,
client_name, redirect_uris)` instead of a read-only check; it accepts the registration only while
the window is open and closes the window in the same statement, so the first successful
registration ends it. Settings > Agenti shows that client (name, redirect host, time) next to the
pairing button for the admin to confirm. A client whose redirect URIs are all loopback may get a
consent only from a local request (`ops.oauth_consent` refuses it with `forbidden_scope` when
`remote` is true).

**Flow binding (ruling 7).** When `apps/auth` starts an interaction it sets a cookie `mdf_flow`
(random 256-bit nonce, `HttpOnly`, `Secure` on the public host, `SameSite=Lax`, path `/`, 15
minutes) and stores `sha256(nonce)` on the interaction through `ops.oauth_flow_nonce_set` (revision
6; see the wiring above). The consent page
and the resume both require that cookie:
1. `/consent?uid=...` requires the Supabase session (via `/login?next=/consent?uid=...`) and the
   `mdf_flow` cookie; it calls `ops.oauth_consent_info(p_ctx, uid, nonce)`, which returns
   `{client_name, client_id, redirect_host, registered_at, requested_scopes}` only if the nonce
   hash matches the interaction; otherwise the page says "start the connection again from your
   agent in this browser".
2. The page shows the client name, redirect host and registration time, with only `read` ticked;
   `create` and `spend` are available (spend with a second confirmation, typing the client name),
   plus an admin-only "Test (fake providers)" box. `consentDecide` calls
   `ops.oauth_consent(p_ctx, uid, nonce, scopes, test_mode)`. It refuses non-admin owners and
   writes, in one transaction, the consent row (`oauth_consents`: uid, user, client id, scopes,
   test mode, nonce hash, `used_at` null), the `agent_tokens` row (kind `oauth`, `remote = true`,
   `expires_at` 90 days) and its `spend_caps` token row (1 USD per day). **Revision 6 (round-5
   Major 14):** in the same transaction it first revokes every live or unbound OAuth row of the
   same owner and client (expired or abandoned ones included) and deletes their `oauth_store`
   rows, so `agent_tokens_one_grant` never blocks a reconnect.
3. `/oauth/interaction/:uid/resume` requires the same `mdf_flow` cookie; `apps/auth` calls
   `ops.oauth_interaction_result(uid, nonce)`, which returns the decision only if the nonce hash
   matches and `used_at` is null, and sets `used_at` (single use). `apps/auth` then creates its
   Grant with exactly those scopes and calls `ops.oauth_bind_grant(uid, grant_id)`, which writes
   `agent_tokens.grant_id` only where it is still null.
An attacker who starts the flow in his own browser and sends the consent link to the owner gets
nothing: the owner's browser has no `mdf_flow` cookie for that interaction, so the consent page
refuses.

**Storage and what `mdf_auth` may do (ruling 5).** `mdf_auth` may call only:
`ops.oauth_find(model, id_hash)`, `ops.oauth_find_by_uid(uid)`, `ops.oauth_upsert(model, id_hash,
payload, grant_id, uid, expires_at)`, `ops.oauth_consume(model, id_hash)`,
`ops.oauth_destroy(model, id_hash)`, `ops.oauth_revoke_by_grant(grant_id)`,
`ops.oauth_registration_claim(client_id, client_name, redirect_uris)`,
`ops.oauth_flow_nonce_set(uid, nonce_hash)`, `ops.oauth_interaction_result(uid, nonce)`,
`ops.oauth_bind_grant(uid, grant_id)`. Rules inside them:
- ids are stored as SHA-256 hashes, and the payload is stored without `jti` (which equals the
  opaque token value); the spike confirms the adapter works with the hash as its lookup key;
- **revision 6 (round-5 Major 12):** uid and nonce are checked only where they exist, on
  `Interaction` rows (`oauth_flow_nonce_set`, `oauth_interaction_result`). For
  `AuthorizationCode`, `AccessToken` and `RefreshToken`, `ops.oauth_upsert` accepts the row only
  when its `grant_id` joins to an `agent_tokens` row (bound once by `oauth_bind_grant`) whose
  `oauth_consents` row has `used_at` set, with the same client id, the payload's scopes a subset
  of the consent's, the grant row live and not revoked, and `expires_at` at most the configured
  lifetime (1 h, 30 days, 10 minutes for codes); otherwise it raises `MDF03`. A compromised
  `apps/auth` can therefore mint tokens only for live grants that came from a used consent, up to
  each grant's scopes and its token cap.

**Resource server.** `/api/mcp` serves Protected Resource Metadata at
`/.well-known/oauth-protected-resource` and `/.well-known/oauth-protected-resource/api/mcp`, and
answers 401 with `WWW-Authenticate: Bearer resource_metadata="..."`.
`ops.resolve_access_token(token_hash, resource)` requires the `remote_mcp` flag on, the
`AccessToken` row live, unconsumed and bound to the resource, and the `agent_tokens` row (joined on
`grant_id`) live; it returns `{user_id, token_id, scopes, test_mode}`. Effective scopes are the
intersection of the token's and the grant row's; the grant row is the upper bound.

**Revocation and kill.** `ops.admin_token_revoke` sets `revoked_at` and deletes the grant's
`oauth_store` rows in one transaction; tokens are resolved in the database on every call. Turning
`remote_mcp` off (`ops.admin_flag_set`, local Settings) makes `resolve_access_token`,
`ops.oauth_consent` and remote PAT use fail at once. The remote kill when the owner is away from
the PC is outside the app: disable the public hostname in the Cloudflare dashboard (or stop
`cloudflared` remotely if he has a remote desktop); this is written in the README.

**Spike fallback.** If `oidc-provider` cannot be wired as above, the same `apps/auth` is built on
`@node-oauth/oauth2-server` (MIT) with hand-written metadata, registration and resource checks,
the same opaque tokens, `oauth_store`, `mdf_flow` cookie and `ops.oauth_*` functions. No Supabase
exposure and no JWT library either way.

### 6.5 Autopilot as an explicit actor (M5)

- An `autopilot_policies` row per owner (enabled, allowed tiers, per-run cap, runs per day,
  premium budget, publish allowed, platforms). Only the owner edits it in Settings > Autopilota
  ("Autopilot").
- A system token row (`kind = autopilot`) per owner, so the ledger and audit log charge Autopilot
  by name. A run started by a token is charged to the system token and also counted against the
  initiating token's caps (both counters are checked by `ops.reserve_job`).
- Worker-only RPCs (`autopilot_approve_lyrics`, `autopilot_pick_take`, `autopilot_approve_video`,
  `autopilot_schedule_publish`), granted to `service_role` only. Each checks: policy enabled, run
  in Autopilot, the required `jury_reports` for that stage have `available = true` and `passed =
  true` with no must-fix item, caps hold. They record `confirmed_by` = the policy owner and the new
  column `confirmed_via = 'autopilot:<policy id>'`. `set_privacy` accepts `confirmed_via =
  autopilot` only when the bundle's veto window has expired with no veto.
- Autopilot never uses the override path: a failed QA or jury gate stops the run.
- Start: only through `remake_start` (or `song_create`) with `mode = autopilot` by an allowed actor
  (6.2). "Runs per day" is enforced inside `ops.remake_start` by counting today's Autopilot runs of
  that owner under a row lock on the policy row.

### 6.6 Token records and format

`agent_tokens` (15.1) holds PATs, OAuth grants and, from M5, the Autopilot system token. **PAT
format:** `mdf_pat_` plus 32 random bytes in base62. Next generates it
(`apps/web/lib/ops/tokens.ts`), passes only its SHA-256 hex and a hint (`mdf_pat_...` plus the last
4 characters) to `ops.admin_token_create`, and shows the full token once. A PAT is local-only
unless created with "remote" ticked, which requires an expiry (default 90 days). Every token gets
its `spend_caps` row when it is created (`ops.admin_token_create`, `ops.oauth_consent`), and a
token actor without a token cap row is refused (`MDF06`, revision 6, round-5 Major 11).

**Settings > Agenti** (`app/(app)/settings/agents/page.tsx`, admin only, local only): a table of
tokens (name, kind, hint, scopes, remote, test, expires, last used, revoked) from
`ops.admin_tokens_list`; a "Nuovo token" ("New token") form (name, scopes `read` `create` `spend`,
remote with expiry, test) that shows the token once in a dialog; a "Revoca" ("Revoke") button per
row with a confirmation; the `remote_mcp` switch; the "Collega un agente" button with the
remaining pairing time. Every action returns the normal `ActionResult` and refreshes the table.

### 6.7 Rate limits

- In Next (`lib/rate-limit.ts`, sliding window, per token or per user): 60 reads per minute and 10
  writes per minute, where a write is a mutating operation (7.3 marks each), so `job_status`
  polling counts as a read; 20 reservations per hour.
- In the edge proxy, per `cf-connecting-ip`: `/oauth/*` 60 per minute, registrations 10 per hour,
  `/login` posts 5 per 15 minutes, `/api/*` 120 per minute.
- The per-email sign-in limit lives in `sendSignInLink` (5.4).
- **Web-side tools (revision 6, round-5 Major 23).** `ops.style_format_check(p_ctx)` and
  `ops.transcribe_check(p_ctx)` count calls per user in `public.web_tool_usage` (Europe/Rome day):
  customers get 20 style formats and 10 transcriptions per day; admins are bound only by the
  per-minute rates above; a refusal returns `rate_limited` with `retry_after` set to the seconds
  until the next Rome midnight.

### 6.8 Untrusted content (prompt injection boundary)

Captions, titles, descriptions and transcripts of a source video are untrusted, and so is anything
a model derives from them (the blueprint and the meaning map). Rules:
- stored with `untrusted = true`;
- every derived field reaching a prompt is an enum or a length-limited string with only letters,
  digits, spaces and basic punctuation (the blueprint and meaning-map schemas enforce this, 9.1);
- wrapped and labelled in MCP resources (annotation `untrusted_source`);
- passed to the loop only as quoted data blocks truncated to 2 KB per item;
- never given to an agent that has tools, except image route 2, which runs in a sandbox with no
  tools that matter (11.3);
- the blast radius is bounded by design: no API operation can create tokens, raise caps, change
  policies, disable gates, or publish without the veto window (6.2).

### 6.9 Test runs on the real instance (fake providers)

- A `test_mode` token (a PAT created with "test" ticked, or an OAuth grant whose consent ticked
  "Test (fake providers)") makes every job it causes run on fakes: the wrapper stamps
  `jobs.fake_providers = true` (from the token row) and marks every version it creates
  `versions.test_run = true`. The test rule of 6.3.4 keeps test tokens on test versions and every
  other actor off them, so a test song never gets real spend or a publish.
- Child jobs: the worker enqueues them only through `ops.worker_enqueue(p_parent_job, p_version,
  p_stage, p_idempotency_key)` (service role), which copies `token_id`, `run_id`,
  `fake_providers` and `priority` from the parent and creates the child's reservation (11.5). If
  the child's reservation is refused, `worker_enqueue` raises `MDF02` and the worker fails the
  parent job with error code `cap_exceeded`; the parent's reservation then closes as in 11.5.
  `apps/worker/src/db.ts` `enqueue` (called from `loop.ts:322`) takes the parent job id; `db.ts`
  lines 161 and 680 change with it.
- The worker uses `fakeStages` when the process has `WORKER_FAKE=1` (the existing variable,
  `main.ts:126,150,160`, `workspace.ts:36`; e2e and the gate set it) or the job has
  `fake_providers = true`.
- On a stack whose `public.stack_settings.fake_stack` is on (e2e, CI; 5.3; revision 6),
  `ops.reserve_job` creates no reservation, so e2e jobs never meet caps, unless the transaction set
  `mdf.force_caps = 'on'` (the ledger database tests, 6.3.4).
- `purge_test_runs` trashes test versions after 7 days (14.4).

## 7. Operations layer, HTTP API, CLI and MCP

### 7.1 One implementation

- `apps/web/lib/ops/*`: one module per operation. It validates input with the zod schema, opens
  the idempotency key when the operation needs one (7.2), calls its `ops.*` function over the
  `mdf_web` connection and returns `Result<Output, OpsError>`, then revalidates the paths
  `runAction` revalidates today. Server actions, `/api/v1` handlers and MCP tools all call it.
- Schemas in `packages/shared/src/ops/` (`<Operation>Input`, `<Operation>Output`, `errors.ts`,
  `reads.ts`); `apps/web/app/actions/schemas.ts` re-exports the moved ones. `runAction` maps codes to
  the existing message keys under the `error.` prefix (`packages/shared/src/i18n.ts`, new keys
  `error.forbidden_scope`, `error.cap_exceeded` and so on); `lib/action-result.ts` gains the code.
- **MCP server:** `@modelcontextprotocol/server` (the v2 split SDK already in `pnpm-lock.yaml` at
  2.4.0), with `WebStandardStreamableHTTPServerTransport` in stateless JSON mode
  (`sessionIdGenerator: undefined`, `enableJsonResponse: true`), a new server and transport per
  request inside `app/api/mcp/route.ts` (Node runtime), the default 4 MiB body limit (no uploads in
  M1), GET answering 405. Fallback: the `mcp-handler` adapter over the same registry.
- **CLI** (`packages/cli`): a thin HTTP client of `/api/v1`; `mellodifai mcp` is the stdio
  transport, a bridge that forwards JSON-RPC from stdio to `/api/mcp` with the PAT. Built into one
  file with esbuild and installed with `pnpm --filter @mellodifai/cli pack` then
  `npm install -g <the tarball>` (no `workspace:` dependencies survive the bundle). Credentials in
  `%APPDATA%\mellodifai\credentials.json`, created and then restricted with
  `icacls <file> /inheritance:r /grant:r "%USERNAME%:F"` (or mode 0600 elsewhere). Commands:
  `login`, `songs`, `create`, `status <job> [--watch]` (polls every 3 s), `approve`, `regenerate`,
  `video`, `costs`, `mcp`; `--json` on all. Claude Code: `claude mcp add mellodifai -- mellodifai
  mcp`; Codex: `[mcp_servers.mellodifai] command = "mellodifai" args = ["mcp"]`.
- **Agent skill** (`packages/cli/skill/`, with `AGENTS.md`): the M1 workflows, scopes and caps,
  always sending `idempotency_key` on spend tools, never retrying `ambiguous_spend`.

### 7.2 HTTP and MCP contract (frozen for v1; additive only)

- `/api/v1` accepts only a PAT; `/api/mcp` accepts a PAT or an OAuth access token; neither accepts
  cookies (5.2). Versioning: additive only; a breaking change is `/api/v2`, v1 stays 90 days.
- Success: `{ "data": <Output> }`. Errors: `{ "error": { "code", "message", "details"?,
  "retry_after"? } }` with the codes of 6.3.5. MCP tools return the same `data` as structured
  content, and errors as tool errors carrying the same code.
- **Idempotency.** Required (header `Idempotency-Key`, or MCP input `idempotency_key`, 8-100
  characters) on every operation marked "key" in 7.3; the database refuses a token actor without
  one. Flow: Next calls `ops.idem_begin(p_ctx, key, request_hash)` in its own committed
  transaction, which inserts `in_flight` and returns `new`, or returns `replay` (same hash, `done`,
  with the stored response), `idempotency_mismatch` (different hash) or `in_progress` (same hash,
  `in_flight`, younger than 10 minutes; an older row is taken over as `new`). The wrapper marks the
  key `done` on success and deletes it on failure, in the transaction that commits the result (6.3.4
  step 5). Keys are purged after 24 h.
- Pagination: `?cursor=&limit=` (default 20, max 100). The cursor is the base64 of the last row's
  `(updated_at, id)` for songs and `(created_at, id)` for jobs, sorted descending.

### 7.3 Operations exposed to tokens in M1

Every other existing action (playlists, reactions, rename, trash, restore, play count, section
edits, save edited take, imports, song source, format style, transcribe) also gets its `ops`
wrapper in M1, but only for cookie sessions; their token tools move to M2a.

| Operation, MCP tool | HTTP | Input | Output | Scope | Key | `ops` function -> RPC | Reserves (11.5) |
| --- | --- | --- | --- | --- | --- | --- | --- |
| List songs, `songs_list` | `GET /api/v1/songs` | `cursor`, `limit`, `status` (optional), `include_trashed` (default false) | `{ songs: SongSummary[], next_cursor }` | read | no | `ops.songs_list` | - |
| Get song, `song_get` | `GET /api/v1/songs/{version_id}` | - | `SongDetail` | read | no | `ops.song_get` | - |
| Job status, `job_status` | `GET /api/v1/jobs/{job_id}` | `events_after` (optional event id) | `{ job: JobStatus, events: JobEvent[] }` | read | no | `ops.job_status` | - |
| Costs, `costs_get` | `GET /api/v1/costs` | `from`, `to` (dates, Europe/Rome; default today; at most 31 days) | `CostsSummary` | read | no | `ops.costs_get` | - |
| Create song, `song_create` | `POST /api/v1/songs` | `CreateSongInput` (the existing create panel schema, without upload sources) | `{ project_id, jobs: JobRef[] }` | spend | yes | `ops.song_create` -> `create_song` | `draft_lyrics` per language |
| Approve lyrics, `lyrics_approve` | `POST /api/v1/songs/{version_id}/lyrics/approve` | `{ lyric_pack }` | `{ jobs: JobRef[] }` | spend | yes | -> `approve_lyrics` | `generate_song` |
| Back to lyrics, `lyrics_back` | `POST /api/v1/songs/{version_id}/lyrics/back` | - | `{ version_id, status }` | create | yes | -> `back_to_lyrics` | - |
| Generate again, `song_generate_again` | `POST /api/v1/songs/{version_id}/generate` | `{ generation }` | `{ jobs: JobRef[] }` | spend | yes | -> `generate_again` | `generate_song` |
| Pick take, `take_pick` | `POST /api/v1/songs/{version_id}/takes/{take_id}/pick` | - | `{ jobs: JobRef[] }` | create | yes | -> `pick_take` | `timing` (incidental Groq) |
| Make video, `video_make` | `POST /api/v1/songs/{version_id}/video` | - | `{ jobs: JobRef[] }` | create | yes | -> `make_video` | incidental Groq if `timing` is queued |
| Render again, `video_rerender` | `POST /api/v1/songs/{version_id}/video/rerender` | - | `{ jobs: JobRef[] }` | create | yes | -> `render_again` | as make video |
| Approve video, `video_approve` | `POST /api/v1/songs/{version_id}/video/approve` | - | `{ version_id, status }` | create | yes | -> `approve_video` (no override) | - |
| Retry stage, `stage_retry` | `POST /api/v1/jobs/{job_id}/retry` | - | `{ jobs: JobRef[] }` | create; spend for a paid stage | yes | -> `retry_stage` (not `publish`, `set_privacy`) | that stage's rule |
| Cancel job, `job_cancel` | `POST /api/v1/jobs/{job_id}/cancel` | - | `{ job: JobStatus }` | create | yes | `ops.job_cancel` | closes the job's reservation |
| Stems, `stems_request` | `POST /api/v1/songs/{version_id}/stems` | - | `{ jobs: JobRef[] }` | create | yes | -> `request_stems` | - |
| Visualizer, `visualizer_request` | `POST /api/v1/songs/{version_id}/visualizer` | `VisualizerInput` (existing schema) | `{ jobs: JobRef[] }` | create | yes | -> `request_visualizer` | - |

`JobRef` is `{ job_id, version_id, stage }`. Mutating rows are the ones with "yes" under Key; the
rest are reads for the rate limits. MCP resources in M1: `mellodifai://songs/{version_id}` (a
`SongDetail`); MCP prompt: `new_song`. Later tools (sections 8, 9, 12, 13) keep the names given
there and get rows when their milestone is planned.

**Read shapes and their sources** (`packages/shared/src/ops/reads.ts`; trashed versions excluded
unless asked; every field comes from the actor's own rows):

| Shape, field | Source |
| --- | --- |
| `SongSummary.version_id`, `project_id`, `lang`, `status`, `created_at`, `updated_at`, `test_run` | `versions` columns |
| `SongSummary.title` | `coalesce(versions.display_title, versions.lyric_pack->>'title', projects.topic)` |
| `SongSummary.take_count` | count of `takes` of the version with `generation = versions.generation_count` |
| `SongSummary.has_chosen_take`, `trashed` | `versions.chosen_take_id is not null`, `versions.trashed_at is not null` |
| `SongDetail` | `SongSummary` plus `lyrics` (`versions.lyric_pack`), `takes[]` (`id`, `generation`, `take_number`, `engine`, `chosen` = id equals `chosen_take_id`), `renders[]` (`id`, `kind`, `render_attempt`, `approved` = `approved_at is not null`, `qa_passed` = every `qa_results.gates[].pass` true), `active_jobs[]` (`JobStatus` of jobs `queued` or `running`), `lyric_jury` (`versions.lyric_jury` -> `available`, `passed`, `scores`, or null), `cost_usd` (sum of settled entries of the version's reservations) |
| `JobStatus` | `jobs.id`, `version_id`, `stage`, `status`, `attempts`, `created_at`, `started_at`, `finished_at`; `progress` = the latest `job_events.progress` divided by 100, or null; `error` = `jobs.error` redacted and cut to 300 characters, or null |
| `JobEvent` | `job_events.id`, `at`, `level`, `message` (cut to 300 characters), `progress` (0-100 as stored) |
| `CostsSummary` | `from`, `to` (the inputs); `by_provider[]` from settled spend entries in the window (`provider`, `usd`, `units` per unit); `caps[]` from the actor's matching `spend_caps` rows with today's `spend_counters.used` (`scope`, `provider`, `unit`, `period`, `limit`, `used`) |

### 7.3b Remake operations exposed to tokens

"Rifai da YouTube" (the task 27 engine, section 8) is driven by an agent through the same registry:
the HTTP routes, the MCP tools and the CLI come from one definition per operation. The wrappers and
the two reads are in migration `20261103075001_ops_remake_tokens.sql`. M2a replaces the engine
behind these names; the names, paths and inputs stay.

| Operation, MCP tool | HTTP | Input | Output | Scope | Key | `ops` function |
| --- | --- | --- | --- | --- | --- | --- |
| List remakes, `remakes_list` | `GET /api/v1/remakes` | `limit` (1-100, default 20) | `{ remakes: [{ remake_id, project_id, version_id, stage, lang, title, error_code, created_at, updated_at }] }`, newest first, without dismissed remakes and trashed songs | read | no | `ops.remakes_list` |
| Get remake, `remake_get` | `GET /api/v1/remakes/{remake_id}` | - | `RemakeDetail` (below) | read | no | `ops.remake_get` |
| Start remake, `remake_start` | `POST /api/v1/remakes` | `{ url, lang, country? }` | `{ id, jobs: JobRef[] }` | spend | yes | `ops.remake_start` |
| Edit lyrics, `remake_edit` | `POST /api/v1/remakes/{remake_id}/lyrics` | `{ revision, lines: [{ index, text }], title? }` | `{ revision, jobs: JobRef[] }` | spend | yes | `ops.remake_edit` |
| Regenerate section, `remake_regenerate_section` | `POST /api/v1/remakes/{remake_id}/sections/{section_id}/regenerate` | `{ revision }` | `{ jobs: JobRef[] }` | spend | yes | `ops.remake_regenerate_section` |
| Accept, `remake_accept` | `POST /api/v1/remakes/{remake_id}/accept` | `{ revision, lyrics_text, title, style, vocal_gender?, settings? }` | `{ id, jobs: JobRef[] }` (`id` is the song's `version_id`) | spend | yes | `ops.remake_accept` |
| Retry, `remake_retry` | `POST /api/v1/remakes/{remake_id}/retry` | - | `{ jobs: JobRef[] }` | spend | yes | `ops.remake_retry` |
| Cancel, `remake_cancel` | `POST /api/v1/remakes/{remake_id}/cancel` | - | `{ jobs: [] }` | create | yes | `ops.remake_cancel` |
| Dismiss, `remake_dismiss` | `POST /api/v1/remakes/{remake_id}/dismiss` | - | `{ jobs: [] }` | create | yes | `ops.remake_dismiss` |

`RemakeDetail`: `remake_id`, `project_id`, `version_id`, `stage` (`ingest`, `analyse`, `rewrite`,
`review`, `accepted`, `failed`, `cancelled`), `lang`, `country`, `video_id`, `url`, `error_code`
(one of the remake error codes; there is no error text), `revision`, `pending` (an edit waits for
its check),
`gate_ok` (the originality gate of 10.3 on the stored lyrics), `accept_ready` (stage `review`, not
pending, no queued or running job, `gate_ok`, and the song still in the library), `analysis` (the
stored summary), `lyrics` (the stored rewrite as rule 5 allows it), `lyrics_text` (the text the song
is generated from), `cost`, `active_job` (`job_id`, `stage`, `status`, `mode`, `progress` 0-100) or
null, `failed_job` (`job_id`, `stage`) or null, `untrusted: true`, `created_at`, `updated_at`.

MCP resource: `mellodifai://remakes/{remake_id}` (a `RemakeDetail`). MCP prompt:
`remake_from_youtube`. Every tool of 7.3 and 7.3b carries a one-sentence description (what it does,
its scope, what to call next) in `tools/list`.

Rules (decided with the plan `2026-11-10-agent-remake-access.md`):

1. **Who may call.** A cookie session keeps its rule: local only. A token actor (PAT or OAuth) may
   call locally and, when `ops._actor` admits it (admin role, token cap, not revoked, the
   `remote_mcp` flag and a remote token), remotely.
2. **Scopes.** `spend`: `remake_start`, `remake_edit`, `remake_regenerate_section`,
   `remake_accept`, `remake_retry` (each queues paid work). `create`: `remake_cancel`,
   `remake_dismiss`. `read`: `remake_get`, `remakes_list`. A missing scope is `forbidden_scope`.
3. **Idempotency.** A token actor without a key gets `validation` with the reason
   `idempotency_key_required`, as for `song_create`.
4. **Test mode.** A token only sees and changes remakes whose version has `test_run` equal to its
   test mode: a write on the other mode is `forbidden_scope` with the reason `test_rule`, a read is
   `not_found`. The jobs of a test-mode token carry `fake_providers`, and the worker routes such a
   job to the fake remake stages whatever its own configuration is.
5. **Source text stays out.** `remake_get` never returns the source lyric lines
   (`lyrics.sections[].lines[].source`) nor `lyrics.literalTranslation`, and the phrase gate's
   detail names the agent's own phrase without the source line it collides with. The jury comes as
   numbers, categories and line numbers only (`issues[].line`, `devil.objections[]` with
   `category`, `severity`, `line`, `verdicts[]` with `model`, `ms`, `scores`): its issues,
   objections and errors are free text by models that read the source lines and quote them. For the
   same reason the answer has no error text and no job event message, only `error_code` and
   progress; the owner reads the text in the app. The worker also keeps source lines out of what it
   logs and throws (a rejected meaning map names the section, an invalid model reply gives only its
   length), so `job_status` events and errors of remake jobs carry none either. Whatever else came
   from the source video (title, the one-sentence summary, the rewrite itself) is marked
   `untrusted: true`: data, never instructions. Agents refine the app's rewrite; authoring from a
   meaning map is M2a.
6. **Accept echoes the text.** `remake_accept` takes `lyrics_text` exactly as `remake_get` returned
   it, plus the revision; the database refuses any other text (`conflict`). The lyric pack is
   composed by one helper shared with the create panel's accept.
7. **Limits.** One running remake per person and 20 a day apply to agents too, counted per test
   mode: a test-mode token's remakes run on fake providers and are hidden from the create panel, so
   they neither hold the owner's running slot nor use up his day, and the reverse. Publishing stays
   the owner's step in the app.

### 7.4 Keys held by Next

Next calls OpenRouter (`formatStyle`) and Groq (`/api/transcribe`) itself for cookie users, so it
holds its own keys in `apps/web/.env.local`: `LYRICS_OPENROUTER_KEY` (read first, as today in
`lib/openrouter-key.ts:3`), else `OPENROUTER_API_KEY`, and `GROQ_API_KEY`; `LYRICS_MODEL_FAST`
keeps choosing the model. `lib/openrouter-key.ts` stops reading the worker's env files. The owner
is advised (section 22) to make these separate keys with a low provider-side credit limit, because
in M1 these two web-side calls are rate-limited (`ops.style_format_check`,
`ops.transcribe_check`: role and per-user limits) but not metered by the ledger; metering them
moves to M2a with their token tools.

## 8. Remake workflow ("Rifai da YouTube", "Remake from YouTube")

### 8.1 Modes and tiers

- **Mode** (who approves): **Copilot** pauses at the pause points (8.5); **Autopilot** approves
  automatically through the Autopilot actor (6.5) and stops only for the reasons in 8.6. Autopilot
  arrives in M5.
- **Tier** (what may cost money), defined only here:

| Tier | Generation routes | Juries and app reasoning | Cost rule | Autopilot |
| --- | --- | --- | --- | --- |
| free | ACE-Step local music, GPT Image via codex, local images; reasoning by the driving agent's subscription or the app's fast writer | app juries on OpenRouter (juries are the quality guarantee and are never skipped) | at most 0.03 USD per run, all of it juries and app reasoning | yes |
| standard (default) | kie Suno, OD5 image routes 1-4, cheap OpenRouter models | app juries | per-run hard cap 0.25 USD, median target 0.15 USD | yes |
| premium | standard plus Higgsfield shots and Comfy Cloud workflows | app juries | per-run budget set at start; cost shown before confirm in Copilot | only with a premium budget above 0 in the policy row |

Within a tier the image routes keep the OD5 order; the tier only removes routes (free skips
routes 1, 3 and 4).

### 8.2 Who reasons and who pays

| Driver | Mode | Lyrics (R3) and timeline (R5) | Juries | Paid by |
| --- | --- | --- | --- | --- |
| Person in the UI | Copilot | app's internal writers (existing pipeline) | app | owner's OpenRouter key, ledger |
| Agent holding the driver lease | Copilot or Autopilot | the agent writes and submits artefacts, or asks the app to write | app (always) | agent's own subscription for authoring; owner's key for juries |
| Nobody (lease absent or expired) | Autopilot | app's internal writers | app | owner's key |

An agent can never submit jury scores. The driver lease (`remakes.driver`, `driver_lease_until`)
lasts 15 minutes and renews on every call by its holder. When it expires: in Autopilot the app's
writer takes over at the next stage boundary; in Copilot the run waits at the pause point and a
notification goes out.

### 8.3 Run creation, orchestration and job mapping

`remake_start` creates the project and one version per target language (status `analysing`, a new
`versions.status` value), a `remakes` row and the `stage_runs` rows. Runtime files go under the
existing per-version workspace root (`apps/worker/src/workspace.ts`), with the shared analysis in
`<workspace root>/remakes/<remake id>/`. R1 and R2 run on the primary version (so `jobs.version_id`
stays NOT NULL); the other versions start at R3 when the analysis is ready.

**Stage orchestrator** (`apps/worker/src/orchestrator.ts`, M2a): when a job of a remake finishes,
the worker calls it in the same transaction that marks the job done. It updates the job's stage
run (`jobs.stage_run_id`); when every job of that stage run has succeeded and its gates pass, it
moves the stage run to `passed` or `awaiting_approval` (8.5) and enqueues the first job of the next
stage run. Approvals arrive through `ops.remake_stage_action`, which moves the stage run and
enqueues the next stage the same way. One stage run can own several jobs (R7 owns four, R9 three).

| R-stage | Jobs | New or existing | Resource class |
| --- | --- | --- | --- |
| R1 ingest | `remake_ingest` | new | net |
| R2 analyse | `remake_separate` (Demucs on the source), then `remake_analyse` (beats, sections, transcript, meaning map, blueprint, fingerprints) | new | gpu, then net |
| R3 rewrite lyrics | `draft_lyrics` with a remake mode | existing, extended | net |
| R4 music | `generate_song` (which already calls `score_takes`) | existing | net |
| R4b timing of the new take | `timing`, plus section detection | existing, extended | cpu |
| R5 composition | `compose_timeline` | new | net |
| R6 images | `images` | new | net or gpu |
| R7 render | `render_master`, `render_hook`, `art`, `qa` (extended to the hook render) | existing, extended | gpu (renders), cpu |
| R8 visual jury | `visual_jury` | new | net, cpu |
| R9 publish | `schedule_publish`, `publish`, `set_privacy` | new plus existing | net |

Each new stage gets the check-list migration, `STAGES` and `STAGE_STATUS` entries, a
`stageAllowed` rule, registration in `stages/index.ts` and a `resource_class`. `art` stops setting
`video_review` for remakes; `visual_jury` sets it.

### 8.4 Stages

#### R1 Ingest

Downloads audio, a low-resolution video for frames, captions and metadata of the named source to
the remake folder. Analysis only (AC10). Transcript from captions, else Whisper through Groq, with
word timestamps. Frames at scene cuts (at most 48). Contact sheets: 4x4 tiles of 256 px frames at
1 fps. Timeout 10 minutes.

#### R2 Analyse

- `remake_separate`: Demucs on the source (vocals for word timing).
- Music: BPM, key, time signature, sections with timestamps and labels, downbeats, vocal type,
  instrumentation, energy curve, from the beat and section analyser (24).
- Lyrics: the transcript with word timestamps, a literal translation of each source line into each
  target language (one call to `google/gemini-3.8-flash` through OpenRouter, instructed to
  translate word for word), and the meaning map (schema in 9.1), written as abstract descriptions,
  never as quoted lines.
- Video: the **video blueprint** (9.1) from at most 12 contact sheets by `google/gemini-3.8-flash`
  through OpenRouter, validated against the schema; an agent holding the lease may submit it
  instead.
- Fingerprints for the visual originality check (10.3), computed before deletion: pHash and DINOv2
  embedding of one source frame per blueprint shot at its section-relative position, stored in
  `fingerprints` with `subject_kind = 'source'`.
- Kept after R2: analysis JSON, transcript with word timestamps, literal translations, meaning
  map, blueprint, fingerprints, low-resolution contact sheets. Deleted: the source audio, video,
  frames and stems (14.3).

#### R3 Rewrite lyrics

Per section, new lines in the target language that carry the meaning map. Default target when the
source is already Italian: Italian (a same-language rewrite in new words). Syllable fit: source
syllables per line come from the kept word timestamps; the new line's count comes from pyphen
(used under its MPL licence) plus language rules for Latin-script languages, morae from
`fugashi` with `unidic-lite` for Japanese, and one syllable per Han character for Chinese; it must
be within plus or minus 1 of the source line. Stress is left to the jury. Then the originality gate
(10.3) and the lyric jury with the devil's advocate (10.2). Up to 3 rounds; failing lines are
rewritten, passing lines kept. Optional cultural adaptation arrives with T17 (M4).

#### R4 Music

A new song from text only; the source audio is never given to a generator (cover and reference
stay only for the owner's own or CC BY/BY-SA songs, T12, T17). Parameter mapping:
- **kie Suno** (custom mode, standard tier): the style string is built from R2 (genre and mood
  tags from instrumentation and energy, `"<bpm> bpm"`, vocal type; no artist names); the lyrics
  carry section tags (`[Verse]`, `[Chorus]`, ...) in the blueprint's order. kie takes no duration
  or BPM parameter, so timing is checked after generation.
- **ACE-Step 1.5** (free tier): BPM, key, duration and the section-tagged lyrics are passed
  directly, so it follows the timing more closely.

Acceptance per take: lyric recall (the existing `score_takes` `fidelity`, in-order token recall) at
least **0.75**; the AC11 timing rule (tempo measured by the analyser on the take, section durations
from R4b's section detection); then the QA loudness and peak gates. A take that misses AC11 counts
as a failed round. Up to 2 generations in the standard tier. The kie never-resend rule holds
(8.6).

#### R4b Timing of the new take

The existing `timing` stage computes word timing on the chosen take; section detection maps the
take's sections to the blueprint's section ids. Kinetic lyrics and shot timing use the new take's
timing.

#### R5 Composition

Writes the **timeline document** (9.2) from the blueprint retimed to the new take: each shot keeps
its section id and its relative position, so the same shot rhythm lands on the new song. Built only
from the v1 blocks (9.3) and generated images (R6). Author: the lease-holding agent, or the app's
internal writer, a deterministic mapper from blueprint layout and motion tags to blocks plus one
call to the fast writer (Sonnet 5.5 through OpenRouter, at most 0.005 USD) that fills only block
parameters within the schema.

#### R6 Images

Prompts per shot whose blueprint `imageNeed` is not `none`, assembled from enums and
length-limited fields of the blueprint and meaning map (6.8), never from source frames. Routed by
11.3; at most 8 generated images per video in the standard tier; 3 thumbnail candidates.

#### R7 Render

Local Remotion 16:9 master at 1080p (4K on request), 9:16 Short from the hook section, at most 3
minutes, full-frame layout; 3 thumbnail candidates; captions (SRT per language from word timing);
then QA on the master **and** the hook render. Rendering reuses `render.ts` and the
`visualizer.ts` path with `packages/visualizer/scripts/render.mjs`, pointed at `TimelineVideo`.
Hook section: the R2 section labelled `hook` or `chorus` with the highest energy; else the energy
peak; else the meaning map's hook idea.

#### R8 Visual jury

Section 10.4, plus visual originality (10.3) and distinctness (10.6). Fix and re-render until
pass, up to 3 rounds.

#### R9 Publish

Section 12. In Copilot the person or agent approves the publish kit; in Autopilot
`autopilot_schedule_publish` does. Either way the bundle enters the veto window (OD3).

#### The Console

The song page shows every stage with inputs, outputs, jury scores, devil's advocate notes, cost so
far and the stop reason, with buttons to approve, edit, regenerate or skip; agents get the same
through `remake_status` and the remake resource.

### 8.5 Stage state machine and pause points

States of a `stage_runs` row: `pending`, `running`, `awaiting_approval`, `passed`, `failed_jury`,
`capped`, `skipped`, `cancelled`, `error`.

- `pending -> running` when its first job is claimed; `running -> passed` when its jobs succeeded,
  its gates pass and the mode is Autopilot or the stage has no pause point; `running ->
  awaiting_approval` at a pause point in Copilot; `awaiting_approval -> passed` on approve;
  `running -> failed_jury` after the round cap; `running -> capped` when a reservation is refused;
  `running -> error` after the retry budget; any non-final state `-> cancelled` on cancel.
- **Approve** marks the stage passed and enqueues the next one. **Edit** stores the person's or
  agent's artefact as a new revision and re-runs that stage's gates (not its generator).
  **Regenerate** starts a new round (counts toward the round cap, reserves spend). **Skip** is
  allowed only for R6 (the block's own art is used) and the optional T17 adaptation; **R3's
  originality gate, R8 and the publish gate can never be skipped**.
- Every approve, edit, regenerate or skip carries `expected_stage_version`; a mismatch returns
  `conflict`, so a person and an agent approving at once cannot both win.
- Default Copilot pause points: after R3 (`lyrics_review`), after R4 (`takes_review`), after R8
  (`video_review`), and before R9 (publish kit). Existing version-status checkpoints and
  `job_events.progress` are reused.
- A mode change applies at the next stage boundary; switching to Autopilot needs the actor rule of
  6.2, the policy row and every earlier gate passed.
- Resume after a worker restart uses the existing 15 s job heartbeat and `requeue_stale`.

### 8.6 Stop reasons, errors, retries and round caps

The one Autopilot stop list (also the values of `stop_reason`): `passed`, `round_cap`,
`jury_unavailable` (fail-closed, 10.1), `cost_cap`, `provider_exhausted` (every allowed route
failed or is exhausted), `ambiguous_spend`, `owner_cancelled` (including a veto), `error`. The veto
window is not a stop: R9 waits in it by design.

- Round caps: R3 3 rounds, R4 2 generations, R8 3 rounds, thumbnails 2 rounds.
- Transient errors (network, 5xx, 429, timeouts): 3 attempts with backoff of 30 s, 2 min and 10
  min; they do not count as rounds. **Exception: a kie submit that times out or has an unknown
  outcome is `ambiguous_spend` and is never retried**; the run stops until
  `resolve_kie_submission`. Permanent errors (validation, refusal, content policy, 4xx): no retry;
  image routes fall through, other stages stop with `error`.
- Timeouts that trigger the fallthrough: OpenRouter text 90 s, vision 120 s; kie submit 30 s,
  then poll up to 10 minutes; Midjourney through kie 5 minutes; `codex exec` image 4 minutes; Nano
  Banana 90 s; OpenRouter image 120 s; local image 3 minutes; yt-dlp 10 minutes; Remotion master 45
  minutes.

### 8.7 Remake defaults (M2a)

Table `remake_defaults` per user (M2a, migration `remakes`); Settings > Remake edits it; the CLI
and `remake_start` override any field per call: target languages (default: Italian), vocal gender
and style (default from R2), engine (kie Suno), tier (standard), preset and brand (T15 brand kit
when it exists, else MellodifAI Classico), platforms (default the owner's YouTube channel only;
customers have no publish scope, so their remakes stop before R9), slot policy (12.2).

## 9. Blueprint, meaning map and timeline document

### 9.1 Blueprint and meaning map schemas v1

Location: `packages/shared/src/remake/` (one package for all remake schemas; the task-24 brief's
`packages/remake` was never created). For remakes the blueprint replaces `storyboard.json`;
`storyboard.json` stays for the VBP style. Every string a model fills is an enum or a short string
of letters, digits, spaces and basic punctuation (`Safe(n)` below: at most n characters, regex
`^[\p{L}\p{N} .,'!?-]*$`).

```ts
const Hex = z.string().regex(/^#[0-9a-f]{6}$/i);
const Safe = (n: number) => z.string().max(n).regex(/^[\p{L}\p{N} .,'!?-]*$/u);
const Key = z.enum([/* 24 keys: "C", "Cm", "C#", "C#m", ... "B", "Bm" */]);

const Blueprint = z.object({
  schemaVersion: z.literal(1),
  source: z.object({ videoId: z.string().regex(/^[\w-]{11}$/), durationS: z.number().positive() }),
  music: z.object({
    bpm: z.number().min(40).max(220), key: Key,
    timeSig: z.enum(["2/4", "3/4", "4/4", "6/8", "12/8"]),
    sections: z.array(z.object({
      id: z.string().regex(/^s\d{1,2}$/),
      label: z.enum(["intro", "verse", "pre", "chorus", "hook", "bridge", "outro", "other"]),
      startS: z.number().min(0), endS: z.number(), energy: z.number().min(0).max(1),
    }).refine((s) => s.endS > s.startS)).min(1).max(40),
    downbeatsS: z.array(z.number()).max(2000),
    vocal: z.enum(["male", "female", "duet", "choir", "none"]),
    instrumentation: z.array(z.enum([/* fixed list of about 40 instrument tags */])).max(12),
  }),
  shots: z.array(z.object({
    id: z.string().regex(/^h\d{1,3}$/), sectionId: z.string(),
    startS: z.number().min(0), endS: z.number(), offsetInSection: z.number().min(0).max(1),
    layout: z.enum(["full_bleed", "centered_title", "lower_third", "split", "grid", "visualizer_center", "text_only"]),
    typographyRoles: z.array(z.object({
      role: z.enum(["title", "lyric", "caption", "credit"]),
      weight: z.enum(["light", "regular", "bold", "black"]),
      case: z.enum(["upper", "title", "sentence"]),
      position: z.enum(["top", "center", "bottom", "left", "right"]),
    })).max(4),
    palette: z.array(Hex).max(6),
    motion: z.object({
      camera: z.enum(["static", "push_in", "pull_out", "pan", "shake"]), cutOnBeat: z.boolean(),
      kineticText: z.enum(["none", "word_pop", "line_slide", "typewriter", "scale_pulse"]),
      visualizer: z.enum([/* the look ids of packages/shared/src/visualizer/viz-looks.ts */]).nullable(),
    }),
    transition: z.enum(["cut", "crossfade", "whip", "zoom", "glitch"]),
    overlays: z.array(z.object({
      kind: z.enum(["lyric", "title", "logo_slot", "shape"]),
      position: z.enum(["top", "center", "bottom", "left", "right"]),
    })).max(6),
    imageNeed: z.enum(["none", "background", "subject"]),
  }).refine((s) => s.endS > s.startS)).max(200),
  global: z.object({
    palette: z.array(Hex).max(8), aspect: z.enum(["16:9", "9:16"]),
    typeScale: z.object({ basePx: z.number().min(16).max(96), ratio: z.number().min(1.1).max(1.8) }),
  }),
}).superRefine(/* every shot.sectionId exists in music.sections; shots sorted and inside durationS */);

const MeaningMap = z.object({
  schemaVersion: z.literal(1),
  sections: z.array(z.object({
    sectionId: z.string(), theme: Safe(120), storyBeat: Safe(120),
    imagery: z.array(Safe(40)).max(5),
    emotion: z.enum(["joy", "longing", "anger", "calm", "pride", "sadness", "hope", "irony", "love", "fear"]),
    hookIdea: Safe(120),
  })),
});
```

The blueprint records style descriptors only: no source text, no source frames, no font or brand
names of the source.

### 9.2 Timeline document (OD6, AC3)

Location: `packages/shared/src/timeline/`. One generic Remotion composition `TimelineVideo` in
`packages/visualizer` draws it; the web editor (M3), agents (`timeline_patch`) and R5 edit the same
document. Revisions are append-only (`timelines` table), each with its author.

- Fields: `schemaVersion`, `fps` (30), `size`, `durationFrames`, `audio.takeId`, `palette`,
  `typeScale`, `scenes[]` (id, start and end frame, section id, `block` and its `params` from 9.3,
  `effects[]`, `transitionIn`, `transitionOut`), `assets[]` (id, kind, `ref`).
- Data only: no code, no imports, no HTML, no CSS strings, no URLs. `ref` points only into the
  app's storage buckets or the generated-images store. Fonts come from a whitelist. Text fields
  have length limits.
- Limits: at most 200 scenes, 50 assets, 10 minutes.
- Validated at the ops layer and again in the worker before every render. Only the app's own
  components render it.

### 9.3 Timeline blocks v1 (`packages/shared/src/timeline/blocks.ts`, created first in M2b)

| Block | Params (all bounded) |
| --- | --- |
| `visualizer` | `look` (enum of `viz-looks.ts` ids), `primary`, `secondary` (hex), `particles` 0-1, `intensity` 0-1, `background` (asset ref or null), `centreImage` (asset ref or null) |
| `kinetic_lyrics` | `style` (`word_pop`, `line_slide`, `typewriter`, `scale_pulse`, `karaoke_fill`), `font` (whitelist), `position` (enum), `maxLines` 1-3, `case` (enum) |
| `image_motion` | `asset` (image ref), `camera` (enum), `fromScale`, `toScale` 1-1.3, `focusX`, `focusY` 0-1 |
| `title_card` | `text` (at most 60 characters), `subtitle` (at most 80), `font`, `align` (enum) |
| `split` | `left` (an `image_motion` or `visualizer` params object), `right` (a `kinetic_lyrics` params object), `ratio` 0.3-0.7 |
| `color_field` | `from`, `to` (hex), `angle` 0-360, `grain` 0-1 |
| `video_clip` (premium) | `asset` (video ref), `trimStartS`, `playbackRate` 0.5-2, `mute` true |

Scene `effects[]`: `grain`, `vhs`, `scanlines`, `vignette`, `aberration`, `glitch`, each with
`intensity` 0-1. Adding a block is an ordinary reviewed change (and a denylisted path for the loop,
13.3).

**Kinetic lyric components move (M2b).** From the engine repo's `motion/src`: `LyricText.tsx`,
`WordPop.tsx`, `FontGate.tsx`, `components/layers/` and `scenes/Kinetic.tsx` move into
`packages/visualizer` as the implementation of `kinetic_lyrics`; the VBP scenes stay in the
engine repo as the VBP style. `ENGINE_ROOT` becomes the config value `MELLODIFAI_ENGINE_ROOT`.

### 9.4 Agent-supplied files

Images submitted through `artefact_submit` or uploads: type sniffed (PNG, JPEG, WebP only), at most
20 MB and 8192 px per side, decoded and re-encoded by the server (which strips metadata and
polyglot payloads), then stored. Anything else is rejected.

## 10. Quality system

### 10.1 Jury rules for every jury

- Gate implementations, thresholds, judge model ids and judge prompts live in
  **`packages/gates/**`** and **`config/gates/**`** (created in M2a, moved from M1 in revision 5, by moving `PASS_SCORE`,
  `combine()`, `CRITERIA` and the judge prompts out of `lyric-jury.ts`, and the QA thresholds out of
  `qa.ts:90`; every later gate is written there from the start). Stage code imports them. These
  paths are on the loop's denylist (13.3).
- Aggregation: per criterion, the mean across valid judges for text juries (as today) and the
  median for vision juries; a jury passes when every criterion reaches its threshold and no
  must-fix item is open.
- **Availability:** the existing lyric jury stays fail-open in the human-approved Copilot flow,
  and the Console shows "jury unavailable" when it happens. In Autopilot, and for every new jury,
  "jury unavailable" is a failure: the run stops with `jury_unavailable`.
- Judge model ids are pinned in `config/gates/` and recorded in every `jury_reports` row with the
  rubric version.
- **Storage:** new juries write `jury_reports` rows. The lyric jury dual-writes from M2a: it keeps
  writing `versions.lyric_jury` (the UI reads it) and also writes a `jury_reports` row; M3 moves
  `clips.ts` to `jury_reports`; the column is dropped by a human-written migration after that.

### 10.2 Lyrics jury (existing, extended)

Today: five criteria, threshold 0.7, judges Jev, Haiku 5.5, Gemini 3.8 Flash. Extended in M2a with
`meaning_fidelity` (against the meaning map), `timing_fit` (the R3 syllable report attached) and
`youtube_safety`, and a **devil's advocate** (new work): one model (Claude Sonnet 5.5 through
OpenRouter) prompted to argue that the draft must not pass, returning objections tagged `must_fix`
or `note`. A `must_fix` objection in the categories originality, safety or wrong language blocks
the pass and triggers the next round; other objections are notes in the Console. It has no score
vote.

### 10.3 Originality (the copyright safety line, owned by this document)

The values below are **binding** from M2a. Calibration on the golden set (M3) may only tighten
them automatically; loosening any value is an owner decision. The loop can never change them
(13.3). Runtimes: Python in the worker (`apps/worker/py/`, pinned requirements, CPU), called like
the existing Python tools.

Lyrics, per new line against each source line and against its literal translation (R2):
- lexical: character 4-gram Jaccard and ROUGE-L; either above **0.35** fails the line;
- semantic: cosine with **LaBSE** (`sentence-transformers`, Apache 2.0); above **0.80** fails;
- exact phrase: the new title and hook contain no sequence of 3 or more words (normalised) from the
  source title or hook or their translation.

Meaning fidelity is measured at a different level, which resolves the tension with originality:
each new **section** must reach LaBSE cosine **0.55** or more against its meaning-map section
(theme, story beat, imagery and hook idea joined), not against source lines.

Visuals, comparing the new render's frame at each shot's section-relative position with the
source fingerprint for that shot (R2):
- pHash (`imagehash`) Hamming distance of at least **12 of 64 bits**;
- DINOv2 (ViT-S/14, Apache 2.0, torch on CPU) cosine at most **0.85**.

Allowed to match by design: shot timing and cut points, the layout grid, palette family (not exact
colours), the motion vocabulary.

### 10.4 Visual jury (M3)

- Input, kept small for cost: two frame grids (each 3x4 frames at 1536 px on the long side: one
  frame at the middle of each shot, then chorus downbeat peaks, at most 24 frames), the existing
  contact sheet, and one grid of the thumbnail candidates rendered at 320x180 (phone size). Four
  images per judge per round.
- Judges: `google/gemini-3.8-flash` alone in rounds 1 and 2; `google/gemini-3.8-flash` plus
  `anthropic/claude-haiku-5.5` in the final round (ids pinned in `config/gates/`).
- Rubric v1 (0 to 1, pass at 0.7 each): hierarchy and focal point, type legibility, colour
  harmony, motion rhythm against beats, consistency across shots, brand fit (T15 when it exists),
  absence of AI artefacts.
- Computed in code, not judged: text contrast at least 4.5:1 (3:1 for text 48 px or larger), safe
  areas (16:9: text inside the 90% title-safe box; Shorts: nothing important in the bottom 20% or
  right 12%), minimum type size, minimum on-screen time per lyric line (its sung duration plus 0.2 s
  lead), beat-quantised cuts (within 1 frame of a downbeat when `cutOnBeat`).
- Must-fix: misspelt or garbled text (OCR with **Tesseract 5**, Apache 2.0, with the `jpn` and
  `chi_sim` data, compared with the intended text), AI artefacts flagged by both final-round
  judges, any safe-area or contrast failure.

### 10.5 Music checks

Per take (R4): lyric recall, the AC11 timing rule, QA loudness and peak. A model listening jury is
not added; it can be a later loop hypothesis.

### 10.6 Distinctness (no mass-produced sameness)

The new video's grid embeddings (DINOv2) against each of the last 20 published videos: the
**maximum** cosine at most **0.95** (no near-copy of any one video) and the mean at most **0.92**;
the same timeline look used in at most 2 of the last 5 published videos.

### 10.7 Design rules in code

The motion rules are copied into the repo as `docs/design/motion-rules.md` in M3 (adapted from the
owner's deck playbook `C:\Users\Asus\Documents\Claude\Projects\ita\DESIGN-MOTION.md`): animated
numbers are slot-locked (fixed-width digits that never shift the layout), decorative loops close
seamlessly, every element is legible at rest, easing comes from a small fixed set, layouts keep
fixed safe margins. Video additions: the timeline's `typeScale` and the code checks of 10.4.

### 10.8 The publish gate in the database (M3)

Column `versions.content_kind` (`remake`, `idea`, `import`, `lyric_video`, `visualizer`), set by
the RPC that creates the version. Function `publish_gate_status(p_render uuid)` returns the missing
or failed reports; `approve_video` (for the version's master), `enqueue_publish(render_id)` and
`schedule_publish` refuse when it is not empty. Required reports, each `available` and `passed`:

| Content kind | Required |
| --- | --- |
| `remake` | QA, lyric jury, lyric originality, visual jury, visual originality, distinctness, thumbnail |
| `idea` | QA, lyric jury, visual jury, distinctness, thumbnail |
| `import` (the owner's own song), `lyric_video`, `visualizer` | QA, visual jury, distinctness, thumbnail |

A person in Copilot may still approve with an override reason (cookie-only, recorded and shown);
Autopilot has no override.

## 11. Providers, routing and cost

### 11.1 Reasoning

When an agent drives, it reasons on its own subscription (8.2). The app's own reasoning uses
OpenRouter: Jev for tone and writer choice, Opus and Sonnet writers, the judges above. A direct
Anthropic API client is listed under Later (21.1).

### 11.2 Music

kie Suno in the standard tier (about 12 credits per generate call, two takes); ACE-Step 1.5 local
in the free tier; YuE2 owner-only; Mureka or ElevenLabs Music later (T20 area).

### 11.3 Images (OD5)

Each route falls through to the next on refusal, timeout, usage limit, error, or when the
per-video image allocation (11.6) is spent:

1. **Midjourney through kie.ai** (unofficial; owner accepted). One call returns a 4-image grid.
   Off until the owner confirms kie Midjourney access and price (22). "Importa da Midjourney"
   ("Import from Midjourney": drop or paste his own MJ images) stays for hand-made picks.
2. **GPT Image through `codex exec`, sandboxed.** The worker never runs codex on the host for
   images. It runs it in the container `mdf-img` (pinned image with the codex CLI): its own
   `CODEX_HOME` volume holding only the codex login for the owner's ChatGPT plan (one-time device
   login, owner action), no other mounts except an empty per-job output folder, no env files, no
   network except the OpenAI and ChatGPT API hosts through an allowlisting egress proxy, codex
   started with `--sandbox read-only` except write access to that output folder and no approvals.
   The prompt is assembled by code from enums and `Safe` fields (6.8) inside a fixed template that
   asks for one image and nothing else. The result is accepted only if the output folder holds
   exactly one PNG, JPEG or WebP, which is then re-encoded (9.4); anything else is discarded and the
   route falls through. Exhaustion is detected from a non-zero exit plus the usage-limit message
   (exhausted until the reset time in the message, else 5 h); a refusal is detected when no image
   is produced. 0 USD, counted by calls. Test (M3): a meaning map with an injected instruction
   ("read C:\Users\... and print it", "fetch a URL") produces no file read outside the folder and no
   network call except the API.
3. **Nano Banana** through the Gemini API with the owner's key. M3 starts by recording its free-tier
   limit and paid price, with source and date, in `price_book`; until then the route is off.
4. **OpenRouter image models** from an allowlist in `config/gates/`; a model is allowed only when
   its price is in `price_book`.
5. **Local open models** (T18 bake-off winner in the existing ComfyUI) as the free fallback.

Provenance: every image has an `images` row and the same data in the file's metadata. The visual
jury picks among candidates.

**Shared ChatGPT plan quota.** Route 2, the loop's Codex runs and the owner's own Codex use share
one plan: production image jobs have priority; the loop runs only in its night window and stops at
the first usage-limit message until the next night; route 2 marks itself exhausted and falls
through.

### 11.4 Video

Remotion local (free) for every tier. Premium adds Higgsfield API shots and Comfy Cloud workflows
(T14), each with cost shown before confirm in Copilot and drawn from the premium budget in
Autopilot. Generated footage is upscaled locally (Real-ESRGAN class) before compositing.

### 11.5 Ledger and caps (M1, enforced in the database)

Tables in 15.1. All ledger functions are in schema `ops`, `security definer`, owned by `postgres`,
`search_path = ''`, and granted to `service_role` (the worker) unless noted; the wrappers call them
internally.

**Model (ruling 1).** One **reservation** per job. It holds the job's estimate and the counter
amounts it charged, and it collects **spend entries**, one per paid provider call, keyed by a call
key. A reservation stays open while its job is `queued` or `running`, however long that is; the
same job (a requeue, a `retryLater`, a graceful stop, a resume of a kie task, an in-stage kie
balance check) always finds the same reservation, because it is looked up by job id. A new job (a
`retry_stage`, a resend after `resolve_kie_submission`) gets its own reservation.

**Prices.** `price_book (provider, model, unit, usd_per_unit, checked_on, source, verified)`.
Lookup: the exact `(provider, model, unit)`, else `(provider, '', unit)`, else raise `MDF05`
`price_missing` (the call is refused; no null ever reaches a cap check). **Estimates:**
`provider_operations (provider, operation, model, items)`. Both are seeded **by the migration**
`spend_ledger` (`insert ... on conflict do nothing`), so every stack, production included, has
them:
- kie credits from `KIE_CREDITS` (`packages/shared/src/rewrite.ts:32-37`: generate 12, replace 5,
  cover 12, extend 12) at 0.005 USD per credit, `verified = false` until the owner confirms;
- `draft_lyrics` per language: one Jev decision, five calls of the **strong** writer (the worst
  case) and three judges for one round, each with its token sizes, priced from the OpenRouter
  models API at migration-writing time (`checked_on` and `source` stored);
- Groq take scoring: a fixed 6 minutes of audio per take (`audio_hour` 0.1), two takes per
  generation; settled at the actual duration when the provider reports it, else at the estimate.

**Caps** (`spend_caps`, seeded by the migration, ruling 3): rows `(scope, key, provider, unit,
period, limit)`; `scope` `global`, `user`, `token` or `run`; `provider` `''` means all; `unit` `usd`
or a price unit such as `credit`; `period` `day` or `month` (calendar windows in Europe/Rome) or
`run`. Defaults (editable later in Settings > Costi, M2a; by SQL until then):

| scope | key | provider | unit | period | limit |
| --- | --- | --- | --- | --- | --- |
| global | `''` | `''` | usd | day | 3.00 |
| global | `''` | `''` | usd | month | 40.00 |
| global | `''` | kie | credit | day | 120 |
| user | `default:admin` | `''` | usd | day | 3.00 |
| user | `default:customer` | `''` | usd | day | 0.50 |
| user | `default:customer` | kie | credit | day | 0 |
| token | each token, written at creation | `''` | usd | day | 1.00 |

The customer USD default is 0.50 so that one language of `draft_lyrics` at the strong-writer
estimate fits; the M1 plan recomputes the estimate from the seeded prices and keeps the default at
least three times it.

**User caps per dimension** (Major 6): for each `(provider, unit, period)` that appears in either
the user's own rows (`key = <user id>`) or the `default:<role>` rows, the user's row wins if it
exists, else the default row applies. Raising one customer's kie cap leaves the role's USD cap in
force.

**Fail closed (ruling 3).** `ops.reserve_job` and `ops.extend_reservation` refuse with `MDF06`
`no_cap` when, for the call's provider, no global `usd` `day` row matches, when no user `usd` `day`
row results from the fallback, or when the actor is a token and has no token row. A database test
empties `spend_caps` and expects every paid wrapper to return `cap_exceeded` with `details.reason
= "no_cap"`.

**Functions.**

```sql
ops.reserve_job(p_job uuid) returns uuid                 -- called by the wrappers and worker_enqueue
  -- 1. estimate = ops.job_spend_rule(p_job): setof (provider, model, items); empty for fake jobs,
  --    on a stack_settings.fake_stack database unless mdf.force_caps is on (revision 6), and for
  --    free stages -> no reservation, return null; idempotent per job (an open reservation of the
  --    same job is returned, not duplicated);
  -- 2. price every item (lookup above); collect matching cap rows (fail closed above);
  -- 3. insert the needed spend_counters rows in sorted order (scope, key, provider, unit, period,
  --    window_start) with "on conflict do nothing", then select them "for update" in the same
  --    order (every ledger function uses this order, so the first reservations of a window
  --    cannot race and concurrent functions cannot deadlock);
  -- 4. if any used + amount > limit, raise MDF02 'cap_exceeded:<scope>:<provider>:<unit>:<period>';
  -- 5. add the amounts, insert the reservation with estimate and the exact charged rows
  --    (scope, key, provider, unit, period, window_start, amount) in reservations.charges.
ops.extend_reservation(p_reservation uuid, p_provider text, p_model text, p_items jsonb) returns void
  -- extra rounds beyond the estimate: same cap check and charge, appended to charges.
ops.spend_entry_open(p_reservation uuid, p_call_key text, p_provider text, p_model text,
                     p_items_est jsonb) returns uuid
  -- before a paid call; idempotent on (reservation, call_key): a re-run gets the same entry id.
  -- Revision 6 (round-5 Major 8): refuses with MDF07 when the provider's open plus settled
  -- estimates would exceed what the reservation charged for that provider; the caller then calls
  -- extend_reservation (which may refuse with MDF02) and opens again.
ops.settle_spend(p_entry uuid, p_items jsonb, p_usd numeric default null) returns void
  -- after the call; actual items, priced (or the provider-reported USD). Revision 6 (round-5
  -- Major 8): records the actual amount with no clamp, rejects only a negative amount, and sets
  -- spend_entries.over_estimate when the actual exceeds 3 times the estimate (costs_get lists
  -- those). A second settle of the same entry is a no-op. If the reservation's settled total for
  -- that provider now exceeds what it charged, the excess is charged to the same counters (no
  -- refusal: the money is spent).
ops.mark_ambiguous(p_reservation uuid) returns void        -- worker, synchronously (below)
ops.close_reservation(p_reservation uuid) returns void     -- internal; the close rule below
ops.expire_reservations() returns integer                  -- scheduler task (14.4)
ops.job_spend_rule(p_job uuid) returns setof record        -- internal
```

**When a job reserves** (`ops.job_spend_rule`):

| Stage | Reserves | Nothing when |
| --- | --- | --- |
| `draft_lyrics` | OpenRouter: the `draft_lyrics` estimate | - |
| `generate_song` | kie: generate, cover or extend credits (by the version's source); Groq: two takes | engine local (ACE-Step, YuE2): Groq only; resume (revision 6, round-5 Major 5: `versions.kie_task_id is not null and versions.kie_generation = versions.generation_count`; a task id left over from an earlier generation is not a resume): Groq only |
| `replace_section` | kie: replace credits | engine local; resume (`section_edits.kie_task_id` set on the edit row the job names) |
| `import_audio`, `timing` | Groq: one take | - |
| other stages | - | always |

**Calls inside a stage.** Every key-bearing call names either a call key (paid) or a free
operation:
- Paid calls (each gets `spend_entry_open` before and `settle_spend` after): kie `generate`,
  `cover`, `extend`, `replace` submits (call key `kie:<op>:<attempt>`; settled at submit
  acceptance, right after the worker writes `kie_task_id`); every OpenRouter chat or decision call
  (`openrouter:<role>:<round>:<n>:a<attempt>`); every Groq transcription
  (`groq:<take id>:a<attempt>`). **Revision 6 (round-5 Major 7):** `<attempt>` is `jobs.attempts`
  (already incremented by `claim_job`), so a requeue, `retryLater` or crash restart opens new
  entries; every attempt after the first calls `extend_reservation` for that stage's estimate
  before its first paid call, so a crash loop meets the caps. The kie submit key stays per attempt
  as before, and the never-resend rule (2.2) is unchanged.
- **Existing guards stay (revision 6, round-5 Major 25).** `kie/guard.ts` (refuses `.test` owners
  unless `ALLOW_TEST_KIE=1`) and `LYRICS_DAILY_CAP` in `draft-lyrics.ts` remain as extra layers
  next to the ledger.
- **A refused extension in `draft_lyrics` (revision 6, round-5 Major 10):** the stage keeps the
  best draft so far, stores the jury result with `incomplete: true`, and finishes the job (it does
  not fail it).
- Free calls (they carry the key and no entry; listed in `FREE_KEY_CALLS` in
  `apps/worker/src/providers/paid.ts`): kie `credit` (balance), `job` and `record-info` (status),
  `wait`, `lyrics-ts`, `upload`, download of results; the worker's periodic balance refresh in
  `main.ts:124-141`, which has no job. The M1 plan checks this list against kie's price page.
- Enforcement in code: HTTP calls go through `providers/paid.ts` (with `providers/kie-client.ts`,
  moved from `kie/client.ts`; `apps/worker/test/rewrite.test.ts:20` and
  `songs-from-songs.test.ts:13` change their import). Subprocess calls go through `engine.run`
  (`engine.ts`), which refuses any call whose `secretEnv` contains a name in `PAID_SECRET_NAMES`
  (`KIE_API_KEY`, `OPENROUTER_API_KEY`, `LYRICS_OPENROUTER_KEY`, `GROQ_API_KEY`,
  `HIGGSFIELD_API_KEY`) unless it carries an open entry id or a `FREE_KEY_CALLS` name. The worker
  settles subprocess calls with `ops.settle_spend(entry_id, ...)` from the subprocess's reported
  result. Today's direct key reads (`source-audio.ts:112`, `replace-section.ts:136`,
  `score-takes.ts:69-70`, `draft-lyrics.ts:202`) move into `providers/`. A unit test fails if a
  worker file outside `providers/` names a paid host or reads a paid key.
- Key files: `engine.ts` sets `MELLODIFAI_ENV_ONLY=1` in every child environment **after**
  `childEnvironment` (the name does not match the secret-name pattern of `secrets.ts:9-10`, so it
  is not stripped; a test asserts a child sees it). The engine repo (an M1 change there) makes every
  script that reads a key file refuse to when the flag is set: `tools/kie.mjs` (refuses `KIE_ENV`
  and its fallback to `C:/Users/Asus/Documents/Claude/Projects/ita/.env`, `kie.mjs:16-24`),
  `whisper_words.py` (its `~/.config/watch/.env` fallback), and any other script the M1 plan finds
  by searching the engine repo for `.env` and `dotenv` reads; a test runs each with no key and the
  flag and expects a refusal. Callers to map in the plan: `generate-song.ts:108, 211, 242, 287-297,
  313-318, 352`, `replace-section.ts:143-216`, `source-audio.ts:122-133`, `draft-lyrics.ts:163,
  239-271`, `lyric-jury.ts:100-110, 376-393`, `import-audio.ts:66`, `local-engine.ts:569`, and
  `timing.ts:44` (it runs `tools/workspace_pipeline.sh`; builder decides in the plan whether that
  reaches a paid provider; default: treat it as paid Groq).

**Close rule (never releases settled spend).** `ops.close_reservation` runs when the job is
`done`, `failed` or `cancelled`, or the job row is gone. It:
1. counts every settled entry at its actual amount and every open entry (the call may have
   happened) at its estimate;
2. for a kie stage whose submit state (`versions.kie_submit_state` for `generate_song`,
   `section_edits.kie_submit_state` for `replace_section`) is `submitted` with a task id but no
   submit entry, writes the submit entry at the estimate. **Revision 6 (round-5 Major 6):** steps 2
   and 3 apply only to a reservation that reserved the kie submit (`reservations.kie_submit_reserved`)
   and only while the version's `kie_generation` still equals the reservation's `kie_generation`
   (for `replace_section`, while the edit row is the reservation's `section_edit_id`); a Groq-only
   job, a resume job or a cancelled job that never submitted gets no kie entry;
3. if that submit state is `submitting` (outcome unknown), sets the reservation `ambiguous` and
   stops: its charges stay counted until `ops.admin_resolve_kie_submission` records the outcome
   (charged: a submit entry at the estimate; not charged: none) and closes it;
4. otherwise reduces each charged counter row by the charged amount minus what step 1 counted,
   only when positive, and sets the reservation `closed`.
The worker calls `ops.mark_ambiguous` itself, before failing a kie stage whose submit state is
`submitting`, so the admin never races the expiry task. `ops.job_cancel` cancels a queued job and
closes its reservation by the same rule. Queued jobs of trashed songs keep their reservations
(restore resumes them); `purge_test_runs` cancels the jobs of the test versions it trashes.

**Normal close (revision 6, round-5 Major 9).** An `after update of status` trigger on `jobs`
(`jobs_close_reservation`) calls `ops.close_reservation` when the status becomes `done`, `failed`
or `cancelled`. `close_reservation` locks the reservation row and does nothing unless it is still
`open`, so the trigger, `job_cancel` and the expiry task never close twice.

**Orphans only (ruling 1).** `ops.expire_reservations` (every 5 minutes) closes reservations that
are still `open` and whose job is terminal or gone (crashes, deleted jobs). It never touches the
reservation of a `queued` or `running` job.

**Web-side tools.** `formatStyle` and `/api/transcribe` are not metered by the ledger in M1 (7.4);
they move into it in M2a, with their token tools.

**Propagation.** `jobs` gains `token_id`, `run_id`, `fake_providers`, `resource_class` and
`priority` (stamped by the trigger of 6.3.4 and copied by `worker_enqueue`); `versions` gains
`test_run`. **A job without a reservation** (one that existed before the migration, or was created
before the server actions moved onto the wrappers, 21.2) gets one on demand: before its first paid
call the worker calls `ops.reserve_job(job)`, with the same cap check; a refusal fails the job with
`cap_exceeded`. So every paid call is covered by a capped reservation, whichever path created the
job.

**Tests.** A worker integration test (`apps/worker/test/ledger-integration.test.ts`) runs the real
`generate_song`, `replace_section` and `draft_lyrics` stage code against fake kie, OpenRouter and
Groq HTTP servers (base URLs from env: `KIE_API_BASE`, `OPENROUTER_BASE_URL`, `GROQ_BASE_URL`, an
M1 change in the worker and the engine scripts) on the e2e stack: a normal run, a crash after the
kie submit and before the settle, a requeue, a `retryLater`, a resume after
`resolve_kie_submission`, and a cancel. After each, the counters must equal the settled spend
(plus open entries at estimate), every reservation must be `closed` or `ambiguous` as expected, and
(revision 6, round-5 Major 7) the spend entries must equal the calls the fake servers observed.
Plus the database tests: empty caps (fail closed), 20 parallel reservations on a fresh window, a
missing price, the per-dimension fallback.

**Revision 6 (round-5 Majors 4 and 25): how the ledger tests run.** The database ledger tests set
`mdf.force_caps = 'on'` inside their own transactions (6.3.4), so they run on the shared fake
stack. The integration test has its own vitest config and script (`pnpm test:ledger`), outside the
worker's `pnpm test`; it needs the engine repo, so it is a local Windows gate on the owner's PC
(listed in the done-when), not a CI job. It reads the engine path from `MELLODIFAI_ENGINE_ROOT`
(25), sets `ALLOW_TEST_KIE=1` with `KIE_API_BASE` pointed at the fake server, and the engine-repo
change lands first with its commit recorded in the plan.

### 11.6 Per-video budget (standard tier, AC7)

Allocations are targets checked against the price book at the start of M3 and re-measured on the
golden set; the hard per-run cap is what is enforced.

| Item | Allocation (USD) | Basis |
| --- | --- | --- |
| Music (one kie generate, two takes) | 0.060 | 12 credits at 0.005 |
| R2: literal translation and blueprint (Gemini Flash) | 0.010 | about 12 images and 4k text tokens |
| Lyrics: writer, up to 3 jury rounds, devil's advocate | 0.020 | about 20k tokens on the fast writer and judges |
| R5 composition writer | 0.005 | about 3k tokens |
| Publish kit and metadata | 0.005 | about 3k tokens |
| Images (route 1 calls; free routes once spent) | 0.020 | at most one Midjourney call, pending the kie price |
| Visual jury (rounds 1-2 Gemini Flash, final round two judges) | 0.020 | 4 images per judge per round |
| Retry reserve | 0.010 | second generation share, extra rounds |
| **Target (median over the golden set)** | **0.150** | |
| **Hard per-run cap** | **0.250** | |

When an item's allocation is spent its stage moves to 0 USD routes or, for juries, continues within
the hard cap; if the hard cap is reached the run stops with `cost_cap`. If the M3 measurement shows
a median above 0.15, the build drops the second final-round judge before anything else.

## 12. Publishing

### 12.1 Track P0: connect the existing YouTube stage early (parallel to M1-M3)

1. Owner creates the Google Cloud project, the OAuth client and the consent screen with every scope
   needed now and later: `youtube.upload`, `youtube.force-ssl`, `youtube.readonly`,
   `yt-analytics.readonly` (22).
2. Builder: `yt.py`'s `SCOPES` gains the two read scopes; the token moves to
   `<runtime root>/secrets/google/youtube-token.json` through `YT_TOKEN_FILE` (already supported,
   line 74), outside every repo.
3. The existing manual flow (admin cookie click, 6.3 item 4) publishes the owner's videos from then
   on.
4. **Re-verify the private-only lock.** The engine repo's `publish/README.md:42` says Google lifted
   it for unverified projects in October 2026 (not verified). Test: upload a short test video
   through the API, set it public, then private. If public works, Blotato is only a fallback;
   otherwise public YouTube goes through Blotato until the audit passes.
5. Audit: the author prepares the YouTube API Services audit package (app description, privacy
   page, screen recording); the owner submits it as early as P0 allows, because it takes weeks.

### 12.2 Schedule and veto window (M4; OD3, AC4, AC5)

- On entering R9 (or on `publish_schedule` for any approved version), a `publish_schedules` row is
  created for the **bundle**: master, Short, thumbnail, captions and every social post of that
  language version.
- **Slot policy** (Settings > Pubblicazione, "Publishing"): the next free slot at least the veto
  window away; before analytics exist, 18:00 Europe/Rome daily, at most one master per day and at
  least 20 h between masters; once 30 days of analytics exist, the best hour from the channel's
  audience activity.
- **Window:** default 24 h before the slot. Shown as "programmato, veto aperto" ("scheduled, veto
  open") with its deadline in the app, the morning report, `notifications_list` and push.
- **The app owns the clock.** YouTube uploads happen early as **private**; `publishAt` is never set
  and `confirm_publication` no longer accepts `scheduled`. At the slot the scheduler task
  `publish_slots` (every minute) flips YouTube to public and hands the social posts to Postiz or
  Blotato as "post now", only when: the window expired, no veto exists, `publish_gate_status` is
  still empty, and the worker is healthy. Anything else leaves it private (fail closed).
- States of `publish_schedules`: `scheduled`, `vetoed`, `publishing`, `published`, `missed`,
  `held_gate_failed`, `failed`. `held_gate_failed` (a gate no longer passes at the slot) notifies
  the owner and waits for a re-check or a veto.
- **Missed slot** (PC or tunnel down): publish late if within 6 h of the slot; otherwise move to
  the next free slot and notify. A veto stays possible until the flip actually happens.
- **Veto** (`publish_veto`, the UI button, `mellodifai veto`) cancels the whole bundle: before
  upload, the jobs are cancelled; uploaded and private, the video stays private (marked vetoed);
  after hand-off or public, a veto is no longer possible and the UI offers "Rendi privato" ("Make
  private") for YouTube.
- The actor of every flip is recorded (`confirmed_via`).

### 12.3 Copilot and Autopilot

In Copilot the person or agent confirms the publish kit, which schedules the bundle; the veto
window still applies. In Autopilot, `autopilot_schedule_publish` schedules it. Public flips are
behind the flag `auto_publish_public` (20).

### 12.4 Publish kit and metadata

Per language version: title, description, tags and hashtags, chapters from R2 sections, captions,
thumbnail, playlist, per-platform post text, generated from the song's own lyrics, editable, and
checked (length limits, no source title or artist names, credits and licence notes, AI disclosure
text). The UI belongs to the project page hub (T17 and T19 in the plan).

### 12.5 YouTube extensions and social routes (M4)

- Worker and database changes: `publish.ts` loads the render named by `payload.render_id` (master
  or hook) instead of always the master; `db.getPublicationForVersion` and the `publicationid`
  check in `authorization.ts:70` become lookups by publication id and render; `publications`
  gains `platform`, `route` (`youtube_api`, `blotato`, `postiz`), `schedule_id`,
  `external_post_id`, `external_url`, `thumbnail_style`, `confirmed_via` (the render's kind comes
  from `renders.kind`; thumbnails are not separate publications); `enqueue_publish` accepts `hook`
  renders; the 4-uploads-per-day cap becomes a setting; the `scheduled` path of `set_privacy` is
  removed.
- Throughput: one full upload is about 2,050 quota units (video 1,600, captions 400, thumbnail 50)
  of 10,000 per day, so about 4 uploads per day, which is **2 remakes per day** (master plus
  Short). At the cap the existing stage retries after the Pacific reset.
- **AI disclosure always true.** A route that cannot set it is not allowed for YouTube; Blotato is
  allowed only after M4 verifies it sets it.
- Shorts: no API flag; the description gets `#Shorts`; `thumbnails.set` is skipped for Shorts.
- Social posting follows T19 in the plan (per-platform route choice "Diretto / Postiz gratis /
  Blotato veloce", that is "Direct / free Postiz / fast Blotato"). Mechanics owned here: Postiz
  needs the PC and the tunnel up at post time and until platforms fetch the media through
  `/m/<token>`; Blotato is the fallback when Postiz errors or the integration is disconnected, and
  receives media by upload. For YouTube through Blotato the video id is parsed from the returned
  URL, or matched on the channel's uploads playlist by title and publish time within 1 h.
- "Segnala claim" ("Report a claim") button and `claim_report` tool: a reported Content ID claim
  pauses Autopilot publishing for that owner and is fed to the loop as a severe negative.

### 12.6 Analytics ingestion (M4)

Scheduler task `analytics_daily` at 06:00 Europe/Rome reads YouTube Analytics for videos younger
than 90 days into `analytics_snapshots`: views, average view duration, the audience retention
curve, and impressions and click-through rate **if the API exposes them per video**: the first M4
step checks the API reference; if they are not available, thumbnail learning uses YouTube's own
thumbnail test results entered in the app and views alone. The Google token is the one from P0.
Per-thumbnail-style learning reads `publications.thumbnail_style`. Analytics feed the loop's
hypotheses only, never its revert decisions.

## 13. Daily improvement loop (OD4, M6)

### 13.1 Roles

Four roles; only the first two touch credentials, and neither runs candidate code.

1. **Supervisor** (host, the owner's account, a scheduled task running `ops/loop/supervisor.ts` from
   the **production** checkout): owns the night window, the kill switch, the GPU lease on the gate's
   behalf, starts and destroys the containers, and runs deploy and revert.
2. **Merger** (host, part of the supervisor): the only holder of git push rights. It reads the
   scorer's verdict file, checks that the candidate commit's tree hash equals the one scored,
   applies the squashed patch with git hooks disabled (`-c core.hooksPath=` set to an empty
   folder), fast-forwards `main` and pushes. It never runs candidate code.
3. **Proposer** (container `mdf-loop-proposer`): the coding agent. Runner: **gnhf with Codex** (the
   owner's overnight runner: it runs Codex on a one-sentence objective in a git checkout and stops
   on a condition; on the host at `C:\Users\Asus\Miniconda3\gnhf`, skill
   `~/.claude/skills/gnhf/SKILL.md`, config `~/.gnhf/config.yml`), installed at a pinned version in
   the container; Claude Code headless is the alternate when the ChatGPT quota is exhausted.
4. **Gate**, split in two:
   - **Sandbox** (container `mdf-gate-sandbox`): runs the candidate's install, lint, type check,
     tests, `test:db` and the golden-set stages on fake providers, writing artefacts to an output
     volume. No network except the gate's own Supabase stack, no Docker socket, no credentials.
   - **Scorer** (container `mdf-gate-scorer`): mounts the artefacts read-only, runs the frozen
     evaluator (13.4) with the dedicated evaluation OpenRouter key, and writes the verdict. It runs
     no candidate code.

### 13.2 Isolation (enforced)

- **Images:** `mdf-loop-proposer` and `mdf-gate-sandbox` from `node:22-bookworm` plus pinned pnpm,
  Python requirements, Chrome for Remotion and (proposer only) the pinned codex CLI and gnhf;
  `mdf-gate-scorer` from the same base without build tools.
- **Proposer:** mounts only its own clone; its only git remote is the local bare repository
  `<runtime root>/loop/repo.git`; no env files, no CLI credentials, no Google tokens, no Supabase
  keys, no host drives. Network: only its model API hosts through an allowlisting egress proxy
  (Squid in its own container). Dependencies install offline from a read-only package store with a
  frozen lockfile.
- **Gate stack:** the supervisor starts a second Supabase stack on the host with the e2e
  configuration (port 45621 and its neighbours, separate project id and volume) and a Docker
  network `mdf-gate-net` created with `--internal` (no gateway, so no `host.docker.internal` and no
  internet). The sandbox joins only `mdf-gate-net`. Before each night the supervisor runs a probe
  inside the sandbox that must fail to connect to `host.docker.internal:44322`, `:44321`, `:3000`,
  `:8188`, `:4007` and to any internet host; if any probe succeeds, the night aborts. The host
  firewall rule (5.2) is the second layer.
- **Scorer network:** only the OpenRouter API through the egress proxy. Its OpenRouter key has a
  provider-side credit limit sized by the formula in 13.4 and is recorded in the ledger as provider
  `openrouter-eval`.
- **Production never reachable:** neither container mounts the production checkout, the worker env
  files, `<runtime root>/secrets/`, the kill switch or the Docker socket.
- `test:db` refuses to run against port 44321, reusing the guard of `apps/web/e2e/local-env.ts`
  (fixed for everyone in M1).
- The standing owner rules (2.2) bind the loop: kie is faked; a secret scanner (gitleaks) runs on
  the diff.
- **Kill switch:** the file `<runtime root>/loop/STOP` and the Settings > Miglioramento
  ("Improvement") toggle, both read by the supervisor between steps.

### 13.3 What the loop may change (a pure path check)

Allowlist:
- writer prompts for lyrics and images (`apps/worker/src/prompts/writers/**`, created in M2a);
- presets and looks (`packages/shared/src/visualizer/viz-looks.ts`,
  `packages/visualizer/src/looks/**`);
- worker stage code in `apps/worker/src/stages/**`, except the denied files below;
- new test files (adding only).

Denylist (wins over the allowlist): `packages/gates/**`, `config/gates/**` (every jury, gate
implementation, threshold, judge prompt, judge model id, router order, cap constant); the timeline
blocks file `packages/shared/src/timeline/blocks.ts`; editing, deleting or skipping existing tests
(`.skip`, `.only`, `.todo` and equivalents in any test file are rejected); lint, TypeScript, test
and CI configuration (`biome.json`, `tsconfig*`, `vitest*`, `.github/**`); `package.json`, the
lockfile, `.gitattributes`, `.gitmodules`, `.husky/**`; `supabase/**`; `eval/**`; auth, tokens,
scopes and the ops layer (`apps/web/lib/auth.ts`, `apps/web/proxy.ts`, `apps/web/lib/ops/**`,
`apps/web/lib/mcp/**`, `apps/auth/**`, `apps/worker/src/authorization.ts`); the paid-provider
module `apps/worker/src/providers/**`; `apps/worker/src/stages/publish.ts` and `quota.ts`;
`ops/**`; `AGENTS.md`, the agent skill, `CLAUDE.md`; env files; `docs/superpowers/**`.

### 13.4 Evaluation: frozen evaluator, golden set and canaries

- **Golden set:** 5 items in M2a, 10 before the loop merges: one of the owner's own videos, CC BY
  music videos the author finds through YouTube's licence filter, and one-line ideas, curated by the
  author, with **frozen artefacts** (analysis, takes, stems, images, word timing) under
  `<runtime root>/golden/` and the manifest `eval/golden/manifest.json` (the only source of truth;
  there is no database table). Evaluation re-runs only the stages a change touches.
- **Canaries:** known-bad items in the same manifest: a close paraphrase and a literal translation
  of a source (must fail lyric originality), a frame with misspelt text (must fail OCR must-fix), a
  render near-identical to a published video (must fail distinctness), a timeline with a forbidden
  field (must fail validation). These checks are deterministic (local metrics, no paid judge). The
  gate requires the candidate's product gates to still reject every canary.
- **Frozen evaluator** (`eval/`, denylisted): its own copy of the jury prompts, rubrics and
  thresholds with pinned judge ids. Scoring always uses it, never the product juries. It changes
  only by a human commit.
- **Renders:** evaluation renders stills at the sampled timestamps plus the grids; one full render
  per candidate on 2 items measures render success.
- **Composite** (0 to 1): visual jury 0.30, lyric jury 0.25, music checks 0.15, render success
  0.15, cost 0.10, time 0.05.
- **Noise:** each item runs k = 2 times per arm. The noise band (the 95th percentile absolute
  difference of the baseline against itself, at least 0.02) is measured once a week and cached, so
  a night has two arms: baseline and candidate.
- **Accept** when the candidate beats the baseline by more than the noise band, no component
  regresses beyond its tolerance (any score component by more than 0.03, render success not at
  all, cost by more than 10%), and every canary is still rejected.
- **Evaluation budget:** cost per hypothesis = items (10) x k (2) x arms (2) x cost per scoring
  pass. The scorer measures the pass cost on the first dry-run night; the nightly cap is set to 3
  hypotheses at that cost (expected about 0.20 USD each at about 0.005 USD per pass, so a 1 USD
  nightly cap including the weekly noise measurement). Hypotheses per night =
  floor(cap / cost per hypothesis), at most 3.

### 13.5 The merge gate (in order; any failure rejects the night's candidate)

1. The diff touches only allowed paths and no denied path; at most 15 files and 400 changed lines.
2. No new or changed dependency; offline install from the frozen lockfile succeeds (sandbox).
3. Secret scan of the diff is clean.
4. Lint (biome), type check, every vitest suite, `test:db` on the gate stack, the e2e smoke test
   (sandbox).
5. Canaries rejected and golden-set evaluation accepted (13.4; sandbox then scorer).
6. No earlier loop merge is still inside its watch window (13.7), so merges never stack.

### 13.6 Merge target and deploy

- Before M6, `main` becomes the production branch (AC13). Cutover: when no feature branch is
  mid-merge, merge `build/studio-ui` into `main`, switch the production checkout to `main`, run the
  deploy script, and from then on branch features from `main`.
- The merger squashes an accepted candidate into **one commit**, rebases it onto `main` and
  fast-forwards `main`. If the rebase conflicts with human work, the night's change is dropped and
  logged; nothing is ever force-pushed. (No separate integration branch is needed.)
- Deploy uses the M1 script `ops/deploy.ts` (21.2), run by the supervisor on the host.

### 13.7 Watch and automatic revert

- For 48 h after a loop merge, and longer until at least 3 real runs have completed (up to 7 days),
  the revert monitor compares new runs against the previous 7 days: job failure rate up by more than
  10 percentage points, render success below 95%, frozen-evaluator score of the run's outputs down
  by more than 0.05, cost per video up by more than 20%.
- **Nightly canary jobs** (scheduler task `canary_jobs`, 00:30): the supervisor starts two golden
  items on the production stack with a `canary` token (fake providers, no spend, no publish) so the
  monitor always has data, scored by the frozen evaluator.
- Any trigger: the supervisor reverts that one commit, deploys, notifies. Because the loop never
  writes migrations, a revert never leaves schema behind. If after 7 days fewer than 3 real runs
  happened, the canary results alone decide.

### 13.8 Enablement and reporting

- The first 7 nights are **dry runs**: everything except the merge, reported as "would merge".
  Merging switches on automatically after 7 consecutive nights in which the probe, gate, scorer and
  a deploy rehearsal (on the gate stack) completed without a crash. This is a mechanical gate, not
  an approval.
- Night window: 01:00 to 06:00 Europe/Rome; production jobs preempt evaluation (14.1).
- Morning report (app, `loop_report_get`, push summary): each hypothesis with files, scores, noise
  band, decision and commit; merges; reverts; open veto windows and deadlines; paused runs;
  yesterday's spend against caps; the top 5 errors.

## 14. GPU, disk and quota budgets

### 14.1 One GPU at a time, enforced (M2a)

- `jobs.resource_class` (`gpu`, `cpu`, `net`) from a stage map in `packages/shared`, and
  `jobs.priority` (smallint, 0 interactive and Copilot, 1 Autopilot, 2 canary), set by the ops
  wrapper or the orchestrator that enqueues the job.
- A single `gpu_lease` row (holder, heartbeat, priority, `expires_at`). A holder renews it with the
  job heartbeat (every 15 s); it expires 60 s after the last renewal. The current `claim_job` is
  extended to hand out a `gpu` job only when the lease is free or expired, ordering by priority then
  age.
- Loop evaluation runs on its own stack, so the **supervisor** holds the production lease on its
  behalf (holder `loop-eval`, priority 3) and passes a yield request to the sandbox through a
  read-only mounted file when a production GPU job is waiting; the sandbox stops between items and
  the supervisor releases the lease. The deploy script waits for the lease to be free.
- Before a Remotion or Demucs job the worker asks ComfyUI to unload its models (or stops it), and
  it claims a GPU job only when at least 6 GB of VRAM is free (the owner's own After Effects
  sessions are respected).

### 14.2 Capacity (rough, measured again in M2a)

| Work | GPU time |
| --- | --- |
| Remake: Demucs on source and take | about 5 min |
| Remake: master render 1080p, 3-minute song | about 10 min |
| Remake: Short and thumbnails | about 4 min |
| Remake: local images (free tier, 8 images) | about 8 min |
| Loop: one hypothesis (10 items, k = 2, 2 arms, stills, 2 full renders) | about 45 min |

### 14.3 Disk (M2a)

- A remake peaks at about 1 to 3 GB. Retention (scheduler task `retention_sweep`, daily): source
  media deleted when R2 passes (kept data listed in 8.4); unchosen takes and intermediates deleted
  14 days after publishing; masters, the Short, stems and the timeline kept.
- New remakes pause when E: has less than 50 GB free (task `disk_guard`, every 10 minutes). Every
  cache is pinned to `<runtime root>/cache/` through the worker's environment (`TMP`, `TEMP`,
  `HF_HOME`, `XDG_CACHE_HOME`, Remotion and browser caches, pip, yt-dlp). Jobs never write to C:.

### 14.4 Scheduler (M1)

One mechanism for timed work: the **worker scheduler** (`apps/worker/src/scheduler.ts`). Table
`scheduled_tasks` (15.1), rows inserted by the migration that adds each task. Functions
(`service_role` only):
- `ops.claim_scheduled_task(p_worker text) returns text`: picks one row with `next_run_at <= now()`
  and either `running_by` null or `started_at` older than 10 minutes (a stale claim is taken
  over), `FOR UPDATE SKIP LOCKED`; sets `running_by`, `started_at`; returns its name.
- `ops.finish_scheduled_task(p_name text, p_worker text, p_ok boolean, p_error text)`: only the
  claiming worker can finish it; clears `running_by`, records the result and sets `next_run_at`:
  `now() + interval_s`, or for daily tasks the next `daily_at` computed as
  `((current_date + 1) + daily_at) at time zone 'Europe/Rome'` (so a daylight-saving change moves
  the run by the wall clock, not by 24 hours).

Each task's body is one SQL function, `service_role` only; the worker just calls it:

| Task | Body | Cadence | From |
| --- | --- | --- | --- |
| `expire_reservations` | `ops.expire_reservations()` (11.5) | every 5 min | M1 |
| `purge_idempotency` | `ops.purge_idempotency()`: delete keys older than 24 h | hourly | M1 |
| `purge_oauth` | `ops.purge_oauth()`: delete `oauth_store` rows expired or consumed more than 1 h ago, and `oauth_consents` older than 1 day that never bound a grant | hourly | M1 |
| `purge_audit` | `ops.purge_audit()`: delete `audit_log` rows older than 180 days | daily 03:30 | M1 |
| `purge_test_runs` | `ops.purge_test_runs()`: cancel the jobs and trash the versions with `test_run = true` older than 7 days | daily 03:45 | M1 |
| `price_book_sync`, `kie_reconcile`, `notify_push`, `ingest_uploads` | - | - | M2a |
| `retention_sweep`, `disk_guard` | - | - | M2a |
| `publish_slots`, `veto_reminders`, `capability_expire`, `analytics_daily` | - | - | M4 |
| `canary_jobs` | - | - | M6 |

## 15. Data model additions

All migrations are additive (new tables, new nullable columns, widened check lists) except the
privilege changes of `ops_lockdown`, which only revoke. Numbers are assigned after T12's last
migration.

### 15.1 M1 tables (DDL level)

Rules for every M1 object: RLS on; an explicit `revoke all on <table> from anon, authenticated;`
after `create table` and `revoke execute on function <f> from public, anon, authenticated;` before
each function's single grant (6.3.2); no table writes for `anon` or `authenticated`. "Read own" means
a `select to authenticated using (<owner column> = (select auth.uid()))` policy plus a table-level
`grant select` to `authenticated`, unless a column list is given.

```sql
-- migration ops_roles
-- (raises first if two allowlist emails differ only by case)
create unique index admin_allowlist_email_lower on public.admin_allowlist (lower(email));
alter table public.admin_allowlist add column role text not null default 'customer'
  check (role in ('admin','customer'));
update public.admin_allowlist a set role = p.role
  from public.profiles p where lower(p.email) = lower(a.email);
-- create_allowlisted_profile(): role from the allowlist row (lower(email) match).

-- migration ops_layer (roles guarded as in 6.3.1, schema ops, default privileges, every table and
-- function below; no revokes of existing grants yet, so the app keeps working)
create table public.agent_tokens (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references public.profiles(id) on delete cascade,
  kind text not null check (kind in ('pat','oauth','autopilot')),
  name text not null check (length(name) between 1 and 60),
  token_hash text unique, token_hint text,
  oauth_client_id text, grant_id text unique,
  scopes text[] not null check (scopes <@ array['read','create','spend','publish']),
  remote boolean not null default false,
  test_mode boolean not null default false,
  expires_at timestamptz,
  created_at timestamptz not null default now(), last_used_at timestamptz, revoked_at timestamptz,
  check ((kind = 'pat') = (token_hash is not null)),
  check ((kind = 'oauth') = (oauth_client_id is not null)),
  check (not remote or expires_at is not null)
);
create unique index agent_tokens_one_grant on public.agent_tokens (owner_id, oauth_client_id)
  where kind = 'oauth' and revoked_at is null;
create policy "owners read tokens" on public.agent_tokens for select to authenticated
  using (owner_id = (select auth.uid()));
grant select (id, owner_id, kind, name, token_hint, oauth_client_id, scopes, remote, test_mode,
  expires_at, created_at, last_used_at, revoked_at) on public.agent_tokens to authenticated;
  -- column grant: token_hash and grant_id are never readable through PostgREST

create table public.oauth_store (
  model text not null, id_hash text not null, payload jsonb not null,   -- payload without jti
  grant_id text, uid text, user_code text, flow_nonce_hash text,
  expires_at timestamptz, consumed_at timestamptz,
  primary key (model, id_hash)
);
create index on public.oauth_store (grant_id);
create index on public.oauth_store (uid);
create index on public.oauth_store (expires_at);                       -- no grants

create table public.oauth_consents (
  uid text primary key,
  user_id uuid not null references public.profiles(id) on delete cascade,
  client_id text not null, scopes text[] not null, test_mode boolean not null default false,
  flow_nonce_hash text not null, used_at timestamptz,
  token_id uuid references public.agent_tokens(id) on delete cascade,
  created_at timestamptz not null default now()
);                                                                      -- no grants

create table public.oauth_pairing (
  id boolean primary key default true check (id), open_until timestamptz,
  -- revision 6 (round-5 Major 27): the client that claimed the window, shown in Settings > Agenti
  client_id text, client_name text, redirect_host text, registered_at timestamptz,
  loopback_only boolean
);                                                                      -- no grants; one row

-- revision 6 (round-5 Major 3): the fake-stack switch, writable only by postgres
create table public.stack_settings (
  id boolean primary key default true check (id), fake_stack boolean not null default false
);                                                                      -- no grants; one row

-- revision 6 (round-5 Major 23): per-user daily counts of the web-side tools
create table public.web_tool_usage (
  user_id uuid not null references public.profiles(id) on delete cascade,
  tool text not null check (tool in ('style_format','transcribe')),
  day date not null, used integer not null default 0,
  primary key (user_id, tool, day)
);                                                                      -- no grants

create table public.idempotency_keys (
  actor_key text not null, key text not null check (length(key) between 8 and 100),
  request_hash text not null, state text not null check (state in ('in_flight','done')),
  response jsonb, created_at timestamptz not null default now(),
  primary key (actor_key, key)
);                                                                      -- no grants

create table public.audit_log (
  id bigint generated always as identity primary key,
  at timestamptz not null default now(),
  owner_id uuid references public.profiles(id) on delete cascade,      -- null when unresolved
  actor_kind text not null check (actor_kind in ('session','pat','oauth','worker','unknown')),
  token_id uuid references public.agent_tokens(id) on delete set null,
  operation text not null, args_hash text not null,
  result text not null check (result in ('ok','error')), error_code text,
  remote boolean not null default false
);
create index on public.audit_log (owner_id, at desc);                   -- read own

create table public.app_flags (
  flag text primary key check (flag in ('remote_mcp','autopilot','auto_publish_public','loop_merge','premium')),
  enabled boolean not null default false, changed_by uuid, changed_at timestamptz
);
create policy "flags readable" on public.app_flags for select to authenticated using (true);
grant select on public.app_flags to authenticated;

create table public.scheduled_tasks (
  name text primary key, interval_s integer, daily_at time,
  next_run_at timestamptz not null, running_by text, started_at timestamptz,
  last_ok_at timestamptz, last_error text,
  check ((interval_s is null) <> (daily_at is null))
);                                                                      -- no grants

create table public.ops_health (id boolean primary key default true check (id), at timestamptz);

alter table public.versions add column test_run boolean not null default false;

-- migration spend_ledger (also seeds price_book, provider_operations, spend_caps,
-- scheduled_tasks rows with "on conflict do nothing")
create table public.price_book (
  provider text not null, model text not null default '',
  unit text not null check (unit in ('credit','image','mtok_in','mtok_out','audio_hour','call')),
  usd_per_unit numeric(12,6) not null, checked_on date not null, source text not null,
  verified boolean not null default false,
  primary key (provider, model, unit)
);
create policy "prices readable" on public.price_book for select to authenticated using (true);
grant select on public.price_book to authenticated;

create table public.provider_operations (
  provider text not null, operation text not null, model text not null default '',
  items jsonb not null, verified boolean not null default false,
  checked_on date not null, source text not null,
  primary key (provider, operation, model)
);                                                                      -- no grants

create table public.spend_caps (
  scope text not null check (scope in ('global','user','token','run')),
  key text not null default '', provider text not null default '',
  unit text not null default 'usd',
  period text not null check (period in ('day','month','run')),
  "limit" numeric(12,4) not null check ("limit" >= 0),
  primary key (scope, key, provider, unit, period),
  check (unit = 'usd' or provider <> ''),
  check ((scope = 'run') = (period = 'run'))
);                                                                      -- no grants

create table public.spend_counters (
  scope text not null, key text not null, provider text not null, unit text not null,
  period text not null, window_start date not null,          -- Europe/Rome; '1970-01-01' for run
  used numeric(14,4) not null default 0,
  primary key (scope, key, provider, unit, period, window_start)
);                                                                      -- no grants

create table public.reservations (
  id uuid primary key default gen_random_uuid(),
  job_id uuid unique references public.jobs(id) on delete set null,
  job_gone boolean not null default false,       -- set by the before-delete trigger on jobs
  user_id uuid not null references public.profiles(id) on delete cascade,
  token_id uuid references public.agent_tokens(id) on delete set null,
  run_id uuid, version_id uuid,
  estimate jsonb not null,                        -- [{provider, model, items, usd}]
  charges jsonb not null default '[]',            -- [{scope,key,provider,unit,period,window_start,amount}]
  state text not null default 'open' check (state in ('open','ambiguous','closed')),
  -- revision 6 (round-5 Major 6): what the close rule's kie steps may act on
  kie_submit_reserved boolean not null default false,
  kie_generation integer, section_edit_id uuid,
  created_at timestamptz not null default now(), closed_at timestamptz
);
create index on public.reservations (state) where state <> 'closed';
create index on public.reservations (user_id, created_at desc);         -- read own

create table public.spend_entries (
  id uuid primary key default gen_random_uuid(),
  reservation_id uuid not null references public.reservations(id) on delete cascade,
  call_key text not null, provider text not null, model text not null default '',
  items_est jsonb not null, usd_est numeric(10,4) not null,
  items jsonb, usd numeric(10,4),
  state text not null default 'open' check (state in ('open','settled')),
  over_estimate boolean not null default false,   -- revision 6 (round-5 Major 8): actual > 3x estimate
  created_at timestamptz not null default now(), settled_at timestamptz,
  unique (reservation_id, call_key)
);
create index on public.spend_entries (provider, settled_at);           -- read through ops.costs_get

alter table public.jobs
  add column token_id uuid references public.agent_tokens(id) on delete set null,
  add column run_id uuid,
  add column resource_class text not null default 'cpu' check (resource_class in ('gpu','cpu','net')),
  add column priority smallint not null default 0,
  add column fake_providers boolean not null default false;
-- triggers on jobs: jobs_stamp_ctx (before insert or update, 6.3.4), jobs_set_resource_class
-- (before insert, from the stage map), jobs_mark_reservation_gone (before delete: sets job_gone on its reservation),
-- jobs_close_reservation (after update of status, revision 6, 11.5)

-- migration ops_lockdown: the revokes of 6.3.2 (last; 21.2)
```

### 15.2 Later tables (key fields; DDL written in each milestone's plan before it starts)

| Entity | Key fields | Milestone, migration |
| --- | --- | --- |
| `notifications`, push through ntfy | as in revision 4 (user, kind, severity, title, body, link, deadline, read, pushed) | M2a `notifications` (moved from M1) |
| `upload_intents` | owner, kind, size, sha256, staging name, duration, state, storage path | M2a `uploads` (moved from M1) |
| `remakes` | owner, source url and id, mode, tier, driver, lease, defaults snapshot, status, stop reason, project, primary version | M2a `remakes` |
| `stage_runs` | remake, version, r-stage, state, round, `stage_version` (optimistic counter), stop reason, cost reserved and settled, driver; `jobs.stage_run_id` links jobs to it | M2a `remakes` |
| `remake_analyses` | remake, music, transcript with word timestamps, literal translations, meaning map, blueprint (schema versions), models, cost, `untrusted` | M2a `remakes` |
| `remake_defaults` | user, fields of 8.7 | M2a `remakes` |
| `jury_reports` | subject kind and id, round, judges, rubric version, scores, must-fix, devil's notes, available, passed | M2a `jury_reports` |
| `versions.status` value `analysing`; new stages in `jobs_stage_check`; `ledger_entries.run_id` foreign key | | M2a `remakes` |
| `gpu_lease` | holder, heartbeat, priority, expires_at | M2a `gpu_lease` |
| `timelines` | version, revision, document, author | M2b `timelines` |
| `images` | owner, version, shot, provider, model, prompt hash, ledger entry, path, sha256 | M3 `images` |
| `fingerprints` | subject kind (`source`, `render`), subject id, shot or frame index, pHash, DINOv2 embedding | M2a (source) `remakes`, M3 (renders) `images` |
| `versions.content_kind`, `publish_gate_status()` | 10.8 | M3 `publish_gate` |
| `publications` new columns (12.5), `publish_schedules`, `capability_links` | 12.2, 12.5, 5.4 | M4 `publish_routes` |
| `analytics_snapshots` | video id, date, views, average view duration, retention, impressions and CTR if available | M4 `analytics` |
| `autopilot_policies` | 6.5 | M5 `autopilot` |
| `loop_runs`, `loop_watch` | night, hypothesis, files, scores, noise band, decision, commit, revert | M6 `loop` |

## 16. Observability and notifications

- **Stores:** `job_events` (existing); `audit_log` (180 days); `ledger_entries` (kept);
  `jury_reports` (kept); logs under `<runtime root>/logs/` (rotated, 14 days, redacted).
- **Metrics:** SQL views (`ops_metrics_daily`): job failure rate by stage, render success, mean
  jury scores, cost per video, queue wait, GPU busy share.
- **Notifications (M2a, moved from M1 in revision 5):** the `notifications` table, shown in the
  app and to agents. Push through
  **ntfy** (AC12): the public `https://ntfy.sh` server, a random 24-character topic in `NTFY_TOPIC`
  (`apps/worker/.env.local`), sent by the scheduler task `notify_push`. Payload: title, at most 200
  characters of body, and a link to the app; never lyrics, keys or personal data.

## 17. Threat model and risks

| Risk | Surface | Likelihood / impact | Mitigation | Milestone |
| --- | --- | --- | --- | --- |
| Direct database calls bypass caps, roles, veto | PostgREST | high once exposed / critical | `ops_lockdown` revokes (6.3); Supabase not exposed in M1 (5.2) | M1 |
| Every allowlisted user is admin | auth trigger | certain today / high | `ops_roles` (6.2) | M1 |
| Forged service-role JWT with the demo secret | gateway | high if exposed / critical | Key rotation and exit test (5.3) | M1 |
| Private services exposed by the tunnel | tunnel | medium / critical | Edge-proxy path allowlist, catch-all 404, firewall rule (5.2) | M1 |
| OAuth token used against Supabase | OAuth | eliminated by design | Opaque tokens from `apps/auth` (6.4) | M1 |
| Compromised Next process | web | low / high | Runs as `mdf-web`. It holds `MDF_WEB_DATABASE_URL`, its own OpenRouter and Groq keys (7.4) and the cookies of active users. Through `mdf_web` it can call only the `ops` functions of 6.3.6, so every write passes scope, cap, reservation, audit, test and claim checks (6.3.4); it can act for a cookie user only with a session id refreshed in the last 65 minutes, and it can claim `remote = false`, so with an active admin session it can perform admin operations: that is the residual risk, bounded by the session recency and the production session timebox. It cannot read the worker's secrets, the Supabase signing key or `apps/auth`'s keys (5.1, 5.3). If the owner keeps every service under his own account (5.1 fallback), a compromise of Next is a compromise of the PC. | M1 |
| Compromised `apps/auth` | auth | low / medium | Runs as `mdf-auth` (ruling 5). It holds `MDF_AUTH_DATABASE_URL` and its ID-token keys; `mdf_auth` can call only the `ops.oauth_*` functions, and `ops.oauth_upsert` issues codes and tokens only for grants bound to a used consent row (client, scopes as a subset, grant live) given in the browser that started the flow (6.4). Revision 6 (round-5 Major 12): a compromised `apps/auth` can mint tokens for every live grant, up to that grant's scopes and its token cap; it cannot create a grant without a consent, read Next's env file or act outside those grants. | M1 |
| A local process takes over a service's loopback port (revision 6, round-5 Major 26) | 3000, 3010, 3080 | low / high | `ops/services.ts` checks the owning account of each port at start and every 60 seconds and stops `cloudflared` on a mismatch (5.1). Residual: between two checks a process that wins a port during a restart can see tunnel traffic (tokens, consent cookies) for up to 60 seconds. | M1 |
| Consent phishing with an attacker's client | OAuth | low / high | Registration only inside the admin's 10-minute pairing window, flow-bound `mdf_flow` cookie, registration time shown at consent (6.4) | M1 |
| Overspend under concurrency | ledger | medium / high | One capped reservation per job, counters locked in a fixed order, fail closed without caps, on-demand reservations for jobs created by other paths, the `engine.run` rule (11.5) | M1 |
| Agent-authored code execution | renders | eliminated by design | Data-only timeline (9.2), file validation (9.4) | M2b |
| Prompt injection from source content | Autopilot writer, agents, route 2, loop | medium / medium | Enum and `Safe` fields (6.8), route 2 container (11.3) | M2a, M3 |
| Unjudged content in Autopilot | juries | medium / high | Fail-closed `jury_unavailable` (10.1) | M5 |
| Video public against a veto | publishing | low / high | App-owned clock, fail closed (12.2) | M4 |
| Loop loosens production gates | loop | high without rails / high | Gates in denylisted paths, canaries, revert scored by the frozen evaluator (13.3-13.7) | M6 |
| Candidate code reaches credentials or production | loop | medium / critical | Sandbox on an internal network, probe, scorer and merger split (13.1, 13.2) | M6 |
| Content ID claim | YouTube | medium / medium | Originality gates; claim report pauses Autopilot publishing (12.5) | M4 |
| kie or the Midjourney reseller disappears | providers | medium / low | OD5 fallthrough; ACE-Step for music | M3 |
| YouTube audit rejected or lock still applies | publishing | medium / medium | P0 re-verification and early audit (12.1) | P0 |
| GPU queue bottleneck | worker | high / medium | GPU lease and priorities (14.1) | M2a |
| Disk fills | E: | medium / medium | Retention and guard (14.3) | M2a |
| Non-owner machines as workers | future | later / high | Portability rule on credentials (25) | M8 |

## 18. Alternatives considered

| Choice | Chosen | Rejected and why |
| --- | --- | --- |
| Remake rule, agents, veto window, loop, image order, renderer, PC hosting | Owner decisions OD1-OD8 | Not re-argued. |
| Hosting | PC plus tunnel (AC1) | Vercel plus hosted Supabase: the worker, GPU and database live on the PC anyway. |
| Tunnel | Cloudflare Tunnel | Tailscale Funnel: one `*.ts.net` hostname, no WAF, not on the owner's domain. |
| M1 public surface | MCP, OAuth and sign-in only (AC15) | Whole app plus Supabase in M1: the largest attack surface, not needed by OD2. |
| Authorization server | `apps/auth` on `oidc-provider` with opaque tokens (AC2) | Supabase OAuth server: its tokens are Supabase JWTs usable on PostgREST, Realtime and storage, which needs extra blocks everywhere (the fallback is now `@node-oauth/oauth2-server` with the same opaque tokens). |
| Internal identity | `mdf_web` and `mdf_auth` Postgres roles and the `ops` schema (AC14) | Minting Supabase JWTs in Next: puts a key that can mint `service_role` in the internet-facing process. |
| Publish clock | App-owned (AC4) | `publishAt`, Blotato or Postiz schedules: an offline PC would publish against a veto. |
| Agent compositions | JSON timeline (AC3) | TSX in a sandbox: remote code execution on the PC. |
| Loop gate | Sandbox, scorer and host merger split | One gate container: candidate code next to the push credential. |
| Image route 2 | codex in a container with only an output folder | codex on the host: a shell-capable agent on untrusted prompts under the owner's account. |
| stdio MCP | Bridge to `/api/mcp` | A stdio server on the database: a second implementation. |
| Scheduler | Worker scheduler | `pg_cron`: half the tasks need the network and Python in the worker anyway. |
| Ops scripts | TypeScript on Node with thin OS wrappers | PowerShell plus POSIX copies: the untested copy rots. |
| Push channel | ntfy (AC12) | Email (needs SMTP for every alert), Telegram (a bot to run). |

## 19. Testing strategy

All with zero kie spend.

- **Fakes.** `apps/worker/src/fake` is extended to OpenRouter and Groq HTTP fakes (kie fakes exist);
  later milestones add yt-dlp, Midjourney, codex, Nano Banana, YouTube, Blotato and Postiz. A job
  runs on fake stages when the process has `WORKER_FAKE=1` or the job has `fake_providers = true`.
  The ledger integration test (11.5) instead runs the real stage code against fake HTTP servers.
- **Remote exit test on production (M1).** An admin `test_mode` PAT (Claude Code over stdio) and an
  OAuth grant with "Test (fake providers)" ticked (claude.ai) drive the real tunnelled instance;
  their jobs run on fakes and create no reservations or spend entries.
- **MCP checks:** HTTP: `npx @modelcontextprotocol/inspector --cli https://app.mellodifai.com/api/mcp
  --method tools/list`, then `--method tools/call --tool-name song_get` (and `song_create`,
  `job_status`) with the bearer token; stdio: `npx @modelcontextprotocol/inspector --cli mellodifai
  mcp --method tools/list`. With a revoked token the HTTP call returns 401 and the stdio call
  returns a JSON-RPC error carrying `unauthorized`.
- **Unit tests:** schemas, the `"use server"` wrapping rule (5.2), `next` validation (5.4),
  `check-no-keys`, `engine.run` refusing a paid `secretEnv` without an entry, a child seeing
  `MELLODIFAI_ENV_ONLY`, the static scan of paid hosts and keys.
- **Database tests** (`supabase/tests/`, never against production): the 6.3.7 exit tests, the ACL
  test, the error-map test, the ledger tests of 11.5, the `oauth_upsert` and nonce tests (6.4), the
  role rules (a new allowlisted user is a customer; `set-owner.ts` leaves one admin). They connect
  with the `postgres` npm client (a root dev dependency) through `TEST_DB_URL` and `TEST_MDF_WEB_URL`,
  set by `ops/stack.ts` for e2e and CI. Every existing `supabase/tests` file that fails after the
  lockdown (revision 6, round-5 Major 22: nine files call `public` RPCs as `authenticated`, and
  `rls.test.ts` also builds fixtures with direct inserts) is rewritten to call `ops` wrappers
  through a helper `opsCall(session, fn, args)`; `rls.test.ts` builds its fixtures with the service
  role and expects `42501` on direct writes; `queue.test.ts` keeps its service-role worker calls
  unchanged.
- **OAuth end to end** against the local stack: pairing window closed (registration refused) and
  open, an allowlisted and a refused redirect URI, PKCE, consent with only `read` ticked, a consent
  attempt from a second browser without `mdf_flow` (refused), a reused nonce (refused), token, tool
  call, revocation. **Topology (revision 6, round-5 Major 16):** Playwright starts three
  `webServer` entries on the e2e stack: Next on 3210, `apps/auth` on 3211 (issuer
  `http://127.0.0.1:3212/oauth`) and the edge proxy on 3212, which routes `/oauth/*` and the
  discovery paths to 3211 and everything else to 3210; the OAuth tests run through the proxy origin
  3212, and `apps/auth/redirect-allowlist.json` allows the test client's loopback redirect.
  `ci.yml` starts the same.
- **Tunnel smoke test:** allowed routes answer, denied routes return 404, a cookie on `/api/v1`
  is ignored (401), nothing of Supabase answers.
- **Probes** (5.3): every database login role with the default password fails from a container.

**CI and e2e.**
- `ops/stack.ts render --env ci` and `--env e2e` produce the configs of 5.3 (throwaway signing key
  outside the checkout, `stack_settings.fake_stack` on, mail catcher, local `SITE_URL`), start the stack with
  `--workdir`, set the `mdf_web` and `mdf_auth` passwords to test values, and print the env lines
  the tests need.
- `.github/workflows/ci.yml` (Modify): runs `ops/check-no-keys.ts`; renders and starts the CI stack
  (API 54321, mail catcher 54324); sets `CI=true` (GitHub's default; the `test:db` guard in root
  `package.json:13` accepts 54321 only then), `E2E_ALLOW_LIVE_STACK=1` for the e2e step (the guard in
  `apps/web/e2e/local-env.ts:23-26`; the CI stack is throwaway), `MAILPIT_URL=http://127.0.0.1:54324`,
  `SUPABASE_INTERNAL_URL`, `MDF_WEB_DATABASE_URL`, `SITE_URL`, `WORKER_FAKE=1`; then `pnpm test:db`
  and `pnpm e2e` as today.
- `apps/web/playwright.config.ts` (Modify) passes `SUPABASE_INTERNAL_URL`, `MDF_WEB_DATABASE_URL`
  and `SITE_URL` to the dev server; `apps/web/e2e/support.ts` (Modify) reads `MAILPIT_URL` (default
  45624 for the local e2e stack) and follows the sign-in link to `127.0.0.1:3210`.

## 20. Rollout, feature flags and rollback

| Flag | Turns on | Enablement gate | Kill path |
| --- | --- | --- | --- |
| `remote_mcp` | remote PATs, OAuth consent and OAuth tokens (checked in the database) | after the local exit tests and the tunnel smoke test pass; the remote exit test then runs with it on | Settings > Agenti switch (local); away from the PC: disable the hostname in the Cloudflare dashboard (README) |
| `autopilot` | Autopilot runs | M3 gates and the M1 caps in place, 5 Copilot remakes passed every gate | flag off; running runs stop at the stage boundary |
| `auto_publish_public` | the slot flip to public | P0 lock re-verification or a verified Blotato route; 3 Copilot publishes | flag off |
| `loop_merge` | the merger | 7 dry-run nights (13.8) | kill switch file or Settings toggle |
| `premium` | premium tier | M7 acceptance | flag off |

**Deploy** (`ops/deploy.ts`). **Revision 6 (round-5 Blocker 1):** `deploy.ts` runs from a pinned
copy of the invoking checkout's `ops` package (copied to `<runtime root>/ops-pinned/<timestamp>`
before step 1), never from the tree it checks out; it acts on the deploy clone
`<runtime root>/deploy` (5.1), and it skips the `apps/auth` build and start when the target has no
`apps/auth`. Production stays on its pre-M1 commit until the `m1-floor` tag exists; until then
`deploy.ts` refuses every target.
1. stop `cloudflared`, Next, `apps/auth` and the worker (so no old process enqueues or calls a
   provider during the migration);
2. data backup: `supabase db dump --data-only --schema public,auth,storage --db-url ... -f
   <runtime root>/backups/<timestamp>-<tag>.sql` (kept 14 days; the file name records the tag it
   was taken on);
3. `git fetch` and check out the target (a tag `m1-*` or later, or `main` after AC13);
4. `ops/check-no-keys.ts`; frozen-lockfile install;
5. `supabase migration up --workdir <runtime root>/stacks/prod --db-url ...` (5.3), then the
   stored role passwords are re-applied (5.3 item 3), then `ops/set-owner.ts`;
6. build Next and `apps/auth`;
7. start the services in order; health check: local `/api/health` must report `ops: "ok"` (which
   includes the smoke write of 5.6) and the expected `schema`.
- On a failed health check, the script returns automatically to the previous tag **only if step 5
  applied no migration**; otherwise it leaves the services stopped, marks the deploy failed and
  writes the reason to `<runtime root>/logs/deploy.log`.
- `--to <tag>` refuses a tag older than the **migration floor**: the tag `m1-floor`, placed on the
  commit that lands `ops_lockdown` together with the moved server actions and rewritten tests
  (21.2 step 5), the first commit where the app and the revokes agree.
- **Restore** (revision 6, round-5 Major 19; `ops/restore.ts <backup>`, run by the owner, written
  in the README): stop every service; take a safety backup of the current data; check out the tag in
  the backup's file name in the deploy clone; reset only the database with `supabase db reset
  --workdir <runtime root>/stacks/prod --no-seed` at that tag (the storage volume, which holds the
  audio and renders, is kept); `psql --db-url ... -f <backup>.sql`; re-apply the stored role
  passwords; `ops/deploy.ts --to <that tag> --skip-migrations`. `supabase stop --no-backup` is
  never used on the prod project (5.3).

## 21. Milestones

### 21.1 Summary

| Milestone | Goals | Covers | Needs | Owner actions |
| --- | --- | --- | --- | --- |
| M0 (running) | - | T12, storyboard bug | - | - |
| P0 (parallel, from now) | 5 (manual) | 12.1 | nothing | Google OAuth client, audit submission |
| M1 Safe agent access | 2, 4 (ledger) | 5, 6, 7, 11.5, 14.4, 15.1, 19, 20 (21.2 is the checklist) | the head of `build/studio-ui` (T12 included) | DNS and tunnel creation, SMTP, `mdf-web` and `mdf-auth` accounts, firewall rule, kie rate |
| M2a Remade song (Copilot) | 1 (song half), 3 (lyrics, originality) | R1-R4b; 8, 9.1, 10.1-10.3, 14.1, 14.3 | M1 | confirm AC10, AC11 (optional) |
| M2b Remade video (Copilot) | 1 (video half) | R5, R7; 9.2-9.4 | M2a | - |
| M3 Visual quality and images | 3, 4 (images) | R6, R8; 10.4-10.8, 11.3; T15, T18; thumbnails; web timeline editor | M2b | Gemini key, kie Midjourney, eval OpenRouter key, codex device login in `mdf-img` |
| M4 Publishing | 5 | R9; 12.2-12.6; T17, T19; project page hub; `post.` and `/m/` | M3, P0 | Blotato key |
| M5 Autopilot | 1 (Autopilot), success criterion | 6.5; flag `autopilot` | M1, M3, M4 | remake defaults |
| M6 Daily loop | 6 | 13 | M5, `main` cutover | confirm AC6 (optional) |
| M7 Premium | 4 (premium) | Higgsfield, T14 | M3 | Comfy Cloud key |
| M8 Portable runtime | - | 25 | M6 | Debian server later |
| W1 Remote web UI | - | 5.7 (`/media` streaming, browser URL), `api.` host, Access decision | M1, DNS | none |
| UI track | - | 1080p previews, karaoke mode (plan) | T12 | - |
| Later | - | T11b, T16, T20, T21, T22, Riffusion items, direct Anthropic client | M4 | - |

### 21.2 M1 contents checklist (the single source for M1)

**Scope.** M1 is safe agent access: the ops layer and lockdown, the ledger and caps, PATs and the
stdio bridge, remote MCP with OAuth, and the tunnel for exactly those routes. Moved to M2a: token
tools for uploads, imports, section edits, playlists and library edits; uploads for tokens; the
web-side tools in the ledger; notifications and ntfy; Settings > Costi; the SSE progress route; the
gates move; price sync and kie reconciliation; the CLI keyring; inviting users from Settings. Moved
to W1: `/media` streaming and the browser Supabase URL.

**Base:** a branch from the head of `build/studio-ui` when planning starts (T12 included).

**Steps (every commit leaves lint, typecheck, tests, `test:db` and e2e green):**
0. **Spikes**, one day each, written results in the plan, each with its stated fallback:
   1. `oidc-provider` wiring of 6.4 with the claude.ai connector (connector redirect URIs, the
      adapter with hashed ids and no `jti`, interaction cookie path) - fallback
      `@node-oauth/oauth2-server`;
   2. the database stack: list every login role in the pinned image, rotate all of them and
      re-template the services (5.3) - fallback the pinned self-hosting compose; whether
      `signing_keys_path` and `--workdir` work with a stack folder outside the checkout; whether a
      `postgres`-owned definer function can read `auth.sessions`; the container probe;
   3. `@modelcontextprotocol/server` 2.4.0 `WebStandardStreamableHTTPServerTransport` in stateless
      JSON mode in a Next 16.4 route handler - fallback `mcp-handler`.
1. **Ops tooling first, then the additive database** (revision 6, round-5 Blocker 1: the order
   changed, not what gets built). Before any commit creates a `nologin` role or revokes anything:
   - the ops tooling: the `@mellodifai/ops` package, `ops/check-no-keys.ts` with the pre-commit
     hook, `ops/stack.ts` (render for every environment, start, migrate and the e2e/CI/dev half that
     provisions the `mdf_web` and `mdf_auth` login passwords after every start or migration and
     writes the env lines), `ops/rotate-db-passwords.ts` with the container probe,
     `ops/set-owner.ts`, `ops/add-user.ts`, `ops/sign-in-link.ts`, the start, stop and `acl` parts
     of `ops/services.ts`, `ops/deploy.ts`, `ops/restore.ts`, `ops/cutover.ts`, `/api/health`, and
     the CI and Playwright wiring (the stack render, the env lines, the `test:db` guard, the
     `seed.sql` admin row);
   - then the migrations `ops_roles`, `ops_layer` and `spend_ledger` (several files are allowed):
     roles, schema, tables, seeds, every `ops` function and trigger, the `ops` field of
     `/api/health`. No existing grant is revoked, so the app and the existing tests keep working,
     and the role passwords are set on every stack the moment the roles exist.
   Production stays on its pre-M1 commit: `ops/deploy.ts` refuses every target until `m1-floor`
   exists.
2. **Worker ledger:** `providers/paid.ts`, `providers/kie-client.ts`, the `engine.run` rule,
   `MELLODIFAI_ENV_ONLY` and the engine-repo change, on-demand reservations, `worker_enqueue`,
   per-job fakes, the scheduler and its M1 tasks, the ledger integration test.
3. **Server actions onto the wrappers:** every `"use server"` export calls `lib/ops/*` through
   `runAction` or `remoteAction`; `getClaims()` for the session; i18n keys.
4. **Tests onto the wrappers:** every `supabase/tests` file that calls `public` RPCs as
   `authenticated` rewritten with `opsCall`; the new database tests except the lockdown ones.
5. **Lockdown** (migration `ops_lockdown`, the ACL test and `acl-allowlist.json`, the 6.3.7
   refusal tests, the `rls.test.ts` rewrite) in one commit; tag `m1-floor`. That commit contains
   the step-1 tooling, so production may first deploy here: the one-time cutover (5.3), then
   `ops/deploy.ts --to m1-floor`.
6. **Topology:** `ops/rotate-supabase-keys.ts`, the `install` part of `ops/services.ts` (accounts,
   ACLs, port-owner check), `ops/edge-proxy.ts`, the `cloudflared` template, server-side sign-in
   and the email template, the proxy matcher, loopback binding, README, keepalive removal.
7. **Agents:** `/api/v1`, `/api/mcp`, `apps/auth`, `/consent`, Settings > Agenti, `packages/cli`
   with the stdio bridge and the skill.
8. **Remote enablement:** the owner's DNS and tunnel actions, the tunnel smoke test, `remote_mcp`
   on, the remote exit test.

**Files** (C create, M modify, D delete):

| Area | Files |
| --- | --- |
| workspace | M `pnpm-workspace.yaml` (add `ops`, `apps/auth`), root `tsconfig.json` (references for `ops`, `apps/auth`, `packages/cli`), root `package.json` (`test:db` guard, `postgres` dev dependency), `.github/workflows/ci.yml`, `README.md`; D `.github/workflows/keepalive.yml` |
| ops (package `@mellodifai/ops`, run with `tsx`) | C `ops/package.json`, `ops/stack.ts`, `ops/rotate-supabase-keys.ts`, `ops/rotate-db-passwords.ts`, `ops/rotate-auth-keys.ts`, `ops/check-no-keys.ts`, `ops/set-owner.ts`, `ops/add-user.ts`, `ops/deploy.ts`, `ops/services.ts`, `ops/edge-proxy.ts`, `ops/cloudflared/config.template.yml`; revision 6: `ops/restore.ts`, `ops/cutover.ts`, `ops/sign-in-link.ts`, `ops/probe.ts`, `.githooks/pre-commit` |
| database | C migrations `ops_roles`, `ops_layer`, `spend_ledger`, `ops_lockdown`; `supabase/templates/magic_link.html`; `supabase/tests/ops_acl.test.ts`, `ops_errors.test.ts`, `ops_ledger.test.ts`, `ops_oauth.test.ts`, `ops_lockdown.test.ts`, `acl-allowlist.json`, `helpers/ops-call.ts`; M `supabase/config.toml` (template section, no production values), `supabase/seed.sql`, the ten existing `supabase/tests/*.test.ts` files that call `public` RPCs as `authenticated` |
| web, create | `apps/web/lib/ops/**` (including `tokens.ts`), `apps/web/lib/mcp/**`, `apps/web/lib/db/ops-client.ts`, `apps/web/app/api/v1/**`, `apps/web/app/api/mcp/route.ts`, `apps/web/app/api/health/route.ts`, `apps/web/app/.well-known/oauth-protected-resource/**`, `apps/web/app/consent/**`, `apps/web/app/(app)/settings/agents/**` |
| web, modify | every `"use server"` module (`apps/web/app/actions/**`, `apps/web/app/**/actions*.ts`), `apps/web/lib/run-action.ts`, `apps/web/lib/action-result.ts`, `apps/web/lib/auth.ts`, `apps/web/lib/supabase/server.ts`, `apps/web/proxy.ts`, `apps/web/app/auth/confirm/route.ts`, `apps/web/app/(auth)/login/page.tsx`, `apps/web/lib/redirect-url.ts`, `apps/web/components/login-form.tsx`, `apps/web/app/actions/format-style.ts`, `apps/web/app/api/transcribe/route.ts`, `apps/web/lib/openrouter-key.ts`, `apps/web/lib/rate-limit.ts`, `apps/web/app/(app)/settings/page.tsx` and the settings navigation, `apps/web/next.config.*`, `apps/web/package.json` (`-H 127.0.0.1` on `dev` and `start`), `apps/web/playwright.config.ts`, `apps/web/e2e/global-setup.ts`, `apps/web/e2e/support.ts`, `apps/web/e2e/local-env.ts` |
| auth server | C `apps/auth/**` (including `package.json`, `redirect-allowlist.json`) |
| shared | C `packages/shared/src/ops/**` (`errors.ts`, `reads.ts`, inputs and outputs); M `packages/shared/src/stages.ts` (resource classes), `packages/shared/src/i18n.ts` (`error.*` keys), `apps/web/app/actions/schemas.ts` (re-exports) |
| worker | C `apps/worker/src/providers/paid.ts`, `apps/worker/src/providers/kie-client.ts`, `apps/worker/src/scheduler.ts`, `apps/worker/test/ledger-integration.test.ts`; M `apps/worker/src/db.ts`, `loop.ts`, `main.ts`, `workspace.ts`, `engine.ts`, `authorization.ts`, `fake/index.ts`, `stages/generate-song.ts`, `draft-lyrics.ts`, `lyric-jury.ts`, `replace-section.ts`, `import-audio.ts`, `score-takes.ts`, `timing.ts`, `local-engine.ts`, `source-audio.ts`, `stages/utils.ts`, `apps/worker/test/rewrite.test.ts`, `songs-from-songs.test.ts`; D `apps/worker/src/kie/client.ts` |
| engine repo | M `C:\Users\Asus\Documents\suno-remake\tools\kie.mjs`, `whisper_words.py` and the other key-file readers the plan finds (`MELLODIFAI_ENV_ONLY`; base-URL overrides for the fake servers) |
| cli | C `packages/cli/**` (including `skill/`) |

**New dependencies:** `@modelcontextprotocol/server` (web, already locked at 2.4.0), `postgres`
(web, root dev), `oidc-provider` (auth), `tsx` and `esbuild` (dev). No JWT library.

**Done when:**
- Claude Code over stdio and claude.ai over remote MCP each complete `song_create`, `job_status`
  and `lyrics_approve` with a `test_mode` token on the real instance; their jobs run on fakes and
  create no reservation;
- the ledger integration test (`pnpm test:ledger`, a local Windows gate, revision 6) and the
  ledger database tests pass (counters equal settled spend
  after normal, crash, requeue, retry-later, resume and cancel runs; empty caps refuse; 20 parallel
  reservations on a fresh window stay within the cap);
- the claim-injection test, the other 6.3.7 exit tests, the ACL test and the error-map test pass;
- the OAuth end-to-end tests pass, including the second-browser and reused-nonce refusals and
  `oauth_upsert` refusing a grant without a matching consent;
- the MCP checks of 19 pass on both transports; a revoked PAT and a revoked grant fail on the next
  call;
- a demo-secret JWT is refused; `check-no-keys` passes; the container probe fails for every login
  role with the default password;
- the tunnel smoke test passes;
- `ops/deploy.ts --to m1-floor` succeeds and `--to` an older tag is refused.

### 21.3 M0 (running)

T12; fix the per-song storyboard bug (new songs in an imported project must not reuse its scenes,
thumbnail and metadata: `apps/worker/src/legacy-import.ts`, `stages/draft-lyrics.ts`,
`stages/utils.ts`). **Done when** T12 is merged and a new song in the VBP project gets its own
scenes, thumbnail and title (e2e test).

### 21.4 M2a Remade song, and M2b Remade video

- **M2a:** R1-R4b in Copilot; blueprint and meaning-map schemas; the extended lyric jury and the
  devil's advocate; the originality gate with its Python runtime; source fingerprints; the stage
  orchestrator and state machine; the driver lease and `artefact_submit` for lyrics and blueprint;
  remake defaults; GPU lease, retention and disk guard; golden set v0 with the first canaries.
  Migrations: `remakes`, `jury_reports`, `gpu_lease`. **Done when:** a fixture source runs R1-R4b on
  fakes and stops at each pause point; an agent over MCP authors the lyrics for one run; a known
  close paraphrase fails; the source media are deleted after R2 and the fingerprints remain.
- **M2b:** timeline schema and blocks file, `TimelineVideo`, the kinetic-lyric move, R5, R7 with QA
  on the hook render, `timeline_get` and `timeline_patch`, image submission. Migration `timelines`.
  **Done when:** the fixture runs R5-R7; a timeline containing code, a URL or an unknown block is
  rejected; an agent patches a scene's text and the re-render shows it.
- Each writes its file list (Create and Modify) at the top of its plan before work starts.

### 21.5 M3 Visual quality and images

Visual jury, design rules, distinctness, render fingerprints, the publish gate (10.8), the image
router with the route 2 container, the Nano Banana price research, T18, T15, thumbnails, and the
web timeline editor. Editor scope: a scene list on the take's waveform, drag to retime scene
boundaries, edit text layers, swap a block's look and params, swap an asset, preview with
`@remotion/player`; no keyframes. Calibration (tighten only). Migrations: `images`,
`publish_gate`. **Done when:** R6 and R8 run on the fixture; misspelt text and a safe-area
violation fail; `approve_video` refuses a version missing a required report; the router falls
through on a faked refusal, timeout and usage limit, in order; the route 2 injection test passes.

### 21.6 M4 Publishing

12.2-12.6 in full, T17 ("Aggiungi lingua", "Add language") and T19 per the plan, the project page
hub, `post.` and `/m/`. Migrations: `publish_routes`, `analytics`. **Done when:** a Copilot remake
is scheduled; a veto cancels the bundle in each state; with the worker stopped through the slot,
nothing goes public and the missed-slot rule runs on restart; a Short publishes as a hook render
next to its master; analytics snapshots arrive.

### 21.7 M5 Autopilot, M6 Loop, M7 Premium, M8 Portable runtime

- **M5:** 6.5, flag `autopilot`. Migration `autopilot`. **Done when:** a golden link reaches a
  scheduled bundle without owner action; a faked jury outage stops with `jury_unavailable`; a cap
  stops with `cost_cap`; a `create`-only token cannot select Autopilot; the success criterion holds
  on the golden set.
- **M6:** section 13 after the `main` cutover. Migration `loop`. **Done when:** 7 dry-run nights
  complete; the gate rejects the planted bad candidates of 19; a planted regression is reverted;
  the kill switch stops a night in progress; the sandbox probe aborts a night when a port is opened
  on purpose.
- **M7:** Higgsfield and T14 in the premium tier. **Done when** a premium run stays inside its
  pre-approved budget.
- **M8:** section 25.

## 22. Owner actions and open questions

| Item | Blocks | Who acts | Fallback while pending | Status |
| --- | --- | --- | --- | --- |
| Google Cloud project, OAuth client, consent screen with the four scopes of 12.1 | P0, M4 | owner | publishing stays as today | open |
| YouTube API audit submission | public API route if the lock still applies | owner submits, author prepares | Blotato with verified disclosure | open |
| Move mellodifai.com nameservers to Cloudflare; `cloudflared tunnel login` and `tunnel create` | M1 remote exit | owner (author writes the config) | local stdio only, `remote_mcp` off | open |
| SMTP sender for sign-in codes | M1 remote sign-in | owner | sign-in on the PC only | open |
| Windows accounts `mdf-web` (Next, edge proxy) and `mdf-auth` (`apps/auth`), the NTFS ACLs of 5.1 and the firewall rule of 5.2 (all need administrator rights; `ops/services.ts install` prints the exact commands) | M1 hardening | owner | every service under the owner's account, recorded as an accepted risk in 17 | open |
| kie USD rate per credit | M1 price book | owner | 0.005 USD per credit, `verified = false` | open |
| Separate OpenRouter and Groq keys for Next with a low provider-side credit limit (7.4) | none | owner (recommended) | Next uses copies of the worker's key values | open |
| ntfy app subscribed to the topic | M1 push | owner | in-app notifications only | open |
| Confirm AC10 and AC11 | none (in force) | owner | proceed | open question |
| Gemini API key | M3 route 3 | owner | route 3 off | open |
| kie Midjourney access and price per call | M3 route 1 | owner | route 1 off | open |
| Codex device login inside `mdf-img` | M3 route 2 | owner (one command) | route 2 off | open |
| Evaluation OpenRouter key with a credit limit | M3 calibration, M6 | owner | calibration on the main key within caps | open |
| Blotato API key | M4 fallback | owner | Postiz only | open |
| Veto window length, remake defaults | M4, M5 | owner in Settings | 24 h; defaults of 8.7 | default set |
| Confirm the loop rails (AC6) | none (in force) | owner | in force | open question |
| Comfy Cloud key | M7 | owner | premium without Comfy Cloud | open |

## 23. Constraints

- Owner rules: 2.2.
- Hardware: RTX 3070 8 GB, one GPU job at a time (14.1); Docker Desktop on WSL2 (after power cuts
  it may need its `run` folder reset; never factory reset: it holds the local database, which the
  deploy script backs up).
- Licences: YuE2 non-commercial (owner-only); Remotion free for up to 3 people; Postiz AGPL (run
  unmodified); Audacity code not copied (GPL); UVR models need credit; VideoHive looks rebuilt in
  code, template files never shipped; LaBSE, DINOv2, Tesseract Apache 2.0; pyphen used under MPL;
  fugashi and unidic-lite MIT/BSD; `oidc-provider` MIT; no GPL code in the web app.
- Terms: Suno (no automation of suno.com), Midjourney web (not automated; the kie reseller is the
  owner's accepted risk, OD5), Google Flow (not automated), YouTube (quota, audit, repetitive
  content, AI disclosure always set).

## 24. Left to the builder, and builder notes

Left to the builder: CLI flags beyond 7.4; prompt wording of writers, juries and the devil's
advocate; the beat and section analyser (CPU-only or at most 2 GB of VRAM, no GPL code in the web
app, output filling the blueprint's `music` fields); the Windows service wrapper.

Builder notes:
- yt-dlp needs `yt-dlp-ejs` and `--js-runtimes node`, or video downloads get 403.
- In Git Bash, arguments like `/api/v1` can be rewritten to Windows paths; prefix
  `MSYS_NO_PATHCONV=1`.
- Worktrees go in `E:/mellodifai/wt/`; a new worktree needs the lockfile copied before install.
- The OpenRouter account's privacy filter replaces words with tags like `[PERSON_NAME]`; the lyric
  pipeline detects it (`looksRedacted`), and new juries must too.

## 25. Future: portable runtime (binding rules now, plans later)

Binding now, for every new piece of code:
- No hard-coded Windows paths or drive letters: `MELLODIFAI_ROOT` (default `E:/mellodifai`)
  replaces runtime paths, `MELLODIFAI_ENGINE_ROOT` replaces `ENGINE_ROOT`; the existing hard-coded
  paths listed in section 3 are converted when their file is next touched, and all of them by M8.
- No Windows-only process handling without a POSIX path; engine and model locations from config;
  every external tool through config or PATH.
- Ops scripts are TypeScript on Node with thin OS wrappers (services on Windows now, systemd in
  M8); no duplicated PowerShell and shell copies.
- **Credentials off the owner's PC:** a worker on any machine other than the owner's PC never gets
  the service role. It gets a per-worker scoped credential that can claim jobs and read and write
  only job-scoped storage URLs. The daily loop's release channel is limited to the owner's own
  machines. The release-signing key never enters any loop, gate, proposer or worker context.

Plans for M8 and beyond (not binding): capability-aware queue (workers report GPU, VRAM, disk and
engines; jobs carry requirements), `mellodifai doctor` and installers, signed self-update with
rollback, desktop apps (Tauri is the likely shell), and a Debian GPU server (providers to compare
when the time comes).

## 26. Owner additions of 01/11 evening: where each lands

UI behaviour is specified in the feature plan or in the owner's notes; this list only places them.

- **Per-song storyboard bug** - M0 (21.3).
- **Preview quality** (previews at 1080p; masters 1080p by default, 4K on request; local upscaler
  only for generated footage) - UI track; upscaler with M7.
- **Project page as the publishing hub** with "Aggiungi lingua" ("Add language") - M4 (T17).
- **Thumbnails that convert, not clickbait** (one focal subject, three words or fewer, strong
  contrast, readable small, consistent style, no misleading claims) - M3; learning from analytics
  in M4 and M6.
- **Karaoke mode** like Spotify's (owner's reference screenshots of 01/11) - UI track; the plan
  holds the visual spec.
- **Agents edit songs and videos by talking** - M1 (existing editor operations as tools), M2b
  (timeline tools); the web UI stays fully labelled for computer-use agents.
- **Video editor in the project** - OD6: timeline document (9.2), tools (M2b), web editor (M3).
- **Riffusion/Producer research items** (chat editor over replace-section and extend, "Cambia
  voce" and "Cambia base", "Dalla mia voce allo studio", a free local tier, an optional Lyria
  engine) - Later; the details are in `E:/mellodifai/research/riffusion-producer-report.md`.

## 27. Glossary and references

- **T-ids:** T7 library, T8 player, T9 create panel, T10 playlists and details panel, T11 stems
  and audio editor, T11b UVR-quality vocal removal, T12 songs from songs, T13 Video Studio
  visualizers, T14 Comfy Cloud runtime, T15 brand kit, T16 jingle mode, T17 language and cultural
  adaptation, T18 local images, T19 automatic social sharing, T20 new vocals on an instrumental,
  T21 Audacity-style effects, T22 topic research before lyrics, T25 VideoHive looks.
- **Jev:** `typesafe/jev-1.14`, a decision model on OpenRouter that picks the lyric tone and the
  writer strength.
- **VBP template:** the scene template of the imported "Va bene, passa" project, rendered from the
  engine repo's `motion/`.
- **`score_takes`:** `tools/score_takes.py` in the engine repo, called inside `generate_song` and
  the import stages; `fidelity` is in-order token recall of the intended lyrics.
- **The `/watch` method:** yt-dlp download, frames at scene cuts and 1 fps contact sheets with
  ffmpeg, transcript from captions or Whisper.
- **Devil's advocate:** a model prompted to argue that a draft must not pass (10.2).
- **Golden set, canaries:** 13.4. **Copilot, Autopilot, tier:** 8.1. **Console:** 8.4.
- **PAT:** 6.6. **Ledger:** 11.5. **Veto window:** 12.2. **Ops layer, `mdf_web`, `mdf_auth`:** 6.3.
- **Blueprint, meaning map, timeline document, blocks:** section 9.
- **Engine repo:** `C:\Users\Asus\Documents\suno-remake`.
- **Task-24 brief:** `docs/egm/v2-local-engines/task-24-brief.md` (the first remake-tool brief;
  its line 18 still says `packages/remake` and should say `packages/shared/src/remake/`).
- **UI strings** are Italian with English glosses at first use, for example Settings > Agenti
  ("Agents") and "Formatta con AI" ("Format with AI").

Research this design relies on (`E:/mellodifai/research/`, owner's PC):
`riffusion-producer-report.md` (Producer became Google Flow Music on Lyria; source of the Later
items), `hyperframes-vs-remotion.md` (behind OD6), `videohive/videohive-catalogue.md` (70 looks from
the owner's VideoHive packs; source of T25), `channel/channel-report.md` (the channel's house
style, source of the Classico preset).

## 28. Review resolution

Five goldfish rounds reviewed this document; round 5 was the last, and what it left became either
a revision-6 edit (28.00) or a plan task. Revisions 2 to 4 each overclaimed: round 2 found 13 of 17 round-1 Blockers only partly
resolved, round 4 found round-3 Blockers 2-5 and five other round-3 items only partly closed, and
every round found new Blockers in text the previous revision had added. Revision 5 therefore
**shrinks M1** (everything agent access does not need moved to M2a or W1, listed in 21.2) and
applies the coordinator's rulings on round 4's Blockers as written. "Partly" names what remains.

### 28.00 Revision 6 changelog (round 5, final; `docs/egm/agentic-studio/goldfish_review_round5_m1.md`)

Round 5 found 1 Blocker, 27 Majors and 33 Nits and was the last review: nothing goes back for
another round. Revision 6 changes:

- **Blocker 1 (coordinator's ruling, applied as written).** The ops tooling (`ops/deploy.ts`,
  `ops/check-no-keys.ts`, `ops/set-owner.ts`, `/api/health`, the CI wiring and the provisioning of
  the `mdf_web` and `mdf_auth` login passwords) moves into step 1 of 21.2, before any commit
  creates a `nologin` role or locks anything down. `m1-floor` stays on the lockdown commit (step 5),
  which now contains that tooling, so "`ops/deploy.ts --to m1-floor` succeeds" holds there. Steps
  3 and 4 stay green on their own. Only the order changed. To make the floor deployable, step 1
  also carries what that first deploy needs: the prod stack render with its `project_id` and port
  block, the cutover, the restore and the start, stop and `acl` parts of `ops/services.ts`; and
  `deploy.ts` runs from a pinned copy of the current `ops` package on a dedicated deploy clone,
  skipping `apps/auth` when the target has none (20).
- **Design decisions from the Majors** (each marked "revision 6" where it lives): deploy clone,
  runtime-root ACLs and the `icacls` probe (5.1, Major 1); Studio, mail catcher and analytics off
  in production, sign-in-link fallback (5.2, Major 2); `stack_settings.fake_stack`,
  `mdf.force_caps`, the reset of settings and UTC in every `ops` function (6.3.4, 5.3, 6.9,
  Major 3); the ledger test arrangement and `pnpm test:ledger` as a local gate (11.5, Major 4); the
  resume predicate (11.5, Major 5); reservations remember the kie submit and generation (11.5, 15.1,
  Major 6); attempt numbers in call keys and an extension per extra attempt (11.5, Major 7); the
  entry bound and an unclamped settle (11.5, 15.1, Major 8); the close trigger (11.5, 15.1,
  Major 9); a refused extension in `draft_lyrics` finishes with an incomplete jury (11.5,
  Major 10); the `MDF` table (6.3.5, 6.6, Major 11); `oauth_upsert` matched through the grant
  (6.4, 17, Major 12); the interaction URL served by `apps/auth` and `oauth_flow_nonce_set` (6.4,
  Major 13); reconnecting revokes the old grant (6.4, Major 14); the 6-digit code at `/login` (5.4,
  Major 15); per-environment issuer and the three-server OAuth e2e topology (5.3, 19, Major 16);
  per-environment `project_id` and port blocks, the cutover and the reset refusal (5.3, Major 17);
  the request-origin redirect and dev on 3001 (5.3, 5.4, Major 18); restore by database reset
  (20, Major 19); passwords and the probe on every start (5.3, Major 20); the trigger on
  context-free updates (6.3.4, Major 21); the test rewrite wording (19, 21.2, Major 22); daily
  limits for the web-side tools (6.7, 15.1, Major 23); the three missing wrappers (6.3.6, Major 24);
  the existing guards kept (11.5, Major 25); the port-owner check and its residual risk (5.1, 17,
  Major 26); the pairing window closed by the first registration and loopback clients consenting
  only locally (6.4, 15.1, Major 27).
- **Settled rulings of revisions 1-5 were not reopened.**
- **Nits:** none changes the design; each is applied inside a plan task or listed under "Parked
  nits" in the plan.

**Where each round-5 finding is built:** the table "Major to task" at the end of
`docs/superpowers/plans/2026-11-02-m1-agent-access.md`.

### 28.0 Round 4 findings (`docs/egm/agentic-studio/goldfish_review_round4_m1.md`)

**Blockers: rulings by the coordinator, applied as written.**

| Id | Ruling | Where applied |
| --- | --- | --- |
| Blocker 1 | One reservation per job, holding several spend entries keyed by call; it never expires while the job is queued or running; resume, requeue and the in-stage kie balance check reuse the job's reservation; the worker settles subprocess calls through `ops.settle_spend` by entry id; expiry applies only to orphaned reservations (job finished or deleted) and never releases settled spend. | 11.5 (model, functions, call keys, free calls, close rule, orphans only), 15.1 (`reservations`, `spend_entries`), 21.2 (ledger integration test in the done-when) |
| Blocker 2 | The wrappers set and clear both claim forms (`request.jwt.claims` and `request.jwt.claim.sub`, plus `claim.role`) in the same transaction; a database test shows a preset `request.jwt.claim.sub` cannot act on another user's rows. | 6.3.4 steps 4-5 (and `auth.uid() = actor` asserted), 6.3.7 claim-injection test |
| Blocker 3 | The cap defaults move into a migration, not seed data; `reserve_job` fails closed when no cap row matches; a database test with an empty `spend_caps`. | 11.5 (defaults table, fail closed, test), 15.1 (`spend_ledger` seeds) |
| Blocker 4 | The signing key lives outside the checkout under the secrets folder, readable only by the owner account (and `apps/auth`'s own keys only by the owner and `mdf-auth`); nothing under the repo holds key material; a check fails when `signing_keys.json` or any jwks file is inside the working tree. | 5.1 (accounts and ACLs), 5.3 items 1-2 (rendered stack folders, `ops/check-no-keys.ts`) |
| Blocker 5 | `apps/auth` runs as its own Windows account `mdf-auth`, in the owner-action list next to `mdf-web`; `ops.oauth_upsert` issues a token only for a grant that matches a stored consent row (client, uid, scopes, flow nonce), with a database test. | 5.1, 6.4 (storage rules), 22, 17 |
| Blocker 6 | The email template and `emailRedirectTo` come from per-environment config (`SITE_URL`), with local, e2e, CI and production values listed. | 5.3 item 1 (table), 5.4 (template `{{ .RedirectTo }}`, per-request redirect) |
| Blocker 7 | The consent is bound to the flow by a random nonce in an `HttpOnly`, `SameSite=Lax` cookie set when the flow starts; resume requires the same cookie; the nonce is single use. | 6.4 (flow binding), 15.1 (`oauth_consents.flow_nonce_hash`, `used_at`), 19 (second-browser and reuse tests) |
| Blocker 8 | Spike 2 lists every login role in the Supabase image; the mandatory change rotates all of them (`postgres`, `supabase_admin` and the other login roles); the exit probe tests every login role with the default password. | 5.3 item 3, 21.2 step 0 and done-when |

**Majors** (31 fixed, 1 partly, 3 moved to M2a):

| Id | Disposition |
| --- | --- |
| 1 | Fixed in 6.3.2: the global `alter default privileges ... revoke execute on functions from public`; comment corrected. |
| 2 | Fixed in 6.3.3: column privileges, schema USAGE in every non-system schema, `storage.objects` policies, `pg_auth_members`. |
| 3 | Fixed in 6.3.2: `service_role` keeps its grants and `acl-allowlist.json` lists them. |
| 4 | Fixed in 6.3.2: `playlist_membership(uuid[])`; no policy calls a `public` function, so only the six read RPCs are re-granted. |
| 5 | Partly: session recency (65 minutes), production timebox and inactivity timeout, `getClaims()`, `remote_mcp` and token `remote` enforced in the database, spike 2 confirms the `auth.sessions` read. Remains: no step-up code for admin operations in M1 (my call; the residual risk is written in 17). |
| 6 | Fixed in 11.5: fallback per `(provider, unit, period)`. |
| 7 | Fixed in 11.5: exact-then-`''` price lookup, `MDF05` when missing, the `draft_lyrics` estimate with Jev and the strong writer, call keys instead of claims by model, `KIE_CREDITS` reused, pinned test prices. |
| 8 | Fixed in 11.5 and 15.1: each reservation stores the exact counter rows and windows it charged. |
| 9 | Fixed in 11.5: the right submit-state table per stage, synchronous `mark_ambiguous`, cancel by the same close rule. |
| 10 | Moved to M2a: the web-side tools are not metered in M1 (7.4), so their reserve and settle path goes with them; Next's keys get a provider-side limit. |
| 11 | Fixed in 6.4 and 6.6: every token gets its cap row at creation; a token without one is refused. |
| 12 | Fixed in 6.3.4: the `jobs_stamp_ctx` trigger stamps inserted and re-queued rows; test tokens are refused on real versions. |
| 13 | Fixed in 6.2: tokens and consent are admin-only in M1, with an exit test. |
| 14 | Fixed in 6.2: `create` may reserve bounded incidental Groq transcription, counted against the caps. |
| 15 | Fixed in 5.4: `ops/add-user.ts` creates allowlisted users; inviting from Settings is M2a. |
| 16 | Fixed in 15.1: a column-level grant on `agent_tokens` (no view), `using (true)` policies for `price_book` and `app_flags`; `provider_operations` gets no grant. |
| 17 | Fixed in 6.4 and 15.1: payloads stored without `jti`; the spike confirms the adapter. |
| 18 | Fixed in 6.3.5: `owned % required` and related messages map to `not_found`; the error test follows the call graph from `pg_proc`; `JobStatus` carries the redacted error text instead of a code. |
| 19 | Fixed in 6.3.1: role creation guarded by an existence check. |
| 20 | Fixed in 7.3: every read field has its source column and transform; unsourced fields (duration, engine, error code) dropped. |
| 21 | Moved to M2a: token uploads (and the `upload_intents` table, ingestion and their limits). |
| 22 | Fixed in 5.2 and 7.3: path, input, output, scope and key for every token operation; `/api/v1` PAT only, `/api/mcp` PAT or OAuth, no cookies. |
| 23 | Fixed in 6.3.4 and 7.2: the key is deleted on failure in the same transaction; `request_hash` defined; the database requires a key from token actors. |
| 24 | Fixed in 7.1: `@modelcontextprotocol/server` 2.4.0, per-request instances, default 4 MiB body (no uploads in M1). |
| 25 | Fixed in 6.4: issuer, discovery paths served by `apps/auth`, default opaque tokens without a prefix, interaction URL and resume route, `proxy: true`. |
| 26 | Fixed in 11.5: `MELLODIFAI_ENV_ONLY` set after `childEnvironment`, `KIE_ENV` refused, corrected call map, complete `PAID_SECRET_NAMES`, key reads moved into `providers/`; whether `workspace_pipeline.sh` pays is a builder decision with a default. |
| 27 | Moved to M2a with the web-side tools' token exposure. |
| 28 | Fixed in 6.4 and 20: `remote_mcp` checked in the database; the remote kill is the Cloudflare dashboard (README); enablement order fixed. |
| 29 | Fixed in 5.1: the dev server binds loopback; containers on the PC count as local by design, stated. |
| 30 | Fixed in 6.4 and 17: registration only in an admin pairing window, registration time shown, a new risk row. |
| 31 | Fixed in 19: CI flags and ports, `playwright.config.ts` and `support.ts` in the Modify list, `app.fake_stack` so e2e jobs never meet caps. |
| 32 | Fixed in 7.1 and 21.2: test imports, workspace and tsconfig wiring, `@mellodifai/ops` with `tsx`, CLI bundle and pack, the missing files; the credits page overlap disappears with Settings > Costi moving to M2a. |
| 33 | Fixed in 21.2 and 20: a green step order (additive, worker, actions, tests, lockdown), the `m1-floor` tag, services stopped before migrating, a smoke write in the health check, a documented restore. |
| 34 | Fixed in 14.4 and 6.9: one SQL body per task with its grant, stale-claim takeover, DST rule; a child's refused reservation fails the parent with `cap_exceeded`. |
| 35 | Fixed in 6.4 and 6.6: Settings > Agenti contents and the consent-info shape; Settings > Costi moved to M2a. |

**Nits:** fixed: 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 18, 20, 22, 23, 24 (in the
sections named by each finding's scope); moved to M2a: 17 (large uploads), 19 (upload reuse), 21
(worker watchdog, with notifications).

### 28.1 Round 3 findings, corrected after round 4

Revision 4 marked every round-3 finding fixed. Round 4 showed these were only partly closed; their
corrected state:

| Id | Corrected disposition |
| --- | --- |
| Blocker 1 | Partly closed in revision 4 (the legacy `claim.sub` path stayed open); closed in revision 5 by round-4 Blocker 2. |
| Blocker 2 | Partly closed in revision 4 (the per-schema PUBLIC revoke is a no-op; the ACL test missed column grants); closed in revision 5 by round-4 Majors 1 and 2. |
| Blocker 3 | Closed in schema only in revision 4 (defaults were seed-only and `reserve_spend` failed open); closed in revision 5 by round-4 Blocker 3. |
| Blocker 4 | Not closed in revision 4 (the per-call claim model could not run the stages; expiry erased spend); replaced in revision 5 by round-4 Blocker 1's model. |
| Blocker 5 | Mechanism closed in revision 4, shapes and contracts open; closed in revision 5 by round-4 Majors 20 and 22, with token uploads moved to M2a (round-4 Major 21). |
| Major 5 | Revision 4's fix created round-4 Blocker 1; superseded by it. |
| Major 10 | The failure path was missing in revision 4; closed by round-4 Major 23. |
| Major 19 | Held only at database level in revision 4; closed by round-4 Blocker 5 (`mdf-auth` account, consent-matched `oauth_upsert`). |
| Major 20 | The password change covered only `postgres` in revision 4; closed by round-4 Blocker 8. |
| Nit 7 | "Customers hold no tokens" was contradicted by consent in revision 4; closed by round-4 Major 13. |
| All other round-3 items | As fixed in revision 4, except where round 4 replaced the text (the gates move, notifications, uploads and the keyring now belong to M2a). |

### 28.2 Round 2 findings

| Id | Disposition |
| --- | --- |
| R2-B1 | Partly closed by revision 3 (round 3); closed in revision 4 by round-3 Blockers 1, 2, 4 and Major 1 (28.1). Revision 3 text: resolved in 6.3: exact revokes (jobs insert grant and policy, versions grants, every public function), deny-by-default EXECUTE, `mdf_ops` and schema `ops`, reservation inside the wrapper transaction, worker refusal without a reservation and the paid-call module (11.5), cookie-only admin-only publishing until M4, exit tests. |
| R2-B2 | Residue found by round 3 (Major 8), closed in revision 4 (28.1). Revision 3 text: resolved in 3 (corrected) and 6.2: `admin_allowlist.role` default `customer`, trigger change, backfill with the owner check, database test (21.2). |
| R2-B3 | Resolved in 10.1 and 13.3-13.7: every gate, threshold, judge prompt and router or cap constant moved to denylisted `packages/gates/**` and `config/gates/**`, so step 1 is a pure path check; deterministic canaries must still be rejected; revert signals scored by the frozen evaluator. |
| R2-B4 | Resolved in 13.1-13.2: sandbox on an `--internal` network with no socket and no credentials, scorer without candidate code, merger on the host with the only push right, supervisor-started gate stack, probe that aborts the night, firewall rule (5.2), Postgres password spike (5.3). |
| R2-B5 | Resolved in 11.3 and 6.8: route 2 runs only in the `mdf-img` container with an output folder, read-only sandbox, egress allowlist, prompts from enums and `Safe` fields, single-image acceptance, injection test. |
| R2-M1 | Resolved by design in 6.4: opaque tokens from `apps/auth` cannot reach Supabase; discovery on the app host; scopes in our grant row; step 0 spike with a written fallback that includes the round-2 recommendations. |
| R2-M2 | Resolved in 6.3: no signing key in Next at all; `mdf_ops` role with only `ops.*` EXECUTE; token lookups and audit writes in narrow security-definer functions; env var named. |
| R2-M3 | Resolved in 5.4: `SUPABASE_INTERNAL_URL`, server-side sign-in in M1, per-request browser URL and pinned cookie name in W1 after the DNS move, server-made signed URLs replaced by `/media`, files listed in 21.2. |
| R2-M4 | Resolved in 6.2, 6.3 and 7.3: `publish` not grantable before M4; `uploadPrivate` and `setPrivacy` cookie-only and admin-only. |
| R2-M5 | Resolved in 6.2 and 6.5: Autopilot needs an admin cookie session or spend plus publish; initiating token's caps apply; M5 exit test. |
| R2-M6 | Resolved in 11.5 and 15.1: `user` cap scope with role defaults, `run_id` without foreign key until M2a, price seeds and sync, the list of reserving RPCs, settle by `job_id`. |
| R2-M7 | Resolved in 7.3: every existing server action listed with tool, RPC, scope, estimate and milestone; cookie-only rows; schema naming rule in 7.1; response shapes in 7.2; M1 CLI and skill limited to M1 operations (7.4); `create_song` named correctly in 3. |
| R2-M8 | Resolved for M1 in 21.2 (Create and Modify list, dependencies, `/m/` moved to M4); partly for M2-M6: each must write its file list before planning (21.4). |
| R2-M9 | Resolved for M1 (DDL in 15.1, RLS and grants rule); stage orchestrator and `jobs.stage_run_id` defined in 8.3; partly: M2+ DDL is written in each milestone's plan (15.2). |
| R2-M10 | Resolved in 6.6 (format, entropy, hash, hint, expiry). |
| R2-M11 | Resolved in 7.1, 7.2 and 7.4 (MCP SDK in stateless mode, protocol revision floor, keyring library, install commands, `idempotency_key` input). |
| R2-M12 | Resolved in 19 and 21.2: per-job fakes through `test_mode` tokens on the real instance. |
| R2-M13 | Resolved in 5.2 and 5.5: no Access or WAF in M1; tunnel steps and file locations; double sign-in gone. |
| R2-M14 | Resolved in 21.2 and 20: `ops/deploy.ts` with rollback is built in M1 step 1. |
| R2-M15 | Resolved in 14.4: worker scheduler, table, claim function and the task list with cadences. |
| R2-M16 | Resolved in 5.2 and AC15: M1 exposes only MCP, OAuth and sign-in; Supabase, UI, `post.` and `/m/` move to W1 and M4. |
| R2-M17 | Partly resolved in 11.6 and 13.4: complete budget table with its basis, smaller visual jury input, eval cost formula with k = 2 and two arms; remains: real prices (kie Midjourney, Haiku vision) are measured in M3, with the stated first cut if over budget. |
| R2-M18 | Resolved in 8.1: free tier allows juries and app reasoning up to 0.03 USD per run; "local reasoning" removed. |
| R2-M19 | Resolved in 8.4 (R2) and 10.3: transcript, word timestamps, literal translations and source fingerprints kept; translation by Gemini Flash; LaBSE for the section check. |
| R2-M20 | Resolved in 10.8: required reports per content kind. |
| R2-M21 | Resolved in 10.1: dual-write from M2a, UI moved in M3, column dropped later by a human migration. |
| R2-M22 | Resolved in 12.1 and 12.5: render-addressed publish stage, lookups by publication, `scheduled` path retired, `yt.py` scopes and token location. |
| R2-M23 | Resolved in 14.1: `jobs.priority`, lease timing, R2 split into two jobs, supervisor holding the lease for evaluation. |
| R2-M24 | Resolved in 13.1 and 13.7: supervisor and merger hold the credentials; watch extended to 3 runs or 7 days; nightly canary jobs. |
| R2-M25 | Resolved in 8.7 and 15.2: `remake_defaults` in M2a; Italian sources default to an Italian rewrite. |
| R2-M26 | Resolved in 9.3: v1 blocks and params; the file is created first in M2b. |
| R2-M27 | Resolved in 8.4 (R4): per-provider mapping, post-generation timing check as a failed round, metric renamed to lyric recall at least 0.75. |
| R2-M28 | Resolved in section 4, goal 4. |
| R2-M29 | Resolved in 12.5 (T19 linked, route choice kept) and 26 (placements only). |
| R2-M30 | Partly resolved in 12.6: task name, token location, `thumbnail_style` column; remains: availability of per-video impressions and CTR in the API is checked as the first M4 step, with a stated fallback. |
| R2-M31 | Resolved in 25 (credentials off the PC, loop channel, signing key). |
| R2-M32 | Resolved in 12.1 and 21.1: track P0 starts now. |
| R2-M33 | Resolved in 21.1 and 21.4: M2 split into M2a and M2b; previews to the UI track; Anthropic client to Later. |
| R2-M34 | Resolved in 25 and 18: ops scripts in TypeScript on Node. |
| R2-M35 | Partly resolved: meaning-map schema (9.1), Python runtimes and counters (8.4, 10.3), kinetic components (9.3), golden source (13.4), Tesseract and imagehash and DINOv2 runtimes (10.3, 10.4), editor scope (21.5), Autopilot start and daily limit (6.5), images, proxy, scanner, runner and cutover (13.1, 13.2, 13.6). Remains: exact container image digests and the Squid allowlist file, written in the M6 plan. |
| Nit 1 | Resolved: customers 0 kie credits (6.2, 11.5). |
| Nit 2 | Resolved: `song_create` and `remake_start` need `spend` (6.2, 7.3). |
| Nit 3 | Resolved: remote detection by the edge proxy header, not the Host (5.1, 6.6). |
| Nit 4 | Resolved: maximum plus mean (10.6). |
| Nit 5 | Resolved: link created at hand-off (5.4). |
| Nit 6 | Resolved: enums, `Safe` strings, refinements, contact-sheet tiling (9.1, 8.4). |
| Nit 7 | Resolved: `held_gate_failed` state, notification, veto until the flip (12.2). |
| Nit 8 | Resolved: kie submit timeout is `ambiguous_spend`, never retried (8.6). |
| Nit 9 | Resolved: Inspector CLI commands (19). |
| Nit 10 | Resolved: sliding window, write definition, idempotency mismatch and in-flight (6.7, 7.2). |
| Nit 11 | Resolved: ntfy server, env var, sender, payload rules (16). |
| Nit 12 | Resolved: `post.` in M4, Settings routes (21.2), `/api/health` (5.6), flag caching (15.1), `song_create` scope (6.2). |
| Nit 13 | Resolved: `score_takes` described as a function (3, 8.3, 27). |
| Nit 14 | Resolved: current `claim_job` cited and extended (3, 14.1). |
| Nit 15 | Resolved: stage registration and `STAGE_STATUS` (3, 8.3); `art` and `visual_jury` statuses (8.3). |
| Nit 16 | Resolved: the existing 15 s heartbeat is used (3, 8.5). |
| Nit 17 | Resolved: hard-coded paths listed (3, 25); remake folder under the workspace root (8.3). |
| Nit 18 | Resolved: allowlist uses `viz-looks.ts` (13.3). |
| Nit 19 | Resolved: `test:db` reuses the e2e guard (13.2, 21.2). |
| Nit 20 | Resolved: the gate checks by render (10.8). |
| Nit 21 | Resolved: keepalive workflow deleted in M1 (2.4, 21.2). |
| Nit 22 | Resolved: rendering reuse named, QA on the hook render (8.4 R7). |
| Nit 23 | Resolved: no `publications.kind`; thumbnails are not publications (12.5). |
| Nit 24 | Resolved: `create_song` (3, 7.3). |
| Nit 25 | Resolved: this section rewritten with honest states and corrected references. |
| Nit 26 | Resolved: the blockquote line and long prose lines fixed. |
| Nit 27 | Resolved: `golden_items` table dropped; the manifest is the only source (13.4). |
| Nit 28 | Resolved: `rate_counters` dropped; the in-memory limiter is reused (6.7). |
| Nit 29 | Resolved: `loop/main` dropped (13.6). |
| Nit 30 | Resolved: claim report placed in M4 with a catalogue row (7.3, 12.5). |
| Nit 31 | Resolved: sections 25 and 26 keep rules and placements only. |
| Nit 32 | Partly resolved: glossary path for the brief and the "Formatta con AI" gloss added; remains: the one-line fix in `task-24-brief.md:18` itself, not made here because this revision may change only this file. |
| Nit 33 | Resolved: the M1 contents checklist (21.2). |

### 28.3 Round 1 findings

| Id | Disposition after revision 3 |
| --- | --- |
| B1 | Resolved (revision 2, confirmed by round 2); refined in 5 (smaller M1 surface). |
| B2 | Resolved through R2-B3. |
| B3 | Resolved through R2-B4. |
| B4 | Resolved (confirmed by round 2); `publish` before M4 through R2-M4. |
| B5 | Resolved (confirmed by round 2); blocks through R2-M26. |
| B6 | Resolved through R2-B2 and the `mdf_ops` design (6.3). |
| B7 | Resolved through R2-M1 (own authorization server). |
| B8 | Resolved through R2-B1 and R2-M6. |
| B9 | Resolved through R2-B1 (no immediate publish for tokens; admin click only until M4) and 12.2. |
| B10 | Partly resolved through R2-M9: orchestrator and stage-job link defined; M2a DDL is written in its plan. |
| B11 | Resolved (confirmed by round 2); refinements through Nit 6. |
| B12 | Resolved through R2-M19 and R2-B3. |
| B13 | Resolved through R2-M24 and R2-M14. |
| B14 | Partly resolved through R2-M8: complete for M1; later milestones write their file lists before planning. |
| B15 | Resolved through R2-M7, R2-M11. |
| B16 | Resolved through R2-M23. |
| B17 | Resolved through R2-M22 and R2-M32. |
| M1, M2, M3, M4, M8, M9, M10, M13, M14, M15, M17, M18, M20, M21, M22, M23, M24, M25, M26, M28, M31 | Resolved (confirmed by round 2). M24's security gap is R2-B5, resolved. |
| M5 | Resolved through R2-M28. |
| M6 | Partly resolved through R2-M17 (prices measured in M3). |
| M7 | Resolved through R2-M17 (eval formula). |
| M11 | Resolved through R2-M26. |
| M12 | Resolved through R2-M25. |
| M16 | Resolved through R2-M18. |
| M19 | Resolved through R2-M14. |
| M27 | Resolved through R2-M27. |
| M29 | Partly resolved through R2-M15 and R2-M30 (API metric availability checked in M4). |
| M30 | Resolved through R2-M29. |
| N1 | Resolved (stateless MCP chosen, 7.1). |
| N2 | Resolved (6.7). |
| N3, N4, N6, N8, N9, N10, N11, N12, N13 | Resolved (confirmed by round 2). |
| N5 | Resolved (8.4 R7). |
| N7 | Resolved (24). |

**Counts:** round 2: 73 findings: 67 resolved, 6 partly resolved (R2-M8, R2-M9, R2-M17, R2-M30,
R2-M35, Nit 32), 0 rejected. Round 1: 61 findings: 57
resolved, 4 partly resolved (B10, B14, M6, M29), 0 rejected.
