# M4 Publishing Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Schedule a complete language-version publishing bundle, keep it private through a veto window, publish through the selected routes only at the app-owned slot, and collect the resulting analytics.

**Architecture:** M1's `ops.*` wrappers, token scopes, ledger and scheduler own writes and jobs. M2a provides R9, language versions and notifications; M2b provides master/hook renders and captions; M3 provides render-specific `publish_gate_status`. A Postgres schedule row is the single clock for YouTube and social posts. The project page is the per-language publishing hub. Every external service has a fake adapter in tests.

**Tech Stack:** pnpm monorepo, Next.js 16, Node worker, Supabase Postgres, `yt.py` from the engine repo, Postiz, Blotato, YouTube Analytics API, vitest and Playwright.

**Spec:** `docs/superpowers/specs/2026-11-01-agentic-studio-design.md`, revision 6, especially 5.2, 6.3, 7.3, 8.4 R9, 10.8, 12.1-12.6, 15.2, 20 and 21.6. M2a/M2b plans may still be in flight; preserve their named interfaces when their file names settle.

## Global Constraints

- No em dash characters anywhere. Plain commits without co-author lines. Never print or commit credentials.
- Never spend paid credits or publish to live accounts in tests. Fake YouTube, Postiz, Blotato and Analytics. Test database and e2e run only on Supabase API 45621 with `E2E_PORT=3226` for this stream.
- Keep runtime files under `E:/mellodifai` or `G:/caches`, never C:. Stop under 20 GB free on C:. Do not touch another worktree or delete files you did not create.
- Migrations are additive, tested and use a free `20261103<NN>00XX` number. Proposed M4 prefix is `2026110304`; check all existing migration names before creating either file. Follow M1's `ops` owner, search path, timezone, execute grants and frozen error codes.
- The app owns publish time: upload private, never set YouTube `publishAt`, never schedule at Postiz or Blotato. A veto remains valid until the actual public flip. Missing gate, unhealthy worker, incomplete connection or uncertain route fails closed.
- UI copy is Italian with English through existing i18n. Keep all controls accessible to keyboard and computer-use agents. Never expose media from `/m/*` without a scoped expiring capability.
- Before merging run frozen install, `pnpm lint`, `pnpm typecheck`, `pnpm --filter @mellodifai/web exec tsc --noEmit`, `pnpm test`, `pnpm test:db` and `pnpm e2e`. Inspect the project hub at 1440x900 and 1360x600 on the e2e stack.

All user-facing SQL signatures below start with `p_ctx jsonb` and return `jsonb` containing M1's `OpsResult<T>`: `{ ok: true, data: T }` or `{ ok: false, code: OpsErrorCode, message: string }`. Resolve the actor with `ops._actor`, reset caller settings, validate session/token, owner, scope and test mode, then audit/idempotency per 6.3.4. A raw UUID or array is never the wrapper response. Internal helpers and service-role scheduler calls are explicitly identified and are not token tools.

## Review Focus

1. The worker is stopped over a slot: no route makes the bundle public, and restart follows the six-hour missed-slot rule. Tasks 3 and 7 test this with a fake clock.
2. A veto races the slot worker: row locking permits either the veto or the flip, never both. Task 3 tests all pre-flip states.
3. A Short must use its hook render and its own publication row, with `#Shorts` but no thumbnail API call. Task 6 tests this.
4. A Postiz retry must not expose another owner's media or make a duplicate post. Tasks 8-9 test capability scope and idempotency.
5. A language tab must edit and schedule only its own version. Tasks 4-5 test all 11 language codes and `Aggiungi lingua`.

---

## File Structure

| Area | Responsibility |
| --- | --- |
| `supabase/migrations/20261103040001_publish_routes.sql` through `20261103040008_analytics.sql` | In task order: publish_routes, publish_slots, publish_kit, publish_languages, publish_uploads, publish_tasks, social_attempts, analytics. Each exact filename appears in its task. Confirm numbers are free. |
| `supabase/tests/m4_publish_routes.test.ts`, `m4_analytics.test.ts` | Slot, veto, role, ownership, route and analytics database contracts. |
| `packages/shared/src/publishing/` | Publish-kit validation, slot and route input/output types. |
| `apps/web/lib/ops/defs/`, `apps/web/app/api/v1/`, `packages/cli/` | M1 operation registry, HTTP/MCP and `mellodifai veto` parity. |
| `apps/worker/src/stages/publish.ts`, `apps/worker/src/stages/publish-slots.ts`, `apps/worker/src/publishing/` | Private upload, app clock, social adapters and analytics. |
| `apps/web/app/(app)/projects/[id]/page.tsx`, `apps/web/components/studio/publishing/`, `apps/web/lib/studio/i18n.ts` | Per-language project hub, kit, schedule, veto and route controls. |
| `apps/web/app/m/[token]/route.ts`, `ops/edge-proxy.ts`, `ops/cloudflared/config.template.yml` | Short-lived media fetch and denylisted Postiz tunnel. |

## Step 0 - Track P0 owner gates (12.1, before public enablement)

### Task 1: Prepare YouTube credentials, scopes, private-only test and audit package

**Files:** Modify `$MELLODIFAI_ENGINE_ROOT/publish/yt.py` (`SCOPES`; resolve the configured external repo root, never a neighboring worktree), `docs/HANDOFF.md`; create `docs/publishing/youtube-p0.md`, `ops/test/youtube-p0.test.ts` in this repo. Token path is `<runtime root>/secrets/google/youtube-token.json` through existing `YT_TOKEN_FILE`.

**Interfaces:** `SCOPES = ['youtube.upload', 'youtube.force-ssl', 'youtube.readonly', 'yt-analytics.readonly']` in the exact Google scope URL form used by `yt.py`; `YT_TOKEN_FILE` is the only token location. P0 manual admin-cookie upload remains available while M4 is built. The public enablement record contains `public_api_verified: boolean`, `blotato_disclosure_verified: boolean`, `audit_submitted_at: string | null` and evidence paths, not credentials.

- [ ] **Step 1: Write failing tests:** `youtube-p0.test.ts` cases `all four scopes are configured`, `token path is outside the repo`, `public route flag remains off without verified API or verified Blotato disclosure`.

**Fixture assertions:** Parse `yt.py` SCOPES and assert the four exact `https://www.googleapis.com/auth/` URLs are present. Resolve YT_TOKEN_FILE and assert it is under E:/mellodifai/runtime/secrets/google (or configured runtime root), outside every git root. With both verification booleans false, attempting public enablement returns forbidden_scope and flag stays false. Mock evidence cannot satisfy the separate owner production checklist.

- [ ] **Step 2:** Run `pnpm --filter @mellodifai/ops exec vitest run test/youtube-p0.test.ts`. Expected: FAIL until configuration and evidence handling exist.
- [ ] **Step 3:** Prepare the app description, privacy page and screen-recording checklist. The owner creates the Google project, OAuth client and consent screen, performs the token flow and submits the audit. With owner authorization and credentials, upload a short test through the API, set public, then private; record actual outcome. If lock remains, only a separately verified Blotato route may do public YouTube. Do not fake the outcome or turn on `auto_publish_public` early.
- [ ] **Step 4:** Run the test. Expected: three tests PASS. Owner-only steps may remain pending with the flag off and a precise handoff note.
- [ ] **Step 5:** Commit `docs(m4): prepare YouTube P0 verification and audit` after the engine change is merged under its own repo policy.

## Step 1 - Publish data, kit and schedule

### Task 2: Publish-route migration and operations contract

**Files:** Create `supabase/migrations/20261103040001_publish_routes.sql`, `supabase/tests/m4_publish_routes.test.ts`, `packages/shared/src/publishing/types.ts`, `apps/web/lib/ops/defs/publish-schedule.ts`, `apps/web/lib/ops/defs/publish-veto.ts`, `apps/web/lib/ops/defs/claim-report.ts`, `apps/web/app/api/v1/publish/schedules/route.ts`, `apps/web/app/api/v1/publish/schedules/[id]/route.ts`, `apps/web/app/api/v1/publish/schedules/[id]/veto/route.ts`, `apps/web/app/api/v1/publications/[id]/claims/route.ts`; modify `apps/worker/src/db.ts`, `apps/web/lib/ops/registry.ts`, `apps/web/lib/mcp/server.ts`, `packages/shared/src/ops/inputs.ts`, `packages/cli/src/index.ts`.

**Interfaces:** `publications` gains `platform`, `route: 'youtube_api' | 'postiz' | 'blotato'`, `schedule_id`, `external_post_id`, `external_url`, `thumbnail_style`, `confirmed_via`; render kind remains `renders.kind`, and a thumbnail is never a publication. `publish_schedules(id, owner_id, version_id, master_render_id, hook_render_id, slot_at, veto_window_started_at, veto_deadline_at, state, vetoed_at, flip_started_at, published_at, confirmed_via)` has states `scheduled | vetoed | publishing | published | missed | held_gate_failed | failed`. `capability_links(id, owner_id, publication_id, token_hash, path, expires_at, used_at, revoked_at)` stores only a token hash. Define `ops.publish_schedule(p_ctx jsonb, p_version uuid, p_kit jsonb, p_slot timestamptz default null) returns jsonb` with `OpsResult<{ schedule_id: string }>`, `ops.publish_veto(p_ctx jsonb, p_schedule uuid) returns jsonb` with `OpsResult<{ schedule_id: string; state: 'vetoed' }>`, `ops.publish_schedule_status(p_ctx jsonb, p_schedule uuid) returns jsonb` with `OpsResult<PublishSchedule>`, and `ops.claim_report(p_ctx jsonb, p_publication uuid, p_details text) returns jsonb` with `OpsResult<{ claim_id: string }>`. Register `publish_schedule` (create scope), `publish_veto` (create scope), `claim_report` (create scope) and `publish_schedule_status` (read scope) with M1 token idempotency: `POST /api/v1/publish/schedules`, `POST /api/v1/publish/schedules/{id}/veto`, `POST /api/v1/publications/{id}/claims` require `Idempotency-Key`; `GET /api/v1/publish/schedules/{id}` is a read. MCP tool names match the `ops` names. `mellodifai veto <schedule-id>` calls the same operation; no agent has override.

- [ ] **Step 1: Write failing tests:** `m4_publish_routes.test.ts` cases `each publication belongs to one render and schedule`, `thumbnail cannot be inserted as a publication`, `foreign owner cannot see or veto`, `token write needs proper scope and idempotency`, `schedule refuses missing M3 render reports`, `scheduled privacy argument is rejected`, `claim report pauses owner Autopilot`.

**Fixture assertions:** Seed owner A version VA with master RM and hook RH, owner B's session, and a valid create-scope PAT for A. Schedule success is `{ok:true,data:{schedule_id:S}}`; missing ctx returns unauthorized, missing scope returns forbidden_scope, missing key returns validation. B cannot read/veto S. Remove RH's QA report: schedule returns `ok:false` and no schedule row. Inserting a thumbnail publication fails. claim_report returns an envelope with claim_id and sets A's publishing pause, leaving B untouched.

- [ ] **Step 2:** Run `pnpm test:db -- m4_publish_routes.test.ts`. Expected: FAIL.
- [ ] **Step 3:** Implement additive DDL and `ops` functions with M1 grant discipline. Retire `confirm_publication('scheduled')`, retain its admin-only manual private/public flow until the new slot path is enabled. Extend the `ops` registry and CLI without a second authorization implementation.
- [ ] **Step 4:** Run the command. Expected: seven tests PASS and existing ops ACL tests still PASS.
- [ ] **Step 5:** Commit `feat(m4): define publishing schedules and routes`.

### Task 3: Slot policy, gate check and atomic veto

**Files:** Create `packages/shared/src/publishing/slots.ts`, `packages/shared/src/publishing/slots.test.ts`, `supabase/migrations/20261103040002_publish_slots.sql`, `supabase/tests/m4_slots.test.ts`; modify `apps/worker/src/scheduler.ts`.

**Interfaces:** `nextPublishSlot(now: Date, occupied: Date[], options?: { vetoWindowHours?: number; audience?: { days: number; bestHour: number } }): Date` chooses 18:00 Europe/Rome before 30 days of analytics, then the best audience hour; at most one master per Rome day and 20 hours between masters. `veto_window_started_at` is the successful scheduling transaction time; choose `slot_at >= veto_window_started_at + interval '24 hours'` by default. `veto_deadline_at = slot_at` is the displayed planned deadline, never the start of the window. It is not an authorization cutoff: veto remains possible after `slot_at` while no public flip/social handoff has begun. On a missed or held slot show 'veto ancora aperto' ('veto still open'); rescheduling records the new planned deadline without closing veto access. Worker-only `ops.publish_slots(p_now timestamptz) returns integer` (EXECUTE only to `service_role`, no user route) locks due rows, checks M3 `publish_gate_status` for both renders, veto and worker health, and makes only eligible bundles `publishing`; a worker claim is not the veto cutoff. A final compare-and-set under the same row lock records `flip_started_at` immediately before the irreversible outbound dispatch. Veto and dispatch compete for this one transition. A crash after dispatch intent requires provider reconciliation and keeps the outcome explicit, never another blind dispatch. `ops.publish_veto` locks the same row and can win until the external public flip has actually begun; a losing veto returns `conflict` and the UI offers `Rendi privato`. Every flip records `confirmed_via`.

- [ ] **Step 1: Write failing tests:** `slots.test.ts` cases `Rome DST and midnight use local days`, `one master per day and twenty-hour gap`, `audience hour waits for thirty days`; `m4_slots.test.ts` cases `veto wins before upload`, `veto after private upload leaves video private`, `racing veto and flip cannot both succeed`, `missing gate becomes held_gate_failed and notifies`, `unhealthy worker leaves private`, `after handoff veto conflicts`, `veto succeeds throughout final 24 hours and delayed slot`.

**Fixture assertions:** Schedule at 2026-11-03 18:00 Europe/Rome, created 2026-11-02 18:00. Assert window start is Nov 2 18:00 and displayed deadline Nov 3 18:00. Independently seeded runs veto successfully at Nov 3 00:00, 17:59:59 and delayed Nov 3 20:00 with flip_started_at null, including state publishing after claim but before dispatch. Each cancels pending bundle jobs and records vetoed. Once dispatch wins the lock, veto returns conflict and no vetoed row is written. For DST use Mar 28 and Mar 29 18:00 Rome slots and assert the 20h gap; with 29 analytics days keep 18:00, with 30 days choose supplied best hour 19.

- [ ] **Step 2:** Run `pnpm --filter @mellodifai/shared exec vitest run src/publishing/slots.test.ts` and `pnpm test:db -- m4_slots.test.ts`. Expected: FAIL.
- [ ] **Step 3:** Implement row locks, condition rechecks and M2a `notifications_list`/push notices. Show `programmato, veto aperto` with deadline in app and morning report. Never set provider-owned schedules.
- [ ] **Step 4:** Run both commands. Expected: all ten named tests PASS; a blocked case has no public-flip job.
- [ ] **Step 5:** Commit `feat(m4): schedule bundles with an atomic veto window`.

### Task 4: Publish kit validation and language-specific metadata

**Files:** Create `packages/shared/src/publishing/kit.ts`, `packages/shared/src/publishing/kit.test.ts`, `apps/web/lib/studio/publish-kit.ts`, `apps/web/lib/studio/publish-kit.test.ts`; create `apps/worker/src/stages/publish-kit.ts`, `apps/web/lib/ops/defs/publish-kit-save.ts`, `supabase/migrations/20261103040003_publish_kit.sql`, `supabase/tests/m4_publish_kit.test.ts`; modify `apps/worker/src/stages/index.ts`, `apps/web/app/actions/project.ts`. R9 is introduced here; do not assume M2a already implemented publishing.

**Interfaces:** In `packages/shared/src/publishing/kit.ts`, define `PublishVersionInput = { id: string; language: Lang; title: string; lyrics: string; credits: string; licenceNotes: string }`, `PublishRenderInput = { id: string; captionsRef: string; thumbnailImageId: string }`, `PublishAnalysisInput = { sections: Array<{ startSeconds: number; title: string }> }`, and `KitIssue = { field: string; code: string; message: string }`. `PublishKit = { versionId: string; language: Lang; title: string; description: string; tags: string[]; hashtags: string[]; chapters: Array<{ atSeconds: number; title: string }>; captionsRef: string; thumbnailImageId: string; playlistId: string | null; posts: Record<SocialPlatform, string>; aiDisclosure: true; credits: string; licenceNotes: string }`. `buildPublishKit(version: PublishVersionInput, render: PublishRenderInput, analysis: PublishAnalysisInput): PublishKit` uses the song's own lyrics and R2 sections; `validatePublishKit(kit: PublishKit, source: { title: string; artistNames: string[] }): KitIssue[]` checks per-platform length, no source title or artist names, captions and thumbnail ownership, credits/licence, and explicit AI disclosure. `savePublishKit(versionId: string, kit: PublishKit, expectedRevision: number): Promise<OpsResult<{ revision: number }>>` calls `ops.publish_kit_save(p_ctx jsonb, p_version uuid, p_kit jsonb, p_expected_revision integer) returns jsonb` with the same `OpsResult<{ revision: number }>` envelope. Copilot confirms the kit before schedule; Autopilot's `autopilot_schedule_publish` uses the same validation and no override.

- [ ] **Step 1: Write failing tests:** `kit.test.ts` cases `chapters follow R2 sections`, `source title or artist name fails`, `missing credits licence or AI disclosure fails`, `platform limits and refs are enforced`; `publish-kit.test.ts` cases `one language edit cannot alter another`, `Copilot requires confirmation and Autopilot uses same validator`; `m4_publish_kit.test.ts` case `kit save checks ctx owner and expected revision`.

**Fixture assertions:** Use Italian lyrics and R2 sections at 0s/45s: chapters equal those times and labels. Title length 101 for YouTube, source artist 'Source Artist', missing licence/credits or aiDisclosure=false each yields a validation issue; valid 100-character title passes. Save version IT revision 2 -> 3 while EN remains revision 2. Foreign captions/image refs fail. Copilot with confirmed=false creates no schedule; both confirmed Copilot and Autopilot run the identical validator.

- [ ] **Step 2:** Run `pnpm --filter @mellodifai/shared exec vitest run src/publishing/kit.test.ts` and `pnpm --filter @mellodifai/web exec vitest run lib/studio/publish-kit.test.ts` and `pnpm test:db -- m4_publish_kit.test.ts`. Expected: FAIL.
- [ ] **Step 3:** Implement with the existing `Lang` list, M2a analysis and M3 image records. Persist only editable kit fields and version revision; no generated copy may bypass validation.
- [ ] **Step 4:** Run all three commands from Step 2. Expected: all kit tests PASS.
- [ ] **Step 5:** Commit `feat(m4): validate a publish kit per language version`.

### Task 5: Project page publishing hub and `Aggiungi lingua`

**Files:** Create `apps/web/components/studio/publishing/project-hub.tsx`, `apps/web/components/studio/publishing/project-hub.test.tsx`, `apps/web/e2e/m4-project-hub.spec.ts`; modify `apps/web/app/(app)/projects/[id]/page.tsx`, `apps/web/lib/studio/i18n.ts`, `apps/web/app/actions/project.ts`; create `apps/web/lib/ops/defs/project-language-add.ts`, `supabase/migrations/20261103040004_publish_languages.sql`, `supabase/tests/m4_publish_hub.test.ts`. Read the existing `packages/shared/src/stages.ts` `LANGS` list without changing it.

**Interfaces:** `ProjectPublishingHub(props: { projectId: string; versions: LanguageVersion[] }): React.JSX.Element` shows one tab per language version with stage, master/Short, captions, thumbnail, kit, platform routes, slot/veto deadline, publication links, analytics and a visible `Aggiungi lingua` action. `addProjectLanguage(projectId: string, language: Lang, mode: 'translate' | 'cultural_adaptation'): Promise<OpsResult<{ version_id: string }>>` calls `ops.project_language_add(p_ctx jsonb, p_project uuid, p_language text, p_mode text) returns jsonb` with the same envelope and creates a new version through M2a's R3 pipeline, keeps theme and section meaning while writing original lines, and refuses a duplicate language. Use the exact 11 codes in `LANGS`: `it, ru, ro, ja, en, es, de, zh, pt, ko, fr`. An added version has its own kit, gate, renders and schedule.

- [ ] **Step 1: Write failing tests:** `project-hub.test.tsx` cases `all 11 languages are offered once`, `Aggiungi lingua creates a version and opens its tab`, `kit and route edits stay in active version`, `veto deadline and claim action are labelled in Italian and English`; `m4-project-hub.spec.ts` cases `hub fits and controls remain usable at 1440x900 and 1360x600`, `added language has an independent publishing state`; `m4_publish_hub.test.ts` case `language add checks ctx owner and duplicate language`.

**Fixture assertions:** For project with only it version assert the picker lists ru, ro, ja, en, es, de, zh, pt, ko, fr exactly once and disables existing it; combined tabs+picker cover the 11 LANGS. Add ja creates one version, selects its tab, duplicate ja returns conflict without a second version. Updating ja kit does not change it kit. Fake cultural adaptation still runs R3 originality gates. At 1440x900 and 1360x600 assert no horizontal overflow and Add language, route and veto controls remain reachable by keyboard.

- [ ] **Step 2:** Run `pnpm --filter @mellodifai/web exec vitest run components/studio/publishing/project-hub.test.tsx` and `E2E_PORT=3226 pnpm --filter @mellodifai/web exec playwright test e2e/m4-project-hub.spec.ts` and `pnpm test:db -- m4_publish_hub.test.ts` against the e2e stack. Expected: FAIL.
- [ ] **Step 3:** Implement with M2a's version creation and existing i18n. Test cultural adaptation with fake writing, applying the same lyric originality and jury gates as R3. Save screenshots to the workstream's `shots/` directory.
- [ ] **Step 4:** Run all three commands from Step 2. Expected: all hub tests PASS and two screenshots reviewed for clipping and legibility.
- [ ] **Step 5:** Commit `feat(m4): make projects the per-language publishing hub`.

## Step 2 - Private upload and public slot

### Task 6: Render-addressed YouTube master and Short upload

**Files:** Modify `apps/worker/src/stages/publish.ts`, `apps/worker/src/authorization.ts`, `apps/worker/src/db.ts`, `$MELLODIFAI_ENGINE_ROOT/publish/yt.py`, `apps/web/lib/ops/defs/admin-enqueue-publish.ts`; create `supabase/migrations/20261103040005_publish_uploads.sql`; create `apps/worker/test/publish-renders.test.ts`, `supabase/tests/m4_uploads.test.ts`.

**Interfaces:** `getPublicationById(publicationId: string): Promise<Publication | null>` and `getPublicationForRender(renderId: string): Promise<Publication | null>` replace the ambiguous `getPublicationForVersion` lookup. `publish: StageHandler` loads exactly `payload.render_id`, accepting current approved `master` or `hook`; it uploads as private, with `containsSyntheticMedia: true`, `publishAt: null`. Hook description includes `#Shorts` and skips `thumbnails.set`. Full upload quota is a setting (initially four per Pacific day, about two master/Short bundles); cap retries after Pacific reset. Unknown upload result is not silently retried.

- [ ] **Step 1: Write failing tests:** `publish-renders.test.ts` cases `master and hook create distinct publications`, `hook uploads hook path with Shorts tag and no thumbnail call`, `all YouTube uploads are private with synthetic disclosure`, `four-upload setting retries after Pacific reset`, `publication id authorization matches owner and render`; `m4_uploads.test.ts` case `enqueue_publish accepts approved current hook but rejects stale render`.

**Fixture assertions:** Given RM path master.mp4 and RH path hook.mp4, enqueue each and assert two rows keyed by render and two distinct upload reservations. Hook fake call reads hook.mp4, contains #Shorts, makes zero thumbnail calls; both calls set syntheticMedia=true, privacy=private and publishAt=null. With quota setting 4 and four used uploads, fifth yields retryLater at next Pacific reset. Cross-owner publication id rejects; stale render attempt enqueues zero jobs.

- [ ] **Step 2:** Run `pnpm --filter @mellodifai/worker exec vitest run test/publish-renders.test.ts` and `pnpm test:db -- m4_uploads.test.ts`. Expected: FAIL.
- [ ] **Step 3:** Implement render-addressed reservations and lookups. Remove `scheduled` privacy handling from `setPrivacy` and `confirm_publication`; do not set YouTube `publishAt`.
- [ ] **Step 4:** Run both commands. Expected: six tests PASS on fake YouTube, no upload to a live account.
- [ ] **Step 5:** Commit `feat(m4): upload master and Short by render id`.

### Task 7: App-owned `publish_slots` worker and missed slots

**Files:** Create `apps/worker/src/stages/publish-slots.ts`, `apps/worker/test/publish-slots.test.ts`, `apps/worker/test/m4-publish-flow.test.ts`; modify `apps/worker/src/scheduler.ts`, `apps/worker/src/stages/publish.ts`, `supabase/migrations/20261103040006_publish_tasks.sql` (create; seed the worker task).

**Interfaces:** `runPublishSlots(now: Date, deps: PublishSlotDeps): Promise<{ published: number; held: number; rescheduled: number }>` runs every minute. A due bundle flips only once its planned slot is due and the minimum window duration has elapsed, no veto exists, M3 gate remains empty and worker is healthy; it records `confirmed_via` and hands social posts to the selected route as `post now`. `reconcileMissedSlot(scheduleId: string, now: Date): Promise<'late' | 'rescheduled'>` publishes within six hours, otherwise chooses the next free slot and notifies. A veto stays possible until the actual flip. `auto_publish_public` stays off until P0 route verification and three successful Copilot publishes; flag off leaves every upload private.

- [ ] **Step 1: Write failing tests:** `publish-slots.test.ts` cases `stopped worker through slot leaves private`, `restart within six hours publishes late`, `restart after six hours reschedules and notifies`, `gate failure holds and notifies`, `flag off makes no public call`; `m4-publish-flow.test.ts` case `Copilot fixture schedules, waits, flips master and hook once with social posts`.

**Fixture assertions:** S slot 18:00, window started yesterday 18:00. With worker stopped, advance to 20:00: public calls remain 0. Restart at 20:00 publishes once; separate fixture restart at 00:00:01 (>6h late) reschedules and creates one notification, no public call. Flag=false, stale gate, or unhealthy worker individually produce zero flips. Running the same due tick twice yields one flip per master/hook and one post per selected social destination.

- [ ] **Step 2:** Run `pnpm --filter @mellodifai/worker exec vitest run test/publish-slots.test.ts test/m4-publish-flow.test.ts`. Expected: FAIL.
- [ ] **Step 3:** Implement with a fake clock and transactional claims. Recheck schedule and veto immediately before each external flip. Unknown external outcome goes to reconciliation rather than another call.
- [ ] **Step 4:** Run the command. Expected: six tests PASS, and no fake external post before due time.
- [ ] **Step 5:** Commit `feat(m4): publish due bundles from the app clock`.

## Step 3 - Social routes and media access

### Task 8: Postiz tunnel and scoped media capabilities

**Files:** Create `apps/web/app/m/[token]/route.ts`, `apps/web/app/m/[token]/route.test.ts`, `apps/web/lib/publishing/capability.ts`, `apps/web/lib/publishing/capability.test.ts`; modify `ops/edge-proxy.ts`, `ops/cloudflared/config.template.yml`, `ops/services.ts`, `ops/test/edge-proxy.test.ts`, `docs/publishing/m4-rollout.md` (create).

**Interfaces:** Worker-only `createMediaCapability(publicationId: string, mediaPath: string, expiresAt: Date): Promise<string>` stores only the hash and binds owner, publication, path and expiry. `GET(request: Request, context: { params: Promise<{ token: string }> }): Promise<Response>` in the route module handles `GET /m/<token>` and streams only the bound image/video to Postiz with media type and bounded range support; expired, revoked, reused outside policy or path-swapped tokens return 404. The edge proxy adds `app.mellodifai.com/m/*`. Candidate public Postiz paths on `post.mellodifai.com` are `/`, `/login`, `/auth/*`, `/integrations/*`, `/api/auth/*`, `/api/integrations/*`, `/_next/static/*`, `/_next/image`, `/favicon.ico`; inspect the pinned Postiz route manifest and replace this candidate list with the exact paths needed for login and platform OAuth before enabling. Worker calls to `/api/public/v1/posts`, `/api/public/v1/upload` and `/api/public/v1/integrations` use local Postiz access and are not tunnel routes. All other public paths return 404. `DISABLE_REGISTRATION=true`.

- [ ] **Step 1: Write failing tests:** `capability.test.ts` cases `token hash only is stored`, `expiry revoke owner and path are enforced`; route tests `valid scoped token streams requested media`, `foreign or expired token returns 404`; edge tests `only allowed Postiz and /m paths forward`, `registration is disabled`, `database and worker paths remain denied`.

**Fixture assertions:** Capability for owner A/publication P/path v.mp4 expires at 12:00. At 11:59 a Range bytes=0-99 returns 206 and exactly 100 bytes; at 12:00 returns 404. Revoked token and swapped path return 404; DB contains SHA-256(token), not token. Proxy unknown path /api/admin and registration attempt are denied; allowed OAuth callback forwards only to pinned Postiz upstream, never DB/worker ports. Media remains fetchable for legitimate retries until expiry/revoke, not single-use on first range.

- [ ] **Step 2:** Run `pnpm --filter @mellodifai/web exec vitest run lib/publishing/capability.test.ts app/m/[token]/route.test.ts` and `pnpm --filter @mellodifai/ops exec vitest run test/edge-proxy.test.ts`. Expected: FAIL.
- [ ] **Step 3:** Implement the capability link and inspect the pinned Postiz route manifest before finalizing the exact allowlist. Bind the token to a single publication and media path; revoke it when the fetch window ends. Keep the tunnel and PC up until platform fetch completes. Record the pinned version and final allowlist in `docs/publishing/m4-rollout.md`.
- [ ] **Step 4:** Run both commands. Expected: all seven named tests PASS and a deny-by-default route scan has no extra public paths.
- [ ] **Step 5:** Commit `feat(m4): serve scoped media and expose Postiz routes`.

### Task 9: Selectable direct, Postiz and Blotato routes with fallback

**Files:** Create `apps/worker/src/publishing/routes.ts`, `apps/worker/src/publishing/postiz.ts`, `apps/worker/src/publishing/blotato.ts`, `apps/worker/test/social-routes.test.ts`; modify `apps/web/components/studio/publishing/project-hub.tsx`, `apps/web/components/studio/publishing/project-hub.test.tsx`, `apps/web/lib/studio/i18n.ts`, `config/publishing/routes.json` (create), `supabase/migrations/20261103040007_social_attempts.sql` (create), `supabase/tests/m4_social_attempts.test.ts` (create), and `apps/worker/src/stages/publish-slots.ts`.

**Interfaces:** `postSocial(input: SocialPost, selected: 'direct' | 'postiz' | 'blotato', deps: RouteDeps): Promise<PostResult>` uses the selected route, with Postiz's `post now` as the free default where supported. `PostResult = { state: 'published'; route: 'direct' | 'postiz' | 'blotato'; externalPostId: string; externalUrl: string | null } | { state: 'pending_reconciliation'; attemptId: string } | { state: 'failed'; reason: string }`. Fall back once to Blotato only after a disconnected integration detected before submission or a definitive rejection proves Postiz did not accept the post, and only if the owner enabled Blotato, its key exists and platform/AI disclosure is supported. A timeout, connection loss after sending, or ambiguous 5xx creates `pending_reconciliation` and makes zero Blotato calls. `reconcilePostiz(attemptId: string, deps: RouteDeps): Promise<'accepted' | 'definitely_not_accepted' | 'unknown'>` checks the recorded provider request/post id and supported status lookup; `accepted` stores the external id, `definitely_not_accepted` permits fallback, and `unknown` stays held for owner reconciliation. Absence from an eventually consistent list is not proof of rejection. No cross-provider idempotency guarantee is assumed. Blotato receives uploaded media. UI choices are `Diretto`, `Postiz gratis`, `Blotato veloce` for each platform, with availability and reason shown; English translations use i18n. `resolveBlotatoYouTubeId(url: string | null, uploads: Array<{ id: string; title: string; publishedAt: string }>, title: string, publishedAt: Date): string | null` parses the returned URL or matches uploads by title and time within one hour. YouTube via Blotato is disabled until a real verification proves AI disclosure true. Persist the app post key and each attempt before dispatch, with selected route, request hash, submission time, provider request id, outcome and external id/URL. A unique app post key prevents concurrent local dispatch; it does not deduplicate an already accepted remote post.

- [ ] **Step 1: Write failing tests:** `social-routes.test.ts` cases `selected Postiz sends post now with capability URL`, `disconnected Postiz falls back once to enabled Blotato upload`, `disabled Blotato leaves held private work`, `duplicate post key returns the existing external id`, `YouTube route without synthetic disclosure is refused`, `Blotato URL parse and one-hour playlist match work`, `accepted-but-timed-out Postiz makes zero Blotato calls`, `unknown reconciliation stays held`, `definitive rejection permits one fallback`; UI test in `project-hub.test.tsx` case `three route choices show availability per platform`; `m4_social_attempts.test.ts` case `unique app post key serializes attempts without clearing ambiguous outcome`.

**Fixture assertions:** Fake Postiz accepts key K, stores external id P, then throws a timeout. Assert result pending_reconciliation, Postiz submissions=1, Blotato calls=0; a retry with K still has Blotato calls=0. Reconcile accepted P: result uses P and no second post. Reconcile unknown: held, no fallback. Separate definitive pre-accept rejection or preflight disconnected fixture permits one enabled Blotato upload. Repeated/concurrent K returns the same attempt/external id. YouTube disclosure unsupported produces zero calls. URL id extraction succeeds; playlist match at +59 minutes succeeds, +61 minutes fails.

- [ ] **Step 2:** Run `pnpm --filter @mellodifai/worker exec vitest run test/social-routes.test.ts` and `pnpm --filter @mellodifai/web exec vitest run components/studio/publishing/project-hub.test.tsx` and `pnpm test:db -- m4_social_attempts.test.ts`. Expected: FAIL.
- [ ] **Step 3:** Implement fake-injectable adapters. Verify actual provider payloads against their current API before production enablement; never schedule at a provider. Add `Segnala claim` and `claim_report` to the UI/CLI; a claim pauses owner Autopilot publishing and enters the loop as a severe negative.
- [ ] **Step 4:** Run all three commands from Step 2. Expected: all route, UI and attempt-persistence tests PASS without real posts.
- [ ] **Step 5:** Commit `feat(m4): choose social routes with a controlled fallback`.

## Step 4 - Analytics and exit

### Task 10: Analytics API feasibility and daily snapshots

**Files:** Create `docs/research/m4-youtube-analytics.md`, `supabase/migrations/20261103040008_analytics.sql`, `supabase/tests/m4_analytics.test.ts`, `apps/worker/src/publishing/analytics.ts`, `apps/worker/test/analytics.test.ts`; modify `apps/worker/src/scheduler.ts`, `apps/worker/src/db.ts`, `apps/web/components/studio/publishing/project-hub.tsx`; the new analytics migration also registers the daily task.

**Interfaces:** `ingestAnalyticsDaily(now: Date, deps: AnalyticsDeps): Promise<{ videos: number; snapshots: number }>` runs at 06:00 Europe/Rome, fetches videos younger than 90 days through the P0 Google token, and upserts `analytics_snapshots(video_id, date, views, average_view_duration, retention, impressions, ctr, thumbnail_style)`. First verify in the official YouTube API reference whether per-video impressions and CTR are accessible to this account/query; record URL, date, metric names and outcome. If unavailable, leave columns null and accept manually entered YouTube thumbnail-test results plus views for thumbnail learning. Analytics feed loop hypotheses, never revert decisions.

- [ ] **Step 1: Write failing tests:** `analytics.test.ts` cases `runs once at 06 Rome across DST`, `ignores videos at least 90 days old`, `unavailable impressions and CTR stay null`, `thumbnail style is copied from publication`, `retry upserts without duplicates`; `m4_analytics.test.ts` cases `snapshot is owner-scoped`, `manual thumbnail-test result is distinguishable from API data`.

**Fixture assertions:** At 2026-03-29 04:00Z (06:00 Rome), scheduler executes once; repeat tick does nothing. Video aged 89 days is fetched, 90 days is excluded. Fake API missing CTR/impressions stores null, views=123 and thumbnail_style='bold'; retry same video/date leaves one row. Owner B cannot read A's snapshot. A manual thumbnail-test result has source='manual_youtube_test', never source='api', and cannot become a revert signal.

- [ ] **Step 2:** Run `pnpm --filter @mellodifai/worker exec vitest run test/analytics.test.ts` and `pnpm test:db -- m4_analytics.test.ts`. Expected: FAIL.
- [ ] **Step 3:** Verify the API reference and record the evidence before finalizing the data fetch. Use the token path from P0, fake HTTP in tests, and M1's scheduler. Show missing metrics honestly in the hub.
- [ ] **Step 4:** Run both commands. Expected: seven tests PASS and no live API call.
- [ ] **Step 5:** Commit `feat(m4): ingest daily YouTube analytics`.

### Task 11: Complete bundle exit and rollout checks

**Files:** Create `apps/web/e2e/m4-publishing.spec.ts`, `apps/worker/test/m4-exit.test.ts`; modify `docs/publishing/m4-rollout.md`, `docs/HANDOFF.md` only for verified status and owner actions.

**Interfaces:** `runPublishingExitFixture(input: { now: Date; stopWorker: boolean; vetoAt: Date | null }): Promise<{ scheduleId: string; publicVideoIds: string[]; socialPostIds: string[]; snapshotCount: number }>` in `apps/worker/test/m4-exit.test.ts` uses the fake worker/provider harness. The exit fixture creates a Copilot remake with master, hook, captions, thumbnail and two selected social posts for one language; confirms kit; schedules bundle; uploads YouTube privately; tests veto before upload and after private upload; tests a stopped worker through the slot; resumes within and after six hours; publishes hook beside master; receives analytics snapshot. `auto_publish_public` enablement requires a P0 verified public path and three Copilot publishes. The rollout file records the flag state, Postiz/Blotato route verification and how to stop future flips while keeping private uploads intact.

- [ ] **Step 1: Write failing tests:** `m4-exit.test.ts` cases `veto cancels every member before upload`, `veto after private upload leaves YouTube private and cancels social`, `stopped worker never publishes`, `hook and master each get one public publication`, `analytics arrives`; `m4-publishing.spec.ts` case `hub shows schedule, deadline, veto and per-language outcomes at both required viewports`.

**Fixture assertions:** Seed S with RM, RH, captions, thumbnail and social destinations X/Y. Veto before upload leaves all provider calls 0 and all pending jobs cancelled. Veto after two private uploads leaves their privacy private and social calls 0. Stop worker across 18:00 slot: no flip; late restart follows Task 7 cases. Successful fixture has exactly two public video publications and two social outcomes, then one analytics snapshot per video/date. At both viewports verify active language, deadline and veto result text and save screenshots.

- [ ] **Step 2:** Run `pnpm --filter @mellodifai/worker exec vitest run test/m4-exit.test.ts` and `E2E_PORT=3226 pnpm --filter @mellodifai/web exec playwright test e2e/m4-publishing.spec.ts` on the e2e stack. Expected: FAIL.
- [ ] **Step 3:** Finish any missing connection between prior tasks. Use fakes only. Inspect 1440x900 and 1360x600 screenshots and save them in the workstream's `shots/` directory.
- [ ] **Step 4:** Run both commands, `pnpm test:db -- m4_publish_routes.test.ts m4_slots.test.ts m4_uploads.test.ts m4_analytics.test.ts`, then the full global gates. Expected: all PASS, no paid calls, no live publication. Record any P0 owner gate still open with the public flag off.
- [ ] **Step 5:** Commit `test(m4): verify scheduled bundle and publishing rollout`.

## Requirement to task self-review

| Design requirement | Task and proving test |
| --- | --- |
| 12.1 four scopes, runtime token, private-lock recheck, audit | 1, `youtube-p0` and owner evidence |
| 12.2 bundle, slot policy, 24 h veto, states, notifications | 2-3, `m4_publish_routes`, `slots`, `m4_slots` |
| 12.2 app-owned clock, private upload, six-hour miss, veto until flip | 3, 6-7, 11, `m4_slots`, `publish-slots`, `m4-exit` |
| 12.3 Copilot confirmation, Autopilot scheduling and public flag | 4, 7, `publish-kit`, `publish-slots` |
| 12.4 title, tags, chapters, captions, thumbnail, credits and disclosure | 4, `kit`, `publish-kit` |
| 12.5 render-addressed publications, master/Short, quota, disclosure | 2, 6, `m4_uploads`, `publish-renders` |
| 12.5 route choice, Postiz, Blotato fallback and `/m/*` | 8-9, `capability`, `social-routes` |
| 12.5 `Segnala claim` and Autopilot pause | 2, 9, `m4_publish_routes`, `social-routes` |
| 12.6 daily analytics, 90 days, CTR feasibility, style learning | 10, `analytics`, `m4_analytics` |
| T17 hub, all 11 languages, `Aggiungi lingua`, cultural adaptation | 4-5, `project-hub`, `m4-project-hub` |
| 21.6 exit: veto states, stopped worker, Short, analytics | 11, `m4-exit`, `m4-publishing` |
| R1 veto start versus planned deadline and veto during delay | 3, `m4_slots`; final-24-hour and 20:00 delayed-slot fixtures |
| R1 ambiguous Postiz submission cannot trigger Blotato fallback | 9, `social-routes`, `m4_social_attempts`; accepted timeout and unknown reconciliation assert zero Blotato calls |
| R1 authenticated wrapper envelopes and concrete task contracts | 2, 4-5, `m4_publish_routes`, `m4_publish_kit`, `m4_publish_hub`; every task includes typed signatures and fixture assertions |
