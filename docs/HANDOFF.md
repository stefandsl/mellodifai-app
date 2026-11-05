# Handoff: how Codex (gpt-6-astra) or any agent takes over MellodifAI

Read this first if you are picking up the work without the previous Claude session. It is
the single source for where things stand, the rules, and how to continue. Keep it current:
when you finish or change something listed here, edit this file and commit it.

Last updated: 2026-11-05.

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
  Never on the live stack (Supabase API 54321).
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

## 3. Where things stand

Merged into `build/studio-ui` and pushed:
- T26 Video Studio preset polish.
- T28 no built-in branding (no AIMELODIA / STEFANDSL.COM / MELLODIFAI text, no trumpet or
  gramophone marks) and user logos (up to 2, corners, size, opacity) in every preset.
  Report `E:/mellodifai/reports/task-28-report.md`, frames `E:/mellodifai/reports/task-28-shots/`.
  Its migration is `supabase/migrations/20261102000025_visualizer_logos.sql`; it is applied to
  the live stack (applied 2026-11-02) and the e2e database (by psql, not in its history).
- T27 "Rifai da YouTube" panel in the create panel and the AI lyric buttons ("Scrivi con AI",
  "Rigenera", "Migliora"). Report `E:/mellodifai/reports/task-27-report.md`. Migration
  `20261102000026_remakes.sql` applied to the live stack. Real rewrites stay blocked until the
  owner turns off the OpenRouter privacy filter (or sets `LYRICS_OPENROUTER_KEY` to a key
  without it). The worker now depends on `@mellodifai/remake`: `pnpm install` before starting it.
  The audio editor trim test flake under load is fixed (146d2dc). Playback timeout
  and export commit race test fixes are on `feat/test-flakes`.
- Agentic studio design revision 6 and the M1 plan.
- Video Studio 1080p/4K quality selection and local image upscaler, merged from `feat/render-4k`.

In progress:

| Work | Branch / worktree | Brief | What is left |
| --- | --- | --- | --- |
| M1 agent access (47 tasks) | `build/m1-agent-access`, `.claude/worktrees/m1-agent-access` | `docs/superpowers/plans/2026-11-02-m1-agent-access.md` | Run the Codex driver (section 4). |
| Karaoke lyrics | `feat/karaoke`, `E:/mellodifai/wt/karaoke` | `E:/mellodifai/codex-streams/karaoke/brief.md` | Implemented with local Whisper alignment; playback-take selection, master-only audio alignment and fake worker master jobs are fixed, awaiting integration. Apply migrations `20261103020001` and `20261103020002`. Report and screenshots: `E:/mellodifai/codex-streams/karaoke/`. |

Leftover worktrees to clean up when their branches are merged: `agent-aeb276f7c9d48b97b`
(T28, merged), `agent-ab7634b26f5114742` (T27, merged). Remove with
`git worktree remove --force <path>` then `git worktree prune`; if Windows says "Directory not
empty", `rm -rf <path>` then `git worktree prune`.

## 4. How to continue M1 with Codex

The driver `scripts/codex-sdd/run.sh` (on `build/m1-agent-access`) runs the plan task by task:
a Codex implementer (full access, commits and pushes), then a read-only Codex reviewer
(`VERDICT: APPROVED|REVISE`), up to 3 fix rounds, then the next task. Progress lives in the
ledger `.superpowers/sdd/2026-11-02-m1-agent-access/progress.md` inside the worktree
(gitignored, survives restarts). Re-running skips tasks marked complete.

```bash
cd C:/Users/Asus/Documents/mellodifai/.claude/worktrees/m1-agent-access
bash scripts/codex-sdd/run.sh            # all tasks
bash scripts/codex-sdd/run.sh 14 20      # a range
```

- Model: whatever `~/.codex/config.toml` says (`gpt-6-astra`). Do not pin `-m`.
- The run stops (exit 2) when a task reports BLOCKED / NEEDS_CONTEXT or makes no commit.
  Read `.superpowers/sdd/.../task-N-impl-last.txt`, fix the cause (add context to the brief
  or a `Ruling:` line in the ledger), and re-run.
- Tasks 33, 34 and 47 are owner gates: they touch production (live data cutover, live key
  rotation, tunnel). The driver skips them and records "owner gate". Do them only when the
  owner says go.
- Rulings already made (follow them):
  - Migration numbers: `20261102000025` (T28) and `20261102000026` (T27) are taken. Before its first migration, M1 merges `build/studio-ui`; every M1 migration takes the next
    free number when its task runs (the plan's 025-033 become 027-035 or later); keep the
    plan's file names after the number. T27 may take numbers too: always check
    `ls supabase/migrations` first.
  - Production-touching steps wait for the owner (above).
  - Owner actions the plan lists (Windows accounts, admin rights, DNS, Cloudflare tunnel,
    SMTP, Google OAuth JSON, keys) are never faked: the task does everything else, marks the
    step pending, and finishes DONE_WITH_CONCERNS.
- When all tasks are done: run one whole-branch review (read-only Codex over
  `git diff build/studio-ui...build/m1-agent-access`, plus every PARKED line in the ledger),
  fix what it finds in one pass, run all gates, merge `build/m1-agent-access` into
  `build/studio-ui`, push, and update this file.

If you are not using the driver, the same loop by hand: read the task text in the plan,
implement with tests, commit, push, then review the task's diff against its text with fresh
eyes before starting the next one.

Migration order note: the live stack already has `20261103020001`/`020002` (karaoke). M1's
migrations (`20261102000027` onward) sort before them, so applying M1 to the live stack needs
`npx supabase migration up --include-all`.

## 4b. Parallel Codex workstreams (started 2026-11-03)

Six independent streams run next to M1, each in its own worktree `E:/mellodifai/wt/<name>` on
branch `feat/<name>` from `build/studio-ui`: `render-4k` (merged), `karaoke` (merged)
(Spotify-like lyrics view), `song-assets` (per-song storyboard/thumbnail/metadata bug, CTR
thumbnails), `repo-audit` (merged), `plan-m2` (merged) and `plan-m3m4` (plans only).
Runner: `bash E:/mellodifai/codex-streams/stream.sh <name> <e2e-port>`; brief, report, reviews
and `status.log` live in `E:/mellodifai/codex-streams/<name>/`. Builders use `gpt-6-sol`
(reasoning high). `gpt-6-astra` returns 429 under parallel load, so reviewers and the M1 driver also run on sol: use `E:/mellodifai/codex-streams/stream4.sh` and start M1 with `CODEX=E:/mellodifai/codex-streams/codex-sol.sh bash scripts/codex-sdd/run.sh <from> 47`. `gpt-6.1-sol` is refused on a ChatGPT account. Re-run a parked stream's review loop with `SKIP_IMPL=1 bash E:/mellodifai/codex-streams/stream4.sh <name> <port>`. A stream
ends with "DONE branch ..." in its status.log; then review its report, merge the branch into
`build/studio-ui` (renumber migrations to the next free number if needed), run all gates, push.
Launch detached on Windows with PowerShell `Start-Process` so it outlives the agent session.

The `feat/ui-polish` stream has a visual audit, UI fixes, and before/after screenshots at
`E:/mellodifai/codex-streams/ui-polish/report.md`. Its final style-card evidence covers
1440x900, 1360x600, and 390x844. The focused browser suite and unit gates pass; the shared
database and full e2e stack had unrelated failures in its review-round-2 run.

The `feat/rerender` stream adds a new attempt after video approval or publication, protects
published render files and thumbnails during cleanup, and adds the song-page action. Migration
`20261103050001_rerender_published.sql`, `20261103050002_rerender_assets.sql`, and
`20261103050003_rerender_metadata.sql` are applied to the e2e database only. The second migration snapshots
the current storyboard, thumbnail, publication metadata and Video Studio look, and limits render
row writes to worker and RPC paths. The third keeps saved metadata across later re-renders. Report and
screenshots: `E:/mellodifai/codex-streams/rerender/`. Review round 3 also covers legacy flat
preview cleanup and guards its database fixture against non-local and live ports. It awaits
integration into `build/studio-ui`. After merging the latest integration branch, its full database
suite (144 tests) and browser suite (15 tests) passed on the private `mellodifai_rerender` stack
(API 48621, Next 3229) with fake workers. That stack was stopped and its temporary image tags
restored. Read the stream report before integration.

The `feat/suite-health` stream verifies the merged suites on a private Supabase stack at
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

The `feat/e2e-coverage` stream adds browser journeys for AI lyrics through private publication,
remake section regeneration, library controls, karaoke, audio trim export, and the existing
published re-render. It fixes the song-assets test's fixed browser port. Its private
`mellodifai_cov` stack (API 49621, Next 3231) passed the database suite (144 tests) and browser
suite (17 tests) twice in a row with fake providers. The stack was stopped and its temporary
image tags restored. Report and screenshots: `E:/mellodifai/codex-streams/e2e-coverage/`.
Review round 1 strengthened filter inclusion and exclusion, automatic karaoke playback timing,
Verse 2 regeneration persistence, exact take selection, and uploaded logo storage checks. The
private database and browser suites each passed twice again; the stack is stopped.
Review round 2 verifies the visible private publication title and visibility, the playlist item's
song ID, and the actual 2-8 second WAV segment. The private database and browser suites each
passed twice again; the stack is stopped.
Review round 3 preserves submitted AI lyrics in the fake draft and lets the approved project's
publish kit select a completed 16:9 Video Studio render. Migration
`20261103070001_publish_visualizer.sql` allows that render only after master approval; the worker
uploads the selected render from the job payload. The migration is applied to the private coverage
stack only. The branch's report has the latest tests and screenshots.
Review round 4 adds `20261103070002_publish_attempt_guard.sql`. Authenticated users cannot
insert publish jobs directly, enqueue and reservation allow one active or completed upload per
render attempt, and both worker paths recheck approval before upload. The private stack has
passed two database runs; see the branch report for the final browser verification.

## 5. Later work (after M1)

Per-language publishing hub (11 languages; planned in M4); milestones M2-M7 in the design
(plans in docs/superpowers/plans/2026-11-03-*);
cleanup of the suno-remake worktree `agent-a9f66bcbe8615fa5b`.

## 6. Waiting on the owner

Task 33 cut over the live Supabase stack to `E:/mellodifai/stacks/prod` after
verifying a fresh data backup. All 52 original table counts matched before and
after cutover. The first `m1-floor` deploy applied migrations and rotated database
passwords, but failed at worker startup. The reviewed restore imported the fresh
backup, and a read-only check found all 52 original table counts still equal,
11,409 rows total. Its final service startup failed for the same reason. The
production database and gateway are running at schema `20261103080001`; the
security probe passes, the legacy storage volume is mounted, and application
writers are stopped. The worker log reports missing `SUPABASE_URL` and
`SUPABASE_SERVICE_ROLE_KEY`. The deploy worker `.env.local` is unreadable by
this non-elevated session; the web and auth env files currently list only their
database URL keys. The owner must finish production env provisioning and access
before another deploy. The exact backup, recovery command and checks are in the
plan's Task 33 Deploy log. No owner browser smoke or paid action ran.

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
triggers CI on push. Keep `NEXT_PUBLIC_SITE_URL` until Task 37 migrates its users.

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
