# Goldfish Review Report - Round 4, milestone M1 only

**Target:** `docs/superpowers/specs/2026-11-01-agentic-studio-design.md`, revision 4 (commit 7cf7728). Scope: M1 as defined in 21.2 (lines 2305-2384), plus the sections M1 draws on (3, 5, 6.1-6.9, 7, 11.5, 14.4, 15.1, 16, 17, 19, 20, 24). Line numbers below refer to revision 4.
**Prior round:** `docs/egm/agentic-studio/goldfish_review_round3_m1.md` (5 Blockers, 20 Majors, 9 Nits). The author's dispositions are in 28.0 (lines 2570-2612).
**Ground truth:** `supabase/migrations/*.sql` (24 files), `supabase/config.toml`, `supabase/seed.sql`, `supabase/tests`, `apps/web`, `apps/worker/src`, `packages/shared`, `pnpm-lock.yaml`, `.github/workflows/ci.yml`, and the engine repo's `tools/`. `apps/auth/` and `ops/` do not exist yet (both are listed as Create, which is correct).
**Fixed inputs:** the owner decisions in 2.1 were not reopened.

## Reviewer Status

| Reviewer | Instance | Focus | Status |
| --- | --- | --- | --- |
| `egm-implementation-readiness` | A | Can M1 be planned with no question back to the owner | completed |
| `egm-codebase-details` | A | Database: grants, policies, functions, roles, ledger DDL, Supabase behaviour | completed |
| `egm-codebase-details` | B | App, worker, auth service, tunnel, file lists | completed |
| `egm-design` | A | Trust boundaries and failure modes | completed |

The synthesizer checked these load-bearing claims against the design and the repo. All of them were confirmed:
- 6.3.4 step 4 (lines 569-570) sets only `request.jwt.claims`. The repo never redefines `auth.uid()`: all 174 occurrences in the migrations are calls.
- The function is `playlist_membership(p_versions uuid[])` (`20261101000019_playlists.sql:164`). The 6.3.2 grant on line 503 names `playlist_membership(uuid)`.
- For production, only the price book has a seeding path (line 1465, `ops/deploy.ts`). The `spend_caps` and `scheduled_tasks` defaults are only "seeds" (lines 2328-2329).
- Next, the edge proxy and `apps/auth` all run as `mdf-web` (lines 279-281). The ACL protects only `apps/worker/.env.local` and `<runtime root>/secrets/`. The signing key is copied into `supabase/signing_keys.json` inside the checkout (lines 346-348).
- The sign-in email template hard-codes `https://app.mellodifai.com/auth/confirm` (lines 369-371), and `emailRedirectTo` is built "from the public origin" (line 378).
- The secret-name regex `/(?:KEY|TOKEN|SECRET|...)/i` (`apps/worker/src/secrets.ts:9-10`) matches `MELLODIFAI_NO_KEYFILES`.
- `pnpm-lock.yaml:1047` resolves `@modelcontextprotocol/server@2.4.0`, but 21.2 line 2363 names `@modelcontextprotocol/sdk`.
- `config.toml:276,278`: the session `timebox` and `inactivity_timeout` are commented out.
- `claim_reservation` returns "the oldest reserved, unclaimed entry" (lines 1524-1525). Expiry releases every reserved entry unless the state is `submitting` (lines 1577-1579).

## Severity counts (after deduplication)

| Severity | Count |
| --- | --- |
| Blocker | 8 |
| Major | 35 |
| Nit | 24 |

## Answers to the three questions

**(1) Are the five round-3 Blockers truly closed?**

Section 28.0 says "5 of 5 Blockers fixed". That claim does not hold.

| Id | Verdict | Reason |
| --- | --- | --- |
| R3-B1 (`mdf_ops` bypass) | **Partly closed** | **Closed:**<br>- No `public` function is granted to `mdf_web` or `mdf_auth`.<br>- The blanket revoke is in place.<br>- `fake_providers` comes from the token row.<br>- The `set_config('request.jwt.claims')` attack on direct `public` calls is tested.<br>**Still open:**<br>- An `mdf_web` holder can pre-set the legacy `request.jwt.claim.sub`, which `auth.uid()` reads first, and so make any wrapped RPC act on another user's rows (Blocker 2).<br>- Session actors are trusted on Next's word (Major 5).<br>- The OS-level split is not real (Blocker 5). |
| R3-B2 (deny by default) | **Partly closed** | **Works:** the `anon` and `authenticated` lines in schema `public` reverse Supabase's per-schema grants.<br>**Does not work:** the `from public` lines on 493 and 496 are no-ops. A per-schema REVOKE cannot remove the built-in global PUBLIC EXECUTE on functions.<br>**Why M1 is still safe:** the explicit per-object revokes (15.1) and the ACL test.<br>**Gaps in that backstop:** the ACL test cannot see column grants, which is exactly where earlier leaks lived (Majors 1-2). |
| R3-B3 (customer kie cap) | **Closed in schema, open in production** | **On paper:**<br>- The key `(scope, key, provider, unit, period)` and the `default:customer` rows work.<br>- The trace holds: kie 12 > 0 gives MDF02, and `song_create` matches only the `''`/usd rows.<br>**In production:**<br>- The cap rows exist only as seeds, and production never runs the seed.<br>- `reserve_spend` with no matching rows succeeds, so customers can spend kie (Blocker 3).<br>- The user fallback is all-or-nothing (Major 6). |
| R3-B4 (reservation lifecycle) | **Not closed** | **Fixed:** wall-clock expiry, the fake-job exemption, grandfathering, and settle by entry id.<br>**Not workable:** the per-call claim model cannot run the existing stages. Expiry also releases real kie spend after every successful generation (Blocker 1). |
| R3-B5 (token reads and uploads) | **Closed in mechanism, Major residue** | **Reads:**<br>- Named `ops` read functions with owner filters exist.<br>- No reviewer found a way for a token to read another user's rows through them.<br>**Residue:**<br>- The frozen shapes do not match the schema (Major 20).<br>- The upload path is chosen (Next staging, `ops.upload_intent`, then `ingest_uploads`), but the contract still needs guesses (Major 21).<br>- The write outputs and HTTP paths are left to "the M1 plan" (Major 22). |

**Other 28.0 overclaims:**
- Major 5 (its fix creates Blocker 1).
- Major 10 (the failure path is missing, Major 23).
- Major 19 (holds only at database level, Blocker 5).
- Major 20 (the password change covers only `postgres`, Blocker 8).
- Nit 7 ("customers hold no tokens" is contradicted by 6.4, Major 13).

**(2) Can a builder write a task-by-task M1 plan without asking the owner?**

**No.**
- **What can be planned:** the structure (steps, most of the DDL, roles, the ACL test, the read functions, the error table).
- **What is wrong as written:** the eight Blockers. Each one either ships a hole or does not work as written. Blocker 5 also needs an owner action: a second Windows account, or an accepted risk.
- **What the builder would still have to guess:** the 35 Majors. The main ones:
  - the claim and settle model per job (Blocker 1);
  - the price-missing and fallback rules (Majors 6-7);
  - the read-shape sources (Major 20);
  - the upload contract (Major 21);
  - the write outputs, HTTP paths and accepted credentials per route (Major 22);
  - the idempotency failure path (Major 23);
  - the scheduler task bodies (Major 34);
  - the Settings pages (Major 35);
  - the oidc-provider wiring (Major 25);
  - how CI and e2e pass (Major 31);
  - the step order that keeps the repo green (Major 33).

**(3) Did revision 4 introduce new M1 Blockers?**

**Yes.** All eight Blockers are in text that revision 4 wrote while fixing round 3:

| Blocker | Revision-4 text it comes from |
| --- | --- |
| 1 | The claim, settle and expiry text (the R3-B4 and Major 5 fixes) |
| 2 | The 6.3.4 wrapper text |
| 3 | The cap table and its seed placement (the R3-B3 fix) |
| 4 | The key rotation flow (the Major 9 fix) |
| 5 | The role split (the Major 19 fix) |
| 6 | Server-side sign-in (the Major 12 fix) |
| 7 | The consent flow (the Majors 18-19 fixes) |
| 8 | The mandatory password (the Major 20 fix) |

**Contradictions inside revision 4:**
- "customers have no tokens" (lines 442-443, 2376) against "`create` available to everyone" at consent (line 697);
- `create` defined as "no paid call" (line 435) against the Groq reservations of `take_pick`, `video_make` and `song_import` (lines 888, 891, 900);
- `admin_remote_close` "works remotely" (lines 440-441) against no tunnelled Settings page and `runAction` refusing remote calls (lines 319-325);
- "granted to nobody" (lines 511-513) against `service_role`'s grants;
- `apps/auth` runs as `mdf-web` but must read `<runtime root>/secrets/auth/jwks.json`, which `mdf-web` cannot read (lines 279, 676).

**Done-when items that cannot pass, or that pass while the design is broken:**
- "a new allowlisted user ... cannot be given tokens" cannot pass (Majors 13 and 15).
- The reservation-path test never claims or settles, so it passes with Blocker 1 present.
- `--to <the commit that adds ops_scopes>` lands on a step-2 commit whose app calls revoked RPCs (Major 33).
- The probe of 5.3 passes while other superuser logins keep the default password (Blocker 8).

## Prioritized Findings (Blockers -> Major -> Nits)

### Blocker 1. The reservation claim and settle model cannot run the existing stages, and expiry erases real spend (R3-B4 not closed)
* **Reviewer Lens:** all four (implementation-readiness A, codebase-details A and B, design A)
* **Affected Scope:** 11.5 lines 1524-1525, 1543, 1551-1566, 1573-1583; 19 lines 2218-2222; 21.2 line 2370
* **Discrepancy Description**:
  - **One entry, many calls.** `claim_reservation(job, provider)` hands out "the oldest reserved, unclaimed entry". `paid.ts` claims an entry per call and settles it after the call. But the existing stages make several keyed calls per job:
    - `generate_song` runs `tools/kie.mjs` `credit`, `job`, `generate`, `wait` and `lyrics-ts` twice (`generate-song.ts:108, 211, 242, 287-297, 313-318`);
    - `replace_section` calls `credits()`, `upload()`, `createTask()`, `wait()` and `download()` (`replace-section.ts:143-216`);
    - `source-audio.ts:122-133` calls `credits()` and `upload()`;
    - `draft_lyrics` makes one Jev call, up to 5 writer calls and three parallel judges per round (`lyric-jury.ts:100-110, 376-393`; `draft-lyrics.ts:163, 239-271`).

    After the first claim, every later call gets `no_reservation`. Because `judge()` swallows errors (`lyric-jury.ts:385-391`), the lyric jury then silently fails open on every real song.
  - **Resumes are refused.** A resume with `kie_task_id` set reserves "Groq only" (line 1543), but `wait` and `lyrics-ts` still need `KIE_API_KEY` through `secretEnv`, so `engine.run` refuses them. This breaks:
    - "Retry checks again for free" (`generate-song.ts:309-310`);
    - the charged resume of `resolve_kie_submission` (`20261031000009_final_fixes.sql:42-45`).
  - **Retries are refused.** `retryLater`, a graceful stop and `requeue_stale` re-run the same job id (`db.ts:360-379`, `loop.ts:300-307, 368-373`). The job's entry is already `claimed_at`, so the re-run gets `no_reservation`.
  - **The balance refresh has no job** (`main.ts:124-141`), so it can never carry an entry.
  - **Nothing settles a subprocess call.** Only `paid.ts` HTTP calls settle (line 1556).
  - **Expiry erases real spend.** `expire_reservations` releases every `reserved` entry of a finished job unless `kie_submit_state = 'submitting'`. A successful submit leaves the state `submitted` (`generate-song.ts:278`). So every completed kie generation is subtracted from the counters again, and the 120 credits/day and USD caps then bound only concurrent reservations, not daily totals.
  - **No M1 test sees any of this.** The test in 19 only reserves, fails and expires. e2e runs with `WORKER_FAKE=1`.
* **Rationale & Recommendation**:
  - Claim once per job and provider (and model for OpenRouter). Bind the entry to the job, and let the same job re-attach to it on any later attempt.
  - Pass that entry to every key-bearing call in the stage. List the keyed calls that spend nothing (`credit`, `job`, `wait`, `lyrics-ts`, `upload`, download, record-info, the balance refresh); they carry the key without an entry.
  - Settle kie at submit acceptance, in the transaction that writes `kie_task_id`.
  - In expiry:
    - treat a claimed but unsettled entry as spent at the estimate;
    - release only unclaimed entries;
    - read the right submit-state table for each stage (see Major 9).
  - Add Jev to the `draft_lyrics` estimate.
  - Add a worker integration test that runs real stage code against fake kie and OpenRouter HTTP servers, covering claim, crash, requeue, resume and settle, and checks the counters after the job ends.

### Blocker 2. Any `mdf_web` holder can make a wrapped RPC act as another user through `request.jwt.claim.sub`
* **Reviewer Lens:** codebase-details A
* **Affected Scope:** 6.3.4 step 4 (lines 569-575); 17 line 2171; 6.3.7 exit tests (lines 652-654)
* **Discrepancy Description**:
  - **How Supabase resolves the user.** Supabase's `auth.uid()` is `coalesce(nullif(current_setting('request.jwt.claim.sub', true), ''), (current_setting('request.jwt.claims', true)::jsonb ->> 'sub'))::uuid`. The legacy per-claim setting wins.
  - **What the wrapper does.** It sets only `request.jwt.claims`.
  - **Why that matters.** Every wrapped RPC keys on `auth.uid()`, either through `web_version` (`20261101000018_library_reactions_trash.sql:22`) or inline (`023:124`, `final_fixes.sql:39`).
  - **The attack.** The `mdf_web` connection runs `set_config('request.jwt.claim.sub', '<victim>', false)`, then calls, for example, `ops.song_trash` or `ops.stage_retry` with its own valid `p_ctx`. The wrapper authorises the attacker, and the RPC acts on the victim's rows.
  - **Reservations are skipped too.** Paid jobs created this way get no reservation, because the job finder filters by `owner_id = <actor>`.
  - **No test covers it.** The 6.3.7 tests cover only direct `public` calls.
* **Rationale & Recommendation**:
  - In every wrapper, set `request.jwt.claim.sub`, `request.jwt.claim.role` and `request.jwt.claims` locally.
  - Then assert `auth.uid() = actor` before calling the RPC.
  - Add an exit test: pre-set `claim.sub` to another user, call `ops.song_rename` on that user's version, and expect `not_found`.

### Blocker 3. The cap defaults exist only as seed data, and `reserve_spend` fails open when no cap row matches
* **Reviewer Lens:** codebase-details A (Blocker), implementation-readiness A (Major)
* **Affected Scope:** 21.2 lines 2328-2329; 11.5 lines 1465, 1481-1495, 1510-1518; 20 lines 2266-2274
* **Discrepancy Description**:
  - **Production never seeds.** `seed.sql` runs only on `db reset` (`config.toml:67-72`). Production is updated with `supabase migration up --db-url`.
  - **Only the price book has a production path** (`ops/deploy.ts`, line 1465). The `spend_caps` and `scheduled_tasks` defaults do not, and the deploy steps (lines 2266-2274) seed nothing.
  - **The result is a hole.** With no `default:customer` rows, a customer has no user caps. With no global rows, `reserve_spend` matches nothing and succeeds. A customer can then spend kie in production, which is exactly what R3-B3 forbids.
* **Rationale & Recommendation**:
  - Insert the cap defaults and the scheduler tasks in the `spend_ledger` and `notifications` migrations, not the seed.
  - Make `reserve_spend` raise an MDF code when the global cap rows are missing.

### Blocker 4. The Supabase signing key sits in the checkout that the internet-facing account runs from
* **Reviewer Lens:** codebase-details B
* **Affected Scope:** 5.3 item 1 (lines 345-348); 5.1 line 279; 17 line 2171
* **Discrepancy Description**:
  - **Where the key goes.** The rotation script copies the ES256 private key to `supabase/signing_keys.json` inside the repo checkout, because `config.toml` resolves `signing_keys_path` relative to `supabase/` (`config.toml:170`).
  - **Who can read it.** Next, the edge proxy and `apps/auth` all run as `mdf-web` from that checkout, and the stated ACL covers only `apps/worker/.env.local` and `<runtime root>/secrets/`.
  - **The consequence.** A compromised Next or `apps/auth` can read the key, sign a `service_role` JWT and bypass the whole ops layer. That defeats AC14, the rotation exit test, and the claim in section 17 that Next has "no signing key".
* **Rationale & Recommendation**:
  - Keep the only copy under `<runtime root>/secrets/supabase/` and point `signing_keys_path` there, if the step 0 spike shows an absolute path works.
  - Otherwise, ACL `supabase/signing_keys.json` to the owner's account only, and state it.
  - Also state which folder each service runs from, and what `mdf-web` can read there.

### Blocker 5. The `mdf_web`/`mdf_auth` split has no effect at the OS level, and `apps/auth` cannot read its own keys as specified
* **Reviewer Lens:** design A (Blocker), codebase-details B (Major)
* **Affected Scope:** 5.1 lines 279-281; 6.4 lines 676-687; 17 lines 2171-2172; AC14
* **Discrepancy Description**:
  - **The design contradicts itself.** `apps/auth` runs as `mdf-web`, but its ID-token keys live in `<runtime root>/secrets/auth/jwks.json`, which `mdf-web` "cannot read". As written, the service cannot start.
  - **The shared account undoes the role split.** Code execution in `apps/auth` (internet-facing, built on the third-party `oidc-provider`) can read:
    - `apps/web/.env.local`, which holds `MDF_WEB_DATABASE_URL` and the OpenRouter and Groq keys that spend outside the ledger;
    - the signing key (Blocker 4).

    It can also replace the edge proxy on port 3080, then drop `x-mdf-remote` and capture the admin's cookies at `/consent`. Combined with Major 5, that is full local admin.
  - **`mdf_auth` alone can mint tokens.** `ops.oauth_upsert('AccessToken', ...)` accepts any `grant_id` and any hash the caller chose. So `mdf_auth` can mint working access tokens for every live grant, for its full 90 days.
  - **The threat model is wrong.** Section 17 rates a compromised `apps/auth` "low / medium, cannot act for users". 28.0 marks round-3 Major 19 fixed.
* **Rationale & Recommendation**:
  - **Owner action (section 22):** separate Windows accounts for `apps/auth` and for the edge proxy, each able to read only its own env file and key folder. If the owner declines, record the accepted risk.
  - Make `ops.oauth_upsert` for access and refresh tokens check that:
    - the `grant_id` maps to a live, unrevoked `agent_tokens` row;
    - the expiry is at most the configured TTL;
    - the scopes are a subset of the grant's scopes.
  - Rewrite rows 2171-2172 of section 17 to state the real blast radius.

### Blocker 6. Sign-in links are hard-wired to the public host, which breaks local sign-in, e2e and CI
* **Reviewer Lens:** codebase-details B
* **Affected Scope:** 5.3 items 3-4 (lines 366-371); 5.4 lines 376-385; 19 lines 2245-2254
* **Discrepancy Description**:
  - **The design.** The email template links to `https://app.mellodifai.com/auth/confirm?...`, and `emailRedirectTo` is built "from the public origin".
  - **Local sign-in breaks.** When the owner signs in at `127.0.0.1:3000`, the link travels through the tunnel. It is therefore a remote request, so the cookie lands on `app.mellodifai.com` and `next` falls back to `/consent`. The local UI never gets a session. Before the DNS move (W1 and the prerequisite in 5.1), the link does not resolve at all.
  - **Redirects for local requests are unstated.** `redirect-url.ts:13-37` falls back to `NEXT_PUBLIC_SITE_URL` for non-dev hosts, and the design never names that variable.
  - **e2e breaks.** `e2e/support.ts:88-103` follows the first Mailpit link and expects `/create` on `127.0.0.1:3210`, which is not in `additional_redirect_urls`.
  - **Production settings leak.** The shared `config.toml` carries the production SMTP, site URL and template settings into CI and e2e.
  - **Pieces are missing.** The template file is in no Create list, and its `next=...` is unspecified.
* **Rationale & Recommendation**:
  - Build the template from `{{ .RedirectTo }}` plus `token_hash` and `type`.
  - Build `emailRedirectTo` per request: the local origin for local requests, the public origin for remote ones.
  - State the `redirect-url.ts` rule.
  - Keep production-only auth settings out of the e2e and CI config, through `env()` substitution or an override in `ops/e2e-stack.ts`.
  - Add `supabase/templates/<name>.html` as Create.

### Blocker 7. A consent decision is keyed by `uid` only and is not bound to the browser that started the flow
* **Reviewer Lens:** codebase-details B
* **Affected Scope:** 6.4 lines 688-703; 17
* **Discrepancy Description**:
  - **The design.** `/consent?uid=X` records the decision in the database. Any browser that holds the oidc-provider interaction cookie for `X` can then call `/oauth/interaction/X/resume`, and `apps/auth` reads the decision with `ops.oauth_interaction_result(uid)`.
  - **The attack.**
    1. An attacker registers a client named "Claude" with an allowlisted `http://127.0.0.1:<port>` redirect.
    2. He starts the flow in his own browser, which receives the interaction cookie.
    3. He sends the owner the consent link.
    4. The owner signs in and consents. The resume fails in the owner's browser, which has no cookie.
    5. The attacker resumes in his own browser and receives the authorization code for the owner's account.
  - **The owner is an admin, so the token can carry `spend`.** This contradicts lines 686-687 ("at worst issue tokens for consents that users actually gave").
* **Rationale & Recommendation**:
  - `ops.oauth_consent` returns a single-use nonce (stored hashed) that the consenting browser carries to `/resume`.
  - `apps/auth` accepts the decision only with both the interaction cookie and the nonce.
  - Restrict clients that use localhost redirects to local consent only.

### Blocker 8. The mandatory password change rotates only `postgres`, so the other Supabase login roles keep the well-known default
* **Reviewer Lens:** codebase-details A
* **Affected Scope:** 5.3 item 2 (lines 359-365); 5.2 lines 339-341; 21.2 line 2374
* **Discrepancy Description**:
  - **What the image does.** On the CLI's local stack, the Supabase Postgres image sets the passwords of `supabase_admin` (a superuser), `authenticator`, `supabase_auth_admin`, `supabase_storage_admin` and other service roles from the same POSTGRES_PASSWORD (`postgres`). This is Supabase image behaviour, not in the repo; confirm it in spike 2.
  - **What the design does.** It changes only `postgres`, and the probe tests only `postgres`, `mdf_web` and `mdf_auth`.
  - **The result.** The M1 exit probe passes while a container can still log in as a superuser at `host.docker.internal:54322`. The design itself says the firewall is not relied on against containers (line 340).
  - **A side effect.** Rotating those roles also breaks the service containers whose database URLs embed the default password.
* **Rationale & Recommendation**:
  - In spike 2, choose one:
    - make 54322 unreachable from the Docker networks (a binding or published-port rule, proven by the probe); or
    - rotate every login role and re-template the service containers.
  - Extend the probe to `supabase_admin`, `authenticator` and `supabase_auth_admin`.

---

### Major 1. Deny by default for PUBLIC is a no-op (R3-B2 residue)
* **Reviewer Lens:** all four
* **Affected Scope:** 6.3.2 lines 490-498; 15.1 lines 1935-1939
* **Discrepancy Description**:
  - PostgreSQL documents that a per-schema `ALTER DEFAULT PRIVILEGES ... REVOKE` only reverses a per-schema GRANT. EXECUTE-to-PUBLIC on functions is a global default, so the `from public` parts of lines 493 and 496 do nothing.
  - Every new `ops` function is therefore executable by both `mdf_web` and `mdf_auth`, which have USAGE on `ops`, unless it is revoked one by one. For example, `mdf_web` could call `ops.oauth_upsert`, and `mdf_auth` could call `ops.admin_*`.
  - The comment on line 492 is false.
* **Rationale & Recommendation**:
  - Add the global form `alter default privileges for role postgres revoke execute on functions from public;` (no `in schema`).
  - Correct the comment.
  - Keep the explicit revokes and the ACL test as the backstop.

### Major 2. The ACL test is blind to column grants, other schemas and PG17 role memberships
* **Reviewer Lens:** implementation-readiness A, codebase-details A, design A
* **Affected Scope:** 6.3.3 lines 536-546
* **Discrepancy Description**:
  - **Column grants.** `has_table_privilege` reports table-level privileges only. The surviving leaks are column grants (`20261031000005_pipeline_hardening.sql:23-26`).
  - **Other schemas.** Only `public` and `ops` are checked, yet both new roles inherit PUBLIC grants in every other schema they can use.
  - **Role memberships.** On PG17 (`config.toml:41`), the creating role is auto-granted ADMIN on the roles it creates. `pg_roles` shows no memberships at all, so the membership assertion is untestable as written.
* **Rationale & Recommendation**:
  - Add `has_any_column_privilege` (or `information_schema.column_privileges`) for all five roles.
  - Check schema USAGE for `mdf_web` and `mdf_auth` in every non-system schema.
  - Snapshot the `storage.objects` policies.
  - Assert memberships from `pg_auth_members`.

### Major 3. `service_role` keeps EXECUTE on every mutating RPC, against "granted to nobody"
* **Reviewer Lens:** implementation-readiness A, codebase-details A
* **Affected Scope:** 6.3.2 lines 501, 509-513
* **Discrepancy Description**:
  - The revoke on line 501 excludes `service_role`. `final_fixes.sql:102` grants `generate_again`, `back_to_lyrics`, `resolve_kie_submission` and `resolve_upload` to `service_role`, and Supabase's defaults grant it every function.
  - This is not a new hole, since the service key already bypasses RLS. But a test written literally as "granted to nobody" fails.
* **Rationale & Recommendation**: say whether the migration revokes these grants from `service_role` or `acl-allowlist.json` lists them.

### Major 4. The 6.3.2 re-grant block contradicts the repo
* **Reviewer Lens:** codebase-details A (Blocker), implementation-readiness A (Nit)
* **Affected Scope:** 6.3.2 lines 502-508
* **Discrepancy Description**:
  - **Wrong signature.** `public.playlist_membership(uuid)` does not exist; the function is `playlist_membership(uuid[])` (`019:164`). The literal grant aborts the migration.
  - **False premise.** No `create policy` in the repo calls a `public` function: policies use only `auth.uid()`, `storage.foldername` and subqueries. The five example functions are called only from security-definer RPCs.
  - **Harmful example.** `owned_playlist`, `audio_upload_ok` and `rewrite_allowed_status` are already revoked from `authenticated` (`019:171`, `023:446-447`). Following the example would re-grant storage-existence oracles such as `visualizer_asset_ok`.
* **Rationale & Recommendation**:
  - Write the correct signature.
  - State that the set of policy functions is empty today, so the re-grant is just the six read RPCs.
  - Rated Major, not Blocker, because the migration fails loudly on first run.

### Major 5. Session actors are trusted on Next's word, and sessions never expire
* **Reviewer Lens:** design A, codebase-details A and B, implementation-readiness A
* **Affected Scope:** 6.3.4 lines 556-566; 6.2 lines 440-441; 17 line 2171
* **Discrepancy Description**:
  - **What the wrapper checks.** Only that an `auth.sessions` row exists for the given `session_id`, with `not_after` null.
  - **Why that is weak.**
    - With `timebox` and `inactivity_timeout` commented out (`config.toml:276,278`), `not_after` stays null forever.
    - `remote` and `actor_kind` are `p_ctx` values that Next writes itself.
    - The session id is not a secret: it is in every access token's claims.
  - **The result.** Anyone with `MDF_WEB_DATABASE_URL` plus one admin session id has permanent "local" admin. They can raise caps, create `spend` PATs and call `admin_confirm_publication(public)`.
  - **API detail.** `getUser()` does not return `session_id`; `getClaims()` does (auth-js 2.118.0).
  - **Grant detail.** Whether the definer can read `auth.sessions` is unverified.
* **Rationale & Recommendation**:
  - Require a recent `refreshed_at` (within `jwt_expiry`).
  - Set a session timebox and an inactivity timeout.
  - Add a step-up code for `admin_caps_set`, `admin_token_create` and `admin_confirm_publication`.
  - Enforce `token.remote` and the `remote_mcp` flag inside the database.
  - Name `getClaims()`.
  - Have spike 2 confirm the `auth.sessions` read.
  - Correct section 17.

### Major 6. The user cap fallback is all-or-nothing
* **Reviewer Lens:** implementation-readiness A, codebase-details A, design A
* **Affected Scope:** 11.5 lines 1493-1495
* **Discrepancy Description**: a single per-user row (for example, raising one customer's kie cap) makes every `default:customer` row stop applying. That customer silently loses the 0.10 USD/day cap, or the kie=0 cap.
* **Rationale & Recommendation**: apply the fallback per `(provider, unit, period)`, or have `ops.admin_caps_set` copy the default rows on the first override.

### Major 7. Price lookup and estimates are undefined, and the 0.10 USD exit test may not be passable
* **Reviewer Lens:** implementation-readiness A, codebase-details A
* **Affected Scope:** 11.5 lines 1465-1471, 1505-1518, 1542-1543; 6.3.7 lines 659-660
* **Discrepancy Description**:
  - **A missing price fails open.** A missing `(provider, model, unit)` price, for example a kie model id against the seeded `model = ''` row, gives a null usd. `used + null > limit` never raises.
  - **The `draft_lyrics` estimate is unspecified.** It omits Jev, and the writer strength is chosen at run time. Nothing shows that one language stays under 0.10 USD.
  - **Claims cannot tell OpenRouter models apart.** `claim_reservation` takes no model.
  - **Groq's "expected length" has no source.**
  - **The credits are defined twice.** `KIE_CREDITS` already exists in `packages/shared/src/rewrite.ts:32-37`.
* **Rationale & Recommendation**:
  - Look up the exact model first, then `''`, and raise an MDF code when no price exists.
  - Give the `provider_operations` seed rows, reserving for the strong writer as the worst case.
  - Claim by `(job, provider, model)`.
  - Seed the credits from `KIE_CREDITS`.
  - Pin a test price row for the exit test.

### Major 8. Settle and release adjust counters by re-deriving them, not by what was reserved
* **Reviewer Lens:** codebase-details A
* **Affected Scope:** 11.5 lines 1497-1501, 1519-1522; 15.1 lines 2053-2064
* **Discrepancy Description**: `ledger_entries` stores no counter keys or windows. A settle after midnight (Europe/Rome), or after the caps change, adjusts different counters than the reservation charged, so the counters drift.
* **Rationale & Recommendation**: persist the charged `(scope, key, provider, unit, period, window_start, amount)` per entry, in a child table or as jsonb.

### Major 9. Expiry and cancel use the wrong state for section edits and release spent entries
* **Reviewer Lens:** codebase-details A, implementation-readiness A, design A
* **Affected Scope:** 11.5 lines 1576-1583
* **Discrepancy Description**:
  - **Wrong table for section edits.** `replace_section` keeps its submit state in `section_edits.kie_submit_state` (`023:63-64`), not in `versions`, so an unknown submit is released instead of marked `ambiguous`. A retried `replace_section` whose `kie_task_id` is set also reserves again.
  - **Cancel releases spent entries.** `ops.job_cancel` releases unconditionally, even for claimed entries after a requeue.
  - **A race with the admin.** If the admin resolves a submission within the 5-minute task interval, the state changes and the task then releases the entry, so `admin_resolve_kie_submission` finds nothing to resolve.
* **Rationale & Recommendation**:
  - Mark an entry ambiguous synchronously when the worker fails a kie stage.
  - Read the correct state table for each stage.
  - Apply the same rule in `job_cancel`.

### Major 10. Web-side spend escapes the counters
* **Reviewer Lens:** design A, codebase-details A
* **Affected Scope:** 11.5 lines 1531-1534, 1580; 7.2 line 850
* **Discrepancy Description**:
  - A web-side entry is released after 10 minutes even when Next died after the provider call, so money is spent but not counted.
  - `ops.settle_spend` and `ops.style_format_reserve` trust caller-supplied amounts. A negative `p_usd` lowers the shared counters.
* **Rationale & Recommendation**:
  - Settle stale web-side entries at the estimate instead of releasing them.
  - Bound actual amounts to between 0 and k times the estimate.
  - Compute estimates from `provider_operations`.

### Major 11. The token cap row is written only for PATs
* **Reviewer Lens:** codebase-details A
* **Affected Scope:** 6.6 line 752; 11.5 line 1490; 6.4 lines 699-700
* **Discrepancy Description**: `ops.oauth_consent` writes no `spend_caps` row, so an admin OAuth grant with `spend` is bound only by the global caps. A missing token row fails open.
* **Rationale & Recommendation**:
  - Write the row in `oauth_consent` too.
  - Refuse a token actor that has no token cap row.

### Major 12. The job finder misses reused rows, and `test_mode` tokens can touch real versions
* **Reviewer Lens:** codebase-details A, design A
* **Affected Scope:** 6.3.4 lines 571-575; 6.9 lines 792-795
* **Discrepancy Description**:
  - **Reused rows are not found.** `created_at = now()` is safe for new rows, but `request_stems` reuses a failed or cancelled row without touching `created_at` (`020:45-51`), and `request_visualizer` keeps the old `created_at` (`022:121-127`). Those jobs get no `token_id` and no `fake_providers`, so a `test_mode` stems retry runs on real engines. That breaks the done-when.
  - **Only one direction is refused.** Real tokens are refused on test versions, but `test_mode` tokens are not refused on real versions.
* **Rationale & Recommendation**:
  - Stamp `token_id`, `run_id` and `fake_providers` from a transaction-local setting in a `before insert or update` trigger on `jobs`, or have the RPCs return their job ids.
  - Refuse `test_mode` actors on versions where `test_run = false`.

### Major 13. Customers can obtain OAuth tokens, against "customers have no tokens" and the done-when
* **Reviewer Lens:** all four
* **Affected Scope:** 6.2 lines 442-443; 6.4 lines 696-699; 21.2 line 2376
* **Discrepancy Description**: consent offers `create` "to everyone", so a customer who completes an OAuth flow gets an `agent_tokens` row. Nothing says `ops.admin_token_create` refuses a customer owner. The done-when "cannot be given tokens" fails.
* **Rationale & Recommendation**:
  - In M1, `ops.oauth_consent` and `admin_token_create` refuse non-admin owners.
  - Add an exit test.

### Major 14. `create` scope reaches paid Groq spend
* **Reviewer Lens:** all four
* **Affected Scope:** 6.2 lines 435-437; 7.3 lines 888, 891, 900
* **Discrepancy Description**: `create` means "no paid call", yet `take_pick`, `video_make`, `video_rerender` and `song_import` reserve Groq under `create`.
* **Rationale & Recommendation**: either require `spend` for these operations, or define bounded incidental Groq spend inside `create`.

### Major 15. Nothing in M1 can create the auth user for a newly allowlisted person
* **Reviewer Lens:** codebase-details A
* **Affected Scope:** 6.2; 6.3.6 (`admin_allowlist_add`); 21.2 line 2376
* **Discrepancy Description**:
  - Sign-in never creates users: `enable_signup = false` (`config.toml:177`) and `shouldCreateUser: false` (`login-form.tsx:40`).
  - Only `admin.createUser` with the service key creates them (`e2e/global-setup.ts:19`), and Next has no service key.
  - So an allowlisted person can never sign in, and the done-when cannot be met in production.
* **Rationale & Recommendation**: define the path, for example a service-role worker task that creates the user after `admin_allowlist_add`, or a stated owner action in Studio.

### Major 16. The token view and three new tables need grants and policies the design does not give
* **Reviewer Lens:** codebase-details A, implementation-readiness A
* **Affected Scope:** 15.1 lines 1936-1937, 1980-1983, 2044, 2051, 2114
* **Discrepancy Description**:
  - **The token view.** `agent_tokens_public` with `security_invoker = true` needs SELECT on `agent_tokens` itself. A table-level grant would expose `token_hash` over PostgREST.
  - **The new tables.** `price_book`, `provider_operations` and `app_flags` have RLS on and "select granted", but no policy, so they return zero rows.
* **Rationale & Recommendation**:
  - Use a column-level `grant select (id, owner_id, kind, ...)` plus a "read own" policy.
  - State the `using (true)` policies for the three tables.

### Major 17. `oauth_store.payload` keeps live token values in clear
* **Reviewer Lens:** codebase-details A
* **Affected Scope:** 6.4 lines 680-687; 15.1 (`oauth_store`)
* **Discrepancy Description**: oidc-provider's adapter payload for AccessToken, RefreshToken and AuthorizationCode includes `jti`, which is the opaque token value. Hashing only `id_hash` leaves live tokens readable by `service_role` and in the `pg_dump` backups.
* **Rationale & Recommendation**: strip or hash `jti` before upsert, and confirm in the spike.

### Major 18. The error map sends ownership failures to `conflict`
* **Reviewer Lens:** implementation-readiness A, codebase-details A
* **Affected Scope:** 6.3.5 lines 581-612; 7.3 line 929
* **Discrepancy Description**:
  - **Ownership failures land on rule 6.** `owned version required`, `owned render required`, `owned rewrite required`, `uploaded audio required`, `source take required`, `failed job required` and `current take required` reach rule 6 and become 409. The frozen meaning of "not the actor's" is `not_found`.
  - **The error test is not specified.** It needs a call graph (`web_version` raises transitively), and none is given.
  - **`JobStatus.error_code` has no mapping.** It must be a 6.3.5 code, but `jobs.error` is free text, and no mapping is named.
* **Rationale & Recommendation**:
  - Add an explicit `owned % required` rule mapping to `not_found`.
  - Name the mapping from worker errors to codes.
  - Define how the test enumerates the messages.

### Major 19. Creating the roles in a migration is not reset-safe
* **Reviewer Lens:** codebase-details A
* **Affected Scope:** 6.3.1 lines 477-479
* **Discrepancy Description**: roles are cluster-global. A plain `create role` can fail on the next `supabase db reset` if the cluster survives. Verify against the pinned CLI.
* **Rationale & Recommendation**: guard role creation with an existence check, or use `supabase/roles.sql`.

### Major 20. The frozen read shapes do not match the schema
* **Reviewer Lens:** implementation-readiness A, codebase-details B
* **Affected Scope:** 7.3 lines 921-932; 7.2 line 852
* **Discrepancy Description**:
  - **`JobEvent` and `JobStatus`.**
    - `job_events` has `level`, not `kind`.
    - `progress` there is 0-100, while `JobStatus.progress` is 0-1.
    - `jobs` has no progress column (`queue.sql:28-37`).
  - **`SongSummary` fields have no stated source:**
    - `title`: the lyric pack title or `projects.topic`;
    - `engine`: project settings or `takes.engine`;
    - `duration_s`: `takes` has no duration column;
    - `take_count`: all generations or only the current one.
  - **Lists, cursors and `CostsSummary`.**
    - Whether trashed versions are listed is unstated.
    - `cost_usd` is undefined.
    - `CostsSummary.from` and `to` have no inputs.
    - No sort key exists for the opaque cursors.
* **Rationale & Recommendation**: because v1 is additive-only, give every field its source column and transform now.

### Major 21. The upload contract still needs guesses (R3-B5 residue)
* **Reviewer Lens:** implementation-readiness A, codebase-details B, design A
* **Affected Scope:** 7.2 lines 857-868; 15.1 lines 2025-2035; 9.4 lines 1290-1292; 6.7 lines 759-761
* **Discrepancy Description**:
  - **Contract gaps.**
    - `ops.upload_intent(p_ctx, kind, filename, size, sha256)` has no staging-name argument, yet `staging_name` is NOT NULL, and it is unclear which side picks the uuid.
    - The bucket is not named; it must be `uploads` (`023:86-105`).
    - There is no claim function for the worker.
    - Whether the worker checks the sha256 is not stated.
    - Groq cannot be sized for `import_audio`, because there is no `duration_s`.
    - The `song_create` upload source (`023:424-425`) has no `upload_id` route.
    - `image` has no M1 consumer and no storage path.
  - **Size limits disagree:** 100 MB for token uploads, `AUDIO_UPLOAD_LIMIT` of 50 MB (`song-source.ts:104`), 20 MB of base64 over MCP, a 4 MiB transport default (Major 24), and Cloudflare's 100 MB body limit.
  - **Cleanup is missing** for refused, partial and orphaned files, for `upload_intents` rows, and for `ready` objects that are never imported.
  - **Abuse and contradictions.**
    - Next streams up to 100 MB to disk before the credential is checked.
    - There is no per-IP limit on `/api/*` and no staging quota.
    - `ffprobe` parses internet bytes under the owner's account.
    - The worker has read-only access to staging but must delete files.
* **Rationale & Recommendation**:
  - Resolve the credential and create the intent first, then stream into that intent's staging name under the limit.
  - Add `p_staging_name` and `duration_s`.
  - Name the bucket.
  - Drop `image` from M1.
  - Align the size limits.
  - Add a purge task, a staged-bytes quota and per-IP edge limits.
  - Remux audio to a canonical file.

### Major 22. Write outputs, HTTP paths and accepted credentials are delegated to the plan, under a frozen v1
* **Reviewer Lens:** implementation-readiness A, design A
* **Affected Scope:** 7.2 lines 833-835, 872-873; 7.3 line 645; 5.2
* **Discrepancy Description**:
  - **About 40 items are left to the plan.** "HTTP paths ... are listed in the M1 plan" and "shapes are in `packages/shared/src/ops/`" leave about 40 signatures and every path to the builder.
  - **Outputs are missing.** Only job-starting operations have an output. `playlist_create`, `section_edit_request`, `song_import`, `notifications_read` and the admin functions have none.
  - **Read inputs are open:** filters, sort, and the date range of `costs_get`.
  - **Accepted credentials are unstated.** Neither route says whether it accepts cookies or OAuth tokens. Accepting cookies would let a remote cookie session reach every non-admin operation, against AC15.
* **Rationale & Recommendation**:
  - Add a table of path, input and output.
  - Accept bearer tokens only on `/api/v1` and `/api/mcp`, and say whether `/api/v1` accepts OAuth tokens.

### Major 23. The idempotency failure path is undefined
* **Reviewer Lens:** implementation-readiness A, design A
* **Affected Scope:** 6.3.4 lines 567-568; 7.2 lines 838-846
* **Discrepancy Description**:
  - When the savepoint fails and the wrapper returns `ok: false`, the key's fate is unstated (`done` with the error, deleted, or left `in_flight`). If it stays `in_flight`, a validation error blocks the key for 10 minutes.
  - `request_hash` is not defined.
  - The database does not require a key for token actors on operations that enqueue or spend.
* **Rationale & Recommendation**: specify the key's fate on failure, define `request_hash` (canonical JSON of the inputs), and require a key where it matters.

### Major 24. The MCP SDK has the wrong package name and a 4 MiB body limit
* **Reviewer Lens:** codebase-details B
* **Affected Scope:** 7.1 lines 816-824; 7.2 line 858; 21.2 line 2363
* **Discrepancy Description**:
  - `pnpm-lock.yaml:1047` already resolves `@modelcontextprotocol/server@2.4.0`, the split v2 SDK. It exports `WebStandardStreamableHTTPServerTransport` with `sessionIdGenerator` and `enableJsonResponse`.
  - That transport defaults `maxRequestBodySize` to 4194304, so a 20 MB base64 upload gets 413.
  - The stateless examples create a server and transport per request, which the design does not say.
* **Rationale & Recommendation**: name the pinned `@modelcontextprotocol/server`, set `maxRequestBodySize`, and state per-request instances.

### Major 25. The oidc-provider wiring is not stated
* **Reviewer Lens:** codebase-details B, design A
* **Affected Scope:** 6.4 lines 669-675, 701; 5.2 line 310
* **Discrepancy Description**:
  - **Discovery paths.** With issuer `https://app.mellodifai.com/oauth`, the library serves `/oauth/.well-known/openid-configuration`, not RFC 8414's `/.well-known/oauth-authorization-server/oauth`. `apps/auth` must serve the RFC path itself. The `/.well-known/openid-configuration/oauth` variant is not allowlisted.
  - **Token prefixes.** No supported option is known for the `mdf_oat_`/`mdf_ort_` opaque prefixes.
  - **Resume route.** `/oauth/interaction/<uid>/resume` is not a library route, so `interactions.url` and the cookie path must cover it.
  - **Proxy setting.** `proxy: true` is needed behind the edge proxy.
* **Rationale & Recommendation**: settle these four points in the step 0 spike and write them into 6.4.

### Major 26. Key plumbing for `MELLODIFAI_NO_KEYFILES` and `PAID_SECRET_NAMES` is wrong in the details
* **Reviewer Lens:** codebase-details B, implementation-readiness A
* **Affected Scope:** 11.5 lines 1557-1568; 21.2 line 2358
* **Discrepancy Description**:
  - **The flag is stripped from children.** `MELLODIFAI_NO_KEYFILES` matches the secret-name regex (`secrets.ts:9-10`). `loadSecrets` and `childEnvironment` would strip it from every child, so the fallbacks stay live without any error.
  - **No kie call passes `secretEnv` today.** `kie.mjs` falls back to `KIE_ENV` or `C:/Users/Asus/Documents/Claude/Projects/ita/.env` (`suno-remake/tools/kie.mjs:16-24`), not to "the engine repo's `.env`". `KIE_ENV` must be refused too.
  - **The call map is incomplete.**
    - `timing.ts:44` runs `tools/workspace_pipeline.sh`, not `score_takes`.
    - `generate-song.ts:352` is an unlisted `scoreTakes` caller.
    - The engine-repo scripts that read key files are not fully listed.
  - **The static scan has gaps.**
    - `LYRICS_OPENROUTER_KEY` (`draft-lyrics.ts:202`) is missing from `PAID_SECRET_NAMES`.
    - The scan will flag the existing `context.secrets.values.*_KEY` reads (`source-audio.ts:112`, `replace-section.ts:136`, `score-takes.ts:69-70`).
* **Rationale & Recommendation**:
  - Set the flag in `engine.ts` after `childEnvironment`, with a test that a child sees it.
  - Refuse `KIE_ENV`.
  - Correct the call map and the engine-repo file list.
  - Complete `PAID_SECRET_NAMES`.
  - Move the key reads into `providers/`.

### Major 27. Next-side provider calls ignore `test_mode`
* **Reviewer Lens:** implementation-readiness A
* **Affected Scope:** 6.9 lines 780-783; 7.3 lines 904-905; 19 lines 2214-2217
* **Discrepancy Description**: `style_format` and `audio_transcribe` run in Next, so a `test_mode` token makes real OpenRouter and Groq calls and writes ledger entries. That contradicts "fake providers only" (line 429).
* **Rationale & Recommendation**: Next refuses or fakes these calls for `test_mode` tokens.

### Major 28. The kill switch cannot be reached remotely, and the `remote_mcp` flag is not enforced in the database
* **Reviewer Lens:** codebase-details B, design A, implementation-readiness A
* **Affected Scope:** 6.2 lines 440-441; 5.2 lines 309, 319-325; 20 line 2260
* **Discrepancy Description**:
  - **The switch has no remote route.** `admin_remote_close` lives in Settings > Agenti. No Settings page is tunnelled, and `runAction` refuses remote calls.
  - **The flag lives only in Next.** It is checked in Next's 10 s cache, not in `ops.oauth_consent` or `resolve_access_token`, so new consents keep working after the switch is closed.
  - **Enablement is circular.** The flag may be enabled only after "M1 exit tests pass", but the claude.ai exit test needs the flag on.
* **Rationale & Recommendation**:
  - Document the Cloudflare dashboard route removal as the remote kill, or add a bearer-callable close operation.
  - Enforce the flag in the database.
  - Fix the enablement order.

### Major 29. Remote detection: the dev server and Docker containers count as local
* **Reviewer Lens:** codebase-details B, design A
* **Affected Scope:** 5.1 lines 287-289; 5.2 lines 337-341
* **Discrepancy Description**:
  - **The dev server.** `next dev` (`apps/web/package.json:7`) binds all interfaces on port 3001, which is not in the firewall rule, and it loads the same env file.
  - **Containers.** Under Docker Desktop, `host.docker.internal` reaches host loopback, so Supabase containers today and Postiz from M4 pass as "local". That satisfies local-only PATs and the local admin rule.
* **Rationale & Recommendation**:
  - Run `next dev -H 127.0.0.1`.
  - Add a probe from a container to ports 3000 and 3010.
  - If the probe connects, make "local only" a property of the token, not of the network.

### Major 30. Consent phishing through an attacker-registered client is not mitigated
* **Reviewer Lens:** design A
* **Affected Scope:** 6.4 lines 688-703; 17
* **Discrepancy Description**: an attacker starts a real claude.ai or ChatGPT connector flow (the redirect host is on the allowlist) with a client name he chose, and sends the authorize URL to the owner. Typing the client name does not tell the clients apart. Section 17 has no row for this.
* **Rationale & Recommendation**:
  - Show the registration time on the consent page.
  - Accept registrations only inside a short pairing window that the admin opens.
  - Add a row to section 17.

### Major 31. CI and e2e cannot pass as written
* **Reviewer Lens:** codebase-details B, implementation-readiness A
* **Affected Scope:** 19 lines 2245-2254; 21.2 line 2354
* **Discrepancy Description**:
  - **The e2e guard.** `ci.yml:47-57` uses port 54321, and `e2e/local-env.ts:23-26` refuses it unless `E2E_ALLOW_LIVE_STACK=1`. The `CI=true` exception covers only `test:db`.
  - **Mailpit.** `support.ts:10` defaults Mailpit to 45624, while CI's Mailpit is on 54324.
  - **Missing environment.** `playwright.config.ts:28-33` passes only `NEXT_PUBLIC_*`, not `SUPABASE_INTERNAL_URL` or `MDF_WEB_DATABASE_URL`. Neither that file nor `support.ts` is in the Modify list.
  - **Fake jobs reserve real caps.** With `WORKER_FAKE=1` but `fake_providers = false`, e2e cookie jobs reserve real caps and can hit `cap_exceeded`.
* **Rationale & Recommendation**:
  - State the CI flags and ports.
  - Add both files to the Modify list.
  - Exempt the e2e stack from caps or seed generous ones.

### Major 32. Files, workspaces and the CLI install are incomplete
* **Reviewer Lens:** implementation-readiness A, codebase-details B
* **Affected Scope:** 21.2 lines 2348-2364; 7.4 line 945; 5.1 line 291
* **Discrepancy Description**:
  - **Broken imports.** `apps/worker/test/rewrite.test.ts:20` and `songs-from-songs.test.ts:13` import the deleted `kie/client.ts`.
  - **Tooling not wired.**
    - The root `tsconfig.json:3-8` references are missing, so the new packages are never typechecked.
    - `ops/` is not in `pnpm-workspace.yaml` and has no `package.json`.
    - `supabase/tests` has no `postgres` dependency.
  - **The CLI does not install.** `npm install -g ./packages/cli` fails on `workspace:^` dependencies.
  - **Files missing from Create or Modify:**
    - the email template;
    - `packages/shared/src/i18n.ts` (the existing key prefix is `error.`);
    - `lib/action-result.ts`;
    - the sidebar and settings navigation;
    - `app/(app)/credits/page.tsx`, which overlaps Settings > Costi;
    - `apps/worker/src/stages/utils.ts`;
    - `apps/worker/src/storage.ts`;
    - the image library.
  - **Running TypeScript with Node.** On engines `>=22.12`, "run with Node" may need `tsx`.
* **Rationale & Recommendation**:
  - Complete the lists.
  - State bundle-then-install (or `pnpm pack`) for the CLI.
  - Give `ops/` its own workspace package.

### Major 33. Step order breaks the repo between steps, and the rollback floor is unusable
* **Reviewer Lens:** implementation-readiness A, design A
* **Affected Scope:** 21.2 lines 2326-2339, 2378-2379; 20 lines 2266-2282
* **Discrepancy Description**:
  - **The middle of M1 is broken.** Step 2's `ops_scopes` revokes every RPC that the UI and the roughly 240 direct `.rpc(` test calls use. Server actions move only in step 4, and the tests have no step. Every commit in between is a broken app with a red `test:db`.
  - **The rollback floor is unusable.** `--to <the commit that adds ops_scopes>` lands on that broken commit, yet still passes `ops.health()`.
  - **Deploys run alongside the old worker.** "Wait for idle" does not stop the worker during migrations, so the old worker inserts unreserved jobs and makes unmetered calls.
  - **No restore is documented** for the `pg_dump`.
* **Rationale & Recommendation**:
  - Land the revokes together with the server-action move and the test rewrite, or create the `ops` functions first and revoke last.
  - Make the floor a tagged release.
  - Stop the worker and Next before migrating.
  - Add a smoke write to the health check.
  - Document the restore.

### Major 34. Scheduler task bodies and child-job reservation failures are unnamed
* **Reviewer Lens:** implementation-readiness A, codebase-details A, design A
* **Affected Scope:** 14.4 lines 1903-1915; 11.5 lines 1576-1580; 19 lines 2218-2222; 6.9 lines 784-788
* **Discrepancy Description**:
  - **Where the tasks run is ambiguous.** The database test calls `expire_reservations` directly, but 14.4 runs tasks "in process" in the worker.
  - **The SQL functions are not named:** the `purge_*` functions and `expire_reservations`, with their grants.
  - **Cap refusals for child jobs are unhandled.** What `worker_enqueue` does when the child's reservation hits a cap is unstated.
* **Rationale & Recommendation**:
  - Name each task's SQL function and its grant to `service_role`.
  - State the parent's failure code when a child's reservation is refused.

### Major 35. The Settings pages and the consent payload are only named
* **Reviewer Lens:** implementation-readiness A
* **Affected Scope:** 21.2 lines 2342, 2353; 6.4 lines 695-697
* **Discrepancy Description**:
  - Settings > Agenti and Settings > Costi have no fields, lists, confirmations or `ActionResult` behaviour.
  - How `/consent` parses the oidc-provider Interaction and Client payloads for `oauth_consent_info` is undefined.
* **Rationale & Recommendation**: give each page's contents and the consent-info output shape.

### Nits
1. **`audit_log` and expiry details** (15.1 line 2016):
   - `audit_log.owner_id not null` cannot record `unauthorized` calls that have no resolvable owner.
   - A deleted job and a web-side entry both have `job_id = null`, so `expire_reservations` cannot tell them apart.
   - Settling an already released entry is undefined.
2. **Wrong table** (6.3.4 line 573): `test_run` is a `versions` column, not a `jobs` column.
3. **`claim_scheduled_task`** (14.4 lines 1903-1905):
   - it does not check `running_by` or `started_at`, so a slow `ingest_uploads` can be claimed twice;
   - `finish_scheduled_task` takes no worker id;
   - DST handling for `daily_at` in Europe/Rome is unstated.
4. **Deadlocks** (11.5 line 1512): the `on conflict do nothing` insert should also run in the fixed sort order.
5. **Trashed songs** (11.5 lines 1574-1575): queued jobs of trashed songs are never claimed (`018:37`), so their reservations hold the counters.
6. **Old overload** (6.3.2): drop the old `resolve_kie_submission(uuid, text)` overload (`007:52-75`).
7. **Line references:**
   - the projects INSERT grant is `core.sql:237`, not 236;
   - `local-engine.ts:569` is the correct line (section 3 says 570);
   - the only enqueue caller is `loop.ts:322`, and `db.ts:161` and `db.ts:680` also need changes.
8. **Test plumbing** (19, 21.2):
   - `queue.test.ts` holds service-role worker RPC calls, not `authenticated` ones;
   - the new tests need a pg client and database URLs in the `test:db` setup.
9. **Grant binding** (6.4): `ops.oauth_bind_grant` should bind once, only where `grant_id` is null.
10. **Rate limit** (6.7 line 757): "any non-GET is a write" puts every `/api/mcp` call, including `job_status` polling, under the 10/min write limit.
11. **Action wrapping test** (5.2 lines 319-325):
    - the glob `app/actions/**` matches `schemas.ts` and tests, so scan `"use server"` modules instead;
    - `formatStyle` returns `FormatResult` and bypasses `runAction`;
    - multipart `$ACTION_ID_` posts carry no `Next-Action` header, so the `runAction` refusal is the real control.
12. **Remote login assets** (5.2 line 309): `/_next/image` and `/favicon.ico` are not allowlisted, so the logo breaks on remote `/login` and `/consent`.
13. **Per-email limit** (6.7 lines 760-761): enforce it in the action, not by parsing action payloads in the edge proxy.
14. **Inspector over stdio** (19 lines 2223-2225): Inspector's stdio mode takes a command. Over stdio a revoked token is a JSON-RPC error, not a 401.
15. **Next key precedence** (7.5 lines 956-959): state the precedence of `LYRICS_OPENROUTER_KEY` (`openrouter-key.ts:3`) and `LYRICS_MODEL_FAST` (`format-style.ts:38`) for Next's own keys.
16. **`/api/health` and proxy limits** (5.6):
    - remote callers see the version, schema and queue depth; return only `web: ok` remotely;
    - `proxy.ts` buffers 10 MB and silently truncates larger bodies, which already affects `/api/transcribe` (25 MB).
17. **File ACLs and large uploads** (7.4 lines 941-943): user-only ACLs need `icacls`. A 20 MB base64 tool argument is impractical for remote clients, so let the CLI read local paths.
18. **Owner role reset** (6.2): `admin_role_set` to admin is silently undone by `set-owner.ts` at every deploy.
19. **Upload reuse** (7.3): `song_import` should check upload ownership and allow single use.
20. **Enumeration** (5.4): `sendSignInLink` should answer the same for allowlisted and other emails.
21. **Worker-down alert** (16): no watchdog reports a stale worker, because the worker is the only sender of notifications. Put one in `ops/services.ts` or Next.
22. **Tunnel drift** (5.2, 19): the smoke test runs once. Have `ops/services.ts` compare the ingress with the template at start.
23. **Scope relief** (design A): the gates move, `/media` streaming, Settings > Costi, the SSE progress route and image uploads do not serve agent access. Consider deferring them to M2a or W1.
24. **Signing-key fallback** (5.1 line 279): the fallback "Next runs as the owner's account" voids every `mdf-web` ACL claim. Say so in 17.

## Verdict

**M1 ready to plan: no.**

Revision 4 fixes the shape of all five round-3 Blockers. Two of them (R3-B4 and the production half of R3-B3) are not closed. The fixes also introduce eight Blockers: one is a full ledger redesign (Blocker 1), and the other seven are local fixes. Blocker 5 also needs an owner action (separate Windows accounts) or an accepted risk.

Fixing the eight Blockers, together with Majors 1, 5, 6, 7, 13, 14, 20, 21, 22, 23 and 33, should make M1 plannable task by task.
