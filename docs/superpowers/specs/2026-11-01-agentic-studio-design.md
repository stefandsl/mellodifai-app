# MellodifAI Agentic Studio - master design

- **Date:** 2026-11-01, revised 2026-11-02. **Revision:** 4. It answers three goldfish reviews:
  `docs/egm/agentic-studio/goldfish_review_report.md` (round 1),
  `docs/egm/agentic-studio/goldfish_review_round2.md` (round 2) and
  `docs/egm/agentic-studio/goldfish_review_round3_m1.md` (round 3, M1 only). Section 28 gives the
  disposition of every finding.
- **Status:** M1 is ready to plan from sections 5, 6, 7, 11.5, 14.4, 15.1, 16, 19, 20 and 21.2
  (21.2 is the single checklist). M2-M6 have
  their contracts here; each needs its file list written before it is planned (section 21).
  Owner decisions (section 2.1) are final. Author's calls (section 2.3) hold until the owner
  overrules them.
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
| AC2 | Remote MCP authorization uses a **small authorization server of our own** (`apps/auth`, built on the `oidc-provider` library) that issues **opaque** tokens, so OAuth tokens can never be used against Supabase. Fallback if the M1 spike fails: the same service on `@node-oauth/oauth2-server` with the same opaque tokens (6.4). | in force (changed in revisions 3 and 4) |
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
| AC15 | In M1 the tunnel exposes only what remote agents need (5.2); the remote web UI for family and friends is a separate later step (W1, 21.1). | in force (new in revision 3) |

### 2.4 Rules of the 31/10 design that this document supersedes

| 31/10 rule | New rule | Replacement control |
| --- | --- | --- |
| Going public is a separate, explicit click per video (31/10 sections 2, 3). | Kept until M4; then auto-schedule with veto window (OD3). | Until M4: admin-only, cookie-only `confirm_publication` (6.3). From M4: publish gate (10.8), app-owned clock (12.2), Autopilot policy row (6.5), flag `auto_publish_public` (20). |
| Every kie generation needs a confirm click (31/10 section 8). | Copilot keeps the click; Autopilot replaces it. | `reserve_spend` caps inside the RPCs (11.5) and the Autopilot policy row. |
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
grants still in place: INSERT on `projects` (`core.sql:236`; update and delete were revoked in
`final_fixes.sql:2`) and `update (status)` on `jobs` with the policy "owners cancel queued jobs"
(`security.sql:31,47-51`). `versions.lyric_pack` UPDATE was already revoked (`web_flow.sql:8`).
`create_allowlisted_profile` is one function behind two triggers (on insert and on email
confirmation), and `[auth] enable_signup = false` (`config.toml:177`). Supabase's own default
privileges grant `anon` and `authenticated` on new objects created by `postgres`
(`final_fixes.sql:79-81`), which is why existing migrations revoke function by function.
Today PostgREST is reachable only on the PC, so this is safe; once anything Supabase is reachable
from outside it is not, which is why M1 changes it first (6.3). The web app writes nothing to tables directly: every write is an RPC from a server action through `runAction`
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
engine repo, called inside `generate_song`, `import-audio.ts:66` and `local-engine.ts:570`; its
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
session, and redirects to the storage host (`127.0.0.1:54321`). Some pages build signed URLs on the
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
- spending money without the cost shown and within caps - `reserve_spend` inside every paying RPC
  and every paid call in a stage (11.5);
- publishing a video that failed a required gate or has broken text, wrong lyrics, or silence -
  database publish gate (10.8);
- mass-produced sameness - distinctness gate (10.6);
- automating services whose terms forbid it: suno.com generation, the midjourney.com web UI,
  Google Flow, crawling. Two user-initiated fetches are allowed: the analysis-only download of a
  source the owner names (AC10) and the existing import of the owner's own Suno share links
  (`app/api/suno-link`, T12).

## 5. Deployment topology and what the tunnel exposes

### 5.1 One production topology (AC1)

Production is the owner's PC, with these services:

| Service | Listens on | Runs as | Notes |
| --- | --- | --- | --- |
| Next (`next start -H 127.0.0.1 -p 3000`) | `127.0.0.1:3000` only | Windows account `mdf-web` (owner action; fallback: the owner's account) | `mdf-web` cannot read `apps/worker/.env.local` or `<runtime root>/secrets/` (NTFS ACL). It has its own env file `apps/web/.env.local` (7.5). |
| Remote edge proxy (`ops/edge-proxy.ts`) | `127.0.0.1:3080` only | `mdf-web` | Only `cloudflared` talks to it. It enforces the path allowlist of 5.2, the `Next-Action` rule of 5.2, the rate limits of 6.7 for `/oauth/*` and `/login`, sets `x-mdf-remote: 1` on every request (overwriting any incoming value) and forwards to 3000 or 3010. |
| Authorization server (`apps/auth`, bound with `HOST=127.0.0.1`) | `127.0.0.1:3010` only | `mdf-web` | 6.4. Connects to Postgres as `mdf_auth`. |
| Worker | none | owner's account | Needs the codex login, ComfyUI, the GPU and the engine repo. |
| Supabase (Docker) | `127.0.0.1:54321-54329` | Docker Desktop | Never tunnelled in M1 (5.2). Studio disabled in production (`[studio] enabled = false`). |
| Postiz (Docker) | `127.0.0.1:4007` | Docker Desktop | Tunnelled from M4. |
| `cloudflared` | outbound only | service | Locally managed tunnel (5.5). |

**Remote detection fails closed.** Next and `apps/auth` treat a request as remote when any of
`x-mdf-remote: 1`, `cf-connecting-ip` or `cf-ray` is present. Because both bind only to
`127.0.0.1`, a request without these headers can only come from the PC itself.

Services are started by `ops/services.ts` (a TypeScript script run with Node, registered as
Windows services through a thin wrapper chosen by the builder; systemd units in M8). Start order:
Docker and Supabase, worker, auth server, Next, edge proxy, `cloudflared`. The dev server (port
3001) is never tunnelled. Vercel plus hosted Supabase is retired; M1 rewrites the README deploy
section and deletes `.github/workflows/keepalive.yml`.

Prerequisite (owner action, section 22): move the mellodifai.com nameservers from Hostinger to
Cloudflare (free plan) and create the tunnel. Until then the remote half of M1 cannot pass its
exit test; the local half can.

### 5.2 Public hostnames and routes (deny by default)

The `cloudflared` ingress points every public hostname at the edge proxy (`127.0.0.1:3080`); the
edge proxy enforces the path allowlist below and returns 404 for anything else, and the
`cloudflared` ingress ends with `http_status:404`.

| Step | Hostname | Allowed paths | Upstream |
| --- | --- | --- | --- |
| M1 | `app.mellodifai.com` | `/api/mcp`, `/api/v1/*`, `/.well-known/oauth-protected-resource*`, `/login`, `/auth/confirm`, `/consent`, `/api/health`, `/_next/static/*` | Next |
| M1 | `app.mellodifai.com` | `/.well-known/oauth-authorization-server*`, `/.well-known/openid-configuration`, `/oauth/*` | `apps/auth` |
| W1 (later) | `app.mellodifai.com` | every UI page | Next |
| W1 (later) | `api.mellodifai.com` | `/auth/v1/*`, `/rest/v1/*`, `/storage/v1/*`, `/realtime/v1/*` | Supabase gateway |
| M4 | `app.mellodifai.com` | `/m/*` (capability media links) | Next |
| M4 | `post.mellodifai.com` | the Postiz paths listed in the M4 plan (admin UI, social OAuth callbacks, public uploads) | Postiz |

**Server actions through allowed pages.** Next dispatches server actions by the `Next-Action`
header on a POST to any page, so an allowed page such as `/login` could otherwise reach every
action. Two locks, both in M1:
1. The edge proxy rejects (403) any request that carries a `Next-Action` header unless the path is
   `/login` or `/consent`.
2. Every server action runs through `runAction` or `remoteAction` (`apps/web/lib/run-action.ts`).
   `runAction` refuses (code `forbidden_scope`) any call made remotely (5.1). `remoteAction` is used
   only by the sign-in actions (`sendSignInLink`) and the consent actions (`consentDecide`). A unit
   test fails if an exported function in `apps/web/app/**/actions*.ts` or `apps/web/app/actions/**`
   is not wrapped by one of the two.

`next.config` sets `experimental.serverActions.allowedOrigins` to `app.mellodifai.com`,
`127.0.0.1:3000` and `localhost:3000`, because the edge proxy changes the forwarded host.

In M1 nothing of Supabase is reachable from outside: sign-in for the consent page happens through
Next (5.4), and remote agents use only `/api/mcp`, `/api/v1` and the OAuth endpoints. No
Cloudflare Access is used in M1 (no UI pages are exposed, so there is no double sign-in). W1
decides Access for the UI pages when it exposes them.

**Never exposed:** Postgres 54322, Supabase Studio 54323, the mail catcher 54324, the Supabase
meta and functions routes, ComfyUI (no auth), the worker, the dev server, Postiz's database and
Redis, the Docker API. A Windows Firewall rule (owner action, 22) blocking inbound connections to
3000, 3010, 4007, 8188 and 54321-54329 on every interface except loopback is defence in depth for
LAN clients only: it is **not** relied on against Docker containers, because Docker Desktop on
WSL2 may forward container traffic to published host ports without passing that filter. Against
containers the controls are the rotated Postgres password (5.3) and the probe of 5.3 and 13.2.

### 5.3 Supabase hardening (M1, before any route goes live)

1. **Key rotation flow** (`ops/rotate-supabase-keys.ts`, run once in M1 and on demand):
   - generates an ES256 signing key with `supabase gen signing-key --algorithm ES256` into
     `<runtime root>/secrets/supabase/signing_keys.json` and copies it to the gitignored
     `supabase/signing_keys.json`, which `config.toml` names in `signing_keys_path`;
   - sets a new random JWT secret (the exact `config.toml` field or env substitution is confirmed
     in the step 0 spike, written result in the M1 plan);
   - restarts the stack, reads the new anon and service keys from `supabase status -o json`
     without printing them, and writes them into `apps/worker/.env.local`
     (`SUPABASE_SERVICE_ROLE_KEY`) and `apps/web/.env.local` (`NEXT_PUBLIC_SUPABASE_ANON_KEY`);
   - exit test: a `service_role` JWT signed with the public demo secret is refused by the local
     gateway.
   CI generates a throwaway key into `supabase/signing_keys.json` before `supabase start`. The e2e
   stack has its own working folder and its own key (21.2 step 1), so e2e tokens never verify on
   production.
2. **Postgres superuser password: mandatory.** The production `postgres` password is changed to a
   random value stored in `<runtime root>/secrets/supabase/db-password`; every CLI call that needs
   the database (`supabase migration up`, `ops/deploy.ts`) passes `--db-url` with it. The step 0
   spike confirms the CLI commands M1 uses work this way. **Probe (M1 exit criterion):** from a
   throwaway container on Docker's default bridge network, connecting to
   `host.docker.internal:54322` as `postgres` with the old default password must fail, and so must
   `mdf_web` and `mdf_auth` without their passwords. M1 does not exit until the probe passes.
3. `site_url = https://app.mellodifai.com`; `additional_redirect_urls` = the app host plus
   `http://127.0.0.1:3000/**` and `http://localhost:3000/**`. `[auth] enable_signup = false` stays
   (`config.toml:177`): accounts exist only for allowlisted emails.
4. A real SMTP sender for one-time codes (owner action). The email template links to
   `https://app.mellodifai.com/auth/confirm?token_hash={{ .TokenHash }}&type=email&next=...`, so
   verification is server-side.
5. Postiz gets `DISABLE_REGISTRATION=true` after the owner's account exists (M4).

### 5.4 Sign-in, URLs and media

- **Sign-in through the server (M1).** `components/login-form.tsx` calls the server action
  `sendSignInLink(email, next)` (wrapped by `remoteAction`), which runs `signInWithOtp` on the
  server with `emailRedirectTo` built by `lib/redirect-url.ts` from the public origin and the
  validated `next`. `app/auth/confirm/route.ts` (Modify: it exists and today only exchanges a PKCE
  `code` and redirects to `/create`) accepts either `token_hash` plus `type` (`verifyOtp`) or
  `code` (`exchangeCodeForSession`), then redirects to `next`. `next` is validated: a relative
  path that is `/consent?uid=<id>` or, for local requests only, any app path; anything else falls
  back to `/create` locally and `/consent` remotely. `app/(auth)/login/page.tsx` stops reading
  `NEXT_PUBLIC_SUPABASE_URL` and passes `next` through. The `proxy.ts` rewrite of stray `?code=`
  requests to `/auth/confirm` is kept (that path is allowed).
- **Server URL.** The server uses a new server-only variable `SUPABASE_INTERNAL_URL`
  (`http://127.0.0.1:54321`) in `proxy.ts` and `lib/supabase/server.ts`.
- **Browser URL (W1).** `NEXT_PUBLIC_SUPABASE_URL` stops being used by the browser client. The
  root layout passes the browser a URL chosen per request: `http://127.0.0.1:54321` when the
  request is local, `https://api.mellodifai.com` when it is remote. All three clients pin
  `cookieOptions.name = "sb-mellodifai-auth-token"`. Done in W1, after the DNS move.
- **Media.** From M1, `/media/...` keeps the session check and **streams** the object through Next
  (HTTP Range supported, read with the server client), instead of redirecting to the storage host.
  The server-made signed URLs in `clips.ts:498`, `stems.ts:153` and `projects/[id]/page.tsx:66,143`
  are replaced by `/media/...` paths. Token callers get no media bytes in M1 (7.3).
- **Capability links (M4).** `/m/<token>` serves one render to external fetchers (Postiz, Blotato,
  platforms): a random 256-bit token, only its hash stored, created at hand-off time, expiring 72 h
  after hand-off, revoked on veto and 24 h after the post is confirmed.
- Secrets never reach the browser; the service key never leaves the worker's env file.

### 5.5 Cloudflare setup (who does what)

- Tunnel: locally managed. The owner runs `cloudflared tunnel login` and `cloudflared tunnel
  create mellodifai` once (they need his Cloudflare login). The credentials JSON and `config.yml`
  live in `<runtime root>/secrets/cloudflared/`; the repo holds the template
  `ops/cloudflared/config.template.yml`, which the builder fills.
- No Access application and no WAF rule are needed in M1; the edge proxy and the app rate-limit
  (6.7).

### 5.6 Session proxy and health

`apps/web/proxy.ts` excludes `/api/v1`, `/api/mcp`, `/m/`, `/.well-known/` and `/api/health` from
its matcher. `/api/health` returns `{ web: "ok", db: "ok"|"down", ops: "ok"|"down",
worker_heartbeat_age_s, queue_depth, version, schema }` and nothing else, where `ops` is the result
of `ops.health()` called as `mdf_web` (so an app that cannot use the ops layer is unhealthy) and
`schema` is the newest applied migration name.

## 6. Identity, scopes and authorization

### 6.1 Principals

| Principal | Credential | Reaches the database through |
| --- | --- | --- |
| Person in the web UI | Supabase cookie session | Reads: supabase-js under RLS, as today. Writes: the ops layer as `mdf_web` (6.3). |
| Agent with a personal access token (PAT) | `Authorization: Bearer mdf_pat_...` | The ops layer only, reads included (6.3, 7.3). |
| Remote agent (claude.ai, ChatGPT) | opaque OAuth access token `mdf_oat_...` from `apps/auth` | The ops layer only, through `/api/mcp`. |
| Authorization server `apps/auth` | Postgres role `mdf_auth` | Only the `ops.oauth_*` storage functions (6.4). |
| Autopilot | system token row, no secret | Worker-only functions (6.5). |
| Canary and test jobs | `canary` or `test_mode` token rows | The ops layer; fake providers only (6.9). |
| Worker | service role (on the PC only) | As today, plus the worker ledger functions (11.5). |

### 6.2 Scopes and roles

- `read`: read the owner's own songs, jobs, costs and notifications.
- `create`: actions with no paid call (edit, pick, render, stems, visualizer, playlists, uploads).
- `spend`: any action that reserves paid spend, including `song_create` (paid lyric drafting) and
  `remake_start` (paid analysis).
- `publish`: schedule publishing. **Not grantable before M4**; from M4 it only schedules through
  the veto window. There is no "publish now" operation for tokens at any time.
- **Admin operations** (6.3.6) are cookie-only, admin-only and, in M1, local-only (refused when
  the request is remote), except `admin_remote_close`, which only removes power and works remotely.
- **Who holds tokens in M1:** only admins create PATs and only admins see the consent page's
  `spend` box, so customers have no tokens in M1. Customers still use the UI with their caps.
- **Roles** (migration `ops_roles`, DDL in 15.1):
  - `admin_allowlist` gains `role text not null default 'customer'`, and a unique index on
    `lower(email)` (the migration raises if two rows differ only by case).
  - The migration copies today's roles from `profiles` into `admin_allowlist` (so nothing changes
    at migration time and CI stays env-free), then changes `create_allowlisted_profile` to insert
    the allowlist row's role.
  - The deploy step `ops/set-owner.ts` (run by `ops/deploy.ts` right after migrations, as
    `postgres`) sets `role = 'admin'` for `MELLODIFAI_OWNER_EMAIL` and `role = 'customer'` for
    every other row in both `admin_allowlist` and `profiles`, then aborts the deploy unless exactly
    one admin exists and it is that email. A recreated owner account therefore comes back as admin.
  - `supabase/seed.sql` inserts `('admin@mellodifai.local', 'admin')`;
    `apps/web/e2e/global-setup.ts` upserts the e2e admin with `role: 'admin'` and a second e2e user
    with `role: 'customer'`.
  - The storage policy on `previews` keeps "admins read all", which now means only the owner.
- Customers may hold `read`, `create` and `spend` in principle; never `publish`, never local
  engines. Their spending is bounded by the role default caps (11.5): 0.10 USD per day and **0 kie
  credits**, so no music generation until the owner raises their kie cap.
- Selecting Autopilot (M5) needs an admin cookie session or a token holding both `spend` and
  `publish`; the initiating token's caps also apply to the run (6.5).

### 6.3 The operations layer in the database (AC14)

The database is the enforcement point. No role used by Next or `apps/auth` can call a mutating
`public` function, so scopes, caps, reservations, idempotency, audit and the admin-session rule
cannot be skipped by anything that holds those credentials.

#### 6.3.1 Roles and connections

| Role | Login | Used by | Connection env var (password in the same file) |
| --- | --- | --- | --- |
| `mdf_web` | yes | Next (`apps/web/lib/db/ops-client.ts`, `postgres` npm client) | `MDF_WEB_DATABASE_URL` in `apps/web/.env.local` |
| `mdf_auth` | yes | `apps/auth` | `MDF_AUTH_DATABASE_URL` in `apps/auth/.env.local` |

Migration `ops_scopes` creates both roles `NOLOGIN`; `ops/deploy.ts` (production) and
`ops/e2e-stack.ts` (e2e, CI) set `LOGIN PASSWORD` from their env files. Neither role inherits
anything (`NOINHERIT`), is a member of any other role, or owns anything. The secret redaction of
both apps covers both URLs. There is no JWT signing key in Next or `apps/auth`.

#### 6.3.2 Exact grants (migration `ops_scopes`)

```sql
-- Schema ops: owned by postgres, closed to everyone else.
create schema ops;
revoke all on schema ops from public, anon, authenticated, service_role;
grant usage on schema ops to mdf_web, mdf_auth;

-- Default privileges (Supabase grants anon and authenticated directly for objects created by
-- postgres, see 20261031000009_final_fixes.sql:79-81). Revoke them for everything created
-- from now on, in both schemas.
alter default privileges for role postgres in schema public revoke execute on functions from public, anon, authenticated;
alter default privileges for role postgres in schema public revoke all on tables    from anon, authenticated;
alter default privileges for role postgres in schema public revoke all on sequences from anon, authenticated;
alter default privileges for role postgres in schema ops    revoke execute on functions from public, anon, authenticated, service_role;
alter default privileges for role postgres in schema ops    revoke all on tables    from public, anon, authenticated, service_role;
alter default privileges for role postgres in schema ops    revoke all on sequences from public, anon, authenticated, service_role;

-- Existing functions: deny all, then re-grant exactly.
revoke execute on all functions in schema public from public, anon, authenticated;
grant execute on function public.my_playlists(), public.my_queue_positions(), public.my_section_queue(),
  public.my_stems_queue(), public.my_visualizer_queue(), public.playlist_membership(uuid)
  to authenticated;                        -- read RPCs used by the UI (exact signatures from pg_proc)
grant execute on function <every function referenced by a policy> to authenticated;
  -- listed by the migration from pg_policies (for example owned_playlist, audio_upload_ok,
  -- visualizer_asset_ok, stems_allowed_status, rewrite_allowed_status); the ACL test below fails
  -- if one is missing or extra
-- service_role keeps the worker functions it has today (claim_job, heartbeat_job, requeue_stale,
-- reserve_youtube_upload, reserve_publication_upload, release_youtube_upload) and gets the new
-- worker ledger and scheduler functions (11.5, 14.4). Mutating public RPCs (create_song,
-- approve_lyrics, ...) are granted to nobody: only their owner (postgres) can run them, which is
-- how the security-definer ops wrappers call them.

-- Direct writes that survive today.
revoke insert on public.jobs from authenticated;                -- security.sql:30, pipeline_hardening.sql:26
revoke update on public.jobs from authenticated;                -- the update (status) grant, security.sql:31
drop policy "owners enqueue jobs" on public.jobs;               -- perf_indexes.sql:22-33
drop policy "owners cancel queued jobs" on public.jobs;         -- security.sql:47-51 (cancel becomes ops.job_cancel)
revoke insert on public.projects from authenticated;            -- core.sql:236 (update, delete revoked in final_fixes.sql:2)
revoke insert on public.versions from authenticated;            -- pipeline_hardening.sql:23 (column grant)
-- versions.lyric_pack UPDATE was already revoked in web_flow.sql:8; the ACL test confirms it.

-- Every ops function: owner postgres, security definer, set search_path = '', EXECUTE granted
-- by name only, to mdf_web (6.3.6 list) or mdf_auth (6.4 list).
```

Storage writes that stay for cookie sessions in the UI (PostgREST storage is not reachable from
outside in M1): the policies "owners upload studio files", "owners read studio files" and
"owners delete studio files" (`20261101000022_visualizer.sql:40-59`; the delete policy gains the
same profile check as the upload policy), and "owners upload edited audio", "owners read edited
audio" and "owners delete unsaved edited audio" (`20261101000020_stems_and_editor.sql:104-128`).
`audio_upload_ok` and `visualizer_asset_ok` are the validator functions these policies and RPCs
use. Token callers never write storage directly (7.3, uploads).

#### 6.3.3 ACL test (CI, `supabase/tests/ops_acl.test.ts`)

Connects as `postgres` to the stack under test and, for every function, table, view and sequence
in schemas `public` and `ops`, reads `has_function_privilege`, `has_table_privilege` and
`has_sequence_privilege` for `anon`, `authenticated`, `mdf_web`, `mdf_auth` and `service_role`. It
compares the result with the checked-in file `supabase/tests/acl-allowlist.json` and fails on any
grant that is not listed or any listed grant that is missing. A new migration therefore cannot add
a callable object without also changing that file in the same commit, where review sees it. It
also asserts: `mdf_web` and `mdf_auth` have EXECUTE on no `public` function; every `ops` function
is `security definer` with `search_path` set to empty; `pg_roles` shows `mdf_web` and `mdf_auth`
with no memberships.

#### 6.3.4 How a wrapper works

Every `ops` function that acts for a user has the form `ops.<op>(p_ctx jsonb, ...) returns jsonb`
and returns `{"ok": true, "data": ...}` or `{"ok": false, "code": ..., "message": ...}`; it never
raises to the caller for expected failures, so audit rows and notifications written after a
failure persist (the failing work runs inside a `begin ... exception ... end` block, which is a
savepoint).

`p_ctx` fields: `actor_kind` (`session`, `pat`, `oauth`), `user_id` and `session_id` (sessions),
`token_hash` (PAT) or `access_token_hash` (OAuth), `remote` (boolean), `request_id`,
`idempotency_key`. The wrapper never trusts a user id or flag it can derive itself:
1. **Resolve the actor.** Session: `ops` checks `auth.sessions` for a row with `id = session_id`,
   `user_id = user_id` and `not_after` null or in the future; Next takes `session_id` from the
   verified access token's `session_id` claim after `supabase.auth.getUser()`. PAT:
   `agent_tokens.token_hash = token_hash`, not revoked, not expired. OAuth: 6.4's resolution. The
   resolved row gives the actor, role, token id, scopes, `test_mode` and `remote` permission.
2. **Check** the profile exists, the scope (tokens), the role rule, the admin rule (admin
   operations: `actor_kind = 'session'`, role `admin`, and `remote = false` except
   `admin_remote_close`), and the test-run rule (6.9).
3. **Idempotency**: completes the key that Next opened beforehand (7.2): in the same transaction
   as the work, the `idempotency_keys` row moves from `in_flight` to `done` with the response.
4. **Work**: sets `request.jwt.claims` locally (`set_config(..., true)`) to `{"sub": <actor>,
   "role": "authenticated"}` so the existing RPCs' `auth.uid()` works, calls the `public` RPC,
   finds the jobs it created (`select ... from public.jobs where owner_id = <actor> and created_at
   = now()`, which is the current transaction's start time), sets `token_id`, `run_id`,
   `fake_providers` and `test_run` on them (`fake_providers` from the token's `test_mode`, never
   from `p_ctx`), and calls `public.reserve_job_spend(job_id)` for each (11.5). Any failure rolls
   back the savepoint, so a refused reservation leaves no job behind.
5. **Audit**: one `audit_log` row (ok or error), plus a `cap_hit` notification when the error is
   `cap_exceeded`.

#### 6.3.5 Error codes (frozen; additive only)

| Code | HTTP | Meaning |
| --- | --- | --- |
| `unauthorized` | 401 | no or bad credential, unknown session |
| `forbidden_scope` | 403 | missing scope, wrong role, admin rule, remote rule, test-run rule |
| `not_found` | 404 | object missing or not the actor's |
| `conflict` | 409 | the object is not in the state the operation needs |
| `idempotency_mismatch` | 409 | same key, different request |
| `in_progress` | 409 | same key, request still running (`retry_after` 2) |
| `ambiguous_spend` | 409 | a kie submission's outcome is unknown; resolve it first |
| `validation` | 422 | bad input |
| `cap_exceeded` | 402 | a spend cap refused the reservation (`details` names scope, provider, period) |
| `rate_limited` | 429 | rate limit (`retry_after`) |
| `provider_unavailable` | 503 | a provider call failed (web-side calls only) |
| `internal` | 500 | anything unmapped |

`runAction` maps each code to the translated message `errors.<code>` in `ActionResult`; the API
returns the envelope of 7.2. Mapping from the RPCs' existing free-text exceptions is done by
`ops.map_error(sqlstate, message)` with these ordered rules (first match wins):
1. `authentication required`, `profile required` -> `unauthorized`.
2. `admin required`, `local engines are admin only` -> `forbidden_scope`.
3. `kie submission state unknown%`, `resolve unknown submission first`,
   `kie task may still succeed%` -> `ambiguous_spend`.
4. `% not found`, `render missing` -> `not_found`.
5. `invalid %`, `%too long`, `too many %`, `% must %`, `a part is %`, `range outside the take`,
   `an upload or a take, not both`, `title required`, `language required`, `metadata required`,
   `prompt or title required`, `task id required`, `video id required`,
   `override reason required`, `lyrics of the part required`,
   `publish_at requires scheduled privacy` -> `validation`.
6. Any other message ending in `required`, or containing ` already `, plus `transition not
   allowed`, `version not approved`, `rewrite discarded`, `song not ready for a rewrite`,
   `the song has new takes since this rewrite`, `this engine cannot start from audio in this way`
   -> `conflict`.
7. SQLSTATE `MDF01`..`MDF12` raised by `ops` and ledger functions map to their own code
   (`MDF02` `cap_exceeded`, `MDF03` `forbidden_scope`, `MDF10` `ambiguous_spend`, and so on, listed
   in `packages/shared/src/ops/errors.ts`).
8. Anything else -> `internal` (logged with the message, returned without it).
A test (`supabase/tests/ops_errors.test.ts`) extracts every `raise exception '...'` text from
`supabase/migrations/*.sql` and fails if one maps to `internal` and is raised by a function an
ops wrapper calls; so a new message must be classified when it is added.

#### 6.3.6 The functions `mdf_web` may call (the complete M1 list)

- **Operations** (one per row of 7.3 marked M1 and callable by tokens or cookies):
  `ops.song_create`, `ops.lyrics_approve`, `ops.lyrics_back`, `ops.song_generate_again`,
  `ops.take_pick`, `ops.take_choose`, `ops.audio_keep`, `ops.video_make`, `ops.video_rerender`,
  `ops.video_approve`, `ops.stage_retry`, `ops.job_cancel`, `ops.stems_request`,
  `ops.visualizer_request`, `ops.section_edit_request`, `ops.section_edit_keep`,
  `ops.section_edit_discard`, `ops.take_save_edit`, `ops.song_import`, `ops.song_source_set`,
  `ops.playlist_create`, `ops.playlist_add`, `ops.playlist_remove`, `ops.playlist_reorder`,
  `ops.playlist_rename`, `ops.playlist_delete`, `ops.song_react`, `ops.song_rename`,
  `ops.song_trash`, `ops.song_restore`, `ops.song_play`, `ops.upload_intent`, `ops.upload_status`,
  `ops.style_format_reserve`, `ops.transcribe_reserve`, `ops.settle_spend`,
  `ops.notifications_read`, `ops.oauth_consent`, `ops.oauth_consent_info`.
- **Reads for token callers** (cookie UI keeps its RLS reads): `ops.songs_list`, `ops.song_get`,
  `ops.job_status`, `ops.job_events_since`, `ops.costs_get`, `ops.notifications_list`.
- **Admin** (cookie, admin, local): `ops.admin_token_create`, `ops.admin_token_revoke`,
  `ops.admin_tokens_list`, `ops.admin_caps_set`, `ops.admin_caps_list`, `ops.admin_flag_set`,
  `ops.admin_role_set`, `ops.admin_allowlist_add`, `ops.admin_remote_close` (remote allowed),
  `ops.admin_resolve_kie_submission`, `ops.admin_resolve_upload`, `ops.admin_enqueue_publish`,
  `ops.admin_confirm_publication` (refuses `scheduled`, AC4), `ops.admin_video_approve_override`,
  `ops.admin_project_create` (the older `create_project` entry point).
- **Infrastructure**: `ops.resolve_access_token` (6.4), `ops.idem_begin` (7.2), `ops.flags`,
  `ops.health`.

Signatures and `data` shapes are in `packages/shared/src/ops/` (7.1). Retry rule:
`ops.stage_retry` refuses the stages `publish` and `set_privacy` for every token actor and for
non-admin sessions (`retry_stage` on those stages re-enqueues `enqueue_publish` or a confirmed
privacy, `20261031000006_web_flow.sql:118-124`); admins retry them through the UI.

#### 6.3.7 Exit tests (database, M1; `supabase/tests/ops_*.test.ts`)

- As `mdf_web` and `mdf_auth`: `has_function_privilege` is false for every `public` function;
  calling `public.approve_lyrics` after `set_config('request.jwt.claims', ...)` fails with
  permission denied.
- With a customer session JWT against the local PostgREST: a direct `jobs` insert, a `jobs`
  status update, a `projects` insert, `approve_lyrics`, `generate_again`, `enqueue_publish` and
  `confirm_publication` are all refused; the same with an admin session JWT.
- Through `ops` as a customer session: `ops.lyrics_approve` returns `cap_exceeded` (details
  `user, kie, credit, day`) because the customer kie credit limit is 0; `ops.song_create` succeeds
  and reserves OpenRouter spend under the customer's 0.10 USD cap.
- Through `ops` with a PAT holding `create` only: `ops.stage_retry` on a failed `publish` job
  returns `forbidden_scope`; `ops.lyrics_approve` returns `forbidden_scope`.
- `ops.admin_caps_set` with `remote = true` returns `forbidden_scope`; with a session id that is
  not in `auth.sessions` returns `unauthorized`.
- The ACL test (6.3.3) and the error-map test (6.3.5) pass.

### 6.4 Remote MCP authorization (AC2)

- **Authorization server:** `apps/auth`, a small Node service built on `oidc-provider` (panva,
  MIT), issuer `https://app.mellodifai.com/oauth`, at `/oauth/*`: dynamic client registration,
  PKCE required (S256), authorization code grant only, resource indicators (RFC 8707) required and
  limited to `https://app.mellodifai.com/api/mcp`, **opaque** access tokens (`mdf_oat_` plus 32
  random bytes, 1 h) and rotating refresh tokens (`mdf_ort_`, 30 days). Metadata at
  `/.well-known/oauth-authorization-server` and `/.well-known/openid-configuration`; advertised
  scopes `read create spend` (plus `publish` from M4).
- **Secrets of `apps/auth`:** signing keys for ID tokens in `<runtime root>/secrets/auth/jwks.json`
  (generated by `ops/rotate-auth-keys.ts`), cookie keys in `MDF_AUTH_COOKIE_KEYS` and the database
  URL in `MDF_AUTH_DATABASE_URL`, both in `apps/auth/.env.local`. Opaque access tokens are not
  signed, so `/api/mcp` needs none of these.
- **Storage:** an adapter over table `oauth_store` (15.1) through the only functions `mdf_auth`
  may call: `ops.oauth_find(model, id_hash)`, `ops.oauth_find_by_uid(uid)`,
  `ops.oauth_find_by_user_code(code)`, `ops.oauth_upsert(model, id_hash, payload, grant_id, uid,
  expires_at)`, `ops.oauth_consume(model, id_hash)`, `ops.oauth_destroy(model, id_hash)`,
  `ops.oauth_revoke_by_grant(grant_id)`, `ops.oauth_interaction_result(uid)` (reads the consent
  decision) and `ops.oauth_bind_grant(uid, grant_id)`. Ids are stored as SHA-256 hashes. `mdf_auth`
  cannot create grant rows, act for a user, or call anything else; a compromised `apps/auth` can
  at worst issue tokens for consents that users actually gave.
- **Registration limits:** the edge proxy allows at most 10 registrations per hour per
  `cf-connecting-ip`, and `apps/auth` accepts only redirect URIs on an allowlist in
  `apps/auth/redirect-allowlist.json`: the claude.ai and ChatGPT connector callback URLs (exact
  values written down in the step 0 spike) and `http://127.0.0.1:<port>/...` and
  `http://localhost:<port>/...` for local clients such as MCP Inspector.
- **Sign-in and consent:** `apps/auth` sends the browser to
  `https://app.mellodifai.com/consent?uid=...`. That page requires the Supabase session (through
  `/login?next=/consent?uid=...`, 5.4), calls `ops.oauth_consent_info(p_ctx, uid)` to show the
  client name, its redirect host and the requested scopes, with only `read` ticked by default,
  `create` available to everyone, `spend` shown only to an admin with a second confirmation (typing
  the client name), and an admin-only "Test (fake providers)" box. The decision is recorded by
  `ops.oauth_consent(p_ctx, uid, scopes, test_mode)`, which creates or updates the `agent_tokens`
  row (kind `oauth`, `remote = true`, `expires_at` 90 days, renewed at each consent). The browser
  returns to `/oauth/interaction/<uid>/resume`; `apps/auth` reads the decision with
  `ops.oauth_interaction_result(uid)`, creates its Grant with exactly those scopes and records the
  Grant id with `ops.oauth_bind_grant(uid, grant_id)` into `agent_tokens.grant_id`.
- **Resource server:** `/api/mcp` serves Protected Resource Metadata at
  `/.well-known/oauth-protected-resource` and `/.well-known/oauth-protected-resource/api/mcp`, and
  answers 401 with `WWW-Authenticate: Bearer resource_metadata="..."`.
  `ops.resolve_access_token(token_hash, resource)` joins `oauth_store` (model `AccessToken`, by
  hash, not expired, not consumed, `aud` equal to the resource) to `agent_tokens` on `grant_id`
  (kind `oauth`, not revoked, not expired) and returns `{user_id, token_id, scopes, test_mode}`.
  **Scope rule:** the effective scopes are the intersection of the access token's scopes and the
  grant row's scopes; the grant row is the upper bound and the only thing Settings edits.
- **Why this closes the round-2 gaps:** the tokens are not Supabase JWTs, so they cannot be used on
  PostgREST, Realtime, storage or `/auth/v1/user`; discovery lives on the app host.
- **Revocation:** Settings > Agenti ("Agents") calls `ops.admin_token_revoke`, which sets
  `revoked_at` and deletes the grant's `oauth_store` rows in the same transaction. Every call
  resolves the token in the database (no cache), so revocation applies to the next call.
- **M1 step 0 spike** (one day, written result in the M1 plan): `oidc-provider` behind the edge
  proxy with DCR, PKCE and resource indicators, completing the claude.ai connector flow against a
  stub `/api/mcp`, and recording the exact connector redirect URIs. **Fallback** if it fails: the
  same `apps/auth` service built on `@node-oauth/oauth2-server` (MIT; authorization code with PKCE)
  plus hand-written metadata, registration and resource-indicator checks, with the same opaque
  tokens, the same `oauth_store` table and the same `ops.oauth_*` functions. The fallback keeps
  AC15 (no Supabase exposure) and needs no JWT library.

### 6.5 Autopilot as an explicit actor (M5)

- An `autopilot_policies` row per owner (enabled, allowed tiers, per-run cap, runs per day,
  premium budget, publish allowed, platforms). Only the owner edits it in Settings > Autopilota
  ("Autopilot").
- A system token row (`kind = autopilot`) per owner, so the ledger and audit log charge Autopilot
  by name. A run started by a token is charged to the system token and also counted against the
  initiating token's caps (both counters are checked by `reserve_spend`).
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

Table `agent_tokens` (DDL in 15.1) holds PATs, OAuth grants, the Autopilot system token and canary
tokens. **PAT format:** `mdf_pat_` followed by 32 random bytes in base62 (43 characters). Next
generates it (`apps/web/lib/ops/tokens.ts`), passes only its `sha256` hex and
hint (`mdf_pat_...` plus the last 4 characters) to `ops.admin_token_create`, and shows the full
token once. PATs have no expiry unless set; a PAT with `remote = true` must have an expiry (default
90 days). A remote request (5.1) with a local-only PAT is refused. Spend caps for a token live only
in `spend_caps` (scope `token`); `ops.admin_token_create` writes its default row (1 USD per day).

### 6.7 Rate limits

- In Next, per token (or per user for cookie sessions), reusing `lib/rate-limit.ts` (sliding
  window): 60 reads per minute, 10 writes per minute (a write is any non-GET request or any MCP
  tool marked as mutating), 20 spend reservations per hour. Excess returns 429 with `Retry-After`.
- In the edge proxy, per `cf-connecting-ip` (sliding window): `/oauth/*` 60 per minute, client
  registration 10 per hour, `/login` and its sign-in action 5 per 15 minutes; the sign-in action
  also limits 5 per 15 minutes per email.
- One Next process is the whole deployment; a second instance would need a shared store (M8).

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

- A token row with `test_mode = true` (a PAT created with the admin-only "test" box, or an OAuth
  grant whose consent ticked "Test (fake providers)") makes every job it causes run on fakes. The
  wrapper sets `jobs.fake_providers = true` from the token row (never from `p_ctx`) and marks every
  version it creates `versions.test_run = true`.
- Propagation: the worker enqueues child jobs only through `public.worker_enqueue(p_parent_job,
  p_version, p_stage, p_idempotency_key)` (service role), which copies `token_id`, `run_id`,
  `fake_providers`, `priority` and `test_run` handling from the parent and reserves spend for the
  child (11.5). `apps/worker/src/db.ts` `enqueue` calls it with the parent job id (its callers in
  `loop.ts` and the stages pass the current job).
- The worker picks the registry per job: `fakeStages` when the process has `WORKER_FAKE=1` (the
  existing variable read in `main.ts:126,150,160` and `workspace.ts:36`, used by e2e and the gate)
  **or** the job has `fake_providers = true`; otherwise the real stages.
- Test versions stay test versions: every ops wrapper refuses (`forbidden_scope`) a paid or publish
  operation on a version with `test_run = true` unless the actor is a `test_mode` token, so a test
  song can never later get a real `generate_again` or a publish. Test versions are trashed by the
  scheduler task `purge_test_runs` after 7 days.
- Fake jobs need no reservation (11.5) and spend nothing.

## 7. Operations layer, HTTP API, CLI and MCP

### 7.1 One implementation

- `apps/web/lib/ops/*`: one module per operation. Type `OpsContext = { actorKind, userId?,
  sessionId?, tokenHash?, accessTokenHash?, remote, requestId, idempotencyKey? }`. Each operation
  validates input with its zod schema, opens the idempotency key when it has one (7.2), calls its
  `ops.*` function over the `mdf_web` connection, and returns `Result<Output, OpsError>`; then it
  revalidates the same paths `runAction` revalidates today. **Server actions call it** through
  `runAction`, the `/api/v1` handlers call it, and the MCP tools call it.
- Schemas live in `packages/shared/src/ops/`, named `<Operation>Input` and `<Operation>Output`
  (for example `LyricsApproveInput`), with `errors.ts` (the 6.3.5 codes and SQLSTATEs) and
  `reads.ts` (the read shapes of 7.3). The existing schemas in `apps/web/app/actions/schemas.ts`,
  including T12's (`SectionEditInput`, `ImportSongInput`, `SongSourceInput`), move there in M1;
  `schemas.ts` re-exports them so imports keep working.
- **Base branch:** M1 starts from `build/studio-ui` at its head when M1 planning begins; T12 is
  already there (migrations 23 and 24, `apps/web/app/actions/songs-from-songs.ts`), so its RPCs are
  wrapped in `ops_scopes` like every other and there is no separate T12 migration.
- **MCP server:** one tool registry (`apps/web/lib/mcp/*`) served at `/api/mcp` with
  `@modelcontextprotocol/sdk` (TypeScript), using its web-standard Streamable HTTP server
  transport (`WebStandardStreamableHTTPServerTransport`, which takes a Fetch `Request` and returns
  a `Response`, so it fits an App Router route handler) in **stateless** mode
  (`sessionIdGenerator: undefined`) with `enableJsonResponse: true`: every tool call returns one
  JSON response, long work returns job ids, and there is no SSE stream on `/api/mcp`, so no
  keepalive is needed there; GET returns 405. The step 0 spike pins an SDK version that has this
  transport; if none does, the fallback is the `mcp-handler` adapter over the same registry.
  Protocol revision: the newest the pinned SDK supports, at least 2025-06-18.
- The CLI (`packages/cli`) is a thin HTTP client of `/api/v1`. `mellodifai mcp` is the **stdio
  transport**: a bridge that forwards MCP JSON-RPC from stdio to `/api/mcp` with the PAT. Neither
  ever talks to the database. Local agents point it at `http://127.0.0.1:3000`.

### 7.2 HTTP contract (frozen for v1; additive only)

- Versioning: `/api/v1` changes are additive only; a breaking change ships as `/api/v2` and v1
  stays 90 days. Existing tool names never change.
- Responses: `{ "data": <Output> }`. Every operation that starts work returns
  `{ "data": { "jobs": [ { "job_id", "version_id", "stage" } ] } }` (an array, because
  `create_song` creates one version and one job per language); `song_create` adds `project_id`.
- Errors: `{ "error": { "code", "message", "details"?, "retry_after"? } }` with the codes and
  statuses of 6.3.5.
- **Idempotency.** The `Idempotency-Key` header is required on every POST that enqueues or spends;
  MCP tools that enqueue or spend have a required `idempotency_key` input instead. Flow:
  1. Next calls `ops.idem_begin(p_ctx, key, request_hash)` in its **own committed transaction**.
     It inserts `(actor_key, key, request_hash, 'in_flight', now())` and returns `new`; or, when
     the row exists, `replay` with the stored response (same hash, `done`), `idempotency_mismatch`
     (different hash), or `in_progress` (same hash, `in_flight`, younger than 10 minutes). An
     `in_flight` row older than 10 minutes is taken over and returns `new`.
  2. The operation's `ops` function marks the row `done` with its response in the same
     transaction as the work, so a key is `done` exactly when the work committed.
  3. Web-side provider calls (`style_format`, `audio_transcribe`) span several transactions:
     reserve (`ops.style_format_reserve`), call the provider, then `ops.settle_spend`, which also
     marks the key `done`. If Next dies between the provider call and the settle, the key goes
     stale and a retry may pay again (bounded by the caps).
  Keys are purged after 24 h (`purge_idempotency`).
- Pagination: `?cursor=&limit=` (max 100); `cursor` is opaque (base64 of the last sort key).
- Progress: SSE at `/api/v1/jobs/{id}/events`, a streaming route handler that calls
  `ops.job_events_since(p_ctx, job, after_id)` every 2 s, sends a `: keepalive` comment every 25 s
  (Cloudflare drops idle proxied connections after about 100 s), and closes on a terminal status
  or after 10 minutes (clients reconnect). MCP clients poll `job_status`.
- **Uploads for every caller** (cookie UI uploads keep their current direct path):
  1. `POST /api/v1/uploads` (MCP tool `upload_create` takes a base64 body up to 20 MB) streams the
     body (at most 100 MB) to `<runtime root>/uploads/staging/<uuid>` and calls
     `ops.upload_intent(p_ctx, kind, filename, size, sha256)` with `kind` `audio` or `image`. It
     returns `{ upload_id }` and the row is `staged`.
  2. The worker's scheduler task `ingest_uploads` (every 10 s, service role) validates the file
     (`ffprobe`: mp3, wav or flac, at most 15 minutes; images as in 9.4), uploads it to the user's
     storage path (`<user>/audio/<uuid>.<ext>`, the shape `audio_upload_ok` accepts), deletes the
     staged file and marks the row `ready` with that path, or `rejected` with a reason.
  3. `GET /api/v1/uploads/{id}` (`upload_status`) returns the state; `song_import` takes the
     `upload_id` of a `ready` row.
  The staging folder is writable by `mdf-web` and readable by the worker's account only.

### 7.3 Operations catalogue

Columns: operation; MCP tool (HTTP paths follow `/api/v1/<resource>/...` and are listed in the M1
plan); the `ops` function and the `public` RPC it calls; scope; spend reserved; ships in.
"Cookie" means cookie-only, never callable by tokens; "admin" adds the admin and local rules of
6.3.4.

| Operation | MCP tool | `ops` function -> RPC | Scope | Spend reserved (11.5) | Ships |
| --- | --- | --- | --- | --- | --- |
| List songs | `songs_list` | `ops.songs_list` (read) | read | - | M1 |
| Get song | `song_get` | `ops.song_get` (read) | read | - | M1 |
| Job status, job events | `job_status` | `ops.job_status`, `ops.job_events_since` (read) | read | - | M1 |
| Costs | `costs_get` | `ops.costs_get` (read) | read | - | M1 |
| Notifications list, mark read | `notifications_list`, `notifications_read` | `ops.notifications_list` (read), `ops.notifications_read` | read | - | M1 |
| Create song (idea or source) | `song_create` | `ops.song_create` -> `create_song` | spend | one `draft_lyrics` job per language: OpenRouter | M1 |
| Approve lyrics (starts generation) | `lyrics_approve` | `ops.lyrics_approve` -> `approve_lyrics` | spend | `generate_song`: kie (generate, cover or extend by source) plus Groq for take scoring, unless local engine | M1 |
| Back to lyrics | `lyrics_back` | `ops.lyrics_back` -> `back_to_lyrics` | create | - | M1 |
| Generate again | `song_generate_again` | `ops.song_generate_again` -> `generate_again` | spend | as approve lyrics | M1 |
| Pick take | `take_pick` | `ops.take_pick` -> `pick_take` | create | `timing`: Groq | M1 |
| Choose take (audio-only songs) | `take_choose` | `ops.take_choose` -> `choose_take` | create | - | M1 |
| Keep audio (with or without visualizer) | `audio_keep` | `ops.audio_keep` -> `keep_audio` (+ `request_visualizer`) | create | - | M1 |
| Make video, render again | `video_make`, `video_rerender` | `ops.video_make`, `ops.video_rerender` -> `make_video`, `render_again` | create | `timing` when queued: Groq | M1 |
| Approve video (no override) | `video_approve` | `ops.video_approve` -> `approve_video` | create | - | M1 |
| Retry a failed stage | `stage_retry` | `ops.stage_retry` -> `retry_stage` (refuses `publish`, `set_privacy` for tokens and customers) | create, or spend for a paid stage | that stage's rule | M1 |
| Cancel a queued job | `job_cancel` | `ops.job_cancel` (replaces the dropped cancel policy) | create | releases its reservations | M1 |
| Stems, visualizer | `stems_request`, `visualizer_request` | `ops.stems_request`, `ops.visualizer_request` -> `request_stems`, `request_visualizer` | create | - | M1 |
| Section edit: request | `section_edit_request` | `ops.section_edit_request` -> `request_section_edit` | spend | `replace_section`: kie replace, unless local engine | M1 |
| Section edit: keep, discard | `section_edit_keep`, `section_edit_discard` | -> `keep_section_edit`, `discard_section_edit` | create | - | M1 |
| Save edited take | none | `ops.take_save_edit` -> `save_edited_take` | cookie | - | M1 (tokens later, with uploads for edits) |
| Upload a file | `upload_create`, `upload_status` | `ops.upload_intent`, `ops.upload_status` | create | - | M1 |
| Import song, set song source | `song_import`, `song_source_set` | `ops.song_import`, `ops.song_source_set` -> `import_song`, `set_song_source` | create | `import_audio`: Groq for take scoring | M1 |
| Suno share-link import | none | `app/api/suno-link` (storage write as the user) | cookie | - | M1 |
| Playlists | `playlist_create`, `playlist_add`, `playlist_remove`, `playlist_reorder`, `playlist_rename`, `playlist_delete` | `ops.playlist_*` -> the playlist RPCs | create | - | M1 |
| React, rename, trash, restore, count play | `song_react`, `song_rename`, `song_trash`, `song_restore`, `song_play` | `ops.song_*` -> `set_reaction`, `rename_version`, `trash_versions`, `restore_versions`, `count_play` | create | - | M1 |
| Format style | `style_format` | `ops.style_format_reserve`, provider call in Next, `ops.settle_spend` | spend | OpenRouter fast writer | M1 |
| Transcribe | `audio_transcribe` | `ops.transcribe_reserve`, provider call in Next, `ops.settle_spend` | spend | Groq Whisper | M1 |
| Create project (older entry point) | none | `ops.admin_project_create` -> `create_project` | cookie, admin | as create song | M1 |
| Approve video with override reason | none | `ops.admin_video_approve_override` -> `approve_video` | cookie, admin | - | M1 |
| Upload private to YouTube | none | `ops.admin_enqueue_publish` -> `enqueue_publish` | cookie, admin | - | M1 (P0) |
| Set privacy | none | `ops.admin_confirm_publication` -> `confirm_publication` (no `scheduled`) | cookie, admin | - | M1 (P0) |
| Resolve kie submission | none | `ops.admin_resolve_kie_submission` -> `resolve_kie_submission` | cookie, admin | a resend reserves as approve lyrics | M1 |
| Resolve an ambiguous YouTube upload | none | `ops.admin_resolve_upload` -> `resolve_upload` (`20261031000009_final_fixes.sql:62-77`) | cookie, admin | - | M1 |
| Tokens, caps, flags, roles, allowlist, close remote access | none | `ops.admin_*` (6.3.6) | cookie, admin | - | M1 |
| Remake, timeline, publishing and loop tools | as in revision 3 | 8, 9, 12, 13 | - | - | M2a-M6 |

The later rows (`remake_start`, `remake_status`, `remake_stage_*`, `remake_driver_*`,
`artefact_submit`, `timeline_get`, `timeline_patch`, `publish_schedule`, `publish_veto`,
`claim_report`, `loop_report_get`) keep the names, scopes and milestones given in sections 8, 9, 12
and 13; each gets its row here when its milestone is planned. Editor operations added later
(cut, fade, normalise, regenerate a section, storyboard changes) join with the same columns.

**Read shapes for token callers** (`packages/shared/src/ops/reads.ts`; every `ops` read function
filters by the resolved actor and returns only these fields; media bytes and URLs are not part of
M1 and are added later as new fields):

| Shape | Fields |
| --- | --- |
| `SongSummary` | `version_id`, `project_id`, `title`, `lang`, `status`, `engine`, `created_at`, `updated_at`, `take_count`, `duration_s` (chosen take, or null), `test_run` |
| `SongDetail` | `SongSummary` plus `lyrics` (lyric pack or null), `takes[]` (`take_id`, `generation`, `duration_s`, `chosen`), `renders[]` (`render_id`, `kind`, `approved`, `qa_passed`), `publications[]` (`publication_id`, `privacy`, `youtube_video_id`), `active_jobs[]` (`JobStatus`), `lyric_jury` (`available`, `passed`, `scores`) or null, `cost_usd` |
| `JobStatus` | `job_id`, `version_id`, `stage`, `status`, `attempts`, `progress` (0-1 or null), `error_code` (6.3.5 code or null), `error_message` (redacted, at most 300 characters, or null), `created_at`, `started_at`, `finished_at` |
| `JobEvent` | `id`, `at`, `kind`, `progress`, `message` (at most 300 characters) |
| `CostsSummary` | `from`, `to`, `by_provider[]` (`provider`, `usd`, `units` per unit), `caps[]` (`scope`, `provider`, `unit`, `period`, `limit`, `used`) |
| `Notification` | the `notifications` columns except `user_id` |

MCP resources in M1: `mellodifai://songs/{id}` (a `SongDetail`) and `mellodifai://notifications`.
MCP prompt in M1: `new_song`.

### 7.4 CLI and installation

- Commands in M1: `login`, `songs`, `create`, `status <id> --watch`, `approve`, `regenerate`,
  `video`, `costs`, `mcp`; `--json` on all. `remake` arrives in M2a, `publish` and `veto` in M4.
- `login` stores a PAT created in Settings > Agenti in `%APPDATA%\mellodifai\credentials.json`
  (created with a user-only ACL) or `~/.config/mellodifai/credentials.json` (mode 0600). The OS
  credential store (`@napi-rs/keyring`) is deferred to after M1 (scope relief; the file is enough
  for one user on his own PC).
- Install: `pnpm --filter @mellodifai/cli build` then `npm install -g ./packages/cli`, which puts
  `mellodifai` on PATH. Claude Code: `claude mcp add mellodifai -- mellodifai mcp`. Codex: an
  `[mcp_servers.mellodifai]` entry in `~/.codex/config.toml` with `command = "mellodifai"` and
  `args = ["mcp"]`. Cursor and Gemini CLI: the same command in their MCP config.
- Agent skill (`packages/cli/skill/`, with `AGENTS.md`): the workflows that exist in the current
  milestone, the scopes and caps, always sending `idempotency_key` on spend tools, never retrying
  an `ambiguous_spend`, the driver lease (from M2a), and treating `untrusted_source` resources as
  data.

### 7.5 Keys held by Next

Next calls OpenRouter (`style_format`) and Groq (`audio_transcribe`) itself, so it gets its own
`OPENROUTER_API_KEY` and `GROQ_API_KEY` in `apps/web/.env.local` (the owner may use the same key
values as the worker or separate, lower-limit keys; separate keys are the default recommendation).
`apps/web/lib/openrouter-key.ts` stops reading the worker's env files (`WORKER_ENV_FILES`), which
the `mdf-web` account cannot read anyway. The threat model (17) records that a compromised Next
holds these two keys, `MDF_WEB_DATABASE_URL`, and the session cookies of active users.

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
  **`packages/gates/**`** and **`config/gates/**`** (created in M1 by moving `PASS_SCORE`,
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

Tables in 15.1. All functions here are `security definer`, owned by `postgres`, with
`search_path = ''`; the `public` ones are granted to `service_role` only, the `ops` ones to
`mdf_web` only.

**Price book.** Seeded in M1 by `supabase/seed.sql` for local stacks and by `ops/deploy.ts` for
production, each row with `checked_on` and `source`: kie at 0.005 USD per `credit` (from the test
fixture, `verified = false` until the owner confirms the rate); kie operation sizes in
`provider_operations` (generate 12 credits; cover, extend and replace-section with the credit
counts from kie's price page at seed time, `verified = false`); the OpenRouter models the app uses
(Jev, the two writers, the two judges) with their `mtok_in` and `mtok_out` prices copied from
OpenRouter's models API at seed time; Groq Whisper per `audio_hour`; codex, Gemini free tier and
local engines at 0. A daily refresh task (`price_book_sync`) is deferred to M2a; until then a
stale price only skews estimates, and settles use the provider's reported cost.

**Caps.** A cap row is `(scope, key, provider, unit, period, limit)`:
- `scope` is `global`, `user`, `token` or `run`; `key` is `''` (global), a user id or
  `default:<role>` (user), a token id (token), a run id (run);
- `provider` is `''` for "all providers" or one provider; `unit` is `usd` or a price unit such as
  `credit` (a non-`usd` unit needs a provider);
- `period` is `day` or `month` (calendar windows in Europe/Rome) or `run` (no window).
Seeded defaults (AC7, editable in Settings > Costi, "Costs"):

| scope | key | provider | unit | period | limit |
| --- | --- | --- | --- | --- | --- |
| global | `''` | `''` | usd | day | 3.00 |
| global | `''` | `''` | usd | month | 40.00 |
| global | `''` | kie | credit | day | 120 |
| user | `default:customer` | `''` | usd | day | 0.10 |
| user | `default:customer` | kie | credit | day | 0 |
| token | each token (written at creation) | `''` | usd | day | 1.00 |
| run | each run (written at run start, M2a) | `''` | usd | run | 0.25 standard, 0.03 free |

`default:admin` has no rows, so the owner is bound only by global, token and run caps. **User
fallback:** if a user has at least one row with `key = <user id>`, only those user rows apply;
otherwise the rows of `default:<role>` apply. The counter key is always the real user id.

**Counters.** `spend_counters` has one row per cap row and window:
`(scope, key, provider, unit, period, window_start, used)`, where `key` is resolved (user id, not
`default:customer`), `window_start` is today's date (day), the first day of the month (month) or
`1970-01-01` (run), all in Europe/Rome, and `used` counts reserved plus settled amounts in the
cap's unit.

**Functions.**

```sql
public.reserve_spend(p_user uuid, p_token uuid, p_run uuid, p_job uuid, p_version uuid,
                     p_provider text, p_model text, p_items jsonb) returns uuid
  -- p_items: [{"unit":"mtok_in","units":0.004},{"unit":"mtok_out","units":0.002}] or
  --          [{"unit":"credit","units":12}]; usd = sum(units * price_book price for that unit).
  -- 1. collect matching cap rows: global; user rows by the fallback rule; token row; run row;
  --    each where provider in ('', p_provider) and (unit = 'usd' or a p_items unit equals it);
  -- 2. insert the needed spend_counters rows with "on conflict do nothing";
  -- 3. select them "for update" ordered by (scope, key, provider, unit, period, window_start),
  --    the same order in every ledger function, so concurrent reservations serialise and the
  --    first reservations of a new window cannot race;
  -- 4. for each, amount = usd (unit usd) or the sum of p_items units in that unit;
  --    if used + amount > limit raise sqlstate 'MDF02' 'cap_exceeded:<scope>:<provider>:<unit>:<period>';
  -- 5. add the amounts, insert ledger_entries (state reserved), return its id.
public.settle_spend(p_entry uuid, p_items jsonb, p_usd numeric default null) returns void
  -- actual items (and the provider's reported USD when it gives one, else priced); adjusts the
  -- same counters by (actual - estimate) under the same lock order; state settled.
public.release_spend(p_entry uuid) returns void        -- subtracts the estimate; state released
public.mark_ambiguous(p_entry uuid) returns void       -- state ambiguous; amounts stay counted
public.claim_reservation(p_job uuid, p_provider text) returns uuid
  -- the oldest reserved, unclaimed entry of that job and provider; sets claimed_at; null if none
public.worker_reserve_spend(p_job uuid, p_provider text, p_model text, p_items jsonb) returns uuid
  -- reserve_spend with user, token, run and version taken from the job (extra rounds)
public.reserve_job_spend(p_job uuid) returns void
  -- reserves every item that public.job_spend_rule(p_job) returns; called by the ops wrappers
  -- and by public.worker_enqueue in the transaction that creates the job
ops.style_format_reserve(p_ctx, p_model, p_items) returns jsonb   -- web-side, no job
ops.transcribe_reserve(p_ctx, p_audio_seconds) returns jsonb      -- web-side, no job
ops.settle_spend(p_ctx, p_entry, p_items, p_usd) returns jsonb    -- only for an entry with no
                                                                  -- job reserved by this actor
```

**When a job needs a reservation** (`public.job_spend_rule(job) returns setof (provider, model,
items)`; returns nothing for fake jobs, `fake_providers = true`):

| Stage | Reserves | Returns nothing when |
| --- | --- | --- |
| `draft_lyrics` | OpenRouter: writer plus three judges, one round (the estimate in `provider_operations`) | - |
| `generate_song` | kie: generate, cover or extend (by the version's source) credits; Groq: take scoring for two takes of the expected length | the version's engine is local (ACE-Step, YuE2): Groq only; `versions.kie_task_id` is set (a resume after `resolve_kie_submission` with charged outcome, or `retry_stage` of a submitted task): Groq only |
| `replace_section` | kie replace-section credits | the engine is local |
| `import_audio`, `timing` | Groq: take scoring for the audio's length | - |
| every other stage | - | always |

Extra rounds beyond the estimate (lyric revision rounds, extra jury rounds) are reserved inside the
stage with `worker_reserve_spend` right before the call.

**Where the worker enforces it ("no reservation, no paid call").**
- Every paid call goes through `apps/worker/src/providers/paid.ts`. For HTTP providers
  (`providers/kie-client.ts`, moved from `kie/client.ts`, and the OpenRouter calls of
  `lyric-jury.ts` and `draft-lyrics.ts`) it calls `claim_reservation(job, provider)` (or
  `worker_reserve_spend` for an extra round) and refuses with `no_reservation` when it gets
  nothing; after the call it calls `settle_spend(entry, actual)`.
- For subprocesses, `engine.run` (`apps/worker/src/engine.ts`) refuses any call whose `secretEnv`
  contains a paid key name (`KIE_API_KEY`, `OPENROUTER_API_KEY`, `GROQ_API_KEY`,
  `HIGGSFIELD_API_KEY`; the list `PAID_SECRET_NAMES` lives in `providers/paid.ts`) unless the
  options carry a claimed `ledgerEntry`. This covers `tools/kie.mjs` (`generate-song.ts:108, 211,
  242, 289, 316`, `source-audio.ts:112-125`) and `score_takes.py` with `whisper_words.py`
  (`score-takes.ts:75-89`, called from `import-audio.ts:66`, `local-engine.ts:569`, `timing.ts:44`).
  The worker sets `MELLODIFAI_NO_KEYFILES=1` in every child environment, and the engine repo (an
  M1 change there) makes `tools/kie.mjs` and `whisper_words.py` refuse to read their key-file
  fallbacks (the engine repo's `.env`, `~/.config/watch/.env`) when it is set, so a key can only
  arrive through `secretEnv`.
- A unit test fails if any worker file outside `apps/worker/src/providers/` contains a paid
  provider host name or a paid key name outside a `secretEnv` list.
- **Grandfathered jobs:** `jobs.ledger_required` is false for every job that existed before the
  migration and true for new jobs. For a grandfathered job, `paid.ts` reserves on demand with
  `worker_reserve_spend` (still capped) instead of refusing.

**Lifecycle (no wall-clock expiry while a job is alive).**
- A reservation lives as long as its job is `queued` or `running`, however long it waits in the
  queue or runs (the job heartbeat proves it is alive).
- The scheduler task `expire_reservations` (every 5 minutes) handles entries still `reserved`:
  - job `done`, `failed` or `cancelled`, or job deleted: if the job is a kie stage and
    `versions.kie_submit_state = 'submitting'`, `mark_ambiguous` (counted as spent until
    `resolve_kie_submission`); otherwise `release_spend`;
  - no job (web-side) and older than 10 minutes: `release_spend`.
- `ops.job_cancel` releases the job's entries in the same transaction.
- `ops.admin_resolve_kie_submission` settles an `ambiguous` entry as spent (charged) or releases
  it (not charged), and a resend reserves anew through the generated job.

**Propagation.** `jobs` gains `token_id`, `run_id`, `fake_providers`, `ledger_required`,
`resource_class` and `priority`, and `versions` gains `test_run`; `public.worker_enqueue` (6.9)
copies the job fields from the parent job. `run_id` is a plain uuid in M1 and gets its foreign
key to `remakes` in M2a.
`resource_class` is set by a `before insert` trigger from the stage map, so no caller can forget
it.

**Reconciliation** of `workers.kie_balance` against the ledger (`kie_reconcile`) is deferred to
M2a (scope relief; caps already bound kie spend).

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
  inside the sandbox that must fail to connect to `host.docker.internal:54322`, `:54321`, `:3000`,
  `:8188`, `:4007` and to any internet host; if any probe succeeds, the night aborts. The host
  firewall rule (5.2) is the second layer.
- **Scorer network:** only the OpenRouter API through the egress proxy. Its OpenRouter key has a
  provider-side credit limit sized by the formula in 13.4 and is recorded in the ledger as provider
  `openrouter-eval`.
- **Production never reachable:** neither container mounts the production checkout, the worker env
  files, `<runtime root>/secrets/`, the kill switch or the Docker socket.
- `test:db` refuses to run against port 54321, reusing the guard of `apps/web/e2e/local-env.ts`
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
`scheduled_tasks` (15.1); the worker claims a due task atomically with
`public.claim_scheduled_task(p_worker text)` (service role only: an update of `next_run_at` on a
row selected `FOR UPDATE SKIP LOCKED`) and runs it in process, then calls
`public.finish_scheduled_task(p_name, p_ok, p_error)`. Tasks:

| Task | Cadence | From |
| --- | --- | --- |
| `expire_reservations` | every 5 min | M1 |
| `ingest_uploads` | every 10 s | M1 |
| `purge_idempotency` | hourly | M1 |
| `purge_oauth` (expired and consumed `oauth_store` rows) | hourly | M1 |
| `notify_push` | every 30 s | M1 |
| `purge_audit` (180 days) | daily 03:30 | M1 |
| `purge_test_runs` (test versions older than 7 days) | daily 03:45 | M1 |
| `price_book_sync`, `kie_reconcile` | daily 04:00, 05:00 | M2a (deferred from M1) |
| `retention_sweep` | daily 03:00 | M2a |
| `disk_guard` | every 10 min | M2a |
| `publish_slots` | every minute | M4 |
| `veto_reminders` | every 10 min | M4 |
| `capability_expire` | hourly | M4 |
| `analytics_daily` | daily 06:00 | M4 |
| `canary_jobs` | daily 00:30 | M6 |

Times are Europe/Rome.

## 15. Data model additions

All migrations are additive (new tables, new nullable columns, widened check lists) except the
privilege changes of `ops_scopes`, which only revoke. Numbers are assigned after T12's last
migration.

### 15.1 M1 tables (DDL level)

Rules for every M1 object, on top of the default-privilege revokes of 6.3.2:
- Every table has RLS enabled and an explicit `revoke all on <table> from anon, authenticated;`
  right after `create table` (Supabase's default ALL grants are not trusted, as the repo already
  does at `019:41` and `023:77`); every function an explicit
  `revoke execute on function <f> from public, anon, authenticated;` before its one grant.
- "Read own" means a `select to authenticated using (<owner column> = (select auth.uid()))` policy
  plus `grant select` on that table to `authenticated` (these are cookie UI reads; token callers
  read through `ops` functions).
- Nobody but the `ops` and worker functions writes these tables.

```sql
-- migration ops_roles
create unique index admin_allowlist_email_lower on public.admin_allowlist (lower(email));
  -- preceded by a check that raises if two emails differ only by case
alter table public.admin_allowlist add column role text not null default 'customer'
  check (role in ('admin','customer'));
update public.admin_allowlist a set role = p.role
  from public.profiles p where lower(p.email) = lower(a.email);   -- keep today's roles
-- create_allowlisted_profile(): select role into v_role from admin_allowlist
--   where lower(email) = lower(new.email); insert (new.id, new.email, v_role).
-- ops/set-owner.ts then fixes roles at deploy time (6.2).

-- migration ops_tokens
create table public.agent_tokens (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references public.profiles(id) on delete cascade,
  kind text not null check (kind in ('pat','oauth','autopilot','canary')),
  name text not null check (length(name) between 1 and 60),
  token_hash text unique,              -- sha256 hex, pat only
  token_hint text,                     -- 'mdf_pat_...' plus last 4
  oauth_client_id text,                -- oauth only
  grant_id text unique,                -- oauth only, set by ops.oauth_bind_grant
  scopes text[] not null check (scopes <@ array['read','create','spend','publish']),
  remote boolean not null default false,
  test_mode boolean not null default false,
  expires_at timestamptz,
  created_at timestamptz not null default now(),
  last_used_at timestamptz,
  revoked_at timestamptz,
  check ((kind = 'pat') = (token_hash is not null)),
  check ((kind = 'oauth') = (oauth_client_id is not null)),
  check (not remote or expires_at is not null)
);
create unique index agent_tokens_one_grant on public.agent_tokens (owner_id, oauth_client_id)
  where kind = 'oauth' and revoked_at is null;
create view public.agent_tokens_public with (security_invoker = true) as
  select id, owner_id, kind, name, token_hint, oauth_client_id, scopes, remote, test_mode,
         expires_at, created_at, last_used_at, revoked_at
  from public.agent_tokens;            -- read own through the base table's RLS; no token_hash

create table public.oauth_store (
  model text not null, id_hash text not null, payload jsonb not null,
  grant_id text, uid text, user_code text, expires_at timestamptz, consumed_at timestamptz,
  primary key (model, id_hash)
);
create index on public.oauth_store (grant_id);
create index on public.oauth_store (uid);
create index on public.oauth_store (expires_at);
-- no grants at all; only ops.oauth_* (mdf_auth) and ops.resolve_access_token (mdf_web)

create table public.oauth_consents (
  uid text primary key,                -- the oidc-provider interaction id
  user_id uuid not null references public.profiles(id) on delete cascade,
  client_id text not null, scopes text[] not null, test_mode boolean not null default false,
  token_id uuid references public.agent_tokens(id) on delete cascade,
  created_at timestamptz not null default now()
);                                     -- no grants; ops only

create table public.idempotency_keys (
  actor_key text not null,             -- token id, or 'session:' || user id
  key text not null check (length(key) between 8 and 100),
  request_hash text not null,
  state text not null check (state in ('in_flight','done')),
  response jsonb,
  created_at timestamptz not null default now(),
  primary key (actor_key, key)
);                                     -- no grants; ops only

create table public.audit_log (
  id bigint generated always as identity primary key,
  at timestamptz not null default now(),
  owner_id uuid not null references public.profiles(id) on delete cascade,
  actor_kind text not null check (actor_kind in ('session','pat','oauth','autopilot','canary','worker')),
  token_id uuid references public.agent_tokens(id) on delete set null,
  operation text not null, args_hash text not null,
  result text not null check (result in ('ok','error')), error_code text,
  usd_reserved numeric(10,4), remote boolean not null default false
);
create index on public.audit_log (owner_id, at desc);   -- read own

create table public.upload_intents (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references public.profiles(id) on delete cascade,
  kind text not null check (kind in ('audio','image')),
  filename text not null check (length(filename) <= 200),
  size_bytes bigint not null check (size_bytes between 1 and 104857600),
  sha256 text not null, staging_name uuid not null unique,
  state text not null default 'staged' check (state in ('staged','ready','rejected')),
  storage_path text, reason text,
  created_at timestamptz not null default now()
);                                     -- read own

-- migration spend_ledger
create table public.price_book (
  provider text not null, model text not null default '',
  unit text not null check (unit in ('credit','image','mtok_in','mtok_out','audio_hour','call')),
  usd_per_unit numeric(12,6) not null, checked_on date not null, source text not null,
  verified boolean not null default false,
  primary key (provider, model, unit)
);                                     -- select granted to authenticated

create table public.provider_operations (
  provider text not null, operation text not null, model text not null default '',
  items jsonb not null,                -- the estimate, same shape as reserve_spend's p_items
  verified boolean not null default false, checked_on date not null, source text not null,
  primary key (provider, operation, model)
);                                     -- select granted to authenticated

create table public.ledger_entries (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  provider text not null, model text not null default '',
  items_est jsonb not null, usd_est numeric(10,4) not null,
  items_actual jsonb, usd_actual numeric(10,4),
  state text not null check (state in ('reserved','settled','released','ambiguous')),
  token_id uuid references public.agent_tokens(id) on delete set null,
  run_id uuid, job_id uuid references public.jobs(id) on delete set null, version_id uuid,
  claimed_at timestamptz,
  created_at timestamptz not null default now(), settled_at timestamptz
);
create index on public.ledger_entries (job_id, provider) where state = 'reserved';
create index on public.ledger_entries (state, created_at);
create index on public.ledger_entries (user_id, created_at desc);   -- read own

create table public.spend_caps (
  scope text not null check (scope in ('global','user','token','run')),
  key text not null default '',
  provider text not null default '',
  unit text not null default 'usd',
  period text not null check (period in ('day','month','run')),
  "limit" numeric(12,4) not null check ("limit" >= 0),
  primary key (scope, key, provider, unit, period),
  check (unit = 'usd' or provider <> ''),
  check ((scope = 'run') = (period = 'run'))
);                                     -- no grants; ops.admin_caps_* and ops.costs_get only

create table public.spend_counters (
  scope text not null, key text not null, provider text not null, unit text not null,
  period text not null, window_start date not null,
  used numeric(14,4) not null default 0,
  primary key (scope, key, provider, unit, period, window_start)
);                                     -- no grants

alter table public.jobs
  add column token_id uuid references public.agent_tokens(id) on delete set null,
  add column run_id uuid,
  add column resource_class text not null default 'cpu' check (resource_class in ('gpu','cpu','net')),
  add column priority smallint not null default 0,
  add column fake_providers boolean not null default false,
  add column ledger_required boolean not null default false;   -- existing rows: grandfathered
alter table public.jobs alter column ledger_required set default true;
-- trigger jobs_set_resource_class (before insert) sets resource_class from the stage map
alter table public.versions add column test_run boolean not null default false;

-- migration notifications
create table public.notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  kind text not null check (kind in ('run_paused','veto_open','veto_reminder','missed_slot','cap_hit',
    'ambiguous_spend','gate_failed_at_slot','loop_merge','loop_revert','disk_low','system')),
  severity text not null check (severity in ('info','warn','urgent')),
  title text not null check (length(title) <= 120), body text check (length(body) <= 500),
  link text, deadline timestamptz,
  created_at timestamptz not null default now(), read_at timestamptz, pushed_at timestamptz
);                                     -- read own

create table public.app_flags (
  flag text primary key check (flag in ('remote_mcp','autopilot','auto_publish_public','loop_merge','premium')),
  enabled boolean not null default false, changed_by uuid, changed_at timestamptz
);                                     -- select granted to authenticated

create table public.scheduled_tasks (
  name text primary key, interval_s integer, daily_at time,
  next_run_at timestamptz not null, running_by text, started_at timestamptz,
  last_ok_at timestamptz, last_error text,
  check ((interval_s is null) <> (daily_at is null))
);                                     -- no grants; worker functions only
```

Flags are read through `ops.flags()` with a 10 s in-process cache in Next; the kill path
(`ops.admin_remote_close`) does not depend on the cache, because it also revokes every OAuth grant
and remote PAT, and tokens are resolved in the database on every call.

The `ops` functions, the ledger functions and their exact grants are listed in 6.3.6, 6.4 and
11.5; `supabase/tests/acl-allowlist.json` (6.3.3) is the machine-checked copy.

### 15.2 Later tables (key fields; DDL written in each milestone's plan before it starts)

| Entity | Key fields | Milestone, migration |
| --- | --- | --- |
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
- **Notifications (M1):** the `notifications` table, shown in the app and to agents. Push through
  **ntfy** (AC12): the public `https://ntfy.sh` server, a random 24-character topic in `NTFY_TOPIC`
  (`apps/worker/.env.local`), sent by the scheduler task `notify_push`. Payload: title, at most 200
  characters of body, and a link to the app; never lyrics, keys or personal data.

## 17. Threat model and risks

| Risk | Surface | Likelihood / impact | Mitigation | Milestone |
| --- | --- | --- | --- | --- |
| Direct database calls bypass caps, roles, veto | PostgREST | high once exposed / critical | `ops_scopes` revokes (6.3); Supabase not exposed in M1 (5.2) | M1 |
| Every allowlisted user is admin | auth trigger | certain today / high | `ops_roles` (6.2) | M1 |
| Forged service-role JWT with the demo secret | gateway | high if exposed / critical | Key rotation and exit test (5.3) | M1 |
| Private services exposed by the tunnel | tunnel | medium / critical | Edge-proxy path allowlist, catch-all 404, firewall rule (5.2) | M1 |
| OAuth token used against Supabase | OAuth | eliminated by design | Opaque tokens from `apps/auth` (6.4) | M1 |
| Compromised Next process | web | low / high | `mdf_web` can call only the `ops` functions of 6.3.6 and no `public` function, so every write still passes scope, cap, reservation, audit and admin rules; it can act for a cookie user only with a live session id of that user (6.3.4) and cannot reach admin operations remotely; it holds its own OpenRouter and Groq keys (7.5) but no worker secret and no signing key (5.1) | M1 |
| Compromised `apps/auth` | auth | low / medium | `mdf_auth` can call only the `ops.oauth_*` storage functions; it cannot create grants or act for users (6.4) | M1 |
| Overspend under concurrency | ledger | medium / high | `reserve_spend` with row locks inside the wrappers; paid-call module (11.5) | M1 |
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

- **Fakes.** `apps/worker/src/fake` is extended to yt-dlp, kie Midjourney, codex, Nano Banana,
  OpenRouter text and image, Groq, YouTube, Blotato and Postiz. A job runs on fakes when the worker
  process has `WORKER_FAKE=1` (the existing variable; e2e and the gate set it) or the job has
  `fake_providers = true` (6.9).
- **Remote exit test on production (M1).** An admin `test_mode` PAT (for Claude Code over stdio)
  and an OAuth grant created with the consent page's "Test (fake providers)" box (for claude.ai)
  drive the real tunnelled instance; their jobs and child jobs run on fakes, and the ledger shows
  no entry for them.
- **Reservation path on the e2e stack.** A database test calls `ops.lyrics_approve` as the e2e
  admin session (no test mode) and asserts one `generate_song` job with a reserved kie entry of 12
  credits and a reserved Groq entry; then marks the job `failed` and asserts that
  `expire_reservations` releases both; then repeats with `kie_submit_state = 'submitting'` and
  asserts `ambiguous`.
- **MCP conformance:** `npx @modelcontextprotocol/inspector --cli <url> --method tools/list`, then
  `tools/call` of `song_get`, `song_create` and `job_status`, over both transports, must succeed;
  the same with a revoked token must fail with 401.
- Unit tests: schemas (rejection of unsafe strings and oversize input), `reserve_spend` under
  concurrency (20 parallel reservations against a fresh window never exceed a cap), the
  paid-call rule (static scan, and `engine.run` refusing a paid `secretEnv` without a
  `ledgerEntry`), the `runAction`/`remoteAction` wrapping rule (5.2), the `next` validation of
  `/auth/confirm`.
- Database tests (`supabase/tests/`, pinned to a non-production stack): the 6.3.7 exit tests, the
  ACL test (6.3.3), the error-map test (6.3.5), role rules (a new allowlisted user is a
  customer; `ops/set-owner.ts` leaves exactly one admin), test-run refusals (6.9). The existing
  ten test files that call `public` RPCs with `.rpc(` as `authenticated` (about 240 calls) are
  rewritten to call `ops` functions through a helper `opsCall(session, fn, args)` that connects as
  `mdf_web`; a few direct calls stay as refusal assertions.
- OAuth end to end against the local stack: registration (allowlisted and refused redirect URIs),
  PKCE, consent with only `read` ticked by default, token, tool call, revocation.
- Tunnel smoke test: allowed routes answer, denied routes return 404, a `Next-Action` POST to
  `/login` with another action's id is refused, nothing of Supabase answers.
- Container probe (5.3 item 2).
- Later milestones: route 2 injection test (11.3); gate tests (13).

**Stacks and CI.**
- `ops/e2e-stack.ts` (new) creates the e2e stack in its own working folder
  `<runtime root>/e2e-supabase/` from the repo's `supabase/` (project id `mellodifai_e2e`, API port
  45621 and neighbours, a throwaway signing key), applies migrations and the seed, and sets the
  `mdf_web` and `mdf_auth` passwords from `apps/web/e2e/.env.e2e` (test values, gitignored, created
  by the script).
- The `test:db` guard (root `package.json:13`, reusing `apps/web/e2e/local-env.ts`) refuses port
  54321 unless `CI=true` (GitHub Actions, where 54321 is a throwaway stack).
- `.github/workflows/ci.yml` (Modify): before `supabase start`, generate a throwaway signing key
  into `supabase/signing_keys.json`; after it, run `ops/e2e-stack.ts --roles-only` to set the role
  passwords on the CI stack; `pnpm test:db` and `pnpm e2e` then run as today.

## 20. Rollout, feature flags and rollback

| Flag | Turns on | Enablement gate | Kill path |
| --- | --- | --- | --- |
| `remote_mcp` | remote PATs and OAuth at `/api/mcp` | M1 exit tests pass | Settings > Agenti "Chiudi accesso remoto" ("Close remote access", `ops.admin_remote_close`): flag off, every OAuth grant and remote PAT revoked; hard kill: stop `cloudflared` |
| `autopilot` | Autopilot runs | M3 gates and M1 caps in place, 5 Copilot remakes passed every gate | flag off; running Autopilot runs stop with `owner_cancelled` at the stage boundary |
| `auto_publish_public` | the slot flip to public | P0 lock re-verification or a verified Blotato route; 3 Copilot publishes done | flag off: bundles stay private |
| `loop_merge` | the merger | 7 dry-run nights (13.8) | kill switch file or Settings toggle |
| `premium` | premium tier | M7 acceptance | flag off |

**Deploy and rollback** (`ops/deploy.ts`, M1):
1. wait for idle (no running job);
2. `pg_dump` to `<runtime root>/backups/` (kept 14 days);
3. `git pull --ff-only` (or `git checkout <commit>` with `--to`);
4. frozen-lockfile install;
5. `supabase migration up --db-url ...` (5.3), then `ops/set-owner.ts` (6.2);
6. `next build` and the `apps/auth` build;
7. restart services;
8. health check: `/api/health` must report `ops: "ok"` and the expected `schema`.
- On a failed health check the script returns automatically to the previous commit **only if
  step 5 applied no migration**; otherwise it leaves the new commit running, marks the deploy
  failed and notifies (a migration is never undone by checking out older code).
- `--to <commit>` refuses a target older than the commit that added the newest applied migration
  (the "migration floor"). The first floor is the commit that adds `ops_scopes`; the old app
  cannot work after it, because the RPCs it calls are revoked.
- Migrations are additive except the revokes of `ops_scopes`, which are rolled back only by a
  human-written migration.

## 21. Milestones

### 21.1 Summary

| Milestone | Goals | Covers | Needs | Owner actions |
| --- | --- | --- | --- | --- |
| M0 (running) | - | T12, storyboard bug | - | - |
| P0 (parallel, from now) | 5 (manual) | 12.1 | nothing | Google OAuth client, audit submission |
| M1 Safe agent access | 2, 4 (ledger) | 5, 6, 7, 11.5, 14.4, 15.1, 16, 19, 20 | the head of `build/studio-ui` (T12 included) | DNS, tunnel creation, SMTP, `mdf-web` account, firewall rule, kie rate, ntfy |
| M2a Remade song (Copilot) | 1 (song half), 3 (lyrics, originality) | R1-R4b; 8, 9.1, 10.1-10.3, 14.1, 14.3 | M1 | confirm AC10, AC11 (optional) |
| M2b Remade video (Copilot) | 1 (video half) | R5, R7; 9.2-9.4 | M2a | - |
| M3 Visual quality and images | 3, 4 (images) | R6, R8; 10.4-10.8, 11.3; T15, T18; thumbnails; web timeline editor | M2b | Gemini key, kie Midjourney, eval OpenRouter key, codex device login in `mdf-img` |
| M4 Publishing | 5 | R9; 12.2-12.6; T17, T19; project page hub; `post.` and `/m/` | M3, P0 | Blotato key |
| M5 Autopilot | 1 (Autopilot), success criterion | 6.5; flag `autopilot` | M1, M3, M4 | remake defaults |
| M6 Daily loop | 6 | 13 | M5, `main` cutover | confirm AC6 (optional) |
| M7 Premium | 4 (premium) | Higgsfield, T14 | M3 | Comfy Cloud key |
| M8 Portable runtime | - | 25 | M6 | Debian server later |
| W1 Remote web UI | - | 5.4 browser URL, `api.` host, Access decision | M1, DNS | none |
| UI track | - | 1080p previews, karaoke mode (plan) | T12 | - |
| Later | - | T11b, T16, T20, T21, T22, Riffusion items, direct Anthropic client | M4 | - |

### 21.2 M1 contents checklist (the single source for M1)

**Base:** a branch from the head of `build/studio-ui` when M1 planning starts; T12 is already
there and is wrapped like everything else.

**Step 0, spikes (one day each, written results in the M1 plan):**
1. `oidc-provider` plus the claude.ai connector flow (6.4), with the `@node-oauth/oauth2-server`
   fallback; record the connector redirect URIs.
2. Supabase CLI with a changed `postgres` password and `--db-url` for the commands M1 uses; the
   exact `config.toml` field for a new JWT secret (5.3); the container probe.
3. The MCP SDK version with `WebStandardStreamableHTTPServerTransport` in stateless JSON mode
   inside a Next 16.4 route handler (7.1), with the `mcp-handler` fallback.
4. Confirm that a `Next-Action` POST to an allowed page reaches another action in the pinned Next
   16.4.3, and that the two locks of 5.2 stop it.

**Step 1, topology and operations:** `ops/services.ts`, `ops/edge-proxy.ts`, `ops/deploy.ts` and
`ops/set-owner.ts` (20, 6.2), `ops/rotate-supabase-keys.ts` and `ops/rotate-auth-keys.ts` (5.3,
6.4), `ops/e2e-stack.ts` (19), the `cloudflared` template, Supabase hardening (5.3), server-side
sign-in and `/auth/confirm` (5.4), `/media` streaming, `/api/health`, the proxy matcher, binding to
`127.0.0.1`, README rewrite, keepalive workflow deleted.

**Step 2, database:** migrations in this order: `ops_roles`, `ops_tokens`, `spend_ledger`,
`notifications`, `ops_scopes` (last, so its revokes and default-privilege changes see every object;
it also creates every `ops` function and the grants of 6.3.2); seeds for `price_book`,
`provider_operations`, `spend_caps`, `scheduled_tasks`; `supabase/tests/acl-allowlist.json`.

**Step 3, gates move:** `PASS_SCORE`, `combine()`, `CRITERIA`, the judge prompts, the judge model
ids (`DEFAULT_JUDGES`) and the Jev model id (`JEV`) move from `lyric-jury.ts` into
`packages/gates/src/lyric-jury.ts`, with the values in `config/gates/lyric-jury.json` (JSON,
validated by a zod schema in `packages/gates`); the QA thresholds of `qa.ts:90` into
`config/gates/qa.json`. Writer model ids stay in the worker (they are not gates).

**Step 4, ops layer and API:** every M1 row of 7.3 through `lib/ops/*` and `ops.*`; server actions
moved onto it through `runAction`/`remoteAction`; `/api/v1` with the contract of 7.2; schemas
moved to `packages/shared/src/ops/`.

**Step 5, agents:** `apps/auth`, `/consent`, protected resource metadata, `/api/mcp`,
`packages/cli` with the stdio bridge, the skill, Settings > Agenti and Settings > Costi.

**Step 6, worker:** `worker_enqueue` propagation, `providers/paid.ts` and the `engine.run` rule,
reservation claim and settle, per-job fakes, the scheduler and its M1 tasks, upload ingestion,
the ntfy sender; the engine-repo change for `MELLODIFAI_NO_KEYFILES` (11.5).

**Files** (C = create, M = modify, D = delete):

| Area | Files |
| --- | --- |
| ops scripts | C `ops/services.ts`, `ops/edge-proxy.ts`, `ops/deploy.ts`, `ops/set-owner.ts`, `ops/rotate-supabase-keys.ts`, `ops/rotate-auth-keys.ts`, `ops/e2e-stack.ts`, `ops/cloudflared/config.template.yml` |
| web, create | `apps/web/lib/ops/**` (including `tokens.ts`), `apps/web/lib/mcp/**`, `apps/web/lib/db/ops-client.ts`, `apps/web/app/api/v1/**`, `apps/web/app/api/mcp/route.ts`, `apps/web/app/api/health/route.ts`, `apps/web/app/.well-known/oauth-protected-resource/**`, `apps/web/app/consent/**`, `apps/web/app/(app)/settings/agents/**`, `apps/web/app/(app)/settings/costs/**` |
| web, modify | `apps/web/app/actions/**`, `apps/web/lib/run-action.ts` (adds `remoteAction` and the remote refusal), `apps/web/lib/auth.ts` (session id for `p_ctx`), `apps/web/lib/supabase/server.ts`, `apps/web/proxy.ts`, `apps/web/app/auth/confirm/route.ts`, `apps/web/app/(auth)/login/page.tsx`, `apps/web/lib/redirect-url.ts`, `apps/web/components/login-form.tsx`, `apps/web/app/media/[...path]/route.ts`, `apps/web/lib/studio/clips.ts`, `apps/web/lib/studio/stems.ts`, `apps/web/app/(app)/projects/[id]/page.tsx`, `apps/web/app/actions/format-style.ts`, `apps/web/app/api/transcribe/route.ts`, `apps/web/lib/openrouter-key.ts`, `apps/web/app/(app)/settings/page.tsx`, `apps/web/lib/rate-limit.ts`, `apps/web/next.config.*` (`allowedOrigins`), `apps/web/package.json` (`next start -H 127.0.0.1`), `apps/web/e2e/global-setup.ts`, `apps/web/e2e/local-env.ts` |
| auth server | C `apps/auth/**` (including `redirect-allowlist.json`) |
| shared and gates | C `packages/shared/src/ops/**` (including `errors.ts`, `reads.ts`), `packages/gates/**`, `config/gates/**`; M `packages/shared/src/stages.ts` (resource classes), `apps/web/app/actions/schemas.ts` (re-exports) |
| worker | C `apps/worker/src/providers/paid.ts`, `apps/worker/src/providers/kie-client.ts` (moved from `kie/client.ts`), `apps/worker/src/scheduler.ts`, `apps/worker/src/notify.ts`, `apps/worker/src/uploads.ts`; M `apps/worker/src/db.ts`, `apps/worker/src/loop.ts`, `apps/worker/src/main.ts`, `apps/worker/src/workspace.ts`, `apps/worker/src/engine.ts`, `apps/worker/src/authorization.ts`, `apps/worker/src/fake/index.ts`, `apps/worker/src/stages/generate-song.ts`, `draft-lyrics.ts`, `lyric-jury.ts`, `qa.ts`, `replace-section.ts`, `import-audio.ts`, `score-takes.ts`, `timing.ts`, `local-engine.ts`, `source-audio.ts`; D `apps/worker/src/kie/client.ts` |
| engine repo | M `C:\Users\Asus\Documents\suno-remake\tools\kie.mjs`, its `whisper_words.py` (honour `MELLODIFAI_NO_KEYFILES`) |
| cli | C `packages/cli/**` (including `skill/`) |
| database | C the five migrations, `supabase/tests/ops_acl.test.ts`, `ops_errors.test.ts`, `ops_*.test.ts`, `acl-allowlist.json`, a test helper `opsCall`; M `supabase/config.toml`, `supabase/seed.sql`, the ten existing `supabase/tests/*.test.ts` files that call RPCs directly; `.gitignore` (`supabase/signing_keys.json`) |
| repo | M root `package.json` (`test:db` guard), `README.md`, `.github/workflows/ci.yml`; D `.github/workflows/keepalive.yml` |

**New dependencies:** `@modelcontextprotocol/sdk` and `postgres` (web), `oidc-provider` (auth).
**No** JWT library, no keyring library.

**Done when:**
- Claude Code over stdio and claude.ai over remote MCP each complete `song_create`, `job_status`
  and `lyrics_approve` with a `test_mode` token on the real instance; every job they cause runs on
  fakes and the ledger has no entry for them;
- the reservation-path database test of 19 passes on the e2e stack;
- the Inspector checks of 19 pass on both transports;
- a revoked PAT and a revoked grant fail on the next call;
- the 6.3.7 exit tests, the ACL test and the error-map test pass;
- a demo-secret JWT is refused, and the container probe of 5.3 fails to connect;
- 20 parallel reservations against a fresh window never exceed a cap;
- a new allowlisted user is a customer, cannot be given tokens, and is refused kie by its cap;
- the tunnel smoke test passes;
- `ops/deploy.ts --to <the commit that adds ops_scopes>` succeeds and `--to` an older commit is
  refused.

**Deferred from M1 to M2a (scope relief, round 3 Nit 9):** `price_book_sync`, `kie_reconcile`, the
OS keyring for the CLI, `Last-Event-ID` resumption of the SSE stream, and token access to media
bytes and file-bearing editor operations.

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
| Windows account `mdf-web` and the firewall rule of 5.2 (both need administrator rights) | M1 hardening | owner (author gives the exact commands) | Next under the owner's account; loopback binding only | open |
| kie USD rate per credit | M1 price book | owner | 0.005 USD per credit, `verified = false` | open |
| Separate, lower-limit OpenRouter and Groq keys for Next (7.5) | none | owner (optional) | Next uses copies of the worker's key values | open |
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

Revision 2 claimed every round-1 finding resolved; round 2 showed that 13 of the 17 Blockers and 10
of the 31 Majors were only partly resolved. Revision 3 answered round 2; round 3
(`docs/egm/agentic-studio/goldfish_review_round3_m1.md`, M1 only) found that R2-B1 was only partly
closed and R2-B2 had residue, and raised 5 Blockers, 20 Majors and 9 Nits. Revision 4 answers round
3 (28.0). The round-2 and round-1 tables (28.1, 28.2) are kept as they stood after revision 3,
except that R2-B1 and R2-B2 now point to 28.0. "Partly" names what remains.

### 28.0 Round 3 findings (M1 readiness)

| Id | Disposition |
| --- | --- |
| Blocker 1 | Fixed in 6.3.1-6.3.2 and 6.3.6: `mdf_ops` replaced by `mdf_web` and `mdf_auth`, which get USAGE on `ops` and EXECUTE only on the named `ops` functions; mutating `public` RPCs are granted to nobody (the security-definer wrappers run as their owner); exit tests prove `mdf_web` and `mdf_auth` cannot execute any `public` function even after `set_config`. |
| Blocker 2 | Fixed in 6.3.2, 6.3.3 and 15.1: `alter default privileges for role postgres` revokes functions, tables and sequences from `public`, `anon`, `authenticated` in `public` and `ops`; explicit revokes on every new object; `ops_scopes` runs last; the CI ACL test compares every object's grants with `acl-allowlist.json`. |
| Blocker 3 | Fixed in 11.5 and 15.1: caps and counters keyed `(scope, key, provider, unit, period)`; `default:customer` has `('', usd, day, 0.10)` and `(kie, credit, day, 0)`; user fallback rule; the 6.3.7 exit test traced on paper (kie refused, OpenRouter allowed). |
| Blocker 4 | Fixed in 11.5 and 15.1: no wall-clock expiry while the job is queued or running; expiry only for terminal or missing jobs (ambiguous from `kie_submit_state`) and stale web-side entries; `job_spend_rule` per stage, engine and resume; fake jobs need none; grandfathered jobs reserve on demand; settle by entry id, including `ops.settle_spend` for web-side calls; the done-when uses `test_mode` with zero ledger entries plus a separate reservation-path test (19). |
| Blocker 5 | Fixed in 6.3.6, 7.2 and 7.3: token reads through named `ops` read functions with explicit owner filters and frozen shapes (`SongSummary`, `SongDetail`, `JobStatus`, `JobEvent`, `CostsSummary`, `Notification`); uploads through Next staging, `ops.upload_intent` and worker ingestion; the admin function list; the frozen error-code table and the ordered mapping from existing RPC messages, with a test. Token access to media bytes and file-bearing editor operations is deferred to M2a (stated in 7.3 and 21.2). |
| Major 1 | Fixed in 6.3.2: revokes for `projects` INSERT and `jobs` UPDATE, the cancel policy dropped and replaced by `ops.job_cancel`; storage policies named; the delete policy gains its profile check; the token view uses `security_invoker = true`. |
| Major 2 | Fixed in 7.2, 7.3 and 11.5: the paying stages come from `job_spend_rule` (kie cover and extend inside `generate_song` by source; `import_audio` pays Groq only); wrappers find their jobs by `created_at = now()`; responses return a `jobs` array. |
| Major 3 | Fixed in 11.5: every ledger signature, item lists with units, settle by entry id. |
| Major 4 | Fixed in 11.5: counters inserted with `on conflict do nothing`, then locked in one fixed order by every ledger function. |
| Major 5 | Fixed in 11.5 and 21.2: the `engine.run` rule for paid `secretEnv`, `MELLODIFAI_NO_KEYFILES` with the engine-repo change, Groq reserved for `import_audio`, `timing` and take scoring, the missing files listed. |
| Major 6 | Fixed in 3 and 7.3: `resolve_upload` is cookie-only and admin-only; uploads have their own operation; section 3 lists every admin check. |
| Major 7 | Fixed in 6.3.6 and 6.3.7: `ops.stage_retry` refuses `publish` and `set_privacy` for tokens and customers, with an exit test. |
| Major 8 | Fixed in 6.2, 15.1, 19 and 21.2: roles copied at migration time, `ops/set-owner.ts` by `MELLODIFAI_OWNER_EMAIL` at deploy, unique index on `lower(email)`, seed and e2e setup with roles, the ten test files and `ci.yml` in the Modify list, CI throwaway signing key, `CI=true` guard, `ops/e2e-stack.ts` for the role passwords. |
| Major 9 | Fixed in 5.3, 6.4 and 20: migrations in the deploy script, no automatic rollback across a migration, a migration floor for `--to`, the health check through `ops.health()`, a key rotation script, and an OAuth fallback that keeps AC15 and needs no JWT library. |
| Major 10 | Fixed in 7.2: the key is opened in its own committed transaction and closed atomically with the work; the web-side multi-step case is stated. |
| Major 11 | Fixed in 3, 7.1 and 21.2: base branch named, T12 folded into `ops_scopes`, no separate T12 migration. |
| Major 12 | Fixed in 5.4 and 21.2: `/auth/confirm` is Modify with `token_hash` or `code` and a validated `next`; the `code` rewrite is kept; login page and `redirect-url.ts` listed. |
| Major 13 | Fixed in 5.2: the edge proxy refuses `Next-Action` outside `/login` and `/consent`, `runAction` refuses remote calls, `remoteAction` only for sign-in and consent, a wrapping test, and a step 0 check. |
| Major 14 | Fixed in 5.1: Next and `apps/auth` bind `127.0.0.1`; remote when `x-mdf-remote`, `cf-connecting-ip` or `cf-ray` is present. |
| Major 15 | Fixed in 7.5 and 17: Next has its own OpenRouter and Groq keys; `openrouter-key.ts` stops reading the worker's env files. |
| Major 16 | Fixed in 7.1: the SDK's web-standard Streamable HTTP transport in stateless JSON mode (no SSE on `/api/mcp`, so no keepalive there), pinned in the step 0 spike, with the `mcp-handler` fallback. |
| Major 17 | Fixed in 6.4 and 6.9: an admin-only test box at consent, `fake_providers` derived from the token row, propagation through `worker_enqueue`, the real env var `WORKER_FAKE` with `main.ts` and `workspace.ts` listed, test versions refused for real paid or publish operations. |
| Major 18 | Fixed in 6.4, 6.7 and 15.1: `agent_tokens.grant_id` and `oauth_consents`, the joins and return of `resolve_access_token`, the scope intersection rule, key storage, edge-proxy limits for registration, `/oauth/*` and `/login`, a redirect URI allowlist, consent defaulting to `read`. |
| Major 19 | Fixed in 6.3.1, 6.3.4, 6.4 and 17: separate `mdf_auth` with only the storage functions, `session_id` checked against `auth.sessions`, admin operations refused remotely (except closing remote access), threat model corrected. |
| Major 20 | Fixed in 5.2 and 5.3: the firewall is not relied on against containers; the Postgres password change is mandatory and the container probe is an M1 exit criterion. |
| Nit 1 | Fixed in 11.5 and 6.6: windows in Europe/Rome, a `run` sentinel, the token cap only in `spend_caps`. |
| Nit 2 | Fixed in 6.3.4: wrappers return result JSON and do the failing work in a savepoint, so audit rows and `cap_hit` notifications persist. |
| Nit 3 | Fixed in 6.3.2: `search_path = ''` on every `ops` function, schema `ops` closed to `public`, checked by the ACL test. |
| Nit 4 | Fixed in 15.1 and 14.4: `on delete` rules, `oauth_store` indexes and `purge_oauth`, the view named `agent_tokens_public`, `resource_class` set by a trigger. |
| Nit 5 | Fixed in 3. |
| Nit 6 | Fixed in 5.2, 7.3 and 21.2: the Suno share-link row, `lib/auth.ts` and `authorization.ts` listed, `allowedOrigins`. |
| Nit 7 | Fixed in 6.2, 6.4 and 15.1: tokens resolved without cache (only flags cached, and the kill path revokes rows), OAuth grants expire after 90 days and renew at consent, customers hold no tokens in M1. |
| Nit 8 | Fixed in 21.2 step 3: judge model ids and the Jev id move too; `config/gates/` is JSON validated by zod. |
| Nit 9 | Accepted: `price_book_sync`, `kie_reconcile`, the keyring, `Last-Event-ID`, and token media and editor file operations are deferred to M2a (21.2). |

**Counts for round 3:** 5 of 5 Blockers fixed; 20 of 20 Majors fixed, 0 deferred; 9 of 9 Nits
fixed or accepted. The two remaining unknowns are spike items with written fallbacks, not open
decisions: the exact `config.toml` field for the JWT secret, and the SDK version that ships the
web-standard transport.

### 28.1 Round 2 findings

| Id | Disposition |
| --- | --- |
| R2-B1 | Partly closed by revision 3 (round 3); closed in revision 4 by round-3 Blockers 1, 2, 4 and Major 1 (28.0). Revision 3 text: resolved in 6.3: exact revokes (jobs insert grant and policy, versions grants, every public function), deny-by-default EXECUTE, `mdf_ops` and schema `ops`, reservation inside the wrapper transaction, worker refusal without a reservation and the paid-call module (11.5), cookie-only admin-only publishing until M4, exit tests. |
| R2-B2 | Residue found by round 3 (Major 8), closed in revision 4 (28.0). Revision 3 text: resolved in 3 (corrected) and 6.2: `admin_allowlist.role` default `customer`, trigger change, backfill with the owner check, database test (21.2). |
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

### 28.2 Round 1 findings

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
