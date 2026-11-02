# M1 Safe Agent Access Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Agents (Claude Code over stdio, claude.ai and ChatGPT over remote MCP) drive MellodifAI through one capped, audited operations layer, behind a Cloudflare tunnel that exposes only the MCP, API, OAuth and sign-in routes.

**Architecture:** Every write by people and agents goes through `ops.*` Postgres functions called by Next as `mdf_web` (and by `apps/auth` as `mdf_auth`); a database ledger reserves and settles every paid provider call; `apps/web/lib/ops/*` is the single implementation behind server actions, `/api/v1`, `/api/mcp` and the CLI's stdio bridge. Ops tooling (`@mellodifai/ops`, TypeScript on `tsx`) renders per-environment Supabase stacks, provisions role passwords, deploys from a dedicated clone and restores without losing media.

**Tech Stack:** pnpm monorepo, Next.js 16.4 (`apps/web`), Node worker (`apps/worker`), `packages/shared`, Supabase CLI stacks in Docker (Postgres 17), `postgres` npm client, `oidc-provider` (`apps/auth`), `@modelcontextprotocol/server` 2.4.0, vitest, Playwright, `tsx`, `esbuild`, `smol-toml`.

**Spec:** `docs/superpowers/specs/2026-11-01-agentic-studio-design.md`, revision 6 (21.2 is the M1 checklist; the plan argues from it). Read it next to this plan. Where a task says "per 11.5" or similar, that section is the contract.

## Global Constraints

- No em dash characters anywhere (code, copy, docs, commits). Use "-".
- Commit messages are plain, with no co-author or attribution lines. Builders commit and push without asking (OD7).
- Never spend kie or any other paid credits in tests; fakes or fake HTTP servers only (2.2, 19). Never run e2e against the live stack (54321, project `mellodifai`).
- Never print or commit keys, signing keys, JWT secrets or production passwords. Test-stack passwords go to files, not stdout.
- Runtime files (stacks, backups, logs, spikes, tmp, deploy clone) live under `MELLODIFAI_ROOT` (default `E:/mellodifai`), never on C:. CI uses `$RUNNER_TEMP`.
- Migrations are additive and each ships with database tests; the only revokes are in `ops_lockdown` (15). New files are numbered after `20261101000024_covers_on_kie_only.sql`, prefix `20261102`.
- Every new relative `.js` import inside `packages/shared/src` needs a `turbopack.resolveAlias` entry in `apps/web/next.config.ts`.
- Playwright runs only on the e2e stack (API 45621, Next on 3210; OAuth topology 3211 and 3212), or the isolated CI stack (API 54321) with `CI=true` and `E2E_ALLOW_LIVE_STACK=1`. The live stack is never allowed. The local progress ruling uses `E2E_PORT=3219` while the owner's launcher holds 3210.
- Every commit leaves `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm test:db` and `pnpm e2e` green (21.2).
- UI copy: Italian with correct accents, English glosses in docs (2.2).
- Every `ops` function: `security definer`, owner `postgres`, `set search_path = ''`, `set timezone = 'UTC'`, EXECUTE granted by name to exactly one of `mdf_web`, `mdf_auth`, `service_role` after `revoke execute ... from public, anon, authenticated` (6.3.2, revision 6).
- Error codes are frozen (6.3.5): `unauthorized`, `forbidden_scope`, `not_found`, `conflict`, `idempotency_mismatch`, `in_progress`, `ambiguous_spend`, `validation`, `cap_exceeded`, `rate_limited`, `internal`.
- Git Bash rewrites `/api/v1` style arguments; prefix `MSYS_NO_PATHCONV=1` (24).
- Owner actions (22) that are still open are never faked: a task that needs one stops at that step and records it as pending.

## Review Focus

1. **Owner sign-in on production right after the cutover, with SMTP not set up and the mail catcher off.** Expect `ops/sign-in-link.ts` to give a working link. Test: Task 9, `sign-in-link prints a link that verifies on the target stack`.
2. **Counters at the Europe/Rome day boundary and on the DST change night.** Expect a reservation at 23:30 UTC on 2026-03-28 (01:30 Rome on the 29th) to charge the 2026-03-29 window. Test: Task 16, `window_start follows Europe/Rome across midnight and DST`.
3. **Two concurrent calls with one idempotency key.** Expect one `new` and one `in_progress` (with `retry_after` 2), never two jobs. Test: Task 39, `parallel same-key POSTs create one job`.
4. **Jobs queued before the first production deploy.** Expect them to get an on-demand reservation before their first paid call, or fail with `cap_exceeded`, never to spend uncapped. Test: Task 24, `pre-migration job reserves on demand before the first paid call`.
5. **An OAuth client name with emoji, markup or 200 characters.** Expect it truncated to 60 characters, stored, and shown escaped on `/consent` and in Settings > Agenti. Test: Task 15 (`long and markup client names are truncated and stored`) and Task 43 (`consent page escapes the client name`).

---

## File Structure

| Area | Responsibility |
| --- | --- |
| `ops/` (`@mellodifai/ops`) | `lib/envs.ts` (the 5.3 per-environment table, one source), `lib/render.ts` (config render), `lib/runtime.ts` (paths), `lib/run.ts` (command runner, recordable in tests), `lib/roles.ts` (role passwords), `lib/pg.ts` (owner connection); one CLI file per tool: `stack.ts`, `check-no-keys.ts`, `rotate-db-passwords.ts`, `probe.ts`, `set-owner.ts`, `add-user.ts`, `sign-in-link.ts`, `services.ts`, `deploy.ts`, `restore.ts`, `cutover.ts`, `rotate-supabase-keys.ts`, `rotate-auth-keys.ts`, `edge-proxy.ts`, `test-db-guard.ts`; `cloudflared/config.template.yml`; tests in `ops/test/` |
| `supabase/migrations/20261102*` | `ops_roles`, `ops_layer` (core), `ops_tokens`, `spend_ledger`, `ledger_close`, `scheduler`, `ops_wrappers`, `ops_cookie_wrappers`, `ops_lockdown` |
| `supabase/tests/` | `helpers/pg.ts`, `helpers/ops-call.ts`, `ops_*.test.ts`, `acl-allowlist.json` |
| `packages/shared/src/ops/` | `errors.ts`, `reads.ts`, `inputs.ts`, `index.ts` |
| `apps/web/lib/ops/` | `context.ts`, `run.ts`, `defs/*.ts` (one per operation), `registry.ts`, `tokens.ts`, `rate.ts` |
| `apps/web/lib/mcp/` | `server.ts` (tool registry over `lib/ops/registry.ts`) |
| `apps/worker/src/providers/` | `paid.ts`, `kie-client.ts`, `ledger.ts`, `fake-servers.ts` (test only) |
| `apps/auth/` | `oidc-provider` service, adapter over `ops.oauth_*` |
| `packages/cli/` | CLI, stdio bridge, skill |

Migration file names (numbering continues after 026; visualizer logos and remakes occupy 025 and 026):

| File | Task |
| --- | --- |
| `20261102000027_ops_roles.sql` | 9 |
| `20261102000028_ops_layer.sql` | 14 |
| `20261102000029_ops_tokens.sql` | 15 |
| `20261102000030_spend_ledger.sql` | 16 |
| `20261102000031_ledger_close.sql` | 17 |
| `20261102000032_scheduler.sql` | 18 |
| `20261102000033_ops_wrappers.sql` | 19 |
| `20261102000034_ops_cookie_wrappers.sql` | 20 |
| `20261102000035_ops_lockdown.sql` | 32 |

The design names three additive migrations (`ops_roles`, `ops_layer`, `spend_ledger`); splitting them into reviewable files changes nothing that gets built (21.2 step 1 allows several files).

**How tests reach a stack.** `pnpm ops stack.ts env-file --env e2e` prints only the path of `<stack folder>/test.env` (it holds `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `TEST_DB_URL`, `TEST_MDF_WEB_URL`, `TEST_MDF_AUTH_URL`, `MDF_WEB_DATABASE_URL`, `MDF_AUTH_DATABASE_URL`, `SUPABASE_INTERNAL_URL`, `SITE_URL`, `MAILPIT_URL`). Every database test command below is:

```bash
set -a; . "$(pnpm -s ops stack.ts env-file --env e2e)"; set +a; pnpm test:db -- <file>
```

written below as `DBTEST <file>`.

---

## Step 0 - Spikes (21.2 step 0)

Spike code lives in `E:/mellodifai/spikes/<name>/` (never committed). Each spike ends by appending its written result to the "Spike results" section at the end of this file and committing that edit.

### Task 1: Spike 1 - `oidc-provider` wiring

**Files:**
- Modify: this plan, section "Spike results"

- [ ] **Step 1:** In `E:/mellodifai/spikes/oidc`, wire `oidc-provider` per 6.4 (revision 6): issuer from `MDF_AUTH_ISSUER`, mounted under `/oauth`, `proxy: true`, DCR, PKCE S256, code grant only, resource indicators limited to `<origin>/api/mcp`, opaque access tokens 1 h, rotating refresh 30 days, `interactions.url` returning `/oauth/interaction/<uid>`, an in-memory adapter keyed by `sha256(id)` that drops `jti` from stored payloads.
- [ ] **Step 2:** Verify and record: (a) the `_interaction` cookie set when the interaction starts reaches `/oauth/interaction/:uid/resume` (round-5 Major 13); (b) the `Interaction` row is saved through the adapter before `interactions.url` runs, so `oauth_flow_nonce_set` can update it; (c) `AuthorizationCode`, `AccessToken` and `RefreshToken` payloads carry `grantId` and no interaction uid (round-5 Major 12); (d) the adapter works with the hash as lookup key; (e) the claude.ai connector's redirect URIs, captured by connecting claude.ai to a temporary tunnel only if the owner's tunnel exists, otherwise from the claude.ai connector documentation; (f) what happens to `mdf_flow` with two flows in one browser (Nit 28 second half, recorded only).
- [ ] **Step 3:** If any of (a)-(d) cannot be made to work, record the fallback decision: `@node-oauth/oauth2-server` (6.4 "Spike fallback").
- [ ] **Step 4:** Commit: `git add docs/superpowers/plans/2026-11-02-m1-agent-access.md && git commit -m "docs: M1 spike 1 result (oidc-provider wiring)"`

### Task 2: Spike 2 - the database stack

**Files:**
- Modify: this plan, section "Spike results"

- [ ] **Step 1:** In `E:/mellodifai/spikes/stack`, render a copy of `supabase/config.toml` with `project_id = "mellodifai_spike"` and ports 46621-46629, start it with `supabase start --workdir E:/mellodifai/spikes/stack`, and record: `select rolname from pg_roles where rolcanlogin` (every login role, 5.3 item 3); how each service container receives its password; whether `signing_keys_path` and `--workdir` work outside the checkout.
- [ ] **Step 2:** Rotate every login role's password, re-template the containers, restart with `supabase stop` and `supabase start` (no `--no-backup`) and record whether the rotation survives the restart (round-5 Major 20). Record the re-apply procedure that works after a restart.
- [ ] **Step 3:** Record: whether `[studio]`, `[inbucket]` and `[analytics]` with `enabled = false` start cleanly and leave their ports closed (round-5 Major 2); the column type of `auth.sessions.refreshed_at` and `created_at` (round-5 Major 3); whether a `postgres`-owned definer function can read `auth.sessions`; what the CLI does with containers and volumes when `project_id` changes and when two stacks share a `project_id` (round-5 Major 17).
- [ ] **Step 4:** Run the container probe by hand: from `docker run --rm postgres:17 psql "postgresql://<role>:postgres@host.docker.internal:46622/postgres"` for every listed role; record that each fails after rotation.
- [ ] **Step 5:** If the CLI stack cannot take per-role passwords that survive restarts, record the compose fallback and, for each of `supabase gen signing-key`, `status -o json`, `signing_keys_path`, the email template's `content_path`, `[auth.sessions]` and the restore's stop and start, its compose equivalent (round-5 Major 20). Tasks 5-12 then follow the compose equivalents.
- [ ] **Step 6:** `supabase stop --workdir E:/mellodifai/spikes/stack --no-backup` (spike project only), then commit: `git add docs/superpowers/plans/2026-11-02-m1-agent-access.md && git commit -m "docs: M1 spike 2 result (database stack)"`.

### Task 3: Spike 3 - MCP transport in a Next 16.4 route

**Files:**
- Modify: this plan, section "Spike results"

- [ ] **Step 1:** In a scratch route of a throwaway Next app under `E:/mellodifai/spikes/mcp`, build a per-request `McpServer` with `WebStandardStreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true })` from `@modelcontextprotocol/server@2.4.0`, one tool, Node runtime, GET answering 405.
- [ ] **Step 2:** Run `npx @modelcontextprotocol/inspector --cli http://127.0.0.1:<port>/api/mcp --method tools/list` and `--method tools/call --tool-name ping`; record the outcome and, on failure, the `mcp-handler` fallback result.
- [ ] **Step 3:** Commit the result in this plan file: `git commit -m "docs: M1 spike 3 result (MCP transport)"` after staging only this file.

---

## Step 1 - Ops tooling first, then the additive database (21.2 step 1, revision 6)

Production stays on its pre-M1 commit through steps 1-4: `ops/deploy.ts` refuses every target until the `m1-floor` tag exists (Task 11).

### Task 4: `@mellodifai/ops` package and `check-no-keys`

**Files:**
- Create: `ops/package.json`, `ops/tsconfig.json`, `ops/lib/runtime.ts`, `ops/lib/run.ts`, `ops/check-no-keys.ts`, `ops/test/check-no-keys.test.ts`, `.githooks/pre-commit`
- Modify: `pnpm-workspace.yaml` (add `ops`; `apps/*` already covers `apps/auth`, Nit 7), root `tsconfig.json` (reference `ops`), root `package.json` (script `"ops": "pnpm --filter @mellodifai/ops exec tsx"`, `"prepare": "git config core.hooksPath .githooks"`), `.github/workflows/ci.yml` (run check-no-keys in `checks`)

**Interfaces:**
- Produces: `runtimeRoot(): string` (`MELLODIFAI_ROOT` or `E:/mellodifai`); `type Runner = (cmd: string, args: string[], opts?: { cwd?: string; env?: Record<string, string>; input?: string }) => Promise<{ code: number; stdout: string; stderr: string }>`; `realRunner: Runner`; `recordingRunner(replies?): Runner & { calls: Array<{ cmd: string; args: string[] }> }`; `findKeyMaterial(roots: string[]): Promise<Array<{ path: string; reason: 'name' | 'jwk' }>>`.

- [ ] **Step 1: Write the failing tests** in `ops/test/check-no-keys.test.ts` on a temp folder under `E:/mellodifai/tmp/ops-test-<random>` (or `$RUNNER_TEMP`):

```ts
it("flags signing key and jwks file names", async () => {
  // files: a/signing_keys.json, b/my-jwks.json
  expect((await findKeyMaterial([root])).map((f) => f.reason)).toEqual(["name", "name"]);
});
it("flags a private JWK by kty plus d, not a bare d", async () => {
  // c.json = {"kty":"EC","d":"x"} -> flagged; d.json = {"d":"x"} -> not flagged (Nit 8)
});
it("scans ignored folders but skips node_modules, .git, .next, .turbo and .claude/worktrees", async () => {});
it("scans <runtime root>/stacks when given as a root (round-5 Major 1)", async () => {});
```

- [ ] **Step 2:** Run `pnpm --filter @mellodifai/ops exec vitest run test/check-no-keys.test.ts`. Expected: FAIL (module missing).
- [ ] **Step 3:** Implement `findKeyMaterial` and the CLI (`tsx check-no-keys.ts [--root <dir>]...`, default roots: the repo root and `<runtime root>/stacks` when it exists; exit 1 and list paths, never file contents). `.githooks/pre-commit` runs `pnpm -s ops check-no-keys.ts`.
- [ ] **Step 4:** Run the tests and `pnpm ops check-no-keys.ts`. Expected: PASS, exit 0 on the repo.
- [ ] **Step 5:** Commit: `git add ops .githooks pnpm-workspace.yaml tsconfig.json package.json pnpm-lock.yaml .github/workflows/ci.yml && git commit -m "feat(ops): ops package and check-no-keys with pre-commit hook"`

### Task 5: Per-environment stack render (`ops/lib/envs.ts`, `ops/lib/render.ts`)

**Files:**
- Create: `ops/lib/envs.ts`, `ops/lib/render.ts`, `ops/test/render.test.ts`
- Modify: `ops/package.json` (dependency `smol-toml`)

**Interfaces:**
- Produces: `type StackEnv = "dev" | "e2e" | "ci" | "prod"`; `ENV_TABLE: Record<StackEnv, StackValues>` with `projectId`, `siteUrl`, `redirectUrls: string[]`, `issuer: string | null`, `ports: { api; db; studio; inbucket; analytics }` (number or `null` when off), `smtp: "catcher" | "owner"`, `signingKeysPath`, `jwtSecretFromEnv: boolean`, `sessions: { timebox?: string; inactivityTimeout?: string }`, `fakeStack: boolean`, `emailSentPerHour: number`; `renderConfig(baseToml: string, env: StackEnv, stackDir: string): string`; `stackDir(env: StackEnv): string` (`<runtime root>/stacks/<env>`, CI `$RUNNER_TEMP/stack`).

- [ ] **Step 1: Write the failing tests** (values exactly from the 5.3 table, revision 6):

```ts
it("prod keeps project mellodifai on 54321/54322 and turns Studio, mail catcher and analytics off", () => {
  const t = parse(renderConfig(base, "prod", dir));
  expect(t.project_id).toBe("mellodifai");
  expect([t.api.port, t.db.port]).toEqual([54321, 54322]);
  expect([t.studio.enabled, t.inbucket.enabled, t.analytics.enabled]).toEqual([false, false, false]); // Major 2
  expect(t.auth.jwt_secret).toBe("env(MDF_SUPABASE_JWT_SECRET)"); // Major 1: never a value
  expect(t.auth.rate_limit.email_sent).toBe(30); // Nit 24
  expect(t.auth.sessions).toEqual({ timebox: "168h", inactivity_timeout: "24h" });
});
it("dev is mellodifai_dev on 55321-55327 with SITE_URL 127.0.0.1:3001 (Majors 17, 18)", () => {});
it("e2e is mellodifai_e2e on 45621-45627; ci is mellodifai_ci on 54321-54327", () => {});
it("e2e and ci allow redirects to 3210 and 3212 and set the issuer to 127.0.0.1:3212/oauth (Major 16)", () => {});
it("signing_keys_path points outside the repo for every env", () => {});
it("the rendered config links migrations, seed and templates of the repo", () => {});
```

- [ ] **Step 2:** Run `pnpm --filter @mellodifai/ops exec vitest run test/render.test.ts`. Expected: FAIL.
- [ ] **Step 3:** Implement with `smol-toml` parse and stringify; `ENV_TABLE` is the only place these values live. The prod signing key path is `<runtime root>/secrets/supabase/signing_keys.json`; dev and e2e use `<stack folder>/signing_keys.json`, CI `$RUNNER_TEMP/signing_keys.json`.
- [ ] **Step 4:** Run the tests. Expected: PASS.
- [ ] **Step 5:** Commit: `git commit -m "feat(ops): per-environment Supabase config render"` (stage `ops/` and the lockfile).

### Task 6: `ops/stack.ts` - start, migrate, env file, role passwords, prod refusals

**Files:**
- Create: `ops/stack.ts`, `ops/lib/roles.ts`, `ops/lib/pg.ts`, `ops/test/stack.test.ts`, `ops/test/roles.test.ts`

**Interfaces:**
- Consumes: Task 5 `renderConfig`, `stackDir`, `ENV_TABLE`; Task 4 `Runner`.
- Produces: CLI `stack.ts <render|start|stop|migrate|reset|env-file> --env <env>`; `applyRolePasswords(ownerUrl: string, passwords: { mdf_web: string; mdf_auth: string }): Promise<{ set: string[]; absent: string[] }>`; `readStackPasswords(env): Promise<{ mdf_web; mdf_auth }>` (dev, e2e: random values created once in `<stack folder>/role-passwords.json`; ci: random per run; prod: `<runtime root>/secrets/supabase/db-passwords.json` from Task 8); `planStackCommand(cmd, env, flags): string[][]` (pure; the CLI runs its output).

- [ ] **Step 1: Write the failing tests:**

```ts
it("refuses reset, db reset and stop --no-backup on project mellodifai (Major 17)", () => {
  expect(() => planStackCommand("reset", "prod", {})).toThrow(/ops\/restore\.ts/);
  expect(() => planStackCommand("stop", "prod", { noBackup: true })).toThrow();
});
it("start runs supabase start --workdir, then sets role passwords, then writes test.env", () => {});
it("migrate runs migration up --workdir then re-applies role passwords", () => {});
it("env-file prints only a path and the file holds no prod values", () => {});
// roles.test.ts, against the e2e stack:
it("applyRolePasswords reports absent roles and does not create them", async () => {});
it("applyRolePasswords sets LOGIN PASSWORD on mdf_web and mdf_auth when they exist", async () => {});
it("dev stack gets mdf_web and mdf_auth passwords too (Nit 21)", () => {});
```

- [ ] **Step 2:** Run `pnpm --filter @mellodifai/ops exec vitest run test/stack.test.ts test/roles.test.ts`. Expected: FAIL.
- [ ] **Step 3:** Implement. `applyRolePasswords` runs `alter role <r> login password '<p>'` only for roles present in `pg_roles`, through the stack owner URL (`postgresql://postgres:<owner password>@127.0.0.1:<db port>/postgres`). `test.env` is written with mode 0600 (Windows: `icacls /inheritance:r /grant:r "%USERNAME%:F"`). The `stack_settings.fake_stack` write is added by Task 14.
- [ ] **Step 4:** Run the tests; then `pnpm ops stack.ts render --env e2e && pnpm ops stack.ts start --env e2e` and `DBTEST supabase/tests/queue.test.ts`. Expected: PASS; existing suite still green.
- [ ] **Step 5:** Commit: `git commit -m "feat(ops): stack start, migrate and env file with role passwords"`

### Task 7: CI, Playwright and script wiring

**Files:**
- Create: `ops/test-db-guard.ts`, `ops/test/test-db-guard.test.ts`
- Modify: `.github/workflows/ci.yml`, root `package.json` (`test:db` runs the guard first; `postgres` dev dependency), `apps/web/package.json` (`dev`: `next dev -H 127.0.0.1 -p 3001`; `start`: `next start -H 127.0.0.1 -p 3000`), `apps/web/playwright.config.ts`, `apps/web/e2e/local-env.ts`, `apps/web/e2e/support.ts`

**Interfaces:**
- Produces: `assertTestStack(env: Record<string, string | undefined>): void` - throws unless `TEST_DB_URL` and `SUPABASE_URL` are loopback and not the prod block (54321, 54322), except when `CI === "true"` (Nit 12: this is the guard 19 describes; it is created here).

- [ ] **Step 1: Write the failing tests:** `refuses 54321 and 54322 outside CI`, `accepts 45621`, `accepts 54321 when CI=true`, `refuses a non-loopback host`.
- [ ] **Step 2:** Run them. Expected: FAIL.
- [ ] **Step 3:** Implement the guard; `test:db` becomes `tsx ops/test-db-guard.ts && vitest run --no-file-parallelism supabase/tests`. `ci.yml` `db` job: `pnpm ops check-no-keys.ts`, `pnpm ops stack.ts render --env ci`, `pnpm ops stack.ts start --env ci`, append `test.env` to `$GITHUB_ENV` (masking each value with `::add-mask::` before appending), set `E2E_ALLOW_LIVE_STACK=1`, `WORKER_FAKE=1`, then `pnpm test:db` and `pnpm e2e`. `playwright.config.ts`: the `webServer` command becomes `pnpm --filter @mellodifai/web exec next dev -H 127.0.0.1 -p ${port}` (it no longer appends flags to the `dev` script, which now carries its own; Nit 26), pass `SUPABASE_INTERNAL_URL`, `MDF_WEB_DATABASE_URL`, `SITE_URL` (and keep `NEXT_PUBLIC_SITE_URL` until Task 37 removes it). `support.ts` reads `MAILPIT_URL` (default `http://127.0.0.1:45624`).
- [ ] **Step 4:** Run the guard tests, `pnpm e2e` on the e2e stack, and push a branch to see CI green.
- [ ] **Step 5:** Commit: `git commit -m "ci: render the CI stack with ops tooling and add the test:db guard"`

### Task 8: Database password rotation and the container probe

**Files:**
- Create: `ops/rotate-db-passwords.ts`, `ops/probe.ts`, `ops/test/rotate.test.ts`, `ops/test/probe.test.ts`

**Interfaces:**
- Consumes: spike 2 result (role list, re-template procedure); Task 6 `applyRolePasswords`.
- Produces: `rotateDbPasswords(env: StackEnv, runner: Runner): Promise<void>` (writes `<runtime root>/secrets/supabase/db-passwords.json` for prod, owner-only ACL); `reapplyDbPasswords(env, runner): Promise<void>` (Task 10 and Task 11 call it after every start); `probe(env, runner): Promise<{ ok: boolean; failures: string[] }>`; `rewriteEnvUrl(file: string, name: string, url: string): Promise<void>`.

- [ ] **Step 1: Write the failing tests:**

```ts
it("rotates every login role from spike 2 plus mdf_web and mdf_auth", async () => {});
it("rewrites MDF_WEB_DATABASE_URL in apps/web/.env.local and MDF_AUTH_DATABASE_URL in apps/auth/.env.local without printing them (Nit 6)", async () => {});
it("probe fails a role that still accepts the password postgres", async () => {});
it("probe requires 54323, 54324 and 54327 to refuse connections from a container (Major 2)", async () => {});
it("probe output names roles and ports only, never passwords", async () => {});
```

Unit tests use `recordingRunner`; one integration test runs `probe("e2e")` against the e2e stack's ports (45622-45627; the e2e stack keeps Studio on, so the test asserts the probe reports 45623 as open, proving it checks).
- [ ] **Step 2:** Run them. Expected: FAIL.
- [ ] **Step 3:** Implement per 5.3 item 3 and spike 2 (or the compose fallback). The probe runs `docker run --rm --add-host host.docker.internal:host-gateway postgres:17 ...` per role and a TCP connect per port; for `mdf-web` it also connects as the current account (the account check moves to Task 35).
- [ ] **Step 4:** Run the tests. Expected: PASS.
- [ ] **Step 5:** Commit: `git commit -m "feat(ops): rotate every database login password and probe from a container"`

### Task 9: `ops_roles` migration, `set-owner`, `add-user`, `sign-in-link`

**Files:**
- Create: `supabase/migrations/20261102000027_ops_roles.sql`, `supabase/tests/ops_roles.test.ts`, `supabase/tests/helpers/pg.ts`, `ops/set-owner.ts`, `ops/add-user.ts`, `ops/sign-in-link.ts`, `ops/test/set-owner.test.ts`
- Modify: `supabase/seed.sql` (`insert into admin_allowlist (email, role) values ('admin@mellodifai.local', 'admin')`), `apps/web/e2e/global-setup.ts` (e2e admin with role `admin`, a second user with role `customer`)

**Interfaces:**
- Produces: `ownerSql(url?: string)` in `supabase/tests/helpers/pg.ts` (a `postgres` client on `TEST_DB_URL`); `setOwner(sql, ownerEmail: string): Promise<{ admins: 1 }>` (throws unless exactly one admin results); `addUser(sql, admin, email: string, role: "admin" | "customer")`; `signInLink(admin, email: string, siteUrl: string): Promise<string>`. `MELLODIFAI_OWNER_EMAIL` is read from the environment, else from `<runtime root>/config/ops.env` (Nit 6).

- [ ] **Step 1: Write the failing tests:**

```ts
it("a new allowlisted user becomes a customer", async () => {});
it("the migration copies today's roles from profiles", async () => {});
it("emails differing only by case are refused by the unique index", async () => {});
it("setOwner leaves exactly one admin in both tables and throws on zero", async () => {});
it("addUser inserts the allowlist row before createUser", async () => {});
it("sign-in-link prints a link that verifies on the target stack", async () => {}); // Review Focus 1
```

- [ ] **Step 2:** `DBTEST supabase/tests/ops_roles.test.ts` and `pnpm --filter @mellodifai/ops exec vitest run test/set-owner.test.ts`. Expected: FAIL.
- [ ] **Step 3:** Implement the migration exactly as 15.1 `ops_roles`; `create_allowlisted_profile` reads the role from the allowlist row by `lower(email)`. `sign-in-link.ts` uses `auth.admin.generateLink({ type: "magiclink", email, options: { redirectTo: <SITE_URL>/auth/confirm } })` with the service key read from `apps/worker/.env.local`, prints the link and nothing else.
- [ ] **Step 4:** `pnpm ops stack.ts migrate --env e2e`, rerun both test commands and `pnpm e2e`. Expected: PASS.
- [ ] **Step 5:** Commit: `git commit -m "feat(db): ops_roles with customer default, set-owner, add-user and sign-in-link"`

### Task 10: `ops/services.ts` - start, stop, status and the runtime-root ACL

**Files:**
- Create: `ops/services.ts`, `ops/lib/services.ts`, `ops/test/services.test.ts`

**Interfaces:**
- Consumes: Task 8 `reapplyDbPasswords`, `probe`.
- Produces: `SERVICE_ORDER = ["supabase", "worker", "auth", "web", "edge", "cloudflared"] as const`; `planStart(present: Set<Service>): Service[]`; `startAll(runner, opts: { root: string; present: Set<Service> }): Promise<void>` (after `supabase`, calls `reapplyDbPasswords("prod")` and `probe("prod")`; refuses to start `cloudflared` when the probe fails, round-5 Major 20); `stopAll(runner, services: Service[])`; `aclCommands(root: string): string[][]` (`icacls <root> /inheritance:r /grant:r "<owner>:(OI)(CI)F" "SYSTEM:(OI)(CI)F"`, round-5 Major 1).

- [ ] **Step 1: Write the failing tests:** `starts in SERVICE_ORDER and skips services the target lacks`, `re-applies passwords and probes after supabase starts`, `never starts cloudflared when the probe fails`, `acl removes inheritance and grants only the owner and SYSTEM`.
- [ ] **Step 2:** Run them. Expected: FAIL.
- [ ] **Step 3:** Implement. Today's processes run under the owner's account (the separate accounts arrive in Task 35); processes are started detached with logs in `<runtime root>/logs/<service>.log`. `services.ts acl` prints the commands and runs them only with `--apply` (administrator rights may be needed; an owner action if refused).
- [ ] **Step 4:** Run the tests; run `pnpm ops services.ts acl` (print only). Expected: PASS.
- [ ] **Step 5:** Commit: `git commit -m "feat(ops): service start and stop with password re-apply, probe and runtime ACL"`

### Task 11: `ops/deploy.ts`

**Files:**
- Create: `ops/deploy.ts`, `ops/lib/deploy-plan.ts`, `ops/test/deploy.test.ts`

**Interfaces:**
- Consumes: Tasks 4, 6, 8, 9, 10.
- Produces: `planDeploy(input: { target: string; hasAuth: boolean; skipMigrations: boolean }): DeployStep[]` (pure); `assertAtOrAfterFloor(repo: string, target: string, runner): Promise<void>`; CLI `deploy.ts --to <tag|main> [--skip-migrations]`.

- [ ] **Step 1: Write the failing tests** (round-5 Blocker 1, 20 revision 6):

```ts
it("copies the invoking checkout's ops package to <root>/ops-pinned/<ts> and runs every tool from there", () => {});
it("acts on the deploy clone <root>/deploy, never on the invoking checkout", () => {});
it("orders: stop, backup, fetch+checkout, check-no-keys, install, migrate, reapply passwords, set-owner, build, start, health", () => {});
it("skips the apps/auth build and start when the target has no apps/auth", () => {});
it("refuses every target while the m1-floor tag does not exist", async () => {});
it("refuses a tag that does not contain m1-floor", async () => {});
it("refuses when stack_settings.fake_stack is on in prod", async () => {});
it("on a failed health check rolls back only when no migration was applied; otherwise leaves services stopped and logs to deploy.log", async () => {});
```

Git cases use a temp repo under `E:/mellodifai/tmp`.
- [ ] **Step 2:** Run them. Expected: FAIL.
- [ ] **Step 3:** Implement. Backup: `supabase db dump --data-only --schema public,auth,storage --workdir <root>/stacks/prod -f <root>/backups/<timestamp>-<tag>.sql`, 14-day retention. Health: local `GET http://127.0.0.1:3000/api/health` must show `ops: "ok"` and the target's newest migration as `schema`.
- [ ] **Step 4:** Run the tests. Expected: PASS.
- [ ] **Step 5:** Commit: `git commit -m "feat(ops): deploy from a pinned ops copy onto a dedicated deploy clone"`

### Task 12: `ops/restore.ts` and `ops/cutover.ts`

**Files:**
- Create: `ops/restore.ts`, `ops/cutover.ts`, `ops/lib/counts.ts`, `ops/test/restore.test.ts`, `ops/test/cutover.test.ts`

**Interfaces:**
- Produces: `tableCounts(sql): Promise<Record<string, number>>` (every table in `public`, `auth`, `storage`); `compareCounts(before, after): string[]` (names that differ); `planRestore(backup: string): Step[]`; `planCutover(): Step[]`.

- [ ] **Step 1: Write the failing tests:**

```ts
it("restore takes a safety backup, checks out the backup's tag, runs db reset --no-seed --workdir prod, psql -f, reapplies passwords, deploys with --skip-migrations (Major 19)", () => {});
it("restore never runs supabase stop --no-backup", () => {});
it("cutover: counts, backup, stop, render prod with project mellodifai, start --workdir, counts again, refuses on any difference (Major 17)", () => {});
it("an end-to-end restore on the e2e stack keeps storage objects readable", async () => {}); // upload a file, dump, restore, download it
```

- [ ] **Step 2:** Run them. Expected: FAIL.
- [ ] **Step 3:** Implement. `restore.ts` is the only caller allowed to run `db reset` on the prod project (it passes an internal `--restore` flag that `stack.ts` accepts only from this module).
- [ ] **Step 4:** Run the tests. Expected: PASS.
- [ ] **Step 5:** Commit: `git commit -m "feat(ops): restore by database reset and the one-time prod cutover"`

### Task 13: `/api/health` and the remote test

**Files:**
- Create: `apps/web/app/api/health/route.ts`, `apps/web/lib/remote.ts`, `apps/web/lib/remote.test.ts`, `apps/web/app/api/health/route.test.ts`

**Interfaces:**
- Produces: `isRemote(headers: Headers): boolean` (true when any of `x-mdf-remote: 1`, `cf-connecting-ip`, `cf-ray` is present, 5.1); `GET /api/health` -> remote `{ web: "ok" }`; local `{ web, db, worker_heartbeat_age_s, queue_depth, version, schema }` (Task 14 adds `ops`).

- [ ] **Step 1: Write the failing tests:** `remote callers get only web`, `local callers get schema as the newest applied migration`, `isRemote is true for each of the three headers`.
- [ ] **Step 2:** `pnpm --filter @mellodifai/web exec vitest run lib/remote.test.ts app/api/health`. Expected: FAIL.
- [ ] **Step 3:** Implement with the server-only service-role client: `db` from a trivial query, heartbeat age and queue depth from `workers` and `jobs`, `schema` as `max(version)` of `supabase_migrations.schema_migrations`, `version` from the deployed tag (`git describe` output written at build time into `apps/web/.next/mdf-version`, else `"dev"`).
- [ ] **Step 4:** Run the tests. Expected: PASS.
- [ ] **Step 5:** Commit: `git commit -m "feat(web): health route with local detail and remote minimum"`

### Task 14: `ops_layer` core - roles, schema, settings reset, errors, idempotency, health

**Files:**
- Create: `supabase/migrations/20261102000028_ops_layer.sql`, `supabase/tests/ops_core.test.ts`, `supabase/tests/ops_errors.test.ts`, `packages/shared/src/ops/errors.ts`, `packages/shared/src/ops/index.ts`, `apps/web/lib/db/ops-client.ts`
- Modify: `packages/shared/src/index.ts` (export `./ops/index.js`), `apps/web/next.config.ts` (resolveAlias `"./ops/index.js"` and `"./errors.js"` to their `.ts` files), `apps/web/app/api/health/route.ts` (`ops` field), `ops/stack.ts` (writes `stack_settings.fake_stack` from `ENV_TABLE` after start and migrate), `apps/web/package.json` (`postgres`)

**Interfaces:**
- Produces (SQL): roles `mdf_web`, `mdf_auth` (guarded, `nologin noinherit`); schema `ops` created **before** its `alter default privileges` lines (Nit 1); tables `idempotency_keys` (with `actor_key` defined as `<actor_kind>:<user id or token id>`, Nit 5), `audit_log`, `app_flags` (rows seeded off), `scheduled_tasks`, `ops_health`, `stack_settings` (one row), `versions.test_run`; internal functions `ops._enter()` (resets `mdf.job_ids`, `mdf.job_ctx` and the three claim settings locally, Major 3), `ops._actor(p_ctx jsonb) returns record (user_id uuid, role text, actor_kind text, token_id uuid, scopes text[], test_mode boolean, remote boolean)`, `ops._fake_stack() returns boolean` (true only when `stack_settings.fake_stack` and not `current_setting('mdf.force_caps', true) = 'on'`), `ops.map_error(sqlstate text, message text) returns jsonb` (`{code, reason}`); public to `mdf_web`: `ops.idem_begin(p_ctx, key, request_hash) returns jsonb`, `ops.health() returns jsonb`, `ops.flags() returns jsonb`.
- Produces (TS): `OPS_ERROR_CODES`, `type OpsErrorCode`, `HTTP_STATUS: Record<OpsErrorCode, number>`, `MDF_STATES` (the 6.3.5 table); `type OpsError = { code: OpsErrorCode; message: string; details?: unknown; retry_after?: number }`; `type OpsResult<T> = { ok: true; data: T } | ({ ok: false } & OpsError)`; `opsSql(): Sql` (singleton on `MDF_WEB_DATABASE_URL`, max 10 connections); `callOps<T>(fn: string, args: unknown[]): Promise<OpsResult<T>>`.

- [ ] **Step 1: Write the failing tests:**

```ts
// ops_core.test.ts
it("creates mdf_web and mdf_auth only once and as nologin roles without memberships", async () => {});
it("health as mdf_web writes and reads back the heartbeat", async () => {});
it("idem_begin returns new, replay, idempotency_mismatch and in_progress; takes over a 10-minute-old in_flight row", async () => {});
it("a refusal before work deletes the in_flight key (Nit 5)", async () => {});
it("an ops function ignores a preset mdf.job_ctx and preset claims (Major 3)", async () => {});
it("session recency is compared in UTC under TimeZone Etc/GMT-14 (Major 3)", async () => {}); // a 15-hour-old session is refused
it("mdf_web cannot update stack_settings; mdf.force_caps on turns caps on and nothing turns them off", async () => {});
// ops_errors.test.ts
it("maps MDF02 and MDF06 to cap_exceeded, MDF03 to unauthorized, MDF05 to internal with reason price_missing", async () => {});
it("checks the SQLSTATE before message rules: an MDF message ending in required is not conflict", async () => {});
it("maps uploaded audio required and current take required to validation (Nit 17)", async () => {});
it("every raise reachable from an ops function maps to a code other than internal", async () => {}); // 6.3.5 graph walk, re-run by later tasks
```

- [ ] **Step 2:** Before migrating, run `DBTEST supabase/tests/ops_core.test.ts supabase/tests/ops_errors.test.ts`. Expected: FAIL.
- [ ] **Step 3:** Write the migration per 6.3.1, 6.3.2, 6.3.4 (revision 6), 6.3.5 (revision 6), 15.1; Nit 17: add `uploaded audio required` and `current take required` to rule 5 (`validation`). Put every `ops` function under `set search_path = '' set timezone = 'UTC'`.
- [ ] **Step 4:** `pnpm ops stack.ts migrate --env e2e` (passwords re-applied, fake flag written), rerun the tests, `pnpm test`, `pnpm e2e`. Expected: PASS.
- [ ] **Step 5:** Commit: `git commit -m "feat(db): ops layer core with settings reset, error map and idempotency"`

### Task 15: `ops_tokens` - tokens, OAuth storage, pairing, consent

**Files:**
- Create: `supabase/migrations/20261102000029_ops_tokens.sql`, `supabase/tests/ops_oauth.test.ts`, `supabase/tests/ops_tokens.test.ts`

**Interfaces:**
- Produces (to `mdf_web`): `ops.admin_token_create(p_ctx, name text, token_hash text, token_hint text, scopes text[], remote boolean, test_mode boolean, expires_at timestamptz) returns jsonb`, `ops.admin_token_revoke(p_ctx, token_id uuid)`, `ops.admin_tokens_list(p_ctx)`, `ops.admin_flag_set(p_ctx, flag text, enabled boolean)`, `ops.admin_pairing_open(p_ctx)` (Nit 2), `ops.admin_pairing_status(p_ctx)` (window end and the claiming client, Major 27), `ops.resolve_access_token(token_hash text, resource text)`, `ops.oauth_consent_info(p_ctx, uid text, nonce text)`, `ops.oauth_consent(p_ctx, uid text, nonce text, scopes text[], test_mode boolean)`.
- Produces (to `mdf_auth`): `ops.oauth_find`, `ops.oauth_find_by_uid`, `ops.oauth_upsert(model, id_hash, payload, grant_id, uid, expires_at)`, `ops.oauth_consume`, `ops.oauth_destroy`, `ops.oauth_revoke_by_grant`, `ops.oauth_registration_claim(client_id text, client_name text, redirect_uris text[]) returns boolean`, `ops.oauth_flow_nonce_set(uid text, nonce_hash text)`, `ops.oauth_interaction_result(uid text, nonce text)`, `ops.oauth_bind_grant(uid text, grant_id text)`.

- [ ] **Step 1: Write the failing tests:**

```ts
it("a customer cannot create a token or complete a consent (forbidden_scope)", async () => {});
it("every new token gets its 1 USD per day spend_caps row; a token without one is refused with no_cap", async () => {});
it("a token call re-checks the owner's role: a token of a demoted owner is refused (Nit 30)", async () => {});
it("a remote PAT needs remote_mcp on (Nit 29)", async () => {});
it("oauth_upsert accepts AccessToken only through grant -> agent_tokens -> used consent with same client and subset scopes (Major 12)", async () => {});
it("oauth_upsert refuses a grant without a used consent and a lifetime over the limit (MDF03)", async () => {});
it("oauth_flow_nonce_set stores the hash on an existing Interaction row only (Major 13)", async () => {});
it("oauth_interaction_result is single use and needs the matching nonce", async () => {});
it("registration_claim succeeds once per window and closes it (Major 27)", async () => {});
it("a loopback-only client consent is refused when remote is true (Major 27)", async () => {});
it("consent for the same client revokes the expired grant and the abandoned unbound row first (Major 14)", async () => {});
it("long and markup client names are truncated to 60 characters and stored (Nit 19, Review Focus 5)", async () => {});
it("revoke deletes the grant's oauth_store rows; resolve_access_token then returns unauthorized", async () => {});
it("remote_mcp off makes resolve_access_token and oauth_consent fail", async () => {});
```

- [ ] **Step 2:** `DBTEST supabase/tests/ops_oauth.test.ts supabase/tests/ops_tokens.test.ts`. Expected: FAIL.
- [ ] **Step 3:** Write the migration per 6.4, 6.6 and 15.1 (revision 6). `oauth_consent` stores `oauth_pairing.loopback_only` from the claiming client and refuses `remote = true` for it.
- [ ] **Step 4:** Migrate the e2e stack, rerun, plus `ops_errors.test.ts`. Expected: PASS.
- [ ] **Step 5:** Commit: `git commit -m "feat(db): tokens, OAuth storage, pairing claim and consent rules"`

### Task 16: `spend_ledger` - tables, seeds, `reserve_job`, `extend_reservation`

**Files:**
- Create: `supabase/migrations/20261102000030_spend_ledger.sql`, `supabase/tests/ops_ledger.test.ts`, `supabase/tests/helpers/caps.ts`

**Interfaces:**
- Produces: tables of 15.1 `spend_ledger` (with revision-6 columns `reservations.kie_submit_reserved`, `kie_generation`, `section_edit_id`; `spend_entries.over_estimate`); `jobs` columns `token_id`, `run_id`, `resource_class`, `priority`, `fake_providers`; triggers `jobs_set_resource_class`, `jobs_mark_reservation_gone`; `ops.price(provider, model, unit) returns numeric` (raises `MDF05`); `ops.job_spend_rule(p_job uuid) returns table(provider text, model text, items jsonb)`; `ops.reserve_job(p_job uuid) returns uuid`; `ops.extend_reservation(p_reservation uuid, p_provider text, p_model text, p_items jsonb) returns void`; test helper `withRealCaps(sql, fn)` (one transaction, `set local mdf.force_caps = 'on'`, `set local role mdf_web` where a wrapper is called).

- [ ] **Step 1: Write the failing tests:**

```ts
it("empty spend_caps: every paid path refuses with cap_exceeded reason no_cap", async () => {});
it("20 parallel reservations on a fresh window stay within the cap", async () => {}); // 20 connections, each withRealCaps
it("a missing price raises MDF05 and nothing is reserved", async () => {});
it("the user's own row wins per (provider, unit, period); the role default applies otherwise", async () => {});
it("reserve_job is idempotent per job: a second call returns the open reservation (Nit 4)", async () => {});
it("generate_song with a task id from an older generation reserves kie (Major 5)", async () => {});
it("a true resume (kie_generation = generation_count) reserves Groq only and kie_submit_reserved is false", async () => {});
it("window_start follows Europe/Rome across midnight and DST", async () => {}); // Review Focus 2
it("the seeded customer USD day cap is at least three times the draft_lyrics strong-writer estimate", async () => {});
it("tests that need fixed prices update the price rows explicitly (Nit 14)", async () => {});
```

- [ ] **Step 2:** `DBTEST supabase/tests/ops_ledger.test.ts`. Expected: FAIL.
- [ ] **Step 3:** Write the migration per 11.5 (revision 6) and 15.1. Seed prices from `KIE_CREDITS` (`packages/shared/src/rewrite.ts:32-37`) at 0.005 USD per credit (`verified = false`), OpenRouter model prices fetched once from `https://openrouter.ai/api/v1/models` at writing time (no key, no spend; `checked_on` and `source` recorded), Groq `audio_hour` 0.1. Caps as the 11.5 table; if the recomputed estimate puts 0.50 below three times it, raise the customer default to the next 0.25 step and record why in the migration comment.
- [ ] **Step 4:** Migrate, rerun, plus `ops_errors.test.ts`. Expected: PASS.
- [ ] **Step 5:** Commit: `git commit -m "feat(db): spend ledger tables, seeded prices and caps, reserve and extend"`

### Task 17: Ledger close - entries, settle, close rule, triggers, expiry, costs, worker enqueue

**Files:**
- Create: `supabase/migrations/20261102000031_ledger_close.sql`
- Modify: `supabase/tests/ops_ledger.test.ts`

**Interfaces:**
- Produces (to `service_role`): `ops.spend_entry_open(...) returns uuid` (refuses `MDF07` beyond the charged amount, Major 8), `ops.settle_spend(p_entry, p_items, p_usd default null)`, `ops.mark_ambiguous(p_reservation)`, `ops.close_reservation(p_reservation)` (internal; locks the row and acts only while `open`, Nit 32), `ops.expire_reservations() returns integer`, `ops.worker_enqueue(p_parent_job uuid, p_version uuid, p_stage text, p_idempotency_key text) returns uuid`; trigger `jobs_close_reservation` (after update of status, Major 9); to `mdf_web`: `ops.costs_get(p_ctx, p_from date, p_to date)`.

- [ ] **Step 1: Write the failing tests:**

```ts
it("spend_entry_open refuses with MDF07 when open plus settled estimates exceed the charge, and succeeds after extend_reservation (Major 8)", async () => {});
it("settle_spend records an actual 5 times the estimate, flags over_estimate and charges the excess (Major 8)", async () => {});
it("settle_spend rejects a negative amount; a second settle is a no-op", async () => {});
it("a job moving to done closes its reservation through the trigger (Major 9)", async () => {});
it("close does not write a kie entry for a Groq-only resume job or a cancelled generate-again job (Major 6)", async () => {});
it("close writes the kie submit entry for a submitted kie job of the same generation", async () => {});
it("a submitting kie job closes as ambiguous and keeps its charges", async () => {});
it("two concurrent expiries close a reservation once (Nit 32)", async () => {});
it("costs_get month caps report used from the month window (Nit 13) and list over_estimate entries", async () => {});
it("worker_enqueue copies token, run, fake flag and priority and raises MDF02 when the child cannot reserve", async () => {});
it("expire_reservations never touches a queued or running job's reservation", async () => {});
```

- [ ] **Step 2:** `DBTEST supabase/tests/ops_ledger.test.ts`. Expected: new cases FAIL.
- [ ] **Step 3:** Write the migration per 11.5 (revision 6). `CostsSummary.caps[].used` is the counter of the row's own period window (day or month), Nit 13.
- [ ] **Step 4:** Migrate, rerun, plus `ops_errors.test.ts`. Expected: PASS.
- [ ] **Step 5:** Commit: `git commit -m "feat(db): spend entries, unclamped settle, close trigger and worker enqueue"`

### Task 18: Scheduler functions and purges

**Files:**
- Create: `supabase/migrations/20261102000032_scheduler.sql`, `supabase/tests/ops_scheduler.test.ts`

**Interfaces:**
- Produces (to `service_role`): `ops.claim_scheduled_task(p_worker text) returns text`, `ops.finish_scheduled_task(p_name text, p_worker text, p_ok boolean, p_error text)`, `ops.purge_idempotency()`, `ops.purge_oauth()` (also revokes the token rows of unbound consents, Major 14), `ops.purge_audit()`, `ops.purge_test_runs()`; rows for the five M1 tasks of 14.4.

- [ ] **Step 1: Write the failing tests:** `a stale claim older than 10 minutes is taken over`, `only the claiming worker finishes`, `daily tasks use the Rome date: next run is ((now() at time zone 'Europe/Rome')::date + 1 + daily_at) at time zone 'Europe/Rome' (Nit 16)`, `purge_oauth revokes token rows of consents that never bound a grant`, `purge_test_runs cancels jobs and trashes test versions older than 7 days`.
- [ ] **Step 2:** `DBTEST supabase/tests/ops_scheduler.test.ts`. Expected: FAIL.
- [ ] **Step 3:** Write the migration per 14.4 with the Nit 16 date expression.
- [ ] **Step 4:** Migrate, rerun. Expected: PASS.
- [ ] **Step 5:** Commit: `git commit -m "feat(db): scheduler claim and finish with the M1 purge tasks"`

### Task 19: Token-exposed wrappers (the 7.3 rows), the stamp trigger and the test rule

**Files:**
- Create: `supabase/migrations/20261102000033_ops_wrappers.sql`, `supabase/tests/ops_wrappers.test.ts`, `packages/shared/src/ops/reads.ts`, `packages/shared/src/ops/inputs.ts`
- Modify: `packages/shared/src/ops/index.ts`, `apps/web/next.config.ts` (resolveAlias `"./reads.js"`, `"./inputs.js"`), `apps/web/app/actions/schemas.ts` (re-export moved schemas)

**Interfaces:**
- Produces (to `mdf_web`): `ops.songs_list`, `ops.song_get`, `ops.job_status`, `ops.song_create`, `ops.lyrics_approve`, `ops.lyrics_back`, `ops.song_generate_again`, `ops.take_pick`, `ops.video_make`, `ops.video_rerender`, `ops.video_approve`, `ops.stage_retry`, `ops.job_cancel`, `ops.stems_request`, `ops.visualizer_request`, each `(p_ctx jsonb, ...) returns jsonb` per 6.3.4; triggers `jobs_stamp_ctx` (Major 21) and `versions_mark_test_run` (`before insert`, from `mdf.job_ctx`, Nit 3).
- Produces (TS): zod `SongSummary`, `SongDetail`, `JobStatus`, `JobEvent`, `CostsSummary` (7.3) and the input schemas of 7.3.

- [ ] **Step 1: Write the failing tests:**

```ts
it("claim injection: preset request.jwt.claim.sub or request.jwt.claims cannot act on user B's version through lyrics_back, song_get, songs_list, job_status or costs_get (ruling 2, Nit 18); Task 20 adds the song_rename case of 6.3.7", async () => {});
it("reads return only the resolved actor's rows (Major 3)", async () => {});
it("a create-only PAT gets forbidden_scope on lyrics_approve and on stage_retry of a publish job", async () => {});
it("a test_mode PAT on a real version gets forbidden_scope; versions it creates get test_run (Nit 3)", async () => {});
it("jobs_stamp_ctx does nothing without mdf.job_ctx and never clears fake_providers or token_id (Major 21)", async () => {});
it("an admin operation with remote true, a 2-hour-old session or an unknown session id is refused", async () => {});
it("customer lyrics_approve returns cap_exceeded (kie cap 0) under withRealCaps; song_create succeeds under the USD cap", async () => {});
it("customer generate_again on a version with an old task id returns cap_exceeded (Major 5 exit test)", async () => {});
it("token actors must send an idempotency key (validation)", async () => {});
```

- [ ] **Step 2:** `DBTEST supabase/tests/ops_wrappers.test.ts`. Expected: FAIL.
- [ ] **Step 3:** Write the migration per 6.3.4 (revision 6), 6.9, 7.3 (read shapes and sources). Reads select only through the actor id from `ops._actor`. The songs cursor follows 7.2 as written.
- [ ] **Step 4:** Migrate, rerun, plus `ops_errors.test.ts`, `pnpm e2e`. Expected: PASS.
- [ ] **Step 5:** Commit: `git commit -m "feat(db): token operation wrappers with stamp trigger and test rule"`

### Task 20: Cookie-only and admin wrappers

**Files:**
- Create: `supabase/migrations/20261102000034_ops_cookie_wrappers.sql`, `supabase/tests/ops_cookie_wrappers.test.ts`

**Interfaces:**
- Produces (to `mdf_web`): `ops.style_format_check(p_ctx)`, `ops.transcribe_check(p_ctx)` (table `web_tool_usage`, Major 23), `ops.take_save_edit`, `ops.song_import`, `ops.song_source_set`, `ops.audio_keep` (Major 24, reserves Groq when it enqueues `timing`), `ops.take_choose` (Major 24), the playlist wrappers (`ops.playlist_create`, `_rename`, `_delete`, `_add`, `_remove`, `_reorder`), `ops.reaction_set`, `ops.song_rename`, `ops.songs_trash`, `ops.songs_restore`, `ops.play_count`, `ops.section_edit_request`, `ops.section_edit_keep`, `ops.section_edit_discard`, and the admin set of 6.3.6 (`ops.admin_resolve_kie_submission`, `ops.admin_resolve_upload`, `ops.admin_enqueue_publish`, `ops.admin_confirm_publication` refusing `scheduled`, `ops.admin_video_approve_override`, `ops.admin_project_create`).

- [ ] **Step 1: Write the failing tests:** `claim injection (6.3.7): with request.jwt.claim.sub preset to user B, song_rename with user A's context on B's version returns not_found and B's row is unchanged; the same with request.jwt.claims preset`, `a customer's 21st style format today returns rate_limited with retry_after until Rome midnight`, `a customer's 11th transcription is refused`, `admins are not counted against the daily limits`, `audio_keep that enqueues timing creates a Groq reservation under withRealCaps`, `take_choose and admin_project_create exist and enforce their rules`, `admin_confirm_publication refuses scheduled`, `every admin wrapper refuses a token actor and a customer session`.
- [ ] **Step 2:** `DBTEST supabase/tests/ops_cookie_wrappers.test.ts`. Expected: FAIL.
- [ ] **Step 3:** Write the migration per 6.3.6 and 6.7 (revision 6).
- [ ] **Step 4:** Migrate, rerun, plus `ops_errors.test.ts`. Expected: PASS.
- [ ] **Step 5:** Commit: `git commit -m "feat(db): cookie and admin wrappers with daily web-tool limits"`

---

## Step 2 - Worker ledger (21.2 step 2)

### Task 21: Engine repo change (lands first)

**Files (engine repo `C:\Users\Asus\Documents\suno-remake`):**
- Modify: `tools/kie.mjs`, `whisper_words.py` and every other key-file reader found by `grep -rnE "\.env|dotenv|load_dotenv" tools motion *.py`
- Create: `tools/test/env-only.test.mjs` (or the repo's test style)
- Modify (this repo): this plan, section "Spike results" (record the engine commit hash)

- [ ] **Step 1: Write the failing test:** for each script found, running it with no key in the environment and `MELLODIFAI_ENV_ONLY=1` exits non-zero with a refusal message and reads no file (`KIE_ENV` refused; the fallback to `C:/Users/Asus/Documents/Claude/Projects/ita/.env` refused).
- [ ] **Step 2:** Run it. Expected: FAIL.
- [ ] **Step 3:** Implement the refusal; add base-URL overrides `KIE_API_BASE`, `OPENROUTER_BASE_URL`, `GROQ_BASE_URL` where the scripts call those hosts.
- [ ] **Step 4:** Run it. Expected: PASS.
- [ ] **Step 5:** Commit in the engine repo (`git -C C:/Users/Asus/Documents/suno-remake commit -m "feat: refuse key files under MELLODIFAI_ENV_ONLY and allow base URL overrides"`), push if it has a remote, record the hash in this plan, commit this plan file.

### Task 22: `providers/paid.ts` and the kie client move

**Files:**
- Create: `apps/worker/src/providers/paid.ts`, `apps/worker/src/providers/kie-client.ts` (moved from `src/kie/client.ts`), `apps/worker/src/providers/ledger.ts`, `apps/worker/test/paid.test.ts`, `apps/worker/test/paid-scan.test.ts`
- Delete: `apps/worker/src/kie/client.ts`
- Modify: `apps/worker/test/rewrite.test.ts:20`, `apps/worker/test/songs-from-songs.test.ts:13` (imports), every caller of the kie client

**Interfaces:**
- Produces: `FREE_KEY_CALLS = ["kie:credit", "kie:job", "kie:record-info", "kie:wait", "kie:lyrics-ts", "kie:upload", "kie:download", "kie:balance-refresh"] as const` (checked against kie's price page; record the check in the file header); `callKey(kind: "kie" | "openrouter" | "groq", parts: { op?: string; role?: string; round?: number; n?: number; takeId?: string; attempt: number }): string` producing `kie:<op>:<attempt>`, `openrouter:<role>:<round>:<n>:a<attempt>`, `groq:<take id>:a<attempt>` (Major 7); `paidCall<T>(ledger: Ledger, key: string, est: Items, run: () => Promise<{ result: T; items: Items; usd?: number }>): Promise<T>`; `type Ledger = { reservationFor(jobId): Promise<string>; open(...): Promise<string>; settle(...): Promise<void>; extend(...): Promise<void> }` in `ledger.ts` over the service client (`ops.reserve_job`, `ops.spend_entry_open`, `ops.settle_spend`, `ops.extend_reservation`).

- [ ] **Step 1: Write the failing tests:**

```ts
it("call keys carry the job attempt (Major 7)", () => {
  expect(callKey("groq", { takeId: "t1", attempt: 2 })).toBe("groq:t1:a2");
});
it("paidCall opens before and settles after; on MDF07 it extends once then reopens (Major 8)", async () => {});
it("a free call carries no entry", async () => {});
it("no worker file outside providers/ names a paid host or reads a paid key", async () => {}); // paid-scan
it("kie/guard.ts still refuses .test owners without ALLOW_TEST_KIE (Major 25)", async () => {});
```

- [ ] **Step 2:** `pnpm --filter @mellodifai/worker exec vitest run test/paid.test.ts test/paid-scan.test.ts`. Expected: FAIL.
- [ ] **Step 3:** Implement; move direct key reads (`source-audio.ts:112`, `replace-section.ts:136`, `score-takes.ts:69-70`, `draft-lyrics.ts:202`) into `providers/`; keep `kie/guard.ts` and `LYRICS_DAILY_CAP`.
- [ ] **Step 4:** Run the tests and `pnpm --filter @mellodifai/worker test`. Expected: PASS.
- [ ] **Step 5:** Commit: `git commit -m "feat(worker): paid call module with attempt-keyed entries and the kie client move"`

### Task 23: The `engine.run` rule, `MELLODIFAI_ENV_ONLY` and `MELLODIFAI_ENGINE_ROOT`

**Files:**
- Modify: `apps/worker/src/engine.ts`, `apps/worker/src/stages/utils.ts:6`, `apps/worker/test/engine-secrets.test.ts`

**Interfaces:**
- Produces: `engine.run(args, opts: { secretEnv?: Record<string, string>; entryIds?: string[]; freeCall?: (typeof FREE_KEY_CALLS)[number] })` - refuses when `secretEnv` names any of `PAID_SECRET_NAMES` (`KIE_API_KEY`, `OPENROUTER_API_KEY`, `LYRICS_OPENROUTER_KEY`, `GROQ_API_KEY`, `HIGGSFIELD_API_KEY`) without an open entry id or a free-call name; several entry ids are accepted (Nit 27, `score_takes.py` makes one Groq call per uncached take); `ENGINE_ROOT = process.env.MELLODIFAI_ENGINE_ROOT ?? "C:\\Users\\Asus\\Documents\\suno-remake"` (Major 4).

- [ ] **Step 1: Write the failing tests:** `refuses a paid secretEnv without entry ids`, `accepts several entry ids`, `a child sees MELLODIFAI_ENV_ONLY=1 set after childEnvironment`, `ENGINE_ROOT follows MELLODIFAI_ENGINE_ROOT`.
- [ ] **Step 2:** `pnpm --filter @mellodifai/worker exec vitest run test/engine-secrets.test.ts`. Expected: FAIL.
- [ ] **Step 3:** Implement per 11.5 "Key files".
- [ ] **Step 4:** Run the tests and the worker suite. Expected: PASS.
- [ ] **Step 5:** Commit: `git commit -m "feat(worker): engine.run refuses paid secrets without a spend entry"`

### Task 24: Stage wiring, on-demand reservations and `mark_ambiguous`

**Files:**
- Modify: `apps/worker/src/stages/generate-song.ts`, `replace-section.ts`, `draft-lyrics.ts`, `lyric-jury.ts`, `import-audio.ts`, `score-takes.ts`, `timing.ts`, `local-engine.ts`, `source-audio.ts`, `apps/worker/src/loop.ts`, `apps/worker/test/stages.test.ts`, `apps/worker/test/lyric-jury.test.ts`

**Interfaces:**
- Consumes: Task 22 `paidCall`, `callKey`, `Ledger`; Task 23 `engine.run`.
- Produces: `ensureReservation(ledger, job): Promise<string | null>` (on-demand `ops.reserve_job`; `MDF02`/`MDF06` fail the job with `cap_exceeded`); on attempts after the first, `ledger.extend` for the stage estimate before the first paid call (Major 7); `markAmbiguous` before failing a kie stage in `submitting`.

- [ ] **Step 1: Write the failing tests** (in-memory Db and a recording ledger):

```ts
it("pre-migration job reserves on demand before the first paid call", async () => {}); // Review Focus 4
it("a refused on-demand reservation fails the job with cap_exceeded and makes no provider call", async () => {});
it("attempt 2 extends the reservation before its first paid call (Major 7)", async () => {});
it("draft_lyrics keeps the best draft, stores the jury incomplete and finishes when extend is refused (Major 10)", async () => {});
it("a kie submit timeout marks the reservation ambiguous before failing the stage", async () => {});
it("timing.ts is treated as paid Groq (the 11.5 default)", async () => {});
```

- [ ] **Step 2:** `pnpm --filter @mellodifai/worker exec vitest run test/stages.test.ts test/lyric-jury.test.ts`. Expected: FAIL.
- [ ] **Step 3:** Map every caller listed in 11.5 ("Callers to map") through `paidCall` or a free call.
- [ ] **Step 4:** Run the worker suite. Expected: PASS.
- [ ] **Step 5:** Commit: `git commit -m "feat(worker): every paid stage call runs under a capped reservation"`

### Task 25: `worker_enqueue` and per-job fakes

**Files:**
- Modify: `apps/worker/src/db.ts:344-359` (Supabase `enqueue`), the in-memory test Db at `db.ts:680` (Nit 23: that line is the test Db), `db.ts:161`, `apps/worker/src/loop.ts:322`, `apps/worker/src/main.ts`, `apps/worker/src/workspace.ts`, `apps/worker/src/fake/index.ts`, `apps/worker/test/worker.test.ts`

**Interfaces:**
- Produces: `db.enqueue(parentJobId: string, versionId: string, stage: Stage, idempotencyKey: string): Promise<string>` calling `ops.worker_enqueue`; `useFakes(job): boolean` = `WORKER_FAKE === "1" || job.fake_providers`.

- [ ] **Step 1: Write the failing tests:** `child jobs copy the parent's token, run, fake flag and priority`, `a refused child reservation fails the parent with cap_exceeded`, `a job with fake_providers runs fake stages without WORKER_FAKE`.
- [ ] **Step 2:** Run `pnpm --filter @mellodifai/worker exec vitest run test/worker.test.ts`. Expected: FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run the worker suite and `pnpm e2e`. Expected: PASS.
- [ ] **Step 5:** Commit: `git commit -m "feat(worker): enqueue children through worker_enqueue and run per-job fakes"`

### Task 26: Worker scheduler

**Files:**
- Create: `apps/worker/src/scheduler.ts`, `apps/worker/test/scheduler.test.ts`
- Modify: `apps/worker/src/main.ts`

**Interfaces:**
- Produces: `startScheduler(db, workerId: string, opts?: { intervalMs?: number }): () => void` - every 30 s claims one task with `ops.claim_scheduled_task`, calls `ops.<name>()`, finishes with `ops.finish_scheduled_task`.

- [ ] **Step 1: Write the failing tests:** `runs the claimed task's SQL body and finishes ok`, `records the error and keeps running when a body throws`, `the stop function stops the timer`.
- [ ] **Step 2:** Run them. Expected: FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run them plus one integration case against the e2e stack (`expire_reservations` claimed and finished). Expected: PASS.
- [ ] **Step 5:** Commit: `git commit -m "feat(worker): scheduler for the M1 timed tasks"`

### Task 27: Fake provider servers and the ledger integration test

**Files:**
- Create: `apps/worker/test/support/fake-servers.ts` (kie, OpenRouter, Groq HTTP fakes that count calls), `apps/worker/test/ledger-integration.test.ts`, `apps/worker/vitest.ledger.config.ts`
- Modify: `apps/worker/package.json` (`"test:ledger": "vitest run -c vitest.ledger.config.ts"`), `apps/worker/vitest.config.*` (exclude `ledger-integration.test.ts`), root `package.json` (`"test:ledger": "pnpm --filter @mellodifai/worker test:ledger"`)

**Interfaces:**
- Produces: `startFakeProviders(): Promise<{ kie: FakeServer; openrouter: FakeServer; groq: FakeServer; close(): Promise<void> }>` where `FakeServer = { url: string; calls: Array<{ path: string; body: unknown }> }`.

- [ ] **Step 1: Write the failing test** (env: `KIE_API_BASE`, `OPENROUTER_BASE_URL`, `GROQ_BASE_URL` to the fakes, `ALLOW_TEST_KIE=1`, `MELLODIFAI_ENGINE_ROOT`; e2e stack). The worker's ledger calls are separate transactions, so `mdf.force_caps` cannot reach them: `beforeAll` refuses to run while anything listens on 3210 (an e2e run in progress), then sets `stack_settings.fake_stack = false` through the owner connection; `afterAll` sets it back to true (also on failure, in a `finally`):

```ts
for (const scenario of ["normal", "crash-after-submit", "requeue", "retry-later", "resume-after-resolve", "cancel"]) {
  it(`counters equal settled spend plus open estimates after ${scenario}`, async () => {});
  it(`spend entries equal the calls the fake servers observed after ${scenario} (Major 7)`, async () => {});
}
it("reservations end closed, or ambiguous for crash-after-submit", async () => {});
```

- [ ] **Step 2:** `pnpm test:ledger`. Expected: FAIL.
- [ ] **Step 3:** Implement the fakes and drive the real `generate_song`, `replace_section` and `draft_lyrics` code.
- [ ] **Step 4:** `pnpm test:ledger` on the owner's PC (a local Windows gate, not CI; Major 4) and `pnpm test` (it must not pick up the integration test). Expected: PASS.
- [ ] **Step 5:** Commit: `git commit -m "test(worker): ledger integration test against fake provider servers"`

---

## Step 3 - Server actions onto the wrappers (21.2 step 3)

### Task 28: `lib/ops` core, `runAction` and `remoteAction`

**Files:**
- Create: `apps/web/lib/ops/context.ts`, `apps/web/lib/ops/run.ts`, `apps/web/lib/ops/types.ts`, `apps/web/lib/ops/use-server-scan.test.ts`, `apps/web/lib/ops/run.test.ts`
- Modify: `apps/web/lib/run-action.ts`, `apps/web/lib/action-result.ts` (add `code?: OpsErrorCode`), `apps/web/lib/auth.ts`, `apps/web/lib/supabase/server.ts`, `packages/shared/src/i18n.ts` (`error.unauthorized`, `error.forbidden_scope`, `error.not_found`, `error.conflict`, `error.idempotency_mismatch`, `error.in_progress`, `error.ambiguous_spend`, `error.validation`, `error.cap_exceeded`, `error.rate_limited`, `error.internal`, Italian and English)

**Interfaces:**
- Produces: `type OpsCtx = { actor_kind: "session" | "pat" | "oauth"; user_id?: string; session_id?: string; token_hash?: string; access_token_hash?: string; remote: boolean; request_id: string; idempotency_key?: string; request_hash?: string }`; `sessionCtx(): Promise<OpsCtx>` (`supabase.auth.getClaims()` for `sub` and `session_id`, `isRemote(headers())`); `type OpDef<I, O> = { name: string; fn: string; input: ZodType<I>; output: ZodType<O>; scope: "read" | "create" | "spend" | "admin"; key: boolean; mutating: boolean; revalidate: (data: O) => string[] }`; `runOp<I, O>(def, ctx, input): Promise<Result<O, OpsError>>`; `requestHash(op: string, input: unknown): string` (SHA-256 of sorted-key JSON, 7.2); `runAction(def, input): Promise<ActionResult>` (refuses remote with `forbidden_scope`); `remoteAction(def, input)`.

- [ ] **Step 1: Write the failing tests:** `every exported function of a "use server" module is wrapped by runAction or remoteAction, or calls the remote check itself`, `runAction refuses a remote request with forbidden_scope`, `requestHash ignores key order`, `error codes map to error.<code> messages`.
- [ ] **Step 2:** `pnpm --filter @mellodifai/web exec vitest run lib/ops`. Expected: FAIL (the scan fails on today's actions).
- [ ] **Step 3:** Implement the core; keep the scan test marked `it.fails` until Task 29 flips it (Task 29's last step removes `.fails`).
- [ ] **Step 4:** Run the web suite. Expected: PASS.
- [ ] **Step 5:** Commit: `git commit -m "feat(web): ops runner, session context and action wrappers"`

### Task 29: Move every server action onto `lib/ops`

**Files:**
- Create: `apps/web/lib/ops/defs/*.ts` (one per wrapper of Tasks 19 and 20)
- Modify: `apps/web/app/actions/checkpoints.ts`, `create-song.ts`, `library.ts`, `playlists.ts`, `project.ts`, `songs-from-songs.ts`, `visualizer.ts`, `audio-tools.ts` and their tests

**Interfaces:**
- Consumes: Task 28 `OpDef`, `runAction`.
- Produces: one `OpDef` per wrapper; mapping includes `keepAudio` and `keepAudioWithVisualizer` -> `ops.audio_keep`, `chooseTake` -> `ops.take_choose`, `createProject` -> `ops.admin_project_create` (Major 24), `uploadPrivate` -> `ops.admin_enqueue_publish`, `setPrivacy` -> `ops.admin_confirm_publication`, `resolveKieSubmission` and `resolveUpload` -> the admin wrappers.

- [ ] **Step 1:** Remove `.fails` from the scan test. Run it. Expected: FAIL listing every unwrapped export.
- [ ] **Step 2:** Move the modules one file per commit-sized edit; each existing action test is updated to assert the wrapper called and the `ActionResult` shape.
- [ ] **Step 3:** Run `pnpm --filter @mellodifai/web test` and `pnpm e2e`. Expected: PASS.
- [ ] **Step 4:** Commit: `git commit -m "feat(web): every server action calls its ops wrapper"`

### Task 30: Web-side tools: checks, keys and rate limits

**Files:**
- Modify: `apps/web/app/actions/format-style.ts`, `apps/web/app/api/transcribe/route.ts`, `apps/web/lib/openrouter-key.ts` (stops reading the worker's env files), `apps/web/lib/rate-limit.ts`, their tests

**Interfaces:**
- Produces: `formatStyle` and `/api/transcribe` call `ops.style_format_check` and `ops.transcribe_check` before the provider; `rateLimit(key: string, kind: "read" | "write" | "reservation"): { ok: true } | { ok: false; retryAfter: number }` with 60 reads and 10 writes per minute and 20 reservations per hour (6.7).

- [ ] **Step 1: Write the failing tests:** `a customer's 21st format today returns rate_limited and makes no OpenRouter call (Major 23)`, `openrouter-key never reads apps/worker/.env.local`, `the sliding window allows 60 reads per minute`.
- [ ] **Step 2:** Run them. Expected: FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run the web suite. Expected: PASS.
- [ ] **Step 5:** Commit: `git commit -m "feat(web): daily limits and own keys for the web-side tools"`

---

## Step 4 - Tests onto the wrappers (21.2 step 4)

### Task 31: `opsCall` and the rewritten database tests

**Files:**
- Create: `supabase/tests/helpers/ops-call.ts`
- Modify: every `supabase/tests` file that calls `public` RPCs as `authenticated`: `library.test.ts`, `pipeline-hardening.test.ts`, `playlists.test.ts`, `rls.test.ts` (RPC part), `songs-from-songs.test.ts`, `spend-and-staging.test.ts`, `stems.test.ts`, `visualizer.test.ts`, `web-flow.test.ts` (nine; `queue.test.ts` keeps its service-role calls; Major 22)

**Interfaces:**
- Produces: `opsCall(session: { userId: string; sessionId: string }, fn: string, args: unknown[], opts?: { realCaps?: boolean }): Promise<OpsResult>` - connects with `TEST_MDF_WEB_URL`, builds `p_ctx` for a session actor; with `realCaps` it runs through `withRealCaps`.

- [ ] **Step 1:** Rewrite each file's RPC calls to `opsCall`; keep each assertion's meaning.
- [ ] **Step 2:** `pnpm test:db` on the e2e stack. Expected: PASS before the lockdown.
- [ ] **Step 3:** Commit: `git commit -m "test(db): call the ops wrappers instead of public RPCs"`

---

## Step 5 - Lockdown and the floor (21.2 step 5)

### Task 32: `ops_lockdown`, the ACL test and the refusal tests (one commit, tag `m1-floor`)

**Files:**
- Create: `supabase/migrations/20261102000035_ops_lockdown.sql`, `supabase/tests/ops_acl.test.ts`, `supabase/tests/acl-allowlist.json`, `supabase/tests/ops_lockdown.test.ts`
- Modify: `supabase/tests/rls.test.ts` (Major 22)

- [ ] **Step 1: Write the failing tests:**

```ts
// ops_lockdown.test.ts (6.3.7)
it("mdf_web and mdf_auth hold EXECUTE on no public function; mdf_web cannot call ops.oauth_*; mdf_auth only ops.oauth_*", async () => {});
it("a customer and an admin session JWT cannot insert or update jobs, insert projects, or call approve_lyrics, generate_again, enqueue_publish, confirm_publication", async () => {});
// ops_acl.test.ts (6.3.3): compares with acl-allowlist.json; column grants read from pg_attribute.attacl through aclexplode (Nit 22)
// rls.test.ts: fixtures through the service role; direct writes expect 42501 (Major 22)
```

- [ ] **Step 2:** `DBTEST supabase/tests/ops_lockdown.test.ts supabase/tests/ops_acl.test.ts supabase/tests/rls.test.ts`. Expected: FAIL.
- [ ] **Step 3:** Write the migration exactly as 6.3.2's lockdown block, plus the profile check on the "owners delete studio files" storage policy (`022:54-59`), which 6.3.2 lists (Nit 15). Generate `acl-allowlist.json` from the migrated e2e stack and review every line against 6.3.6, 6.4, 11.5 and 14.4.
- [ ] **Step 4:** Migrate, run `pnpm lint && pnpm typecheck && pnpm test && pnpm test:db && pnpm e2e && pnpm test:ledger`. Expected: all PASS.
- [ ] **Step 5:** Commit and tag: `git commit -m "feat(db): ops lockdown with ACL and refusal tests" && git tag m1-floor && git push origin build/studio-ui m1-floor`

### Task 33: First production deploy at `m1-floor`

Preconditions (round-5 report: Majors 1, 2, 3, 17 and 19 before the first production deploy): Tasks 4, 5, 8, 9, 10, 12 and 14 are done; `pnpm ops services.ts acl --apply` has run (or is recorded as a pending owner action with the reason).

- [ ] **Step 1:** Create the deploy clone: `git clone <origin> E:/mellodifai/deploy`, copy `pnpm-lock.yaml` per the builder note, record `MELLODIFAI_OWNER_EMAIL` in `E:/mellodifai/config/ops.env`.
- [ ] **Step 2:** Run `pnpm ops cutover.ts`. Expected: row counts identical before and after; prod now runs with `--workdir E:/mellodifai/stacks/prod`, project `mellodifai`, Studio, mail catcher and analytics off.
- [ ] **Step 3:** Run `pnpm ops rotate-db-passwords.ts --env prod` and `pnpm ops probe.ts --env prod`. Expected: every default-password login fails; 54323, 54324, 54327 refuse.
- [ ] **Step 4:** Run `pnpm ops deploy.ts --to m1-floor`. Expected: success; local `/api/health` shows `ops: "ok"` and schema `20261102000035`.
- [ ] **Step 5:** Run `pnpm ops deploy.ts --to <the tag before m1-floor, or a commit without it>`. Expected: refused.
- [ ] **Step 6:** Sign in as the owner with `pnpm ops sign-in-link.ts <owner email> http://127.0.0.1:3000`, open the library (a read under RLS) and rename one song (a write through `ops.song_rename` as `mdf_web`); check that health shows a fresh worker heartbeat. No paid action is triggered on production. Record results in this plan's "Deploy log" section and commit only this file.

---

## Step 6 - Topology (21.2 step 6)

### Task 34: Supabase signing key and JWT secret rotation

**Files:**
- Create: `ops/rotate-supabase-keys.ts`, `ops/test/rotate-supabase-keys.test.ts`

**Interfaces:**
- Produces: `rotateSupabaseKeys(runner): Promise<void>` - `supabase gen signing-key --algorithm ES256` into `<root>/secrets/supabase/signing_keys.json`, a new JWT secret into `<root>/secrets/supabase/jwt-secret` (never into the stack folder; `stack.ts start --env prod` passes it as `MDF_SUPABASE_JWT_SECRET`, round-5 Major 1), restart, anon and service keys read from `status -o json` into `apps/worker/.env.local` and `apps/web/.env.local` of the deploy clone without printing.

- [ ] **Step 1: Write the failing tests:** `writes keys only under secrets and never prints them`, `the rendered prod config holds env(MDF_SUPABASE_JWT_SECRET), not a value`, and an e2e-stack integration test `a service_role JWT signed with the public demo secret is refused by the gateway after rotation` (run on a throwaway copy of the e2e stack rendered as prod-like).
- [ ] **Step 2:** Run them. Expected: FAIL.
- [ ] **Step 3:** Implement per 5.3 item 2.
- [ ] **Step 4:** Run them; then on prod `pnpm ops rotate-supabase-keys.ts` and `pnpm ops check-no-keys.ts --root E:/mellodifai/stacks`. Expected: PASS; demo-secret JWT refused on prod.
- [ ] **Step 5:** Commit: `git commit -m "feat(ops): rotate the Supabase signing key and JWT secret outside every checkout"`

### Task 35: `services.ts install`, port-owner check and `cloudflared` ordering

**Files:**
- Modify: `ops/services.ts`, `ops/lib/services.ts`, `ops/test/services.test.ts`

**Interfaces:**
- Produces: `installCommands(opts): string[][]` (Windows accounts `mdf-web`, `mdf-auth`, `mdf-tunnel` for `cloudflared` (Nit 9); grants per 5.1 revision 6; firewall rule of 5.2); `icaclsProbe(account): Promise<string[]>` (paths the account can wrongly read or write; install fails on any, Major 1); `portOwners(): Promise<Record<number, string>>` (`Get-NetTCPConnection -LocalPort ... | Get-Process -IncludeUserName`); `watchPorts(expected, onMismatch, everyMs = 60000)` (Major 26).

- [ ] **Step 1: Write the failing tests:** `install prints account, ACL and firewall commands and runs nothing without --apply`, `the icacls probe fails install when mdf-web can read secrets or write the deploy clone`, `a port owned by another account stops cloudflared`, `cloudflared starts last, only after password re-apply and a passing probe (Nit 9, Major 20)`, `tunnel drift: a live config differing from the template refuses start`.
- [ ] **Step 2:** Run them. Expected: FAIL.
- [ ] **Step 3:** Implement. Running `install --apply` needs administrator rights: an owner action (22); if not done, services stay on the owner's account and 17's fallback row applies.
- [ ] **Step 4:** Run the tests. Expected: PASS.
- [ ] **Step 5:** Commit: `git commit -m "feat(ops): service accounts, ACL probe and port-owner watch"`

### Task 36: Edge proxy and the `cloudflared` template

**Files:**
- Create: `ops/edge-proxy.ts`, `ops/test/edge-proxy.test.ts`, `ops/cloudflared/config.template.yml`

**Interfaces:**
- Produces: `createEdgeProxy(opts: { listen: number; next: string; auth: string; mode: "prod" | "local" }): http.Server` - forwards only the 5.2 M1 paths (Next or `apps/auth`), 404 otherwise; overwrites `x-mdf-remote: 1` (prod mode), `x-forwarded-host` and `x-forwarded-proto` (Nit 10); refuses a `Next-Action` header outside `/login` and `/consent`; per-IP limits of 6.7 keyed on `cf-connecting-ip`. Local mode (port 3212, e2e) does not set `x-mdf-remote` (Major 16).

- [ ] **Step 1: Write the failing tests** (Nit 10): `an incoming x-mdf-remote: 0 becomes 1`, `x-forwarded-host and proto are overwritten`, `Next-Action on /api/v1 is refused`, `the 11th registration in an hour from one IP gets 429`, `/rest/v1 and /_next/data return 404`, `/oauth/* goes to auth and /api/mcp to next`.
- [ ] **Step 2:** Run them. Expected: FAIL.
- [ ] **Step 3:** Implement with `node:http` (no new dependency); the template's ingress ends with `http_status:404`.
- [ ] **Step 4:** Run them. Expected: PASS.
- [ ] **Step 5:** Commit: `git commit -m "feat(ops): edge proxy with path allowlist and the tunnel template"`

### Task 37: Server-side sign-in, the code entry and the proxy matcher

**Files:**
- Create: `apps/web/app/actions/sign-in.ts` (`sendSignInLink`, `verifySignInCode`), `apps/web/app/actions/sign-in.test.ts`, `supabase/templates/magic_link.html`
- Modify: `apps/web/components/login-form.tsx`, `apps/web/app/(auth)/login/page.tsx`, `apps/web/app/auth/confirm/route.ts`, `apps/web/lib/redirect-url.ts`, `apps/web/lib/redirect-url.test.ts`, `apps/web/proxy.ts`, `apps/web/lib/supabase/server.ts` (`SUPABASE_INTERNAL_URL`), `apps/web/next.config.ts` (`experimental.serverActions.allowedOrigins`), `apps/web/playwright.config.ts` and `.github/workflows/ci.yml` (drop `NEXT_PUBLIC_SITE_URL`), `ops/lib/render.ts` (template `content_path`), `apps/web/e2e/auth.spec.ts`

**Interfaces:**
- Produces: `sendSignInLink(email: string, next: string): Promise<ActionResult>` (remoteAction; same answer for any email; 5 per 15 minutes per email); `verifySignInCode(email: string, code: string, next: string): Promise<ActionResult>` (`verifyOtp` type `email`, Major 15); `emailRedirect(origin: string, env: { siteUrl: string; redirectUrls: string[] }, remote: boolean, next: string): string` (Major 18: a local origin must match an allowed pattern, else it throws); `safeNext(next: string, remote: boolean): string`.

- [ ] **Step 1: Write the failing tests:** `a local origin outside additional_redirect_urls is refused (Major 18)`, `localhost:3001 and 127.0.0.1:3001 are accepted on dev`, `remote requests always use SITE_URL`, `remote next accepts only /consent?uid=`, `the template renders RedirectTo, TokenHash and the 6-digit Token`, and e2e `sign in with the 6-digit code from the mail catcher`.
- [ ] **Step 2:** Run the unit tests and `pnpm e2e -- auth.spec.ts`. Expected: FAIL.
- [ ] **Step 3:** Implement per 5.4 (revision 6); the proxy matcher excludes `/api/v1`, `/api/mcp`, `/.well-known/`, `/api/health`, `/api/transcribe`.
- [ ] **Step 4:** Run the web suite and `pnpm e2e`. Expected: PASS.
- [ ] **Step 5:** Commit: `git commit -m "feat(web): server-side sign-in with link or 6-digit code"`

### Task 38: README and keepalive removal

**Files:**
- Modify: `README.md`; Delete: `.github/workflows/keepalive.yml`

- [ ] **Step 1:** Rewrite the deploy section: PC plus tunnel (5.1), `ops/deploy.ts`, `ops/restore.ts` (Major 19), the cutover, the remote kill (Cloudflare dashboard, 6.4), the sign-in limitation (open the link in the browser that started the flow, or type the 6-digit code; Major 15), `ops/sign-in-link.ts` without SMTP, owner actions of 22.
- [ ] **Step 2:** Run `pnpm lint`. Expected: PASS.
- [ ] **Step 3:** Commit: `git commit -m "docs: PC and tunnel deploy, restore and remote kill in the README"` then `git tag m1-topology && git push origin build/studio-ui m1-topology`.

---

## Step 7 - Agents (21.2 step 7)

### Task 39: Token authentication, rate limits and idempotency in Next

**Files:**
- Create: `apps/web/lib/ops/tokens.ts`, `apps/web/lib/ops/bearer.ts`, `apps/web/lib/ops/bearer.test.ts`, `apps/web/lib/ops/idem.test.ts`

**Interfaces:**
- Produces: `newPat(): { token: string; hash: string; hint: string }` (`mdf_pat_` plus 32 random bytes base62; hint `mdf_pat_...` plus last 4); `bearerCtx(req: Request, allow: Array<"pat" | "oauth">): Promise<OpsCtx | null>` (PAT by prefix, else OAuth through `ops.resolve_access_token(hash, <SITE_URL>/api/mcp)`); `runTokenOp(def, req, input): Promise<Response>` (rate limit, `ops.idem_begin` in its own transaction for `key` ops, `runOp`, 7.2 envelope).

- [ ] **Step 1: Write the failing tests:** `PAT format and hint`, `a cookie on /api/v1 is ignored (401)`, `a missing Idempotency-Key on a key op is validation`, `parallel same-key POSTs create one job` (Review Focus 3), `replay returns the stored response`, `the 11th write in a minute is rate_limited with retry_after`.
- [ ] **Step 2:** Run them. Expected: FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run the web suite. Expected: PASS.
- [ ] **Step 5:** Commit: `git commit -m "feat(web): bearer tokens, idempotency keys and rate limits"`

### Task 40: `/api/v1`

**Files:**
- Create: `apps/web/app/api/v1/**/route.ts` (the 7.3 paths), `apps/web/lib/ops/registry.ts`, `apps/web/app/api/v1/api.test.ts`

**Interfaces:**
- Produces: `TOKEN_OPS: OpDef[]` (exactly the 7.3 rows, with HTTP path and method); routes accept PATs only.

- [ ] **Step 1: Write the failing tests** (against the e2e stack with a `test_mode` admin PAT): every 7.3 row answers with its output shape; `cursor` pagination per 7.2; `ambiguous_spend` maps to 409; OAuth tokens are refused on `/api/v1`.
- [ ] **Step 2:** Run them. Expected: FAIL.
- [ ] **Step 3:** Implement thin route handlers over `runTokenOp`.
- [ ] **Step 4:** Run them. Expected: PASS.
- [ ] **Step 5:** Commit: `git commit -m "feat(web): versioned HTTP API for the M1 operations"`

### Task 41: `/api/mcp` and protected resource metadata

**Files:**
- Create: `apps/web/lib/mcp/server.ts`, `apps/web/app/api/mcp/route.ts`, `apps/web/app/.well-known/oauth-protected-resource/route.ts`, `apps/web/app/.well-known/oauth-protected-resource/api/mcp/route.ts`, `apps/web/lib/mcp/server.test.ts`

**Interfaces:**
- Consumes: spike 3; Task 40 `TOKEN_OPS`.
- Produces: `buildMcpServer(ctx: OpsCtx): McpServer` (one tool per `TOKEN_OPS` row, resource `mellodifai://songs/{version_id}`, prompt `new_song`).

- [ ] **Step 1: Write the failing tests:** `tools/list returns the 7.3 tool names`, `a tool error carries the ops code`, `401 carries WWW-Authenticate with resource_metadata`, `GET answers 405`.
- [ ] **Step 2:** Run them. Expected: FAIL.
- [ ] **Step 3:** Implement per 7.1 (or the spike's fallback).
- [ ] **Step 4:** Run them plus the inspector CLI against the dev server with a dev PAT. Expected: PASS.
- [ ] **Step 5:** Commit: `git commit -m "feat(web): MCP server over the token operations"`

### Task 42: `apps/auth`

**Files:**
- Create: `apps/auth/package.json`, `apps/auth/tsconfig.json`, `apps/auth/src/main.ts`, `apps/auth/src/adapter.ts`, `apps/auth/src/interaction.ts`, `apps/auth/redirect-allowlist.json`, `apps/auth/test/*.test.ts`, `ops/rotate-auth-keys.ts` (Nit 7: in this step)
- Modify: root `tsconfig.json` (reference), `ops/lib/services.ts` (auth service command)

**Interfaces:**
- Consumes: spike 1; Task 15 `ops.oauth_*`.
- Produces: service on `HOST=127.0.0.1`, `PORT` (3010 prod, 3211 e2e), issuer `MDF_AUTH_ISSUER` (Major 16); `OpsAdapter` implementing `oidc-provider`'s adapter over `ops.oauth_*` with hashed ids and no `jti`; interaction handler at `/oauth/interaction/:uid` that sets the flow cookie, calls `ops.oauth_flow_nonce_set` and redirects to `/consent?uid=` (Major 13); registration hook calling `ops.oauth_registration_claim` (Major 27). Cookie name `__Host-mdf_flow` on https and `mdf_flow` on http (Nit 28).

- [ ] **Step 1: Write the failing tests:** `discovery is served at /oauth/.well-known/openid-configuration and both path-insertion forms`, `registration outside the window is refused and the first one closes it`, `a redirect URI off the allowlist is refused`, `the interaction handler sets the flow cookie and stores only its hash`, `resume without the cookie is refused`, `the adapter never stores jti`.
- [ ] **Step 2:** `pnpm --filter @mellodifai/auth test`. Expected: FAIL.
- [ ] **Step 3:** Implement per 6.4 (revision 6) and spike 1.
- [ ] **Step 4:** Run them. Expected: PASS.
- [ ] **Step 5:** Commit: `git commit -m "feat(auth): authorization server on oidc-provider over the ops storage"`

### Task 43: `/consent`

**Files:**
- Create: `apps/web/app/consent/page.tsx`, `apps/web/app/consent/actions.ts` (`consentDecide`), `apps/web/app/consent/consent.test.tsx`

**Interfaces:**
- Produces: `consentDecide(uid: string, scopes: Array<"read" | "create" | "spend">, testMode: boolean, confirmName?: string): Promise<ActionResult>` (remoteAction; `spend` needs `confirmName` equal to the client name).

- [ ] **Step 1: Write the failing tests:** `without the flow cookie the page says to start again from the agent in this browser`, `only read is ticked by default`, `spend needs the typed client name`, `consent page escapes the client name` (Review Focus 5), `a loopback-only client is refused remotely (Major 27)`.
- [ ] **Step 2:** Run them. Expected: FAIL.
- [ ] **Step 3:** Implement per 6.4 flow binding; Italian copy with English in tests' comments.
- [ ] **Step 4:** Run them. Expected: PASS.
- [ ] **Step 5:** Commit: `git commit -m "feat(web): consent page bound to the starting browser"`

### Task 44: Settings > Agenti

**Files:**
- Create: `apps/web/app/(app)/settings/agents/page.tsx`, `apps/web/app/(app)/settings/agents/actions.ts`, `apps/web/app/(app)/settings/agents/agents.test.tsx`
- Modify: `apps/web/app/(app)/settings/page.tsx` and the settings navigation

- [ ] **Step 1: Write the failing tests:** `admin only and local only`, `Nuovo token shows the token once`, `Revoca asks for confirmation`, `the remote_mcp switch calls admin_flag_set`, `Collega un agente shows the remaining time and the client that claimed the window (name, redirect host, time; Major 27)`.
- [ ] **Step 2:** Run them. Expected: FAIL.
- [ ] **Step 3:** Implement per 6.6.
- [ ] **Step 4:** Run them and `pnpm e2e`. Expected: PASS.
- [ ] **Step 5:** Commit: `git commit -m "feat(web): Settings Agenti for tokens, pairing and the remote switch"`

### Task 45: OAuth end-to-end topology and tests

**Files:**
- Create: `apps/web/e2e/oauth.spec.ts`, `apps/web/e2e/support/oauth-client.ts`
- Modify: `apps/web/playwright.config.ts` (three `webServer` entries: Next 3210, `apps/auth` 3211, edge proxy 3212 in local mode), `.github/workflows/ci.yml` (same), `apps/auth/redirect-allowlist.json` (the test client's loopback redirect)

- [ ] **Step 1: Write the failing tests** (through `http://127.0.0.1:3212`): window closed refuses registration; window open accepts one; allowlisted and refused redirect URIs; PKCE; consent with only `read`; a second browser context without the flow cookie is refused; a reused nonce is refused; token; `tools/call song_get`; revocation makes the next call 401; `oauth_upsert` refuses a grant without a matching consent (database assertion).
- [ ] **Step 2:** `pnpm e2e -- oauth.spec.ts`. Expected: FAIL.
- [ ] **Step 3:** Wire the topology (Major 16).
- [ ] **Step 4:** Run `pnpm e2e` and CI. Expected: PASS.
- [ ] **Step 5:** Commit: `git commit -m "test(e2e): OAuth flow through the local edge proxy"`

### Task 46: `packages/cli`, stdio bridge and skill

**Files:**
- Create: `packages/cli/package.json` (`@mellodifai/shared` as a devDependency, bundled; Nit 25), `packages/cli/src/*.ts`, `packages/cli/build.mjs` (esbuild single file), `packages/cli/skill/SKILL.md`, `packages/cli/skill/AGENTS.md`, `packages/cli/test/*.test.ts`
- Modify: root `tsconfig.json`

**Interfaces:**
- Produces: commands `login`, `songs`, `create`, `status <job> [--watch]` (3 s), `approve`, `regenerate`, `video`, `costs`, `mcp`; `--json` everywhere; credentials in `%APPDATA%\mellodifai\credentials.json` restricted with `icacls`.

- [ ] **Step 1: Write the failing tests:** `the stdio bridge forwards JSON-RPC to /api/mcp with the PAT`, `a revoked PAT yields a JSON-RPC error carrying unauthorized`, `spend commands always send an idempotency key`, `the packed tarball has no workspace: dependency`.
- [ ] **Step 2:** `pnpm --filter @mellodifai/cli test`. Expected: FAIL.
- [ ] **Step 3:** Implement per 7.1.
- [ ] **Step 4:** Run them; `pnpm --filter @mellodifai/cli pack`, `npm install -g <tarball>`, `npx @modelcontextprotocol/inspector --cli mellodifai mcp --method tools/list` against the dev server. Expected: PASS.
- [ ] **Step 5:** Commit: `git commit -m "feat(cli): mellodifai CLI with stdio MCP bridge and agent skill"` then `git tag m1-agents && git push origin build/studio-ui m1-agents`.

---

## Step 8 - Remote enablement (21.2 step 8)

### Task 47: Production deploy, tunnel smoke test and the remote exit test

Preconditions: Majors 12, 13 (Tasks 15, 42) and 26 (Task 35) are done. Owner actions (22): nameservers on Cloudflare, `cloudflared tunnel login` and `tunnel create mellodifai`, SMTP sender (or the sign-in-link fallback), Windows accounts. Any still open: stop at that step, keep `remote_mcp` off, and record it.

- [ ] **Step 1:** `pnpm ops deploy.ts --to m1-agents`. Expected: health `ops: "ok"`.
- [ ] **Step 2:** `pnpm ops services.ts start` with `cloudflared`. Expected: probe passes, port owners match, tunnel drift none.
- [ ] **Step 3:** Tunnel smoke test (19): allowed routes answer, `/rest/v1`, `/auth/v1`, Studio paths return 404, a cookie on `/api/v1` gets 401. Record the output.
- [ ] **Step 4:** Turn `remote_mcp` on in Settings > Agenti (local).
- [ ] **Step 5:** Remote exit test (19, 21.2 done-when): a `test_mode` admin PAT through Claude Code over stdio and an OAuth grant with "Test (fake providers)" through claude.ai each run `song_create`, `job_status`, `lyrics_approve`; their jobs run on fakes and create no reservation. MCP inspector checks on both transports; a revoked PAT and a revoked grant fail on the next call.
- [ ] **Step 6:** Record every result in this plan's "Deploy log" and commit it.

---

## Spike results

(Filled by Tasks 1, 2, 3 and 21.)

### Spike 1: oidc-provider wiring (Task 1, 2026-11-02)

**Decision:** keep `oidc-provider`; (a)-(d) pass, so the section 6.4 fallback to
`@node-oauth/oauth2-server` is not needed. Tested Node 22.13.0 with pinned
`oidc-provider@9.13.3` and `tough-cookie@6.0.0`. Disposable source, lockfile and
evidence are in `E:/mellodifai/spikes/oidc/`, intentionally not committed.
Run `node --test E:/mellodifai/spikes/oidc/spike.test.mjs`. The harness opens only
an ephemeral loopback listener and closes it after the test. No Supabase, paid
provider or remote connector calls occur in this experiment.

**Wiring for Task 42:** issuer comes from `MDF_AUTH_ISSUER`; the harness supplies
its loopback origin plus `/oauth`. Mount `provider.callback()` at `/oauth`, strip
that mount prefix from `req.url`, retain `req.originalUrl`, and set
`provider.proxy = true`. Resource is `new URL(issuer).origin + "/api/mcp"`, not
the Next server's origin. Enable registration and resource indicators; disable
development interactions. Use `responseTypes: ["code"]` and
`pkce: { required: () => true }` (this version advertises only S256). Discovery
advertises only authorization-code and refresh grants. "Code grant only" means
code is the sole initial grant, with refresh enabled as required by section 6.4.
Implicit and client-credentials attempts are refused.

- Keep provider-level scopes to `openid` and `offline_access`; declare
  `read create spend` on the MCP resource server. Defining MCP scopes as OIDC
  scopes too caused an extra consent interaction in the first implementation.
- `getResourceServerInfo` rejects every other resource and returns
  `{ scope: "read create spend", audience: resource, accessTokenFormat: "opaque",
  accessTokenTTL: 3600 }`. Set TTLs: AccessToken 3600, AuthorizationCode 600,
  RefreshToken 2592000, Interaction 900 seconds. Use
  `rotateRefreshToken: () => true` and issue refresh tokens when the client
  allows `refresh_token`, including for the tested resource-only `read` flow.
- **Explicit resource guard required:** throwing from `defaultResource` rejects
  a missing resource at authorization, but the library still infers the resource
  on a refresh without one. A negative test observed HTTP 200, expected 400.
  The spike adds a bounded, form-urlencoded token-request pre-parser requiring
  exactly one resource equal to the MCP URI before the library consumes a code
  or refresh token. It passes the original body through `req.body`. Missing and
  foreign resources then return 400 without consuming the refresh token. The
  library warns that upstream body parsing is not recommended; Task 42 must
  preserve this check and test parser integration, size limits and duplicate
  parameters. Do not rely solely on `defaultResource` or `useGrantedResource`.

**Verified observations:**

| Requirement | Result |
| --- | --- |
| (a) Interaction cookie reaches resume | `interactions.url` returns `/oauth/interaction/<uid>`. `_interaction` has Path `/oauth/interaction/<uid>` (more specific than `/oauth`), and the cookie jar sends it to `/oauth/interaction/<uid>/resume`. `interactionDetails` and `interactionFinished` both succeed. The library's separate resume redirect then returns the authorization code. |
| (b) Save before URL | The URL callback asserts the hashed Interaction row already exists. The custom interaction handler updates that existing row with the nonce hash before redirecting to `/consent`. This proves the ordering needed by `oauth_flow_nonce_set`; no SQL implementation is claimed. |
| (c) Token binding | Captured AuthorizationCode, AccessToken and RefreshToken payloads all have the same `grantId` and contain neither `uid` nor the interaction uid as a value. Lifetimes are exactly 600, 3600 and 2592000 seconds. AccessToken audience equals the canonical MCP resource. Session identifiers, when present, must not be interpreted as interaction identifiers. |
| (d) Hashed adapter | Per-model Map keys are `sha256(id)` hex; stored payloads omit `jti`. `find(id)` hashes its argument and reconstructs `{ ...payload, jti: id }` only in the returned object. The library does not reconstruct it itself. Removing this reconstruction makes the flow fail. Code exchange, opaque-token lookup, unknown-token refusal, refresh rotation and old-refresh rejection pass with reconstruction restored. |
| (f) Two browser flows | A shared cookie jar retains the separate interaction-path cookies but replaces the single root-path `mdf_flow`. The first flow's nonce no longer matches (403); the second resumes (303). This is recorded behavior, not a multi-flow redesign. |

**(e) Connector callbacks, including pre-flight ruling 30:** documentation verified
on 2026-11-02. No tunnel capture was attempted: `docs/HANDOFF.md` still lists
Cloudflare nameservers and `cloudflared` login as owner prerequisites.

| Connector | Verified URI and Task 42 allowlist instruction |
| --- | --- |
| Claude hosted surfaces | `https://claude.ai/api/mcp/auth_callback`, explicitly documented for web, Desktop, mobile and Cowork. Use this exact URI, not an inferred alternate hostname. [Official callback documentation](https://claude.com/docs/connectors/building/authentication#callback-urls). |
| ChatGPT, issuer-identification mode | `https://chatgpt.com/connector_platform_oauth_redirect`. Official docs specify this stable URI for servers meeting RFC 9207 issuer identification, and legacy connections. The spike verifies `authorization_response_iss_parameter_supported: true` and an exact matching `iss` on the successful code response and tested authorization error redirects. [Official redirect documentation](https://developers.openai.com/plugins/build/auth#redirect-url). |
| ChatGPT, callback-ID-specific mode | Official docs specify the form `https://chatgpt.com/connector/oauth/{callback_id}` when issuer-identification requirements are not met. This is a template, not a verified concrete URI and not an allowlist wildcard. The owner must copy the exact URI from the connection management page if that mode is selected. No callback ID was invented. |

Task 42 must retain issuer identification and confirm the actual ChatGPT
management-page callback before enabling a connection. A real connector/tunnel
round trip remains pending owner setup. Documentation fallback satisfies this
spike's callback research, but does not prove a live connection.

**Test evidence:** initial RED was `ERR_MODULE_NOT_FOUND` before implementation.
Behavioral RED without read-time `jti` reconstruction: 3 pass, 4 fail (including
the parent test). Missing-refresh-resource RED: HTTP 200 versus expected 400.
Final focused GREEN: 8 tests passed, 0 failed (7 checks plus their parent), in
`green.log`. Other logs: `red.log`, `iteration-1.log`,
`red-without-jti-reconstruction.log`, `red-missing-refresh-resource.log`.
These are HTTP and cookie-jar checks, not a Playwright/browser or production
TLS test. Production pairing, SQL consent/grant binding, persistent adapter
indexes, key provisioning and discovery aliases remain Tasks 15/42/45 work.

Repository gates ran from a disposable copy under the spike directory so caches
and outputs stayed off C:. Frozen offline install passed. Review R3's final gate
run passed lint, repository and web typechecks, unit tests (1285 passed, 1
skipped), e2e-stack database tests (124 passed) and all 3 e2e tests. The focused
spike rerun also passed all 8 tests.

**Review R3 resolution:** R1/R2 were blocked by a pre-existing server on port
3210. The subsequent progress ruling records that the stale server was stopped
and the owner uses port 3000. The first actual e2e run then found a stale
`getByText("Offline")` assertion. The current sidebar instead exposes an offline
status link. `apps/web/e2e/offline.spec.ts` now checks that link by accessible
name starting with `PC di render offline`, independent of its credit-balance
suffix. The test still creates a project without a worker and checks that the
lyrics job stays queued. No behavior, timeout or skip was changed.

The full e2e RED run had 2 passed and 1 failed; the corrected full suite passed
all 3. Final evidence is under `E:/mellodifai/spikes/oidc/` in
`review-r3-e2e-red.log`, `review-r3-gate-e2e.log` and the other
`review-r3-gate-*.log` files. The full report and RED/GREEN evidence index are in
`.superpowers/sdd/2026-11-02-m1-agent-access/task-1-report.md` (gitignored).
The sole Important review finding is resolved. Completion status:
DONE_WITH_CONCERNS only for the previously recorded pending live connector
verification; the repository e2e gate is no longer blocked.

### Spike 2: database stack (Task 2, 2026-11-02, runtime experiments completed)

**Pinned-image retry and decision (Task 5): use the compose fallback.**
CLI 3.0.0 starts the isolated `mellodifai_spike` on 46621-46629 with the
locally available image versions in the progress ruling. Supported `.temp`
files are `postgres-version`, `storage-version`, `rest-version`,
`gotrue-version`, `realtime-version`, `pgmeta-version`, `studio-version`,
`edge-runtime-version` and `logflare-version`. Kong 2.8.1, Mailpit v1.31.3
and Vector 0.58.0-alpine are CLI 3.0.0 defaults, not configurable pin files.
Verified against CLI source tag v3.0.0, commit
`c4ffa9cd6686077bbf7fa43d032e426c925f2671`. Renderer consumers must pin the
CLI as well as write the supported files. No image pull was needed for the
correctly pinned startup. An alias-workdir experiment initially copied pins
one directory too deep and attempted downloads; it was stopped and retried
with pins at the correct level.

The CLI accepts an absolute external signing-key path. Auth requires a UTF-8
JWK array with `key_ops: ["sign", "verify"]`; a key without key_ops gave
`Failed to load configuration: no signing key found`. Auth was healthy after
correcting the key. `[inbucket]` is rejected with `Use [local_smtp] instead`.
The TOML renderer must use `local_smtp` for the design's mail catcher, including
the production disabled setting; retaining the brief's spelling is not runnable.
Vector could not reach Docker's host logging endpoint on port 2375. The first
CLI experiment excluded Vector, and the production-shaped experiment disabled
analytics, Studio and local_smtp. All three corresponding host ports were closed.

Login roles observed: `authenticator`, `pgbouncer`, `postgres`, `supabase_admin`,
`supabase_auth_admin`, `supabase_etl_admin`, `supabase_functions_admin`,
`supabase_read_only_user`, `supabase_replication_admin`, `supabase_storage_admin`.
Rotated all ten and re-created the service containers with updated credentials.
Auth and Storage consume database URLs, REST uses PGRST_DB_URI, Realtime and
Analytics use DB_PASSWORD with DB_USER/DB_USERNAME, Meta uses PG_META_DB_PASSWORD,
Studio uses POSTGRES_PASSWORD and Functions uses SUPABASE_DB_URL. Every default
password probe from a separate postgres:17-alpine container was refused.
`auth.sessions.created_at` is timestamptz; `refreshed_at` is timestamp without
time zone. A postgres-owned security-definer function successfully read sessions.

Backup-preserving CLI stop/start retained rotated database passwords but did
not bring the full stack back. Startup's database connection still failed with
password authentication errors. Testing a db.password environment reference and
a direct throwaway password did not establish a safe full-stack restart.
`--ignore-health-check` can exit 0 with only the database running, so exit status
alone must never count as readiness. This triggers the required compose fallback.

**Verified compose baseline:** Supabase self-hosting source commit
`3dd097c78804b672e5f2c1fb954ede0bbf727620`, docker/docker-compose.yml, with the
progress ruling's images substituted. This older baseline retains Kong 2.8.1;
newer upstream compose uses a different gateway. Project `mellodifai_spike_compose`
used unique container/network/volume names and only API 46621 and DB 46622.
Disabled Studio, analytics/vector, mail catcher, pooler and image transformations
(no imgproxy image is available). Added METRICS_JWT_SECRET for the pinned Realtime.
Postgres data and Storage files were bound under E:/mellodifai/spikes/compose.
Auth, Storage, Realtime, Meta, Kong and DB were healthy; REST and Functions ran
without Docker healthchecks. All eight survived compose stop/up with `--pull never`.
All ten login roles accepted their rotated passwords before and after restart;
default passwords were refused. Active services use the compose shared random
POSTGRES_PASSWORD; other login roles received independent random passwords.
Tasks 6/8 must enumerate every login role, rotate any unused roles as well,
and test positive connections in addition to default-password refusal.

Compose equivalents required by section 5.3:

| CLI feature | Compose equivalent |
| --- | --- |
| gen signing-key | Generate an ES256 private JWK array outside the checkout, with kid, alg, use and key_ops; the verified Auth container consumed it as GOTRUE_JWT_KEYS. Never print it. |
| status -o json | Read API/DB endpoints from ENV_TABLE and keys from the external secret store; build the same private status/env-file contract. Docker compose ps supplies container state, not keys. |
| signing_keys_path | Read that external file only at startup and supply GOTRUE_JWT_KEYS through the private service environment. Keep JWT_SECRET external too. |
| email template content_path | Serve the linked template on an internal-only HTTP endpoint and set GOTRUE_MAILER_TEMPLATES_MAGIC_LINK to its URL. Template serving is a Task 6 implementation requirement; no external SMTP was used in this spike. |
| auth.sessions | GOTRUE_SESSIONS_TIMEBOX=168h and GOTRUE_SESSIONS_INACTIVITY_TIMEOUT=24h; the verified Auth container accepted both. |
| restore stop/start | docker compose -p <project> -f <external compose> stop, then up -d --pull never; preserve DB and storage mounts. Re-apply stored role passwords and run probes before writers or tunnel start. |

The TOML renderer remains the environment contract and CLI migration-tool input;
Task 6 must translate it into the pinned compose services rather than call bare
CLI start for hardened stacks. Compose must explicitly pin every service image,
including the three services without CLI version-file overrides. A future
upgrade of the self-hosting baseline or images requires another compatibility test.

Project-ID experiment: starting a second workdir with `mellodifai_spike` reused
the existing containers. Changing to `mellodifai_spike_renamed` attempted a distinct
DB container and failed because 46622 was already allocated. A new project ID
does not move the old project's data or release its ports. Both CLI projects were
stopped with explicit workdirs and --no-backup after checking their IDs; compose
was stopped and removed without deleting its bind-mounted evidence/data.
Live and e2e projects were not altered by the spike. Evidence and private scratch
scripts are under E:/mellodifai/spikes/stack and E:/mellodifai/spikes/compose.

The historical blocked attempts below are superseded by this completed retry.

**Task 5 prerequisite retry (2026-11-02): still blocked before startup.**
The accepted progress ruling permits the existing Docker Desktop daemon for
this spike. It supersedes the disk-location prerequisite in the original
record below. Moving Docker's disk to G: remains an owner maintenance action,
but is not required before this experiment. All workdirs, CLI caches and
evidence for this retry were placed on E:/G:.

`npx --yes supabase@3.0.0` is available with npm cache `G:/caches/npm`.
The spike config still targets only `mellodifai_spike`, ports 46621-46629.
Generated a throwaway ES256 key outside the checkout. The CLI rejected a
PowerShell UTF-16 file, then rejected a single JWK with `Expected array`.
After converting to UTF-8 and wrapping the JWK in an array, config validation
advanced to image pulls. This verifies parsing of the absolute external
`signing_keys_path`, not a working Auth service or signing-key behavior.

The prepared seed references `public.admin_allowlist`, but the spike has no
application migrations. Disabled `[db.seed]` for this infrastructure-only
experiment before the second startup attempt.

The default ECR pull returned `toomanyrequests: Rate exceeded`. Startup then
stalled downloading images. Retried using the installed CLI's
`SUPABASE_INTERNAL_IMAGE_REGISTRY=docker.io` override and the same image
versions. Several images completed, but `supabase/postgres:17.11.0.011`
remained incomplete, including layer `8723e05bc5d1`. A separate Docker Hub
pull and an isolated retry also did not complete. Manifest inspection
succeeded; its largest compressed layer is approximately 310 MB. A disposable
`postgres:17-alpine` container ran `df` successfully and reported approximately
929 GB available inside Docker, so lack of Docker disk space was not observed.

No spike service container started. Consequently login-role inventory,
credential re-templating, restart persistence, disabled-service checks,
session-column/definer checks, project-ID experiments and the bridge password
probe remain untested. **CLI versus compose remains undecided. Task 5's
renderer must not be built on this partial result.** Resume the required
experiments once the pinned service images can be pulled successfully.

Retry evidence: `E:/mellodifai/spikes/stack/evidence/` (startup logs marked
`private` must not be printed, since a successful CLI start can print keys).
The unchanged-branch gates passed from an E: tracked-source copy: frozen
install, lint, root and web typecheck, unit tests, 124 database tests and
3 e2e tests. DB/e2e used API 45621 and Next 3210 with fake providers.
Gate evidence: `E:/mellodifai/tmp/task-5-20261102/evidence/`.
These are baseline results, not renderer RED/GREEN evidence.
Cancelled the remaining pull, then ran `npx --yes supabase@3.0.0 stop
--workdir E:/mellodifai/spikes/stack --no-backup` after verifying the config's
project ID. Exit 0; no spike containers or volumes remained. Removed only the
throwaway signing key and temporary e2e status file created by this retry.
Regenerate the spike key as a UTF-8 JWK array before resuming startup.

**Original Task 2 record (disk prerequisite superseded above):**

**Owner prerequisite discovered:** the active `desktop-linux` Docker context
stores its data in the physical file
`C:/Users/Asus/AppData/Local/Docker/wsl/disk/docker_data.vhdx` (34,165,751,808
bytes at inspection). Neither the file nor its Docker/wsl/disk parent folders
is a reparse point. Docker reports `/var/lib/docker` inside that VM. C: had
319.05 GB free initially, so the 20 GB stop threshold is not the issue; the
standing prohibition on databases, caches, logs and test data on C: is.
An E: CLI workdir would not relocate Docker volumes or container logs.

No spike container was started, no database password was changed, and no live
or e2e database was queried. Moving Docker's disk requires an owner maintenance
window because this daemon also hosts the live stack. Do not stop or migrate
that daemon as part of this spike. The owner must provide a Docker data root
on E:/G: (or another compliant isolated daemon) before the runtime experiments.

**Prepared outside the checkout:** `E:/mellodifai/spikes/stack/supabase/config.toml`
is a rendered copy with `project_id = "mellodifai_spike"`. API/database/Studio/
mail/analytics use 46621/46622/46623/46624/46627; shadow uses 46626, inspector
46628, and the disabled pooler 46629. Optional commented SMTP/POP listeners
remain disabled; do not enable POP on 46626 alongside the shadow database.
`seed.sql` was copied. No signing key or password was generated. A static
assertion passed: eight unique explicit port settings, all in 46621-46629.
This is configuration inspection, not proof that the CLI accepts or starts it.

**Requirements and unresolved decisions:**

- Step 1: rendering done; start, login-role enumeration, service credential
  inventory and external `signing_keys_path`/`--workdir` behavior untested.
  The Supabase executable is also absent from this session's PowerShell and
  Git Bash PATH; provision a pinned CLI on E: before resuming.
- Step 2: rotation, service re-templating, backup-preserving stop/start and the
  working re-apply procedure remain untested. Preflight ruling 22 binds:
  every command, including both restart commands, needs
  `--workdir E:/mellodifai/spikes/stack`.
- Step 3: disabled-service ports, both `auth.sessions` column types, definer
  access, changed project IDs and shared project IDs remain untested. The
  current repo config uses `[local_smtp]`, while the brief asks for
  `[inbucket]`; test the latter explicitly with the pinned CLI and record
  whether it is accepted, rejected or translated. Do not silently substitute.
- Step 4: no bridge-container default-password probe was run. No role is
  claimed to pass the exit probe, including the later `mdf_web`/`mdf_auth` roles.
- Step 5: CLI versus compose is **undecided**. No compose-equivalent procedure
  is represented as verified. If the CLI experiment triggers the fallback,
  record the pinned compose revision and all six required equivalents before
  Tasks 5-12 rely on this spike. This partial result does not clear that gate.
- Step 6: no spike containers or volumes were created, so destructive cleanup
  was unnecessary and was not run. After the future experiment, clean up only
  the verified spike project with `supabase stop --workdir
  E:/mellodifai/spikes/stack --no-backup`.

**Evidence:** runtime files and gate logs are under
`E:/mellodifai/spikes/stack/evidence/`. The full report is
`.superpowers/sdd/2026-11-02-m1-agent-access/task-2-report.md` (gitignored).
Database and e2e gates are pending the same disk prerequisite, not passing.
The E: tracked-source test copy passed frozen-lockfile installation, lint,
root typecheck, web typecheck and `pnpm test` (1,284 passed, 2 existing skips).
The first unit run failed because PATH selected Miniconda's FFmpeg without
`libmp3lame`; selecting the already-installed Chocolatey FFmpeg in the rerun's
process PATH resolved it without a code change. Both logs are retained.
There is no RED/GREEN database evidence and no verified database-stack result
yet. Status is DONE_WITH_CONCERNS under the owner's instruction for open owner
actions; the outstanding experiments must be resumed before dependent work.

### Spike 3: MCP transport (Task 3, 2026-11-02)

**Decision:** use the section 7.1 transport directly. The local Next route and
both required Inspector CLI operations pass; `mcp-handler` fallback was not
needed or tested. No disagreement with the revision 6 design was found.

Disposable app, package lock, HTTP tests and evidence live in
`E:/mellodifai/spikes/mcp/`, not in the repository. Tested Node 22.13.0,
Next 16.4.3, React/React DOM 19.3.0, `@modelcontextprotocol/server@2.4.0`
and Inspector 1.0.3 (the version resolved by npm and pinned in the scratch
lockfile). Inspector emits a v1 deprecation warning but both CLI commands
exit 0. This is local transport compatibility evidence, not remote OAuth or
hosted connector verification.

**Wiring for Task 41:** import `McpServer` and
`WebStandardStreamableHTTPServerTransport` from
`@modelcontextprotocol/server`. Export `runtime = 'nodejs'`. Inside each POST,
create a new server, register `ping` returning text `pong`, then create
`WebStandardStreamableHTTPServerTransport({ sessionIdGenerator: undefined,
enableJsonResponse: true })`. Await `server.connect(transport)`, then await
`transport.handleRequest(request)` with the original Web Request. Close the
server in `finally` after handling completes. Do not pre-parse the body or
override the default body-size limit. GET returns 405 with `Allow: POST`.

**RED/GREEN:** `spike.test.mjs` was written before the route. Against the
running app without `/api/mcp`, all three checks failed with 404 instead of
405, 200 and 413 (`evidence/red-no-route.log`). After adding the route, all
three passed. The final run used the app's own installed Next with default
Turbopack on loopback port 3323 (`evidence/green.log`):

- GET: 405.
- Three independent list/call pairs: HTTP 200, JSON listing exactly `ping`,
  `pong` text on calls, and no `mcp-session-id` response header.
- JSON body larger than the default 4 MiB: HTTP 413.

From `E:/mellodifai/spikes/mcp`, start with `./start.ps1`, then reproduce:

```powershell
node --test spike.test.mjs
npx @modelcontextprotocol/inspector --cli http://127.0.0.1:3323/api/mcp --method tools/list
npx @modelcontextprotocol/inspector --cli http://127.0.0.1:3323/api/mcp --method tools/call --tool-name ping
```

Both exact Inspector commands exited 0; outputs in
`evidence/inspector-list.log` and `evidence/inspector-call.log` contain one
`ping` tool and `{"content":[{"type":"text","text":"pong"}]}` respectively.
The scratch listener was stopped after verification. No provider calls,
credentials, Supabase requests or production endpoints were involved.

**Repository gates:** a fresh tracked-source copy under the spike's `gates/`
directory passed frozen offline installation using the existing E: pnpm
store, lint, root typecheck, web typecheck and unit tests (1,284 passed,
2 existing skips). Chocolatey's installed FFmpeg was selected in the test
process PATH, following Task 2's environment diagnosis. All new cache, tmp
and test output stayed on E:. Logs are `evidence/gate-*.log`.

Database and e2e gates were not run: Docker's physical data disk remains
`C:/Users/Asus/AppData/Local/Docker/wsl/disk/docker_data.vhdx`, as in Spike 2.
The owner must relocate Docker storage to E:/G: or provide a compliant
isolated daemon before those gates can run. No previous task's DB/e2e
results are claimed for this commit. Task 3's transport experiment is
complete; status is DONE_WITH_CONCERNS for those pending repository gates.
Full report: `.superpowers/sdd/2026-11-02-m1-agent-access/task-3-report.md`.

## Deploy log

(Filled by Tasks 33 and 47.)

## Major to task

| Round-5 Major | Task(s) and the test that proves it | Deadline in the round-5 report |
| --- | --- | --- |
| Blocker 1 (step order) | Tasks 4-13 before 14; Task 11 `refuses every target while the m1-floor tag does not exist`, `skips the apps/auth build...`; Task 33 Steps 4-5 | - |
| 1 ACLs and key material | Task 4 (stacks scan), Task 5 (`jwt_secret` via env), Task 10 (`acl`), Task 34 (secret outside the stack folder), Task 35 (`icacls` probe) | before first prod deploy: Tasks 4, 5, 10 precede Task 33 |
| 2 unauthenticated services | Task 5 (render off), Task 8 (probe ports), Task 9 (sign-in-link) | before first prod deploy |
| 3 caller-settable settings | Task 14 (`ignores a preset mdf.job_ctx...`, `recency in UTC`), Task 19 (reads and claim injection on reads) | before first prod deploy |
| 4 ledger tests runnable | Task 16 (`withRealCaps`), Task 23 (`MELLODIFAI_ENGINE_ROOT`), Task 21 (engine commit first), Task 27 (`test:ledger`) | - |
| 5 generate-again skips kie caps | Task 16 (`older generation reserves kie`), Task 19 (exit test) | ledger work |
| 6 close rule charges unsubmitted kie | Task 17 (`no kie entry for a Groq-only resume job or a cancelled generate-again job`) | ledger work |
| 7 call keys without attempts | Task 22 (`call keys carry the job attempt`), Task 24 (`attempt 2 extends`), Task 27 (entries equal fake calls) | ledger work |
| 8 spend beyond estimate | Task 17 (`MDF07`, `over_estimate`), Task 22 (`extends once then reopens`) | ledger work |
| 9 nothing closes on finish | Task 17 (`closes through the trigger`) | - |
| 10 refused extension outcome | Task 24 (`draft_lyrics keeps the best draft...`) | - |
| 11 MDF mapping | Task 14 (`maps MDF02 and MDF06...`, `checks the SQLSTATE before message rules`) | - |
| 12 oauth_upsert match | Task 15 (`accepts AccessToken only through grant...`), Task 45 | before remote enablement: precedes Task 47 |
| 13 interaction cookie and nonce timing | Task 1 (spike), Task 15 (`oauth_flow_nonce_set`), Task 42 (`sets the flow cookie...`, `resume without the cookie is refused`) | before remote enablement |
| 14 one-grant index blocks reconnect | Task 15 (`revokes the expired grant and the abandoned unbound row first`), Task 18 (`purge_oauth revokes...`) | - |
| 15 sign-in in another browser | Task 37 (`sign in with the 6-digit code`), Task 38 (README) | - |
| 16 OAuth e2e topology and issuer | Task 5 (issuer per env), Task 36 (local mode), Task 42 (`MDF_AUTH_ISSUER`), Task 45 | - |
| 17 shared project id and cutover | Task 5 (project ids and ports), Task 6 (`refuses reset...`), Task 12 (cutover), Task 33 Step 2 | before first prod deploy |
| 18 local sign-in origin | Task 5 (dev 3001), Task 37 (`a local origin outside additional_redirect_urls is refused`) | - |
| 19 restore wipes media | Task 12 (`keeps storage objects readable`, `never runs stop --no-backup`) | before first prod deploy |
| 20 rotation survives restarts | Task 2 (spike), Task 8 (`reapplyDbPasswords`), Task 10 (`re-applies passwords and probes after supabase starts`), Task 35 | - |
| 21 stamp trigger on requeues | Task 19 (`jobs_stamp_ctx does nothing without mdf.job_ctx...`) | - |
| 22 rls.test and file count | Task 31 (nine files), Task 32 (`rls.test.ts` rewrite in the lockdown commit) | - |
| 23 web-side rate checks | Task 20 (`21st style format`), Task 30 (`no OpenRouter call`) | - |
| 24 missing wrappers | Task 20 (`audio_keep`, `take_choose`, `admin_project_create`), Task 29 (mapping) | - |
| 25 existing worker guards | Task 22 (guard still refuses), Task 27 (`ALLOW_TEST_KIE=1`) | - |
| 26 loopback port takeover | Task 35 (`a port owned by another account stops cloudflared`) | before remote enablement |
| 27 pairing window | Task 15 (`registration_claim succeeds once`, `loopback-only client consent is refused when remote`), Task 42, Task 43, Task 44 | - |

## Nits applied in tasks

| Nit | Task |
| --- | --- |
| 1 schema before default privileges | 14 |
| 2 `admin_pairing_open(p_ctx)` | 15 |
| 3 `test_run` by a before-insert trigger | 19 |
| 4 `reserve_job` idempotent per job | 16 |
| 5 idempotency key on early refusals, `actor_key` | 14 |
| 6 env URL rewrite, owner email location | 8, 9 |
| 7 file list gaps (hook, fake servers, resolveAlias, sign-in module, `rotate-auth-keys`, workspace glob) | 4, 14, 19, 27, 37, 42 |
| 8 `check-no-keys` scope and JWK shape | 4 |
| 9 `cloudflared` after the probe, own account | 35 |
| 10 edge proxy tests and forwarded headers | 36 |
| 12 the `test:db` guard is created | 7 |
| 13 month `used` | 17 |
| 14 explicit test price updates | 16 |
| 15 storage delete policy profile check | 32 |
| 16 Rome date for daily tasks | 18 |
| 17 two messages to `validation` | 14 |
| 18 claim injection on reads | 19 |
| 19 client name truncation | 15 |
| 21 dev role passwords | 6 |
| 22 `pg_attribute.attacl` | 32 |
| 23 `db.ts` line references | 25 |
| 24 prod `email_sent` | 5 |
| 25 CLI devDependency | 46 |
| 26 duplicate Playwright flags | 7 |
| 27 several entry ids per `engine.run` | 23 |
| 28 `__Host-mdf_flow` name (first half) | 42 |
| 29 remote PATs need `remote_mcp` | 15 |
| 30 token owner role re-check | 15 |
| 32 `close_reservation` locks and checks open (second half) | 17 |

## Parked nits

- **Nit 11 (stale references):** 22 still lists ntfy as "M1 push"; 16, 15.2 still say `ledger_entries`. Design wording only; fix when the M2a plan edits those sections. (The 6.3.6 pointer was corrected in revision 6 with Major 24.)
- **Nit 20 (songs cursor on `updated_at`):** changing the frozen 7.2 cursor is a contract decision, not a wording fix. Task 19 implements 7.2 as written; revisit before v1 is announced to agents.
- **Nit 28, second half (two concurrent flows in one browser overwrite the cookie):** spike 1 records the behaviour; the user restarts the flow. Revisit if spike 1 shows it happens with the claude.ai connector.
- **Nit 31 (drop `/_next/image` from the edge allowlist):** changes the 5.2 route table; park until W1 reviews the remote UI surface.
- **Nit 32, first half (no resolver for ambiguous section edits):** keeping the reservation `ambiguous` keeps its charges counted, which is safe; a resolver belongs with the section-edit token tools in M2a.
- **Nit 33 (state in 17 that Next's keys are unmetered in M1):** 7.4 already says it; the 17 row lands with the M2a metering work.

## Execution handoff

Execution method: subagent-driven development (superpowers:subagent-driven-development), already chosen. The owner is away and has authorized autonomous execution: builders test, commit and push without asking (OD7), and stop only at an owner action that is still open (22), recording it in the "Deploy log".
