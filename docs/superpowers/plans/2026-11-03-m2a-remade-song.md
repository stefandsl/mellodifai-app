# M2a Remade Song Implementation Plan

> **For agentic workers:** Execute tasks in order. Use checkbox (`- [ ]`) steps for tracking. Run every task against the e2e stack with fake providers. M1 must be merged first.

**Goal:** A source fixture completes R1 through R4b in Copilot, pauses at lyrics and take review, accepts agent-authored lyrics over MCP, rejects a close paraphrase, and retains source fingerprints after deleting source media.

**Architecture:** Extend the task 27 remake package and table into one run per source with one version per target language. `stage_runs` is the durable R-stage record. The M1 `apps/web/lib/ops/*` runner is the only path for user and agent actions, and the M1 `ops.worker_enqueue` and spend ledger own child jobs. The worker advances stages transactionally through `apps/worker/src/orchestrator.ts`. Existing song generation, take scoring and timing stages are reused.

**Tech Stack:** pnpm monorepo, Next.js 16.4, Node worker, Supabase Postgres 17, Zod, Vitest, Playwright, Python CPU helpers (`sentence-transformers`, `pyphen`, `fugashi`, `unidic-lite`, `imagehash`, DINOv2), fake HTTP providers.

**Spec:** `docs/superpowers/specs/2026-11-01-agentic-studio-design.md`, revision 6, especially 6.8-6.9, 8.1-8.7, 9.1, 10.1-10.3, 11.5, 13.4, 14.1-14.3, 15.2, 19 and 21.4. M1 interface names below are from `docs/superpowers/plans/2026-11-02-m1-agent-access.md`, Tasks 17, 19, 25, 28, 40 and 41.

## Global Constraints

- No paid credits in tests; `WORKER_FAKE=1`, fake HTTP servers and `test_mode` tokens only. Never run e2e on the live stack at API 54321.
- No secrets in output or commits. Runtime media, models, caches, reports and test data live under `E:/mellodifai` or `G:/caches`, never C:. Stop if C: has less than 20 GB free.
- Additive migrations only, with database tests. Use the reserved M2a prefix `202611030100XX` in `supabase/migrations/`; check for a free suffix before writing each file.
- Every `ops.*` entry point is a `postgres`-owned `security definer` with `set search_path = ''` and UTC, revoked from `public`, `anon`, `authenticated`, then granted by name only to `mdf_web` or `service_role` as appropriate. Do not reopen task 27's public RPCs.
- M1 `OpDef`, `runOp`, `runAction`, `remoteAction`, `TOKEN_OPS` and `buildMcpServer` remain the shared web, HTTP and MCP route. Keyed writes use M1 `ops.idem_begin` and its committed result. Child jobs use `ops.worker_enqueue(p_parent_job, p_version, p_stage, p_idempotency_key)` so token, run, fake flag, priority and reservation propagate. Paid calls use M1 `paidCall`, `callKey`, `ops.spend_entry_open`, `ops.settle_spend`, `ops.extend_reservation`, and `ops.mark_ambiguous`.
- New relative `.js` imports under `packages/shared/src` get matching `turbopack.resolveAlias` entries in `apps/web/next.config.ts`.
- Italian UI strings with English entries in existing i18n. Plain commits, no co-author lines, no em dash characters.
- M2a runs only in Copilot. Reject Autopilot starts and mode switches in `ops.*` and the UI until M5 adds the 6.5 policy, system token, authorization rules and worker-only approvals. The schema stores the future mode value but constrains workflow v2 rows to Copilot; M5 must explicitly replace that constraint.
- Before merging: frozen install, lint, typecheck, web `tsc --noEmit`, unit, database and e2e gates. The stream-specific port 3225 is the owner's explicit isolation override of M1's 3210; do not change it to the shared default. DBTEST below means the exact e2e env command in M1's “How tests reach a stack”; run with `E2E_PORT=3225`.

## Review Focus

1. Source media deletion: source audio, video, frames and stems disappear only after a committed R2 analysis and fingerprint rows; analysis JSON, timed transcript, translations, blueprint, meaning map and contact sheets remain.
2. One completion advances once, including a restart or duplicate callback. Job completion, stage version, gate result and next enqueue share a transaction.
3. An agent cannot submit scores, approve another driver's run, or put source text or unsafe strings into a blueprint. A person and an agent racing on `expected_stage_version` yield one `conflict`.
4. The lyric gate uses the design's fixed 0.35 lexical, 0.80 semantic, three-word phrase and 0.55 section-meaning bounds. The task 27 relative meaning threshold is not carried forward.
5. A kie submit with unknown outcome stops as `ambiguous_spend` without a second submit; every generation and jury call remains ledger-capped.

## File Structure

| Create | Responsibility |
| --- | --- |
| `supabase/migrations/20261103010001_remakes_m2a.sql`, `20261103010002_remake_orchestrator.sql`, `20261103010003_jury_reports.sql`, `20261103010004_remake_driver.sql`, `20261103010005_gpu_lease.sql`, `20261103010006_remake_support.sql` | Add run, analysis, defaults, stage runs, reports, fingerprints, lease, stage and driver ops, uploads and notifications to existing task 27 schema |
| `packages/gates/src/lyrics.ts`, `packages/gates/src/qa.ts`, `config/gates/lyrics.json`, `config/gates/qa.json` | Product lyric rubric, QA thresholds, prompts and pinned judge IDs |
| `apps/worker/src/orchestrator.ts`, `apps/worker/src/stages/remake-separate.ts`, `apps/worker/src/remake/fingerprints.ts`, `apps/worker/src/remake/retention.ts`, `apps/worker/src/remake/disk.ts`, `apps/worker/src/remake/gpu.ts` | Durable stage transitions and bounded local resources |
| `apps/worker/py/requirements-remake.txt`, `apps/worker/py/remake_gate.py`, `apps/worker/py/remake_fingerprint.py` | Pinned CPU metrics and source frame fingerprints |
| `apps/web/lib/ops/defs/remake.ts`, `apps/web/app/api/v1/remakes/route.ts`, `apps/web/app/api/v1/remakes/[remakeId]/route.ts`, `apps/web/app/api/v1/remakes/[remakeId]/artefacts/route.ts`, `apps/web/app/api/v1/remakes/[remakeId]/stages/[stageId]/route.ts` | M1-style operation definitions and thin HTTP routes |
| `supabase/tests/remake_*.test.ts`, `apps/worker/test/remake-*.test.ts`, `apps/web/e2e/remake-m2a.spec.ts`, `eval/golden/manifest.json` | Database, worker, browser and frozen fixture checks |

| Modify | Responsibility |
| --- | --- |
| `supabase/migrations/20261102000026_remakes.sql` | Read only; do not edit an applied migration |
| `packages/shared/src/remake/{analysis,blueprint,workflow}.ts`, `packages/shared/src/stages.ts`, `packages/shared/src/status.ts`, `packages/shared/src/index.ts`, `apps/web/next.config.ts` | Tighten existing contracts and register stage names |
| `packages/remake/src/{ingest,analyse,rewrite,originality,syllables}.ts`, `packages/remake/src/index.ts` | Extend current implementation, no second remake engine |
| `apps/worker/src/{db,loop,workspace}.ts`, `apps/worker/src/stages/{index,remake,draft-lyrics,generate-song,timing,qa}.ts`, `apps/worker/src/main.ts` | Transactional orchestration and stage reuse |
| `apps/web/app/actions/remake.ts`, `apps/web/lib/studio/use-remake.ts`, `apps/web/components/studio/create/remake-card.tsx`, `apps/web/components/studio/settings-panel.tsx`, `packages/shared/src/i18n.ts`, `apps/web/lib/ops/registry.ts`, `apps/web/lib/mcp/server.ts`, `packages/cli/src/index.ts`, `packages/cli/skill/SKILL.md` | UI, HTTP, CLI and MCP on the same operations |

**Baseline and deliberate changes.** Task 27 already has `packages/remake` ingest, analysis, rewrite, LaBSE and close-line checks, schemas in `packages/shared/src/remake`, fake remake stages, a `remakes` row, the `remake_ingest` / `remake_analyse` / `remake_rewrite` jobs, and a create-panel review. Reuse them. Its `remakes` table is one language and one version; its `remake_analyse` does Demucs inside one job; `remake_rewrite` combines writing and jury; it enqueues directly; its source folder is keyed by video ID; and its review `revision` is not `stage_runs.stage_version`. Replace those contracts because 8.3/8.5 need per-language runs and atomic transitions. Task 27's `MeaningEntrySchema` has free `emotionalArc` and its blueprint admits arbitrary strings; tighten to 9.1 and migrate stored analyses by a versioned adapter, never silently reinterpret old rows. `ORIGINALITY_THRESHOLDS` uses a calibrated relative meaning floor as low as 0.30; 10.3 binds 0.55, so raise it with a documented failing-canary check. Keep the older task 27 records readable for their existing review, but new M2a runs take the v1 stage path.

**Migration ownership.** `01_remakes_m2a` extends task 27's `remakes` (no drop) with mode, tier, driver, lease, defaults snapshot, run status, stop reason and primary version; adds `stage_runs`, `remake_analyses`, `remake_defaults`, `fingerprints` (source rows), `jobs.stage_run_id`, `versions.status = analysing`, stage checks, and foreign keys on M1 `jobs.run_id` and `reservations.run_id` (`spend_entries` resolves its run through `reservation_id`). `03_jury_reports` adds the general report table and lyric dual-write. `05_gpu_lease` adds one row and the claim/heartbeat functions. `02_remake_orchestrator` adds atomic completion and stage action. `04_remake_driver` adds claim/status/submission ops. `06_remake_support` adds notifications and upload intents. If a suffix is occupied, move the affected migration to the next free suffix and update this table before implementation. No applied migration is edited.

## DDL contract for the migrations (15.2)

The following is implementation DDL, to be placed in the named migrations, not executed while writing this plan. Keep task 27 columns and rows intact. `remakes.version_id` remains the primary version and `lang` its language; no second primary-version column is needed. New runs set `workflow_version = 2`; old runs retain 1 and use the legacy reader. New lyrics are stored only in `remake_artefacts`, never in the single legacy `remakes.lyrics` value.

```sql
-- 01_remakes_m2a, after the existing task 27 and M1 migrations
alter table public.remakes
  add column workflow_version smallint not null default 1 check (workflow_version in (1,2)),
  add column mode text not null default 'copilot' check (mode in ('copilot','autopilot')),
  add constraint remake_m2a_copilot_only check (workflow_version = 1 or mode = 'copilot'),
  add column tier text not null default 'standard' check (tier in ('free','standard','premium')),
  add column budget_usd numeric(12,4) check (budget_usd > 0),
  add column driver text,
  add column driver_lease_until timestamptz,
  add column defaults_snapshot jsonb not null default '{}' check (jsonb_typeof(defaults_snapshot) = 'object'),
  add column run_status text not null default 'pending' check (run_status in ('pending','running','waiting','completed','stopped')),
  add column stop_reason text check (stop_reason in ('passed','round_cap','jury_unavailable','cost_cap','provider_exhausted','ambiguous_spend','owner_cancelled','error')),
  add constraint remake_driver_pair check ((driver is null) = (driver_lease_until is null)),
  add constraint remake_budget check (workflow_version = 1 or (budget_usd is not null and (
    (tier = 'free' and budget_usd = 0.03) or
    (tier = 'standard' and budget_usd = 0.25) or
    (tier = 'premium' and budget_usd > 0))));
create table public.remake_versions (
  remake_id uuid not null, owner_id uuid not null, version_id uuid not null,
  lang text not null check (lang in ('it','ru','ro','ja','en','es','de','zh','pt','ko','fr')),
  primary key (remake_id, version_id), unique (version_id), unique (remake_id, lang),
  unique (remake_id, version_id, owner_id),
  foreign key (remake_id, owner_id) references public.remakes(id, owner_id),
  foreign key (version_id, owner_id) references public.versions(id, owner_id)
);
insert into public.remake_versions(remake_id,owner_id,version_id,lang)
  select id,owner_id,version_id,lang from public.remakes;
create table public.stage_runs (
  id uuid primary key default gen_random_uuid(), remake_id uuid not null,
  version_id uuid not null, owner_id uuid not null,
  r_stage text not null check (r_stage in ('R1','R2','R3','R4','R4b','R5','R6','R7','R8','R9')),
  state text not null default 'pending' check (state in ('pending','running','awaiting_approval','passed','failed_jury','capped','skipped','cancelled','error')),
  round integer not null default 1 check (round > 0),
  stage_version integer not null default 0 check (stage_version >= 0),
  stop_reason text check (stop_reason in ('passed','round_cap','jury_unavailable','cost_cap','provider_exhausted','ambiguous_spend','owner_cancelled','error')),
  reserved_usd numeric(12,4) not null default 0 check (reserved_usd >= 0),
  settled_usd numeric(12,4) not null default 0 check (settled_usd >= 0), driver text,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  unique (remake_id,version_id,r_stage), unique (id,remake_id,version_id,owner_id),
  foreign key (remake_id,version_id,owner_id) references public.remake_versions(remake_id,version_id,owner_id)
);
create table public.remake_artefacts (
  stage_run_id uuid not null, remake_id uuid not null, version_id uuid not null, owner_id uuid not null,
  kind text not null check (kind in ('lyrics','blueprint')),
  revision integer not null check (revision > 0), document jsonb not null check (jsonb_typeof(document) = 'object'),
  author text not null, created_at timestamptz not null default now(),
  primary key (stage_run_id,kind,revision),
  foreign key (stage_run_id,remake_id,version_id,owner_id) references public.stage_runs(id,remake_id,version_id,owner_id)
);
alter table public.stage_runs
  add column accepted_artefact_kind text,
  add column accepted_artefact_revision integer,
  add constraint stage_accepted_pair check ((accepted_artefact_kind is null) = (accepted_artefact_revision is null)),
  add foreign key (id,accepted_artefact_kind,accepted_artefact_revision)
    references public.remake_artefacts(stage_run_id,kind,revision);
create table public.remake_analyses (
  remake_id uuid not null, owner_id uuid not null, revision integer not null check (revision > 0),
  schema_version integer not null check (schema_version = 1),
  music jsonb not null, transcript jsonb not null, literal_translations jsonb not null,
  meaning_map jsonb not null, blueprint jsonb not null, models jsonb not null,
  cost_usd numeric(12,4) not null check (cost_usd >= 0),
  untrusted boolean not null default true check (untrusted), created_at timestamptz not null default now(),
  primary key (remake_id,revision), unique (remake_id,revision,owner_id),
  foreign key (remake_id,owner_id) references public.remakes(id,owner_id),
  check (jsonb_typeof(literal_translations) = 'object')
);
create table public.remake_defaults (
  owner_id uuid primary key references public.profiles(id),
  fields jsonb not null default '{}' check (jsonb_typeof(fields) = 'object'),
  revision integer not null default 0 check (revision >= 0), updated_at timestamptz not null default now()
);
create table public.fingerprints (
  remake_id uuid not null, analysis_revision integer not null, owner_id uuid not null,
  subject_kind text not null check (subject_kind = 'source'), subject_id uuid not null,
  shot_id text not null check (shot_id ~ '^h[0-9]{1,3}$'), phash bit(64) not null,
  dinov2 real[] not null check (cardinality(dinov2) = 384),
  primary key (remake_id,analysis_revision,shot_id), check (subject_id = remake_id),
  foreign key (remake_id,analysis_revision,owner_id) references public.remake_analyses(remake_id,revision,owner_id)
);
alter table public.jobs add column stage_run_id uuid references public.stage_runs(id);
alter table public.jobs add foreign key (run_id) references public.remakes(id);
alter table public.reservations add foreign key (run_id) references public.remakes(id);
-- M1 spend_entries has reservation_id, not run_id. Resolve the run through reservations.

-- 03_jury_reports
create table public.jury_reports (
  id uuid primary key default gen_random_uuid(), owner_id uuid not null references public.profiles(id),
  version_id uuid not null, stage_run_id uuid references public.stage_runs(id),
  artefact_kind text, artefact_revision integer,
  subject_kind text not null check (subject_kind in ('lyrics','take','render','thumbnail')),
  subject_id uuid not null, round integer not null check (round > 0),
  judges jsonb not null, rubric_version text not null, scores jsonb not null,
  must_fix jsonb not null default '[]', devil_notes jsonb not null default '[]',
  available boolean not null, passed boolean not null, created_at timestamptz not null default now(),
  foreign key (version_id,owner_id) references public.versions(id,owner_id),
  foreign key (stage_run_id,artefact_kind,artefact_revision) references public.remake_artefacts(stage_run_id,kind,revision),
  check (not passed or available)
);

-- 05_gpu_lease
create table public.gpu_lease (
  id boolean primary key default true check (id), holder text,
  job_id uuid references public.jobs(id), heartbeat timestamptz,
  priority smallint check (priority between 0 and 3), expires_at timestamptz,
  check ((holder is null) = (expires_at is null))
);
insert into public.gpu_lease(id) values (true);

-- 06_remake_support
create table public.notifications (
  id uuid primary key default gen_random_uuid(), owner_id uuid not null references public.profiles(id),
  event_key text not null, kind text not null, severity text not null check (severity in ('info','warning','error')),
  title text not null check (length(title) <= 120), body text not null check (length(body) <= 200),
  link text not null, deadline timestamptz, read_at timestamptz, pushed_at timestamptz,
  created_at timestamptz not null default now(), unique (owner_id,event_key)
);
create table public.upload_intents (
  id uuid primary key default gen_random_uuid(), owner_id uuid not null references public.profiles(id),
  actor_key text not null, kind text not null check (kind in ('image','audio')),
  size_bytes bigint not null check (size_bytes > 0 and size_bytes <= 52428800),
  sha256 text not null check (sha256 ~ '^[0-9a-f]{64}$'), staging_name text not null unique,
  duration_s numeric check (duration_s > 0), state text not null default 'pending' check (state in ('pending','validated','consumed','rejected')),
  storage_path text unique, expires_at timestamptz not null,
  created_at timestamptz not null default now(), unique (id,owner_id),
  check (kind <> 'image' or size_bytes <= 20971520),
  check (state not in ('validated','consumed') or storage_path is not null)
);
```

All new tables are owned by `postgres`, have RLS enabled, and revoke all privileges from `public`, `anon`, `authenticated`, `mdf_web` and `mdf_auth`. There are no direct client table policies or grants; owner reads and writes are available through the listed definer ops only. Service-role worker access is also through the exact worker function grants, not broad table writes. For each owned operation, resolve `ops._actor`, compare `owner_id`, and enforce M1's real/test-version isolation. `remake_versions` additionally checks the version's `project_id` and `lang` against its run and membership inside the start transaction. A `before insert or update` jobs trigger checks that `stage_run_id` matches the job's owner, run and version. R1/R2 are restricted to the primary membership by the stage-creation function; the unique stage key makes simultaneous creation idempotent.

`remake_artefacts` and `remake_analyses` are append-only: install a `before update or delete` trigger which raises SQLSTATE `23514` for either operation. Allocate revisions under the locked stage/run row, insert the immutable revision, then increment `stage_version` in the same transaction. The accepted artefact pointer is set only by passing gates plus approval; a new edit clears it until that revision passes. Generation reads the accepted revision for its own version, never the latest unchecked edit. Lyrics revisions and pending edits are per language version, and gates refer to the exact artefact revision; blueprint revisions live on primary R2. The report writer verifies its job's owner/version/stage and the referenced artefact, and derives author identity from the caller rather than accepting a user-supplied author. Legacy task 27 lyrics, pending edits and revision are not copied into another language or automatically gated; old records remain on their original workflow until explicitly migrated.

Defaults `fields` is validated against the strict 8.7 schema on writes. Analysis JSON fields are validated against the Task 1 schemas before insert. The schema-checking ops reject malformed JSON and source/shot references. Scheduler names and stage check-constraint changes remain in their owning migrations. This DDL adds no direct client access to the old `remakes` table.

Concrete security and immutability DDL: execute the security loop at the end of each owning migration (the existence check skips tables introduced later); define the trigger function and its two triggers in `01_remakes_m2a`.

```sql
do $$ declare t text; begin
  foreach t in array array['remake_versions','stage_runs','remake_artefacts','remake_analyses',
    'remake_defaults','fingerprints','jury_reports','gpu_lease','notifications','upload_intents'] loop
    if to_regclass('public.' || t) is not null then
      execute format('alter table public.%I owner to postgres', t);
      execute format('alter table public.%I enable row level security', t);
      execute format('revoke all on table public.%I from public, anon, authenticated, mdf_web, mdf_auth, service_role', t);
    end if;
  end loop;
end $$;
create function ops.reject_immutable_revision() returns trigger
language plpgsql set search_path = '' as $$ begin
  raise exception using errcode = '23514', message = 'immutable revision';
end $$;
revoke all on function ops.reject_immutable_revision() from public, anon, authenticated, mdf_web, mdf_auth, service_role;
create trigger remake_artefact_immutable before update or delete on public.remake_artefacts
  for each row execute function ops.reject_immutable_revision();
create trigger remake_analysis_immutable before update or delete on public.remake_analyses
  for each row execute function ops.reject_immutable_revision();
```

For example, `grant execute on function ops.remake_start(jsonb,jsonb) to mdf_web` and `grant execute on function ops.worker_finish_remake_job(uuid,text,jsonb) to service_role` are the only corresponding callable roles after the default revokes. Apply the same exact-signature grant rule to the other interfaces in each task; add each to the M1 ACL allowlist test.

### Run caps and paid-stage reservation contract (Tasks 2, 4, 7)

`ops.remake_start` requires a positive `premium_budget_usd` for premium and ignores client-supplied budgets for free/standard. After inserting the run, but before any job insertion/reservation, execute in the same transaction:

```sql
insert into public.spend_caps(scope,key,provider,unit,period,"limit")
values ('run', new_run_id::text, '', 'usd', 'run',
  case new_tier when 'free' then 0.03 when 'standard' then 0.25 else premium_budget_usd end);
```

`new_run_id`, `new_tier` and `premium_budget_usd` are local variables validated by the wrapper. Persist the same amount in `remakes.budget_usd`. All language jobs share this `run_id`; counters use M1's run window `1970-01-01`. Reject a missing run cap for a workflow-2 job, and do not let `reserve_job` or `extend_reservation` proceed without it. The start transaction rolls back the run, cap and initial jobs together on refusal. An idempotent replay returns the existing run without inserting or raising its cap. Global/user/token caps remain in force. No artefact, stage action or retry can raise the run budget.

Extend `ops.job_spend_rule(p_job uuid) returns table(provider text, model text, items jsonb)` in `01_remakes_m2a`; preserve all M1 branches. Seed additive `provider_operations` entries for the following bounded per-call estimates, using M1's existing price units and `ops.price`. Pin actual model IDs and price rows with `checked_on` and `source`; a missing price fails as `MDF05`, never as a free stage.

| Stage / operation | Reservation estimate before provider access |
| --- | --- |
| `remake_ingest` / transcript fallback | Groq `audio_hour = 480 / 3600` for the maximum eight-minute source; captions-only execution closes the unused charge |
| `remake_analyse` / analysis | Gemini 3.8 Flash: 16,000 input and 4,000 output tokens for music/meaning, plus one translation call per target language at 8,000/4,000 tokens, plus vision at 32,000/4,000 tokens for at most 12 contact sheets |
| `draft_lyrics` with remake mode, legacy `remake_rewrite` / one R3 round | Writer 8,000/4,000 tokens, each of three pinned judges 8,000/2,000, devil 8,000/2,000; edits reserve judges and devil only, no writer |
| `remake_separate` | Explicit local-only rule, no paid reservation; no provider fallback |

Use `input_token` and `output_token` counts above as estimates mapped to the exact seeded M1 OpenRouter units (divide by 1,000,000 if the price unit is per million). Store the converted `items` in `provider_operations`, not raw USD guesses. Reserve one round, and extend before each additional round, retry, oversized prompt or additional paid call. Reject or shrink inputs before a call if extension cannot cover the bounded request. These are conservative bounds, not permission to exceed the run cap: if a configured model's prices make a tier impossible, stop with `cost_cap`. Real stage code against fake HTTP providers must prove that reservation refusal yields zero HTTP requests.

## Step 1 - M2a contracts, pipeline and exit gates

### Task 1: Freeze the shared M2a contracts

**Files:** Modify `packages/shared/src/remake/analysis.ts`, `packages/shared/src/remake/blueprint.ts`, `packages/shared/src/remake/workflow.ts`, `packages/shared/src/remake/index.ts`, `packages/shared/src/stages.ts`, `packages/shared/src/index.ts`, `apps/web/next.config.ts`; create `packages/shared/src/remake/m2a.test.ts`.

**Interfaces:** `BlueprintSchema: z.ZodType<Blueprint>`, `MeaningMapSchema: z.ZodType<MeaningMap>`, `RemakeStartInputSchema`, `RemakeStageActionInputSchema`, `ArtefactSubmitInputSchema`, `REMAKE_R_STAGES`, `REMAKE_STAGE_STATES`, `RESOURCE_CLASS: Record<Stage, 'gpu' | 'cpu' | 'net'>`; keep `RemakeAnalysisSchema` reading old task 27 artefacts through `readLegacyAnalysis(raw: unknown): RemakeAnalysis`.

- [ ] **Step 1: Write failing tests** `rejects a blueprint with source text, URL, unknown look, off-duration shot or missing section`, `rejects meaning text outside Safe(120) and imagery outside Safe(40)`, `parses a task 27 analysis with an explicit legacy adapter`, `maps every new job to one resource class`.
- [ ] **Step 2:** `pnpm --filter @mellodifai/shared exec vitest run src/remake/m2a.test.ts`. Expected: FAIL on the new contract.
- [ ] **Step 3:** Implement 9.1 exactly: bounded enums and fields, section and shot cross-checks, no source text in blueprint, `untrusted` marker on stored derivations. Preserve the old schema for old records; only new records use strict v1. Add matching Turbopack aliases.
- [ ] **Step 4:** Repeat the command. Expected: all four tests PASS.
- [ ] **Step 5:** Commit `feat(remake): define bounded M2a contracts`.

### Task 2: Add durable run rows, defaults and the start operation

**Files:** Create `supabase/migrations/20261103010001_remakes_m2a.sql`, `supabase/tests/remake_run.test.ts`, `supabase/tests/remake_spend.test.ts`, `apps/web/lib/ops/defs/remake.ts`; modify `apps/web/app/actions/remake.ts`, `apps/web/lib/ops/registry.ts`, `apps/web/lib/mcp/server.ts`, `packages/cli/src/index.ts`, `packages/cli/skill/SKILL.md`.

**Interfaces:** `ops.remake_start(p_ctx jsonb, p_input jsonb) returns jsonb` to `mdf_web`; `ops.remake_defaults_get(p_ctx jsonb) returns jsonb`; `ops.remake_defaults_set(p_ctx jsonb, p_defaults jsonb) returns jsonb`; `remakeStartDef: OpDef<RemakeStartInput, { remake_id: string; versions: JobRef[] }>` with `scope: 'spend'`, `key: true`; `remakeDefaultsGetDef` and `remakeDefaultsSetDef`. Start implements the DDL and run-cap transaction above, rejects `mode = 'autopilot'` before creating a run or reserving spend, snapshots 8.7 defaults, creates the project, one `analysing` version per language, R1/R2 on primary only, and R3 rows per target language. `remake_defaults` belongs to its user. Customer defaults never grant publish scope.

- [ ] **Step 1: Write failing DB tests** `start snapshots defaults and overrides`, `two languages share R1/R2 and receive separate R3 stage runs`, `same idempotency key creates one run`, `Autopilot start is refused with no run, jobs or spend reservation`, `workflow v2 row cannot store Autopilot mode`, `customer defaults never grant publish scope`, `another owner cannot read defaults`, `test token stamps fake providers and test_run`, `Italian revision 2 leaves English revision 1 and legacy remakes.lyrics unchanged`, `cross-owner membership or artefact FK is rejected`, `artefact and analysis update/delete fail with 23514`, `concurrent stage creation produces one row per run version and R-stage`.
- [ ] **Spend assertions** in `remake_spend.test.ts`: `free creates a 0.03 run cap before first reservation`, `standard creates a 0.25 run cap`, `premium requires and snapshots a positive explicit budget`, `missing run cap refuses a workflow-2 reservation`, `two language reservations of 0.02 under a 0.03 cap yield one success and one cap_exceeded`, `concurrent extensions cannot exceed the shared run cap`, `failed start rolls back run cap and jobs`, `idempotent replay cannot increase the cap`. Use `withRealCaps` in each competing connection with fake providers and adequate global/user/token test caps. Assert the losing reservation/extension does not charge counters; the surviving run counter equals 0.02. For the extension race start at 0.02 and race two extensions of 0.01: one succeeds, total 0.03, the other fails. Assert provider request count is zero for rejected work. Also assert `job_spend_rule returns nonzero priced estimates for ingest fallback, analysis, remake draft and devil`, `missing provider price raises MDF05`, and `explicit local separation rule makes no paid request`.
- [ ] **Step 2:** `DBTEST supabase/tests/remake_run.test.ts supabase/tests/remake_spend.test.ts`. Expected: new contract assertions FAIL.
- [ ] **Step 3:** Implement the DDL, run cap and all additive M2a `ops.job_spend_rule` / `provider_operations` rows above in the migration, then the M1-style definition, thin action, registry, MCP and CLI rows. Validate Copilot mode in the definition and refuse Autopilot in the SQL function before any write. Old task 27 public `remake_start` is a compatibility route for old UI records until the new action switches; no new agent path uses it. Italian Settings > Remake editor follows in Task 13.
- [ ] **Step 4:** Migrate e2e (`pnpm ops stack.ts migrate --env e2e`), then repeat DBTEST. Expected: all run, revision, ownership and enforced-cap assertions PASS; `supabase/tests/ops_acl.test.ts` still PASS.
- [ ] **Step 5:** Commit `feat(remake): durable runs and user defaults`.

### Task 3: Advance jobs through the stage state machine

**Files:** Create `supabase/migrations/20261103010002_remake_orchestrator.sql`, `apps/worker/src/orchestrator.ts`, `apps/worker/test/remake-orchestrator.test.ts`, `supabase/tests/remake_stage.test.ts`; modify `apps/worker/src/db.ts`, `apps/worker/src/loop.ts`, `apps/worker/src/stages/index.ts`, `packages/shared/src/stages.ts`, `packages/shared/src/status.ts`; create `packages/shared/src/remake/stage-authorization.test.ts`.

**Interfaces:** `ops.worker_finish_remake_job(p_job uuid, p_worker text, p_result jsonb) returns jsonb` to `service_role` locks job and stage row, closes reservation through M1 trigger, records gates and enqueues next jobs through `ops.worker_enqueue`; `ops.remake_stage_action(p_ctx jsonb, p_remake uuid, p_stage uuid, p_action text, p_expected_stage_version integer, p_artefact_revision integer default null) returns jsonb` to `mdf_web`; `advanceRemake(db: Db, job: Job, result: StageResult): Promise<void>`. Allowed actions are approve, edit, regenerate, skip (R6 only), cancel. R3, R8 and publish gates cannot be skipped. Copilot pauses after R3, R4, R8 and before R9. A requested Autopilot switch, including an unsupported `set_mode` action, is refused without changing stage state or enqueueing work.

- [ ] **Step 1: Write failing tests** `two jobs finishing one stage enqueue next once`, `a duplicate finish is harmless`, `approve versus approve with one stage_version yields one conflict`, `edit re-runs gates without generator`, `regenerate increments round and reserves`, `R3 skip is refused`, `Autopilot switch is refused without stage change or next enqueue`, `restart requeues stale and resumes at the same stage`, `stageAllowed permits remake_separate only while analysing`, `worker invokes remake_separate while analysing but rejects it after review without running handler`.
- [ ] **Step 2:** `DBTEST supabase/tests/remake_stage.test.ts`; `pnpm --filter @mellodifai/worker exec vitest run test/remake-orchestrator.test.ts`; `pnpm --filter @mellodifai/shared exec vitest run src/remake/stage-authorization.test.ts`. Expected: FAIL.
- [ ] **Step 3:** Add `remake_separate` to `STATUS_STAGES.analysing` and the `stageAllowed` analysing list in `packages/shared/src/status.ts`, set `STAGE_STATUS.remake_separate = 'analysing'`, and keep it refused in other statuses. Add remake-mode `draft_lyrics` eligibility while analysing, guarded by the attached R3 stage; the legacy non-remake status behavior stays unchanged. Make the generic status decorator defer remake transitions to the orchestrator. Implement a single transaction per completion. Extend `Db.finishJob` or route remake completions to the SQL function; never commit job done before stage advancement. Reject mode changes in stage actions and leave the stage and job queue untouched. Keep 15 s heartbeat and M1 reservation close semantics. Map `failed_jury`, `capped`, `error`, cancellation and the 8.6 stop reasons, with transient backoff 30 s, 2 min, 10 min. Unknown kie submit sets `ambiguous_spend` through M1 `ops.mark_ambiguous` and never resends.
- [ ] **Step 4:** Migrate e2e, repeat all three commands. Expected: all stage authorization and orchestration cases PASS; M1 `ops_ledger.test.ts` PASS.
- [ ] **Step 5:** Commit `feat(worker): advance remake stages atomically`.

### Task 4: Complete R1 and R2 with bounded source data

**Files:** Create `apps/worker/src/stages/remake-separate.ts`, `apps/worker/test/remake-analysis.test.ts`; modify `packages/remake/src/ingest.ts`, `packages/remake/src/analyse.ts`, `apps/worker/src/stages/remake.ts`, `apps/worker/src/stages/index.ts`, `apps/worker/src/workspace.ts`, `apps/worker/src/fake/remake.ts`, `apps/worker/src/db.ts`.

**Interfaces:** `remakeSeparate: StageHandler`, `runRemakeAnalysis(input: { remakeId: string; sourceDir: string; targetLangs: string[]; signal: AbortSignal }): Promise<RemakeAnalysis>`; `remake_ingest` stays net, `remake_separate` is GPU, `remake_analyse` is net. R1 takes yt-dlp audio/video/captions/metadata, Whisper fallback, at most 48 frames and at most 12 4x4 contact sheets; R2 makes word timing, literal translations for every target language, abstract meaning map and validated blueprint. All derived fields are `untrusted` and prompt-safe under 6.8.

- [ ] **Step 1: Write failing tests** `R1 caps frames and contact sheets and times out after 10 min`, `R2 uses separated vocals and stores one literal translation per target`, `blueprint from unsafe model output fails validation`, `R2 does not delete media before analysis and fingerprint commit`, `fake source reaches the R3 boundary without network or paid calls`, `real analysis stage on fake HTTP opens a nonzero reservation before the first paid request`, `analysis cap refusal or failed extension makes zero subsequent provider calls`, `unpriced analysis model raises MDF05 without HTTP`. Force real caps for these fake-provider ledger tests.
- [ ] **Step 2:** `pnpm --filter @mellodifai/remake exec vitest run src/ingest.test.ts src/analyse.test.ts`; `pnpm --filter @mellodifai/worker exec vitest run test/remake-analysis.test.ts`. Expected: new assertions FAIL.
- [ ] **Step 3:** Reuse the package's existing yt-dlp, ffmpeg, Groq and OpenRouter adapters, but use M1 paid-call wrappers and fake endpoints. Move from the current `<root>/remakes/<videoId>` directory to `WorkspaceFactory`'s shared `<workspace root>/remakes/<remake id>`; migrate only new runs, keep legacy reads. Validate and save the data in `remake_analyses` before R2 passes.
- [ ] **Step 4:** Repeat both commands. Expected: all existing analysis tests and every new reservation/refusal assertion PASS.
- [ ] **Step 5:** Commit `feat(remake): separate and analyse source per run`.

### Task 5: Fingerprint source frames and enforce retention

**Files:** Create `apps/worker/py/requirements-remake.txt`, `apps/worker/py/remake_fingerprint.py`, `apps/worker/src/remake/fingerprints.ts`, `apps/worker/src/remake/retention.ts`, `apps/worker/test/remake-retention.test.ts`, `supabase/tests/remake_fingerprints.test.ts`; modify `apps/worker/src/stages/remake.ts`, `apps/worker/src/main.ts`.

**Interfaces:** `fingerprintSource(input: { frames: Array<{ shotId: string; path: string }>; python: string }): Promise<Array<{ shotId: string; phash: string; dinov2: number[] }>>`; `deleteR2Source(workspace: string, keep: string[]): Promise<void>`; `retentionSweep(db: Db, root: string, now: Date): Promise<number>`. Store one source fingerprint per blueprint shot at section-relative position; pHash 64-bit and DINOv2 ViT-S/14 CPU. Scheduler adds `retention_sweep` daily.

- [ ] **Step 1: Write failing tests** `one fingerprint remains per source shot`, `R2 deletion preserves analysis, transcript, translations, map, blueprint, fingerprints and contact sheets`, `a failed R2 leaves source for retry`, `14-day sweep removes only unchosen takes and intermediates after publishing`, `master, Short, stems and timeline remain`.
- [ ] **Step 2:** `DBTEST supabase/tests/remake_fingerprints.test.ts`; `pnpm --filter @mellodifai/worker exec vitest run test/remake-retention.test.ts`. Expected: FAIL.
- [ ] **Step 3:** Pin CPU packages and model cache to `<runtime root>/cache`. Commit fingerprint rows and R2 result before deleting media. Sweep only paths resolved beneath the remake workspace; log counts, not source content.
- [ ] **Step 4:** Repeat both commands. Expected: five tests PASS.
- [ ] **Step 5:** Commit `feat(remake): keep fingerprints and sweep source media`.

### Task 6: Make the lyric originality and syllable gate binding

**Files:** Create `apps/worker/py/remake_gate.py`, `apps/worker/test/remake-gate.test.ts`, `config/gates/lyrics.json`; modify `packages/remake/src/originality.ts`, `packages/remake/src/syllables.ts`, `packages/remake/src/rewrite.ts`, `packages/shared/src/remake/analysis.ts`, `apps/worker/src/stages/remake.ts`, `apps/worker/py/requirements-remake.txt`.

**Interfaces:** `checkRemakeLyrics(analysis: RemakeAnalysis, lyrics: RemakeLyrics, embed: Embed): Promise<{ passed: boolean; failingLines: number[]; failingSections: string[]; timing: Array<{ line: number; delta: number }> }>`; Python `remake_gate.py` accepts JSON on stdin and writes only metrics JSON on stdout. Lexical character 4-gram Jaccard or ROUGE-L above 0.35 fails; LaBSE line cosine above 0.80 fails; title/hook shared run of three or more normalized words fails; each section's meaning-map cosine below 0.55 fails; syllable/mora/character count must be within 1.

- [ ] **Step 1: Write failing tests** `close paraphrase fails lexical or semantic`, `literal translation fails`, `three-word hook copy fails`, `section with 0.54 fails and 0.55 passes`, `Japanese mora and Chinese Han counts fit within one`, `a good same-language Italian rewrite passes`.
- [ ] **Step 2:** `pnpm --filter @mellodifai/remake exec vitest run src/originality.test.ts src/syllables.test.ts`; `pnpm --filter @mellodifai/worker exec vitest run test/remake-gate.test.ts`. Expected: new cases FAIL.
- [ ] **Step 3:** Reuse current lexical and LaBSE functions, replace the task 27 ratio/floor for new runs with fixed 0.55. Keep a read adapter for old report JSON. Do not let a passing judge override a failed metric.
- [ ] **Step 4:** Repeat both commands. Expected: six new cases PASS. Record any frozen artefact that cannot clear the binding threshold for the owner; never relax it locally.
- [ ] **Step 5:** Commit `feat(remake): enforce binding originality and timing gates`.

### Task 7: Centralize lyric juries and persist reports

**Files:** Create `supabase/migrations/20261103010003_jury_reports.sql`, `supabase/tests/remake_jury.test.ts`, `packages/gates/package.json`, `packages/gates/src/lyrics.ts`, `packages/gates/src/qa.ts`, `config/gates/qa.json`, `apps/worker/test/remake-jury.test.ts`; modify `config/gates/lyrics.json`, `packages/remake/src/rewrite.ts`, `apps/worker/src/stages/remake.ts`, `apps/worker/src/stages/draft-lyrics.ts`, `apps/worker/src/stages/lyric-jury.ts`, `apps/worker/package.json`, `packages/remake/package.json`, `pnpm-lock.yaml`, `apps/worker/src/stages/qa.ts`, `apps/web/lib/studio/use-remake.ts`, `packages/shared/src/remake/analysis.ts`.

**Interfaces:** `judgeRemakeLyrics(input: { lyrics: RemakeLyrics; meaning: MeaningMap; timing: unknown; round: number }, deps: JudgeDeps): Promise<JuryReport>`; `ops.worker_jury_report(p_job uuid, p_report jsonb) returns uuid` to `service_role`; `JuryReport` stores judges, model IDs, rubric version, mean per criterion, must-fix, devil notes, availability and pass. Move `PASS_SCORE`, `combine()`, `CRITERIA` and judge prompts from `apps/worker/src/stages/lyric-jury.ts`, and QA thresholds into `packages/gates/**` and `config/gates/**`, so stage code imports the gate. Preserve all five existing criteria (`language`, `singable`, `chorus`, `original`, `topic`) and add `meaning_fidelity`, `timing_fit`, `youtube_safety`: eight total. T27 omitted `topic`; restore it for design 10.2 compliance, judging topic against the abstract meaning-map topic rather than source wording. Add `@mellodifai/gates` workspace dependencies to worker and remake, export the centralized implementation from its package, and update the lockfile.

- [ ] **Step 1: Write failing tests** `all eight lyric criteria each meet 0.70`, `each criterion independently blocks passage at 0.69 while the other seven score 1.0`, `devil must_fix on originality blocks despite passing scores`, `devil note has no score vote`, `Copilot old lyric jury unavailable is visible but fail-open`, `new M2a Copilot remake jury fails closed`, `reports dual-write versions.lyric_jury and jury_reports`, `agent cannot write a jury_report`, `existing jury callers import the centralized implementation and no duplicate PASS_SCORE or combine remains in lyric-jury.ts`, `withRealCaps reserves the devil estimate before fake HTTP and cap refusal makes zero devil requests`, `refused jury extension prevents the next judge or devil request`. Use a table-driven test for each of language, singable, chorus, original, topic, meaning_fidelity, timing_fit and youtube_safety. Run ledger assertions through M1 `withRealCaps` against fake HTTP providers, including a fake-provider job that would otherwise bypass caps.
- [ ] **Step 2:** `DBTEST supabase/tests/remake_jury.test.ts`; `pnpm --filter @mellodifai/worker exec vitest run test/remake-jury.test.ts`. Expected: FAIL.
- [ ] **Step 3:** Call pinned Jev, Haiku 5.5 and Gemini 3.8 Flash judges, and Sonnet 5.5 devil's advocate, through M1 ledger and fake providers. Detect privacy-filter redaction. Rewrite only failing lines, keep passing lines, maximum three rounds. Keep the original task 27 UI column until M3 moves readers.
- [ ] **Step 4:** Migrate e2e, repeat both commands. Expected: all named cases PASS; `supabase/tests/ops_acl.test.ts` PASS.
- [ ] **Step 5:** Commit `feat(remake): persist lyric jury and devil reports`.

### Task 8: Driver lease, artefact submission and stage actions

**Files:** Create `supabase/migrations/20261103010004_remake_driver.sql`, `supabase/tests/remake_driver.test.ts`, `apps/web/app/api/v1/remakes/route.ts`, `apps/web/app/api/v1/remakes/[remakeId]/route.ts`, `apps/web/app/api/v1/remakes/[remakeId]/artefacts/route.ts`, `apps/web/app/api/v1/remakes/[remakeId]/stages/[stageId]/route.ts`, `apps/web/lib/ops/defs/remake.test.ts`; modify `apps/web/lib/ops/defs/remake.ts`, `apps/web/lib/ops/registry.ts`, `apps/web/lib/mcp/server.ts`, `apps/web/app/actions/remake.ts`, `packages/cli/src/index.ts`, `packages/cli/skill/SKILL.md`.

**Interfaces:** `ops.remake_driver_claim(p_ctx jsonb, p_remake uuid) returns jsonb`, `ops.remake_status(p_ctx jsonb, p_remake uuid) returns jsonb`, `ops.artefact_submit(p_ctx jsonb, p_remake uuid, p_stage uuid, p_kind text, p_payload jsonb, p_expected_stage_version integer) returns jsonb`; `remakeDriverClaimDef`, `remakeStatusDef`, `artefactSubmitDef`, `remakeStageActionDef` are `OpDef`s. Lease is 15 minutes and renewed by its holder on every call. Only `lyrics` and `blueprint` kinds are accepted in M2a. Inputs are schema-validated, revisioned and checked by gates. Jury payloads are refused. Resource `mellodifai://remakes/{remake_id}` carries `untrusted_source` on source-derived fields.

- [ ] **Step 1: Write failing tests** `second agent cannot claim live lease`, `holder call renews 15-minute lease`, `expired Copilot lease waits`, `Autopilot mode switch is refused while lease is expired`, `wrong-stage edit returns conflict`, `agent lyric submission runs gate and cannot inject scores`, `blueprint script or URL fails schema`, `MCP resource annotates source data untrusted`.
- [ ] **Step 2:** `DBTEST supabase/tests/remake_driver.test.ts`; `pnpm --filter web exec vitest run lib/ops/defs/remake.test.ts`. Expected: FAIL.
- [ ] **Step 3:** Use M1 `_actor`, scope and test-run checks. Add thin HTTP routes and MCP tools through `TOKEN_OPS`; add CLI command names with idempotency key on writes. Keep all scores worker-owned.
- [ ] **Step 4:** Migrate e2e, repeat both commands. Expected: eight tests PASS; M1 MCP tool-list test PASS.
- [ ] **Step 5:** Commit `feat(remake): lease driver and accept authored artefacts`.

### Task 9: Reuse song generation and time the new take

**Files:** Create `apps/worker/test/remake-music.test.ts`; modify `apps/worker/src/stages/generate-song.ts`, `apps/worker/src/stages/timing.ts`, `apps/worker/src/stages/qa.ts`, `apps/worker/src/stages/remake.ts`, `apps/worker/src/orchestrator.ts`, `packages/remake/src/style.ts`, `packages/shared/src/remake/timing-check.ts`, `supabase/tests/remake_stage.test.ts`.

**Interfaces:** `buildRemakeGeneration(analysis: RemakeAnalysis, lyrics: RemakeLyrics, engine: 'kie' | 'ace-step'): GenerationInput`; `scoreRemakeTake(input: { source: Blueprint; take: TimedTake; recall: number; qa: QaResult }): { passed: boolean; timing: TimingCheck; reasons: string[] }`. Kie custom mode receives section-tagged lyrics and genre/mood/BPM/vocal style, no source audio, artist or title name, and no unsupported BPM/duration parameter. ACE-Step 1.5 gets BPM, key and duration directly. New-take section detection maps section IDs and word timing to R4b.

- [ ] **Step 1: Write failing tests** `kie request contains no source audio or artist name`, `ACE-Step gets BPM key and duration`, `recall 0.74 fails and 0.75 passes`, `tempo over 5 percent or section over 15 percent fails the round`, `loudness or peak failure blocks`, `standard stops after two generations`, `unknown kie submit is never resent`.
- [ ] **Step 2:** `pnpm --filter @mellodifai/worker exec vitest run test/remake-music.test.ts`; `DBTEST supabase/tests/remake_stage.test.ts`. Expected: new cases FAIL.
- [ ] **Step 3:** Reuse `generate_song`, `score_takes`, `timing`, QA and `keepsTiming`; feed the chosen new take to R4b. R4b must finish before M2a is done. Every paid attempt goes through M1 reservation and ambiguous-spend handling.
- [ ] **Step 4:** Repeat both commands. Expected: seven cases PASS.
- [ ] **Step 5:** Commit `feat(remake): score generated take and map new timing`.

### Task 10: Enforce one GPU lease and disk guard

**Files:** Create `supabase/migrations/20261103010005_gpu_lease.sql`, `supabase/tests/remake_gpu.test.ts`, `apps/worker/src/remake/gpu.ts`, `apps/worker/src/remake/disk.ts`, `apps/worker/test/remake-resources.test.ts`; modify `apps/worker/src/db.ts`, `apps/worker/src/loop.ts`, `apps/worker/src/main.ts`, `apps/worker/src/stages/remake-separate.ts`, `packages/shared/src/stages.ts`.

**Interfaces:** `ops.gpu_claim(p_job uuid, p_worker text, p_free_vram_mb integer) returns boolean`, `ops.gpu_heartbeat(p_job uuid, p_worker text) returns boolean`, `ops.gpu_release(p_job uuid, p_worker text) returns void`, `ops.disk_guard(p_free_bytes bigint) returns boolean` to `service_role`; `prepareGpuJob(job: Job, deps: { freeVramMb(): Promise<number>; unloadComfy(): Promise<void> }): Promise<boolean>`. Lease TTL 60 s, heartbeat 15 s, priority 0/1/2 and supervisor `loop-eval` priority 3. `claim_job` orders priority then age and never hands two GPU jobs out. Remotion/Demucs require 6 GB free VRAM after Comfy unload; local disk below 50 GB pauses new remakes. `disk_guard` scheduled every 10 minutes.

- [ ] **Step 1: Write failing tests** `two parallel GPU claims yield one winner`, `expired lease can be reclaimed`, `heartbeat extends 60 s`, `CPU/net jobs are not blocked by GPU lease`, `a 5.9 GB free GPU does not start Demucs`, `a 49 GB E drive pauses new remakes and 50 GB resumes`, `loop-eval yields between items when production waits`.
- [ ] **Step 2:** `DBTEST supabase/tests/remake_gpu.test.ts`; `pnpm --filter @mellodifai/worker exec vitest run test/remake-resources.test.ts`. Expected: FAIL.
- [ ] **Step 3:** Add the one-row lease and extend M1 `claim_job` without changing non-GPU eligibility. Pin `TMP`, `TEMP`, `HF_HOME`, `XDG_CACHE_HOME`, pip, yt-dlp, Remotion and browser caches under `<runtime root>/cache/`. The supervisor's yield file is read-only to the sandbox.
- [ ] **Step 4:** Migrate e2e, repeat both commands. Expected: seven tests PASS.
- [ ] **Step 5:** Commit `feat(worker): lease GPU and guard remake disk space`.

### Task 11: Notifications and token upload intents

**Files:** Create `supabase/migrations/20261103010006_remake_support.sql`, `supabase/tests/remake_support.test.ts`, `apps/worker/src/remake/notifications.ts`, `apps/worker/test/remake-notifications.test.ts`, `apps/web/lib/ops/defs/upload-intent.ts`, `apps/web/app/api/v1/uploads/route.ts`; modify `apps/worker/src/main.ts`, `apps/web/lib/ops/registry.ts`, `apps/web/lib/mcp/server.ts`, `apps/web/components/studio/settings-panel.tsx`, `packages/shared/src/i18n.ts`.

**Interfaces:** `ops.notifications_list(p_ctx jsonb, p_cursor text, p_limit integer) returns jsonb` to `mdf_web`; `ops.worker_notify(p_owner uuid, p_kind text, p_severity text, p_title text, p_body text, p_link text, p_deadline timestamptz) returns uuid` to `service_role`; `ops.upload_intent_create(p_ctx jsonb, p_kind text, p_size bigint, p_sha256 text) returns jsonb`, `ops.upload_intent_complete(p_ctx jsonb, p_intent uuid, p_storage_path text) returns jsonb` to `mdf_web`; `pushNotifications(db: Db, topic: string | null): Promise<number>`. Intent rows bind owner, kind, size, sha256, staging name, duration, state and final storage path; the M2b image path consumes them. Token uploads are scoped, size-limited, keyed and validated again on completion. `notify_push` runs through the scheduler; no topic means in-app only. Push title, body at most 200 characters and link, never lyrics or personal data.

- [ ] **Step 1: Write failing tests** `expired Copilot lease creates one in-app notification`, `agent sees only owner's notifications`, `upload intent binds owner, size and hash`, `another token cannot complete an intent`, `over-limit bytes and reused staging name are refused`, `ntfy payload contains no lyrics or secrets`, `missing NTFY_TOPIC leaves pending in-app notice without an HTTP call`.
- [ ] **Step 2:** `DBTEST supabase/tests/remake_support.test.ts`; `pnpm --filter @mellodifai/worker exec vitest run test/remake-notifications.test.ts`. Expected: FAIL.
- [ ] **Step 3:** Implement the M2a-owned tables of 15.2 and 16. Use the M1 scheduler claim/finish functions and ops registry; keep the ntfy topic in the worker's local env only. M2b must validate and re-encode an image before completing its intent.
- [ ] **Step 4:** Migrate e2e and repeat both commands. Expected: all named cases PASS; `supabase/tests/ops_acl.test.ts` PASS.
- [ ] **Step 5:** Commit `feat(remake): notify paused runs and stage token uploads`.

### Task 12: Golden set v0 and the fake-provider exit test

**Files:** Create `eval/golden/manifest.json`, `apps/worker/src/remake/golden.ts`, `apps/worker/test/remake-golden.test.ts`, `apps/web/e2e/remake-m2a.spec.ts`; modify `apps/worker/src/fake/remake.ts`, `apps/web/e2e/support.ts`, `packages/remake/test/fixtures/remake-analysis.json`, `packages/remake/test/fixtures/remake-lyrics.it.json`, `packages/cli/skill/SKILL.md`.

**Interfaces:** `loadGoldenManifest(path: string): GoldenManifest` reads five curated item IDs and paths under `<runtime root>/golden/`; manifest references frozen analysis, takes, stems, images and word timing but contains no media or keys. This is the only golden-set source; no table. V0 includes an owner-owned/CC source, a one-line idea, a known close paraphrase and a literal translation; add placeholders with `pending_owner_asset` only when a rights-cleared item is unavailable, and do not claim the five-item exit gate then. The deterministic canaries reject bad lyrics and the forbidden timeline field; OCR and distinctness canaries are recorded for M3.

- [ ] **Step 1: Write failing tests** `all five manifest items resolve to frozen artefacts`, `close paraphrase and literal translation are rejected without paid judge`, `fixture runs R1-R4b on fakes and pauses at R3 then R4`, `MCP test token submits lyrics for one run`, `fingerprints survive and source media are absent after R2`, `test version cannot publish`.
- [ ] **Step 2:** `pnpm --filter @mellodifai/worker exec vitest run test/remake-golden.test.ts`; `E2E_PORT=3225 pnpm e2e -- remake-m2a.spec.ts`. Expected: FAIL.
- [ ] **Step 3:** Add only rights-cleared IDs and frozen, non-secret artefacts. Use `WORKER_FAKE=1` and e2e Supabase 45621. Complete the fixture run through the real ops, HTTP and MCP surfaces. Do not use the owner video until the owner supplies it; if missing, report the unmet five-item gate explicitly.
- [ ] **Step 4:** Repeat both commands. Expected: all six checks PASS for an available complete set. No kie or other paid call is made.
- [ ] **Step 5:** Commit `test(remake): freeze golden v0 and M2a fake exit flow`.

### Task 13: Console, defaults UI and final verification

**Files:** Modify `apps/web/components/studio/create/remake-card.tsx`, `apps/web/components/studio/settings-panel.tsx`, `apps/web/lib/studio/use-remake.ts`, `apps/web/app/actions/remake.ts`, `packages/shared/src/i18n.ts`, `apps/web/e2e/remake-m2a.spec.ts`; create `apps/web/components/studio/create/remake-console.test.tsx`.

**Interfaces:** `RemakeView` adds `stageRuns`, `juryReports`, `driver`, `leaseUntil`, `stopReason`, `reservedUsd`, `settledUsd`; Console actions call `remakeStageActionDef` and `artefactSubmitDef`, never old public RPCs for new runs. Settings edits the `remake_defaults` fields of 8.7, with per-call overrides. Buttons show approve, edit, regenerate and allowed skip only when the stage and actor permit them.

- [ ] **Step 1: Write failing tests** `Console shows stage inputs, outputs, scores, devil notes, costs and stop reason`, `only R6 offers skip`, `driver-expired Copilot run shows waiting`, `Settings saves Italian defaults and English translation`, `two actors racing show conflict and refresh`.
- [ ] **Step 2:** `pnpm --filter web exec vitest run components/studio/create/remake-console.test.tsx`; `E2E_PORT=3225 pnpm e2e -- remake-m2a.spec.ts`. Expected: FAIL.
- [ ] **Step 3:** Implement the smallest view over `remake_status`; show only Copilot mode for M2a and reject any forged Autopilot value through the operation. Check the visible flow in a real browser at 1440x900 and 1360x600; save screenshots under `E:/mellodifai/reports/m2a-shots/`.
- [ ] **Step 4:** Repeat tests. Expected: five cases and e2e PASS. Run `pnpm install --frozen-lockfile`, `pnpm lint`, `pnpm typecheck`, `pnpm --filter web exec tsc --noEmit`, `pnpm test`, `pnpm test:db`, `E2E_PORT=3225 pnpm e2e`; each exits 0. Check all new `ops` grants in `ops_acl.test.ts`.
- [ ] **Step 5:** Commit `feat(web): show remake stages and defaults`, push the branch and write the implementation report.

## Self-review: requirement to task

| Design requirement | Task and proof |
| --- | --- |
| 21.4 M2a R1-R4b on fakes, Copilot pauses | 2-4, 8-9, 12; fake e2e through R4b |
| R1/R2 review: transactional tier caps, paid-stage estimates and status authorization | 2-4, 7; enforced-cap races, provider-call refusal and stage-authorization tests |
| R1/R2 review: concrete DDL, language isolation and immutable revisions | 2, 8; ownership FKs, append-only and legacy compatibility assertions |
| 8.1-8.3 Copilot, tiers, per-language versions, stage/job mapping, ledger | 2-3, 9; run and stage DB tests; M5 owns Autopilot |
| 8.4 R1/R2 blueprint, meaning map, literal translations, fingerprints, deletion | 1, 4-5; schema, analysis, retention tests |
| 8.4 R3, R4, R4b; 8.6 retries and round caps | 6-7, 9; gate, jury, music tests |
| 8.5 stage state machine, approvals, edit, regenerate, skip, version conflict | 3, 8; stage DB concurrency tests |
| 8.7 defaults and Settings | 2, 13; defaults DB and UI tests |
| 6.8/9.1 untrusted derived fields and schema | 1, 4, 8; schema and MCP tests |
| 10.1-10.3 product gates, jury, devil, originality, fixed thresholds | 6-7; metrics, jury, ACL tests |
| 11.5 paid calls and 6.9 fake-provider token | 2-3, 7, 9, 12; M1 ledger and fake e2e tests |
| 13.4 golden set v0 and first canaries | 12; frozen manifest and deterministic canary tests |
| 14.1 GPU lease and 14.3 retention/disk | 5, 10; resource and retention tests |
| 15.2 remakes, stage runs, analyses, defaults, reports, fingerprints, lease, notifications and uploads | 2, 5, 7, 10-11; migration and DB tests |
| 16 notifications and ntfy | 11; notification and fake push tests |
| Console and agent `remake_status` / `artefact_submit` | 8, 13; MCP, UI and e2e tests |

**M2a boundary:** R5-R7, timeline and image submission are M2b. R6 generation and R8 visual jury are M3. Publishing and veto window are M4; M2a stops before those stages. No paid real-provider validation belongs in this milestone's tests.
