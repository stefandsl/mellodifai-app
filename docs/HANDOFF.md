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
- Playwright / e2e only on the e2e stack (Next on 3210, Supabase API 45621). Never on the
  live stack (Supabase API 54321).
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
  The audio editor trim test flake under load is fixed (146d2dc).
- Agentic studio design revision 6 and the M1 plan.
- Video Studio 1080p/4K quality selection and local image upscaler, merged from `feat/render-4k`.

In progress:

| Work | Branch / worktree | Brief | What is left |
| --- | --- | --- | --- |
| M1 agent access (47 tasks) | `build/m1-agent-access`, `.claude/worktrees/m1-agent-access` | `docs/superpowers/plans/2026-11-02-m1-agent-access.md` | Run the Codex driver (section 4). |
| Karaoke lyrics | `feat/karaoke`, `E:/mellodifai/wt/karaoke` | `E:/mellodifai/codex-streams/karaoke/brief.md` | Implemented with local Whisper alignment; latest review fixes playback-take selection and master-only audio alignment, awaiting integration. Apply migrations `20261103020001` and `20261103020002`. Report and screenshots: `E:/mellodifai/codex-streams/karaoke/`. |

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

## 4b. Parallel Codex workstreams (started 2026-11-03)

Six independent streams run next to M1, each in its own worktree `E:/mellodifai/wt/<name>` on
branch `feat/<name>` from `build/studio-ui`: `render-4k` (1080p minimum, 4K, upscaler), `karaoke`
(Spotify-like lyrics view), `song-assets` (per-song storyboard/thumbnail/metadata bug, CTR
thumbnails), `repo-audit` (ponytail audit and fixes), `plan-m2` and `plan-m3m4` (plans only).
Runner: `bash E:/mellodifai/codex-streams/stream.sh <name> <e2e-port>`; brief, report, reviews
and `status.log` live in `E:/mellodifai/codex-streams/<name>/`. Builders use `gpt-6-sol`
(reasoning high). `gpt-6-astra` returns 429 under parallel load, so reviewers and the M1 driver also run on sol: use `E:/mellodifai/codex-streams/stream3.sh` and start M1 with `CODEX=E:/mellodifai/codex-streams/codex-sol.sh bash scripts/codex-sdd/run.sh <from> 47`. `gpt-6.1-sol` is refused on a ChatGPT account. Re-run a parked stream's review loop with `SKIP_IMPL=1 bash E:/mellodifai/codex-streams/stream3.sh <name> <port>`. A stream
ends with "DONE branch ..." in its status.log; then review its report, merge the branch into
`build/studio-ui` (renumber migrations to the next free number if needed), run all gates, push.
Launch detached on Windows with PowerShell `Start-Process` so it outlives the agent session.

## 5. Later work (after M1)

Per-song storyboard, thumbnail and metadata; per-language publishing hub (11 languages); CTR
thumbnails (not clickbait);
milestones M2-M7 in the design; cleanup of the suno-remake worktree `agent-a9f66bcbe8615fa5b`.

## 6. Waiting on the owner

Docker Desktop disk image moved from C: to G: (Settings > Resources > Advanced > Disk image
location; stop the stacks first; until then the dev, e2e and spike stacks keep running in
the existing daemon); OpenRouter privacy filter off (it swaps Italian words for tags); Windows accounts `mdf-web`
and `mdf-auth` plus the firewall rule; Google OAuth client JSON; Cloudflare nameservers and
`cloudflared` login; SMTP sender; codex login in the image container; an evaluation
OpenRouter key with a cap; kie credit price in USD; kie Midjourney access; Gemini, Blotato
and COMFY_CLOUD keys; Postiz account; Envato licences; YouTube OAuth.
