# mellodifai platform (plan 1 of 2) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A production-ready admin tool on mellodifai.com that takes a VBP-theme song from lyric draft to a private YouTube upload through resumable jobs run by a worker on the user's PC. Plan 2 adds the any-topic video theme on top.

**Architecture:** Next.js on Vercel writes intent only (rows in Supabase). A Node worker on the PC claims job rows, runs the existing suno-remake engine in a per-project workspace on E:, and writes results and previews back. All third-party secrets live only on the PC.

**Tech Stack:** pnpm workspaces, TypeScript 5 (strict), Next.js 15 App Router, Tailwind 4 + shadcn/ui, Supabase (Postgres 15, Auth magic link, Storage, Realtime), zod, vitest, Playwright, Biome (lint + format), GitHub Actions. Worker: Node 22, tsx. Engine: Python 3.12 tools + Remotion 4 in `C:\Users\Asus\Documents\suno-remake`.

**Spec:** `docs/superpowers/specs/2026-10-31-mellodifai-design.md` (read it first; this plan argues from it).

## Global Constraints

- Never write the em dash character in code comments, UI copy, lyrics, titles, descriptions, commit messages.
- No commit message gets a co-author or agent attribution line.
- No third-party key (kie, OpenRouter, Groq, YouTube OAuth, Supabase service key) in `apps/web`, in Vercel env, in the repo, or in logs. The web app holds only `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_ANON_KEY`.
- Worker secrets load at runtime from `C:\Users\Asus\Documents\Claude\Projects\ita\.env` (kie, OpenRouter, Groq), `C:\Users\Asus\Documents\suno-remake\publish\.env` (YouTube) and `apps/worker/.env.local` (Supabase URL + service key). Values are never printed.
- Engine outputs, temp files and workspaces on E: only (`E:\mellodifai\`); never G:. `TMP`/`TEMP` = `E:\mellodifai\tmp` for every engine subprocess, plus `PYTHONIOENCODING=utf-8`; Python always `python -I`.
- Strictly one Remotion job at a time on the PC; renders always `--gl=angle`.
- Without `ENGINE_WORKSPACE` set, every engine command must behave byte-for-byte as today (the CLI and the mellodifai skill keep working).
- A YouTube video becomes public/unlisted/scheduled only through the explicit confirm action; uploads are private.
- A kie generation is never re-sent automatically; each spend needs an admin click (12 credits per language).
- UI copy: Italian first (`it`), English (`en`) second, via a small dictionary.
- Languages offered: it ru ro ja en es de zh pt ko fr.

## Review Focus

1. PC reboots mid-render: the job's heartbeat goes stale, the job returns to `queued`, the next claim re-renders into a `.part` file and only a finished file is renamed into place and marked done. Test in Task 5.
2. Double click or browser retry on "generate song": exactly one kie request per version and generation attempt (DB unique idempotency key). Test in Task 3 and Task 6.
3. Lyric pack with an em dash, wrong line count for the VBP theme (not 80 sung lines), or empty title: rejected before any credit is spent. Test in Task 2.
4. Worker offline: the UI shows "offline since <time>", actions still enqueue, nothing errors. Test in Task 8 (E2E with no worker heartbeat).
5. A signed-in user who is not on the allowlist (or a second customer account later) sees no rows at all, even with direct Supabase calls. Test in Task 3.

---

## File structure

```
mellodifai/
  package.json, pnpm-workspace.yaml, biome.json, tsconfig.base.json, .github/workflows/ci.yml, README.md
  packages/shared/src/{stages.ts, lyric-pack.ts, status.ts, i18n.ts, index.ts}   types + zod, used by web and worker
  supabase/{config.toml, migrations/*.sql, seed.sql, tests/*.test.ts}
  apps/worker/src/
    main.ts            daemon entry: loop, signals
    db.ts              typed Supabase client (service key), claim / heartbeat / events
    loop.ts            claim -> run stage -> result, heartbeat timer, stale requeue
    secrets.ts         runtime env loading, redaction
    engine.ts          subprocess runner for engine commands (env, cwd, log streaming, .part handling)
    workspace.ts       per-project workspace layout on E:
    storage.ts         preview uploads
    stages/{draft-lyrics,generate-song,timing,storyboard,render,qa,art,publish,import-legacy}.ts
    fake/              WORKER_FAKE=1 stage doubles using fixtures (for E2E and CI)
  apps/web/
    app/(auth)/login, app/(app)/{page.tsx, projects/[id]/page.tsx, projects/new/page.tsx}
    app/actions/*.ts   server actions: create project, approve, enqueue, confirm publish
    components/*       shadcn-based UI
    lib/supabase/{server.ts, browser.ts}
    e2e/*.spec.ts
suno-remake (engine, modified in Task 4 only):
  tools/paths.py (new), tools/*.py (path constants), motion/scripts/r.mjs, motion/src/components/a/display.ts, motion/src/lib/data.ts
```

---

### Task 1: Monorepo scaffold, CI and repo

**Files:** root config files above, `packages/shared` skeleton, `.github/workflows/ci.yml`, `README.md`, `.gitignore` (node_modules, .env*, .next, test-results).

**Interfaces:** Produces root scripts used by every later task: `pnpm lint` (biome check), `pnpm typecheck` (tsc -b), `pnpm test` (vitest run in all packages), `pnpm e2e` (playwright in apps/web).

- [ ] Step 1: `git init`, commit the spec and this plan first (`docs:` commit).
- [ ] Step 2: pnpm workspace with `packages/*` and `apps/*`; strict tsconfig base (`noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`).
- [ ] Step 3: Biome config; a trivial vitest test in `packages/shared` (`it("loads", () => expect(1).toBe(1))`) to prove the runner.
- [ ] Step 4: CI workflow: on push/PR run install, lint, typecheck, test; a second job starts local Supabase (`supabase start`), runs `pnpm test:db` and `pnpm e2e` with `WORKER_FAKE=1`.
- [ ] Step 5: Run `pnpm lint && pnpm typecheck && pnpm test`. Expected: all pass.
- [ ] Step 6: Create the private GitHub repo `stefandsl/mellodifai` with `gh repo create --private --source . --push`. Commit `chore: monorepo scaffold`.

### Task 2: Shared domain model

**Files:** `packages/shared/src/{stages.ts, status.ts, lyric-pack.ts, i18n.ts}`, tests next to them.

**Interfaces (Produces):**
- `const LANGS = ["it","ru","ro","ja","en","es","de","zh","pt","ko","fr"] as const; type Lang`
- `const STAGES = ["draft_lyrics","generate_song","timing","storyboard","render_master","render_hook","qa","art","publish","set_privacy","import_legacy"] as const; type Stage`
- `type JobStatus = "queued"|"running"|"done"|"failed"|"cancelled"`
- `type VersionStatus = "drafting"|"lyrics_review"|"song_queued"|"takes_review"|"producing"|"video_review"|"approved"|"publishing"|"published"|"failed"`
- `nextStages(status: VersionStatus): Stage[]` (the producing chain is timing -> storyboard -> render_master -> render_hook -> qa -> art)
- `LyricPackSchema` (zod): `{ title: string(1..100), lyrics: string, style: string(1..1000), exclude: string, settings: { model: "V6", vocalGender: "m"|"f", styleWeight: number 0..1 (default 0.7), weirdness: number 0..1 (default 0.35), duration: int 60..320 (default 310) }, displayMap: Record<string,string>, l10n: Record<string, unknown> }`
- `validateLyricPack(pack, theme: "vbp"|"general"): { ok: true } | { ok: false, errors: string[] }`
- `t(lang: "it"|"en", key: DictKey): string`

- [ ] Step 1: Tests: `validateLyricPack` rejects any field containing U+2014 (error names the field); for theme `"vbp"` rejects a sheet whose sung lines (non-empty, not starting with `[`) are not exactly 80; accepts the shipped `versions/fr` pack converted to the schema (fixture copied into `packages/shared/test/fixtures/fr-pack.json`); `nextStages("producing")` order as above.
- [ ] Step 2: Run, see them fail; implement; run, see them pass.
- [ ] Step 3: Commit `feat(shared): domain model and lyric pack validation`.

### Task 3: Database schema, RLS, job queue functions

**Files:** `supabase/migrations/20261031000001_core.sql`, `..._queue.sql`, `supabase/seed.sql`, `supabase/tests/{rls,queue}.test.ts`, root script `test:db`.

**Interfaces (Produces):** tables from spec section 6 with `owner_id uuid not null default auth.uid()`; `admin_allowlist(email)`; RPCs (security definer, callable by service role only):
- `claim_job(p_worker text) returns jobs` (oldest queued, `for update skip locked`, sets running, attempts+1, heartbeat_at now)
- `heartbeat_job(p_job uuid, p_worker text) returns boolean`
- `requeue_stale(p_seconds int default 120) returns int`
- `jobs.idempotency_key text unique not null`
- Storage bucket `previews` (private, signed URLs), max object 50 MB.
- Auth hook or trigger: a sign-in whose email is not in `admin_allowlist` gets no `profiles` row; every policy requires a profiles row with `role = 'admin'` or `owner_id = auth.uid()` for customers (v2-ready).

- [ ] Step 1: Tests against local Supabase (service client + two signed-in test users created in the test): user B sees zero rows of user A's projects/versions/jobs via select, and cannot insert a job for A's version; non-allowlisted user sees nothing; two concurrent `claim_job` calls with two queued jobs return different jobs, with one queued job one returns null; a running job with heartbeat 3 min old is requeued by `requeue_stale(120)` and keeps its attempts count; inserting two jobs with the same idempotency key fails with a unique violation.
- [ ] Step 2: Fail, implement migrations, `supabase db reset`, pass.
- [ ] Step 3: Commit `feat(db): schema, rls, job queue`.

### Task 4: Engine workspace root (suno-remake)

Before editing, run `git init` in `C:\Users\Asus\Documents\suno-remake` (the existing `.gitignore` already excludes out/, audio/, .env) and commit the current tree as `chore: snapshot before workspace root`, so the change is reviewable and revertible.

**Files:**
- Create `tools/paths.py`: `ROOT`, `WS = Path(os.environ["ENGINE_WORKSPACE"]) if set else ROOT`, `VERSIONS = WS/"versions"`, `OUT = WS/"out"`, `PUBLIC = WS/"public" if set else ROOT/"motion"/"public"`, `STEMS = WS/"stems" if set else Path("E:/suno-remake-render/out/e1/stems")`.
- Modify every `ROOT / "versions" | "out" | "motion"/"public"` use in `tools/*.py` and the `STEM` constant in `retime_echoes.py` to the `paths` constants (34 sites found by `grep -rn 'ROOT / "' tools`).
- Modify `motion/scripts/r.mjs`: when `ENGINE_WORKSPACE` is set, add `--public-dir=<WS>/public`.
- Modify `motion/src/components/a/display.ts`: load the display map from `data/<lang>/display-map.json` through the same `fetchJson` path as timing (`lib/data.ts` returns it with timing and storyboard) instead of the 11 static imports; `lang_pipeline` already copies it there.
- Create `tools/workspace_pipeline.sh` = `lang_pipeline.sh` with every path taken from `ENGINE_WORKSPACE` (stems under `$WS/stems`).

**Interfaces (Produces):** workspace layout `E:\mellodifai\projects\<projectId>\<lang>\{versions/<lang>/, out/<lang>/, public/{data/<lang>/, audio/<lang>.wav, fonts/ (copied from motion/public/fonts)}, stems/, render/}` used by Task 5 `workspace.ts`.

- [ ] Step 1: Regression tests (`tools/test_workspace.py`, plain asserts, run with `python -I tools/test_workspace.py`): (a) with no env, `make_storyboard.py fr` regenerates `motion/public/data/fr/storyboard.json` byte-identical to the committed file; (b) with `ENGINE_WORKSPACE` pointing at a temp copy of the fr inputs, the workspace storyboard is byte-identical to the in-tree one and no in-tree file's mtime changed; (c) `make_srt.py fr` output identical in both modes.
- [ ] Step 2: Render check: `r.mjs still Video-fr` at frames 300 and 6000 in-tree and from the workspace; ffmpeg `psnr` between each pair reports `inf` (identical).
- [ ] Step 3: `npm run typecheck` in motion passes; commit in suno-remake `feat: optional ENGINE_WORKSPACE root`.

### Task 5: Worker core

**Files:** `apps/worker/src/{main,db,loop,secrets,engine,workspace,storage}.ts`, `apps/worker/test/*.test.ts`.

**Interfaces (Produces):**
- `type StageContext = { job: Job; version: Version; project: Project; ws: Workspace; engine: Engine; storage: Storage; log(line: string): Promise<void>; progress(pct: number): Promise<void>; secrets: Secrets }`
- `type StageResult = { versionStatus?: VersionStatus; patch?: Partial<Version>; enqueue?: { stage: Stage; idempotencyKey: string }[] }`
- `type StageHandler = (ctx: StageContext) => Promise<StageResult>`; registry `stages: Record<Stage, StageHandler>`
- `Engine.run(cmd: string, args: string[], opts: { env?: Record<string,string>; outputs?: string[] }): Promise<{ code: number }>`: spawns with engine env, streams lines to `log`, writes declared outputs as `<file>.part` and renames on exit 0 only.
- `Workspace.forVersion(projectId, lang): Promise<Workspace>` with `{ root, versionsDir, outDir, publicDir, renderDir }`, creates the layout and copies fonts once.
- `secrets.load(): Secrets` and `redact(text): string` (replaces every loaded secret value with `***`); every log line passes through `redact`.
- Loop: claim every 3 s when idle; heartbeat every 15 s while running; `requeue_stale` every 60 s; a global render mutex so `render_master` / `render_hook` never overlap; `workers` row upsert every 15 s (online status for the UI); on SIGINT finish the current line, mark job queued, exit.

- [ ] Step 1: Tests with a fake db and fake child processes: a handler throwing marks the job failed with the message and the version `failed`; a crash between `.part` write and rename leaves no final file and the next run redoes it; two render jobs claimed back to back run sequentially; `redact` removes a secret value from a log line; a stale job gets requeued.
- [ ] Step 2: Fail, implement, pass. Commit `feat(worker): job loop, engine runner, workspace`.

### Task 6: Pipeline stages (VBP theme)

**Files:** `apps/worker/src/stages/*.ts`, `apps/worker/src/fake/*`, tests per stage.

Each stage maps to existing engine commands, run in the version's workspace:
- `draft_lyrics`: OpenRouter chat completion (model from `LYRICS_MODEL`, default `anthropic/claude-sonnet-5.5`), system prompt asks for the VBP pack JSON for the topic and language; parse with `LyricPackSchema`, run `validateLyricPack(pack,"vbp")`, retry the LLM at most 2 times on invalid output; store the pack on the version; status `lyrics_review`. Daily cap `LYRICS_DAILY_CAP=50` calls.
- `generate_song`: write the pack to `versions/<lang>/`, `node tools/kie.mjs generate <lang>` then `wait` and `lyrics-ts` for both takes (kie.mjs gains no new flags; it runs with `ENGINE_WORKSPACE`); upload take MP3 previews (128 kbps) to storage; status `takes_review`. Idempotency key `generate:<versionId>:<attempt>`; the handler first checks for an existing kie task id on the version and only polls if one exists.
- `timing`: `bash tools/workspace_pipeline.sh <lang> <take>`; then danger-spot flags (chant count before the Final Chorus via `tools/clip_whisper.py` on the stem clip, outro greeting presence, words shorter than 0.2 s from timing.json) saved in `qa_flags`.
- `storyboard`: `python -I tools/make_storyboard.py <lang>`.
- `render_master` / `render_hook`: `node scripts/r.mjs render Video-<lang>|Hook-<lang> <renderDir>/video.mp4|hook.mp4 --props=<ws>/fps30.json --gl=angle --log=error`, progress parsed from Remotion's "Rendered N/M" lines; a 720p preview (ffmpeg, crf 30, max 40 MB) uploaded to storage.
- `qa`: loudness (`ebur128`, target -14 LUFS +/- 1, true peak <= -1 dBTP), pace vs reference (`tools/pace_meter.py`), stamp overshoot, contact sheet uploaded; result JSON on the render; any failed blocking gate keeps `video_review` with `approve` disabled until override.
- `art`: thumbnail via the existing Pillow script adapted to read the title from the version.
- `publish`: write `publish/meta/<lang>.json` equivalent into the workspace, `python -I publish/yt.py upload <meta>` (private); store the video id. `set_privacy`: `yt.py privacy <id> <privacy> --confirm`, only enqueued by the web confirm action (Task 7), which records `confirmed_by` and `confirmed_at`.
- Quotas: the worker counts YouTube uploads per Pacific-time day in `workers.youtube_uploads_today`; a `publish` job past 4 uploads stays queued with a "quota" note until the next day. Every 10 min (and after each generation) the worker stores `node tools/kie.mjs credit` in `workers.kie_balance` for the UI.
- Fake doubles (`WORKER_FAKE=1`): every stage copies fixtures (a 10 s audio, a 10 s video, a pack) and sleeps 1 s.

- [ ] Step 1: Tests: each stage builds the exact command line for a sample version (snapshot of args and env, secrets absent from args); `generate_song` called twice for one key sends one request (fake kie); `draft_lyrics` rejects an em dash output and retries; `qa` marks -10 LUFS as failed; a fifth `publish` on the same Pacific day stays queued.
- [ ] Step 2: Fail, implement, pass. Commit `feat(worker): pipeline stages`.

### Task 7: Web app

**Files:** `apps/web/**` per the file structure.

Pages: login (magic link, allowlist message on refusal); library (projects grid: title, languages with status chips, last update, worker status badge); new project (topic, brief, languages multi-select, style, mood, vocal gender, theme fixed to VBP in plan 1, shows "12 kie credits per language" and the current kie balance from `workers.kie_balance` before submit); project page with one tab per language showing a vertical timeline of stages with live progress (Realtime on `jobs` and `job_events`) and the checkpoint panel for the current status: lyrics editor (form over the pack, validation errors inline, Approve), take picker (two audio players, scores, Pick + "Generate again (12 credits)" with confirm dialog), video review (720p player, hook player, QA table with pass/fail, Approve or Re-render, override needs a typed reason), publish form (title, description, tags, chapters prefilled; Upload private; after upload a separate "Make public / unlisted / schedule" with a confirm dialog naming the video).

Server actions only insert/update rows and enqueue jobs with deterministic idempotency keys; they never call third parties.

- [ ] Step 1: Component tests (vitest + testing-library) for the lyrics editor validation and the confirm dialogs.
- [ ] Step 2: Implement; `pnpm lint && pnpm typecheck && pnpm test` pass. Commit `feat(web): admin app`.

### Task 8: End-to-end tests

**Files:** `apps/web/e2e/{flow,offline,auth}.spec.ts`, `apps/web/playwright.config.ts`.

- [ ] Step 1: `flow`: sign in as the seeded admin (local Supabase inbucket link), create a project in fr, approve lyrics, pick a take, watch the timeline reach video review, approve, upload private, confirm public; with `WORKER_FAKE=1` worker running. Assert each status chip and that `set_privacy` was enqueued only after the confirm dialog.
- [ ] Step 2: `offline`: no worker running: badge reads offline, creating a project still works, the job stays queued.
- [ ] Step 3: `auth`: a non-allowlisted email gets the refusal and no data.
- [ ] Step 4: `pnpm e2e` passes locally and in CI. Commit `test(e2e): admin flow`.

### Task 9: Legacy import, deploy and worker install

- [ ] Step 1: `import_legacy` stage + script: creates project "Va bene, passa (VBP)" with 11 versions from `E:\suno-remake-render\out\final\` (video paths, SRTs, takes, chosen take), uploads 720p previews (fits the 1 GB budget: 11 x ~28 MB). Test: running it twice creates nothing new.
- [ ] Step 2: Supabase cloud project (only after the user's OK to create the free project), `supabase db push`, allowlist the admin email.
- [ ] Step 3: Vercel project from the GitHub repo, env vars (URL + anon key only), domain `mellodifai.com` and `www`; give the user the exact Hostinger DNS records (A `@` and CNAME `www` values from Vercel).
- [ ] Step 4: Worker as a Windows scheduled task at logon (`apps/worker/scripts/install-task.ps1`), restart on failure; weekly `pg_dump` to `E:\mellodifai\backups`.
- [ ] Step 5: Smoke test on production: sign in, worker badge online, library shows the VBP import. Commit `chore: deploy`.
