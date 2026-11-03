# M2b Remade Video Implementation Plan

> **For agentic workers:** Execute tasks in order after M1 and M2a. Use checkbox (`- [ ]`) steps for tracking. The fixture uses fake providers and the e2e stack.

**Goal:** A remade song completes R5 through R7 into a 1080p master, 9:16 hook Short, three thumbnail candidates and captions. An agent reads and patches a scene, and the rerender visibly contains the new text. Code, URLs and unknown blocks in a timeline are rejected.

**Architecture:** One versioned, data-only timeline document is shared by the worker, MCP and later editor. `packages/shared/src/timeline/blocks.ts` defines the finite block vocabulary; `TimelineVideo` in `packages/visualizer` is the only renderer. The R5 mapper retimes blueprint shots to the chosen take and writes an append-only revision. R7 reuses the current worker render, art and QA path with its engine changed to `TimelineVideo`. M2a's `stage_runs` orchestrator and M1 ops/ledger handle transitions and spends.

**Tech Stack:** pnpm monorepo, Next.js 16.4, Zod, Supabase Postgres 17, Remotion 4, Vitest, Playwright, ffmpeg, existing Video Studio visualizer package and M1/M2a ops.

**Spec:** `docs/superpowers/specs/2026-11-01-agentic-studio-design.md`, revision 6, sections 6.8, 8.3-8.6 (R5-R7), 9.2-9.4, 10.1, 11.5, 14.1-14.3, 15.2, 19 and 21.4. M1 interface names are from `docs/superpowers/plans/2026-11-02-m1-agent-access.md`, Tasks 17, 19, 25, 28, 40 and 41. M2a interfaces are from `2026-11-03-m2a-remade-song.md`, Tasks 1-3, 8-10.

## Global Constraints

- No paid credits in tests; `WORKER_FAKE=1`, fake HTTP servers and `test_mode` tokens only. E2e uses API 45621 and `E2E_PORT=3225`, never the live API at 54321.
- No secrets or owner media in logs, commits or external hosts. Runtime files and model/browser/render caches live under `E:/mellodifai` or `G:/caches`, never C:. Stop if C: has less than 20 GB free.
- Additive migration with database tests. Reserve `20261103020001_timelines.sql`, checking that number is free before implementation. Every new `ops.*` function is `postgres`-owned `security definer`, empty search path and UTC, revoked from public roles and granted by exact signature only to `mdf_web` or `service_role`.
- M1 `OpDef`, `runOp`, `runAction`, `remoteAction`, `TOKEN_OPS`, `buildMcpServer` and keyed `ops.idem_begin` are the one UI, HTTP and MCP path. M1 `ops.worker_enqueue` carries token/run/fake/priority/reservation to child jobs. M2a `ops.worker_finish_remake_job` and `stage_runs` determine stage completion.
- New relative `.js` imports under `packages/shared/src` get matching `turbopack.resolveAlias` entries in `apps/web/next.config.ts`.
- UI copy is Italian, with English in existing i18n. Plain commit messages, no co-author lines, no em dash characters.
- Run frozen install, lint, typecheck, web `tsc --noEmit`, unit, database and e2e gates before merge. DBTEST below is the exact M1 e2e env command under “How tests reach a stack”.

## Review Focus

1. Validate at the ops boundary and again immediately before rendering. A JSON document must never turn into JSX, imports, URLs, CSS or arbitrary file reads.
2. A patch edits only a caller-owned timeline at the expected revision, passes full validation, creates one new revision and enqueues one rerender. A stale edit returns `conflict`.
3. The agent's image is decoded and re-encoded, with MIME determined from bytes. Reject more than 20 MB, more than 8192 px on either side, a URL or a polyglot.
4. Both master and hook have QA results. The hook is full-frame 9:16, at most three minutes, selected by the design's hook/chorus-energy rule.
5. The existing Video Studio presets and logo controls still render. New timeline blocks can reuse their looks without changing the saved preset contract.

## File Structure

| Create | Responsibility |
| --- | --- |
| `supabase/migrations/20261103020001_timelines.sql`, `20261103020002_timeline_images.sql`, `supabase/tests/remake_timeline.test.ts`, `supabase/tests/remake_images.test.ts` | Append-only revisions, submitted `timeline_assets` records, authorized ops, optimistic patch and render queue |
| `packages/shared/src/timeline/blocks.ts`, `packages/shared/src/timeline/schema.ts`, `packages/shared/src/timeline/index.ts`, `packages/shared/src/timeline/timeline.test.ts` | Bounded block vocabulary and whole-document validator |
| `packages/visualizer/src/TimelineVideo.tsx`, `timeline-blocks.tsx`, `kinetic-lyrics/` (files listed in Task 3), `timeline.test.tsx` | Remotion composition and moved kinetic lyric components |
| `apps/worker/src/stages/compose-timeline.ts`, `apps/worker/src/remake/retime.ts`, `apps/worker/src/remake/images.ts`, `apps/worker/test/remake-video.test.ts` | R5 retime, stored image verification and R7 checks |
| `apps/web/lib/ops/defs/timeline.ts`, `apps/web/app/api/v1/remakes/[remakeId]/timeline/route.ts`, `apps/web/app/api/v1/remakes/[remakeId]/images/route.ts`, `apps/web/e2e/remake-m2b.spec.ts` | M1-style definitions, thin HTTP routes and browser exit test |

| Modify | Responsibility |
| --- | --- |
| `packages/shared/src/stages.ts`, `packages/shared/src/status.ts`, `packages/shared/src/index.ts`, `apps/web/next.config.ts` | Register `compose_timeline`, timeline exports and aliases |
| `packages/visualizer/src/Root.tsx`, `packages/visualizer/scripts/render.mjs`, `packages/visualizer/package.json` | Register and render `TimelineVideo` without changing `Visualizer` |
| `apps/worker/src/stages/{index,render,art,qa}.ts`, `apps/worker/src/{db,loop}.ts` | R5/R7 jobs, hook QA and M2a orchestration |
| `apps/web/lib/ops/registry.ts`, `apps/web/lib/mcp/server.ts`, `packages/cli/src/index.ts`, `packages/cli/skill/SKILL.md`, `packages/shared/src/i18n.ts` | `timeline_get`, `timeline_patch`, image submission and messages |

**Baseline and deliberate changes.** The repo already has `packages/visualizer` with saved Video Studio presets and `packages/visualizer/scripts/render.mjs`; `apps/worker/src/stages/render.ts` already has master/hook handlers, `art.ts` makes captions and art, and `qa.ts` checks output. Reuse those paths. The old VBP render calls `scripts/r.mjs` under the engine repo and `apps/worker/src/stages/utils.ts` currently hardcodes `ENGINE_ROOT` on C:. M1 Task 23 changes it to `MELLODIFAI_ENGINE_ROOT`; M2b depends on that and selects the visualizer package renderer only for remake timeline jobs. Video Studio presets stay separate from timeline revisions; their look IDs are reused in the `visualizer` block. The engine repo's `motion/src` lyric files are copied into `packages/visualizer` as 9.3 requires, with license and dependency checks, while VBP scenes remain there. Existing task 27 `remakes` has no timeline; M2a adds R-stage orchestration. M2b adds an append-only table, never overloads `remakes.analysis` or the Video Studio preset JSON.

**Milestone boundary.** M2b includes the `image_submit` part of `artefact_submit` and R6 skip/assets, but the OD5 image-generation routes and visual jury are M3. For the R5-R7 exit fixture, every `imageNeed` is `none` or an agent-submitted, validated image. This is an explicit gap from the full R6 description in 8.4, and it is allowed by 21.4's M2b contents and 8.5's R6 skip. R7 stops at the video-review boundary; publishing waits for M3/M4 gates.

## DDL contract and patch transaction (15.2, 8.5)

Place this DDL in the named migrations after M2a. It is a plan contract, not a migration applied by this documentation change.

```sql
-- 01_timelines
create table public.timelines (
  version_id uuid not null, remake_id uuid not null, owner_id uuid not null,
  revision integer not null check (revision > 0),
  document jsonb not null check (jsonb_typeof(document) = 'object' and document->>'schemaVersion' = '1'),
  author text not null, stage_run_id uuid not null, stage_version integer not null check (stage_version >= 0),
  created_at timestamptz not null default now(),
  primary key (version_id,revision), unique (version_id,revision,owner_id),
  foreign key (stage_run_id,remake_id,version_id,owner_id) references public.stage_runs(id,remake_id,version_id,owner_id)
);

-- 02_timeline_images
create table public.timeline_assets (
  id uuid primary key default gen_random_uuid(), remake_id uuid not null,
  version_id uuid not null, owner_id uuid not null, shot_id text not null check (shot_id ~ '^h[0-9]{1,3}$'),
  upload_intent_id uuid not null unique,
  kind text not null check (kind = 'image'), mime text not null check (mime in ('image/png','image/jpeg','image/webp')),
  width integer not null check (width between 1 and 8192), height integer not null check (height between 1 and 8192),
  size_bytes bigint not null check (size_bytes between 1 and 20971520),
  sha256 text not null check (sha256 ~ '^[0-9a-f]{64}$'), storage_key text not null unique,
  created_at timestamptz not null default now(), unique (id,version_id,owner_id),
  foreign key (remake_id,version_id,owner_id) references public.remake_versions(remake_id,version_id,owner_id),
  foreign key (upload_intent_id,owner_id) references public.upload_intents(id,owner_id)
);
create table public.timeline_asset_refs (
  version_id uuid not null, revision integer not null, owner_id uuid not null, asset_id uuid not null,
  primary key (version_id,revision,asset_id),
  foreign key (version_id,revision,owner_id) references public.timelines(version_id,revision,owner_id),
  foreign key (asset_id,version_id,owner_id) references public.timeline_assets(id,version_id,owner_id)
);
```

All three tables are owned by `postgres`, enable RLS and revoke all direct privileges from `public`, `anon`, `authenticated`, `mdf_web` and `mdf_auth`. No client policies grant direct access. Definer ops enforce ownership and M1 test-version isolation. Grant only named worker functions to `service_role`. Install `before update or delete` triggers raising SQLSTATE `23514` on `timelines` and `timeline_asset_refs`; assets are immutable while referenced, with deletion permitted only through retention after proving no references. Append every revision and its complete asset-reference set in one transaction. Validate that JSON asset IDs exactly equal those references, that audio belongs to the same version, and that shot IDs belong to its blueprint. Old Video Studio presets and task 27 rows receive no invented timeline revisions.

`ops.timeline_patch(p_ctx jsonb, p_remake uuid, p_version uuid, p_stage uuid, p_expected_revision integer, p_expected_stage_version integer, p_patch jsonb) returns jsonb` and its TypeScript input both require the two counters. Lock the remake row, then the stage row, then read the latest timeline revision, in that order. Resolve `ops._actor`; verify owner, test mode, stage/run/version membership, and a live lease whose canonical driver equals this actor (token identity, not just the token owner's user ID). Non-holder returns `forbidden_scope`; expired lease or either stale counter returns `conflict`. A holder's successful call renews the lease by 15 minutes. Lease claims/takeovers and stage transitions use the same lock order. A cookie owner can claim an unheld/expired lease explicitly; a patch never silently takes it from an agent.

Accept a patch only during the held R5 authoring wait or an R7 review state (`passed` or `awaiting_approval`) before downstream work starts. Reject a running render or advanced R8/R9. A held R5 waits for the author's edit/approve; without a driver the ordinary mapper can advance. In the same transaction, append the fully validated document, increment `stage_version`, invalidate gates for the previous render, and queue the rerender through the existing M2a/M1 path. Jobs pin `timeline_revision`; a completion for an older revision cannot mark the edited stage passed. Any validation, lease, counter or cap refusal leaves no new revision, jobs, counters or lease renewal. Return `{ revision, stage_version, job }`; `timeline_get` returns `stage_id`, `stage_version` and lease data as well as the document. HTTP, CLI and MCP all carry these fields. Image edits use the same stage/lease checks.

Apply these statements in each table's owning migration; use M2a's trigger function for immutable revisions.

```sql
-- 01_timelines
alter table public.timelines owner to postgres;
alter table public.timelines enable row level security;
revoke all on public.timelines from public, anon, authenticated, mdf_web, mdf_auth, service_role;
create trigger timeline_immutable before update or delete on public.timelines
  for each row execute function ops.reject_immutable_revision();
-- After defining the wrapper with the Global Constraints definer settings:
revoke all on function ops.timeline_patch(jsonb,uuid,uuid,uuid,integer,integer,jsonb)
  from public, anon, authenticated, mdf_web, mdf_auth, service_role;
grant execute on function ops.timeline_patch(jsonb,uuid,uuid,uuid,integer,integer,jsonb) to mdf_web;
-- 02_timeline_images
alter table public.timeline_assets owner to postgres;
alter table public.timeline_asset_refs owner to postgres;
alter table public.timeline_assets enable row level security;
alter table public.timeline_asset_refs enable row level security;
revoke all on public.timeline_assets, public.timeline_asset_refs
  from public, anon, authenticated, mdf_web, mdf_auth, service_role;
create trigger timeline_refs_immutable before update or delete on public.timeline_asset_refs
  for each row execute function ops.reject_immutable_revision();
```

### Paid composition and stage authorization (Task 4)

`01_timelines` adds `compose_timeline` to the SQL job-stage constraint and extends `ops.job_spend_rule(p_job uuid)` with an explicit OpenRouter Sonnet 5.5 composition rule. Seed `provider_operations` for a maximum 4,000 input / 1,000 output tokens, converted to the existing M1 price units through `ops.price`; no missing rule or price may resolve as free. Cap the writer request to these token limits and independently enforce the 0.005 USD R5 budget. If the priced maximum exceeds 0.005, use the deterministic mapper without making the optional writer call, recording that outcome. If a required ledger reservation or extension fails, make zero provider calls and stop with `cost_cap`; do not bypass a refusal by a paid fallback. Choose and persist the writer mode before enqueueing: the SQL spend rule explicitly returns no paid items for the deterministic/agent path, and priced items for the writer path. It recomputes eligibility from trusted price rows, never trusts a caller flag to turn a paid job into a free one. Agent-authored parameters and the deterministic mapper use no paid call. All paid composition shares the M2a run cap across languages.

Modify `packages/shared/src/status.ts`: add `compose_timeline` to both `STATUS_STAGES.producing` and `stageAllowed`'s `producing` list, with `STAGE_STATUS.compose_timeline = 'producing'`. Keep it forbidden for all other statuses. R4b completion atomically sets the version to `producing` before enqueueing R5. The orchestrator, not the generic status decorator, controls remake pause points. Preserve existing non-remake mappings.

## Step 1 - M2b timeline, rendering and exit gates

### Task 1: Define the closed timeline document and blocks

**Files:** Create `packages/shared/src/timeline/blocks.ts`, `packages/shared/src/timeline/schema.ts`, `packages/shared/src/timeline/index.ts`, `packages/shared/src/timeline/timeline.test.ts`; modify `packages/shared/src/index.ts`, `apps/web/next.config.ts`.

**Interfaces:** `TimelineSchema: z.ZodType<Timeline>`, `TimelineBlockSchema: z.ZodType<TimelineBlock>`, `parseTimeline(input: unknown): Timeline`, `validateTimelineAssets(doc: Timeline): void`, `type TimedWord = { text: string; startS: number; endS: number }`. Document fields are exactly 9.2: `schemaVersion: 1`, `fps: 30`, `size`, `durationFrames`, `audio.takeId`, palette, typeScale, `scenes[]`, `assets[]`. Scene has id, start/end frames, sectionId, one `block` with bounded `params`, bounded `effects[]`, `transitionIn`, `transitionOut`. `assets[].ref` is an app bucket key or generated-image store key, never a URL. Blocks are the seven 9.3 names: `visualizer`, `kinetic_lyrics`, `image_motion`, `title_card`, `split`, `color_field`, `video_clip` (premium only). `visualizer.look` uses `viz-looks.ts` IDs, with existing Video Studio looks mapped explicitly.

- [ ] **Step 1: Write failing tests** `rejects a code field`, `rejects an https URL or path traversal in any asset ref`, `rejects unknown block or parameter`, `rejects HTML and CSS strings`, `rejects scene beyond duration, 201 scenes, 51 assets or more than ten minutes`, `accepts each of seven bounded block variants`, `rejects video_clip outside premium`.
- [ ] **Step 2:** `pnpm --filter @mellodifai/shared exec vitest run src/timeline/timeline.test.ts`. Expected: FAIL on the missing module.
- [ ] **Step 3:** Implement strict Zod objects, limits, referential checks, asset-kind checks, font whitelist, text limits, a complete `split` nested schema and no passthrough keys. The schema is imported by ops and renderer; no arbitrary JSX/code evaluation.
- [ ] **Step 4:** Repeat the command. Expected: seven tests PASS. Add every new `.js` alias.
- [ ] **Step 5:** Commit `feat(timeline): define data-only blocks and validation`.

### Task 2: Store immutable revisions and expose get/patch

**Files:** Create `supabase/migrations/20261103020001_timelines.sql`, `supabase/tests/remake_timeline.test.ts`, `apps/web/lib/ops/defs/timeline.ts`, `apps/web/app/api/v1/remakes/[remakeId]/timeline/route.ts`; modify `apps/web/lib/ops/registry.ts`, `apps/web/lib/mcp/server.ts`, `packages/cli/src/index.ts`, `packages/cli/skill/SKILL.md`.

**Interfaces:** `ops.timeline_get(p_ctx jsonb, p_remake uuid, p_version uuid) returns jsonb` to `mdf_web`; `ops.timeline_patch(p_ctx jsonb, p_remake uuid, p_version uuid, p_stage uuid, p_expected_revision integer, p_expected_stage_version integer, p_patch jsonb) returns jsonb` to `mdf_web`; `ops.worker_timeline_append(p_job uuid, p_document jsonb, p_author text) returns jsonb` to `service_role`; `timelineGetDef: OpDef<{ remake_id: string; version_id: string }, { revision: number; document: Timeline; author: string; stage_id: string; stage_version: number; driver: string | null; lease_until: string | null }>` (`read`, no key); `timelinePatchDef: OpDef<{ remake_id: string; version_id: string; stage_id: string; expected_revision: number; expected_stage_version: number; patch: TimelinePatch }, { revision: number; stage_version: number; job: JobRef }>` (`create`, key). `TimelinePatch` is a discriminated union of replace-scene-text and replace-scene-params for one scene ID; it cannot change audio, owner, asset refs, schemaVersion, fps or duration. Patch materializes a full new document, validates it, and appends a row. Only one latest revision per version. Rerender goes through `ops.worker_enqueue` or an M2a stage action with the same reservation/fake stamp.

- [ ] **Step 1: Write failing DB tests** `get sees only actor-owned version`, `worker append starts at revision 1`, `patch creates revision 2 and preserves revision 1`, `two edits from revision 1 yield one conflict`, `unknown scene, code text and URL are rejected`, `test token cannot patch a real version`, `one accepted patch queues one rerender with inherited fake flag`, `current timeline revision with stale stage version returns conflict and writes nothing`, `non-holder token of the same owner receives forbidden_scope`, `expired lease requires explicit reclaim`, `lease takeover racing patch has only one authorized winner`, `timeline and reference update/delete fail with 23514`, `cross-owner asset reference FK is rejected`, `legacy preset remains readable without timeline rows`. Each rejection leaves revision count, jobs, counters and lease unchanged.
- [ ] **Step 2:** `DBTEST supabase/tests/remake_timeline.test.ts`. Expected: FAIL.
- [ ] **Step 3:** Implement the DDL and atomic stage/driver patch transaction above, including immutable revisions and exact grants. Seed the additive composition spend rule in this migration before any R5 job can be enqueued. Because Postgres cannot execute the TypeScript Zod parser, Next validates the assembled document before calling `ops.timeline_patch`, and the SQL function enforces a mirrored closed JSON shape, owner, allowed patch paths, bounds, asset refs and latest revision within one transaction. The worker re-parses before render. Document the mirrored checks in the test cases; do not accept a raw replacement document from a token. Add `timeline_get` and `timeline_patch` to `TOKEN_OPS`, HTTP and MCP through M1's registry.
- [ ] **Step 4:** Migrate e2e (`pnpm ops stack.ts migrate --env e2e`), rerun DBTEST and `DBTEST supabase/tests/ops_acl.test.ts`. Expected: every ownership, revision, stage, driver and ACL assertion PASS.
- [ ] **Step 5:** Commit `feat(timeline): store revisions and patch owned scenes`.

### Task 3: Move kinetic lyrics and render finite blocks

**Files:** Create `packages/visualizer/src/TimelineVideo.tsx`, `packages/visualizer/src/timeline-blocks.tsx`, `packages/visualizer/src/kinetic-lyrics/LyricText.tsx`, `packages/visualizer/src/kinetic-lyrics/WordPop.tsx`, `packages/visualizer/src/kinetic-lyrics/FontGate.tsx`, `packages/visualizer/src/kinetic-lyrics/Kinetic.tsx`, `packages/visualizer/src/kinetic-lyrics/layers/Background.tsx`, `packages/visualizer/src/kinetic-lyrics/layers/BeatLayer.tsx`, `packages/visualizer/src/kinetic-lyrics/layers/CameraRig.tsx`, `packages/visualizer/src/kinetic-lyrics/layers/DebugHud.tsx`, `packages/visualizer/src/kinetic-lyrics/layers/Overlays.tsx`, `packages/visualizer/src/kinetic-lyrics/layers/ReviewHud.tsx`, `packages/visualizer/src/kinetic-lyrics/layers/ShotSlot.tsx`, `packages/visualizer/src/kinetic-lyrics/layers/TransitionOverlay.tsx`, `packages/visualizer/src/timeline.test.tsx`; modify `packages/visualizer/src/Root.tsx`, `packages/visualizer/scripts/render.mjs`, `packages/visualizer/package.json`.

**Interfaces:** `TimelineVideo(props: { document: Timeline; assets: Record<string, string>; lyrics: TimedWord[] }): ReactElement`; `renderTimelineBlock(scene: TimelineScene, props: TimelineRenderProps): ReactElement`; `render.mjs timeline --document <absolute-json-path> --output <absolute-mp4-path> [--range <start>:<end>]`. The script resolves inputs only inside the worker workspace; `assets` are a server-built allowlist, not paths supplied by the timeline. It parses `TimelineSchema` before mounting Remotion. `kinetic_lyrics` reads new-take word timing from R4b and supports the 9.3 styles including `karaoke_fill`.

- [ ] **Step 1: Write failing tests** `each block renders a frame without evaluating text`, `word_pop and karaoke_fill follow R4b timestamps`, `unknown block cannot mount`, `unlisted asset is refused`, `existing Visualizer preset IDs still render`, `engine repo VBP Kinetic remains untouched`.
- [ ] **Step 2:** `pnpm --filter @mellodifai/visualizer exec vitest run src/timeline.test.tsx`. Expected: FAIL.
- [ ] **Step 3:** Move the specified `motion/src` lyric components into the visualizer package with only the imported helpers they need; keep fonts whitelisted and avoid a dependency if a local helper suffices. Render scenes by frame range and transitions; reuse current visualizer look components and logo slots, without hardcoded branding. Add `TimelineVideo` to the existing Remotion root and render script.
- [ ] **Step 4:** Repeat the command and `pnpm --filter @mellodifai/visualizer typecheck`. Expected: six tests PASS and typecheck exits 0. Visually compare a baseline Video Studio preset frame and a timeline visualizer frame.
- [ ] **Step 5:** Commit `feat(video): render timeline blocks and kinetic lyrics`.

### Task 4: Compose R5 from blueprint and the new take

**Files:** Create `apps/worker/src/remake/retime.ts`, `apps/worker/src/stages/compose-timeline.ts`, `apps/worker/test/remake-compose.test.ts`; modify `apps/worker/src/stages/index.ts`, `apps/worker/src/db.ts`, `packages/shared/src/stages.ts`, `packages/shared/src/status.ts`, `packages/shared/src/remake/stage-authorization.test.ts`, `apps/worker/src/orchestrator.ts`; create `supabase/tests/remake_composition_spend.test.ts`.

**Interfaces:** `retimeBlueprint(input: { blueprint: Blueprint; takeSections: TimedSection[]; takeId: string; imageAssets: ImageAsset[] }): Timeline`; `composeTimeline: StageHandler`. For every shot, keep section ID and relative position; map start/end into the chosen take section. Select only v1 blocks. The deterministic mapper writes the complete document and the fast writer may fill bounded block parameters for at most 0.005 USD via M1 `paidCall`. A lease-holding agent edits the revision through `timeline_patch`. Start R5 only after R4b.

- [ ] **Step 1: Write failing tests** `shot offset 0.5 stays halfway through a longer take section`, `scene order and non-overlap survive retiming`, `R5 cannot use source media or source line text`, `writer output changing a block kind or adding URL fails validation`, `app writer stays under 0.005 USD`, `R5 appends revision and queues the next stage once`, `stageAllowed permits compose_timeline only while producing`, `worker runs authorized R5 and never calls handler for an analysing version`, `real composition on fake HTTP reserves before request`, `withRealCaps refuses composition at exhausted run cap without any HTTP request`, `composition extension refusal prevents the next request`, `unpriced composition model is not treated as free`. Database assertions use M1 `withRealCaps`, shared run IDs across languages and fake HTTP; local mapper-only jobs make zero paid requests.
- [ ] **Step 2:** `pnpm --filter @mellodifai/worker exec vitest run test/remake-compose.test.ts`; `DBTEST supabase/tests/remake_timeline.test.ts supabase/tests/remake_composition_spend.test.ts`; `pnpm --filter @mellodifai/shared exec vitest run src/remake/stage-authorization.test.ts`. Expected: new cases FAIL.
- [ ] **Step 3:** Implement the status mappings and paid composition contract above, then the mapper, and use M2a `ops.worker_finish_remake_job` for R5 completion. The writer receives only validated enum and short-string data under 6.8, with fake HTTP in tests. Use the existing M2a `stage_runs` version counter for agent takeover and conflict.
- [ ] **Step 4:** Repeat all three commands. Expected: all composition, stage-authorization and enforced-cap cases PASS.
- [ ] **Step 5:** Commit `feat(remake): compose a retimed timeline`.

### Task 5: Accept safe image assets for a scene

**Files:** Create `supabase/migrations/20261103020002_timeline_images.sql`, `apps/web/lib/ops/image-upload.ts`, `apps/web/lib/ops/image-upload.test.ts`, `apps/worker/src/remake/images.ts`, `apps/worker/test/remake-images.test.ts`, `supabase/tests/remake_images.test.ts`, `apps/web/app/api/v1/remakes/[remakeId]/images/route.ts`; modify `apps/web/lib/ops/defs/timeline.ts`, `apps/web/lib/ops/registry.ts`, `apps/web/lib/mcp/server.ts`, `packages/cli/src/index.ts`, `packages/shared/src/timeline/schema.ts`, `apps/web/package.json`, `pnpm-lock.yaml` (only if an image decoder is not already a direct dependency).

**Interfaces:** `decodeSubmittedImage(bytes: Uint8Array): Promise<{ mime: 'image/png' | 'image/jpeg' | 'image/webp'; width: number; height: number; encoded: Uint8Array; sha256: string }>` in `apps/web/lib/ops/image-upload.ts`; `verifyStoredImage(asset: ImageAsset, root: string): Promise<void>` in `apps/worker/src/remake/images.ts`; `ops.artefact_submit_image(p_ctx jsonb, p_remake uuid, p_version uuid, p_shot text, p_intent uuid, p_expected_stage_version integer) returns jsonb` to `mdf_web`; `artefactSubmitImageDef: OpDef<ImageSubmitInput, { asset_id: string; revision: number }>` (`create`, key). MIME sniffing, decode and re-encode happen on the Next server before the ops call; the M2a `upload_intents` row is the opaque staging reference, never a URL or caller-chosen path. Accept PNG/JPEG/WebP only, 20 MB max, 8192 px max per dimension. Store output in the app storage bucket, strip metadata, record hash/owner/shot in `timeline_assets` and attach it to a new validated timeline revision. M3's generated `images` table remains separate. The M2a `artefact_submit` tool dispatches `kind: 'image'` to this path.

- [ ] **Step 1: Write failing tests** `valid PNG is re-encoded with metadata gone`, `PNG bytes declared JPEG still sniff as PNG`, `21 MB, 8193 px, SVG, URL and polyglot fail`, `another owner's shot is refused`, `a stale stage_version conflicts`, `image belongs to one version and renders through an asset key`.
- [ ] **Step 2:** `pnpm --filter web exec vitest run lib/ops/image-upload.test.ts`; `pnpm --filter @mellodifai/worker exec vitest run test/remake-images.test.ts`; `DBTEST supabase/tests/remake_images.test.ts`. Expected: FAIL.
- [ ] **Step 3:** Decode before storage, allowlist the resulting key in the render workspace, delete rejected staging bytes. Use the M1 upload-intent path when it exists; the browser/CLI uploads bytes to that path, and MCP accepts an upload-intent ID rather than base64 in a 4 MiB tool body. No external image host is used.
- [ ] **Step 4:** Migrate e2e, repeat all three commands and `DBTEST supabase/tests/ops_acl.test.ts`. Expected: six tests PASS and ACL PASS.
- [ ] **Step 5:** Commit `feat(remake): accept sanitized image artefacts`.

### Task 6: Render R7 master, hook, art and QA

**Files:** Create `apps/worker/test/remake-video.test.ts`; modify `apps/worker/src/stages/render.ts`, `apps/worker/src/stages/art.ts`, `apps/worker/src/stages/qa.ts`, `apps/worker/src/stages/index.ts`, `apps/worker/src/orchestrator.ts`, `apps/worker/src/db.ts`, `packages/visualizer/scripts/render.mjs`, `packages/shared/src/stages.ts`.

**Interfaces:** `renderRemakeTimeline(context: StageContext, kind: 'master' | 'hook', timeline: Timeline): Promise<Render>`; `chooseHook(blueprint: Blueprint, takeSections: TimedSection[], meaning: MeaningMap): { startFrame: number; endFrame: number }`; `qaRender(context: StageContext, render: Render): Promise<QaReport>`. R7 owns four jobs: `render_master`, `render_hook`, `art`, `qa`; `qa` stores separate master and hook results. A timeline render re-validates document and asset keys immediately before `render.mjs`. Master is 16:9 1080p, optional 4K request; Short is full-frame 9:16, maximum 3 minutes. `art` outputs SRT per target language from new-take word timing and three thumbnail candidates. The `art` handler does not set `video_review` for remakes; M3 visual jury owns that checkpoint.

- [ ] **Step 1: Write failing tests** `R7 rejects a patched unknown block before renderer call`, `master output is 1920x1080`, `hook output is 1080x1920 and no longer than three minutes`, `hook chooses highest-energy hook/chorus then peak then meaning fallback`, `three thumbnails and target-language SRT are written`, `both renders have QA loudness, peak and video checks`, `R7 completes only after all four jobs succeed`, `legacy VBP and Video Studio render calls are unchanged`.
- [ ] **Step 2:** `pnpm --filter @mellodifai/worker exec vitest run test/remake-video.test.ts`; `pnpm --filter @mellodifai/visualizer exec vitest run src/timeline.test.tsx`. Expected: new cases FAIL.
- [ ] **Step 3:** Route only remake timeline jobs to `packages/visualizer/scripts/render.mjs`; reuse `render.ts` preview/upload, `art.ts` caption/art paths and `qa.ts` thresholds from `packages/gates`. Use M2a GPU lease for renders. Use the chosen take's timing, never source timestamps for kinetic lyrics. Persist outputs under the existing version workspace and app storage.
- [ ] **Step 4:** Repeat both commands. Expected: eight cases PASS. Check a real fake fixture's video dimensions and two representative frames with `ffprobe` and render screenshots.
- [ ] **Step 5:** Commit `feat(remake): render timeline master hook and art with QA`.

### Task 7: Agent patch exit test, visible review and full gates

**Files:** Create `apps/web/e2e/remake-m2b.spec.ts`; modify `apps/web/lib/mcp/server.ts`, `apps/web/lib/ops/defs/timeline.ts`, `apps/web/lib/studio/use-remake.ts`, `apps/web/components/studio/create/remake-card.tsx`, `packages/shared/src/i18n.ts`, `packages/cli/skill/SKILL.md`.

**Interfaces:** `timeline_get` and `timeline_patch` MCP tools use the same `OpDef`s as HTTP and the UI. The Console shows revision, scenes, output links, master/hook QA and stage state. One scene text edit from the agent produces a new revision and queues one rerender. It does not bypass the future visual jury or publish gate.

- [ ] **Step 1: Write failing e2e tests** `fixture completes R5-R7 with fake providers`, `timeline with code URL or unknown block gets validation error`, `lease holder gets both counters, patches title-card text, gets revision 2 and incremented stage_version`, `rerender frame contains patched text`, `stale patch returns conflict`, `master and hook QA results are visible`, `Video Studio saved preset still opens`.
- [ ] **Step 2:** `E2E_PORT=3225 pnpm e2e -- remake-m2b.spec.ts`. Expected: FAIL.
- [ ] **Step 3:** Complete the e2e fixture through M1 `test_mode` MCP and M2a run. Use a local sanitized image only; all paid calls are faked. Check the visible Console at 1440x900 and 1360x600 in a real browser; save screenshots under `E:/mellodifai/reports/m2b-shots/`. Inspect master and hook render frames at both aspect ratios.
- [ ] **Step 4:** Repeat e2e. Expected: seven tests PASS. Then run `pnpm install --frozen-lockfile`, `pnpm lint`, `pnpm typecheck`, `pnpm --filter web exec tsc --noEmit`, `pnpm test`, `pnpm test:db`, `E2E_PORT=3225 pnpm e2e`; each exits 0. Run `DBTEST supabase/tests/ops_acl.test.ts` after the new grants.
- [ ] **Step 5:** Commit `test(remake): prove agent timeline patch and rerender`, push the branch and write the implementation report.

## Self-review: requirement to task

| Design requirement | Task and proof |
| --- | --- |
| R1 review: timeline patch stage version and driver lease | 2, 7; stale-stage, non-holder and takeover-race assertions |
| R2 review: DDL, paid composition and stage authorization | 2, 4-5; ownership, immutable revisions, cap-refusal and worker authorization tests |
| 21.4 M2b fixture R5-R7, rejected unsafe timeline, patch-visible rerender | 1, 4, 6-7; schema and e2e tests |
| 8.3 R5/R7 jobs, stage transitions and R6 skip | 4-6; orchestrator and video tests |
| 8.4 R5 section-relative mapping and bounded writer | 4; retime and cost tests |
| 8.4 R7 1080p master, 9:16 hook, three thumbnails, SRT, both QA | 6-7; ffprobe, worker and e2e tests |
| 9.2 timeline data-only schema, revisions, limits, dual validation | 1-2, 6; schema, DB and render tests |
| 9.3 seven blocks, effects, kinetic-lyric move, engine config | 1, 3; block and visualizer tests |
| 9.4 image submission sniff, limits, re-encode, app storage | 5; image and ACL tests |
| 6.8 prompt injection boundary, 11.5 ledger/fakes, 14.1 GPU | 1-2, 4, 6-7; validation, capped writer and fake e2e |
| M1 agent `timeline_get` and `timeline_patch` over MCP/HTTP/CLI | 2, 7; DB and MCP e2e tests |
| Existing Video Studio preset compatibility | 3, 6-7; visualizer and e2e regression tests |

**Deferred by design:** OD5 image generation, R8 visual jury, publish gate, scheduling and veto window. M3 and M4 add them. The M2b exit test proves a safe, agent-supplied image and the allowed R6 skip path without spending credits.
