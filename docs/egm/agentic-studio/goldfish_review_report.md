# Goldfish Review Report

**Target:** `docs/superpowers/specs/2026-11-01-agentic-studio-design.md` (`1-267`)

Supporting material read by reviewers: `docs/egm/v2-local-engines/feature-parity-plan.md`, `docs/superpowers/specs/2026-10-31-mellodifai-design.md`, and the code under `apps/`, `packages/` and `supabase/`.

Owner decisions treated as final and not re-argued: remakes keep timing, structure and mood with same-meaning new lyrics; local (CLI + stdio MCP) and remote (Streamable HTTP MCP) access in the same milestone; auto-scheduled publishing with a veto window; a fully autonomous daily loop including code merges; image order Midjourney via kie.ai -> GPT Image via codex -> Nano Banana -> OpenRouter. Every fix below is meant to make these decisions work. None of them reverses a decision.

## Reviewer Status

| Reviewer | Status |
| --- | --- |
| `design` | completed |
| `comprehension` | completed |
| `zoom-out` | completed |
| `codebase-details` | completed |
| `implementation-readiness` | completed |
| `structural` | completed |
| `style` | not requested (the comprehension lens covered the ambiguities that could cause a wrong build) |

## Summary

| Severity | Count |
| --- | --- |
| Blocker | 17 |
| Major | 31 |
| Nit | 13 |

**Verdict:** a builder cannot plan from this document yet. The intent is clear and all five owner decisions can be made to work. Four kinds of gap stand in the way:
- **Security boundaries:** the tunnel, the autonomous loop, remote MCP and agent-authored code.
- **Milestone order:** money, publishing and Autopilot ship before the caps and the visual jury that guard them.
- **Missing contracts:** data model, state machine, operations catalogue, blueprint schema, thresholds.
- **Wrong assumptions about the existing code:** auth model, RPC identity, publishing already built, the devil's advocate.

**Synthesizer spot-checks** (I confirmed these in the repo myself):
- There is no devil's advocate code in `apps/` or `packages/`.
- `combine()` in `apps/worker/src/stages/lyric-jury.ts:333-344` returns `passed: true` when no judge returns a valid verdict.
- `.git/HEAD` is on `refs/heads/build/studio-ui`.
- In `supabase/config.toml`, `signing_keys_path` is commented out (line 170), `site_url` is `http://127.0.0.1:3000` (line 160), and `[auth.oauth_server]` exists at line 368.
- The RPCs in `20261031000006_web_flow.sql` key on `auth.uid()`.
- `apps/web/app/media/[...path]/route.ts:14-27` signs as the session user, returns 404 without a session, and redirects to Supabase storage.

**Dropped finding:** one reviewer said the workspace is not a git repository. The codebase-details reviewer refuted this: a `.git` folder exists, the remote is `github.com/stefandsl/mellodifai-app`, and worktrees are registered under `E:/mellodifai/wt/`. I dropped it.

**Reviewer-reported, not verified by me:** `C:\Users\Asus\Documents\suno-remake\publish\README.md:42` says Google lifted the private-only lock for unaudited projects in October 2026. Check this before building around the lock (B17).

---

## Prioritized Findings (Blockers -> Major -> Nits)

## Blockers

### B1. The tunnel exposes undefined services, and local Supabase runs on well-known demo keys - Severity: Blocker
* **Reviewer Lens:** `design`, `codebase-details`, `implementation-readiness`
* **Affected Scope:** Lines 35, 136-142, 240 (sections 2, 5, 10)
* **Discrepancy Description:** The doc tunnels "the app" on the PC to a public hostname. The UI also talks to Supabase directly:
  - storage uploads: `lib/studio/audio-files.ts`, `visualizer/upload.ts`;
  - Realtime: `use-job-progress.ts`, `use-live-refresh.ts`;
  - `/media`, which redirects to a Supabase signed URL on `127.0.0.1:54321`.

  So either the Supabase gateway is exposed too, or the remote UI and media break. The local stack has no `signing_keys_path`, so the default JWT secret and the well-known anon and service_role keys are in use. Exposing 54321 with them lets anyone forge a service_role JWT.

  Other gaps:
  - Nothing lists what must stay private: Studio 54323, Postgres 54322, the mail catcher, ComfyUI (no auth), the Postiz admin on 4007.
  - Cloudflare Tunnel and Tailscale Funnel (`*.ts.net`) give different issuer and redirect hosts, so the OAuth configuration forks.
  - The doc contradicts the README and the 31/10 design (Vercel web plus hosted Supabase) without saying which topology wins.
* **Rationale & Recommendation:** Add a "Deployment topology" section that:
  - Picks one production topology and retires the other in writing.
  - Picks one tunnel provider.
  - Lists each public hostname and its upstream (for example `app.`, `mcp.`, `media.mellodifai.com`), the exposed routes (`/api/v1/*`, `/api/mcp`, `/.well-known/oauth-*`, the OAuth endpoints, the media capability route) and a deny-all default.
  - Rotates the Supabase signing keys before any exposure (asymmetric keys, new anon and service keys).
  - Either proxies storage and Realtime through Next or puts Supabase on its own hostname behind WAF rules.
  - Updates `site_url`, `additional_redirect_urls` and `external_url` in `config.toml`.
  - Sets Postiz `DISABLE_REGISTRATION`.
  - Defines where Cloudflare Access applies, with bypass rules for MCP, OAuth and media callbacks.

### B2. The autonomous loop's rails have no enforcer, and the loop can improve its score by weakening the jury - Severity: Blocker
* **Reviewer Lens:** `design`, `zoom-out`, `structural`, `implementation-readiness`
* **Affected Scope:** Lines 216-231 (section 9)
* **Discrepancy Description:** The rails say what the loop "never edits", but if the same agent writes the change, runs the checks and merges, every rail is only advisory. The list also misses many ways to weaken the gates without touching the named files:
  - deleting or `.skip`-ing tests (only assertions are protected);
  - relaxing `biome.json`, `tsconfig`, test config or `package.json` scripts;
  - adding dependencies, which means install-time code;
  - a "non-destructive" migration that relaxes RLS, grants to `anon` or adds a `security definer` function;
  - editing cost and cap code, the router order, the originality thresholds, the YouTube-safety jury, the kill switch, the revert monitor, or `AGENTS.md` and the skill.

  The worst gap: the composite score is built on jury scores (line 222), and the jury prompts and rubrics are ordinary product code. The loop can raise its own score by making the jury more lenient.
* **Rationale & Recommendation:**
  - Specify a merge gate that sits outside the loop's write scope: a script in a protected location, run by a different OS user or by CI with branch protection. The gate, not the agent, runs every check and the evaluation.
  - Use an allowlist of paths the loop may change (prompts, presets, rubric wording drafts, worker stage code), so new sensitive areas are protected by default.
  - Add an explicit denylist on top: tests (deletion and skips), lint, ts and CI config, `package.json` and the lockfile, `supabase/migrations/**`, the frozen evaluation jury, originality thresholds, router order, cost and cap code, auth, tokens, `stages/publish.ts`, `authorization.ts`, `lib/auth.ts`, `proxy.ts`, the kill switch, and the gate itself.
  - Evaluate with a pinned, frozen copy of the jury that the loop cannot edit.

### B3. The loop runs with the owner's secrets and against the live database and job queue - Severity: Blocker
* **Reviewer Lens:** `design`, `codebase-details`
* **Affected Scope:** Lines 216-223, 237 (sections 9, 10)
* **Discrepancy Description:** A worktree isolates files only. Running as the same Windows user, Codex or Claude headless can read:
  - the worker `.env` files (service role key, kie, Higgsfield, OpenRouter and Comfy Cloud keys);
  - the CLI's stored PAT;
  - the Google refresh tokens.

  A candidate worker started from the worktree with the default env files connects to the live Supabase and claims real jobs through `claim_job ... FOR UPDATE SKIP LOCKED`. It would then run unreviewed code on real songs and spend real money. `test:db` has no guard against the live stack (`supabase/tests/rls.test.ts:10-31`); only e2e is pinned to port 45621, because a live run spent kie credits on 01/11. A worktree also does not isolate the database or the external `suno-remake` engine repo. "Never spend kie credits in tests" is not enforced.
* **Rationale & Recommendation:**
  - Run the loop as a separate low-privilege OS user, or in WSL or a container, with no read access to the env files or the token store.
  - Give evaluation its own Supabase stack (the existing e2e stack pattern) with fake or cached providers.
  - Allow outbound network only to the runner's model API.
  - Pin `test:db` to the e2e stack.
  - Make the kill switch a file or service the loop user cannot write, checked by the supervisor between steps.
  - State in section 9 that the section 10 owner rules (no kie spend in evaluation, never commit keys) bind the loop.

### B4. The milestone order ships spending, publishing and Autopilot before the caps and the visual jury - Severity: Blocker
* **Reviewer Lens:** `design`, `zoom-out`, `implementation-readiness`, `structural`
* **Affected Scope:** Lines 46-47, 131-132, 208-209, 249-260 (sections 3, 5, 8, 11)
* **Discrepancy Description:**
  - M1 issues spend- and publish-scoped tokens with "per-token daily spend caps" to remote agents, but the ledger and caps arrive in M5.
  - M2 promises R1-R9 plus Autopilot, but R6 image routing and R8 visual jury are M4 work, R9 is M3 work, and Autopilot's "pause on cost cap" has no cap until M5.
  - M3 auto-schedules publishing before M4's visual jury exists. That breaks the anti-goal at line 63.
  - R3 depends on T17 and the local image fallback on T18, and neither is placed in a milestone.
* **Rationale & Recommendation:**
  - Move a minimal ledger with atomic reserve-and-settle caps into M1, and gate the spend and publish scopes behind it.
  - Re-cut the rest:
    - M2 = R1-R5 + R7 in Copilot, with the existing lyric jury and a stub image source (Importa da Midjourney or local).
    - M3 = visual jury, design rules, image router, thumbnails.
    - M4 = publishing.
    - Autopilot only after the jury and caps exist.
  - Enforce the anti-goal in the database: extend the existing QA gate in `approve_video` (`20261031000007_spend_and_staging.sql:35-39`) with the visual jury gates, and make `enqueue_publish` and auto-schedule refuse versions that have not passed every gate.
  - Add a "needs:" dependency line to every milestone.

### B5. Agent-authored Remotion compositions are remote code execution, and the app's own writer is undefined - Severity: Blocker
* **Reviewer Lens:** `design`, `zoom-out`, `implementation-readiness`, `comprehension`
* **Affected Scope:** Lines 103-107, 145-148, 266 (sections 4 R5, 5, 12)
* **Discrepancy Description:** Remote agents (claude.ai, ChatGPT, or any "create" token) can submit "a Remotion composition within a sandboxed component API". A composition is TSX that runs in Node and Chromium on the PC, with the worker's keys in reach. "Sandboxed" is undefined and left to the builder. One prompt-injected agent session would be enough to compromise the PC.

  R5's fallback, "the app's own writer when no agent drives", is also undefined. It could be an LLM writing code or a fixed mapper; the doc names no model or budget. Nothing defines how a run knows an agent is driving, or how the app takes over when the agent goes silent.
* **Rationale & Recommendation:**
  - Decide in the spec that compositions are data only: a versioned JSON scene graph (zod in `packages/shared`) that references whitelisted building blocks.
  - The scene graph has no code, no imports, only allowed asset stores, and limits on duration and assets. Validate it at the API.
  - Only the app's own Remotion components render it.
  - The app's internal writer produces the same JSON. Name its model and per-run budget.
  - Add a run-level "driver" lease (agent token or app) with a timeout and hand-off rule.
  - Validate agent-uploaded images for type, size and decoding.

### B6. Token-authenticated calls cannot run the existing RPCs, and Autopilot has no actor - Severity: Blocker
* **Reviewer Lens:** `design`, `codebase-details`, `zoom-out`, `implementation-readiness`
* **Affected Scope:** Lines 127-133, 46-47, 208-209 (sections 3, 5, 8)
* **Discrepancy Description:** Every named RPC is `security definer`, keyed on `auth.uid()` and granted only to `authenticated` (`20261031000006_web_flow.sql:12-131`; `confirm_publication` writes `confirmed_by=auth.uid()` at `20261031000005_pipeline_hardening.sql:85`). Today they are called only from server actions with the cookie session (`apps/web/lib/run-action.ts:7-18`, `lib/auth.ts:20-32`).

  A PAT request has no session:
  - the service role makes `auth.uid()` null and bypasses RLS;
  - rewriting the RPCs touches T12's migrations.

  Autopilot needs to approve lyrics, takes, video and privacy with no user present:
  - `approve_video` demands an override reason when QA fails;
  - `setPrivacy` refuses to run without `confirmed_by` (`apps/worker/src/stages/publish.ts:115-116`).

  The doc also misdescribes auth. There is no first-user superadmin: profiles come from `admin_allowlist` with roles `admin` and `customer` (`20261031000001_core.sql:1-36`).
* **Rationale & Recommendation:**
  - Add the current auth model to section 2.
  - Choose the identity mechanism. Recommended: after the token hash lookup, the API mints a short-lived (about 60 s) Supabase JWT with `sub` = the token owner and claims `token_id`, `scopes`, `aud=ops`, never returned to the caller.
  - Add a `require_scope()` check inside the spend and publish RPCs.
  - Add an explicit `autopilot` system actor, a policy row the owner enables, recorded in a new `confirmed_via` column. Its worker-only RPCs apply only on a full jury pass.
  - Map scopes to roles: family and friends never get spend, publish or local engines.

### B7. The remote MCP authorization server is not chosen, and OAuth grants have no scopes or caps - Severity: Blocker
* **Reviewer Lens:** `design`, `implementation-readiness`, `comprehension`, `codebase-details`
* **Affected Scope:** Lines 131-133, 142-143, 151 (section 5)
* **Discrepancy Description:** "OAuth 2.1 with the app's sign-in" leaves open:
  - which component is the authorization server;
  - Protected Resource Metadata, authorization-server metadata, PKCE and audience binding (no token passthrough);
  - dynamic client registration or client metadata documents, which claude.ai and ChatGPT connectors need in practice;
  - token lifetimes and refresh;
  - the consent screen;
  - whether grants carry the same scopes, per-grant spend caps and audit name as PATs.

  As written, remote MCP could ship with no caps. Supabase Auth's OAuth 2.1 server is already in `config.toml:368` (disabled, consent path `/oauth/consent`). Its access tokens are ordinary user JWTs that PostgREST accepts directly, so they would bypass the operations layer's scopes unless the RPCs check scopes themselves (B6).
* **Rationale & Recommendation:**
  - Name the authorization server. Supabase's OAuth server is the natural reuse, but it needs RPC-side scope checks.
  - Store OAuth grants as records in the same token table, with the same scopes, caps, audit name and revocation in Settings > Agenti.
  - Make spend and publish admin-only, with a second confirmation on the consent screen.
  - Bind grants to the `/api/mcp` audience.
  - Make the OAuth end-to-end flow plus MCP Inspector conformance the M1 exit criterion.

### B8. Cost caps have no enforcement point, race with themselves, and the counted cost is undefined - Severity: Blocker
* **Reviewer Lens:** `design`, `implementation-readiness`, `comprehension`, `codebase-details`
* **Affected Scope:** Lines 24-27, 47, 132, 166, 175, 179, 195-196 (sections 1, 3, 5, 6, 7)
* **Discrepancy Description:** Paid calls start in many places:
  - worker stages (`draft-lyrics.ts`, `lyric-jury.ts`);
  - web routes (`format-style.ts:27-30` OpenRouter, `api/transcribe/route.ts` Groq);
  - concurrent agents, parallel takes and Autopilot rounds.

  A check-then-spend cap overruns under concurrency. Other gaps:
  - kie bills in credits; OpenRouter cost is known only after the call; codex and Gemini free-tier quotas have no USD price.
  - `jobs` has no token column (`queue.sql:1-19`), so child stages cannot be charged to the token that started them.
  - Only daily and monthly caps exist (line 196). Autopilot's "cost cap" pause has no per-run cap behind it.
  - "Under 0.15 USD" does not say whether it counts Blotato, retries, the Short, the thumbnail or Claude API fallback calls.
  - No ledger table exists. `workers.kie_balance` and the `kie_submit_state` guard exist and could be reused.
* **Rationale & Recommendation:**
  - Add a Postgres `reserve_spend(provider, token_id, run_id, estimate)` RPC that checks per-run, per-token, per-provider and global caps under a row lock, in the same transaction that enqueues the job.
  - Settle to the actual amount after the call; let unsettled reservations expire.
  - Add a price table (kie credits plus a configured USD rate with the date it was checked).
  - Record quota providers as 0 USD with call counts and a usage-limit fallthrough trigger.
  - Propagate `token_id` and `run_id` to every child job, and charge Autopilot to a named system token.
  - Route web-side paid calls through the same RPC.
  - State exactly what the 0.15 USD counts and whether it is a hard per-run cap in Autopilot.

### B9. The veto window is unspecified, fails open when the PC is off, and collides with the existing confirm gates - Severity: Blocker
* **Reviewer Lens:** `design`, `implementation-readiness`, `comprehension`, `zoom-out`, `codebase-details`
* **Affected Scope:** Lines 200-209 (section 8)
* **Discrepancy Description:** The doc does not define:
  - the window length;
  - its relation to "best upload time";
  - what happens on expiry;
  - the cancel operation on API, CLI and MCP;
  - whether one veto covers the whole bundle (16:9, Short, thumbnail, social posts).

  The mechanics also fail in three ways:
  - If YouTube `publishAt` or Blotato holds the clock, a veto needs the PC online to call `videos.update`. If the PC is off, the video goes public against the veto.
  - If Postiz or an app timer holds the clock, an offline PC misses the slot.
  - Whether a Blotato scheduled post can be cancelled is unknown.

  The existing `confirm_publication` and `setPrivacy` require a human `confirmed_by`.
* **Rationale & Recommendation:**
  - Make the app own the clock on every route. Upload private, or hold the asset at Blotato and Postiz, and flip or hand off only when the window has expired, the PC is healthy and no veto exists. This fails closed.
  - Add a missed-slot policy: publish late within X hours, or move to the next slot.
  - Default window: 24 h, configurable in Settings.
  - One veto cancels the whole bundle.
  - Define cancel for each state: pre-upload, uploaded but private, handed off.
  - Record the system actor from B6.
  - Make the window a visible state with a deadline, and send it through the push channel (M9).

### B10. There is no data model, no stage state machine, and no mapping to the existing job model - Severity: Blocker
* **Reviewer Lens:** `implementation-readiness`, `structural`, `codebase-details`, `comprehension`
* **Affected Scope:** Lines 46-47, 75-123, 166, 253, 264 (sections 3, 4, 6, 11, 12)
* **Discrepancy Description:** Many entities are new, with no tables and no relation to `jobs`, `renders` or `publications`: remake, blueprint, meaning map, stage runs, jury reports, PATs, OAuth grants, ledger, publish schedule, image provenance, loop runs, golden items, analytics snapshots, notifications.

  The existing job model doesn't fit as is:
  - `jobs.version_id` is NOT NULL (`queue.sql:4,18`), but R1 and R2 run before any song exists.
  - Every new stage needs a `jobs_stage_check` migration, a `STAGES` entry (`packages/shared/src/stages.ts:17-37`) and a `stageAllowed` rule (`apps/worker/src/authorization.ts:17`).

  The behaviour is undefined too:
  - "Each can pause in Copilot" names no pause points.
  - Nothing says what approve, edit, regenerate and skip do downstream, or whether R8 and the originality checks can be skipped at all.
  - Mode changes mid-run, resume after a worker restart, and concurrent UI and agent approval are unhandled.
  - The Autopilot stop list differs between lines 47, 166 and 208.
  - No R-stage times the newly generated take, which kinetic lyrics need.
* **Rationale & Recommendation:**
  - Add a "Data model (additions)" section with each entity, its key fields, its relation to the existing tables, and the milestone that adds it.
  - Decide whether remakes create the project and version at R1 or run on their own queue.
  - Add a state machine: pending, running, awaiting_approval, passed, failed_jury, capped, skipped, cancelled, with an optimistic `expected_stage_version` field.
  - List the default Copilot pause points (after R3, R4 and R8, and before R9) and make R8 and the originality checks unskippable.
  - Keep one Autopilot stop list in section 4: jury failure after the round cap, cost cap, provider exhaustion, the veto window.
  - Map each R-stage to an existing stage or a new one, and insert an explicit "R4b timing" on the new take.
  - Reuse the version-status checkpoints (`lyrics_review`, `takes_review`, `video_review`) and `job_events.progress`.

### B11. The video blueprint, the central contract, has no schema - Severity: Blocker
* **Reviewer Lens:** `implementation-readiness`, `codebase-details`
* **Affected Scope:** Lines 86-89, 103-107 (section 4 R2, R5)
* **Discrepancy Description:** R2 writes the blueprint, R5 consumes it, agents edit it and R8 checks against it, yet it has no fields. The vision model, frame count and cost are unnamed. `apps/worker/src/stages/storyboard.ts` already writes `data/<lang>/storyboard.json`, and the doc ignores it. `task-24-brief.md:30` puts the schema in `packages/remake`; the doc says `packages/shared`.
* **Rationale & Recommendation:**
  - Put zod schema v1 in the doc, with `schemaVersion`, `source{videoId,durationS}`, `music{bpm,key,timeSig,sections[]}`, `shots[{id,startS,endS,sectionId,layout,typographyRoles,palette,motion,transition,overlays}]` and `global{palette,typeScale}`.
  - State that it extends or replaces `storyboard.json`.
  - Pick one package for it.
  - Name the R2 vision model, its frame budget and its cost.

### B12. The originality thresholds (the copyright safety line) are undefined and cannot be calibrated in time - Severity: Blocker
* **Reviewer Lens:** `implementation-readiness`, `comprehension`, `structural`, `zoom-out`
* **Affected Scope:** Lines 26, 93-96, 115-117, 222-223, 264-265 (sections 1, 4, 6, 9, 12)
* **Discrepancy Description:** Line 94 calls the thresholds "fixed" but gives no metric, model or value. Section 12 leaves them to the builder, "calibrated on the golden set", but the golden set arrives in M5, after the M2 and M4 gates that need them.

  There is also an unresolved tension: the meaning-fidelity jury rewards semantic closeness, while originality forbids it line by line. Other jury details are missing too:
  - jury aggregation (mean, minimum or majority);
  - the devil's advocate's power (veto or one vote);
  - the round caps.
* **Rationale & Recommendation:** Give binding starting values until calibration is done.
  - **Lyrics:**
    - Lexical: character 4-gram Jaccard and ROUGE-L of each new line against the source line and against a machine translation of it; above 0.35 fails.
    - Semantic: cosine similarity with a named local multilingual model (LaBSE or multilingual-e5-large). Each line must be at most 0.80 against the translated source line, and each section at least 0.55 against the meaning map.
    - An exact-phrase check on the hook and title.
  - **Visuals:**
    - pHash Hamming distance of at least 12 of 64 bits at aligned timestamps.
    - CLIP or DINOv2 cosine of at most 0.85.
    - List what may match by design (timing, layout grid).
  - **Jury rules:** state the aggregation rule, the devil's advocate's power and the round caps.
  - **Calibration:** build a small golden set (5-10 items) in the milestone that ships the first jury, and make thresholds owner-signed and frozen against the loop.

### B13. The loop's merge target, deploy, revert and migration handling are unspecified - Severity: Blocker
* **Reviewer Lens:** `design`, `implementation-readiness`, `zoom-out`, `codebase-details`, `comprehension`
* **Affected Scope:** Lines 216-231 (section 9)
* **Discrepancy Description:** "Merged" does not say into what. The live checkout is on `build/studio-ui`, not `main` (refs `5310e4c` vs `8e796c3`), and it holds M0/T12 work in progress, so nightly merges will conflict with human work. Nothing says how merged code reaches production: worker restart, `next build`, migration apply.

  The revert plan has three problems:
  - Supabase migrations only go forward, so `git revert` leaves the applied schema behind and the history drifts.
  - The only production database sits in a Docker volume, while the README backup script targets the hosted pooler.
  - "Automatic revert on regression" can't use YouTube Analytics, which lags 24-72 h and is noise on a small channel. Later merges stack on top, so reverts conflict.

  `gnhf` is cited with no path.
* **Rationale & Recommendation:**
  - Forbid loop migrations (see B2).
  - Merge to a `loop/main` integration branch, and have the gate fast-forward one squashed commit per night onto the named production branch.
  - Write an explicit deploy script: `pg_dump`, pull, build, restart the worker in an idle window, health check.
  - Trigger reverts on operational signals over a fixed window with numeric limits: job failure rate, render success, mean jury score, cost per video. Analytics only feeds the next night's hypotheses.
  - Keep worktrees on `E:/mellodifai/wt/`.
  - Link or describe gnhf.

### B14. The milestones have no exit criteria, file lists, migrations or tests - Severity: Blocker
* **Reviewer Lens:** `implementation-readiness`, `structural`
* **Affected Scope:** Lines 247-260 (section 11)
* **Discrepancy Description:** Each milestone is one line of nouns. The section 1 success criterion is tied to no milestone. Goals 3 and 4 are split across milestones without saying so, and the reasoning routing has no milestone at all.
* **Rationale & Recommendation:**
  - Turn section 11 into a table with columns: milestone, goals covered, R-stages and T-ids, depends on, owner actions, files and packages, migrations by name, named tests, "done when" checks.
  - Example M1 exit: "Claude Code over stdio and claude.ai over remote MCP each complete create, status and approve on a test song; OAuth passes MCP conformance; a revoked token is rejected."
  - Add a final row for the success criterion, measured on the golden set.

### B15. There is no operations catalogue or HTTP contract, and the operations layer would have two implementations - Severity: Blocker
* **Reviewer Lens:** `implementation-readiness`, `design`, `codebase-details`, `zoom-out`
* **Affected Scope:** Lines 48-49, 127-151, 264 (sections 3, 5, 12)
* **Discrepancy Description:** The UI calls server actions, not HTTP. The doc never says whether the UI moves onto `/api/v1`, so the two paths will drift. "Every action the UI can do" also covers things that aren't RPCs: storage uploads, Realtime, `api/transcribe`, `api/suno-link`.

  A stdio MCP could talk to Supabase directly and skip scopes, caps and audit. Three clients and the skill depend on operation and tool names that section 12 leaves open. Also undefined:
  - error envelope, idempotency keys, pagination;
  - the `status --watch` transport;
  - versioning rules for `/api/v1`;
  - where CLI credentials are stored;
  - package entry points.

  `runAction`'s `revalidatePath` calls (`run-action.ts:29-37`) must also run on the API path.
* **Rationale & Recommendation:**
  - Use one server operations module (`apps/web/lib/ops/*` or `packages/ops`) called by the server actions, the `/api/v1` handlers and the MCP tools.
  - Keep one MCP tool registry with two transports. The CLI and stdio MCP are thin HTTP clients of `/api/v1` on localhost, never database clients.
  - Add a catalogue table to the doc: operation, method and path, zod schema, scope, spends money (and its estimate), sync or `{job_id}`.
  - Add the error envelope, the `Idempotency-Key` header, SSE or polling from `job_events`, and signed upload URLs.
  - Store CLI credentials in the OS keychain or `%APPDATA%`.
  - Fix the MCP tool names now.

### B16. The GPU and disk budgets are undefined on a single 8 GB GPU and a nearly full C: - Severity: Blocker
* **Reviewer Lens:** `design`, `implementation-readiness`
* **Affected Scope:** Lines 77-117, 221, 236-240 (sections 4, 9, 10)
* **Discrepancy Description:** "One GPU job at a time" has no mechanism behind it. `claim_job` is first in, first out across all stages. The GPU users are:
  - Demucs, ACE-Step, local images and Whisper, Remotion renders and R8 re-renders;
  - ComfyUI, which holds VRAM while its server is up;
  - the loop's golden-set runs;
  - the owner's After Effects.

  Rough load: 10 golden items, baseline plus candidate, is 2-3 GPU hours per hypothesis, and that collides with overnight Autopilot remakes. On disk, a remake is roughly 1-3 GB (source video, frames, stems, takes, renders), with no retention policy, no free-space check, and no statement that Remotion, Chrome and temp caches live on E:.
* **Rationale & Recommendation:**
  - Add a `resource_class` (gpu, cpu, net) to jobs and a single database-backed GPU lease (holder, heartbeat, priority). Production jobs preempt evaluation.
  - Unload ComfyUI before Remotion.
  - Run the loop in an owner-set window, and make it yield.
  - Retention: delete source media once R2 passes, keep the analysis JSON, delete intermediates 14 days after publishing.
  - Pause when E: falls below N GB free, and pin every cache to E:.
  - Add a capacity budget table.

### B17. The YouTube section ignores the code that already exists and the API's constraints - Severity: Blocker
* **Reviewer Lens:** `implementation-readiness`, `codebase-details`, `design`, `zoom-out`
* **Affected Scope:** Lines 22, 40, 198-209, 254 (sections 1, 2, 8, 11)
* **Discrepancy Description:** Publishing is already built:
  - `apps/worker/src/stages/publish.ts:8-147` does private upload, captions, thumbnail, upload-state recovery, `containsSyntheticMedia: true` (`:66`) and `scheduled` + `publish_at`.
  - A daily quota reservation is hard-capped at 4 uploads (`pipeline_hardening.sql:49-58`).
  - What's missing is the OAuth client: `yt.py:90` exits without `YT_CLIENT_ID`.

  The constraints the doc misses:
  - `enqueue_publish` accepts only `kind='master'`, so the Short can't be published through it.
  - `publications` is YouTube-only, one row per render.
  - 16:9 plus a Short is 2 uploads, so about 2 videos a day (10k units a day; an upload is about 1,600 units plus captions and thumbnail).
  - `publishAt` works only on private, never-published uploads.
  - Shorts have no API flag.
  - Line 206 says AI disclosure "when required", but the code always sets it, and the Blotato route's disclosure behaviour is unchecked.
  - Nothing says how Blotato uploads map back to a `youtube_video_id` for analytics.

  The forced-private premise may be outdated (`suno-remake/publish/README.md:42`, unverified).
* **Rationale & Recommendation:**
  - Rewrite M3 as "connect and extend":
    - add a platform and route column to `publications`;
    - let `enqueue_publish` take hook renders;
    - make the quota cap configurable;
    - state the throughput and the existing quota-exhaustion behaviour (`retryLater` until the Pacific reset).
  - Decide "AI disclosure always true", and verify Blotato sets it.
  - Define the Blotato id mapping.
  - Decide whether to add `#Shorts` and skip `thumbnails.set` on Shorts.
  - Re-verify the private-lock status before routing public uploads through Blotato.
  - Define the audit package and who submits it.

---

## Major

### M1. The devil's advocate is listed as built but does not exist - Severity: Major
* **Reviewer Lens:** `codebase-details` (confirmed by the synthesizer)
* **Affected Scope:** Lines 31-32, 96, 121, 162
* **Discrepancy Description:** A search for `devil|advocat|avvocato` in `apps/` and `packages/` finds nothing. The lyric pipeline has the Jev router, the writers and a three-judge jury (`lyric-jury.ts:7-19,368-395`). The only mention is the future `task-24-brief.md:37`.
* **Rationale & Recommendation:** Move it to new work in R3 and section 6, and define its prompt role and its weight (B12).

### M2. Untrusted YouTube content flows into agents that can spend, publish and merge - Severity: Major
* **Reviewer Lens:** `design`, `structural`
* **Affected Scope:** Lines 77-96, 145-148, 218-220
* **Discrepancy Description:** Captions, titles, descriptions and transcripts from arbitrary channels feed the Autopilot writer, the MCP resources read by spend- and publish-scoped agents, and, through job errors and logs, the code-merging loop. The doc defines no injection boundary.
* **Rationale & Recommendation:**
  - Mark ingested text as untrusted in prompts and in MCP resource annotations.
  - Let it fill fixed template fields only; it never selects tool calls.
  - Quote or strip it in loop inputs.
  - Route spend and publish calls from a session that read untrusted resources through the confirm or veto path.

### M3. `/media` cannot serve Postiz, TikTok, Instagram or Blotato, and social posting depends on the PC being up - Severity: Major
* **Reviewer Lens:** `design`, `codebase-details`, `implementation-readiness`
* **Affected Scope:** Lines 140-142, 203-205
* **Discrepancy Description:** `/media` signs as the session user, returns 404 without a session, and redirects to a local storage host (`apps/web/app/media/[...path]/route.ts:14-27`). External fetchers can't use it. Postiz on the PC also needs the PC and the tunnel up at post time. The doc doesn't define the Blotato fallback trigger or the per-platform templates.
* **Rationale & Recommendation:**
  - Add per-publication capability URLs: unguessable, expiring, one render each, streamed by Next from E: or storage, revoked on veto or after publishing.
  - State the uptime needed at post time and the Blotato fallback trigger.

### M4. The doc silently overrides rules in the 31/10 design - Severity: Major
* **Reviewer Lens:** `design`, `zoom-out`, `structural`
* **Affected Scope:** Header lines 3-7; lines 46-47, 179-189, 208-209, 224-231
* **Discrepancy Description:** These earlier rules are contradicted without a note:
  - "explicit click per video" to go public;
  - "every kie generation needs a confirm click";
  - "a song generation is never re-sent without the admin asking" (the `resolve_kie_submission` invariant);
  - "GPT Image via codex first";
  - TikTok and Instagram as non-goals;
  - Vercel plus hosted Supabase.
* **Rationale & Recommendation:** Add "Extends and partly supersedes 2026-10-31-mellodifai-design.md" to the header, plus a "Superseded rules" list giving each replacement control (caps, veto window, autopilot policy row). Restate that rounds never resend after an ambiguous kie submission.

### M5. Goal 4's cost order contradicts the owner's image order - Severity: Major
* **Reviewer Lens:** `design`, `comprehension`, `structural`
* **Affected Scope:** Line 52 vs lines 178-189
* **Discrepancy Description:** Goal 4 says "subscriptions first, local second, cheap APIs third", but the owner's image order puts paid Midjourney via kie first and local models last. A generic router will not know which rule wins.
* **Rationale & Recommendation:** Reword Goal 4 to "per-medium routing in section 7 (images follow the owner's order; reasoning and music follow subscriptions, local, then cheap APIs), within the per-video budget".

### M6. The 0.15 USD target has no budget and is unlikely to hold - Severity: Major
* **Reviewer Lens:** `zoom-out`, `design`, `implementation-readiness`
* **Affected Scope:** Lines 24-27, 175, 178-196
* **Discrepancy Description:** At about 0.005 USD per kie credit (fixture `apps/worker/test/stages.test.ts` near line 1154; owner to confirm), one 12-credit generate is about 0.06 USD. The 31/10 spec puts one Gemini video jury pass at about 0.1 USD. Music plus one jury pass already reaches the target, before any of these:
  - Midjourney grids for the shot list and thumbnail;
  - the R2 vision blueprint;
  - lyric jury rounds;
  - retries.
* **Rationale & Recommendation:**
  - Add a per-video budget table: music, analysis, lyric jury, images, visual jury, retry reserve.
  - Add a per-video image sub-budget. Once it's spent, the router falls through to GPT Image via codex or local, which keeps the owner's order.
  - Use cheap judges in early rounds and premium judges only in the final round.
  - Restate the criterion as "median paid cost over the golden set, retries included".

### M7. The golden-set ratchet will lock in noise, and evaluation has no cost or GPU budget - Severity: Major
* **Reviewer Lens:** `design`, `zoom-out`, `implementation-readiness`, `comprehension`
* **Affected Scope:** Lines 213-214, 221-224
* **Discrepancy Description:** LLM and vision juries are stochastic, and OpenRouter models drift. "Keep if better" on 10 items with no repeats will accept random wins. The doc doesn't say:
  - whether evaluation regenerates music and images (paid) or replays frozen artefacts;
  - the composite weights and the tolerances;
  - a nightly spend cap for evaluation.
* **Rationale & Recommendation:**
  - "Frozen inputs" means frozen artefacts (takes, stems, images), and only stages the change touches are re-run.
  - Pin the judge model versions.
  - Run k repeats per item, and require an improvement beyond the noise band measured by running the baseline against itself.
  - Give the weights and tolerances, a nightly evaluation spend cap in the ledger, and the golden items' location and curator.

### M8. The existing lyric jury passes when every judge fails - Severity: Major
* **Reviewer Lens:** `codebase-details` (confirmed by the synthesizer)
* **Affected Scope:** Lines 47, 63, 166
* **Discrepancy Description:** `combine()` returns `available: false, passed: true` when no verdict is valid (`apps/worker/src/stages/lyric-jury.ts:333-344`). The header comment says this is on purpose. In Autopilot, an OpenRouter outage would let content through unjudged, which breaks the anti-goal at line 63.
* **Rationale & Recommendation:** In Autopilot, and for every new jury, "jury unavailable" pauses the run. Copilot may keep the current behaviour, but must show it to the user.

### M9. There is no push notification channel for pauses, veto windows and reverts - Severity: Major
* **Reviewer Lens:** `zoom-out`, `implementation-readiness`, `design`
* **Affected Scope:** Lines 118-123, 208-209, 232
* **Discrepancy Description:** MCP is pull-only, and agents aren't always connected. If the owner isn't looking, paused runs, open veto windows (the owner's main publish safety) and auto-reverts all go unseen.
* **Rationale & Recommendation:** Add a `notifications` table, one push channel (email, Telegram or ntfy), and an MCP resource agents can poll. Show veto deadlines in the morning report.

### M10. The doc has no Alternatives Considered or Risks / threat model sections - Severity: Major
* **Reviewer Lens:** `structural`, `design`
* **Affected Scope:** Whole document; line 151 and lines 225-231 hold the only security text
* **Discrepancy Description:** The feature-spec standard requires both sections; the structural reviewer rated this a Blocker under that standard. Unrecorded alternatives:
  - PC plus tunnel vs hosted;
  - Supabase OAuth vs a self-built authorization server;
  - app-owned clock vs `publishAt`;
  - JSON scene graph vs code;
  - gnhf vs Claude headless;
  - Cloudflare vs Funnel.

  Unnamed failure modes:
  - the kie or Midjourney reseller disappearing;
  - the YouTube audit being rejected;
  - Content ID claims despite the originality checks;
  - the GPU becoming a queue bottleneck;
  - the loop gaming its metric.
* **Rationale & Recommendation:** Add both sections. For owner decisions, the alternatives section just says "owner decision". Build the risk table (risk, surface, likelihood and impact, mitigation, milestone) from B1-B17, M2 and M8.

### M11. Section 12 hides decisions that drive safety and quality - Severity: Major
* **Reviewer Lens:** `implementation-readiness`, `structural`
* **Affected Scope:** Lines 262-266
* **Discrepancy Description:** Several items left to the builder are contracts:
  - routes and schemas;
  - table layouts;
  - MCP tool names (renaming them breaks agents);
  - thresholds (copyright and publish gates; section 9 forbids the loop from editing them, yet nobody is named to set them);
  - the Remotion component API (a security boundary).
* **Rationale & Recommendation:** Keep only CLI flags, rubric wording and the analyser choice in section 12. Constrain the analyser: no GPL code in the web app, CPU-only or at most 2 GB VRAM, and the output must fill the blueprint's `music` fields. Move the rest into B10, B11, B12, B15 and B5.

### M12. The defaults for an untouched remake are missing - Severity: Major
* **Reviewer Lens:** `zoom-out`
* **Affected Scope:** Lines 24-27, 91-101, 198-209
* **Discrepancy Description:** "Without the owner touching anything" needs choices the doc never assigns:
  - target languages;
  - vocal gender and style;
  - channel and platforms (and, for family and friends, whose channel);
  - slot and spacing when several remakes finish together;
  - a fallback time while the channel has no analytics;
  - preset and brand.
* **Rationale & Recommendation:** Add a per-user "Remake defaults" profile in Settings, with overrides on the CLI and MCP `remake` call. R3, R9 and section 8 point to it.

### M13. Owner actions are scattered and not tied to the milestones they block - Severity: Major
* **Reviewer Lens:** `zoom-out`, `structural`
* **Affected Scope:** Lines 40-41, 140, 200-202, 185
* **Discrepancy Description:** The owner actions in the doc:
  - the Google project, OAuth client and consent screen (add the Analytics read scope now to avoid a second consent);
  - the audit, which takes weeks;
  - the Blotato key, Gemini key and OpenRouter key;
  - the DNS move or the Funnel choice;
  - confirming kie Midjourney access and pricing, and the kie USD rate.

  Open questions with no home: the veto length, and the cheapest Nano Banana route ("found" means still to be researched).
* **Rationale & Recommendation:** Add an "Owner actions and open questions" table with columns: item, blocks milestone, who acts, fallback while pending, status.

### M14. Owner decisions and author calls are not separated ("my calls") - Severity: Major
* **Reviewer Lens:** `comprehension`, `structural`, `zoom-out`
* **Affected Scope:** Lines 138, 178, 208, 224-225, and author calls throughout
* **Discrepancy Description:** Owner answers are marked in four different styles. The loop rails, the only limit on autonomous merges, are "my calls" with no confirmation status. Other author calls look like settled fact: 0.15 USD, Cloudflare first, a golden set of 10, Blotato until the audit, two takes, the 3-minute Short. The 31/10 design's convention ("Builder's calls" vs "The user's answers") was dropped.
* **Rationale & Recommendation:** Add "Owner decisions (final)", numbered and dated, and "Author's calls (owner can overrule)". Use inline pointers such as "(owner decision 4)". Mark the rails as confirmed, with a date, or as pending.

### M15. Who runs and pays for the reasoning in each mode is unclear - Severity: Major
* **Reviewer Lens:** `comprehension`
* **Affected Scope:** Lines 31-32, 46-47, 147-148, 171-173
* **Discrepancy Description:** Line 147 says internal LLM calls are used "only in Autopilot without an agent", yet the existing create panel uses an internal writer and jury for human users. Read literally, a builder would remove them from human Copilot runs.
* **Rationale & Recommendation:** Add a table: driver (human or agent) x mode (Copilot or Autopilot) x stage -> who reasons and who pays.

### M16. The modes are undefined and inconsistent - Severity: Major
* **Reviewer Lens:** `comprehension`, `implementation-readiness`
* **Affected Scope:** Lines 26, 98, 192-196, 258
* **Discrepancy Description:** The doc uses "standard", "free" and "premium" modes without defining any of them. In free mode, the image chain starts with paid Midjourney. Premium needs "cost shown before confirm", so it is unclear whether it can run in Autopilot. Higgsfield operations, prices, the T14 dependency and M6 acceptance are all missing.
* **Rationale & Recommendation:** Define each mode in one place: providers allowed, cost rule, Autopilot eligibility. For example: premium needs a per-run pre-approved budget in Autopilot.

### M17. Errors, retries and round caps are undefined - Severity: Major
* **Reviewer Lens:** `implementation-readiness`, `design`
* **Affected Scope:** Lines 96, 115-117, 166-167, 178-179
* **Discrepancy Description:** The doc gives no round cap values, does not distinguish a jury round from a transient retry, and does not classify errors as transient or permanent. Per-provider timeouts and a `stop_reason` list are missing. `requeue_stale(120s)` (`queue.sql:123`) may re-run long GPU stages.
* **Rationale & Recommendation:**
  - Define round caps per stage (R3, R4, R8).
  - Define attempts and backoff, and the error classes.
  - Give each provider a timeout that triggers the fallthrough.
  - Stop reasons: passed, round_cap, cost_cap, provider_exhausted, owner_cancelled, error.
  - Require a heartbeat for long stages.
  - Restate the kie never-resend invariant.

### M18. There is no testing strategy for the product itself - Severity: Major
* **Reviewer Lens:** `implementation-readiness`, `structural`
* **Affected Scope:** Whole document; line 237
* **Discrepancy Description:** The doc never says how R1-R9, Autopilot, OAuth and publishing are tested with zero kie spend.
* **Rationale & Recommendation:**
  - Extend `apps/worker/src/fake` to cover yt-dlp, kie Midjourney, codex, Nano Banana, OpenRouter, YouTube, Blotato and Postiz.
  - Add recorded fixtures for one source video.
  - Run MCP Inspector over both transports.
  - Add an OAuth end-to-end test, a YouTube dry run or test channel, and a tunnel smoke test.
  - Add a test that a known close paraphrase fails the originality check.
  - Add a loop dry-run mode that never merges.

### M19. There is no rollout, rollback or enablement order for the risky switches - Severity: Major
* **Reviewer Lens:** `implementation-readiness`, `structural`
* **Affected Scope:** Section 11
* **Discrepancy Description:** Remote MCP, Autopilot, public auto-publish and loop merges switch on with no gates, flags or kill path.
* **Rationale & Recommendation:**
  - Add a feature flag for each.
  - Allow additive migrations only.
  - Add a one-step remote shutdown: disable the tunnel route and revoke all grants.
  - Add enablement gates. For example, the loop merges only after N nights of dry run; remote MCP opens only after the conformance tests pass; public auto-publish starts only after the audit or a verified Blotato route.
  - Define rollback for each milestone.

### M20. There is no observability section, though the revert, Console and morning report rely on it - Severity: Major
* **Reviewer Lens:** `structural`
* **Affected Scope:** Lines 75, 121-123, 133, 230-232
* **Discrepancy Description:** The event and log stores, the metric set, retention and alert targets are all undefined.
* **Rationale & Recommendation:** Add a section covering the stores, the revert metric set and windows (B13), retention, where alerts go (M9), and the morning report schema.

### M21. The doc misses reuse of existing QA, take scoring, Short, thumbnail and storyboard code, and mixes two Remotion projects - Severity: Major
* **Reviewer Lens:** `codebase-details`
* **Affected Scope:** Lines 33-35, 99, 103-117, 156-157, 254-256
* **Discrepancy Description:** Code that already exists:
  - `qa.ts:17-115` measures loudness, true peak and crushed words, and builds a 20-frame contact sheet.
  - `score_takes` is `suno-remake/tools/score_takes.py`, not an RPC. Its `fidelity` value is already a Whisper intelligibility score.
  - `render_hook` already renders a 1080x1920 Short (`render.ts:68-132`).
  - `art.ts:5-31` makes the thumbnail and the SRT.

  "Video Studio building blocks" mixes two projects. `packages/visualizer` has no kinetic lyrics. Kinetic lyrics and the VBP lyric video render from the external `suno-remake/motion` project (`stages/utils.ts:6`).
* **Rationale & Recommendation:** Build R7 and R8 on these stages and name them. State which Remotion project R5 and the scene graph target, and whether the kinetic lyric components move into this repo.

### M22. The doc misdescribes the reasoning chain - Severity: Major
* **Reviewer Lens:** `codebase-details`
* **Affected Scope:** Lines 31, 171-173
* **Discrepancy Description:**
  - Jev (`typesafe/jev-1.14` on OpenRouter `/api/alpha/decisions`) picks the tone and the writer strength. It is not a cheap-model cost router.
  - The writers are Opus and Sonnet through OpenRouter.
  - No Anthropic API client exists, so "Claude API credits as last fallback" is new work.
* **Rationale & Recommendation:** Describe Jev correctly, and list the direct Anthropic client and its ledger integration as new work.

### M23. The claim that M1 doesn't touch T12's files is false - Severity: Major
* **Reviewer Lens:** `codebase-details`
* **Affected Scope:** Lines 130, 251-252
* **Discrepancy Description:** zod is already in `packages/shared` (^4.6.7). The operation schemas live in `apps/web/app/actions/schemas.ts:11-170`, and several belong to T12 (`SectionEditInput`, `ImportSongInput`, `SongSourceInput`). The RPCs that T12 owns are in `20261101000023_songs_from_songs.sql`.
* **Rationale & Recommendation:** State that M1 moves or re-exports `schemas.ts` after T12 lands, and drop the "not T12's files" claim.

### M24. The image fallthrough lacks the details needed to code it, and the codex quota is shared three ways - Severity: Major
* **Reviewer Lens:** `implementation-readiness`, `design`
* **Affected Scope:** Lines 171-173, 178-190, 216
* **Discrepancy Description:** Missing details:
  - per-provider timeouts;
  - how a `codex exec` refusal or quota exhaustion is detected (exit code or message, auth location, headless use on the worker);
  - the Nano Banana free-tier limits and paid price;
  - the allowed OpenRouter models;
  - candidates per shot;
  - where provenance is stored.

  The loop, image route 2 and agent reasoning all draw on the same ChatGPT plan quota.
* **Rationale & Recommendation:** Specify each of these. Store provenance in the ledger and in the image metadata. Reserve or schedule the quota between the loop, images and agents.

### M25. The visual jury is not specified - Severity: Major
* **Reviewer Lens:** `implementation-readiness`
* **Affected Scope:** Lines 158-162
* **Discrepancy Description:** The doc names no judge models, frame sampling, scale, aggregation, threshold, must-fix list or cost.
* **Rationale & Recommendation:**
  - Name the judges.
  - Sample frames per shot and at beat peaks.
  - Version the rubric.
  - Aggregate with the median.
  - Compute contrast and safe areas in code rather than judging them.
  - Must-fix: misspelt text, AI artefacts, safe-area violations.
  - State the cost per video inside the M6 budget.

### M26. "Every video must have its own look" has no metric - Severity: Major
* **Reviewer Lens:** `zoom-out`, `implementation-readiness`
* **Affected Scope:** Lines 64-65, 117
* **Discrepancy Description:** Originality is checked only against the source. With shared presets and the Classico template, the realistic failure is sameness across the owner's own videos.
* **Rationale & Recommendation:** Add a distinctness gate: perceptual and embedding distance against the last N published videos, using the R8 machinery, plus a limit on preset reuse.

### M27. The R3 syllable-fit and R4 music acceptance have no method or values - Severity: Major
* **Reviewer Lens:** `implementation-readiness`
* **Affected Scope:** Lines 91-93, 98-101, 156-157
* **Discrepancy Description:** The doc names no syllabifier, tolerance or stress method. For R4 it gives no WER threshold, loudness target, structure-match rule, listening-jury model or style-tag mapping.
* **Rationale & Recommendation:**
  - R3: count source syllables from word timestamps, use pyphen plus rules for Italian and English, allow +/-1 syllable per line, and leave stress to the jury.
  - R4: WER at most 0.25, -14 LUFS +/-1, section boundaries within +/-1 beat.
  - Name the R2 -> kie and ACE-Step parameter mapping.

### M28. The doc contradicts itself on terms of service and on "model input" - Severity: Major
* **Reviewer Lens:** `implementation-readiness`, `codebase-details`
* **Affected Scope:** Lines 66, 77-80; `apps/web/app/api/suno-link/route.ts:43-105`
* **Discrepancy Description:**
  - The anti-goal forbids automating services whose terms forbid it, including scraping, yet R1 downloads YouTube content with yt-dlp.
  - Line 79 says the source audio is "never used as model input audio", but Demucs and Whisper take it as input.
  - The shipped suno-link route fetches suno.com share pages and MP3s.
* **Rationale & Recommendation:**
  - Record that the owner accepts the analysis-only download risk, with the source deleted after R2.
  - Reword line 79 to "never given to a generator".
  - State whether user-initiated Suno share-link imports are allowed.

### M29. Analytics ingestion is undefined - Severity: Major
* **Reviewer Lens:** `implementation-readiness`
* **Affected Scope:** Lines 207, 218-220, 257
* **Discrepancy Description:** The doc names no YouTube Analytics scopes, refresh schedule, Blotato id mapping or snapshot storage.
* **Rationale & Recommendation:** Specify each of these, and request the scopes with the first OAuth consent (M13).

### M30. The split with the feature-parity plan duplicates some content and leaves T-ids unassigned - Severity: Major
* **Reviewer Lens:** `structural`, `zoom-out`, `codebase-details`
* **Affected Scope:** Lines 3-7, 176, 188, 203-205, 259-260
* **Discrepancy Description:** The header says this doc "orders all of it", yet line 259 only "folds" T15-T22 in with no milestone.
  - **Duplication:** section 8 restates T19; the originality check overlaps T17 mode (1); the local fallback overlaps T18; Mureka and ElevenLabs overlap T20.
  - **Unassigned:** T11b, T14, T18 (needed for the M4 fallback), T19 (M3) and T15 (needed for "brand fit").
  - **Ambiguous:** M6's Comfy Cloud and T14 share a name, and the dependency is unclear.
* **Rationale & Recommendation:**
  - State the rule: the plan owns the feature specs; this doc owns order, dependencies and the agentic layer, and links instead of restating.
  - Give every T-id a milestone or "later".
  - Mark T7-T11 and T13 done in section 2.
  - Make one document own the originality definition.

### M31. The design relies on machine-specific paths and references outside the repo - Severity: Major
* **Reviewer Lens:** `comprehension`, `codebase-details`
* **Affected Scope:** Lines 4, 37-38, 78-79, 163-165, 216
* **Discrepancy Description:** `E:/mellodifai/remakes`, `E:/mellodifai/research/` and `I:\.YT STUFF` are absolute paths on the owner's PC. `DESIGN-MOTION.md` lives in the unnamed "ita repo", and `gnhf` has no path. Its design rules ("slot-locked numbers", "closed loops") mean nothing without that file.
* **Rationale & Recommendation:** Add a runtime-root env variable (default `E:/mellodifai`). Copy the motion rules into `docs/design/motion-rules.md`. Name the research files the design relies on, or summarise them. Give absolute paths for gnhf and the ita repo.

---

## Nits

### N1. Streamable HTTP through a tunnel needs keepalives and stateless sessions - Severity: Nit
* **Reviewer Lens:** `design`
* **Affected Scope:** Line 137
* **Discrepancy Description:** Cloudflare drops idle proxied connections after about 100 s.
* **Rationale & Recommendation:** Specify SSE keepalives and session handling that survives a tunnel or Next restart.

### N2. Rate limits are undefined - Severity: Nit
* **Reviewer Lens:** `design`
* **Affected Scope:** Line 151
* **Discrepancy Description:** The doc names no store and no values.
* **Rationale & Recommendation:** Keep a per-token database counter at the operations layer, and state the default limits.

### N3. Several terms are used without definition - Severity: Nit
* **Reviewer Lens:** `comprehension`
* **Affected Scope:** Lines 6, 31, 34, 80, 96, 99, 221, 249-260
* **Discrepancy Description:** Undefined terms: Jev router, VBP template, `score_takes`, the `/watch` skill method, devil's advocate, golden set, and the T-numbers.
* **Rationale & Recommendation:** Add one-line definitions with paths, and gloss each T-id at first use (for example "T17 (language adaptation)").

### N4. Italian UI labels in English prose have no glosses - Severity: Nit
* **Reviewer Lens:** `comprehension`
* **Affected Scope:** Lines 131, 181
* **Discrepancy Description:** "Settings > Agenti" and "Importa da Midjourney" have no English gloss.
* **Rationale & Recommendation:** Mark them as UI strings and add glosses.

### N5. The Short's hook-section selection rule is missing - Severity: Nit
* **Reviewer Lens:** `comprehension`
* **Affected Scope:** Line 112
* **Discrepancy Description:** The doc doesn't say how the hook section is chosen.
* **Rationale & Recommendation:** State the rule: the R2 section labelled hook or chorus, otherwise the energy peak, otherwise the meaning map's hook idea.

### N6. The Groq key is missing from the key inventory - Severity: Nit
* **Reviewer Lens:** `comprehension`
* **Affected Scope:** Lines 40-41, 80
* **Discrepancy Description:** Groq Whisper is used in R1, but its key is not in the list.
* **Rationale & Recommendation:** Add it to the list.

### N7. The yt-dlp workaround is an implementation detail in an architecture section - Severity: Nit
* **Reviewer Lens:** `zoom-out`
* **Affected Scope:** Lines 77-78
* **Discrepancy Description:** The `yt-dlp-ejs` / `--js-runtimes node` fix belongs in builder notes.
* **Rationale & Recommendation:** Move it to the plan.

### N8. Some sections render badly - Severity: Nit
* **Reviewer Lens:** `structural`
* **Affected Scope:** Lines 143, 189, 249-260, R1-R9
* **Discrepancy Description:**
  - M0-M6 render as one paragraph.
  - Line 189 attaches to list item 5.
  - R1-R9 are bare paragraphs.
  - Line 143 overflows the wrap width.
* **Rationale & Recommendation:** Use a table for section 11 and H3s for the R-stages, add a blank line before line 189, and rewrap line 143.

### N9. The header lacks a status, a supersedes field and T-ids - Severity: Nit
* **Reviewer Lens:** `structural`
* **Affected Scope:** Lines 1-7, section 2
* **Discrepancy Description:** The header has no Status or Supersedes field, and section 2 has no T-ids.
* **Rationale & Recommendation:** Add both fields, and use T-ids in section 2.

### N10. The existing lyric jury criteria are not acknowledged - Severity: Nit
* **Reviewer Lens:** `codebase-details`
* **Affected Scope:** Line 155
* **Discrepancy Description:** The jury already has `original` and `singable` criteria, `PASS_SCORE` 0.7, and the judges Jev, Haiku and Gemini Flash (`lyric-jury.ts:14-41`).
* **Rationale & Recommendation:** Describe "extended" relative to these.

### N11. The blueprint location conflicts with the task-24 brief - Severity: Nit
* **Reviewer Lens:** `codebase-details`
* **Affected Scope:** Line 86; `task-24-brief.md:30`
* **Discrepancy Description:** This doc says `packages/shared`; the brief says `packages/remake`.
* **Rationale & Recommendation:** Pick one (see B11).

### N12. The Settings page is an empty shell, and keys come from env files - Severity: Nit
* **Reviewer Lens:** `codebase-details`
* **Affected Scope:** Lines 131-133; `apps/web/app/(app)/settings/page.tsx:10`, `apps/web/lib/openrouter-key.ts:9-55`
* **Discrepancy Description:** The doc assumes a Settings page and key storage that don't exist yet.
* **Rationale & Recommendation:** Say where token management, provider keys, the kill switch and the remake defaults will live.

### N13. `proxy.ts` calls `getUser()` on every `/api` request - Severity: Nit
* **Reviewer Lens:** `codebase-details`
* **Affected Scope:** `apps/web/proxy.ts:38,42-44`
* **Discrepancy Description:** The PAT and MCP routes would pay a pointless session lookup and could be blocked by it.
* **Rationale & Recommendation:** Exclude `/api/v1` and `/api/mcp` from the session proxy.
