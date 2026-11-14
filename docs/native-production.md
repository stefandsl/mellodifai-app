# Native production operations

Run commands from the reviewed checkout on E:, through pnpm. These instructions are for the coordinator's later production move. Run 4 did not operate on production, install tasks or change accounts.

```powershell
$env:TEMP = 'E:/mellodifai/tmp'
$env:TMP = $env:TEMP
$env:TMPDIR = $env:TEMP
$env:npm_config_cache = 'E:/mellodifai/cache/npm'
$env:npm_config_store_dir = 'E:/mellodifai/cache/pnpm'
$env:MELLODIFAI_RUNTIME = 'native'
$env:MELLODIFAI_ROOT = 'E:/mellodifai'
```

Do not set MDF_NATIVE_REHEARSAL_PORT_BASE on production. It is accepted only on the literal, non-linked root E:/mellodifai/native-lab-prod and only for ten-port blocks within 46300-46399. Run 8 uses base 46300, API 46301, DB 46302, Auth 46300, templates 46305, REST 46308 and Storage 46309. It shares only the installed immutable artifact cache with native-lab. Production retains its configured 44320-44329 block.

## Preserve identity before the first move

Keep these existing files. Do not rotate keys during the move, and never import globals.sql:

| File under MELLODIFAI_ROOT | Why it must survive |
| --- | --- |
| secrets/supabase/signing_keys.json | Supabase ES256 signing and verification keys for existing JWTs |
| secrets/supabase/stack-secrets.json | Existing API keys, fallback JWT secret and other stack credentials |
| secrets/supabase/jwt-secret, when present | Production legacy HMAC secret, also used by Storage signed URLs |
| secrets/supabase/db-passwords.json | Existing postgres, mdf_web and mdf_auth logins; these are independent of recovered role password hashes |
| secrets/auth/jwks.json | Application OAuth issuer signing keys |
| deploy/apps/auth/.env.local | Preserve MDF_AUTH_COOKIE_KEYS and MDF_AUTH_ISSUER, plus the existing JWKS path |
| deploy/apps/web/.env.local and deploy/apps/worker/.env.local | Preserve the matching anon/service API credentials and application origins |

Native Auth, REST, Storage and gateway load the same Supabase files through the shared contract. Native initialization refuses missing production signing, stack or DB stores. The additional secrets/supabase/native-logins.json stores distinct native service passwords. Database login rotation does not invalidate user JWTs, PATs or OAuth clients.

PATs are SHA-256 hashes in public.agent_tokens, with no pepper. OAuth opaque identifiers use SHA-256 in public.oauth_store; the application resolves them through ops.resolve_access_token and ops.oauth_find. Their rows, grants, caps, flags and original origins must survive. Keep application OAuth cookie and signing keys for browser sessions and signed tokens. Expired or revoked tokens remain expired or revoked. The recovered dump has zero PAT/application OAuth-store rows and zero Auth OAuth clients, so the rehearsal could verify their preserved absence but could not exercise a historical token. It preserved all 56 Auth sessions and password hashes and verified a recovered user via the Auth admin API. Production signing files were not copied into the lab.

## First move from offline recovery

Keep application writers and public ingress stopped throughout the move. Use only a newly bootstrapped native target. The importer refuses any row in public, auth.users or storage.objects, including bootstrap configuration rows. It compares all three migration ledgers before writing, retaining native schemas, functions, policies and native-only checksums. Docker-only schemas and all recovered role passwords are excluded.

```powershell
pnpm ops stack.ts install --env prod --runtime native
pnpm ops stack.ts start --env prod --runtime native --init-production
pnpm ops native-prepare-import.ts --env prod E:/mellodifai/backups/native-bootstrap-20261113 --apply --confirm-production
pnpm ops native-import.ts --from E:/mellodifai/recovery/20261113 --env prod --check --confirm-production
pnpm ops native-import.ts --from E:/mellodifai/recovery/20261113 --env prod --apply --replace-empty-only --confirm-production
```

Preparation accepts only the exact bootstrap table counts, including zero users and business data. It stops APIs, inspects, backs up, checks again and truncates while retaining one exclusive stack lease. It leaves the database and APIs stopped and a prepared maintenance journal that blocks ordinary startup until import or recovery. It is exclusively for a just-created target. Do not use preparation against an existing installation.

Check opens only the maintenance database, reads the recovery directory and target without changing their data, then leaves the stack stopped. It accepts the prepared journal. Apply retains the same exclusive lease from preflight through backup, staging all 181 files, transactional load, publication, restart and verification. It disables history triggers for the load, restores sequence values, validates foreign keys, compares every imported table's contents and counts and compares RLS policies. After publication it verifies five authenticated downloads and an Auth admin lookup. The expected totals are 15 users, 18 projects, 28 versions, 24 jobs, 101 current objects and 2180 audit rows. Historical files retain their manifest attributes; current metadata comes from storage.objects.

On ordinary failure, apply restores its pre-import backup and leaves the stack and application writers stopped. Import and restore publish the same durable journal, stacks/prod/native/maintenance-journal.json, before shutdown and the pre-operation backup. Ordinary start, logon and direct supervisor startup refuse to serve while that journal exists (exit 1). After process termination or power loss, use the recorded backup path:

```powershell
pnpm ops native-backup.ts recover-import --env prod <recorded-backup-directory> --confirm-production
```

Recovery is repeatable until complete. If interrupted while preparing the backup, no target data was replaced: recovery stops the stack and abandons that operation. If replacement began, recovery restores both the database and object folder from the completed pre-operation backup before removing the journal. It preserves displaced Storage directories for inspection. It does not delete the source, secrets or backup. Restart, prepare the empty target if necessary, and repeat check/apply. Do not erase a pending journal to bypass recovery. The recover-import command also handles interrupted native restores and legacy import journals.

## Start, stop and status

```powershell
pnpm ops stack.ts start --env prod --runtime native
pnpm ops probe.ts --env prod
pnpm ops services.ts start
pnpm ops services.ts status
pnpm ops stack.ts status --env prod --runtime native
pnpm ops services.ts stop
pnpm ops stack.ts stop --env prod --runtime native
```

Services start Supabase first, then worker, application auth, web, edge and configured tunnel. Applications wait for gateway health. Native stack status lists PostgreSQL, templates, Auth, REST, Storage and gateway, with process identity, listener and restart count. Production has no Mailpit. A stopped stack status exits 1 intentionally. Production reset is always refused; use restore.

The native supervisor restarts failed children at most five times in ten minutes. The Windows application host makes at most five retries during its lifetime, with exponential delays capped at 30 seconds. An exhausted host exits and removes its PID record. A dead stack supervisor is diagnosed as degraded; the next explicit start cleans up only matching recorded processes before restarting.

## Startup task and owner action

All native start, stop, reset, migrate, backup, import, prepare-import, restore, rotation and deploy operations hold one OS-backed exclusive stack lease for their full lifetime. Service start/stop and logon use the same lease. A competing command waits at most five seconds for ownership, then exits 1 naming the holder's command and PID. The supervisor has a separate lifetime lease. Windows closes the lease handle when its helper or owning process dies; stale marker files never grant ownership and are never deleted for takeover. Nested deployment operations run in the owning process. Do not launch older tools that predate this lease against the same root.

Inspection on 2026-11-13 found the scheduled task `MellodifAI production logon`, account Asus, Limited, Ready; no MellodifAI Windows SCM services were found. The owner previously installed the restricted accounts and ACLs. Worker and the native supervisor run as the invoking owner. Web and edge use mdf-web, application auth uses mdf-auth, and cloudflared uses mdf-tunnel, through the existing credential files and Windows Job Objects.

Create a reviewed pinned copy, without changing the task:

```powershell
pnpm -s ops pin-native.ts --stamp native-20261113-run4
```

Then the owner runs this one task-update command in the owner session:

```powershell
powershell.exe -NoProfile -NonInteractive -ExecutionPolicy Bypass -File E:/mellodifai/ops-pinned/native-20261113-run4/logon.ps1 -Action install -Root E:/mellodifai
```

It replaces the task's script reference; it does not install SCM services or change application accounts. The task uses the Limited/Interactive principal. If the pinned directory's existing ACL requires administrator access, the owner must create the new copy with that access; agents must not elevate. Before this step, reviewed CLI start/stop/status and recovery work, but the old installed task still waits for Docker. Afterwards, logon uses native startup and never probes Docker. A reboot was not part of the rehearsal. Do not rerun services.ts install unless account/ACL provisioning is independently required.

## Backup and restore

```powershell
pnpm ops native-backup.ts backup --env prod E:/mellodifai/backups/native-20261113
pnpm ops native-backup.ts restore --env prod E:/mellodifai/backups/native-20261113 --confirm-production
pnpm ops services.ts start
```

Backup stops application writers and API services, uses pg_dump, copies current and historical files, and writes a checksum/metadata manifest last. The manifest is the completion marker. Restore verifies checksums and migration ledgers before changing data, backs up the current target, loads data transactionally into the existing schema and rebuilds NTFS metadata streams. It retains displaced object directories. Writers remain stopped after either operation until explicitly started. Do not restore a data bundle into different migration ledgers. For a schema-changing rollback, prepare a separately reviewed target at the matching schema; this tool does not undo migrations.

New native bundles use manifest format 2 and record source environment, stable installation UUID, the database fake-stack flag and a fingerprint of every application ledger row/checksum. The UUID is created at first boot (existing native roots adopt one once) and survives imports, restores and resets. Production restore rejects non-production, fake or unidentified native bundles before shutdown, even with --confirm-production. Older native format-1 bundles have no production provenance and are refused for production. Startup refuses a true fake_stack flag for a non-fake environment instead of overwriting it. The manifest-less recovered Docker directory is accepted only by native-import with its exact counts, 54-row migration ledger ending at 20261103080001, matching target/service ledgers and false fake-stack flag.

## Deploy and rollback

```powershell
pnpm ops deploy.ts --to <reviewed-tag>
pnpm ops deploy.ts --to <previous-reviewed-tag> --skip-migrations
```

Native deploy starts the current stack if needed, stops writers, takes a native backup bundle, checks out the tag in the dedicated clone, installs dependencies, and runs that clone's native migration entry unless skipped. It reapplies stored database credentials, builds and verifies health before completing. Existing m1-floor checks remain. A health failure rolls back automatically only when the migration list is unchanged; otherwise writers stay stopped for recovery. No production deploy was rehearsed against the real clone. Unit tests use a fake runner for both runtimes and skip-migrations.

Run 8 also rehearsed tagged native deploy, schema advance, skip-migrations rollback and cold start in a disposable local Git clone in the production-shaped lab. Native database, backups, migrations, credential probes and startup were real; application builds/processes and web health were simulated. This does not validate application compatibility with an older release or replace review of a production rollback.

For a reviewed schema-compatible rollback, --skip-migrations records stacks/prod/native/schema-rollback.json durably after selecting the target. It binds the complete current version/checksum ledger and the older release's migration checksums, and records the accepted latest version for health checks. Cold start may accept the forward schema only while both fingerprints match exactly. A new ledger row, changed checksum, different release or unrecorded forward schema still refuses startup. The marker never applies pending migrations from an older release. A normal deploy clears this exception before migrating. Do not hand-edit or copy the marker to authorize a different schema.

Migration planning follows the Docker include-all ordering: until the lockdown 20261103080001 has run, unapplied older versions are applied in version order. New migrations after the lockdown are allowed and must not undo it: after the lockdown and after every later migration, the runner executes `ops/native/postgres/lockdown-guarantees.sql` in the same transaction. It asserts what the lockdown established (ops.lyric_alignment_request stays a postgres-owned security definer with an empty search path, executable by mdf_web and not by PUBLIC, anon or authenticated; no public function is executable by PUBLIC or anon, and authenticated only the six reviewed read functions; no client insert or update on jobs, no client insert on projects or versions, at table or column level; the two dropped job policies and resolve_kie_submission stay absent; the studio file delete policy keeps its exact profile check). A broken guarantee fails the migration with SQLSTATE MDFLK and rolls it back with no ledger row. Changing a guarantee is a reviewed edit of that file. Once the lockdown is applied, a file older than the newest applied version (a backdated file) is refused before anything runs: the lockdown uses plain CREATE FUNCTION and cannot be replayed. Edited applied migrations and ledger versions without local files remain errors, except for the exact deploy-recorded rollback marker described above.

## Rotation

```powershell
pnpm ops rotate-db-passwords.ts --env prod
pnpm ops rotate-supabase-keys.ts
pnpm ops rotate-auth-keys.ts --env prod
pnpm ops probe.ts --env prod
pnpm ops services.ts start
```

Database rotation preserves distinct native passwords, stops writers, restarts with the new stores, rejects old credentials and verifies current/default/empty logins. The private native-db-rotation.json journal must be resolved if interruption leaves it pending; do not print it. Supabase rotation changes API/JWT signing material, restarts native services, updates canonical web/worker env files and rebuilds web. It invalidates old Supabase credentials and signed URLs. Auth issuer rotation intentionally keeps old signing and cookie keys for overlap; it does not revoke existing OAuth sessions. All three are separate maintenance operations, never part of import or routine logon.

## Native integration gate

After installing and booting the isolated e2e stack, export its private stacks/e2e/test.env into the shell without printing values, then run `pnpm test:native`. It runs two phases. The e2e phase (`MDF_NATIVE_INTEGRATION=1`, set by the runner) covers Storage round trips/restart, the gateway hop guard, log redaction, process-kill recovery, concurrent stack leases, real migration transactions with the lockdown guarantee check, 100 PostgREST locale launches and ten whole-tree hard kills under write load. The rehearsal phase (`MDF_NATIVE_REHEARSAL=1`, `MELLODIFAI_ROOT=E:/mellodifai/native-lab-prod`, port base 46300, set by the runner) covers killed recovery imports, refused imports, production provenance, concurrent maintenance, the prepare-import race and the deploy rollback; it needs the rebuilt rehearsal lab with its `bootstrap-backup` and the read-only recovery folder, and is not run in CI. Each phase writes a JSON report and the run fails if any test skipped, if a phase ran no test, or on any failure; the runner prints one count line per phase. Missing Windows, artifacts, credentials, endpoints or a healthy stack fails the run. Tests are serial and the runner stops the e2e and rehearsal stacks in finally. Local runs require E:/mellodifai/native-lab; CI accepts MELLODIFAI_ROOT within RUNNER_TEMP on a non-C volume, with the same 45620-45629 block. The Windows workflow runs this gate as a required step, restarts the e2e stack and then runs the database suite.

## Gateway boundary

Only the gateway port is meant for clients. The gateway refuses (400) a `Connection` header that names `content-length`, `transfer-encoding`, `host`, `apikey`, `authorization`, `origin`, `expect`, `x-mellodifai-hop`, an identity header or any `x-forwarded-*`, `x-consumer-*` or `access-control-*` name, and a GET or HEAD that carries a body (no Auth, Storage or PostgREST GET route reads one). The framing of every forwarded request is rebuilt from the message Node's strict parser accepted: the validated length, otherwise chunked.

Each stack has a private hop secret, created at first boot in `native-hop.json` beside `native-logins.json` (production: `secrets/supabase/native-hop.json`). The gateway sends it to every upstream in `x-mellodifai-hop`, replacing any client copy. Auth and Storage are built from pinned source with `ops/native/auth/hop-guard.patch` and `ops/native/storage/hop-guard.patch`: without the secret they answer 403 before routing, CORS or forwarded-IP handling, health included. Their readiness probes send it. Do not print, copy or reuse the file; deleting it makes the next start create a new one, which is harmless (the gateway and both services read it at start).

PostgREST is a prebuilt binary and cannot check the header. Its direct loopback access is an accepted exposure: without a JWT it runs as the anon role, whose key is public by design; anything more needs a valid user JWT and RLS decides, exactly as through the gateway. No SQL reads request headers. Its CORS answers only the app's origins, so a foreign page cannot read its answers.

## Logs

Every service writes through the supervisor: each line is redacted (the service's own secret values, any line naming a password, token, key, cookie or authorization, URLs with their query strings and logins, JWT-shaped and other long values) before it reaches the disk. Each log rotates at 10 MiB and keeps five older files (`name.log.1` is the newest). The log folder is private to the owner, like the secret files, and its files inherit that. PostgreSQL logs no statements, parameters or client errors (`log_statement = none`, `log_min_messages = log`, `log_error_verbosity = terse`, `log_min_error_statement = panic`, parameter lengths 0): server lifecycle messages, FATAL and PANIC remain. Auth logs warnings and errors only (`GOTRUE_LOG_LEVEL=warn`); the gateway's request log holds method, route, path without query, status and duration. `pg_ctl.log` gets the same handling: pg_ctl cannot hold a pipe (a server it started would inherit it), so it writes into a private capture file in the log folder, and when it exits every captured line is redacted into the rotating `pg_ctl.log` and the capture is removed. A log line that cannot be written (locked file, full disk) is counted and reported in the file once writing works again; a rotation that fails keeps the live file and its handle (nothing is truncated) and is retried on the next line, and lines past twice the bound are dropped and counted. An error nothing else caught makes the supervisor stop every service cleanly before it exits, as does the death of its lease helper.

Start refuses when the volume holding the stack root has less than 5 GiB free (`MDF_NATIVE_DATA_RESERVE_BYTES` overrides, for tests). While the stack runs, the supervisor checks every minute and writes one warning to `supervisor.log` when free space falls below the reserve, and again only after it recovered and fell again. The C: rule (20 GB) still applies separately.

## Windows logoff and shutdown

The supervisor is a detached, windowless Node process started by the logon task (Limited, interactive). It has no console and no window, so it receives neither console control events nor `WM_QUERYENDSESSION`; Node maps only Ctrl+C, Ctrl+Break and console close (libuv), never logoff or shutdown. It therefore cannot run `pg_ctl stop -m fast` when the session ends: Windows ends the processes and PostgreSQL relies on its crash recovery at the next start, which is safe by design (WAL, `fsync` and `full_page_writes` stay on). Stop the stack before a planned reboot (`pnpm ops services.ts stop`, then `stack.ts stop`) to get a clean checkpoint. Run 10 proved recovery by killing the whole process tree under write load ten times (part of `pnpm test:native`): every acknowledged commit survived and every start was clean. A real logoff or reboot was not performed.

## Install inputs

Every build input is checked against a SHA-256 in `ops/lib/native/manifest.json`. Storage's one Git dependency, pg-boss, is pinned there as the publisher's commit archive; the Storage recipe installs it from that verified file and refuses to build if any installed lockfile package lacks a digest. With a seeded download folder, npm cache and Go module cache, `stack.ts install` works offline (`GOPROXY=off`, `npm_config_offline=true`).

## A service will not start

Run stack status and probe first. Resolve occupied or excluded ports instead of changing production port assignments. Inspect stacks/prod/native/logs/supervisor.log and the named postgres/auth/rest/storage/gateway logs (with their rotated `.1` to `.5` files). Application logs are logs/<service>.log and logs/<service>.error.log; logon writes logs/logon.log. Logs and private backup files stay on E:.

Do not print environment files, credential stores, SQL dumps, arbitrary subprocess output or OAuth payloads. Missing production secret files are a restore prerequisite, not a reason to generate replacement keys. If startup reports a dead supervisor, a normal stack start verifies process identities and performs orphan cleanup. If import/restore or rotation reports recovery failure, keep writers stopped and use the retained backup/journal. Never use Docker or WSL for native recovery.
