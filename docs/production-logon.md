# Production startup after logon

The owner account runs the limited, interactive scheduled task
`MellodifAI production logon`. It requires no stored owner password or elevation.
Docker Desktop must start at that user's logon. The task waits for Docker, then
uses a pinned ops copy to start Supabase, reapply the existing database role
passwords, probe the database, and start the deployed worker/auth/web/edge services
in order. A tunnel is started only when already configured and verified.
Repeated starts preserve a managed process whose PID and creation time match.
There is no reset, restore, migration, deployment, or key rotation in this task.

`ops/logon.ps1` retries up to 60 times, with 10 seconds between attempts, and
requires HTTP health with web/db/ops all `ok` and a worker heartbeat younger than
60 seconds. It logs fixed diagnostics to `E:/mellodifai/logs/logon.log`.
Raw Docker output, subprocess output and health response bodies are not logged.
Concurrent recovery runs are prevented by a per-session mutex.
The updated pinned task passed a live one-attempt recovery on 2026-11-08:
exit 0, web/db/ops ok and a fresh worker heartbeat. Production runs reviewed
tag `m1-prod-ports-20261108-r3`. A real reboot was not part of this verification.

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

## Production port recovery, 2026-11-08

Production uses API 44321 and DB 44322, outside Windows dynamic range
49152-65535. Shadow/inspector/pooler use 44326/44328/44329. The former
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
