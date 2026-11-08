# Goldfish Review Report - Round 5 (final), milestone M1 only

**Target:** `docs/superpowers/specs/2026-11-01-agentic-studio-design.md`, revision 5 (commit 1a957ce on `build/studio-ui`).
- **Scope:** M1 as defined in 21.2 (lines 2310-2387), plus the sections M1 draws on: 3, 5, 6.1-6.9, 7, 11.5, 14.4, 15.1, 16, 17, 19, 20, 22 and 24.
- **Line numbers:** all refer to revision 5.

**Prior round:** `docs/egm/agentic-studio/goldfish_review_round4_m1.md` (8 Blockers, 35 Majors, 24 Nits). The author's dispositions are in 28.0 (lines 2574-2631); 28.1 (lines 2633-2650) corrects earlier overclaims.

**Ground truth:**
- `supabase/migrations/*.sql` (24 files), `supabase/config.toml`, `supabase/seed.sql`, `supabase/tests`;
- `apps/web`, `apps/worker/src`, `packages/*`;
- `pnpm-lock.yaml`, root `package.json`, `.github/workflows/ci.yml`;
- the engine repo's `tools/`.

`apps/auth/` and `ops/` do not exist yet. Both are listed as Create, which is correct.

**Fixed inputs:** the owner decisions in 2.1 were not reopened.

**Blocker bar (last round):** a finding is a Blocker only if it is one of these:
- a security hole that a plan task cannot contain;
- a contradiction that makes M1 unbuildable as written;
- an unsafe step order.

Anything a builder can settle in the plan without changing what gets built is a Major or a Nit. Every Major below carries a one-line resolution that the plan can adopt as a task.

## Reviewer Status

| Reviewer | Instance | Focus | Status |
| --- | --- | --- | --- |
| `egm-implementation-readiness` | A | Can M1 be planned with no question back to the owner; step order, done-when, file and test lists | completed |
| `egm-codebase-details` | A | Database: migrations, `ops` functions, roles, grants, ledger DDL, Supabase behaviour | completed |
| `egm-codebase-details` | B | App, worker, auth service, tunnel, workspace wiring | completed |
| `egm-design` | A | Trust boundaries, key custody, money safety, failure modes | completed |

**Synthesizer checks.** I checked the load-bearing claim behind the only Blocker against the text:
- 21.2 step 5 (lines 2342-2343) tags `m1-floor` and says "Production may first deploy here".
- 21.2 step 6 (lines 2344-2348) is where these first arrive:
  - `ops/stack.ts`, `ops/rotate-db-passwords.ts`, `ops/check-no-keys.ts`, `ops/set-owner.ts` and `ops/deploy.ts`;
  - `/api/health`;
  - the CI changes.
- 6.3.1 (lines 487-490) creates `mdf_web` and `mdf_auth` as `nologin`. They get `LOGIN PASSWORD` only from `rotate-db-passwords.ts` (prod) or `stack.ts` (e2e, CI).
- 20 deploy steps 4, 5 and 7 (lines 2272-2277) run `check-no-keys`, `set-owner` and the `/api/health` check from the checked-out target tree.
- The done-when (line 2387) requires `ops/deploy.ts --to m1-floor` to succeed.

All confirmed.

**Reviewer disagreement:** on the step order, the implementation-readiness reviewer rated it a Blocker. Codebase-details B (N1) and design (N10) rated the same defect a Major. The synthesizer ruled it a Blocker, because it fits two of the three named categories:
- **Unsafe step order:** a production deploy at step 5 leaves every server action on a role that cannot log in.
- **Contradiction:** "every commit leaves lint, typecheck, tests, `test:db` and e2e green" (line 2321) and the `m1-floor` done-when (line 2387) cannot both hold with this step order.

## Severity counts (after deduplication)

| Severity | Count |
| --- | --- |
| Blocker | 1 |
| Major | 27 |
| Nit | 33 |

## Round-4 closure table

Status values:
- **Closed:** the text and the code agree with the 28.0 claim.
- **Partly closed:** the ruling is applied, but a named defect remains. The remaining defect is listed as a new Major or Nit below.
- **Open:** not fixed.
- **Moved:** moved to M2a, and checked that no M1 path still depends on it.

### Blockers

| Id | Status | Evidence (revision 5) | Remaining |
| --- | --- | --- | --- |
| B1 reservation model | Partly closed | 11.5:1443-1448 keeps one reservation per job, found by job id. 1534-1553 lists call keys, `FREE_KEY_CALLS` and subprocess settle by entry id. 1567-1586 adds the close rule, which never releases settled spend, and limits expiry to orphans. Done-when 2376-2378. Matches `generate-song.ts:108/242/276-287/314`. | The counting gaps in the new text: Majors 5, 6, 7, 8 and 9 |
| B2 legacy `claim.sub` | Closed | 6.3.4:573-577 sets `claim.sub`, `claim.role` and `claims` locally, then asserts `auth.uid() = actor`. Test at 6.3.7:656-658. The repo never redefines `auth.uid()`. | Other caller-settable settings: Major 3 |
| B3 cap defaults, fail open | Closed | Prices, operations and caps are seeded by the `spend_ledger` migration (11.5:1453-1455, 1464-1477; 15.1:2051-2052). `MDF06` fails closed (1488-1492), and a test empties `spend_caps`. | - |
| B4 signing key in checkout | Partly closed | The key now lives only under `<runtime root>/secrets/supabase/`, and `check-no-keys` exists (5.3:360, 364-373). | 5.3:366-367 writes the new JWT secret into the rendered `<runtime root>/stacks/prod` config, which neither the 5.1 ACLs (287-290) nor `check-no-keys` cover: Major 1 |
| B5 OS split, consent-matched `oauth_upsert` | Partly closed | `mdf-auth` account (5.1:282, 289; 22:2452). The `oauth_upsert` rule is written (6.4:732-737). | The match names uid and nonce, which token rows do not carry, and 17:2171 overclaims: Major 12. The OS split is weakened by Majors 1, 2 and 26. |
| B6 sign-in links per environment | Partly closed | Per-environment `SITE_URL` table (5.3:354-362). `{{ .RedirectTo }}` template and per-request redirect (5.4:393-409). | 5.4:395 fixes the local origin to `127.0.0.1:3000`, which contradicts 5.4:407 and the dev port 3001: Major 18 |
| B7 consent bound to the browser | Closed (mechanism) | The `mdf_flow` nonce cookie is required at consent-info and at resume, and is single use (6.4:699-722). 15.1:2001-2008. Tests at 19:2232-2235. | Majors 13 and 15 (cookie path and nonce timing; sign-in in another browser) |
| B8 rotate every login role | Closed in text (spike 2) | 5.3:374-387 lists, rotates and probes every login role. 21.2:2326-2329 and 2384-2385. | Majors 2 and 20 (unauthenticated services; rotation surviving restarts) |

### Majors

| Id | Status | Evidence (revision 5) |
| --- | --- | --- |
| 1 | Closed | 6.3.2:498 uses the global `alter default privileges ... from public` (ordering defect: Nit 1). |
| 2 | Closed | 6.3.3:539-548 covers column privileges, schema USAGE, `storage.objects` policies, `pg_auth_members` (member side) and the definer/`search_path` check. |
| 3 | Closed | 6.3.2:530-533 lists the `service_role` grants from `final_fixes.sql:102` in the allowlist. |
| 4 | Closed | 6.3.2:517-520 names six read RPCs, all present: `019:155`, `019:164` (`uuid[]`), `020:60`, `022:134`, `023:256`, `018:95`. They match the web's direct read calls. |
| 5 | Partly closed (author's call) | 6.3.4:558-566 adds 65-minute recency, the timebox, `getClaims()` and `remote_mcp` checked in the database. There is still no step-up, and Next still asserts `remote`; the residual risk is written in 17:2170. |
| 6 | Closed | 11.5:1483-1486: fallback per `(provider, unit, period)`. |
| 7 | Closed | 11.5:1450-1462 and 1479-1481. Residues: the `MDF05` mapping (Major 11) and the test-price pinning (Nit 14). |
| 8 | Closed | `reservations.charges` holds the exact counter rows and windows (11.5:1506-1507; 15.1:2096). |
| 9 | Partly closed | The right state table per stage, synchronous `mark_ambiguous`, cancel by the close rule (11.5:1571-1582). But the close rule is not tied to the job or the generation: Major 6. |
| 10 | Moved, consistent | 7.4:932-939 and 11.5:1588-1589. The residual of Next holding unmetered keys is not stated in 17 (Nit 33); the rate checks that replace metering have no contract (Major 23). |
| 11 | Closed | 6.6:784-786, 6.4:713-714, 11.5:1490. 6.6 says `MDF03` while 11.5 says `MDF06` for the same refusal (Major 11). |
| 12 | Partly closed | The trigger and the both-direction test rule are in (6.3.4:567-569, 580-583; 15.1:2121). But what the trigger does on worker requeues that carry no context is unstated: Major 21. |
| 13 | Closed | 6.2:458-459, 6.4:711, exit test at 6.3.7:664. |
| 14 | Closed | 6.2:452-454; 7.3:902-904. |
| 15 | Closed | 5.4:414-416 (`ops/add-user.ts` inserts the allowlist row before `auth.admin.createUser`). |
| 16 | Closed | Column grant on `agent_tokens` (15.1:1985-1989); `using (true)` policies (2037-2038, 2060-2061); no grant on `provider_operations` (2068). |
| 17 | Closed (spike 1) | 6.4:730-731; 15.1:1992. |
| 18 | Closed | 6.3.5:610-631 and 7.3:926. Residues: Major 11 and Nit 19. |
| 19 | Closed | 6.3.1:487-489 guards role creation with an existence check. |
| 20 | Closed | 7.3:916-928 matches real columns (`core.sql:51-99`, `005:5-9`, `006:2`, `015:2`, `018:7-9`, `queue.sql:28-37`). |
| 21 | Moved, consistent | 21.2:2313-2314; 15.2:2132; 7.3:898 ("without upload sources"). No M1 path depends on token uploads. |
| 22 | Closed | 7.3:892-913; 5.2:324-326; 7.2:870. |
| 23 | Closed | 6.3.4:570-571, 585-592; 7.2:875-882 (residue: Nit 5). |
| 24 | Closed | 7.1:851-855. Verified: `@modelcontextprotocol/server@2.4.0` (`pnpm-lock.yaml:1047`) exports `WebStandardStreamableHTTPServerTransport` with `sessionIdGenerator`, `enableJsonResponse` and `maxRequestBodySize`. |
| 25 | Partly closed | Issuer, discovery forms, `proxy: true` and no prefix are in (6.4:675-686). But "interaction cookies are scoped to path `/oauth`" (686) does not match how `oidc-provider` scopes `_interaction`: Major 13. |
| 26 | Closed | 11.5:1544-1565. `MELLODIFAI_ENV_ONLY` no longer matches the `secrets.ts:9-10` regex. The flag is set after `childEnvironment` (`engine.ts:137-151`), `KIE_ENV` is refused, and the call-map lines are verified. |
| 27 | Moved, consistent | 7.3:888-890 and 7.4:932-939 (web-side tools are cookie-only in M1). |
| 28 | Closed | 6.3.4:566; 6.4:742, 747-752; 20:2259. |
| 29 | Closed | 5.1:294-299; 21.2:2362 (`-H 127.0.0.1`). |
| 30 | Partly closed | Pairing window, registration time and a risk row are in (6.4:691-697, 708; 17:2172). But any internet client may register, several times, within the 10 minutes: Major 27. |
| 31 | Partly closed | CI ports, flags and the Modify entries are in (19:2240-2253). Three gaps remain: the `test:db` guard that 19:2246-2247 says exists at `package.json:13` does not exist; the cap tests contradict `app.fake_stack = on` (Major 4); there is no OAuth e2e topology (Major 16). |
| 32 | Closed | 21.2:2358-2367 and 7.1:857-859; test imports verified at `rewrite.test.ts:20` and `songs-from-songs.test.ts:13`. File-list gaps: Nit 7. |
| 33 | Partly closed | The step order, floor tag, stopped services, smoke write and restore are written (21.2:2321-2352; 20:2265-2287). But the floor and the first production deploy come before the tooling and logins they need (**Blocker 1**), and the restore wipes the media files (Major 19). |
| 34 | Closed | 14.4:1918-1935; 6.9:827-829. |
| 35 | Closed | 6.6:788-793; 6.4:704-706. |

**Majors tally:** 25 closed, 7 partly closed (5, 9, 12, 25, 30, 31, 33), 3 moved consistently (10, 21, 27), 0 open. Major 5's remainder is an accepted author's call, recorded in 17.

### Nits

- **Applied:** 1-16, 18, 20 and 22-24, spot-checked against the cited lines.
- **Moved to M2a:** 17, 19 and 21, consistently.

### Shrink check

No M1 path depends on an item moved to M2a or W1. What remains are the stale references in Nit 11. Ambiguous submissions still surface through the existing failed-version UI, so moving notifications breaks no M1 flow.

## Prioritized Findings (Blockers -> Major -> Nits)

### Blocker 1. The lockdown, the `m1-floor` tag and the first production deploy come before the logins and deploy tooling they need - Severity: Blocker

* **Reviewer Lens:** `egm-implementation-readiness` (NB1, NM1), `egm-codebase-details` B (N1), `egm-design` (N10)
* **Affected Scope:**
  - 21.2 steps 1-6 (lines 2321-2348) and the done-when (2387);
  - 6.3.1:487-490;
  - 20:2265-2283;
  - 19:2228-2229 and 2241-2253;
  - `ci.yml:44-57`.
* **Discrepancy Description:**
  - **Roles cannot log in until step 6.** `mdf_web` and `mdf_auth` are created `nologin` in step 1. Only step-6 scripts give them a password: `ops/rotate-db-passwords.ts` (prod) and `ops/stack.ts` (e2e, CI). The CI env lines `MDF_WEB_DATABASE_URL`, `TEST_DB_URL` and `TEST_MDF_WEB_URL` also arrive in step 6, as does `app.fake_stack`.
  - **Steps 3 and 4 cannot be green.** From step 3, every server action goes through `mdf_web`. So steps 3 and 4 cannot keep e2e and `test:db` green, against line 2321.
  - **Step 5 breaks production.** Step 5 applies the lockdown, tags `m1-floor` and says "Production may first deploy here". A production deploy at that commit revokes the direct grants and leaves every action on a role that cannot log in, so all writes fail.
  - **The floor cannot be deployed.** `ops/deploy.ts` checks out the target and then runs `check-no-keys`, the `--workdir` migration, `set-owner`, the `apps/auth` build and the `/api/health` `ops` check from that tree (20:2271-2277). None of these exist at the `m1-floor` commit. So the done-when "`ops/deploy.ts --to m1-floor` succeeds" cannot pass.
  - **Every later rollback is broken too.** A rollback to the floor lands on a commit that cannot complete a deploy. Because migrations will already have been applied, the deploy then leaves production stopped (20:2278-2280).
* **Rationale & Recommendation:** this is a step-order fix only, and it does not change what gets built.
  1. In 21.2, move these into step 1, or into a new step between 2 and 3:
     - the e2e/CI half of `ops/stack.ts` (role passwords, `app.fake_stack`, printed env lines) with the `ci.yml` and Playwright env changes and the `seed.sql` admin row;
     - `rotate-db-passwords.ts`, `check-no-keys.ts`, `set-owner.ts` and `deploy.ts`;
     - the `ops` field of `/api/health`.
  2. Keep `m1-floor` on the lockdown commit, which then contains that tooling.
  3. Say that production stays on its pre-M1 commit until that commit exists.
  4. Run `deploy.ts` from a pinned copy of the current `ops` package, not from the tree it is checking out, and have it skip the `apps/auth` build when the target lacks `apps/auth`.

### Major 1. Runtime-root and checkout ACLs leave key material readable and owner-run code writable (B4/B5 residue) - Severity: Major

* **Reviewer Lens:** `egm-codebase-details` B (N3), `egm-design` (N1), `egm-implementation-readiness` (NM11)
* **Affected Scope:** 5.1:275-293; 5.3:345-373; 20:2268-2270; code `comfy/config.ts:19-22`, `engine.ts:153-154`.
* **Discrepancy Description:** the 5.1 ACLs cover only the two env files and `secrets/`.
  - **Key material outside `secrets/`.** Three things on the runtime root are not covered:
    - the rendered `<runtime root>/stacks/prod/supabase/config.toml`, which holds the new JWT secret (enough to forge an HS256 `service_role` JWT for 54321);
    - the re-templated service passwords;
    - `<runtime root>/backups/*.sql`, which holds `auth.refresh_tokens` and `agent_tokens` hashes.
  - **The volume default is open.** On a secondary NTFS volume (default `E:/mellodifai`), Authenticated Users usually get Modify on new folders. Under that default, `mdf-web` and `mdf-auth` can:
    - read every file listed above;
    - write `ComfyUI_windows_portable`, `tmp` and the worktrees, which the owner-run worker executes from. That is code execution as the owner.
  - **The checkout is closed by default, and opening it carelessly is worse.** The checkout under `C:\Users\Asus` is owner-only, so the services need explicit grants. A broad Modify grant would let `mdf-web` edit worker or `ops` code.
  - **Other gaps:**
    - pnpm hard links carry the store's ACL;
    - `next start` must write `.next/cache`;
    - `cloudflared` runs as a service, but its secrets folder is ACL'd owner only.
* **Rationale & Recommendation:**
  - **Plan resolution:**
    - `ops/services.ts install` removes inheritance on `<runtime root>` (owner and SYSTEM only).
    - It grants both service accounts read and execute on a dedicated deploy checkout and the Node install, with write only on `apps/web/.next/cache`, and grants the `cloudflared` service account its own folder.
    - The prod config reads `jwt_secret` through `env()` from `secrets/supabase`.
    - `check-no-keys` also scans `stacks/`.
    - An `icacls` probe, run as each account, fails the install if either account can read a secret or write any path the worker executes from.

### Major 2. The prod stack runs Supabase services that need no authentication - Severity: Major

* **Reviewer Lens:** `egm-design` (N7)
* **Affected Scope:** 5.2:337-341; 5.3:354-387; `config.toml:95-98` (Studio, 54323), `107-109` (mail catcher, 54324), `390-392` (analytics, 54327).
* **Discrepancy Description:**
  - **Studio.** The CLI's Studio has no login and runs arbitrary SQL as a superuser through pg-meta. `mdf-web`, `mdf-auth` and every container can reach it. That bypasses the role split, AC14 and the password rotation, and the probe checks only logins on 54322.
  - **Mail catcher.** Until SMTP is set up (the fallback in 22 is "sign-in on the PC only"), the admin's sign-in links land in the mail catcher, which any local process can read.
* **Rationale & Recommendation:**
  - **Plan resolution:**
    - The prod render sets `[studio]`, `[inbucket]` and `[analytics]` to `enabled = false`.
    - An owner-run `ops` script prints a local sign-in link as the no-SMTP fallback.
    - The container probe also asserts that 54323, 54324 and 54327 refuse connections from a container and from `mdf-web`.

### Major 3. Definer code trusts session settings that `mdf_web` can set itself - Severity: Major

* **Reviewer Lens:** `egm-codebase-details` A (N4), `egm-design` (N4), `egm-codebase-details` B (N8, part)
* **Affected Scope:** 5.3:362; 6.9:835-836; 6.3.4:557-563, 578-584; 7.3:916-918.
* **Discrepancy Description:** any role can `SET` a custom setting and its own `TimeZone` before calling an `ops` function.
  - **`app.fake_stack`:** with it on, `reserve_job` skips every reservation and cap check. Only the worker's on-demand reservation catches this later. `ALTER DATABASE` also does not reach PostgREST's pooled connections.
  - **`mdf.job_ids` and `mdf.job_ctx`:** they can be preset and are not reset by the wrapper, so `reserve_job` and the trigger can act on another user's job ids.
  - **Session recency:** `auth.sessions.refreshed_at` is likely `timestamp` without time zone (confirm in spike 2), so the 65-minute recency check depends on the caller's `TimeZone`. Under `Etc/GMT-14`, a session about 15 hours old passes.
  - **Read functions:** they are not said to set the claims, so any helper they call that uses `auth.uid()` reads a preset `claim.sub`.
* **Rationale & Recommendation:**
  - **Plan resolution:**
    - Every `ops` function resets `mdf.*` and the claim settings locally on entry, and carries `set timezone = 'UTC'` (or compares in UTC explicitly).
    - Read functions filter only by the resolved actor id.
    - `fake_stack` is read from a one-row table writable only by `postgres`.
    - The claim-injection test covers each read function.

### Major 4. The ledger and cap tests cannot pass on the CI stack or under `pnpm test` - Severity: Major

* **Reviewer Lens:** `egm-codebase-details` A (N5), `egm-codebase-details` B (N8), `egm-implementation-readiness` (NM2)
* **Affected Scope:** 5.3:362; 6.9:835-836; 6.3.7:662-663; 11.5:1599-1607; 19:2241-2249; 21.2:2365, 2376-2378; code `ci.yml:27-30`, `apps/worker/package.json:8`, `utils.ts:6`.
* **Discrepancy Description:**
  - **The cap tests skip themselves.** CI runs with `app.fake_stack = on`, so `reserve_job` returns null before any cap check. Four tests therefore create no reservation and cannot pass: the empty-caps test, the customer `cap_exceeded` test, the 20-parallel test and the missing-price test.
  - **The ledger integration test runs in the wrong job.** `ledger-integration.test.ts` is picked up by the worker's `vitest run` in the stack-less `checks` job (Ubuntu).
  - **It also depends on one machine.** It needs the engine repo, and `ENGINE_ROOT` is hard-coded to `C:\Users\Asus\Documents\suno-remake` (`utils.ts:6`).
  - **"Off for that test" is undefined.** The text says fake mode is turned off for that test, but on a shared stack that is not defined.
* **Rationale & Recommendation:**
  - **Plan resolution:**
    - The database ledger tests switch the table-held fake flag (Major 3) off inside their own transaction.
    - The integration test moves to its own vitest config and script (`test:ledger`), run in the `db` job or marked a local Windows gate in the done-when.
    - `ENGINE_ROOT` becomes overridable from env.
    - The engine-repo change lands first, and its commit is recorded.

### Major 5. `song_generate_again` reserves no kie, so the kie caps are skipped - Severity: Major

* **Reviewer Lens:** `egm-codebase-details` A (N1)
* **Affected Scope:** 11.5:1529; 7.3:901; code `011_pending_task_guard.sql:6,13`, `generate-song.ts:160-187`.
* **Discrepancy Description:**
  - **Stale fields count as a resume.** `generate_again` leaves the old generation's `kie_task_id` and `kie_submit_state` in place; the worker clears them only when the new generation starts. So the rule "`kie_task_id` set means resume, Groq only" makes `reserve_job` reserve Groq only.
  - **The kie submit escapes the caps.** It then settles as unchecked excess, bypassing both the global 120 credits/day row and the customer kie=0 row.
  - **It is reachable from day one.** Customers created by `set-owner.ts` keep songs that carry old task ids.
  - **`retry_stage` too.** It has the same predicate problem.
* **Rationale & Recommendation:**
  - **Plan resolution:**
    - Treat a job as a resume only when `kie_task_id is not null and kie_generation = generation_count`; otherwise reserve kie.
    - Add an exit test: a customer's generate-again on a version that has an old task id returns `cap_exceeded`.

### Major 6. Close-rule steps 2-3 charge kie that the closing job never submitted - Severity: Major

* **Reviewer Lens:** `egm-codebase-details` A (N2), `egm-implementation-readiness` (NM5), `egm-design` (N3)
* **Affected Scope:** 11.5:1529, 1567-1578; code `web_flow.sql:124`, `final_fixes.sql:44-45`.
* **Discrepancy Description:** steps 2-3 read the version's submit state without checking which job or generation it belongs to.
  - **Groq-only jobs get a kie entry.** A `retry_stage` job, or the resume job of `resolve_kie_submission`, sees `submitted` with a task id and writes a second kie submit entry at the estimate. `costs_get` and the counters then double-count kie, and the integration test's resume case fails.
  - **Cancelled jobs get a kie entry.** A cancelled, queued generate-again job is charged for the previous generation's submission.
* **Rationale & Recommendation:**
  - **Plan resolution:**
    - The reservation stores whether it reserved the kie submit, plus the generation or edit id.
    - Steps 2-3 apply only to such a reservation, and only while `kie_generation` (or the edit) still matches.

### Major 7. Call keys have no attempt number, so a re-run's spend goes uncounted - Severity: Major

* **Reviewer Lens:** `egm-implementation-readiness` (NM4), `egm-design` (N2)
* **Affected Scope:** 11.5:1510-1517, 1536-1539.
* **Discrepancy Description:**
  - **Re-runs reuse the first run's entries.** `openrouter:<role>:<round>:<n>` and `groq:<take id>` repeat on requeue, `retryLater` and crash restart. `spend_entry_open` returns the already-settled entry, and the second settle is a no-op. So repeated provider calls are recorded once.
  - **A crash loop spends outside the caps.** It spends without bound under a single estimate.
  - **The test cannot see it.** The integration test compares counters with settled entries, not with the calls the fakes received.
* **Rationale & Recommendation:**
  - **Plan resolution:**
    - Non-idempotent call keys include `jobs.attempts` (already incremented by `claim_job`, `library_reactions_trash.sql:39`).
    - Each attempt after the first calls `extend_reservation` for the stage estimate.
    - The integration test asserts that entries equal the calls the fake servers observed.

### Major 8. Spend beyond the estimate is unchecked when opened and clamped when settled - Severity: Major

* **Reviewer Lens:** `egm-codebase-details` A (N3), `egm-design` (N14)
* **Affected Scope:** 11.5:1508-1517.
* **Discrepancy Description:**
  - **No bound when opened.** `spend_entry_open` has no bound. A call path outside the estimate (for example extra jury rounds, or `timing.ts:44` if it is paid) is settled as excess with no refusal. `extend_reservation` exists, but nothing forces its use.
  - **Clamped when settled.** `settle_spend` caps recorded actuals at 3 times the estimate. Since `settle_spend` is `service_role` only, this clamp guards against nothing. It only hides honest overspend (stale prices, long outputs) and makes the counters undercount real money.
* **Rationale & Recommendation:**
  - **Plan resolution:**
    - `spend_entry_open` refuses when the provider's open plus settled estimates would exceed what the reservation charged, unless `extend_reservation` succeeds first.
    - `settle_spend` records the actual amount, rejects only negative amounts, and flags entries above 3 times the estimate in `costs_get`.

### Major 9. Nothing closes the reservation when a job finishes normally - Severity: Major

* **Reviewer Lens:** `egm-implementation-readiness` (NM3)
* **Affected Scope:** 11.5:1519, 1567-1568, 1584-1586; code `db.ts:340`.
* **Discrepancy Description:**
  - **No caller can close it.** `close_reservation` is "internal", so the worker has no grant to call it. The worker finishes jobs through direct table updates.
  - **Expiry is for orphans only.** The 5-minute expiry task is described as handling orphans only.
  - **The effect.** Unless the plan picks a mechanism, counters stay charged for up to 5 minutes after every job, or indefinitely if "orphan" is read narrowly.
* **Rationale & Recommendation:**
  - **Plan resolution:**
    - Add an `after update of status` trigger on `jobs` that calls `ops.close_reservation` when the status becomes `done`, `failed` or `cancelled`.
    - Keep the expiry task for crashes and deleted jobs.

### Major 10. The outcome of a refused `extend_reservation` is undefined - Severity: Major

* **Reviewer Lens:** `egm-implementation-readiness` (NM13)
* **Affected Scope:** 11.5:1508-1509.
* **Discrepancy Description:** nothing says what `draft_lyrics` does when a cap refuses an extra jury round.
* **Rationale & Recommendation:**
  - **Plan resolution:** keep the best draft so far, mark the jury result incomplete, and finish the job (do not fail it). Write this in 11.5.

### Major 11. The `MDF` SQLSTATE codes have no public mapping, and two sections disagree - Severity: Major

* **Reviewer Lens:** `egm-implementation-readiness` (NM6), `egm-codebase-details` A (N6)
* **Affected Scope:** 6.3.5:594-631; uses at 6.3.4:577, 6.4:735, 6.6:786, 11.5:1451, 1488.
* **Discrepancy Description:**
  - **No mapping.** Nothing maps `MDF01`-`MDF12` to the frozen v1 codes.
  - **`MDF03` is overloaded.** It covers three unrelated failures: claim mismatch, `oauth_upsert` refusal, and a token without a cap row.
  - **The sections disagree.** For that last case, 6.6 says `MDF03` and 11.5 says `MDF06`.
  - **`MDF05` has no public code.** `price_missing` is not one of the frozen codes.
  - **Rule order is wrong.** Message rules 1-6 run before the SQLSTATE rule, so an `MDF` message ending in "required" would map to `conflict`.
* **Rationale & Recommendation:**
  - **Plan resolution:** add an `MDF` table to 6.3.5 (number, condition, public code, `details.reason`):
    - `MDF02` and `MDF06` map to `cap_exceeded`;
    - `MDF03` maps to `unauthorized`;
    - `MDF05` maps to `internal` with reason `price_missing`.

    Check the SQLSTATE before the message rules, and make 6.6 use `MDF06`.

### Major 12. `oauth_upsert`'s consent match names fields that token rows do not carry, and 17 overclaims (B5 residue) - Severity: Major

* **Reviewer Lens:** `egm-codebase-details` A (N7), `egm-codebase-details` B (N7), `egm-design` (N6), `egm-implementation-readiness` (Nit 7)
* **Affected Scope:** 6.4:724-737; 17:2171.
* **Discrepancy Description:**
  - **The literal check refuses every token.** `AuthorizationCode`, `AccessToken` and `RefreshToken` payloads carry `grantId` and `sessionUid`, not the interaction uid. The token endpoint and refresh run server to server, with no `mdf_flow` cookie. Read literally, the uid/nonce check refuses every token, and refresh breaks after 1 h.
  - **A loose check adds nothing.** If `apps/auth` supplies the nonce itself, the check adds no protection.
  - **17 overclaims.** 17:2171 says a compromised `apps/auth` "cannot act for users". It can mint tokens for every live grant.
* **Rationale & Recommendation:**
  - **Plan resolution:**
    - For codes and tokens, define the match as the join from `grant_id` to `agent_tokens.grant_id` (bound once) to `oauth_consents.token_id` with `used_at` set, plus same client, scopes a subset, grant live and lifetime limits.
    - Require uid and nonce only on `Interaction` rows.
    - Rewrite 17:2171 to say that a compromised `apps/auth` can mint tokens for every live grant, up to that grant's scopes and its token cap.

### Major 13. The interaction cookie path and the nonce storage timing are stated as fact but are likely wrong (M25 and B7 residue) - Severity: Major

* **Reviewer Lens:** `egm-codebase-details` B (N6)
* **Affected Scope:** 6.4:684-686, 699-701, 715; 21.2:2324 (spike 1).
* **Discrepancy Description:**
  - **The cookie path.** `oidc-provider` scopes its `_interaction` cookie to the path of `interactions.url`, here `/consent`, so the resume at `/oauth/interaction/:uid/resume` would see no cookie.
  - **The nonce timing.** The library saves the `Interaction` through the adapter before it computes the URL, so `oauth_upsert(..., flow_nonce_hash)` has no nonce at that point.
* **Rationale & Recommendation:**
  - **Plan resolution:**
    - `interactions.url` returns `/oauth/interaction/<uid>`, served by `apps/auth`.
    - That handler sets `mdf_flow`, stores the hash through a new `ops.oauth_flow_nonce_set(uid, hash)` (added to `mdf_auth`'s list), and redirects to `/consent?uid=`.
    - Spike 1 confirms the cookie then reaches the resume route.

### Major 14. The one-grant unique index blocks reconnecting the same client - Severity: Major

* **Reviewer Lens:** `egm-implementation-readiness` (NM7), `egm-codebase-details` A (N8), `egm-design` (N11)
* **Affected Scope:** 15.1:1983-1984; 6.4:711-714; 14.4:1933.
* **Discrepancy Description:**
  - **What the index blocks.** `agent_tokens_one_grant` on `(owner_id, oauth_client_id) where kind='oauth' and revoked_at is null` ignores expiry. Two kinds of row therefore block a new consent for the same client, and the unique violation surfaces as `internal`:
    - a grant past its 90-day `expires_at` that was never revoked;
    - an abandoned consent's token row (null `grant_id`).
  - **The purge leaves the blocker.** `purge_oauth` deletes the abandoned consent row but leaves its token row live.
* **Rationale & Recommendation:**
  - **Plan resolution:**
    - `ops.oauth_consent` revokes any live or unbound OAuth row for the same owner and client, and deletes its `oauth_store` rows, in the same transaction.
    - `purge_oauth` revokes the token rows of unbound consents.

### Major 15. Remote consent fails when the sign-in link opens in another browser - Severity: Major

* **Reviewer Lens:** `egm-design` (N12), `egm-implementation-readiness` (Nit 17), `egm-codebase-details` B (Nit 11)
* **Affected Scope:** 5.4:393-402; 6.4:699-722.
* **Discrepancy Description:** a magic link opened in a phone mail app or an in-app browser lands in a cookie store without `mdf_flow` or the interaction cookie. The consent page then refuses, even when the owner is the one consenting.
* **Rationale & Recommendation:**
  - **Plan resolution:**
    - The email template also carries `{{ .Token }}`, and `/login` accepts the 6-digit code (`verifyOtp`, type `email`), so the owner signs in within the flow's browser.
    - The README states the limitation.

### Major 16. The OAuth e2e topology and the per-environment issuer are unspecified - Severity: Major

* **Reviewer Lens:** `egm-implementation-readiness` (NM8)
* **Affected Scope:** 6.4:675; 5.3:354-362; 19:2232-2235, 2241-2253.
* **Discrepancy Description:**
  - **The issuer is fixed.** It is hard-coded to `https://app.mellodifai.com/oauth`.
  - **The test setup is missing.** Playwright starts only `next dev`. The relative `/consent` interaction URL needs `apps/auth` and Next behind one origin, but no port, start command or CI step is given for that.
* **Rationale & Recommendation:**
  - **Plan resolution:**
    - Add an issuer column (`<SITE_URL>/oauth`) to the 5.3 table.
    - Add Playwright `webServer` entries for `apps/auth` and the edge proxy (for example 3211 and 3212), and run the OAuth e2e through the proxy origin.
    - Start the same in `ci.yml`.
    - Allowlist the test client's loopback redirect.

### Major 17. The dev and prod stacks share a `project_id` and ports, and the live-data cutover is unwritten - Severity: Major

* **Reviewer Lens:** `egm-implementation-readiness` (NM9), `egm-codebase-details` B (N5), `egm-design` (N9)
* **Affected Scope:** 5.3:345-362; 5.1:294; 3:230-232; 13.2:1762; `config.toml:5`.
* **Discrepancy Description:**
  - **The stacks collide.** Dev and prod both use API 54321 and inherit `project_id = "mellodifai"`. The CLI names containers and volumes by `project_id`, so the two stacks share them, and a `db reset` from the checkout or the dev stack resets production. That reset re-seeds `admin@mellodifai.local` and brings back the repo's demo secret.
  - **The live data move is unwritten.** Moving today's live stack under `--workdir <runtime root>/stacks/prod` is never described. If the rendered `project_id` changes, production starts on an empty database.
* **Rationale & Recommendation:**
  - **Plan resolution:**
    - Add `project_id` and a port block per environment to the 5.3 table: prod keeps `mellodifai` and its ports, dev gets `mellodifai_dev` on its own block, and e2e keeps `mellodifai_e2e`.
    - Write a one-time cutover: backup, stop, start with `--workdir`, compare row counts.
    - `ops/stack.ts` refuses `reset` and `stop --no-backup` on the prod project id.

### Major 18. The local sign-in origin contradicts itself, and GoTrue's fallback produces a broken link (B6 residue) - Severity: Major

* **Reviewer Lens:** `egm-codebase-details` B (N4), `egm-implementation-readiness` (Nit 2), `egm-design` (Nit)
* **Affected Scope:** 5.4:394-396 against 5.4:407; 5.3:356-357; 5.1:294; code `playwright.config.ts:8-9,24`, `config.toml:164`.
* **Discrepancy Description:**
  - **The fixed origin fits no environment.** 5.4:395 fixes the local origin to `http://127.0.0.1:3000`. That origin is not on the e2e allow list (3210), is not the dev server's port (3001), and drops the session of a user browsing on `localhost`.
  - **The fallback link is malformed.** When `redirect_to` is not allowed, GoTrue falls back to the bare `SITE_URL`, and the template renders `http://127.0.0.1:3210&token_hash=...`, which is not a valid URL.
* **Rationale & Recommendation:**
  - **Plan resolution:**
    - Build `emailRedirectTo` from the request origin, validated against that environment's `additional_redirect_urls`, and refuse any other origin.
    - Set the dev row to `http://127.0.0.1:3001` and `http://localhost:3001`.

### Major 19. The documented restore deletes every stored media file - Severity: Major

* **Reviewer Lens:** `egm-implementation-readiness` (NM10), `egm-codebase-details` B (N2)
* **Affected Scope:** 20:2268-2270, 2284-2287.
* **Discrepancy Description:**
  - **The backup is rows only.** It is `db dump --data-only --schema public,auth,storage`, which saves rows but not the stored files.
  - **The restore deletes the files.** It runs `supabase stop --no-backup`, which deletes every stack volume, including the storage volume with the audio and renders. The restored `storage.objects` rows would then point at nothing.
* **Rationale & Recommendation:**
  - **Plan resolution:**
    - Restore by resetting only the database: `supabase db reset --workdir <prod> --no-seed` at the backup's tag, then `psql -f`.
    - Never use `--no-backup` on the prod project.
    - Alternatively, copy the storage volume next to every dump.

### Major 20. The password rotation must survive stack restarts, and the compose fallback changes other sections - Severity: Major

* **Reviewer Lens:** `egm-design` (N8)
* **Affected Scope:** 5.3:374-387; 21.2:2326-2327; 20:2284-2287.
* **Discrepancy Description:**
  - **Restarts undo the rotation.** The CLI recreates its service containers with built-in credentials on every `supabase start`. A one-time re-template therefore reverts or breaks at the next start, and section 23 expects power cuts.
  - **The compose fallback invalidates written mechanisms.** If spike 2 takes the compose fallback, these stop applying as written:
    - `supabase gen signing-key`;
    - `status -o json`;
    - `signing_keys_path`;
    - `content_path` for the email template;
    - `[auth.sessions]`;
    - the restore's `supabase stop/start --workdir`.
* **Rationale & Recommendation:**
  - **Plan resolution:**
    - `ops/services.ts start` re-applies the passwords and runs the container probe on every start, and refuses to start `cloudflared` if the probe fails.
    - If the fallback is taken, the spike-2 write-up gives the compose equivalent of each item above.

### Major 21. The `jobs_stamp_ctx` trigger on worker requeues is unspecified (M12 residue) - Severity: Major

* **Reviewer Lens:** `egm-design` (N5), `egm-codebase-details` B (Nit 10)
* **Affected Scope:** 6.3.4:580-583; 6.9:820-824; code `queue.sql:136-142`, `loop.ts:301, 339, 370`.
* **Discrepancy Description:**
  - **Worker requeues carry no context.** The worker requeues jobs through PostgREST updates without `mdf.job_ctx`. If the trigger stamps from an empty context, it clears `fake_providers` and `token_id`.
  - **Example.** A deploy during the remote exit test restarts a test job, which then runs real kie on a test version, reserved on demand against the admin's caps.
* **Rationale & Recommendation:**
  - **Plan resolution:**
    - The trigger does nothing when `mdf.job_ctx` is unset.
    - It never flips `fake_providers` from true to false, and never nulls `token_id`.
    - A database test covers both.

### Major 22. `rls.test.ts` goes red at the lockdown commit, and the "ten files" count is wrong - Severity: Major

* **Reviewer Lens:** `egm-codebase-details` A (N9), `egm-implementation-readiness` (Nit 15), `egm-codebase-details` B (Nit 3)
* **Affected Scope:** 21.2:2340-2343, 2360; 19:2229-2231; code `rls.test.ts:96-122, 250-268`.
* **Discrepancy Description:**
  - **`rls.test.ts` breaks.** It builds its fixture with the user's own direct inserts into `projects`, `versions` and `jobs`, and asserts that a direct cancel succeeds. Steps 4-5 rewrite only the files that call RPCs, so the step-5 commit goes red.
  - **The file count is wrong.** Nine files call RPCs as `authenticated`, not ten; `queue.test.ts` uses the service role.
* **Rationale & Recommendation:**
  - **Plan resolution:**
    - In the lockdown commit, rewrite `rls.test.ts` to use service-role fixtures and to expect `42501` on direct writes.
    - Say "every `supabase/tests` file that fails after the lockdown" instead of "ten".

### Major 23. The web-side rate checks that replace metering have no contract - Severity: Major

* **Reviewer Lens:** `egm-implementation-readiness` (NM12)
* **Affected Scope:** 6.3.6:636-638; 7.4:937-938; 11.5:1588.
* **Discrepancy Description:** `ops.style_format_check` and `ops.transcribe_check` exist only by name. No limits, roles or windows are given, and Next's provider keys are unmetered in M1. 6.3.6:638 also points to 11.5, which no longer defines them.
* **Rationale & Recommendation:**
  - **Plan resolution:** state the limits in 6.7: customers get 20 style formats and 10 transcriptions per day, admins are bound only by the per-minute rates, and a refusal returns `rate_limited`.

### Major 24. Some existing server actions have no named wrapper - Severity: Major

* **Reviewer Lens:** `egm-implementation-readiness` (NM14), `egm-codebase-details` A (Nit 2)
* **Affected Scope:** 6.3.6:635-644; code `checkpoints.ts:42`, `visualizer.ts:33` (`keep_audio`), `songs-from-songs.ts:61` (`choose_take`), `project.ts:7` (`create_project`).
* **Discrepancy Description:** step 3 requires every `"use server"` export to go through a wrapper, but these three have none. `keep_audio` may enqueue `timing`, which reserves Groq.
* **Rationale & Recommendation:**
  - **Plan resolution:** add three rows to 6.3.6:
    - `ops.audio_keep` (cookie only, with the `timing` reservation rule);
    - `ops.take_choose`, next to the section-edit wrappers;
    - `create_project` routed to `ops.admin_project_create`.

### Major 25. The existing worker spend guards are not mentioned - Severity: Major

* **Reviewer Lens:** `egm-codebase-details` B (N9)
* **Affected Scope:** 11.5:1534-1565, 1599-1607; code `kie/guard.ts:10-29` (used at `generate-song.ts:145`, `replace-section.ts:135,368`), `draft-lyrics.ts:177-191` (`LYRICS_DAILY_CAP`).
* **Discrepancy Description:**
  - **The kie guard blocks the test.** It refuses `.test` owners before any fake-kie call unless `ALLOW_TEST_KIE=1` is set, so the integration test fails as specified.
  - **Their future is unstated.** Nothing says whether either guard stays next to the ledger.
* **Rationale & Recommendation:**
  - **Plan resolution:**
    - Keep both guards as extra layers and say so in 11.5.
    - The integration test sets `ALLOW_TEST_KIE=1`, with `KIE_API_BASE` pointed at the fake server.

### Major 26. A local process can take over the services' loopback ports - Severity: Major

* **Reviewer Lens:** `egm-design` (N13)
* **Affected Scope:** 5.1:278-303.
* **Discrepancy Description:**
  - **Any local account can take a port.** While a service restarts, any local account can bind `127.0.0.1` ports 3080, 3000 or 3010.
  - **What a takeover gets.** A compromised `apps/auth` that wins 3080 receives all tunnel traffic: PATs, OAuth tokens and the admin's `/consent` cookies. It can also drop `x-mdf-remote`.
  - **Account separation does not help.** Separate Windows accounts do not prevent this.
* **Rationale & Recommendation:**
  - **Plan resolution:**
    - `ops/services.ts` checks the owning account of each listening port at start and on a timer, and stops `cloudflared` on a mismatch.
    - Record the residual risk in 17.

### Major 27. The pairing window admits any internet client, more than once (M30 residue) - Severity: Major

* **Reviewer Lens:** `egm-design` (M30 closure)
* **Affected Scope:** 6.4:691-697, 708; 17:2172.
* **Discrepancy Description:**
  - **Anyone can register.** During the 10-minute window, any internet client can register, and several registrations are accepted.
  - **Localhost redirects are not restricted.** Clients with `localhost` redirects are not limited to local consent.
* **Rationale & Recommendation:**
  - **Plan resolution:**
    - The window closes on the first successful registration.
    - Settings > Agenti shows that client (name, redirect host, time) for confirmation.
    - Loopback-redirect clients may consent only from a local request.

### Nits

1. **6.3.2:503-505:** the two `alter default privileges ... in schema ops` statements come before `create schema ops` (505) and fail on a missing schema. Create the schema first.
2. **6.4:693:** `ops.admin_pairing_open()` has no `p_ctx`, so the admin rule cannot run. Add `p_ctx`.
3. **6.9:823:** the mechanism that sets `versions.test_run` is unstated. Use a `before insert` trigger that reads `mdf.job_ctx`.
4. **6.3.4 / 11.5:1594-1596:** `reserve_job` should be idempotent per job and return the existing open reservation id. A crash between enqueue and finish (`loop.ts:320-325`) re-runs `worker_enqueue`.
5. **6.3.4 steps 1-3 and 15.1:2014-2019 (idempotency keys):**
   - Refusals in steps 1-3 leave the key in flight for 10 minutes. Delete it on those refusals too.
   - `idempotency_keys.actor_key` is undefined.
   - The wrapper should verify the `in_flight` row's hash.
6. **`rotate-db-passwords.ts`:** it must also rewrite `MDF_WEB_DATABASE_URL` and `MDF_AUTH_DATABASE_URL` in the two env files. Where `MELLODIFAI_OWNER_EMAIL` lives is unstated.
7. **21.2 file list:**
   - Missing:
     - the pre-commit hook file;
     - the fake OpenRouter and Groq HTTP servers;
     - the `next.config.ts:9-29` turbopack `resolveAlias` entries for `packages/shared/src/ops/*.js`;
     - the `sendSignInLink` module.
   - `ops/rotate-auth-keys.ts` is in no step.
   - `pnpm-workspace.yaml:2` already globs `apps/*`, so listing `apps/auth` there adds nothing.
8. **`check-no-keys` scope:** state whether ignored folders (`node_modules`, `.next`, `.claude/worktrees`) are scanned, and match a JWK shape (`kty` plus `d`) rather than a bare `"d":`.
9. **`cloudflared` service:**
   - Start it only after the rotation and the probe pass, matching 5.3's "before any route goes live".
   - Run it under its own account rather than LocalSystem, with access to its secrets folder.
10. **Edge proxy:**
    - Add unit tests for the `x-mdf-remote` overwrite, the `Next-Action` filter and the per-IP limits.
    - The proxy must overwrite `x-forwarded-host` and `x-forwarded-proto`, because `apps/auth` uses `proxy: true`.
11. **Stale references after the shrink:**
    - 22:2455 lists ntfy as "M1 push";
    - 16:2151, 15.2:2138 and 2141 say `ledger_entries` (now `reservations` and `spend_entries`);
    - 6.3.6:638 points to 11.5 for the web-side checks.
12. **19:2246-2247:** the `test:db` guard does not exist at `package.json:13`; it is a Modify that creates it. Define what the guard refuses.
13. **`CostsSummary.caps[].used`:** undefined for the month period.
14. **Test prices:** "pinned test prices" conflicts with `on conflict do nothing` seeds. The test must update the price rows explicitly.
15. **6.3.2:533-535:** the "owners delete studio files" policy (`022:54-59`) is called both "unchanged" and "profile check added", and no migration makes the change.
16. **14.4:1924:** `current_date` is the UTC date. Use `(now() at time zone 'Europe/Rome')::date + 1`.
17. **Error-map residue:** `uploaded audio required` (`023`, `024`) and `current take required` (`006`, `014`, `023`) still map to `conflict`.
18. **6.3.7:656-658:** the claim-injection test covers only a write. Add `ops.song_get` and the other read functions (see Major 3).
19. **15.1:1971:** the 1-60 character check on `agent_tokens.name` can reject OAuth client names. Truncate them.
20. **7.2:883-884:** the songs cursor sorts on `versions.updated_at`, which `count_play` and `set_reaction` bump (`core.sql:144`), so rows move between pages.
21. **6.3.1:489-490:** no password path for `mdf_web` on the dev stack, so dev stays `nologin`.
22. **6.3.3:543:** `information_schema.column_privileges` shows only grants visible to the connection's roles. Use `pg_attribute.attacl` through `aclexplode`.
23. **6.9:830-831:** `db.ts:680` is the in-memory test Db. The Supabase `enqueue` is at `db.ts:344-359`.
24. **`config.toml:200`:** `email_sent = 2` per hour will apply once prod SMTP is on. Add a prod value to the 5.3 table.
25. **CLI pack:** the `pnpm pack` tarball installs globally only if `@mellodifai/shared` is a devDependency of `packages/cli` (it is bundled).
26. **`playwright.config.ts:24`:** it appends `--hostname` and `--port` to the new `dev -H 127.0.0.1 -p 3001` script, which duplicates the flags.
27. **`score_takes.py`:** one run makes one Groq call per uncached take, so `engine.run` must accept several entry ids.
28. **Flow cookie (6.4:699-701):**
    - Name it `__Host-mdf_flow` on the public host, against cookie tossing.
    - Two concurrent flows in one browser overwrite each other's cookie.
29. **6.3.4 step 1:** state that remote PATs need `remote_mcp` on, as 6.4:750 already says.
30. **Token owner's role:** re-check it on every token call. A demotion by `set-owner` otherwise leaves spend tokens live.
31. **`/_next/image`:** drop it from the edge allowlist and serve the logo as a static file.
32. **Ambiguous section edits and double expiry:**
    - No resolver is named for an ambiguous `replace_section` submission; `resolve_kie_submission` handles versions only (`final_fixes.sql:35-40`). Keeping the reservation ambiguous is safe, because its charges stay counted.
    - `close_reservation` must lock the reservation row and check that it is still open, because the stale-claim takeover (14.4:1918-1920) can run two expiries at once.
33. **17 (M10 residual):** state that Next's provider keys are unmetered in M1, and that if the owner falls back to copies of the worker's keys (22:2454), only provider-side limits bound them.

## Verdict

**M1 ready to plan: no.** One Blocker remains: the step order in 21.2 (Blocker 1).

- **The fix is small.** It is a reorder of 21.2 steps 1-6 and the matching sentence in 20, and it does not change what gets built.
- **Once it is fixed, M1 can be planned.** The 27 Majors and 33 Nits are plan tasks with stated resolutions.
- **Majors to finish early.** These touch security or money:
  - before the first production deploy: Majors 1, 2, 3, 17 and 19;
  - before step 8 (remote enablement): Majors 12, 13 and 26;
  - in the ledger work of step 2: Majors 5, 6, 7 and 8.

**Round-4 closure:**
- **Blockers:** 4 closed, 4 partly closed.
- **Majors:** 25 closed, 7 partly closed, 3 moved consistently, 0 open.
- **Nits:** 21 applied, 3 moved.
