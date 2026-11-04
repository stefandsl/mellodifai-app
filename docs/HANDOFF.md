# Handoff: how Codex (gpt-6-astra) or any agent takes over MellodifAI

Read this first if you are picking up the work without the previous Claude session. It is
the single source for where things stand, the rules, and how to continue. Keep it current:
when you finish or change something listed here, edit this file and commit it.

Last updated: 2026-11-03.

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

```bash
pnpm install --frozen-lockfile
pnpm lint
pnpm typecheck
pnpm --filter web exec tsc --noEmit
pnpm test
pnpm test:db      # needs the e2e stack env (see the M1 plan, "How tests reach a stack")
pnpm e2e          # e2e stack only
```

## 3. Where things stand (2026-11-04)

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

M1 agent access (`build/m1-agent-access`, worktree
`C:/Users/Asus/Documents/mellodifai/.claude/worktrees/m1-agent-access`, ledger
`.superpowers/sdd/2026-11-02-m1-agent-access/progress.md`):
- Tasks 1-32 and 35 done. Several are PARKED: their open findings are in the ledger and in
  `task-N-review-r4.md`; the final whole-branch review must triage them, notably Task 23
  (duplicate-ID spend authorization) and Task 28 (ambiguous_spend scope, isRemote scan).
- The integration job (`E:/mellodifai/codex-streams/m1-integrate/`) merged studio-ui into M1,
  moved its features onto the ops layer, made the lockdown the last migration (tag `m1-floor`
  = lockdown commit), added the prod secrets bootstrap, a verified restore and
  `ops/owner-admin.ps1`.
- Task 33 (first production deploy) stopped safely before any production change. Pre-cutover
  backup: `E:/mellodifai/backups/2026-11-03-task-33-pre-cutover.sql`. Deploy clone:
  `E:/mellodifai/deploy` on `build/m1-agent-access`.
- Owner admin setup is IN PROGRESS. The owner runs, in an elevated PowerShell:
  `$env:MELLODIFAI_ROOT='E:/mellodifai'; $env:TEMP='E:/mellodifai/tmp'; $env:TMP=$env:TEMP`,
  then `cd E:\mellodifai\deploy` and `pnpm ops services.ts install --apply`. Done so far: the
  E:/mellodifai ACL (owner + SYSTEM only) and the accounts `mdf-web`, `mdf-auth`, `mdf-tunnel`
  with credentials in `E:/mellodifai/secrets/services/*.xml`. Bugs fixed on the way: missing
  `apps/auth` folder, icacls `(X)` syntax; the install now prints the failing step and its exit
  code. If it still fails: read the printed step, fix `ops/lib/services.ts`, commit, push, run
  `git -C E:/mellodifai/deploy pull --ff-only origin build/m1-agent-access`, and ask the owner to
  rerun. Never run it yourself: it needs administrator rights.
- Known red test: `ops/test/services.test.ts` "manages a detached fake service and applies an
  owner-only ACL" fails since the real E:/mellodifai ACL changed; make it use its own temp root
  (ledger ruling).

## 4. Next steps for Codex, in order

1. Finish the owner admin setup (above). Verify: `Get-LocalUser mdf-*` lists 3 accounts,
   `icacls E:\mellodifai` shows the `(X)` grants, the firewall rule exists.
2. Fix the services test (above). Commit, push.
3. Task 33 production deploy (owner approved on 2026-11-03: "vai"), then Task 34, with only
   Task 47 gated:
   ```bash
   cd C:/Users/Asus/Documents/mellodifai/.claude/worktrees/m1-agent-access
   OWNER_GATE=47 CODEX=E:/mellodifai/codex-streams/codex-sol.sh bash scripts/codex-sdd/run.sh 33 34
   ```
   Rules (also in the ledger): verify the cutover backup first; right before the deploy step
   stop only the `next dev` on port 3000 that runs from `C:/Users/Asus/Documents/mellodifai`
   (the deployed app replaces it; if the deploy is rolled back, restart it with `pnpm dev` in
   `apps/web`); never touch the launcher on 3210; apply migrations with `--include-all`; if an
   expected result fails, restore from the backup and stop. After the deploy the owner signs
   in with `pnpm ops sign-in-link.ts <owner email> http://127.0.0.1:3000`.
4. Continue M1 Tasks 36-46 (Task 47 = tunnel, owner gate):
   `OWNER_GATE=47 CODEX=E:/mellodifai/codex-streams/codex-sol.sh bash scripts/codex-sdd/run.sh 36 46`
5. Final whole-branch review of M1 (read-only Codex over
   `git diff build/studio-ui...build/m1-agent-access` plus every PARKED line in the ledger), one
   fix pass, all gates (on a private stack), merge `build/m1-agent-access` into
   `build/studio-ui`, push, update this file.
6. Then M2a (its plan plus its open findings file), with the same driver (`PLAN=` the M2a plan).

How the M1 driver works: `scripts/codex-sdd/run.sh` runs one Codex implementer per task, then
a Codex reviewer (`VERDICT: APPROVED|REVISE`), up to 3 fix rounds. Ledger lines `Task N:
complete` are skipped on re-run. It stops (exit 2) on BLOCKED/NEEDS_CONTEXT or no commit: read
`task-N-impl-last.txt`, add a `Ruling:` line to the ledger telling the next run what to do, and
re-run. `PARKED` = open findings kept for the final review. Launch it detached on Windows
(PowerShell `Start-Process` bash) so it survives the agent session.

Rulings that still bind (more in the ledger): migrations take the next free number and the
lockdown stays last; owner actions are never faked (mark pending, DONE_WITH_CONCERNS);
production steps only with the owner's approval; e2e on `E2E_PORT` (3219 in the driver; 3210
belongs to the owner's launcher app, never stop it).

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

Finish the admin setup (section 3); Docker Desktop disk image moved from C: to G:; OpenRouter
privacy filter off (blocks real lyric rewrites); Google OAuth client JSON; Cloudflare
nameservers and `cloudflared` login (Task 47); SMTP sender; an evaluation OpenRouter key with
a cap; kie credit price in USD; kie Midjourney access; Gemini, Blotato and COMFY_CLOUD keys;
Postiz account; Envato licences; YouTube OAuth; a decision on installing the `arena` skill
(SkillSpector CAUTION, each run starts 16-100 Claude agents).
