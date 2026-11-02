# Handoff: how Codex (gpt-6-astra) or any agent takes over MellodifAI

Read this first if you are picking up the work without the previous Claude session. It is
the single source for where things stand, the rules, and how to continue. Keep it current:
when you finish or change something listed here, edit this file and commit it.

Last updated: 2026-11-02.

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
- Playwright / e2e only on the e2e stack (Next on 3210, Supabase API 45621). Never on the
  live stack (Supabase API 54321).
- Never factory-reset Docker. Migrations are additive only, each with database tests.
- No em dash characters anywhere (use "-"). Plain commit messages, no co-author lines.
- Do not commit `apps/web/AGENTS.md`. Do not change the owner's account settings.
- Every new relative `.js` import inside `packages/shared/src` needs a matching
  `turbopack.resolveAlias` entry in `apps/web/next.config.ts`.
- After any merge in a checkout: `pnpm install --frozen-lockfile` before trusting the gates
  (a red gate with "Cannot find package" or TS2688 means node_modules is stale, not code).
- Git Bash rewrites arguments like `/api/v1`; prefix such commands with `MSYS_NO_PATHCONV=1`.

Gates (all must be green before a merge or push of finished work):

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
  the e2e database only (by psql). The live stack still needs it (`supabase migration up`
  on the live stack is an owner-visible step: do it when the owner is around or note it).
- Agentic studio design revision 6 and the M1 plan.

In progress:

| Work | Branch / worktree | Brief | What is left |
| --- | --- | --- | --- |
| T27 "Rifai da YouTube" panel + AI lyric buttons | `build/task-27-remake-ui`, `.claude/worktrees/agent-ab7634b26f5114742` | `docs/egm/v2-local-engines/task-27-brief.md` (untracked file in the main checkout) | Check its commits and `E:/mellodifai/reports/task-27-report.md` (if it exists). Finish missing requirements, run the gates, merge into `build/studio-ui` (expect an i18n conflict with T28: keep both blocks), renumber any new migration to the next free number, push. |
| M1 agent access (47 tasks) | `build/m1-agent-access`, `.claude/worktrees/m1-agent-access` | `docs/superpowers/plans/2026-11-02-m1-agent-access.md` | Run the Codex driver (section 4). |

Leftover worktrees to clean up when their branches are merged: `agent-aeb276f7c9d48b97b`
(T28, merged), `agent-ab7634b26f5114742` (T27, after merge). Remove with
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
  - Migration numbers: `20261102000025` is taken by T28. Every M1 migration takes the next
    free number when its task runs (the plan's 025-033 become 026-034 or later); keep the
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

## 5. Later work (after M1)

1080p minimum and 4K with an upscaler; per-song storyboard, thumbnail and metadata; Spotify-
like karaoke; per-language publishing hub (11 languages); CTR thumbnails (not clickbait);
milestones M2-M7 in the design; cleanup of the suno-remake worktree `agent-a9f66bcbe8615fa5b`.

## 6. Waiting on the owner

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
Task 9 will create mdf_web/mdf_auth; Task 6 reports them absent until then.
See `ops/compose/README.md` for secret files and the production Task 8 contract.
Production SMTP, rotation/probes, cutover and owner hardening remain pending.
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
