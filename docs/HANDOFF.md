# Handoff: how Codex (gpt-6-astra) or any agent takes over MellodifAI

Read this first if you are picking up the work without the previous Claude session. It is
the single source for where things stand, the rules, and how to continue. Keep it current:
when you finish or change something listed here, edit this file and commit it.

Last updated: 2026-11-08.

## 1. What the product is

MellodifAI is the owner's personal (later SaaS) agentic music and video studio. Core
workflow "Rifai da YouTube": paste a YouTube link, analyse it (timing, structure, mood),
rewrite the lyrics with the same meaning and vibe in new words (optionally another
language), generate a new song with Suno through kie, make graphics judged by a jury,
render, and auto-post to YouTube at the lowest cost. Agents (Claude, ChatGPT/Codex, Cursor,
Gemini) drive the app through a CLI and MCP on the owner's own subscriptions.

- Repo: `C:\Users\Asus\Documents\mellodifai`, remote `https://github.com/stefandsl/mellodifai-app.git`.
- Integration branch: `build/studio-ui` (everything merges here; it is pushed).
- Master design: `docs/superpowers/specs/2026-11-01-agentic-studio-design.md` (revision 6).
- Stack: pnpm monorepo - `apps/web` (Next.js 16, Turbopack), `apps/worker`, `packages/shared`,
  `packages/visualizer` (Remotion), `packages/remake`; Supabase local in Docker.

## 2. Rules you must follow (owner's standing instructions)

- Work autonomously: test, commit, push and merge without asking. Deliver finished work.
- Never spend kie or any other paid credits in tests. Local engines never fall back to kie.
- Never print, log or commit keys, tokens or passwords (Higgsfield, COMFY_CLOUD, kie,
  OpenRouter...). Keys live in gitignored `.env.local` files the owner fills in himself.
- Never upload the owner's videos to external hosts without his authorization.
- Publish publicly only by his rule: auto-schedule with a veto window.
- Disk: never write databases, caches, logs, transcripts, model weights or test data on C:.
  Use `E:/mellodifai/...` (runtime, reports, render-tmp, logs) or `G:\caches`. If C: has
  less than 20 GB free, stop and report. Never delete files you did not create.
- Playwright / e2e only on an isolated test stack (normally Next on 3210, Supabase API 45621).
  Never on the live stack (Supabase API 44321).
- The Supabase CLI is `npx supabase` (cached v3.0.0). Never factory-reset Docker. Migrations are additive only, each with database tests.
- No em dash characters anywhere (use "-"). Plain commit messages, no co-author lines.
- Do not commit `apps/web/AGENTS.md`. Do not change the owner's account settings.
- Every new relative `.js` import inside `packages/shared/src` needs a matching
  `turbopack.resolveAlias` entry in `apps/web/next.config.ts`.
- After any merge in a checkout: `pnpm install --frozen-lockfile` before trusting the gates
  (a red gate with "Cannot find package" or TS2688 means node_modules is stale, not code).
- Git Bash rewrites arguments like `/api/v1`; prefix such commands with `MSYS_NO_PATHCONV=1`.

Gates (all must be green before a merge or push of finished work):

If the source checkout is on C:, run these gates from an isolated source copy
under `E:/mellodifai/tmp`, excluding .git, .claude, .superpowers, node_modules,
dist, .next, .env.local and existing build-info files. Install there with
`--ignore-scripts` and an explicit
`--store-dir E:/mellodifai/cache/pnpm`. Set TEMP/TMP/TMPDIR to
`E:/mellodifai/tmp`, npm_config_cache to `E:/mellodifai/cache/npm`, and
npm_config_store_dir to `E:/mellodifai/cache/pnpm`. This keeps TypeScript's
project-reference build outputs and every package's default test cache off C:;
setting TEMP alone does not redirect pnpm's store or tsbuildinfo. Do not change
the owner's global package-manager settings. Preserve pre-existing caches;
relocate only task-created files with a path/hash manifest.

```bash
pnpm install --frozen-lockfile
pnpm lint
pnpm typecheck
pnpm --filter web exec tsc --noEmit
pnpm test
pnpm test:db      # needs the e2e stack env (see the M1 plan, "How tests reach a stack")
pnpm e2e          # e2e stack only
```

## 3. Where things stand (2026-11-08)

Merged into `build/studio-ui` and pushed (all unit gates green after each merge):
- T26 preset polish; T28 no built-in branding + user logos; T27 "Rifai da YouTube" + AI lyric
  buttons; 1080p minimum / 4K + local upscaler (render-4k); repo-audit fixes (kie paid-retry
  guards, Suno redirect checks); karaoke "Testo" view; per-song storyboard, thumbnail, metadata
  and CTR thumbnail check (song-assets); re-render after approval (rerender); UI polish pass;
  test-flake fixes; full database + e2e suites green on a private stack (suite-health); 17
  browser journeys of the owner's daily flows, single upload per publication (e2e-coverage);
  opt-in "Vetro" look: cover-colour ambience, glass surfaces, karaoke themes (glassy-ui,
  clean-room from a GPL app; never copy its code).
- Plans: M2a, M2b, M3, M4 in `docs/superpowers/plans/2026-11-03-*.md`, each with an
  `*-open-review-findings.md` file to settle in the execution preflight.
- Not merged on purpose: `feat/perf` (tiny gains, a behaviour change, an untested index).
- Every studio-ui migration up to `20261103070002` (and rerender `20261103050001-3`) is applied
  to the live stack.

M1 Tasks 1-46 are implemented. Task 47 (Cloudflare tunnel/DNS and the external
connector round trip) remains an owner gate and is out of scope for this release.
The final review and fix pass is being validated on an isolated stack before
integration and deployment. Current production remains at
`m1-prod-ports-20261108-r3` (`bbcfb00`) until that release succeeds.

Final-review evidence: `E:/mellodifai/codex-streams/m1-final/review.md` and
`report.md`. The private project is `mellodifai_m1_final`, API 46621, DB 46622,
Next 3241, auth 3211 and edge 3212; runtime and source copy are under
`E:/mellodifai/tmp/m1-final-*`. Launcher 3210 must never be stopped. Unit tests
use real dispatch with fake test dependencies; only browser tests set
WORKER_FAKE=1. Limit Vitest workers to four on this shared machine.

The final review fixed real OAuth adapter JSON serialization, consent/control
labels, static chunk forwarding, ambiguous-spend operation flags, tunnel
readiness and independent-stack test fixtures. The last migration remains
`20261103080001_ops_alignment_lockdown.sql`; a test enforces that ordering.
The separate local engine repository needs environment-only credential commit
`38556c8234519fd04ac3edc2a1351cb6cb034421` (18 tests independently passed).

## 4. Next steps for Codex, in order

1. Complete the final merged-tree gates, integrate into studio-ui/main and deploy
   a reviewed tag using `pnpm ops deploy.ts --to <tag>`. Record production health
   and the owner sign-in result in the final report. If release verification
   fails, restore `m1-prod-ports-20261108-r3` through the normal deployment command.
2. Task 47 stays pending owner DNS/Cloudflare setup. Do not create or start a
   tunnel as part of the final M1 release.
3. Then M2a: read its plan and open-review-findings file before implementation.

The M1 ledger is `.superpowers/sdd/2026-11-02-m1-agent-access/progress.md` in the
M1 worktree. Its PARKED rows and R4 artifacts are historical findings, with final
dispositions in the review report. Do not rerun completed production cutovers or
key rotations because an old task note below says they are pending.
The task driver remains `scripts/codex-sdd/run.sh`; `PLAN=` selects a later plan.
Owner actions are never faked. Migrations are additive and the lockdown stays last.
## 4b. Parallel workstreams runner

`bash E:/mellodifai/codex-streams/stream4.sh <name> <e2e-port>` creates `E:/mellodifai/wt/<name>`
on `feat/<name>` from `build/studio-ui`, runs a Codex builder (`gpt-6-sol`, reasoning high) from
`E:/mellodifai/codex-streams/<name>/brief.md`, then reviewer rounds; it never merges. A stream
ends with "DONE branch ..." in its `status.log`: read its report, merge into `build/studio-ui`
(renumber migrations if needed), run all gates, apply new migrations to the live stack with
`npx supabase migration up`, push. `SKIP_IMPL=1` reruns only the review loop. `stream-wt.sh`
does the same for an existing worktree (`WT=`, `BR=`, `BASE_OVERRIDE=`). `gpt-6-astra` returns
429 under parallel load, `gpt-6.1-sol` is refused on a ChatGPT account, and `codex-sol.sh` pins
`gpt-6-sol`.

To run test:db and e2e on a private Supabase stack (the shared e2e stack 45621 holds M1 schema), use a folder like
`E:/mellodifai/stacks/suite-health` (API 47621, DB 47622, Studio 47623, Mailpit 47624,
Next 3230). Copy `supabase/` there and give it a unique `project_id` and ports before
`npx supabase start --workdir E:/mellodifai/stacks/suite-health`. The CLI v3.0.0 defaults
to newer service image tags. Before starting, use `docker tag <cached source> <CLI tag>`
for these pairs, then verify each target resolves to the source image ID:

| Cached source | CLI tag |
| --- | --- |
| `public.ecr.aws/supabase/storage-api:v1.84.19` | `public.ecr.aws/supabase/storage-api:v1.88.0` |
| `public.ecr.aws/supabase/postgres:17.11.0.006` | `public.ecr.aws/supabase/postgres:17.11.0.011` |
| `public.ecr.aws/supabase/studio:2026.10.19-sha-b375769` | `public.ecr.aws/supabase/studio:2026.11.02-sha-a05e7ec` |
| `public.ecr.aws/supabase/edge-runtime:v1.77.8` | `public.ecr.aws/supabase/edge-runtime:v1.77.9` |
| `public.ecr.aws/supabase/realtime:v2.147.1` | `supabase/realtime:v2.151.3` |

Record the existing target IDs first, restore existing tags and remove only newly created
tags after startup. Do not prune Docker images: unrelated stacks share the daemon.
Keep `SUPABASE_HOME`,
`TEMP`, and `TMP` on E: and the npm cache on G:. Write `supabase status -o env` to a private
file under the stack folder, then map its `API_URL`, `ANON_KEY`, `SERVICE_ROLE_KEY`, and
`MAILPIT_URL` to `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, and
`MAILPIT_URL` for the test process. Set `E2E_PORT=3230` and `WORKER_FAKE=1`. Never print or
commit the status or test env files. `supabase start` prints development credentials, so
discard its output instead of saving an unfiltered startup log. For suite evidence, record
command exit codes and test summary lines without saving raw output.
`supabase/tests/song-assets.test.ts` now accepts any local non-live stack through the same
URL guard as Playwright.


## 5. Later work

M2a/M2b/M3/M4 from their plans; the per-language publishing hub (in M4); M5-M7 in the design;
perf ideas from `feat/perf` (only parts with measured gains); cleanup of old worktrees
(`git worktree list`, remove merged ones under `E:/mellodifai/wt`).

## 6. Waiting on the owner

Task 47: Cloudflare nameservers, login, tunnel configuration and external connector
verification. SMTP sender setup remains separate; local sign-in links work without
SMTP. Provider access, verified kie USD credit pricing, publishing credentials and
licences remain owner-controlled. GitHub Actions billing/spending-limit recovery is
an owner action; local gates are the release evidence. The canonical worker env-file
ACL repair described below remains an owner administration task if still needed.

## 7. Historical task records

These records preserve implementation and recovery evidence from both branches.
The current state in sections 3-6 supersedes their old pending-gate and deployment
statements. Do not replay a historical destructive recovery procedure.
Production port recovery (2026-11-08): production now uses API 44321 and DB
44322, with shadow 44326, inspector 44328 and pooler 44329. The original
54321/54322 bindings were blocked by Windows exclusion 54231-54330. Windows
`stack.ts start` refuses configured ports in dynamic range 49152-65535 or any
netsh IPv4 TCP exclusion before rendering or starting containers. Dev and CI
ports remain unchanged; their historical dynamic ports cannot start on Windows.
Database and browser test guards always reject the new production ports,
including with CI overrides. Auth now has the build script required by deploy. Deployment builds ops too;
production auth and edge launch compiled JavaScript because tsx fails in
`os.userInfo()` under the restricted Windows service accounts. Deployment
installs dependencies with `--package-import-method copy` so new package files
inherit the clone read ACL instead of the owner-only pnpm cache ACL.
Production deployment and health evidence is recorded in
`E:/mellodifai/codex-streams/prod-ports/report.md`. Startup task instructions
are in `docs/production-logon.md`. Existing production volumes must be reused.
Recovery deployed tag `m1-prod-ports-20261108-r3` (`bbcfb00`) through the
normal backup/deploy command. Health reports web/db/ops ok, schema
`20261103080001`, an empty queue and a fresh worker heartbeat. The owner link
established a session and `/library` returned 200. All 69 original data-table
counts (11,484 rows) matched after deployment; the same external database and
storage volumes remain attached. No reset, restore or paid call ran. The updated
Limited/Interactive logon task passed a live recovery attempt with exit 0.
The isolated e2e stack received pending additive migrations with `--include-all`;
its database gate now passes 296/296. The full unit suite passed 2,058 with one skip; final runtime/deploy
regression tests also pass. The previously recorded
browser gate has 21 passes and one OAuth registration failure (expected 403,
received 500 at `apps/web/e2e/oauth.spec.ts:67`); it remains an integration concern.

Task 46 adds the bundled `@mellodifai/cli`, its PAT-authenticated stdio MCP
bridge and the M1 agent skill. All twelve token mutations receive idempotency
keys, including create-scoped operations; ambiguous spend is never retried.
Windows login restricts the credentials file with icacls before replacing an
existing login. Use the same private E: APPDATA profile for login and MCP to
keep credentials off C:. The package has no runtime dependencies.
With pinned pnpm 10.2.1, pack from an off-C source copy using
`pnpm --filter @mellodifai/cli exec pnpm pack`, then install the tarball with
an E: npm prefix/cache. The direct filtered pack syntax in the design is not
supported by that pnpm version. The installed CLI passes inspector tools/list
against a fake HTTP server. Real dev-server inspector, database and browser
validation remain pending Docker recovery and dev/e2e stack startup; the
e2e API on 45621 still refuses connections. No production or paid call ran.
Review R1 treats unreadable or invalid successful MCP mutation replies as
ambiguous_spend. CLI tests select their own off-C runtime root, pack from a
disposable source copy and disable checkout-local Vitest caches.

Task 45 wires Playwright's three-server OAuth topology: Next on 3210 (the
local E2E_PORT=3219 ruling still applies), auth on 3211, and the local edge
proxy on 3212. OAuth browser traffic and the canonical MCP resource use
3212. CI provisions private auth material before starting the same topology.
The new oauth.spec.ts covers pairing, redirect validation, S256 PKCE,
read-only consent, missing/reused flow nonce refusals, token exchange,
song_get, revocation and a database refusal without matching consent.
Fixtures create no jobs and use test mode. The topology unit tests pass;
database and browser validation still need Docker recovery and the isolated
e2e stack on API 45621. GitHub Actions also reports an account billing or
spending-limit issue that prevents jobs from starting. The owner must resolve
that separately; no billing setting or paid service was changed.

Task 44 adds Settings > Agenti for local administrators: token creation with
one-time display, confirmed revocation, the remote MCP switch and pairing
status with a countdown and the claiming client's name, redirect host and time.
The page and actions use the existing admin-only ops functions; no migration
or paid call is needed. Remote PATs default to a 90-day expiry and test mode
is explicit. The settings navigation hides agent management from customers
and remote requests. Database/browser validation still needs the owner to
recover Docker and start the isolated e2e stack on API 45621.

Task 43 adds `/consent` and the authenticated `consentDecide` remote action.
The page requires a verified session and the starting browser's flow cookie,
shows escaped stored client details, and defaults to read-only permission.
Spend requires the exact stored client name, checked again on the server.
Only the database-authorized admin receives the fake-provider checkbox.
Successful consent navigates to the auth service's same-browser resume route.
The web cookie selection matches Task 42: `__Host-mdf_flow` on HTTPS and
`mdf_flow` on HTTP. The focused consent and server-action guard tests pass.
Database and browser gates remain pending owner Docker recovery: the e2e API
on 45621 refuses connections. No production deployment or paid call was made.

Task 42 adds `apps/auth` on pinned `oidc-provider@9.13.3`, with the Task 15
`mdf_auth` storage functions, hashed adapter IDs, browser-bound consent resume,
atomic pairing claims, exact connector callbacks and explicit MCP resources.
The provider records unchecked consent scopes as rejected, so a read-only
decision does not prompt again for create/spend. HTTPS uses `__Host-mdf_flow`;
loopback HTTP uses `mdf_flow`. Token validity follows the SQL grant rather
than the short browser session. Registration management is disabled.
`ops/rotate-auth-keys.ts --env prod|e2e|ci` provisions signing keys, cookie keys,
issuer and the role connection. Existing keys remain available for verification;
production rotations stop/restart auth and restore prior material on failure.
The service launcher starts auth directly with its canonical private env file.

Initial production and e2e auth material was provisioned on 2026-11-06, without
starting production services or changing database credentials. The existing
`mdf-auth` account is enabled. The production JWKS and auth env file have only
owner and `mdf-auth` ACL entries. E2E material lives under
`E:/mellodifai/secrets/auth/e2e/`; its `auth.env` selects port 3211 and issuer
`http://127.0.0.1:3212/oauth`. The actual entrypoint passed a discovery smoke
check using that file. Production service-account execution, the tunnel/connector
round trip and confirmation of the actual ChatGPT management-page callback
remain for owner setup and Task 47. Docker's Linux engine is still unavailable;
Task 42 database and browser gates fail at the e2e API connection on 45621.
Lint, both typechecks and the unit suite pass (1,967 tests, one existing skip).
Task 42 review R1 strengthens the missing-flow-cookie test while preserving
the signed provider cookies. A normal Docker Desktop startup still crashes
on the existing `AppData/Local/Docker/run/dockerInference` socket with
"The file cannot be accessed by the system"; starting `com.docker.service`
also fails. Owner recovery is required before the database/browser gates
can pass. No existing socket or Docker volume was deleted.

Task 41 adds stateless JSON MCP at `/api/mcp` using the spike-confirmed
`@modelcontextprotocol/server` 2.4.0 transport. Its sixteen tools use
`TOKEN_OPS` and the shared token runner, including rate limits, validation,
idempotency and operation errors. It also exposes the SongDetail resource
`mellodifai://songs/{version_id}` and the Italian `new_song` prompt
("Create a new song"). Both protected-resource metadata paths and the 401
challenge use the canonical OAuth resource from `ops/lib/auth-origins.ts`.
Next route smoke checks and focused unit tests pass. Database/browser gates
and the Inspector CLI run with a real dev PAT remain pending Docker recovery
and isolated stack startup. No live deployment or paid provider call was made.
Task 41 review R1 adds migration `20261102000043_resolve_pat.sql` and checks
PATs before every MCP POST, including discovery. The narrowly granted resolver
reuses `ops._actor` without requiring an operation scope; invalid, expired or
revoked PATs receive HTTP 401 with the resource metadata challenge. Apply this
additive migration before deploying the updated route. Its database tests and
the real-stack gates remain pending Docker recovery.
Task 41 review R2 supports the PAT-only dev origin (127.0.0.1:3001): its
metadata uses the dev MCP resource and omits authorization_servers, and its
401 challenge points to dev metadata. Opaque OAuth bearers remain refused on
dev; e2e/CI and production keep their canonical OAuth origins.

Task 40 adds the sixteen PAT-only `/api/v1` operations and the shared
`TOKEN_OPS` registry with HTTP method/path metadata. Routes use the existing
token runner for authentication, rate limits, idempotency and error mapping.
Token schemas retain the section 7.3 names and exclude upload sources and
video approval overrides. The database API suite is separate from unit tests:
`pnpm test:integration apps/web/app/api/v1/api.integration.test.ts`, with the
guarded e2e env loaded. Docker's Linux engine is still unavailable, so real
database/API/browser validation remains pending owner recovery of Docker,
e2e stack startup and application of Task 39's pending migration. No live
deployment or paid provider call was made.

Task 37 moves sign-in to server actions with neutral email responses and separate
five-attempt, fifteen-minute limits for sending and verifying a six-digit code.
Both actions have an explicitly unauthenticated, validated `remoteAction` path;
the existing authenticated path remains for consent. Local email callbacks must
match the stack allowlist; remote callbacks use server-only `SITE_URL` and only
accept `/consent?uid=...` as `next`. Next and the session proxy now use
`SUPABASE_INTERNAL_URL`. Stack rendering and Next share `ops/lib/auth-origins.ts`.
The required source template link remains, while CLI 3's `content_path` uses
`./compose/templates/magic_link.html`, staged inside the stack root. The internal
template service uses nginx from the existing pinned Kong image and an HTTP health
check. Render/start the target stack when deploying this change. Task 37 verified
actual email/code sign-in on API 45621 and Next 3219; production was not deployed.
Production SMTP remains an owner action, with `ops/sign-in-link.ts` as the local
no-SMTP fallback. The email link for OAuth must open in the starting browser;
the code can instead be entered in that original browser.

Task 36 adds the loopback edge proxy and the Cloudflare tunnel template.
`pnpm ops edge-proxy.ts` listens on 3080, forwarding the section 5.2 M1
allowlist to Next on 3000 and auth on 3010. It overwrites the public forwarding
headers, marks production requests remote, refuses other server-action paths,
and enforces section 6.7 per-IP limits. `--mode local` uses edge 3212, auth
3211 and Next `E2E_PORT` (3210 by default), without adding the remote marker.
`--listen`, `--next` and `--auth` override those local testing addresses.
Production retains the M1 allowlist. Per design section 19, local mode routes
OAuth/discovery to auth and other paths, including `/create`, to Next.
API/OAuth query strings and streamed responses are preserved.
Encoded or noncanonical paths are refused before
forwarding. Copy `ops/cloudflared/config.template.yml` into the private
runtime secrets folder and fill the owner-created tunnel ID and credentials
path; keep ingress unchanged for the existing drift check. DNS, tunnel login
and tunnel creation remain owner actions. Task 36 does not start a live tunnel.

Task 33 cut over the live Supabase stack to `E:/mellodifai/stacks/prod` after
verifying a fresh data backup. All 52 original table counts matched before and
after cutover and after the reviewed restore, 11,409 rows total. The production
app now runs at `m1-floor` (`12cecd6`), with schema `20261103080001`. Local
health reports `web`, `db` and `ops` as `ok`, and the worker heartbeat is fresh.
The post-deploy security probe passes. The owner signed in with a local link,
opened the RLS-backed library and renamed one song through `ops.song_rename` as
`mdf_web`; its original title was restored. No paid action ran. The older target
was refused without interrupting health. The exact backup, recovery command and
checks are in the plan's Task 33 Deploy log.

The deploy web and auth env files now have the production Supabase settings.
The install-created deploy worker `.env.local` is empty and inaccessible to the
non-elevated owner session, so the running worker reads the owner-and-SYSTEM-only
`E:/mellodifai/config/worker.env`. An administrator must repair the original
file's ACL before moving these values to that canonical path. Updated ops tooling
prefers the canonical file and uses the temporary file only when the canonical
file is missing, empty or unreadable. Use the updated invoking checkout for the
next service restart or deploy after the repair. The service host
starts Next directly under `mdf-web`, because pnpm could not resolve that
account's home directory. Review R1 reconciled the shared e2e schema from the
checked-in migrations after a private backup. Run `stack.ts reset --env e2e`
followed by `stack.ts migrate --env e2e` to restore fake mode before tests.
The database gate now passes 289/289 and the browser gate passes 19/19 on API
45621 and Next 3219. SMTP, DNS and tunnel setup remain owner actions.

Task 34 adds `pnpm ops rotate-supabase-keys.ts`. It rotates the external ES256
key and `secrets/supabase/jwt-secret`, restarts the pinned Compose stack,
updates the deploy web/worker env files, rebuilds the web bundle and restarts
those services. Failures restore the previous credentials and rebuild; failed
recovery retains an owner-only `secrets/supabase/rotation-*.backup`.
The production step remains pending: the canonical deploy worker env file is
still empty and access-denied. An administrator must repair its ACL and move
the active `config/worker.env` values there before rotation. The tool refuses
before changing keys or stopping services while that prerequisite is open.
Production keys were not changed; the local owner sign-in and library read
still work. The throwaway production-like stack verifies real rotation,
working new credentials, and refusal of old keys and a demo-secret JWT.
Task 34 lint, typechecks, unit tests (1,770) and database tests (289) pass.
The browser gate had three failures; lyrics-editor navigation and rerender
passed on retry, while the existing French publication flow still times out
at its overall 60-second limit waiting for `FR Pubblicato`.
Review R1 makes every rotation and rollback service subprocess receive the
off-C temp/cache environment before tsx starts. Regression tests verify both
activation and recovery calls, including the preserved runtime root.
R1 gates pass lint, both typechecks, 1,772 unit tests, 289 database tests and
the real throwaway rotation integration. Browser tests pass 18 of 19; the
French flow reaches its 60-second limit waiting for the visibility confirmation
dialog at `flow.spec.ts:106`.

Docker Desktop's disk image is still on C:. Moving it to G: through Docker
Desktop > Settings > Resources > Advanced > Disk image location is an owner
maintenance action. The accepted M1 progress ruling permits the existing
daemon for dev/e2e/spike work in the meantime; workdirs and evidence stay on E:.

M1 Task 5 completed its Spike 2 runtime prerequisite with pinned local images.
The decision is the pinned self-hosting compose fallback: the CLI did not safely
restart the full stack after database password rotation. See the plan's Spike 2
record for the verified source revision, image pins, service adaptations and
required Task 6 equivalents. CLI 3.0.0 rejects inbucket; use local_smtp in TOML.
Task 5 provides ENV_TABLE, renderConfig and prepareStackDir. Task 6 must call
prepareStackDir for repository links and supported CLI pins, then translate the
rendered settings into the pinned compose backend. Owner SMTP remains unconfigured.
Task 5 final validation passed after review R2: 124 database tests and 3 e2e tests
on API 45621 and Next 3210. The conflicting Next process on the reserved e2e port
was stopped for this run. Keep 3210 available for isolated e2e validation.

M1 Task 6 implements the pinned Compose stack backend and `ops/stack.ts`.
The e2e stack now runs from `E:/mellodifai/stacks/e2e` on API 45621. Its former
CLI containers were stopped with their data retained; production was untouched.
Use `pnpm -s ops stack.ts env-file --env e2e` for the private test environment
path. Do not print its contents. `start` and `migrate` reapply role passwords
and verify database and authenticated API readiness. The empty `ops` namespace
is bootstrapped for PostgREST; Task 14 still installs all objects and fake_stack.
Task 14 will create mdf_web/mdf_auth; Task 6 reports them absent until then.
See `ops/compose/README.md` for secret files and the production Task 8 contract.
Production SMTP, cutover and owner hardening remain pending.
Task 8 now provides `rotateDbPasswords`, `reapplyDbPasswords` and the container
`probe`. Production activation remains gated by the owner and the roles migration.
Rotation persists every login credential in the owner-only external
`secrets/supabase/db-passwords.json`, re-templates Compose with the shared active
service password, and writes the app URLs under `<runtime root>/deploy/apps`.
Tasks 10/11 must call reapply and require a successful probe before the tunnel
starts. Probe failures name only roles/ports; e2e deliberately fails its open
Studio/mail/analytics checks. The integration suite verifies Studio is detected
on 45623 from both the container and the invoking host account. Host checks
cover IPv4 and IPv6 loopback and fail closed on timeouts or other errors.
Account-identity verification remains Task 35.
The later progress ruling reserves 3210 for the owner's launcher: start the e2e
stack with `E2E_PORT=3219`, then run browser tests with that same variable.
Task 7 adds `pnpm test:integration`, guarded by both `TEST_DB_URL` and
`SUPABASE_URL`, for `ops/test/**/*.integration.test.ts` and
`apps/*/**/*.integration.test.ts`. These files are excluded from stackless unit
tests. Load the private test.env before `pnpm test:db`, `pnpm test:integration`
and `pnpm e2e`; role fixtures always roll back. Local runs refuse production
ports even with `E2E_ALLOW_LIVE_STACK=1`; only isolated CI may set that flag
alongside `CI=true`. CI renders and starts its own pinned Compose stack and
masks test.env values before exporting them. The implementation branch now
triggers CI on push. Task 37 replaces `NEXT_PUBLIC_SITE_URL` with server-only `SITE_URL`.

Playwright starts Next through `ops/e2e-server.ts`. Each run copies source into
`MELLODIFAI_ROOT/e2e-servers/web-*` (CI: `RUNNER_TEMP/e2e-servers/web-*`), installs
the frozen dependencies there without lifecycle scripts, and launches Next there.
Local env files, dependency directories and generated files are excluded. This
keeps Next caches and generated files off C: even when `pnpm e2e` is invoked in
the C: worktree. Runtime copies are retained for diagnosis; the dedicated pnpm
store is under the runtime root's `cache/pnpm` directory.

Worker workspaces, fake media and subprocess temporary files now use
`RUNNER_TEMP` in CI or `MELLODIFAI_ROOT` locally (default `E:/mellodifai`).
Fonts default to `<runtime root>/fonts`; `MELLODIFAI_FONTS` can select another
font source. The existing local fonts were copied to `E:/mellodifai/fonts`
without modifying the legacy source. Fake workers do not need fonts.

OpenRouter privacy filter off (it swaps Italian words for tags); Windows accounts `mdf-web`
and `mdf-auth` plus the firewall rule; Google OAuth client JSON; Cloudflare nameservers and
`cloudflared` login; SMTP sender; codex login in the image container; an evaluation
OpenRouter key with a cap; kie credit price in USD; kie Midjourney access; Gemini, Blotato
and COMFY_CLOUD keys; Postiz account; Envato licences; YouTube OAuth.

M1 Task 9 adds migration `20261102000027_ops_roles.sql`: new allowlisted
accounts default to customer, existing profile roles are preserved, and email
matching is case-insensitive and unique. Migration 026 remains the merged
remakes migration. The planned M1 floor now ends at 20261102000035.
`pnpm ops add-user.ts <email> <admin|customer>` inserts the allowlist row before
creating the confirmed Auth user. It uses the production owner password store
and `apps/worker/.env.local` for the Auth admin client. If Auth creation fails,
the committed allowlist row remains; inspect the account before retrying.
`pnpm ops set-owner.ts` takes MELLODIFAI_OWNER_EMAIL from the process environment,
then `<runtime root>/config/ops.env`, and atomically leaves exactly one admin in
each table or rolls back. The owner must already have a confirmed profile.
`pnpm ops sign-in-link.ts <email> [site-url]` reads the worker's Supabase service
configuration and prints only a single-use link. Select the local origin with
the second argument, or SITE_URL; the default is http://127.0.0.1:3000. This
works without SMTP and establishes a cookie session through token-hash
confirmation. Treat the printed link as a credential. Confirmation request
logging is suppressed in development. The two approved production loopback
origins remain local even when the public hostname is configured. Production execution waits for the
Task 33 owner gate; no production account or role was changed by Task 9.

Task 9 review fixes isolate each remake test's lyrics budget in its own
scratch file and clean scratch directories after each test. E2E sign-in uses
the generated token-hash link, so the full browser suite does not consume
SMTP quota. The refused-address test still exercises the login form. Browser
traces are disabled to avoid retaining sign-in credentials. Owner-config and
CLI fixtures remove their complete temporary directories in finally blocks.
Use the full Chocolatey FFmpeg on PATH for fake-media tests; Miniconda's
FFmpeg lacks libmp3lame.

Task 9 review validation is now fully green: lint, both typechecks, 1,450 unit
tests passed (one existing skip), 136 database tests and all seven e2e tests.
Validation ran on the isolated e2e stack (API 45621, Next 3219), with runtime
files on E:. The earlier shared-budget and mail-quota concerns are resolved.

M1 Task 11 adds `pnpm ops deploy.ts --to <tag|main> [--skip-migrations]`.
It copies the invoking ops package and installs its locked dependencies under
`<runtime root>/ops-pinned/<timestamp>`, then runs there against the dedicated
`<runtime root>/deploy` clone. Every target must contain `m1-floor`; absent
floor tags are refused. Writers stop before the explicit production database
backup, while Supabase stays running. Backups record the previous revision;
only backups recorded by deploy are pruned after 14 days. Health requires local
`ops: "ok"` and the target's newest migration. A failed health check restores
the previous revision only if migration history is unchanged; otherwise services
stay stopped and `logs/deploy.log` records the failure without subprocess output.
First production execution remains the Task 33 owner gate: floor, cutover,
provisioned secrets, confirmed owner, runtime ACLs and service setup must exist.

M1 Task 12 adds owner-only `ops/restore.ts` and `ops/cutover.ts`; usage and recovery
limits are in README.md. Restore validates the floor before reset, preserves media,
and uses the existing deploy path with `--skip-migrations`. Cutover compares all
public/auth/storage table counts and adopts the legacy named volumes explicitly
under the pinned Compose backend. CLI 3 loopback reset needs remote SQL targeting
with subprocess-only local-port overrides; this was verified on API 45621.
The guarded integration suite dumps, resets, imports and downloads a real test
object, with backups retained under E:/mellodifai/tmp. Production cutover and
restore were not executed. Task 33 owner authorization, ACLs, credentials and
service-account prerequisites remain open; no owner action was fabricated.

M1 Task 13 adds `/api/health` and `lib/remote.ts`. Remote requests return only
`{ web: "ok" }`, bypass auth middleware, and do not query the database. Local
detail uses the existing cookie-authenticated reads, so metrics reflect RLS
visibility and anonymous requests may report `db: "error"` with HTTP 503.
Per preflight ruling 9, no service-role key was added to Next. `schema` is
explicitly null until Task 14 supplies applied migration metadata and the ops
write/read probe through narrowly granted `ops.health()` as `mdf_web`.
`pnpm --filter @mellodifai/web build` records `git describe --tags` in
`apps/web/.next/mdf-version`; absent metadata falls back to `dev`.

M1 Task 14 installs `20261102000028_ops_layer.sql`: restricted ops functions,
session/PAT actor resolution, idempotency opening, frozen error mappings,
flags, audit and heartbeat tables. The base `agent_tokens` table is included
here per preflight ruling 2; Task 15 must reuse it and add OAuth resolution
and token operations. OAuth currently fails closed. `mdf_web` connects through
`MDF_WEB_DATABASE_URL`; local `/api/health` now uses its write/read ops probe
and reports applied migration metadata without a cookie. Remote health remains
web-only. Stack start/migrate writes the fake-stack flag from `ENV_TABLE` as
postgres; callers cannot disable real caps. Existing application grants remain
until Task 32 lockdown. No production migration or owner action was performed.

M1 Task 15 adds `20261102000029_ops_tokens.sql`: local session-only token
administration, pairing claims, nonce-bound OAuth consent and adapter storage.
Token creation always inserts a 1 USD/day token cap. The `spend_caps` table is
created here per preflight ruling 3; Task 16 must reuse it for ledger seeds and
reservations. PAT and OAuth use recheck the owner's admin role and cap; remote
PAT use and OAuth resolution obey `remote_mcp` immediately.
Pairing closes atomically on the first registration and retains the client name,
host and time. Each Client storage payload retains private registration provenance
across later pairing windows; `oauth_find` hides that internal field and `jti`.
The adapter cannot replace that provenance or change nonce-bound Interaction params.
`oauth_consent_info` and `oauth_consent` are granted to `mdf_web`; the ten storage
and flow functions are granted only to `mdf_auth`. `resolve_access_token` returns
the identity object directly and raises on refusal; user-context functions return
the normal ops result envelope. OAuth actor contexts carry `access_token_hash`
and the canonical `resource`. `oauth_interaction_result` returns user_id,
client_id, scopes, test_mode and token_id once; Task 42 binds its resulting Grant
through `oauth_bind_grant`. Consent reconnects revoke prior rows, including expired
or abandoned grants, before creating the replacement. Production was untouched.

M1 Task 16 adds `20261102000030_spend_ledger.sql`: price/operation seeds,
reservations, entries and calendar counters, with atomic reserve and extend
functions granted only to service_role. User defaults resolve per cap dimension
but charge each actual user's counters. The customer USD/day default is 1.75:
the seeded strong-writer language estimate is 0.572445 USD and three times it
rounds up to that 0.25 step. Kie remains 0.005 USD/credit, explicitly unverified
pending owner confirmation. OpenRouter prices were fetched on 2026-11-03;
Jev was absent from the models API, so its official model page is the recorded
source. `withRealCaps` runs ledger tests in one transaction on the fake e2e
stack. The shared stage resource map matches the SQL insert trigger; local
generation/replacement uses GPU. Task 17 owns settlement, close and expiry;
Tasks 19/20 own paid wrappers, and Task 24 owns worker call enforcement.
No production migration or paid provider call was performed.

M1 Task 17 adds `20261102000031_ledger_close.sql`: bounded entry opening,
unclamped actual settlement, over-estimate reporting, and atomic terminal-job
close/expiry. Settled spend and open calls at estimate remain counted; only
unused charges are released. Kie recovery is limited to the reserved generation
or section edit, and unknown submissions retain their charges as ambiguous.
`worker_enqueue` copies the parent's token, run, fake flag and priority and
reserves the child atomically. `costs_get` returns owner-only spend and each cap's
own current period counter. Functions retain the exact worker/web grants.
Task 20 still owns administrative resolution of ambiguous submissions; Task 26
supplies the periodic expiry scheduler. No production migration or paid call was made.

M1 Task 18 adds `20261102000032_scheduler.sql`: service-role-only scheduler
claim/finish functions and the five M1 task rows. Claims skip locked rows and
recover after ten minutes; daily runs use the Europe/Rome date across DST.
Purges retain the specified boundary rows, revoke abandoned unbound OAuth
tokens, and cancel active jobs before trashing test versions older than seven
days. Task 26 supplies the worker scheduler loop. Only e2e was migrated;
production and paid providers were not used.

M1 Task 19 adds `20261102000033_ops_wrappers.sql`: the fifteen remaining
token operations, with actor-filtered reads, scope and test-run checks,
idempotency completion, audit, and atomic job reservations. Task 17's
`costs_get` remains the sixteenth token operation. The job stamp trigger
preserves test/token flags and handles reused stems/visualizer jobs; inserted
test-token versions are marked `test_run`. Shared read/input schemas are
exported through `packages/shared/src/ops`; the cookie create schema preserves
upload support while token create rejects upload sources. The existing
`JobStatus` string type remains compatible alongside the new Zod read schema.
Only the e2e stack was migrated. Task 20 owns cookie-only wrappers, and Task 29
still owns routing the existing server actions through the operations layer.
Task 19 review fixes limit cancellation to queued jobs. Remake analysis/rewrite
retries are refused through ops until their paid work has ledger coverage.

M1 Task 20 adds `20261102000034_ops_cookie_wrappers.sql`: 27 cookie-only
and local-admin wrappers, with ownership/test checks, claim clearing, audit,
idempotency and job reservations. Customer style-format and transcription
checks count 20 and 10 calls per Europe/Rome day; admins are not counted.
Publication confirmation refuses scheduled privacy. Kie resolution closes the
matching ambiguous generation or section-edit reservation, retaining charged
spend; the optional `p_edit` selects section-edit recovery. The current audio
keep RPC creates no timing job, but its wrapper reserves any jobs it enqueues.
Only e2e was migrated. Existing web action routing remains Task 29.

M1 Task 29 routes the eight planned action modules through 42 operation
definitions for the Task 19 and 20 wrappers. The old `runAction(work)` path is
removed. The action scan now checks an effective current-request remote guard.
Review R1 adds nine local cookie wrappers in migration
`20261102000038_ops_remake_wrappers.sql` for remake and lyrics-assist writes.
Their actions use the shared ops runner with verified session context, keeping
the existing UI result codes. `formatStyle` requires `ops.style_format_check`
before accessing OpenRouter. The visualizer comparison owns a fresh browser
context per test so fonts and suspended audio contexts cannot accumulate.
Only the e2e database was migrated. Production was untouched.

M1 Task 21 lands engine commit `38556c8234519fd04ac3edc2a1351cb6cb034421`
in `C:/Users/Asus/Documents/suno-remake` (no remote configured). All six engine
credential-file readers now refuse under `MELLODIFAI_ENV_ONLY=1` when a file
would be needed; YouTube's file-backed OAuth flow refuses entirely under the flag.
Kie, OpenRouter TTS and both Groq scripts support the base URL overrides recorded
in the plan's Spike results. Eighteen isolated engine tests pass without provider
calls. The normal lint/type/unit/database gates pass; browser validation has
two unrelated fake-stack failures (offline job consumed,
private-video alert missing), recorded in the Task 21 report and runtime log.

M1 Task 23 sets the flag after childEnvironment, rejects unaccounted paid
secrets in engine.run, and passes Groq entry IDs for uncached take scoring.
Task 24 owns the remaining worker paid-call mapping.

Task 23 review R1 adds migration 036, `ops.spend_entries_authorize`, granted
only to service_role. Engine authorization now checks open entries and open
reservations for every named provider; free grants are limited to the matching
Kie CLI operation. Scoring ledger refusals propagate to the worker loop.
Engine commit `83d8432` in `suno-remake` disables Whisper HTTP retries under
`MELLODIFAI_ENV_ONLY=1` and passes provider duration through the score report.
Use that engine revision with this worker. It is committed locally; the engine
repository still has no configured remote.

Task 23 reviews R2/R3 authorize paid names in the final child environment,
including process, dependency and per-call environment inputs. If preparing
take scoring fails before the engine call, already opened entries settle at
zero and the ledger failure still propagates.

Task 22 review R2 adds migration `20261102000035_fast_writer_price.sql`
for the default Sonnet 5.5 fast writer (verified OpenRouter prices: 2 USD input
and 10 USD output per million tokens). The planned lockdown migration now takes
038 or the next free number (Task 23 review R1 uses 036 for engine entry authorization). OpenRouter job retries extend every rule in the
database stage estimate before their first request, once per transport; refusal
blocks all requests. Partial extensions remain reserved until normal job close.

M1 Task 24 adds migration `20261102000037_openrouter_stage_rules.sql` for
`lyrics_assist`, `remake_analyse` and `remake_rewrite`, including the verified
OpenRouter bge-m3 embedding price. Engine spend entries are claimed once, so
one entry cannot authorize repeated subprocess calls. The worker reserves on
demand before Kie, OpenRouter or Groq work, extends the stage estimate on extra
attempts, settles submissions and timing, and marks unknown Kie submissions
ambiguous before failing their jobs. A refused lyric draft extension keeps the
best draft and records an incomplete jury. Only the e2e database was migrated;
production remains at the owner gate. Kie credit USD price remains unverified
until the owner confirms it.

M1 Task 26 adds the worker scheduler loop. It claims one due task every 30
seconds through the `ops` API, runs the claimed SQL body, records success or
error, and stops on worker shutdown. The `expire_reservations` integration
case passed on the e2e stack. No production scheduler was started.

M1 Task 32 adds `20261102000041_ops_lockdown.sql` after migrations 039 and
040. It removes authenticated direct writes to jobs, projects and versions,
revokes public write RPC access, and keeps the six browser read RPCs. The
remake and lyric editor polls now use `ops.my_remake` and
`ops.lyrics_assist_state` through local server actions. The ACL allowlist and
customer/admin JWT refusal tests pass on the e2e stack.
Production remains at the Task 33 owner gate. The ledger integration gate
now checks `E2E_PORT`; Task 35 passed all 18 cases on 3219 with the private
e2e environment loaded. The owner's launcher still holds 3210 and must not be
stopped by an agent.

M1 Task 35 adds a preview and administrator apply path for local service
accounts, ACLs and the LAN firewall rule. Review R1 fixes launch web and edge
as mdf-web, auth as mdf-auth, and cloudflared as mdf-tunnel once those accounts
exist. The installer stores DPAPI credentials under owner-only
secrets/services; installation and later startup must use the same Windows
owner in an elevated console on the same machine. Until installation, the documented owner fallback
applies. The host verifies the actual child identity before reporting ready.
A Windows Job Object kills the child process tree if its supervisor exits,
including a crash or forced termination. The tunnel supervisor checks upstream
port owners before readiness and every 60 seconds. The ACL probe enumerates
exact protected files and nested executable paths as the owner, then tests
those paths under each service account.

The R1 database gate is green again: 275 passed. The four missing historical
functions and their dependencies were restored on the guarded e2e database
from git history, with the reviewed service_role-only execute grants. No live
database was changed. This branch still lacks the source migrations for these
historical functions; a future e2e reset requires the recovery documented in
.superpowers/sdd/2026-11-02-m1-agent-access/task-35-report.md. Administrator
account/ACL/firewall setup and testing under the actual dedicated accounts
remain owner actions, together with DNS and tunnel credentials.

Task 35 review R2 closes three further gaps. Before account grants, install
resets ACLs recursively on deploy, secrets, stacks and backups while the
runtime root permits only the owner and SYSTEM. Existing descendant explicit
grants are removed; failures abort installation. The reset operates on links
themselves (/L), rather than following them outside the protected trees.
Direct __start cloudflared also reapplies database passwords and requires a
passing production probe. Both startup and the supervisor compare full Windows
account identities; local service accounts use COMPUTERNAME and fallback uses
the launcher's full Windows identity. These changes do not complete the pending
administrator installation or production tunnel owner actions.

Task 35 review R3 removes the process-start containment race. The Windows host
now creates the process suspended, assigns it to the kill-on-close Job Object,
verifies its owner and initial port prerequisites, and only then resumes it.
The native creation helper is ops/service-process.cs, compiled by Add-Type
with the host's E: temporary directory. Tests confirm no execution before resume
and termination of an immediately spawned detached grandchild when the host is
killed. Firewall reinstall updates the existing MellodifAI block LAN rule in
place; it creates a new rule only when absent and never deletes the old rule
before an update. Actual administrator account/firewall verification remains
pending with the existing owner actions.

M1 integration merges `build/studio-ui` into `build/m1-agent-access`. The studio
lyric alignment action now uses `ops.lyric_alignment_request`; migration
`20261103080001_ops_alignment_lockdown.sql` reasserts the public function and
direct-write lockdown after all merged studio migrations. Deploy applies every
pending migration with `--include-all`, including migrations that sort before
the live migration head. The first production cutover bootstraps private
Supabase keys and database password files from the running legacy database,
then deploy rotates the database logins. `ops/restore.ts --env dev` was used on
a private E: stack to restore the pre-cutover backup; all 52 recorded table
counts matched. The production database and services were not changed.
`ops/owner-admin.ps1` is ready for the owner to run in elevated PowerShell. It
installs local service accounts, their private credentials, ACLs and the LAN
firewall rule. The live cutover, service installation and local owner smoke
check remain owner actions. See the plan Deploy log for the exact state.
The review-round-1 installer fix prepares missing cache, secret, stack, backup
and env-file ACL targets inside the protected runtime root before service
grants. Existing env-file content is preserved; the owner must still provide
production env values before starting services.
Review round 2 resolves legacy `data/<lang>/storyboard.json` paths under the
song workspace in both real and fake workers, so pre-merge songs can rerender.
Review round 3 maps only the exact pre-cutover backup under
`E:/mellodifai/backups` to the reviewed `m1-floor` restore target. Its
production restore path keeps the floor guard and safety backup; the same dump
restored on the private dev stack with all 52 recorded table counts matching.
The private dev integration suite passed 6/6 and database suite passed 289/289
after a fresh reset with fake mode enabled. The owner runs the admin script only
from the deploy clone at the reviewed branch and floor tag.
### Historical owner checklist (2026-11-04)
Finish the admin setup (section 3); Docker Desktop disk image moved from C: to G:; OpenRouter
privacy filter off (blocks real lyric rewrites); Google OAuth client JSON; Cloudflare
nameservers and `cloudflared` login (Task 47); SMTP sender; an evaluation OpenRouter key with
a cap; kie credit price in USD; kie Midjourney access; Gemini, Blotato and COMFY_CLOUD keys;
Postiz account; Envato licences; YouTube OAuth; a decision on installing the `arena` skill
(SkillSpector CAUTION, each run starts 16-100 Claude agents).
