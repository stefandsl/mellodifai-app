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

Do not set MDF_NATIVE_REHEARSAL_PORT_BASE on production. It is accepted only on the literal, non-linked root E:/mellodifai/native-lab-prod and only for ten-port blocks within 46300-46399. The rehearsal used 46320, API 46321, DB 46322, Auth 46320, templates 46325, REST 46328 and Storage 46329. It shared only the installed immutable artifact cache with native-lab. Production retains its configured 44320-44329 block.

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

## Rotation

```powershell
pnpm ops rotate-db-passwords.ts --env prod
pnpm ops rotate-supabase-keys.ts
pnpm ops rotate-auth-keys.ts --env prod
pnpm ops probe.ts --env prod
pnpm ops services.ts start
```

Database rotation preserves distinct native passwords, stops writers, restarts with the new stores, rejects old credentials and verifies current/default/empty logins. The private native-db-rotation.json journal must be resolved if interruption leaves it pending; do not print it. Supabase rotation changes API/JWT signing material, restarts native services, updates canonical web/worker env files and rebuilds web. It invalidates old Supabase credentials and signed URLs. Auth issuer rotation intentionally keeps old signing and cookie keys for overlap; it does not revoke existing OAuth sessions. All three are separate maintenance operations, never part of import or routine logon.

## A service will not start

Run stack status and probe first. Resolve occupied or excluded ports instead of changing production port assignments. Inspect stacks/prod/native/logs/supervisor.log and the named postgres/auth/rest/storage/gateway logs. Application logs are logs/<service>.log and logs/<service>.error.log; logon writes logs/logon.log. Logs and private backup files stay on E:.

Do not print environment files, credential stores, SQL dumps, arbitrary subprocess output or OAuth payloads. Missing production secret files are a restore prerequisite, not a reason to generate replacement keys. If startup reports a dead supervisor, a normal stack start verifies process identities and performs orphan cleanup. If import/restore or rotation reports recovery failure, keep writers stopped and use the retained backup/journal. Never use Docker or WSL for native recovery.
