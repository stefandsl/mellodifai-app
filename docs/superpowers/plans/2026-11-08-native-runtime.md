# M8 Native Runtime Implementation Plan

> **For the Codex driver:** execute one task and its review before the next. Work alone. Keep Docker as the default until the final cross-platform gate. This plan begins only after M1 `ops/` is on `build/studio-ui`.

**Goal:** MellodifAI can run the same Supabase-backed workflow without Docker on Windows x64, macOS and Linux, while existing Docker installs keep working.

**Architecture:** One TypeScript `ops/stack.ts` selects a `docker` or `native` backend. Native supervises pinned upstream services behind a loopback API gateway. One environment table, key store, migration ledger, backup and restore flow serve both runtimes. OS-specific files only install startup hooks and permissions.

**Tech stack:** M1 `@mellodifai/ops` and `tsx`; PostgreSQL 17, Supabase Auth, PostgREST, Storage, Realtime, Node, Vitest, Playwright. See [design](../specs/2026-11-08-native-runtime-design.md), master design section 25, [M1 plan](2026-11-02-m1-agent-access.md), and external spike report at `E:/mellodifai/codex-streams/no-docker/spike-report.md`.

## Global constraints

- All development, spikes, stack data, caches, logs and test output stay on E:/G:. If C: drops below 20 GB free, stop. No secrets printed or committed. No paid provider calls; `WORKER_FAKE=1` in e2e.
- Do not touch the live Supabase API 54321, shared e2e API 45621, live Next 3000, or owner launcher 3210. The M8 test stack needs its own API, DB and Next ports. Use `E2E_PORT=3234` only if it is free.
- No app-code changes belong to this documentation stream. For implementation, every migration is additive with a database test and unique `20261103<NN>00XX_<name>.sql` name from the assigned migration prefix. Do not renumber an applied migration.
- Keep M1's remote ACL, role password, ledger, token, default-password, backup and tunnel gates. A Docker-to-native switch is explicit and backup-first. Plain commits, no co-author lines or em dash characters.
- On every task: the smallest complete change, update callers and fixtures, run targeted tests. Before the final implementation push run `pnpm install --frozen-lockfile`, `pnpm lint`, `pnpm typecheck`, `pnpm --filter web exec tsc --noEmit`, `pnpm test`, native `pnpm test:db`, native `pnpm e2e`, and Docker regression gates.

## File structure and interfaces

| File | Responsibility |
| --- | --- |
| `ops/stack.ts` | Existing CLI plus `--runtime native|docker`; dispatch, readiness and refusal rules. |
| `ops/lib/native/artifacts.ts`, `manifest.json` | Download, SHA-256, platform and licence checks; atomic E:/G: cache. |
| `ops/lib/native/config.ts` | Convert M1 `ENV_TABLE` to loopback service ports, data paths and environment files. No secret values in generated public config. |
| `ops/lib/native/postgres.ts`, `migrate.ts` | First boot, pinned Supabase roles/schema/extension bootstrap, service and app migrations, pending witness. |
| `ops/lib/native/processes.ts` | Dependency ordering, readiness, shutdown, restart and status. |
| `ops/native-gateway.ts` | API route and WebSocket forwarding with `apikey` enforcement. |
| `ops/lib/native/host-windows.ts`, `host-darwin.ts`, `host-linux.ts` | Thin startup hook installers and permission checks called by `ops/services.ts`. |
| `ops/test/native/*.test.ts` | Artifact, process, gateway, migration and security unit tests. |
| `supabase/tests/native-stack.test.ts`, `apps/web/e2e/native-runtime.spec.ts` | Full stack behavior and critical UI flow on the private native stack. |
| `apps/worker/src/**` | Replace the existing fixed Windows engine, model, font and runtime paths before the platform exit gate. |

`type StackRuntime = 'docker' | 'native'`. `stack.ts <render|start|stop|migrate|reset|env-file|status> --env <env> [--runtime <StackRuntime>]` uses the M1 environment table. `nativeInstall(manifest, platform, root): Promise<ArtifactPaths>` verifies and atomically installs binaries. `nativePlan(env): NativeService[]` is pure and testable; each service has `id`, `command`, `args`, `envFile`, `dependsOn`, `ready`, and `stopTimeoutMs`. `startNative(env)` returns only after all required health probes pass. `stopNative(env)` shuts down in reverse dependency order. `nativeGateway` accepts only `/auth/v1`, `/rest/v1`, `/storage/v1`, `/realtime/v1` and their documented health checks.

## Task 1: Freeze the native artifact matrix

**Files:** create `ops/lib/native/manifest.json`, `ops/lib/native/artifacts.ts`, `ops/test/native/artifacts.test.ts`; modify `ops/package.json` only if an existing dependency cannot verify or extract the selected archive.

- [ ] **Step 1:** Pin versions matching the known Docker stack. For each Windows x64, macOS arm64/x64, Linux amd64/arm64 artifact, record source, SHA-256, entrypoint, runtime dependencies, licence and notice path. The [Slim Services archives](https://github.com/supabase/slim-services/blob/main/HOST_NATIVE_ARTIFACTS.md) cover Linux amd64/arm64 and macOS arm64 only. Windows and macOS x64 need separate release builds; do not mark them supported without a host-process smoke.
- [ ] **Step 2:** On Windows, resolve Auth's `unix.SO_REUSEPORT` compile failure without changing its Linux listener behavior. Resolve Storage's `fs-xattr` Windows file-backend dependency with a durable metadata implementation and upstream review. Build and smoke a Realtime BEAM release on Windows, including Postgres changes, before this task passes. Source patches live in a pinned build recipe, not in runtime mutation. Check third-party redistribution and transitive notices.
- [ ] **Step 3:** Test wrong digest, unsupported platform, interrupted download, archive traversal and missing licence notice. Cache and temporary paths must stay under the configured runtime root. Run `pnpm --filter @mellodifai/ops exec vitest run test/native/artifacts.test.ts` and one process smoke per service on each OS.
- [ ] **Step 4:** Commit `feat(ops): pin native service artifacts`.

**Gate:** all five required services have working, version-matched native artifacts for the release OS set. The 2026-11-08 spike did not satisfy this gate.

## Task 2: Native Postgres and migration chain

**Files:** create `ops/lib/native/postgres.ts`, `ops/lib/native/migrate.ts`, `ops/test/native/migrate.test.ts`, `supabase/tests/native-stack.test.ts`; modify `ops/stack.ts` and existing restore tests only as needed.

- [ ] **Step 1:** Start Postgres 17 on private loopback ports under `<root>/stacks/<env>/native/pgdata`. Initialize the pinned Supabase roles, `auth` and `storage` schemas, exact extension and preload set, then Auth, Storage and Realtime service migrations. Apply app migrations transactionally after these prerequisites. A checksum ledger rejects edits to applied files. A pending witness blocks startup after partial first boot.
- [ ] **Step 2:** Test `auth.uid()`, `auth.users`, `storage.buckets`, `storage.objects`, required extensions, role grants and a signed JWT under RLS. Reproduce and then clear the spike's `storage.buckets` failure by running real Storage migrations. Apply every repo migration in filename order and run `pnpm test:db` on a private native API stack, not a direct database shortcut.
- [ ] **Step 3:** Test first boot, second boot idempotence, interrupted migration recovery, changed migration checksum refusal, and a schema dump comparison with the Docker baseline. Run `pnpm --filter @mellodifai/ops exec vitest run test/native/migrate.test.ts` and `pnpm test:db` with native test environment files.
- [ ] **Step 4:** Commit `feat(ops): initialize native database and migrations`.

## Task 3: Gateway and service processes

**Files:** create `ops/native-gateway.ts`, `ops/lib/native/processes.ts`, `ops/test/native/gateway.test.ts`, `ops/test/native/processes.test.ts`; modify `ops/stack.ts`, M1 `ops/lib/envs.ts` and existing stack tests.

- [ ] **Step 1:** Add `--runtime` dispatch without changing Docker defaults. Use M1 ports and URL names for the public API; allocate private loopback service ports from the native environment. Start Postgres, Auth, REST, Storage, Realtime, gateway in dependency order. Shut down in reverse order and reap child processes on failure, Ctrl+C or restart. Bound restart attempts and write logs under the runtime root.
- [ ] **Step 2:** Gateway tests cover missing/invalid `apikey`, narrow public GET routes for `/auth/v1/verify` magic-link navigation and `/storage/v1/object/sign/...` signed playback, public CORS on signed images after a `/media` redirect, browser CORS preflight including `X-Supabase-Api-Version`, `Accept-Profile` and `X-Retry-Count`, service-role and anon routing, Authorization preservation, forged identity headers, streamed uploads, signed URL query, Range download, unsupported routes, service failure and WebSocket upgrade. Compare responses with Docker on fake data. Do not log keys or tokens.
- [ ] **Step 3:** Integration tests call Auth admin and OTP endpoints, REST RLS and RPC, Storage upload/download/delete/signed URL, and Realtime `postgres_changes`. The isolated e2e Auth configuration permits repeated OTP emails to the fixed test account with a small positive SMTP frequency; keep production limits unchanged. Run `pnpm --filter @mellodifai/ops exec vitest run test/native/gateway.test.ts test/native/processes.test.ts`, then `pnpm test:db`.
- [ ] **Step 4:** Commit `feat(ops): run native Supabase services behind gateway`.

## Task 4: Host startup, permissions and secret handling

**Files:** create `ops/lib/native/host-windows.ts`, `host-darwin.ts`, `host-linux.ts`, their tests; modify `ops/services.ts` and its tests.

- [ ] **Step 1:** Windows installer uses the existing M1 accounts, NTFS ACL and firewall checks, then installs owner-approved startup hooks. Use Scheduled Tasks or Windows services with hidden windows; prove port ownership and clean shutdown. macOS uses `launchd` agents; Linux uses `systemd --user` units. Wrappers invoke TypeScript stack commands and hold no copied passwords.
- [ ] **Step 2:** Test permission refusal, non-system root validation, C: free-space stop, no key in process args/logs, restart after power loss, and tunnel refusal until health and M1 probes pass. Owner elevation remains a recorded owner action, never simulated as complete.
- [ ] **Step 3:** Run `pnpm --filter @mellodifai/ops exec vitest run test/native/host-*.test.ts` plus an OS-specific install/start/stop smoke on an isolated root. Commit `feat(ops): supervise native stack on each host`.

## Task 5: Backup, Docker migration and rollback

**Files:** modify `ops/deploy.ts`, `ops/restore.ts`, `ops/cutover.ts`, their tests; create `ops/test/native/cutover.test.ts`.

- [ ] **Step 1:** Native backup includes database roles, schema and data plus object bytes. Verify a restore into a fresh isolated root and compare row counts and object hashes. Preserve signed URL and key rotation behavior. Docker-to-native migration stops writers, verifies backup, imports, runs probes, and only then changes the target runtime. On any failure, restore backup before resuming the old runtime.
- [ ] **Step 2:** Test interrupted copy, incompatible schema, wrong object hash, missing extension, and rollback. Run targeted restore tests and a full rehearsal using fake providers. Commit `feat(ops): migrate and restore native stacks`.

## Task 6: Portable worker paths and external tools

**Files:** modify `apps/worker/src/stages/utils.ts`, `workspace.ts`, `legacy-import.ts`, `engine.ts`, `main.ts`, `fake/index.ts`, `comfy/config.ts`, `stages/align-lyrics.ts`, `stages/lyric-jury.ts`, `stages/remake.ts`, `stages/stems.ts`, `stages/visualizer.ts`, `stages/thumbnail.py`, and the existing worker tests and fixtures that exercise them. Check any additional worker source path found by a fresh fixed-drive scan before closing the task.

- [ ] **Step 1:** Resolve runtime files from `MELLODIFAI_ROOT` and the external engine from `MELLODIFAI_ENGINE_ROOT`. Keep one engine-root resolver shared by `ENGINE_ROOT`, workspace fonts, and legacy version imports. Require an explicit engine root for real engine stages on a new host; fake mode can use its isolated test root. Resolve legacy render output, ComfyUI, render temp, lyric state, and local model/venv paths through the existing config or explicit environment, with no fallback to an owner's drive. Preserve path validation, secret handling, and behavior for an explicitly configured existing Windows installation.
- [ ] **Step 2:** Replace `Scripts/python` and Windows-only process assumptions with a configured executable or a PATH lookup that works on Windows and POSIX. Make thumbnail font discovery use configured font files or OS font directories; check Japanese, Chinese, Korean and Latin glyph selection on each host. Do not bundle fonts without their licence notices.
- [ ] **Step 3:** Add focused worker tests for Windows and POSIX roots, missing required engine configuration, isolated fake mode, font lookup and process launch. Scan `apps/worker/src` for remaining fixed `C:`/`E:` paths and run `pnpm --filter @mellodifai/worker test` plus `pnpm typecheck`. Commit `fix(worker): resolve engine and runtime paths from config`.

**Gate:** M8 leaves no hard-coded drive path in worker runtime code; `MELLODIFAI_ENGINE_ROOT` controls every engine call and no worker temp or cache lands on C:.

## Task 7: App, e2e and platform exit

**Files:** create `apps/web/e2e/native-runtime.spec.ts`; modify CI workflow, README and `docs/HANDOFF.md`; update existing fixtures only where the native URL changes them.

- [ ] **Step 1:** Run the same app and fake worker against native dev and private e2e stacks. Cover login, project creation, job progress via Realtime and polling fallback, media upload and signed playback, render with fake providers, and shutdown/restart. Check browser layout at 1440x900 and 1360x600 and save screenshots outside the repository. Keep Italian UI copy and English i18n if any visible copy changes.
- [ ] **Step 2:** CI matrix: Windows x64, macOS arm64 and x64, Linux amd64 and arm64 for native service smoke; full `pnpm test:db` and `pnpm e2e` on at least one host per OS, with remaining architectures covered by the same artifact and migration probes. Run Docker regression suite as a separate job. Record OS, artifact version, checksum and test summary without secrets.
- [ ] **Step 3:** Run all required gates from Global constraints. Update the owner runbook with exact install, native start, Docker fallback, backup, rollback and owner elevation steps. Mark production native available only when every required OS passes and the owner executes the administrative installation. Commit `docs: document verified native runtime` and push the implementation branch.

## Open findings to settle before release

1. Storage v1.84.19 cannot install unmodified on Windows (`fs-xattr` excludes win32); the file backend uses POSIX xattrs for metadata. The spike's NTFS alternate data stream adapter passed the app database suite, but a maintained implementation, rename/copy, restart and backup/restore tests are mandatory.
2. Auth v2.197.0 compiles on Windows only after replacing its Unix-only socket option in the spike. The implementation needs a maintained source patch or upstream fix, with equivalent behavior verified on Unix.
3. Realtime source compiled and ran on Windows; the temporary gateway passed the app's French song-to-video flow with Postgres change subscriptions. A pinned Windows BEAM release, reconnect behavior, `wal2json` packaging and production load tests remain. Its presence is required by the app.
4. Supabase's native archives do not currently cover Windows or macOS x64 and do not prove a complete Dockerless stack. Do not infer compatibility from service smoke.
5. The first app migration fails without Storage service schema. Test and pin the full bootstrap order before running app migrations.
