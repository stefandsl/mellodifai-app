# Goldfish Review Report - round 2

**Target:** `docs/superpowers/specs/2026-11-01-agentic-studio-design.md` (lines 1-1652, revision 2, commit 5fabb57)
**First-round report:** `docs/egm/agentic-studio/goldfish_review_report.md` (17 Blocker, 31 Major, 13 Nit)
**Repo checked:** `C:/Users/Asus/Documents/mellodifai`, branch `build/studio-ui`
**Date:** 2026-11-01/02

The owner's decisions (sections 2.1 and 2.2) are final and are not findings. A finding may still say that a mechanism fails to carry out an owner decision.

## Reviewer Status

| Reviewer | Status | Assigned first-round findings |
| --- | --- | --- |
| `egm-design` | completed | B1, B2, B3, B5, B7, B8, B9, B12, B13, M2, M3, M7, M9, M24-M28 |
| `egm-implementation-readiness` | completed | B4, B10, B11, B14, B15, B16, M11-M13, M15-M20, M29, plus the M1 walk |
| `egm-codebase-details` | completed | B6, B15, B17, M1, M8, M21-M23, M31, N6, N10, N13, plus the section 3 facts |
| `egm-zoom-out` | completed | M4, M5, M6, M10, M14, M30, N3, N4, N8, N9, N11, N12 |
| `egm-comprehension` | not requested | Zoom-out judged the document still readable, so this review was not needed (see "Readability" below) |

Note from codebase-details: the checkout changed during the review. `supabase/migrations/20261101000024_covers_on_kie_only.sql` and `packages/shared/src/visualizer/viz-looks.ts` appeared while it was running, which means T12 and the VideoHive presets are still landing on `build/studio-ui`.

## Summary

| | Blocker | Major | Nit |
| --- | --- | --- | --- |
| New or unresolved findings (this round) | **5** | **35** | **33** |

| First-round findings | Resolved | Partial | Unresolved | Not verified |
| --- | --- | --- | --- | --- |
| Blockers (17) | 4 (B1, B4, B5, B11) | 13 | 0 | 0 |
| Majors (31) | 21 | 10 (M5, M6, M7, M11, M12, M16, M19, M27, M29, M30) | 0 | 0 |
| Nits (13) | 9 (N3, N4, N6, N8-N13) | 0 | 0 | 4 (N1, N2, N5, N7) |

**First-round Blockers not truly resolved:** B2, B3, B6, B7, B8, B9, B10, B12, B13, B14, B15, B16, B17.

- **Still at Blocker level.** B2, B3, B6, B8 and B9 leave gaps that are still Blockers. They are written up below as R2-B1 to R2-B4.
- **Now at Major level.** The other eight (B7, B10, B12, B13, B14, B15, B16, B17) are much improved. What is left of each is a Major.

Section 28's claim that "all 61 are resolved" does not hold.

**Verdict on M1:** M1 is not ready to plan yet. Two problems sit in the database:

- the existing `jobs` INSERT grant and the existing RPCs bypass the ledger, the caps and the veto window once `/rest/v1` is public;
- no user ever gets the `customer` role.

About ten M1 decisions are also still left to the builder. A short revision by the author, needing no new owner input, can close all of them.

## Verification of first-round findings

| ID | Verdict | Design lines | Reason |
| --- | --- | --- | --- |
| B1 | RESOLVED | 226-280 | The text now gives one topology, a host and path table that ends in a catch-all 404, a never-exposed list, key rotation with a demo-secret exit test, `/media` streaming, capability links and SMTP. The gap on the api host's paths is carried in R2-M1. |
| B2 | PARTIAL | 1045-1053, 1078-1094, 1104-1107, 849-855 | The frozen evaluator protects the loop's own score. But the product juries and gate thresholds sit in the allowlisted `apps/worker/src/stages/**`, and the denylist names thresholds only as concepts, not paths. See R2-B3. |
| B3 | PARTIAL | 1055-1074 | The proposer is isolated. But the gate container runs candidate code, and its egress, network and Docker-socket access are unstated. See R2-B4. |
| B4 | RESOLVED | 935, 1316-1327, 1340-1409 | The ledger and caps are in M1, and the visual jury and publish gate (M3) come before publishing (M4) and Autopilot (M5). What the `publish` scope does before M4 is carried in R2-M4. |
| B5 | RESOLVED | 500-503, 580-588, 726-741, 751-755 | The timeline is data-only, validated twice and rendered only by app components. The internal writer, driver lease and image re-encoding are specified. |
| B6 | PARTIAL | 115-123, 284-360 | The design of the JWT, `require_scope` and the Autopilot actor is sound. But the role model it relies on is wrong in the code: every allowlisted user becomes `admin`. See R2-B2. |
| B7 | PARTIAL | 322-345, 246 | The authorization server, protected resource metadata, PKCE, grant rows and consent are concrete. But OAuth tokens still reach Realtime, storage reads and `/auth/v1/user`, and the api-host allowlist blocks the `/.well-known` discovery path. See R2-M1. |
| B8 | PARTIAL | 389-391, 908-935, 317-320 | `reserve_spend` is well defined, but nothing in the database enforces it. Direct `jobs` INSERTs and existing RPCs bypass it, and paid calls made inside stages have no reserve rule. See R2-B1 and R2-M6. |
| B9 | PARTIAL | 981-1003, 359, 1007-1010 | The clock, the missed-slot rule and the bundle veto are concrete. But the database enforces the window only for `confirmed_via = autopilot`. The existing `confirm_publication` still publishes at once and is outside the 10.8 gate. See R2-B1 and R2-M4. |
| B10 | PARTIAL | 505-527, 621-663, 1194-1224 | The state machine, pause points and job map are concrete. But section 15 gives only "key fields": `stage_runs` has no `job_id` link, and no component is named that creates stage rows and enqueues the next stage. See R2-M9. |
| B11 | RESOLVED | 676-724, 546-549 | There is a full zod v1 schema in one package. Small leftovers (cross-field refinements, free strings) are in Nit 6. |
| B12 | PARTIAL | 781-806, 550, 1211, 1217 | The metrics, models and binding values are concrete. But the source transcript, word timestamps and frame fingerprints are not kept after R2, and the machine-translation provider and embedding model are unnamed. See R2-M19. |
| B13 | PARTIAL | 1128-1147, 1061 | The branch flow, deploy steps and revert triggers are concrete. Unstated: who runs deploy and revert with what credentials, and what happens when fewer than 3 runs occur in the 48 h watch. See R2-M24. |
| B14 | PARTIAL | 1316-1409 | Exit criteria and named migrations are present. File lists exist only for M0 and M1, and the M1 list is incomplete. See R2-M8. |
| B15 | PARTIAL | 385-470 | One ops module, the envelope, idempotency and SSE are specified. The catalogue misses about 12 existing server actions and has no schemas, responses, RPC map or milestone column. See R2-M7. |
| B16 | PARTIAL | 1160-1192, 1218 | The resource class, lease, VRAM check and disk rules are concrete. But there is no `jobs.priority` column and no lease timing values, and loop evaluation cannot see the production lease. See R2-M23. |
| B17 | PARTIAL | 135-143, 955-979 | The existing code is now described correctly. But the publish stage is master-only and keyed per version, so a Short cannot be published that way. `publishAt` scheduling conflicts with AC4. See R2-M22. |
| M1 | RESOLVED | 132-133, 771-779 | The devil's advocate is stated as missing and specified as new work. |
| M2 | RESOLVED | 376-383, 1071 | Untrusted flag, template-only fields, quoted loop inputs. Free strings are in Nit 6. |
| M3 | RESOLVED | 267-275, 1019-1026 | Capability links, Postiz uptime and the Blotato fallback are specified. |
| M4 | RESOLVED | 9-10, 92-102 | The table in 2.4 covers every superseded 31/10 rule. |
| M5 | PARTIAL | 201-203 vs 486, 565-566, 869 | The music order in Goal 4 still contradicts the tier table. See R2-M28. |
| M6 | PARTIAL | 937-951 | The budget table sums to 0.15 USD only by leaving lines out, and its jury allocations have no derivation. See R2-M17. |
| M7 | PARTIAL | 1096-1117, 1183 | The ratchet's noise handling is concrete, but the nightly eval cap of 1 USD cannot pay for even one hypothesis. See R2-M17. |
| M8 | RESOLVED | 129-132, 759-767 | Fail-open is described correctly, and new juries fail closed (`lyric-jury.ts:333-344`). |
| M9 | RESOLVED | 1207, 1226-1237 | Notifications table, ntfy push, MCP resource, veto deadlines. |
| M10 | RESOLVED | 1239-1272 | The risk and alternatives tables are present. The runner choice is carried in R2-M35. |
| M11 | PARTIAL | 1451-1455, 734 | The timeline `block` enum and the params schema for each block are still open. See R2-M26. |
| M12 | PARTIAL | 665-672, 1223 | The defaults are listed, but their table ships in M5 while M2 needs it. See R2-M25. |
| M13 | RESOLVED | 1416-1435 | The owner-actions table now has blocks, who, fallback and status columns. Who sets up Access is carried in R2-M13. |
| M14 | RESOLVED | 47-90 | Owner decisions (OD) and author's calls (AC) are separated and numbered. |
| M15 | RESOLVED | 492-503 | There is an explicit table of who reasons and who pays. |
| M16 | PARTIAL | 481-490, 494-500 | Free tier vs "juries always in the app" contradiction. See R2-M18. |
| M17 | RESOLVED | 647-663 | Caps, retries, error classes and timeouts are given. The kie timeout carve-out is in Nit 8. |
| M18 | RESOLVED | 1274-1297 | Fakes, fixtures and test layers are named. The remote exit test is carried in R2-M12. |
| M19 | PARTIAL | 1299-1310, 1135-1139 | Rollback depends on `ops/deploy.ps1`, which is built in M6. See R2-M14. |
| M20 | RESOLVED | 1226-1237 | Stores, retention, views and alerts are given. The retention job is carried in R2-M15. |
| M21 | RESOLVED | 145-155, 513-527, 743-749 | Reuse is named and one Remotion project is chosen. |
| M22 | RESOLVED | 125-133, 859-865 | The reasoning chain is described correctly. |
| M23 | RESOLVED | 393-396, 1349-1350 | The schema move waits for T12. |
| M24 | RESOLVED | 660-663, 874-899 | The fallthrough details are concrete. The security gap of route 2 is R2-B5. |
| M25 | RESOLVED | 808-826 | The visual jury is specified. Its cost is in R2-M17. |
| M26 | RESOLVED | 833-837 | Distinctness has a metric. The aggregate is in Nit 4. |
| M27 | PARTIAL | 552-572, 828-831 | The R3 method is concrete. The mapping from R2 to the music provider is missing, and "WER" is mislabelled. See R2-M27. |
| M28 | RESOLVED | 221-224, 87, 541-543 | The terms-of-service and "model input" wording is consistent. |
| M29 | PARTIAL | 957-959, 1031-1036 | The scheduler, the token storage and the thumbnail-style field are missing. See R2-M15 and R2-M30. |
| M30 | PARTIAL | 11-16, 1019-1029, 1500-1546 | The doc still restates feature-plan specs. See R2-M29. |
| M31 | RESOLVED | 534, 745-749, 1494-1498, 1570-1581 | Env-var roots are added and paths are given. The missed hard-coded paths are in Nit 17. |
| N3, N4, N8, N9, N11, N12 | RESOLVED | see zoom-out | Two trivial misses are in Nit 32. |
| N6, N10, N13 | RESOLVED | 188, 128-130, 277-280 | Matches the code. |
| N1, N2, N5, N7 | not verified individually | - | N1 overlaps R2-M11 (stateless MCP mode not chosen) and N2 overlaps Nit 10. |

## Prioritized Findings (Blockers -> Major -> Nits)

### Blockers

### R2-B1. Direct `jobs` INSERTs and existing RPCs bypass the ledger, caps, roles and veto window once `/rest/v1` is public - Severity: Blocker (M1)
* **Reviewer Lens:** `egm-design`, `egm-codebase-details` (carries B8, B9)
* **Affected Scope:** design lines 215-216, 246, 297-308, 317-320, 389-391, 917-935. Code:
  * `supabase/migrations/20261031000005_pipeline_hardening.sql:25-26, 81-103`
  * `20261031000008_perf_indexes.sql:22-33`
  * `20261031000006_web_flow.sql:42-51, 95-108, 128-131`
  * `packages/shared/src/status.ts:81`
* **Discrepancy Description:** Today `authenticated` holds a column INSERT grant on `public.jobs`, and the "owners enqueue jobs" policy allows the stages `draft_lyrics`, `generate_song`, `timing`, `publish` and `set_privacy`. Several RPCs are granted to `authenticated` with no role check:
  * `approve_lyrics` and `generate_again` enqueue paid kie generation;
  * `enqueue_publish` and `confirm_publication(..., 'public')` publish at once on the single YouTube channel.

  `require_scope` lets cookie sessions through (318-319). M1 puts `/rest/v1` on `api.mellodifai.com`. From then on, any signed-in browser session can do all of the following by POSTing straight to PostgREST:
  * queue paid work without a ledger reservation;
  * exceed the customer cap;
  * publish while "customers never publish" (307) says it cannot;
  * skip the veto window and the 10.8 gate.

  "Reserve in the same transaction as the job insert" (919-921) holds only if the reservation lives inside the RPC. In the design, the ops module reserves first and then calls the RPC (389-391). Paid calls inside worker stages (writer and jury rounds, R2 vision, R6 images) have no reserve rule at all.
* **Rationale & Recommendation:** Do this in the M1 `ops_scopes` and `spend_ledger` migrations:
  * Revoke the direct `jobs` INSERT from `authenticated` and drop the policy.
  * Move `reserve_spend` inside every RPC that spends.
  * Make the worker refuse a paid stage, or a paid call within a stage, that has no live reservation id. Each in-stage provider call reserves before it runs.
  * Add role checks in the RPCs: customers get no `enqueue_publish` or `confirm_publication`.
  * Until M4 replaces `confirm_publication` with `schedule_publish`, revoke it from `authenticated` or limit it to `private`.
  * Add exit tests that hit these paths directly on the public host with a customer session.

### R2-B2. No user ever becomes `customer`, so the role-to-scope rules protect nothing - Severity: Blocker (M1)
* **Reviewer Lens:** `egm-codebase-details` (carries B6)
* **Affected Scope:** design lines 115-117, 304-308, 1362. Code: `supabase/migrations/20261031000001_core.sql:25-26, 246-259` and `20261031000003_security.sql:11-12`.
* **Discrepancy Description:** Section 3 says allowlisted people get the role `admin` (the owner) or `customer` (family and friends). In the code, the signup trigger always inserts `'admin'`, and no RPC or UI ever sets `customer`; only tests do. That empties several design rules:
  * the role-to-scope mapping (6.2);
  * "local engines admin only";
  * the M1 exit test "spend and publish scopes cannot be granted to a customer".

  Every family member can be granted spend and publish, and admins can read every object in the `previews` bucket. Exposing `/storage/v1` publicly turns this into an internet-facing problem.
* **Rationale & Recommendation:**
  * Correct section 3.
  * In M1 `ops_scopes`, add a role column to `admin_allowlist` with default `customer`, change the trigger to use it, and audit the existing profiles.
  * Add a database test that a new allowlisted user is a customer and cannot be granted spend or publish.

### R2-B3. The loop can loosen the production gates through allowlisted paths, and the revert signal reads the same gates - Severity: Blocker (M6)
* **Reviewer Lens:** `egm-design`, `egm-zoom-out` (carries B2)
* **Affected Scope:** design lines 849-855, 1083, 1089-1090, 1121, 1143-1146. Code: `apps/worker/src/stages/lyric-jury.ts:19` (`PASS_SCORE`), `combine()`, `apps/worker/src/stages/qa.ts:90`.
* **Discrepancy Description:** Step 1 of the merge gate checks paths, but the denylist names "the originality, distinctness and jury thresholds" and "router order and cost or cap code" without paths. Meanwhile `apps/worker/src/stages/**`, which holds the lyric jury, the visual jury stage, the originality comparison and the QA loudness window, is allowlisted. Autopilot and the 10.8 publish gate trust what that code writes into `jury_reports`. The revert monitor's "mean jury score down" signal reads the same product juries, so a more lenient jury raises the signal instead of tripping it. The frozen evaluator protects the loop's score, not production.
* **Rationale & Recommendation:**
  * Move every gate implementation, threshold, router order and cap constant into named denylisted paths (for example `packages/gates/**` and `config/gates/**`), so step 1 is a pure path check.
  * Seed the golden set with known-bad canaries: a close paraphrase, misspelt text and a near-duplicate render. The merge gate must confirm that the product gates still reject them.
  * Score the revert signals with the frozen evaluator, not the product juries.

### R2-B4. The gate container runs candidate code next to the merge credential and can reach production services - Severity: Blocker (M6)
* **Reviewer Lens:** `egm-design` (carries B3)
* **Affected Scope:** design lines 1052-1053, 1064-1068, 1073-1074, 1119-1126, 1133-1134.
* **Discrepancy Description:** New test files and stage code are allowed (1084), and they run in the same container that computes the score and pushes the merge. That container has four openings:
  * **The merge path.** Candidate code can forge the evaluation output or read the push credential.
  * **Egress.** Its egress is unspecified.
  * **The host.** On Docker Desktop a container on a default network reaches `host.docker.internal`. That includes production Postgres on 54322 (default password `postgres`; 5.3 rotates only the JWT keys), ComfyUI with no auth, Postiz, 54321 and the `app_flags` kill switch. So the claim "neither container can reach them" (1074) is not backed by any mechanism.
  * **The Docker socket.** Starting "its own Supabase stack" from inside a container needs the socket, which controls the production database volume.
* **Rationale & Recommendation:** Split the gate into three parts:
  1. an execution sandbox on an `internal` Docker network with only an egress proxy, no Docker socket and no credentials;
  2. a scorer that reads the artefacts read-only;
  3. a merger on the host, run by the supervisor. It holds the only push credential and acts on a verdict file after the sandbox is destroyed.

  The supervisor starts the e2e stack on the host, and the sandbox joins only that stack's network. Also rotate the local Postgres password.

### R2-B5. Image route 2 runs a shell-capable agent under the owner's account on prompts derived from untrusted content - Severity: Blocker (M3; does not block M1)
* **Reviewer Lens:** `egm-design` (new)
* **Affected Scope:** design lines 376-381, 590-595, 881-885.
* **Discrepancy Description:** Route 2 runs `codex exec` on the host under the owner's Windows account. That account holds every env file, every token and the production database. Its prompts are built from the blueprint and the meaning map, which models derive from untrusted source captions and frames. "Fill only fixed template fields" does not neutralise an injection when the consumer is an agent with tools.
* **Rationale & Recommendation:**
  * Run route 2 with `--sandbox read-only` (or workspace-write limited to an empty temp directory), no approvals, and no network except the model API.
  * Better still, use a separate low-privilege OS user or container, the same pattern as the loop proposer.
  * Build prompt fields only from enums and length-limited strings.
  * Add a test that an injected instruction in a meaning map cannot cause a file read or a network call.

### Majors - M1 (safe agent access)

### R2-M1. OAuth tokens and discovery paths fall outside the PostgREST hook - Severity: Major (M1)
* **Reviewer Lens:** `egm-design`, `egm-implementation-readiness`, `egm-codebase-details` (carries B7)
* **Affected Scope:** design lines 246, 322-345.
* **Discrepancy Description:** The api-host allowlist permits only `/auth/v1/*`, `/rest/v1/*`, `/storage/v1/*` and `/realtime/v1/*`. Supabase publishes authorization-server metadata under a root `/.well-known/oauth-authorization-server/...` path, and OIDC under `/.well-known/openid-configuration`. The catch-all 404 would therefore break discovery by claude.ai and ChatGPT.

  The `db_pre_request` refusal covers only PostgREST and storage writes. A third-party connector's OAuth token can still use Realtime, storage reads and `/auth/v1/user` (GET and PUT).

  A Supabase OAuth access token carries no `token_id` or `actor`, so `require_scope` treats it as a cookie session and lets it through. The claim that tells the two apart, and the metadata path, are both left as "confirmed in M1" with no fallback.

  Supabase's OAuth server may also reject the custom scopes `read create spend publish` if the metadata advertises them.
* **Rationale & Recommendation:**
  * Add the well-known paths to the api-host row.
  * Make `require_scope` reject the OAuth client claim.
  * Block Realtime and storage reads for OAuth tokens with policies.
  * State that app scopes live only in the grant row chosen on the consent page, and that the metadata advertises no custom scopes.
  * Turn the two "confirmed in M1" items into an explicit M1 step 0: a spike with a written fallback.
  * Extend the exit test to Realtime, storage reads and `/auth/v1/user` with an OAuth token.

### R2-M2. The internal JWT puts an unnamed, very powerful signing key in the internet-facing Next process - Severity: Major (M1)
* **Reviewer Lens:** `egm-design`, `egm-implementation-readiness`, `egm-codebase-details`
* **Affected Scope:** design lines 255-257, 275, 310-320, 1201-1203. Code: `apps/web/lib/supabase/server.ts:7-8` uses only the anon key, and `apps/web/package.json` has no JWT library.
* **Discrepancy Description:** "Signed with the project signing key" leaves several things open:
  * which key is meant: 5.3 creates both asymmetric keys and a new HS secret;
  * the env var or file it is read from;
  * its `kid`, `iss` and `aud`;
  * the full claim set, the library, and how the token is passed to supabase-js.

  With that key anyone can mint `service_role` for any `sub`, so a compromise of Next becomes a full database compromise. The design also never names the credential the ops module uses to look up PAT hashes and grant rows, or to write `audit_log` and `rate_counters`.
* **Rationale & Recommendation:**
  * Use a dedicated asymmetric key for ops tokens only, published in the JWKS. Have the pre-request hook accept that `kid` only with `role = authenticated` and `via = ops`.
  * Name its env var (for example `SUPABASE_OPS_SIGNING_JWK` in `apps/web/.env.local`) and its redaction.
  * Do the token lookups and audit writes through narrow security-definer RPCs, not the service role.

### R2-M3. Splitting the browser and server Supabase URLs breaks sessions and local use, and leaks storage URLs - Severity: Major (M1)
* **Reviewer Lens:** `egm-implementation-readiness`, `egm-codebase-details`
* **Affected Scope:** design lines 264-265, 269-271. Code:
  * `apps/web/proxy.ts:21`, `apps/web/lib/supabase/server.ts:7`, `apps/web/lib/supabase/browser.ts:7` (all read `NEXT_PUBLIC_SUPABASE_URL`);
  * `apps/web/lib/studio/clips.ts:498`, `apps/web/lib/studio/stems.ts:153`, `apps/web/app/(app)/projects/[id]/page.tsx:66,143` (server-made signed URLs).
* **Discrepancy Description:** Four problems:
  * No server-only URL variable is named.
  * `@supabase/ssr` derives the auth cookie name from the URL host, so a browser on `api.mellodifai.com` and a server on `127.0.0.1:54321` would use different cookies.
  * `NEXT_PUBLIC_*` values are inlined at build time, so even a browser on the PC would call `api.` and break whenever DNS (still pending) or the tunnel is down.
  * Signed URLs made on the server point at `127.0.0.1`, which contradicts "never leaks a storage URL" (5.4).
* **Rationale & Recommendation:**
  * Name the server variable (for example `SUPABASE_INTERNAL_URL`) and pin `cookieOptions.name` in every client.
  * Route those signed URLs through `/media`.
  * Do the switch only after the DNS move.
  * Add these files to the M1 list.

### R2-M4. The `publish` scope has no defined behaviour before M4 - Severity: Major (M1)
* **Reviewer Lens:** `egm-design`, `egm-implementation-readiness` (carries B9)
* **Affected Scope:** design lines 299-300, 445-446, 935, 1219-1220, 1362.
* **Discrepancy Description:** `publish` becomes grantable in M1, but `schedule_publish`, the veto window and capability links arrive in M4. M1 is "ops for the existing operations", so a builder would map `publish_schedule` onto `enqueue_publish` plus `confirm_publication`, which is an immediate publish with no veto. The design also does not say whether the `uploadPrivate` and `setPrivacy` server actions stay cookie-only.
* **Rationale & Recommendation:** State that in M1-M3 the `publish` scope is not grantable, or that `publish_schedule` returns an error until M4. Mark `uploadPrivate` and `setPrivacy` as cookie-only.

### R2-M5. Autopilot can be selected without the publish or spend scope - Severity: Major (M5)
* **Reviewer Lens:** `egm-design` (new)
* **Affected Scope:** design lines 354-359, 439, 478-480, 641-642, 6.2.
* **Discrepancy Description:** `remake_start` needs only `create` (plus `spend` after R2). Nothing requires `publish` to start a run in Autopilot or switch one to it. A prompt-injected OAuth grant that holds only `create` could therefore cause `autopilot_schedule_publish` and Autopilot spending charged to the system token.
* **Rationale & Recommendation:** Selecting Autopilot requires a cookie session, or a token that holds both `spend` and `publish`. The initiating token's cap also applies to the run.

### R2-M6. The M1 ledger is incomplete - Severity: Major (M1)
* **Reviewer Lens:** `egm-implementation-readiness`, `egm-design` (carries B8)
* **Affected Scope:** design lines 305-307, 913-921, 933-935, 941.
* **Discrepancy Description:** Four gaps:
  * The customer cap of 0.10 USD per user has no counter scope: 11.5 lists only global, provider, token and run.
  * `jobs.run_id` arrives in M1, but `remakes`, the only kind of run, arrives in M2.
  * Only kie has a seeded price. There are no estimates for the OpenRouter writer and jury, or for Groq per minute.
  * The RPCs that must gain `reserve_spend` (`approve_lyrics`, `generate_again`, `create_song`, `request_section_edit`, `import_song`, `retry_stage`, `resolve_kie_submission`) and the migration that changes them are not named.

  The worker's settle points (`generate-song.ts`, `draft-lyrics.ts`) and how they find their reservation are not stated either.
* **Rationale & Recommendation:**
  * Add a `user` counter scope.
  * Make `run_id` an unconstrained uuid until M2, or drop it from M1.
  * Seed `price_book` rows with values.
  * List the RPCs that change and the migration that changes them.
  * Specify the settle lookup, for example by `job_id`.

### R2-M7. The operations catalogue misses existing actions and has no schemas, responses, RPC map or milestone column - Severity: Major (M1)
* **Reviewer Lens:** `egm-implementation-readiness`, `egm-codebase-details`, `egm-zoom-out`, `egm-design` (carries B15)
* **Affected Scope:** design lines 118-120, 319-320, 420-470, 1349, 1530. Code: `apps/web/app/actions/checkpoints.ts:39,50,69,94,149,160,177`, `audio-tools.ts:19`, `songs-from-songs.ts:58,88`, `library.ts:23`, `visualizer.ts:30`, `create-song.ts:40`.
* **Discrepancy Description:** M1 says the server actions move onto the ops module, but 7.3 has no row for these existing actions:
  * `keepAudio`, `keepAudioWithVisualizer`, `makeVideo` (it shares a row with `render_again`);
  * `backToLyrics`, `retryStage`, `chooseTake`, `setSongSource`, `saveEditedTake`;
  * `resolveUpload`, `uploadPrivate`, `setPrivacy`, `countPlay`, `createProject`, `resolveKieSubmission`.

  The catalogue also lacks input and output schema names, response shapes, spend estimates, the RPCs each operation calls, and the milestone that exposes each tool. Remake, veto, timeline and notification tools cannot exist in M1, yet the CLI list and the skill include them. Other inconsistencies:
  * The heading "names are fixed now" conflicts with editor tools that join later, and with section 26, which puts editor operations in M1.
  * Section 3 names `create_project`, but the create panel calls `create_song`.
* **Rationale & Recommendation:**
  * Add these columns: RPC(s) called, wrapped or not, zod input and output schema names in `packages/shared/src/ops/`, estimate (provider and units), and "ships in" milestone.
  * Mark operations that are never grantable as cookie-only.
  * Limit the M1 CLI and skill to the operations that exist in M1.

### R2-M8. The M1 file list is incomplete, and M2-M6 have none - Severity: Major (M1)
* **Reviewer Lens:** `egm-implementation-readiness`, `egm-codebase-details`, `egm-zoom-out` (carries B14)
* **Affected Scope:** design lines 1205, 1221, 1354-1357.
* **Discrepancy Description:** The M1 list does not mark files as Create or Modify. It leaves out:
  * the worker: `apps/worker/src/db.ts:344-359` (the enqueue has no `token_id` or `run_id`, so child jobs cannot carry them) and the settle points in `generate-song.ts` and `draft-lyrics.ts`;
  * `apps/web/app/actions/**`, `apps/web/lib/run-action.ts`, `apps/web/lib/supabase/*.ts`;
  * `app/(app)/settings/**`, `app/api/transcribe/route.ts`, `app/actions/format-style.ts`;
  * `app/api/health/**`, which does not exist yet;
  * root `package.json:13` (the `test:db` pin), `supabase/tests/**`, `README.md`, `.github/workflows/keepalive.yml`.

  It lists no new dependencies; the MCP SDK and a JWT library are absent from `apps/web/package.json`. It does include `apps/web/app/m/**`, yet `capability_links` is an M4 table, and `resource_class` ships in M1 with no consumer until M2.
* **Rationale & Recommendation:**
  * Complete the M1 list with Create and Modify marks and the new dependencies.
  * Move `/m/**` to M4.
  * Give M2 a file list before M2 is planned.

### R2-M9. Section 15 is not a schema, and the link from stage runs to jobs is missing - Severity: Major (M1 and M2)
* **Reviewer Lens:** `egm-implementation-readiness` (carries B10)
* **Affected Scope:** design lines 505-527, 1194-1224.
* **Discrepancy Description:** Section 15 gives only "key fields". It has no:
  * column types, defaults or check enums (for example `agent_tokens.kind`, the scopes element check, the `notifications.kind` list);
  * unique keys (one OAuth grant per owner and client?) or indexes;
  * RLS or grant statements. Who may read `audit_log`, `ledger_entries` and `notifications`?

  Separately, `stage_runs` has no `job_id` link and no rule for stages that span several jobs (R7 is 4 jobs, R9 is 3). No component is named that creates `stage_runs` rows and enqueues the next stage on approve.
* **Rationale & Recommendation:** Give tables at DDL level for the M1 tables now, and for M2 before M2 is planned. Name the stage orchestrator and define the relation from `stage_runs` to `jobs`.

### R2-M10. The PAT format and hashing are undefined - Severity: Major (M1)
* **Reviewer Lens:** `egm-implementation-readiness` (new)
* **Affected Scope:** design lines 289, 364-368.
* **Discrepancy Description:** The design does not give the PAT's entropy, encoding, prefix, displayed suffix, hash algorithm (SHA-256 or HMAC with a pepper), index or expiry policy. The capability link gets this level of detail (273-274); the PAT does not.
* **Rationale & Recommendation:** Specify it. For example: `mdf_pat_` plus 32 random bytes in base62, `sha256` hex stored under a unique index, the last 4 characters shown in the list, and no expiry unless one is set.

### R2-M11. The MCP server stack, protocol revision and CLI distribution are not chosen - Severity: Major (M1)
* **Reviewer Lens:** `egm-implementation-readiness` (new; overlaps first-round N1)
* **Affected Scope:** design lines 397-400, 415-416, 458-470.
* **Discrepancy Description:** Not chosen:
  * the MCP server library and version (for example `@modelcontextprotocol/sdk` in stateless Streamable HTTP mode inside a Next route handler, or `mcp-handler`);
  * the MCP protocol revision, which decides the auth discovery rules;
  * the OS credential-store library;
  * how the `mellodifai` binary is installed for Claude Code, and the `claude mcp add` snippet;
  * how `Idempotency-Key` applies to MCP tool calls, which carry no headers.
* **Rationale & Recommendation:** Fix each of these choices in 7.1, 7.2 and 7.4.

### R2-M12. The M1 remote exit test needs fake providers on the production instance - Severity: Major (M1)
* **Reviewer Lens:** `egm-implementation-readiness` (new)
* **Affected Scope:** design lines 245, 1064, 1278-1280, 1358-1359.
* **Discrepancy Description:** claude.ai can only reach the tunnelled production instance, which uses real providers. The stack with fake providers (45621) is never tunnelled, so the test cannot run as written. The env var that selects fakes is not named either.
* **Rationale & Recommendation:** Choose one option and write it into 5.2 and 21.3:
  * a temporary `staging.` ingress pointing at an e2e-stack Next instance;
  * a `fake_providers` flag per token, honoured only for admin test tokens;
  * real providers inside a stated cap.

### R2-M13. The Cloudflare Access, WAF and `cloudflared` setup has no owner or mechanism - Severity: Major (M1)
* **Reviewer Lens:** `egm-implementation-readiness`, `egm-zoom-out` (new)
* **Affected Scope:** design lines 245-247, 1420.
* **Discrepancy Description:** The design does not say:
  * how the Access list is "mirrored from `admin_allowlist`": by hand, or synced through the Cloudflare API, and if so where that API token lives;
  * who creates the Access apps, the bypass policies and the WAF rule;
  * whether `cloudflared` is managed locally or from the dashboard, or where its config and credentials files live.

  Remote users sign in twice (Access, then OTP), and the design does not acknowledge it.
* **Rationale & Recommendation:** Add exact settings or a script to section 22 and to M1 step 1. Alternatively, drop Access on the UI pages and rely on Supabase OTP plus the allowlist.

### R2-M14. There is no deploy or rollback procedure before M6 - Severity: Major (M1)
* **Reviewer Lens:** `egm-implementation-readiness` (carries M19)
* **Affected Scope:** design lines 230-235, 1135-1139, 1309-1310.
* **Discrepancy Description:** M1 turns the PC into a production service (services, `next start`, `cloudflared`). But "rollback with the deploy script" depends on `ops/deploy.ps1`, which is built in M6.
* **Rationale & Recommendation:** Move `ops/deploy.ps1` (pg_dump, build, restart, health check) into M1 step 1, so that every milestone's rollback line can actually be run.

### R2-M15. No scheduler is defined for time-based work - Severity: Major (M1 onward)
* **Reviewer Lens:** `egm-implementation-readiness` (new; carries part of M29)
* **Affected Scope:** design lines 409, 923, 931, 992-998, 1033, 1187-1189, 1228.
* **Discrepancy Description:** The queue is claim-based, and nothing runs the timed tasks:
  * reservation expiry after 30 min (M1);
  * the idempotency purge after 24 h (M1);
  * the daily kie reconciliation (M1);
  * the slot flip and missed-slot handling (M4);
  * the 06:00 analytics run (M4);
  * retention deletes and the audit-log and metrics purges.
* **Rationale & Recommendation:** Name one mechanism, either a worker scheduler loop that enqueues `cron_*` jobs from a table or `pg_cron`. List each task with its cadence and stage name.

### R2-M16. M1's public surface is larger than agent access needs - Severity: Major (M1, scope)
* **Reviewer Lens:** `egm-zoom-out` (new)
* **Affected Scope:** design lines 245-247, 253-274, 1342-1343, 1355 vs 1221.
* **Discrepancy Description:** OD2 needs remote MCP. It does not need the whole browser app on the internet. M1 still:
  * publishes `/rest/v1`, `/storage/v1` and `/realtime/v1` on `api.`, the largest attack surface in the design, and the one that turns R2-B1, R2-B2 and R2-M1 into internet-facing problems;
  * rewrites `/media` to stream, and flips the browser URL;
  * exposes `post.` (Postiz);
  * ships `/m/**`.
* **Rationale & Recommendation:**
  * Limit M1's public surface to `app.` for `/api/mcp`, `/.well-known/*`, `/oauth/consent` and the sign-in pages, plus `api.` for `/auth/v1/*`.
  * Move remote web UI exposure to a separate step after M1's exit test, and move `post.` and `/m/` to M4.
  * No safety property is lost.

### Majors - quality, cost and remake (M2-M3)

### R2-M17. The budget arithmetic does not hold - Severity: Major (M2, M3, M6)
* **Reviewer Lens:** `egm-design`, `egm-zoom-out` (carries M6, M7)
* **Affected Scope:** design lines 588, 656, 825-826, 937-951, 1012-1017, 1066-1067, 1112-1115, 1183.
* **Discrepancy Description:** Three problems:
  * **Visual jury.** Two vision judges over two rounds, on up to 24 frames at 768 px plus a contact sheet plus 3 thumbnails, is about 100 image inputs. That does not fit 0.01 USD. The 31/10 design estimated about 0.1 USD per Gemini pass. The visual jury has no 0 USD route, so when its allocation runs out it pauses with `cost_cap`, which would stop most Autopilot runs.
  * **Budget table.** It reaches 0.15 USD only by omitting the R5 writer call (0.01), the publish kit and metadata generation, and the thumbnail rounds.
  * **Loop evaluation.** 10 items x k = 3 x 3 arms is 90 scoring passes per hypothesis, about 1.35 USD at the design's own prices. That is above the 1 USD nightly cap, yet 14.2 promises 3 hypotheses.
* **Rationale & Recommendation:** Derive the allocations from per-token prices in the price book, including image token counts. Size the eval cap as a formula (hypotheses x items x k x arms), or reduce k or the number of arms.

### R2-M18. The free tier contradicts "juries always run in the app" - Severity: Major (M2)
* **Reviewer Lens:** `egm-implementation-readiness` (carries M16)
* **Affected Scope:** design lines 481-490, 494-500.
* **Discrepancy Description:** Juries always run in the app on the owner's paid OpenRouter key, and R2 vision costs 0.01 USD. "Local reasoning" names no engine. So a free-tier run either pauses at every jury or does not cost 0 USD.
* **Rationale & Recommendation:** Choose one. Either allow paid juries in the free tier, with a stated cap, or name a local judge model. Name the local reasoning engine or remove it.

### R2-M19. The inputs to the originality checks are not kept - Severity: Major (M2, M3)
* **Reviewer Lens:** `egm-design`, `egm-implementation-readiness` (carries B12)
* **Affected Scope:** design lines 550, 554-557, 787, 795-804, 1187-1189, 1211, 1217.
* **Discrepancy Description:** The source video and frames are deleted when R2 passes. But R3 needs the source word timestamps, and R8 compares source frames "at aligned timestamps". `remake_analyses` holds neither the transcript nor the timestamps, and `fingerprints` is keyed only on renders. The "literal machine translation" provider and the embedding model for the 0.55 section check are also unnamed.
* **Rationale & Recommendation:**
  * Compute the source fingerprints (pHash, DINOv2) and keep the transcript with word timestamps in R2. Store them, for example as `fingerprints.subject_kind = source`, before deleting the media.
  * Name the machine-translation provider and the embedding model.

### R2-M20. The 10.8 publish gate requires reports that idea songs and lyric videos cannot have - Severity: Major (M3)
* **Reviewer Lens:** `egm-design` (new)
* **Affected Scope:** design lines 851-855.
* **Discrepancy Description:** Every approval needs originality, visual-jury, distinctness and thumbnail reports. Idea songs and existing VBP lyric videos have no source, so the gate never passes, and the existing human flow would run on the override path.
* **Rationale & Recommendation:** Define the required reports for each kind of content: remake, idea song and lyric video.

### R2-M21. The lyric jury already stores its reports in `versions.lyric_jury`, and the design ignores that store - Severity: Major (M2)
* **Reviewer Lens:** `egm-codebase-details` (new)
* **Affected Scope:** design lines 356-357, 768-769, 1212. Code: `supabase/migrations/20261101000015_lyric_jury.sql:2`, written by `apps/worker/src/stages/draft-lyrics.ts` and read by `apps/web/lib/studio/clips.ts`.
* **Discrepancy Description:** The Autopilot RPCs read "the latest `jury_reports` row", but the existing pipeline writes `versions.lyric_jury`. The design says nothing about migrating that column.
* **Rationale & Recommendation:** State the migration path: dual-write, or move the data into `jury_reports` and drop the column.

### R2-M22. The existing publish path cannot carry a Short and conflicts with AC4 - Severity: Major (M4)
* **Reviewer Lens:** `egm-codebase-details` (carries B17)
* **Affected Scope:** design lines 81, 965-968, 992. Code:
  * `apps/worker/src/stages/publish.ts:12, 110, 119-138`
  * `apps/worker/src/db.ts:495-507`
  * `apps/worker/src/authorization.ts:70`
  * `supabase/migrations/20261031000005_pipeline_hardening.sql:91-93`
  * `C:/Users/Asus/Documents/suno-remake/publish/yt.py:20`
* **Discrepancy Description:** Four problems:
  * The publish stage always loads the master render and ignores `payload.render_id`.
  * Publications are looked up per version, latest row only, so a master and a Short on the same version cannot coexist.
  * The `scheduled` plus `publishAt` path still exists, which contradicts AC4.
  * `yt.py` hard-codes two OAuth scopes and keeps its token in the engine repo's `publish/.secrets`, so the four-scope consent needs changes there.
* **Rationale & Recommendation:**
  * Add the worker, db-layer and engine-repo changes to M4 with a file list.
  * Retire the `scheduled` privacy path.
  * State where the Google token lives.

### R2-M23. The GPU lease is not codeable as specified - Severity: Major (M2, M6)
* **Reviewer Lens:** `egm-implementation-readiness`, `egm-zoom-out` (carries B16)
* **Affected Scope:** design lines 516, 1064-1068, 1136, 1162-1171, 1205.
* **Discrepancy Description:** Four problems:
  * `claim_job` orders by a priority that has no column.
  * The lease expiry and heartbeat values are missing.
  * R2 is one job with two resource classes.
  * Loop evaluation runs on its own Supabase stack, so it can never claim or yield the production `gpu_lease`, yet the deploy script waits on that lease.
* **Rationale & Recommendation:**
  * Add `jobs.priority` and say who sets it.
  * Give the timing values.
  * Make the lease a host-level lock that both stacks can reach, or have the supervisor hold the production lease on the gate's behalf and pass yield requests through.

### R2-M24. The loop's deploy and revert lack an actor, credentials and a rule for thin data - Severity: Major (M6)
* **Reviewer Lens:** `egm-design` (carries B13)
* **Affected Scope:** design lines 1061, 1067-1068, 1128-1147.
* **Discrepancy Description:** The design does not state:
  * which role runs `ops/deploy.ps1` and the revert. The gate "never sees the production database", yet the deploy runs `pg_dump` and restarts services.
  * where `main` lives and who holds the push credential.
  * what happens when fewer than 3 runs occur in the 48 h watch, which is likely at about 2 remakes a day. As written, the merge then stays unverified, which fails open.
* **Rationale & Recommendation:**
  * The host supervisor runs deploy and revert and holds the only credentials (see R2-B4).
  * Extend the watch until N runs have occurred, and run synthetic canary jobs on fake providers every night so the monitor always has data.

### R2-M25. Remake defaults land in M5 but M2 needs them - Severity: Major (M2)
* **Reviewer Lens:** `egm-implementation-readiness`, `egm-zoom-out` (carries M12)
* **Affected Scope:** design lines 665-672, 1209, 1223.
* **Discrepancy Description:** `remake_defaults` ships in the M5 `autopilot` migration, but M2's `remake_start` stores a "defaults snapshot". The default "the source's language translated to Italian" is undefined when the source is already Italian.
* **Rationale & Recommendation:** Move the table to M2, or say that M2 uses hard-coded defaults plus per-call overrides. Define the default for Italian sources.

### R2-M26. The timeline block enum and the params schema for each block are still open - Severity: Major (M2)
* **Reviewer Lens:** `egm-implementation-readiness` (carries M11)
* **Affected Scope:** design lines 734, 1451-1455.
* **Discrepancy Description:** The timeline's component API is also its security boundary (B5), but the members of `block` and each block's params schema are left to the builder.
* **Rationale & Recommendation:** List the v1 blocks and their params schemas in 9.2, or in a named file that M2 creates first.

### R2-M27. The mapping from R2 to the music provider is missing, and "WER" is mislabelled - Severity: Major (M2)
* **Reviewer Lens:** `egm-design` (carries M27)
* **Affected Scope:** design lines 552-572, 828-831. Code: `C:/Users/Asus/Documents/suno-remake/tools/score_takes.py:5,110`.
* **Discrepancy Description:** kie's custom mode takes no BPM or duration, so the design does not say how AC11's "tempo within 5%" and "durations within 15%" are steered for kie Suno or ACE-Step. "WER at most 0.25 (the existing score_takes fidelity)" is wrong: `fidelity` is in-order token recall, not WER.
* **Rationale & Recommendation:** Specify the parameter mapping for each provider, and how a mismatch is detected and retried. Rename the metric, or define a real WER.

### Majors - scope, consistency and later milestones

### R2-M28. Goal 4's music order still contradicts the tier table - Severity: Major
* **Reviewer Lens:** `egm-zoom-out` (carries M5)
* **Affected Scope:** design lines 201-203 vs 486, 565-566, 869.
* **Discrepancy Description:** Goal 4 says music comes from the subscription first, then free local, then cheap APIs. The tier table, R4 and 11.2 instead make paid kie Suno the standard default and keep ACE-Step for the free tier only.
* **Rationale & Recommendation:** Reword Goal 4 to match the tier table.

### R2-M29. The design still restates feature-plan specs - Severity: Major
* **Reviewer Lens:** `egm-zoom-out` (carries M30)
* **Affected Scope:** design lines 11-16, 1019-1029, 1500-1546. Related: `docs/egm/v2-local-engines/feature-parity-plan.md:203-206`.
* **Discrepancy Description:** 12.5 re-specifies T19 and drops the plan's per-platform route choice ("Diretto / Postiz gratis / Blotato veloce", that is "Direct / free Postiz / fast Blotato"). Section 26 carries full UI specs: the karaoke screenshot description and the Riffusion items down to kie endpoint names.
* **Rationale & Recommendation:** Link to the plan for UI behaviour, as the header promises. Keep only the order and the milestone placements here.

### R2-M30. Analytics ingestion still has runtime gaps - Severity: Major (M4)
* **Reviewer Lens:** `egm-implementation-readiness` (carries M29)
* **Affected Scope:** design lines 957-959, 1027-1036, 1518-1519.
* **Discrepancy Description:** The design is missing:
  * the stage name;
  * where the worker stores the Google refresh token;
  * how "per thumbnail style" is recorded, since no column holds a thumbnail style.

  The reviewer also doubts that the YouTube Analytics API returns impressions and CTR per video. If it does not, 1518-1519 are undercut.
* **Rationale & Recommendation:** Fill in these items, and confirm the metric availability against the API docs before M4 is planned. The scheduler itself is R2-M15.

### R2-M31. Section 25 lets machines outside the owner's control act as workers with the service role, and ship loop code - Severity: Major (M8 constraint, to be written now)
* **Reviewer Lens:** `egm-design` (new)
* **Affected Scope:** design lines 291-292, 1471-1485.
* **Discrepancy Description:** Section 25 lets "a user's own computer" be a worker, while 6.1 gives workers the service role. Self-update from "the daily loop's channel" would ship loop-merged code automatically to machines outside the owner's PC. Custody of the release-signing key is undefined.
* **Rationale & Recommendation:** Add a portability rule now:
  * off the owner's PC, workers use per-worker scoped credentials and job-scoped storage URLs, never the service role;
  * the loop channel is limited to the owner's machines;
  * the signing key stays out of every loop and gate context.

### R2-M32. Connecting the existing YouTube stage waits until M4 for no reason - Severity: Major (value order)
* **Reviewer Lens:** `egm-zoom-out` (new)
* **Affected Scope:** design lines 29-31, 957-964, 1322, 1429.
* **Discrepancy Description:** Section 1 names the missing Google OAuth client as a main pain, and the publish stage already exists. Manual Copilot publishing with an explicit human click needs nothing from M2 or M3. The lock re-verification and the weeks-long audit are unknowns on the owner's side that decide M4's whole route, and today both start only after M3.
* **Rationale & Recommendation:**
  * Add an early parallel track: the owner creates the OAuth client with all four scopes, the existing stage is connected, the lock re-verification test is run, and the audit is submitted.
  * Keep the veto window, auto-scheduling, social routes and the hub in M4.

### R2-M33. M2 is oversized and carries work unrelated to remakes - Severity: Major (scope)
* **Reviewer Lens:** `egm-zoom-out` (new)
* **Affected Scope:** design lines 601, 863-865, 1366-1371, 1508-1511.
* **Discrepancy Description:** M2 holds R1-R5, R4b, R7, two schemas, `TimelineVideo`, the move of the kinetic lyrics out of the engine repo, the driver lease, the state machine, the GPU lease, retention, the golden set, the devil's advocate and LaBSE originality. It also carries:
  * 1080p previews, a section 26 item unrelated to remakes;
  * a direct Anthropic client. It is a speculative fallback, used only when OpenRouter fails.
* **Rationale & Recommendation:**
  * Split M2 into M2a, a remade song (R1-R4b, blueprint, originality, devil's advocate, state machine, Copilot), and M2b, the remade video (timeline, `TimelineVideo`, the kinetic-lyric move, R5, R7).
  * Move the preview change to a UI track and the Anthropic client to Later.

### R2-M34. Section 25's dual-shell rule doubles every ops script from M1 - Severity: Major (scope)
* **Reviewer Lens:** `egm-zoom-out` (new)
* **Affected Scope:** design lines 1135, 1494-1498.
* **Discrepancy Description:** "Every deploy and ops script in both PowerShell and POSIX shell" applies from M1, for a Debian server that does not exist yet. The POSIX versions will go untested and rot.
* **Rationale & Recommendation:** Write ops scripts once in TypeScript on Node, with thin wrappers for each OS's service manager, or defer the POSIX versions to M8. Keep the env-var roots.

### R2-M35. Later milestones name no runtime or tool for key components - Severity: Major (M2-M6 plannability)
* **Reviewer Lens:** `egm-implementation-readiness`, `egm-zoom-out` (new)
* **Affected Scope:** sections 8.4, 10.3, 10.4, 13.2, 21.4-21.8.
* **Discrepancy Description:** Unnamed or undefined, by milestone:
  * **M2:** the meaning-map schema; the LaBSE runtime (Python or Node); the Japanese mora and Chinese syllable counters; the list of kinetic-lyric components to move; the source of golden set v0.
  * **M3:** the OCR engine; the pHash and DINOv2 runtime; the scope of the web timeline editor (it is a single parenthesis).
  * **M5:** what starts an Autopilot run, and how "runs per day" is enforced.
  * **M6:** the proposer and gate images; the egress proxy; the secret scanner; the proposer runner ("gnhf or Claude Code headless", 1047-1051 and 1270); the procedure for moving production from `build/studio-ui` to `main` (AC13).
* **Rationale & Recommendation:** Name each of these in the relevant section before that milestone is planned. None of them blocks M1.

### Nits

1. **Customer cap.** The 0.10 USD cap admits one kie generation (about 0.06-0.07 USD), which contradicts "music only when the owner raises it". Set a kie credit cap of 0 for customers (306-307, 941). [design]
2. **`create` scope.** It is defined as "no paid call", yet `remake_start` under `create` triggers paid Groq and vision analysis (297, 439, 535, 547). [design]
3. **Remote detection.** It relies on the Host header. Use a dedicated listener port for `cloudflared` instead (366-367, 1303). [design]
4. **Distinctness.** It uses the mean cosine over the last 20 videos, which lets a near-copy of one video pass. Use the maximum (835-836). [design]
5. **Capability link lifetime.** The 72 h lifetime counts from creation and can lapse before a moved slot. Create the link at hand-off (273). [design]
6. **Blueprint fields.**
   * The free strings `visualizer`, `overlays.position`, `global.palette`, `key` and `timeSig` carry content derived from untrusted sources into the prompts. Use enums and length limits.
   * Add cross-field refinements (`endS > startS`, `sectionId` exists).
   * Define the contact-sheet tiling (536 vs 547, 696-717).
   [design, implementation-readiness]
7. **Gate failure at the slot.** A bundle whose gate fails at the slot "stays private" with no defined state or notification. Veto rights between the slot and a late publish are undefined (995-1002). [design]
8. **kie submit timeout.** State explicitly that a submit timeout is `ambiguous_spend` and is never retried (657 vs 660). [implementation-readiness]
9. **MCP Inspector.** "MCP Inspector passes" is not a mechanical check. Name the CLI command and the calls to make (1291, 1359). [implementation-readiness]
10. **Rate limits and idempotency.** The rate-limit window (fixed or sliding) and what counts as a "write" are undefined. So is idempotency with the same key but a different request hash, or with a request still in flight (370-374, 409-410). [implementation-readiness]
11. **ntfy.** The server (ntfy.sh or self-hosted), the env var for the topic, the sender component and the payload rules are missing (1236-1237). [implementation-readiness]
12. **Small M1 gaps.**
    * Which milestone the `post.` ingress belongs to.
    * The Settings tab routes.
    * The `/api/health` contents.
    * Whether flags are read per request or cached.
    * Whether `song_create` with only `create` is refused or creates without drafting (247, 426, 1302-1308, 1342).
    [implementation-readiness]
13. **`score_takes`.** It is presented as a job stage, but it is a function called inside `generate_song`, `import-audio.ts:66` and `local-engine.ts:570` (518, 1559). [codebase-details]
14. **`claim_job`.** It is cited from `20261031000002_queue.sql`, but the current definition is `20261101000018_library_reactions_trash.sql:30-42`, and 14.1 must extend that version (157-159). [codebase-details]
15. **New stages.**
    * A new stage also needs registration in `apps/worker/src/stages/index.ts` and a `STAGE_STATUS` entry (`status.ts:102-109`).
    * `art.ts:30` hard-sets `video_review`, so `visual_jury` cannot slot in after it unchanged (159-161, 526-527).
    [codebase-details]
16. **Heartbeat.** The "new" 30 s heartbeat would be a regression: `apps/worker/src/loop.ts:211-217` already heartbeats every job every 15 s (643-645). [codebase-details]
17. **Hard-coded paths and workspace.**
    * Section 3 omits existing hard-coded paths: `engine.ts:153-154` (TMP), `workspace.ts:15-16`, `comfy/config.ts:19-22`, `stems.ts:12`, `visualizer.ts:340`, `draft-lyrics.ts:179`.
    * `<root>/remakes/<id>` ignores the existing per-version workspace (155, 1191).
    [codebase-details]
18. **Loop allowlist paths.** Its preset paths do not exist. The presets live in `packages/shared/src/visualizer/viz-looks.ts` (1080-1081). [codebase-details]
19. **`test:db` pin.** It can reuse the guard in `apps/web/e2e/local-env.ts:5-6` (1069). [codebase-details]
20. **`enqueue_publish`.** It takes a render id, not a version (`20261031000006_web_flow.sql:95`; design 852). [codebase-details]
21. **Keepalive workflow.** `.github/workflows/keepalive.yml`, which keeps hosted Supabase alive, is not retired with the README rewrite (233). [codebase-details]
22. **Rendering reuse.**
    * Name the reuse for rendering `TimelineVideo`: `render.ts:95-106` and `visualizer.ts:334-341` with `packages/visualizer/scripts/render.mjs`.
    * `qa.ts:6` checks only the master, so the Short gets no QA (522, 9.3).
    [codebase-details]
23. **`publications.kind`.** It duplicates `renders.kind`, and `thumbnail_only` conflicts with `render_id NOT NULL` (`core.sql:104`; design 966). [codebase-details]
24. **RPC name.** Section 3 names `create_project`, but the create panel calls `create_song` (migrations 013, 016, 023, 024). [codebase-details]
25. **Section 28 accuracy.**
    * It claims "all 61 are resolved".
    * The M29 row cites 12.6 for the scopes, but they are in 12.1.
    * The M13 row cites 22 for the Nano Banana research, but it is in 11.3 and M3 (1585, 1612-1613, 1620, 1636-1637).
    [zoom-out]
26. **Rendering defects.** Line 344 starts with `> Agenti` and renders as a blockquote. The wrap at 679-681 is awkward. Lines 934 and 1354 run past 100 characters. [zoom-out]
27. **Golden set.** It has two sources of truth: the `golden_items` table and `eval/golden/manifest.json`. The gate cannot read production, so drop the table (1101, 1215). [zoom-out]
28. **`rate_counters`.** The Postgres table duplicates the existing `apps/web/lib/rate-limit.ts` for a single Next process (372-374, 1202). [zoom-out]
29. **`loop/main`.** The integration branch is redundant because the gate squashes and rebases onto `main` anyway (1132-1134). [zoom-out]
30. **"Segnala claim".** The "Segnala claim" ("report a claim") button that pauses Autopilot appears only in the risk table, with no milestone and no catalogue row (1253). [zoom-out]
31. **Sections 25-26.** They mix a wish-list (Tauri, RunPod, Hetzner, self-update, UI descriptions) with binding rules. Keep the rules and placements here, and move the rest (1466-1546). [zoom-out]
32. **Leftover references.**
    * `task-24-brief.md:18` still says `packages/remake`, a one-line fix worth doing now.
    * The "task-24 brief" (679) has no path in the glossary.
    * "Formatta con AI" (306) has no gloss.
    [zoom-out]
33. **Milestone scope is scattered.** It is spread over 21.x, the migration column in section 15, the flags in section 20, the owner actions in section 22 and the catalogue in 7.3, and these disagree in places. A single "M1 contents" checklist would help. [zoom-out]

## Readability

Zoom-out judged that the document is not hard to follow for a fresh builder: the headings, tables and glossary hold up. So no comprehension review was run. Its three weakest spots:

* milestone scope scattered across five sections (Nit 33);
* the conditional, layered auth in 6.3-6.4 (R2-M1, R2-M2);
* sections 25, 26 and 28 mixing binding rules with a wish-list and review bookkeeping.

## Can M1 be planned?

* **Design (`egm-design`):** No owner decision is needed. Every owner action has a fallback, and the remote half can wait for DNS. It is not yet safe to plan: R2-B1, R2-M1, R2-M2 and R2-M4 leave security choices to the builder.
* **Implementation readiness:** M1 is not plannable as written. A walk of M1 found 41 open items. About 25 need a written answer, and most are small. The substantive ones are R2-M1 to R2-M15. Grouped:
  * *Topology:* `cloudflared` mode and files; Access and WAF; the service wrapper and start order; the internal URL and cookie name; key generation and distribution; how `/media` reads objects and handles Range requests; `/api/health`; the M1 deploy and rollback.
  * *Identity and MCP auth:* the PAT format; `agent_tokens` DDL; the metadata URL and OAuth claim name, with fallbacks; the RFC 8707 test; how scopes are handled; consent and revocation calls; how `db_pre_request` is installed; how `require_scope` reads claims; the exact list of RPCs that are wrapped and the wrapping technique; Realtime and storage reads by tokens.
  * *Ledger:* price seeds and estimates; the per-user scope; `run_id` in M1; the RPCs that reserve and the worker stages that settle; propagation of `token_id` to child jobs; the scheduler; the Settings > Costi ("Costs") UI.
  * *Ops, API, MCP and CLI:* the ops module's context type and how errors map to the envelope and back to `ActionResult`; catalogue coverage and the M1 tool list; response schemas; the meaning of `publish` in M1; validation of audio uploads; how SSE is implemented; the MCP library and revision; idempotency over MCP; CLI packaging and the credential store; the skill's contents.
  * *Notifications, flags and tests:* ntfy; how flags are read and cached; rate-limit semantics; the remote exit test on fakes; the Inspector criterion; test file locations.
* **Codebase details:** M1 can be planned with corrections. Every existing file it names is real, and the extension points exist:
  * the proxy matcher (`proxy.ts:42-44`);
  * `runAction` revalidation (`run-action.ts:29-37`);
  * RPCs keyed on `auth.uid()`;
  * the disabled OAuth server block (`config.toml:368-372`).

  It first needs the `customer` role fix (R2-B2), the revoked `jobs` insert (R2-B1), the decisions on the signing key and the URL split (R2-M2, R2-M3), the full catalogue and the list of wrapped RPCs (R2-M7), and a file list that includes the worker (R2-M8).
* **Zoom-out:** On scope, M1 is ready to plan, with no Blockers. Its core is the smallest set that gives safe agent access with caps. First trim the public surface to what agents need (R2-M16), limit the CLI, skill and catalogue to the operations that exist in M1 (R2-M7), and decide whether ntfy belongs in M1.

### Plannability of each milestone (implementation readiness)

| Milestone | Plannable from the doc alone? | Main gaps |
| --- | --- | --- |
| M1 | No, but close | R2-B1, R2-B2, R2-M1 to R2-M16 |
| M2 | No | No file list or DDL, no stage orchestrator, the timeline block schema, `remake_defaults` timing, the meaning-map schema, LaBSE and syllable-counter runtimes, the list of kinetic components, the golden v0 source (R2-M9, R2-M25, R2-M26, R2-M35) |
| M3 | No | The OCR, pHash and DINOv2 runtimes; source fingerprints deleted too early; editor scope; route 2 sandbox; no file list (R2-B5, R2-M19, R2-M20, R2-M35) |
| M4 | Partly (section 12 is the strongest part) | The scheduler, the `publish_schedules` state enum, Postiz and Blotato API calls and auth, Google token storage, confirmation of analytics metrics, the Short publish path, file list (R2-M15, R2-M22, R2-M30) |
| M5 | Mostly, on top of M1-M4 | What starts Autopilot and the per-day limit, `autopilot_policies` DDL, how the success criterion is measured, the Autopilot scope rule (R2-M5) |
| M6 | No | Gate isolation and the merger split, gate threshold paths, the images, egress proxy, secret scanner and runner, the cross-stack GPU lease, the `main` cutover (R2-B3, R2-B4, R2-M23, R2-M24, R2-M35) |

## Verdict

M1 is not ready to plan yet. R2-B1 (direct `jobs` INSERTs and existing RPCs bypass the ledger, caps, roles and veto window) and R2-B2 (no user is ever a `customer`) must be fixed in the M1 migrations first. The M1 Majors (R2-M1 to R2-M16) then need written answers. A focused author revision can close all of them without new owner input.
