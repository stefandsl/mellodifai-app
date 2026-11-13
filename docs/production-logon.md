# Production startup after logon

The owner account runs the limited, interactive scheduled task
`MellodifAI production logon`. It requires no stored owner password or elevation.
Native is now the default runtime. The reviewed task bypasses Docker and
uses a pinned ops copy to start the native stack, reapply the existing database role
passwords, probe the database, and start the deployed worker/auth/web/edge services
in order. A tunnel is started only when already configured and verified.
Repeated starts preserve a managed process whose PID and creation time match.
There is no reset, restore, deployment, or key rotation in this task. Native
startup checks its migration ledgers and applies the deployed release's pending
migrations through the normal stack entry. Applications wait for gateway health.
The explicit Docker runtime retains its Docker readiness wait.

The installed 2026-11-08 copy still uses Docker until the owner updates the task.
See [native production operations](native-production.md) for the exact pinning and
task-update commands, data import, backup and restore. Run 4 changed no installed
task, service or account. Read-only inspection found this task under Asus with a
Limited principal and no MellodifAI SCM services. Native children have bounded
restarts; application hosts stop after five retries. CLI status lists every part.

`ops/logon.ps1` retries up to 60 times, with 10 seconds between attempts, and
requires HTTP health with web/db/ops all `ok` and a worker heartbeat younger than
60 seconds. It logs fixed diagnostics to `E:/mellodifai/logs/logon.log`.
Raw Docker output, subprocess output and health response bodies are not logged.
The fixed SMTP setup notice is retained once per recovery run, even when
services become healthy. No SMTP secret or arbitrary child output is retained.
Concurrent recovery runs are prevented by a per-session mutex.
The previous Docker task passed a live one-attempt recovery on 2026-11-08:
exit 0, web/db/ops ok and a fresh worker heartbeat. At that time production ran
reviewed tag `m1-prod-ports-20261108-r3`. It has been down since 2026-11-12;
the native production move is still pending. A real reboot was not part of
either verification.

The installation on 2026-11-08 uses:

```powershell
$ops = 'E:/mellodifai/ops-pinned/prod-ports-logon-2026-11-08-r2'
powershell.exe -NoProfile -NonInteractive -ExecutionPolicy Bypass -File "$ops/logon.ps1" -Action install
# Run one diagnostic attempt without waiting for another logon:
powershell.exe -NoProfile -NonInteractive -ExecutionPolicy Bypass -File "$ops/logon.ps1" -Attempts 1
# Disable logon startup without stopping the running application:
powershell.exe -NoProfile -NonInteractive -ExecutionPolicy Bypass -File "$ops/logon.ps1" -Action disable
```

Installation normally registers an AtLogOn task for the current user with a
Limited/Interactive principal. If Windows policy refuses that task, the installer
can create a per-user Startup shortcut instead. Disable removes that shortcut
only when it points to this installer. No runtime logs or caches are put on C:.
The scheduled task was successfully registered on this machine; no shortcut was
needed. A real reboot has not been performed as part of this recovery.

The pinned directory is created with `pinOps` in `ops/deploy.ts`, using the
reviewed source checkout, its lockfile and the E: package store. Keep this pinned
directory while the task references it. To adopt newer startup code, create a new
pinned copy and run its installer. The application clone remains independently
managed by `pnpm ops deploy.ts --to <reviewed-tag>`; never raw-checkout that clone.

## Historical Docker port recovery, 2026-11-08

The Docker installation used API 44321 and DB 44322, outside Windows dynamic range
49152-65535. Shadow/inspector/pooler used 44326/44328/44329. The native runtime
retains API and DB ports and assigns its own services within the same block,
as listed in native-production.md. The former
54321/54322 bindings fell inside exclusion 54231-54330 after a reboot.
The port move keeps the same Compose project, database volume and storage volume.
`ops/stack.ts start` checks the configured ports against dynamic and excluded
ranges before rendering. Inspect exclusions with
`netsh interface ipv4 show excludedportrange protocol=tcp`.

Deploy the tested tag using `pnpm ops deploy.ts --to <reviewed-tag>` after the
new bindings are reachable for the normal backup. Regenerate application env
URLs privately before building, reusing all existing credentials. The deploy
password step rewrites the web/auth database URLs. Verify local health reports
web/db/ops ok with a worker heartbeat under 60 seconds. Recovery evidence and
the installed task revision are in `E:/mellodifai/codex-streams/prod-ports/report.md`.

The root `pnpm ops` script now uses `pnpm --dir ops exec tsx`: the previous
recursive filtered exec printed a stray `undefined` after failed commands.
Service diagnostics retain the failing stage, service and safe system error
code; arbitrary exception strings and subprocess output remain private.

## Production email through Resend

The production renderer selects `smtp.resend.com:465`, user `resend`, sender
`no-reply@mellodifai.com`, and name `MellodifAI`. Dev, e2e and CI retain Mailpit.
The password is always the reference `env(MDF_SMTP_PASS)` in TOML; Compose
receives it from `E:/mellodifai/secrets/smtp.env` (or `secrets/smtp.env` under
`MELLODIFAI_ROOT`). The file uses KEY=VALUE lines and must contain
`MDF_SMTP_PASS=<Resend API key>`. It is never sourced as executable code.

Create the empty file with an owner-only ACL before entering the key in a local
editor. For example, in the owner PowerShell session:

```powershell
$path = 'E:/mellodifai/secrets/smtp.env'
if (Test-Path -LiteralPath $path) { throw 'Preserve the existing SMTP file' }
New-Item -ItemType File -Path $path | Out-Null
$acl = New-Object System.Security.AccessControl.FileSecurity
$owner = [Security.Principal.WindowsIdentity]::GetCurrent().User
$acl.SetOwner($owner)
$acl.SetAccessRuleProtection($true, $false)
$acl.AddAccessRule((New-Object System.Security.AccessControl.FileSystemAccessRule($owner, 'FullControl', 'Allow')))
Set-Acl -LiteralPath $path -AclObject $acl
```

Startup accepts the current owner and optionally SYSTEM, with inheritance off;
other allow grants disable SMTP. Missing/unreadable files, absent/empty keys and
unsafe permissions produce one setup notice and allow the stack to start without
SMTP. The loader ignores any ambient `MDF_SMTP_PASS`, does not modify the parent
environment, and supplies the file value only to the selected runtime. Only
the GoTrue Auth process references it. The contract clears the SMTP host when the
password is absent; no secret bytes are written to rendered files.

`stack.ts start --env prod` loads the file for the selected runtime. Logon recovery uses the
same loader. The Docker branch refreshes SMTP references in the existing auth service,
preserving volume mappings and the rest of the stack. After installing a new
pinned ops copy as described above, the logon task adopts this behavior too.
The currently installed older pinned copy must be replaced before relying on
SMTP recovery. The SMTP workstream stops before deployment when the file is
absent; its report records whether a real email was sent.
