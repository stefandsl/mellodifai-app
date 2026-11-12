# Goldfish Review Report - Round 3, milestone M1 only

**Target:** `docs/superpowers/specs/2026-11-01-agentic-studio-design.md`, revision 3 (commit 3d73ed1). Scope: M1 as defined in 21.2 (lines 1828-1876), plus the sections M1 draws on (3, 5, 6.1-6.4, 6.6-6.8, 7, 10.1, 11.5, 14.4, 15.1, 16, 17, 19, 20).
**Prior round:** `docs/egm/agentic-studio/goldfish_review_round2.md`. Section 28.1 of the design (lines 2059-2135) gives the claimed dispositions.
**Ground truth:** `supabase/migrations/*.sql` (24 files), `supabase/config.toml`, `supabase/seed.sql`, `apps/web`, `apps/worker`, `packages/shared`, `.github/workflows/ci.yml`.
**Fixed inputs:** owner decisions (2.1) are final and were not reopened. Later milestones are covered only where M1 depends on them.

## Reviewer Status

| Reviewer | Instance | Focus | Status |
| --- | --- | --- | --- |
| `egm-implementation-readiness` | A | Can M1 be planned with no question back to the owner | completed |
| `egm-codebase-details` | A | Database: grants, policies, functions, roles, ledger DDL | completed |
| `egm-codebase-details` | B | App, worker, auth service, tunnel, file list | completed |
| `egm-design` | A | Trust boundaries and failure modes of the M1 architecture | completed |

The synthesizer spot-checked the load-bearing claims against the repo. All were confirmed:
- 6.3 line 445 contradicts lines 411-413.
- `core.sql:237` still grants INSERT on `projects`.
- `security.sql:31` grants `update (status)` on `jobs`.
- `final_fixes.sql:79-81` has the Supabase default-privileges comment.
- `generate-song.ts:242` spends through `tools/kie.mjs`.
- `score-takes.ts:79-89` calls Groq through `score_takes.py`.
- In 11.5, the 30-minute expiry (line 1207), the refusal rule (lines 1203-1205) and "fake jobs reserve nothing" (line 1218) are as quoted.

## Severity counts (after deduplication)

| Severity | Count |
| --- | --- |
| Blocker | 5 |
| Major | 20 |
| Nit | 9 |

## Answers to the three questions

**(1) Are the round-2 Blockers closed for M1?**

| Id | M1 verdict | Reason |
| --- | --- | --- |
| R2-B1 | **Partly closed** | Several revokes are correct and effective, as codebase-details A confirmed:<br>- the `jobs` INSERT revoke (a table-level revoke also removes the column grant at `pipeline_hardening.sql:26`);<br>- the `versions` revokes;<br>- the blanket function revoke, which covers about 45 existing RPCs, including both `resolve_kie_submission` overloads.<br>Four gaps reopen the bypass: Blocker 1 (`mdf_ops` grant), Blocker 2 (deny-by-default does not work on Supabase), Blocker 4 (the ledger fails in normal queueing) and Major 1 (direct writes that survive). |
| R2-B2 | **Closed in substance, with Major residue** | The shapes are right:<br>- `admin_allowlist(email)` exists;<br>- `create_allowlisted_profile` is one function behind two triggers;<br>- there is no `is_admin()`;<br>- every admin-like path checks `profiles.role`.<br>What remains is Major 8: the owner's allowlist row becomes `customer`, the seed, tests and e2e setup are not updated, and a case-insensitive duplicate email is possible. |
| R2-B3 (M6) | No M1 blocker | Moving the gates into `packages/gates/**` and `config/gates/**` in step 2 is consistent with the fix. The move list leaves out the judge model ids and the Jev selection (Nit 8). |
| R2-B4 (M6) | No M1 blocker, one M1 dependency at risk | The fallback for the Postgres-password spike relies on a firewall rule that the design does not back (Major 20). |
| R2-B5 (M3) | Not an M1 item | M1 builds nothing that this fix depends on. |

**(2) Can a builder write a task-by-task M1 plan from the document and the repo alone?**

**No.** The structure can be planned: the steps, the file list, most of the DDL, the environment variables, the spikes with fallbacks, and the fallbacks for owner actions are all there.

Five decisions are still missing or wrong:
- the `mdf_ops` grant (Blocker 1);
- deny-by-default on Supabase (Blocker 2);
- the cap key (Blocker 3);
- the reservation lifecycle (Blocker 4);
- how token actors read and upload (Blocker 5).

Each one would either ship a hole or need an owner-level design choice. The read and upload shapes are especially costly to guess, because `/api/v1` is additive-only (7.2 line 580).

**(3) New Blockers introduced by revision 3:**
- Blocker 1 comes from the new `mdf_ops` grant text.
- Blocker 5 comes from the new rule "no key in Next, no table privileges for `mdf_ops`".
- Blocker 4 is new in its 30-minute expiry, its refusal rule and its fake-job rule.
- Blockers 2 and 3 are new in their exact wording ("deny-by-default", "0 kie credits" on a row with no provider column).

## Prioritized Findings (Blockers -> Major -> Nits)

### Blocker 1. `mdf_ops` gets EXECUTE on every mutating `public` RPC, so the ops wrappers can be skipped
* **Reviewer Lens:** all four (implementation-readiness A, codebase-details A and B, design A)
* **Affected Scope:** 6.3 lines 445-447 against lines 411-413 and 428-429; 17, row "Compromised Next process"
* **Discrepancy Description**:
  - Line 412 says `mdf_ops` has EXECUTE on `ops.*` "and nothing else". Line 445 says "Grant EXECUTE on every mutating RPC to `mdf_ops`".
  - Any role can run `set_config('request.jwt.claims', '{"sub":"<any user>","role":"authenticated"}', true)`. The `mdf_ops` credential (held by Next and by `apps/auth`) can then call `public.approve_lyrics`, `public.generate_again` or `public.confirm_publication(..., 'public')` directly. That skips:
    - the scope and role checks;
    - idempotency;
    - `reserve_spend`;
    - `audit_log`;
    - the admin-session check.
  - The claim in 17 that a compromised Next "cannot bypass caps and gates" is therefore false. The R2-B1 exit tests (6.3 lines 460-464) do not cover the `mdf_ops` path.
* **Rationale & Recommendation**:
  - The wrappers are `security definer` and owned by the migration owner, so they do not need this grant. Delete it.
  - Grant mutating `public` RPCs to nobody except the wrapper owner, plus `service_role` for the worker functions.
  - Add exit tests: `mdf_ops` cannot execute any `public` function, and `has_function_privilege('mdf_ops', ...)` is false for each one.

### Blocker 2. "Deny by default" for new functions does not work on Supabase as written
* **Reviewer Lens:** codebase-details A (Blocker); implementation-readiness A, codebase-details B and design A (Major)
* **Affected Scope:** 6.3 lines 439-441; 15.1 lines 1556-1558 and 1596
* **Discrepancy Description**:
  - `alter default privileges in schema public revoke execute on functions from public` changes only PUBLIC, and only for the role that runs the migration.
  - Supabase's own default privileges (`FOR ROLE postgres`) grant EXECUTE to `anon` and `authenticated` directly. The repo already records this at `20261031000009_final_fixes.sql:79-81`, and it is why the existing migrations revoke `from public, anon` one function at a time (for example `20261031000013_studio_create.sql:38`). Two leftovers show the gap: `visualizer_asset_ok` and `stems_allowed_status` were revoked only from `public, anon` (`022:177`, `020:159-160`).
  - M1 creates new functions after `ops_scopes` (step 2 order: `notifications` comes after `ops_scopes`). These include `claim_scheduled_task`, the settle and expire functions if they are placed in `public`, and anything in `ops_scopes_t12`. All of them would be callable by `authenticated` and `anon`. A customer could then settle or release reservations, or claim scheduler tasks.
  - New tables get default ALL grants in the same way. So "no grants" on `oauth_store` and `scheduled_tasks` is false unless each table is revoked explicitly, as the repo does at `019:41` and `023:77`.
* **Rationale & Recommendation**:
  - Use `alter default privileges for role postgres in schema public revoke execute on functions from public, anon, authenticated;`, and the same for tables and for schema `ops`.
  - Revoke explicitly on every new table and function.
  - Replace the policy-only database test with one that compares every `public` and `ops` function's ACL against an allowlist.

### Blocker 3. The cap schema cannot express "customers get 0 kie credits"
* **Reviewer Lens:** implementation-readiness A (Blocker), codebase-details A (Major)
* **Affected Scope:** 15.1 lines 1643-1654; 11.5 lines 1183-1185 and 1216-1217; 6.2 lines 396-398; exit test at 6.3 line 464
* **Discrepancy Description**:
  - `spend_caps` and `spend_counters` are keyed `(scope, key, period)` with no provider column. A `user` row's `limit_units` would therefore sum kie credits with OpenRouter tokens, which is meaningless.
  - Either reading breaks something:
    - `limit_units = 0` blocks customers' OpenRouter writer calls, so `song_create` fails.
    - Only the 0.10 USD per day limit applies, so a customer can afford one kie generation (12 credits x 0.005 = 0.06 USD). That breaks the owner rule (Nit 1 of round 2) and fails the exit test "a customer's `approve_lyrics` is refused by the kie cap of 0 credits".
* **Rationale & Recommendation**:
  - Add `provider` (with `''` meaning any provider) to the keys of both tables, for example a row `('user','default:customer','kie','day')` with `limit_units = 0`.
  - Define how `reserve_spend` selects and locks the matching rows, and how a role default applies when a user has no row of its own.

### Blocker 4. The reservation lifecycle fails under normal queueing and contradicts the M1 done-when
* **Reviewer Lens:** design A (Blocker); implementation-readiness A, codebase-details A and B (Major)
* **Affected Scope:** 11.5 lines 1191-1218; 15.1 line 1638; 19 lines 1768-1775; 21.2 lines 1871-1872
* **Discrepancy Description**:
  - **Wall-clock expiry.** `ledger_entries.expires_at` defaults to creation time plus 30 minutes, and the reservation is taken at enqueue.
    - `claim_job` is a single FIFO (`018:30-42`) behind serialised renders (`loop.ts:293-297`), and `retryLater` delays jobs (`local-engine.ts:537`, `replace-section.ts:260`).
    - A paid job that waits behind a render, or while the worker is down, loses its reservation. It is then failed with `no_reservation`.
    - A job running past 30 minutes loses its reservation mid-run, so real spend goes uncounted. `settle_job_spend` then meets an `expired` entry, which is not specified.
  - **Fakes against the refusal rule.** Line 1218 says fake jobs reserve nothing. Lines 1203-1205 say the worker refuses any paid-stage job without a `reserved` entry. The done-when (`lyrics_approve` with a `test_mode` token) therefore fails.
  - **Free resumes.**
    - `resolve_kie_submission(p_charged=true)` resumes a task and enqueues `generate_song` (`009:42-45`).
    - `retry_stage` of `generate_song` with a `kie_task_id` already set is also a resume (`006:120`).
    - Local-engine `generate_song` and `replace_section` cost 0.
    - All of these are on the "paid" list and would be refused.
  - **Pre-existing jobs.** Jobs already queued when the migration runs have no reservation.
  - **Settle.** "Finds the entry by `job_id`" is ambiguous once a job also holds `worker_reserve_spend` entries. The web-side `style_format` and `audio_transcribe` reservations have no job and no settle function, so they always expire and their caps never bind. A worker that dies after a kie submit leaves nothing marked `ambiguous`.
* **Rationale & Recommendation**:
  - Start the expiry clock at claim and extend it with the existing 15 s heartbeat. Expire only entries whose job is terminal or missing.
  - In `expire_reservations`, set `ambiguous` from `versions.kie_submit_state`.
  - Exempt `fake_providers` jobs from the refusal rule.
  - Define per stage, per engine and per resume when a reservation is needed (`kie_task_id` set means none).
  - Grandfather jobs that existed before the migration.
  - Settle by ledger entry id, and add `ops.settle_spend(entry_id, ...)` for the Next-side calls.

### Blocker 5. Token actors have no defined way to read data or upload files
* **Reviewer Lens:** design A (Blocker), implementation-readiness A (Major)
* **Affected Scope:** 6.1 lines 370-371; 6.3 lines 411-413; 7.1; 7.2 lines 601-604; 7.3 rows at lines 614, 632-633 and 642-644
* **Discrepancy Description**:
  - PAT and OAuth callers carry no Supabase JWT, Next holds no key, and `mdf_ops` has no table privileges. Yet 7.3 lists `songs_list`, `song_get`, `costs_get`, `job_status` and `notifications_list` as "reads", with no `ops.*` function and no `*Output` shape. `job_status` is part of the done-when on both transports.
  - `POST /api/v1/uploads` (a signed URL, or the body "through Next"), `upload_create`, `take_save_edit` and file imports all need storage writes. Today these use the user's Supabase session (`lib/studio/edit-save.ts:21-25`, `visualizer/upload.ts:45`), which token actors do not have.
  - Two other parts are undefined:
    - the admin functions (create and revoke a PAT, edit caps, toggle flags including the kill path in 20, read the consent interaction);
    - the mapping from the RPCs' free-text exceptions to the `OpsError` codes.
  - Reimplementing every read as hand-written SQL duplicates `lib/studio/*` and contradicts "one implementation" (7.1). The shapes would be frozen by the additive-only rule.
* **Rationale & Recommendation**: choose and state one mechanism.
  - **Reads:** inside the `mdf_ops` transaction, use `set local role authenticated` plus the claims so the existing RLS reads are reused. This needs an explicit `grant authenticated to mdf_ops`. The alternative is security-definer read functions with explicit owner filters.
  - **Uploads:** Next stages the bytes under `<runtime root>/uploads/`, `ops.upload_intent` records the upload, and the worker (service role) moves the file into storage.
  - List the read, admin and error-mapping functions and their output shapes in 7.3.

### Major 1. Direct writes and grants that survive `ops_scopes`, and storage policies that are misnamed
* **Reviewer Lens:** all four
* **Affected Scope:** 6.3 lines 456-459; 15.1 lines 1556-1558 and 1590
* **Discrepancy Description**:
  - INSERT on `public.projects` is still granted (`core.sql:237`, under the FOR ALL policy at `core.sql:170-179`). Only update and delete were revoked (`final_fixes.sql:2`).
  - `grant update (status) on public.jobs` (`security.sql:31`) and the policy "owners cancel queued jobs" (`security.sql:47-51`) remain.
  - `audio_upload_ok` and `visualizer_asset_ok` are validators, not storage policies. The real write policies are "owners upload studio files" and "owners delete studio files" (`022:40-59`; the delete has no profile check), and "owners upload edited audio" and "owners delete unsaved edited audio" (`020:104-128`).
  - The `agent_tokens` view without `token_hash` bypasses RLS unless it uses `security_invoker = true`. Without it, every user sees every user's token metadata.
* **Rationale & Recommendation**:
  - Revoke both writes and drop the cancel policy, or keep cancel as an `ops` operation.
  - List the storage policies by name.
  - Build the view with `security_invoker = true`.
  - Add all of these to the exit tests.

### Major 2. The list of paying RPCs does not match the repo, and the wrappers cannot learn the new job id
* **Reviewer Lens:** implementation-readiness A, codebase-details A and B
* **Affected Scope:** 6.3 lines 421-422 and 452; 7.2 lines 582-583; 7.3 line 634; 11.5 lines 1192-1205
* **Discrepancy Description**:
  - `import_song` accepts only `suno` and `upload` (`023:353`) and always enqueues `import_audio` (`023:357-368`), which makes no kie call.
  - kie cover and extend are chosen by `create_song`'s source argument (`023:388-390, 415-433`). They are spent in `generate_song` through `source-audio.ts:112-125`, which is not in 21.2.
  - `create_song` inserts one version and one job per language (`024:53-57`). `approve_lyrics` and `generate_again` return void (`006:42-110`). Yet 7.2 returns a single `{job_id, version_id}`, and the wrapper must "link the new job".
* **Rationale & Recommendation**:
  - Correct the list of paying RPCs.
  - Specify how each wrapper finds the job id(s): either change the RPCs to return them, or select by idempotency key.
  - Reserve per job, and give `song_create` an array response.

### Major 3. Ledger function signatures and price units are underspecified
* **Reviewer Lens:** implementation-readiness A
* **Affected Scope:** 11.5 lines 1186-1209; 15.1 line 1622
* **Discrepancy Description**:
  - `reserve_spend` takes a single `p_units`, but OpenRouter is priced in `mtok_in` and `mtok_out`, and `price_book`'s key includes `unit`.
  - Three settle names appear (`worker_reserve_spend`, `settle_spend`, `settle_job_spend`), and only one has a signature.
* **Rationale & Recommendation**: give every signature, add `p_unit` (or an in/out pair), and settle by entry id (see Blocker 4).

### Major 4. "20 parallel reservations never exceed a cap" is not established
* **Reviewer Lens:** codebase-details A
* **Affected Scope:** 11.5 lines 1187-1190; 21.2 line 1875
* **Discrepancy Description**: `FOR UPDATE` on counter rows that do not exist yet locks nothing, so the first reservations of each new window race.
* **Rationale & Recommendation**:
  - Specify `insert ... on conflict do nothing`, then lock in a fixed order that includes period and window.
  - Settle and expire must take the same locks.

### Major 5. Paid calls in engine subprocesses are invisible to `providers/paid.ts`, and Groq spend stays unreserved
* **Reviewer Lens:** codebase-details B (Blocker); implementation-readiness A and design A (Major)
* **Affected Scope:** 11.5 lines 1197-1205; 4 line 250; 21.2 worker row (line 1863)
* **Discrepancy Description**:
  - kie is called through `node tools/kie.mjs` (`generate-song.ts:108, 211, 242, 289, 316`). That script reads its key from the engine repo's `.env` (`suno-remake/tools/kie.mjs:16-24`).
  - Groq is called through `score_takes.py` (`score-takes.ts:75-89`), which uses `whisper_words.py` with a fallback to `~/.config/watch/.env`. Score-takes is called from `import-audio.ts:66`, `local-engine.ts:569` and `timing.ts:44`.
  - The planned static test scans only worker files, and it would flag `kie/client.ts` itself.
  - Groq spend in `import_audio` (reachable by customers with `create`) has no reservation.
  - `score-takes.ts`, `timing.ts`, `local-engine.ts`, `source-audio.ts` and `kie/client.ts` are not in the Modify list.
* **Rationale & Recommendation**:
  - Gate on `engine.run`: any call that carries a paid `secretEnv` must have a ledger entry id.
  - Pass keys only through `secretEnv`, and remove the engine-side key-file fallbacks.
  - Reserve Groq spend in `import_audio`, `timing` and take scoring.
  - Add the files above to the Modify list.

### Major 6. `resolve_upload` is catalogued as a file upload with `create` scope
* **Reviewer Lens:** implementation-readiness A, codebase-details A and B
* **Affected Scope:** 7.3 line 633; 3 lines 131-136; 6.3 line 454
* **Discrepancy Description**:
  - `resolve_upload` is the admin-only recovery for ambiguous YouTube publications (`final_fixes.sql:62-77`, `checkpoints.ts:94-128`). With `p_uploaded=false` it allows a re-upload and frees a quota slot.
  - It comes from migration 9, not from T12.
  - Section 3 also wrongly says only `resolve_kie_submission` checks for admin. `resolve_upload` (`009:66`), `create_song` (`024:27`) and `request_section_edit` (`023:127`) check as well.
* **Rationale & Recommendation**:
  - Make `resolve_upload` cookie-only and admin-only.
  - Give `upload_create` its own storage operation (see Blocker 5).
  - Correct section 3.

### Major 7. `stage_retry` reaches the publish paths that 6.2 keeps cookie-only
* **Reviewer Lens:** implementation-readiness A, codebase-details A
* **Affected Scope:** 7.3 line 627; 6.2; 6.3 lines 448-451
* **Discrepancy Description**:
  - `retry_stage` on a failed `publish` job calls `enqueue_publish` (`006:118-122`).
  - On `set_privacy`, it re-queues the already confirmed privacy, which can be `public` (`006:124`).
  - A token with `create` scope therefore reaches publishing before M4.
* **Rationale & Recommendation**: `ops.retry_stage` refuses the `publish` and `set_privacy` stages for token actors. Add this to the exit tests.

### Major 8. The owner, seed, tests, e2e and CI end up as customers or break
* **Reviewer Lens:** codebase-details A and B, implementation-readiness A, design A
* **Affected Scope:** 6.2 lines 389-394; 15.1 lines 1562-1565; 19 lines 1784-1786; 21.2 lines 1865-1866
* **Discrepancy Description**:
  - The new column defaults the owner's existing `admin_allowlist` row to `customer`. The backfill sets only `profiles`, by "oldest profile", so a recreated owner account comes back as a customer.
  - The subquery on `lower(email)` can return two rows, because the primary key is case-sensitive.
  - `seed.sql:1-3`, the db tests and `apps/web/e2e/global-setup.ts:6` insert allowlist rows with no role.
  - About 240 direct `.rpc(` calls in 10 files under `supabase/tests` break under the blanket revoke. They are not in the Modify list.
  - `ci.yml:45-46,57` runs `supabase start` on 54321, which the new `test:db` guard refuses (`local-env.ts:5,23`).
  - A `signing_keys_path` under the gitignored runtime root makes CI's `supabase start` fail.
  - The `mdf_ops` LOGIN setup on the e2e stack is undefined.
* **Rationale & Recommendation**:
  - Backfill both tables by `MELLODIFAI_OWNER_EMAIL` inside the migration.
  - Add a unique index on `lower(email)`, and seed the role.
  - Add the tests, the e2e setup and `ci.yml` to the Modify list, with the CI allow flag and an env-substituted test signing key.

### Major 9. Deploy, rollback, key rotation and the spike fallback are under-specified
* **Reviewer Lens:** implementation-readiness A, design A
* **Affected Scope:** 21.2 lines 1833-1836 and 1876; 20 lines 1803-1805; 6.4 lines 495-501; 5.3 item 1
* **Discrepancy Description**:
  - `ops/deploy.ts` has no step that applies migrations.
  - An automatic return to a commit before `ops_scopes` leaves the old app calling revoked RPCs, and `/api/health` can still report ok. The done-when does not say which commit `--to` targets.
  - The oidc-provider fallback exposes `api.` in M1 (against AC15), needs JWT verification (against "No JWT library") and has no file list.
  - How the rotated anon and service keys are generated and reach the worker, the web app and e2e (which share `config.toml`) is not stated.
* **Rationale & Recommendation**:
  - Add a migration step to the deploy script.
  - Forbid automatic rollback past `ops_scopes`, and name the rollback target in the done-when.
  - Make the fallback consistent with AC15 and the no-JWT rule, or record the exception as an owner decision.
  - Describe the key rotation flow.

### Major 10. Idempotency as specified cannot return `in_progress`
* **Reviewer Lens:** implementation-readiness A, design A
* **Affected Scope:** 6.3 lines 418-419; 7.2 lines 588-592
* **Discrepancy Description**:
  - The key is taken inside the operation's own transaction, so the `in_flight` row is invisible to a concurrent request, which blocks instead of getting `in_progress`.
  - Web-side calls to OpenRouter and Groq span several transactions.
* **Rationale & Recommendation**: take the key in its own committed transaction first, run the operation, then mark the key `done`.

### Major 11. The T12 dependency is stale
* **Reviewer Lens:** implementation-readiness A, codebase-details A
* **Affected Scope:** 3 lines 115-116; 6.3 lines 452-455; 7.1 lines 566-568; 7.3 lines 621-622 and 630-634; 21.2 lines 1840-1847
* **Discrepancy Description**:
  - T12 is already in the checkout: migrations 23 and 24, and `apps/web/app/actions/songs-from-songs.ts`.
  - `choose_take` and `keep_audio` are T12 functions, but they are listed as unconditional M1 items, and the T12 list leaves out `choose_take`.
* **Rationale & Recommendation**: name the base branch for M1, drop `ops_scopes_t12` and the "after T12 merges" conditions, and fold T12's RPCs into `ops_scopes`.

### Major 12. The sign-in round trip ends on a page the tunnel blocks, and `/auth/confirm` is listed as Create
* **Reviewer Lens:** codebase-details B
* **Affected Scope:** 21.2 line 1860; 5.4 lines 327-330; 6.4 lines 477-482
* **Discrepancy Description**:
  - `app/auth/confirm/route.ts:4-19` already exists. It exchanges a PKCE code and redirects to `/create`, which returns 404 through the edge proxy, so a remote user signing in to reach `/consent` never gets there.
  - `proxy.ts:6-18` rewrites any `?code=`. The login form uses a magic link (`login-form.tsx:37-43`).
  - `app/(auth)/login/page.tsx` (which reads `NEXT_PUBLIC_SUPABASE_URL`) and `lib/redirect-url.ts` are not in the Modify list.
* **Rationale & Recommendation**:
  - Mark the route as Modify and add a validated `next` parameter (back to `/consent?uid=`).
  - Decide whether the `code` rewrite is kept.
  - List the two missing files.

### Major 13. Every server action is reachable through the allowlisted `/login` and `/consent` pages
* **Reviewer Lens:** codebase-details B (Major), design A (Nit)
* **Affected Scope:** 5.2 line 294; AC15
* **Discrepancy Description**:
  - Next dispatches server actions by `Next-Action` id, and a POST to an allowed page can invoke any action. This needs confirming for the pinned Next 16.4.3 (`apps/web/package.json:23`).
  - Any remote cookie session can then run every action, which goes against AC15's statement that M1 exposes only MCP, OAuth and sign-in.
* **Rationale & Recommendation**: the edge proxy rejects `Next-Action` ids outside an allowlist, or `runAction` refuses remote calls for everything except the login and consent actions.

### Major 14. Remote detection fails open, and Next binds all interfaces
* **Reviewer Lens:** codebase-details B
* **Affected Scope:** 5.1 line 269; 6.6 lines 528-529
* **Discrepancy Description**:
  - A request without the edge-proxy header counts as local.
  - `next start` (`apps/web/package.json:9`) binds `0.0.0.0`. A LAN client, or a cloudflared ingress that skips port 3080, gets local-only PATs accepted.
  - Header injection by tunnelled clients is safe, because the edge proxy overwrites the header.
* **Rationale & Recommendation**:
  - Start Next and `apps/auth` with `-H 127.0.0.1`.
  - Also treat a request as remote when `cf-connecting-ip` or `cf-ray` is present.

### Major 15. Next's provider keys conflict with the `mdf-web` ACL
* **Reviewer Lens:** codebase-details B
* **Affected Scope:** 5.1 line 268; 7.3 lines 637-638; 17
* **Discrepancy Description**: `lib/openrouter-key.ts:9-11,35` reads the worker's env files (`WORKER_ENV_FILES`, including `apps/worker/.env.local`). Under the ACL, `style_format` and `audio_transcribe` return "noKey" or "unavailable".
* **Rationale & Recommendation**:
  - Give Next its own OpenRouter and Groq keys in `apps/web/.env.local`.
  - List `lib/openrouter-key.ts` as Modify.
  - Record in 17 that Next holds these keys.

### Major 16. The named MCP transport does not fit an App Router route handler
* **Reviewer Lens:** codebase-details B
* **Affected Scope:** 7.1 lines 569-573; 7.2 lines 599-600
* **Discrepancy Description**:
  - `StreamableHTTPServerTransport` expects Node `req` and `res`, but App Router handlers use the Web `Request` and `Response`.
  - The SDK does not send the 25 s SSE keepalives by itself.
* **Rationale & Recommendation**: name the SDK's web-standard Streamable HTTP transport (or an adapter), verify it against the pinned SDK version, and state who sends the keepalive.

### Major 17. The `test_mode` path is incomplete
* **Reviewer Lens:** design A, codebase-details B, implementation-readiness A
* **Affected Scope:** 6.3 line 416; 6.4 lines 477-489; 11.5 lines 1210-1211 and 1218; 19 lines 1768-1775; 21.2 lines 1871-1872
* **Discrepancy Description**:
  - Nothing can create a `test_mode` OAuth grant, yet the done-when needs claude.ai to run with one.
  - `fake_providers` is taken from the caller's `p_ctx` instead of being derived from `token.test_mode`.
  - `db.enqueue(versionId, stage, key)` (`db.ts:344-359`, called from `loop.ts:322`) has no parent argument and does not copy `fake_providers`, so child jobs run on real providers.
  - The registry is chosen by `WORKER_FAKE` (`main.ts:126,150,160`, `workspace.ts:36`; neither file is listed). `MELLODIFAI_FAKE_PROVIDERS` exists nowhere in the code.
  - Test songs on the real instance can later get a real `generate_again` or a publish.
* **Rationale & Recommendation**:
  - Add an admin-only test option at consent.
  - Derive `fake_providers` in the database and propagate it through a parent-job argument.
  - Name the real env var and list `main.ts` and `workspace.ts`.
  - Mark test versions and refuse paid and publish operations on them.

### Major 18. The OAuth wiring has gaps
* **Reviewer Lens:** implementation-readiness A, codebase-details B, design A
* **Affected Scope:** 6.4 lines 468-501; 6.6 line 530; 6.7 line 534; 5.5 lines 353-354; 15.1 lines 1568-1596
* **Discrepancy Description**:
  - `agent_tokens` has no `grant_id`, so revoking "the grant row and its `oauth_store` tokens", and the joins in `ops.resolve_access_token`, are unreliable. Which scope list wins is not stated.
  - The oidc-provider JWKS, cookie keys and issuer path are not named as secrets or environment variables.
  - `/oauth/*` runs in `apps/auth`, outside the Next rate limiter, with open dynamic client registration. That enables consent phishing (`read` and `create` are checked by default).
  - `/login` has no rate-limit key, and the client-IP header is not named.
* **Rationale & Recommendation**:
  - Add `agent_tokens.grant_id`, and define what `resolve_access_token` joins and returns.
  - Name the key storage.
  - Rate-limit registrations and `/oauth/*` in the edge proxy, allowlist the claude.ai and ChatGPT redirect URIs, and default consent to `read` only.

### Major 19. `apps/auth` shares the `mdf_ops` credential, and session actors are trusted on the caller's word
* **Reviewer Lens:** design A
* **Affected Scope:** 6.3 lines 410 and 424-430; 6.4 line 481; 17 line 1730
* **Discrepancy Description**:
  - The internet-facing auth service, which runs a third-party library, could call `ops.oauth_consent` for any actor.
  - It could also assert `actor_kind = 'session'` for the admin, which unlocks the cookie-only operations (caps, tokens, `confirm_publication`).
  - Editing caps is itself a cookie operation, so the claim in 17 that "caps cannot be bypassed" fails.
* **Rationale & Recommendation**:
  - Use separate roles: `mdf_auth` for the `ops.oauth_*` storage functions only, and `mdf_web` for the rest.
  - Require a `session_id` in `p_ctx` and check it against `auth.sessions`.
  - Refuse `remote = true` on the cookie-only admin operations in M1.
  - Correct 17.

### Major 20. The Postgres-password spike fallback relies on an unbacked firewall claim (R2-B4 dependency)
* **Reviewer Lens:** design A
* **Affected Scope:** 5.2 lines 308-310; 5.3 lines 317-318
* **Discrepancy Description**: Windows Firewall may not filter container-to-`host.docker.internal` traffic on Docker Desktop with WSL2. If it does not, co-resident containers (Postiz today) can reach 54322 with the default `postgres` password.
* **Rationale & Recommendation**:
  - Make the password change mandatory (`--db-url`, or `pg_hba`).
  - Include a probe from a container on the default bridge network in the spike's written result.

### Nits
1. **Time and windows** (15.1, 11.5): the time zone of the `day` window and of `window_start` is not stated, and the `run` window needs a sentinel `window_start`. The token cap lives in two places (`agent_tokens.daily_cap_usd` and `spend_caps` with scope `token`).
2. **Rollbacks swallow records** (11.5, 6.3): a `cap_hit` notification and an `audit_log` row with result `error`, written inside a transaction that aborts, are rolled back with it.
3. **`ops` hygiene** (6.3): the design does not require `set search_path = ''` on `ops.*`, or revoking PUBLIC on schema `ops`.
4. **Foreign keys and indexes** (15.1):
   - `ledger_entries.job_id` and `user_id` have no `on delete`, which breaks the test cleanup (`pipeline-hardening.test.ts:306`) and user deletion.
   - `oauth_store` has no index on `grant_id` or `uid`, and no purge task.
   - The `agent_tokens` view has no name.
   - `resource_class` defaults to `cpu` unless each stage sets it.
5. **Section 3 is stale** (lines 130-136):
   - `versions.lyric_pack` UPDATE was already revoked (`006:8`).
   - `create_allowlisted_profile` is one function behind two triggers.
   - `[auth] enable_signup = false` (`config.toml:177`) is omitted.
6. **Missing catalogue and file entries:**
   - `app/api/suno-link/route.ts` (a storage write as the user) has no cookie-only row in 7.3.
   - `lib/auth.ts` and `worker/src/authorization.ts` are the natural homes for the session and reservation checks, but are not listed.
   - `serverActions.allowedOrigins` behind the edge proxy is not mentioned.
7. **Consent and revocation** (6.2, 6.4, 15.1):
   - "Immediate" revocation (6.4 line 494) conflicts with the 10 s flag cache (15.1 line 1688).
   - The `expires_at` of OAuth grant rows under `check (not remote or expires_at is not null)` is unstated.
   - Customers can hold `spend` on a PAT, but consent never offers it to them; say whether that is intended.
8. **Gate move** (10.1 lines 1013-1015): the M1 move list leaves out the judge model ids and the Jev selection. The file format of `config/gates/` is not stated.
9. **Scope pressure** (design A, question 3): M1 carries about 40 tools, `/api/v1`, SSE, the CLI and a keyring spike. Optional relief:
   - defer `price_book_sync`, `kie_reconcile`, SSE `Last-Event-ID`, 100 MB remote uploads and `@napi-rs/keyring` (use a user-only-ACL file instead);
   - ship the done-when tools and the reads first.

## Verdict

**M1 ready to plan: no.**

Fixing Blockers 1-5, together with Majors 1, 2, 7, 8 and 17 (all of which are short, local text changes), should make M1 plannable task by task with no question back to the owner.
