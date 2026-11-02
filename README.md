# mellodifai

Mellodifai is a production platform for creating and publishing music video projects.

## Install

```sh
pnpm install
```

## Run the worker

In Windows PowerShell, run the worker by hand after creating `apps/worker/.env.local` from the example:

```powershell
$env:WORKER_ENV_FILES='C:\Users\Asus\Documents\Claude\Projects\ita\.env;C:\Users\Asus\Documents\suno-remake\publish\.env;C:\Users\Asus\Documents\mellodifai\apps\worker\.env.local'; pnpm --filter @mellodifai/worker start
```

## apps/worker/.env.example

The checked-in [worker environment example](apps/worker/.env.example) has empty values for `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `WORKER_ID`, `WORKER_OWNER_ID`, `LYRICS_MODEL`, and `LYRICS_DAILY_CAP`.

## Deploy

1. Apply all Supabase migrations.
   Then upload the Video Studio's stock backgrounds once (`apps/worker`: `node node_modules/tsx/dist/cli.mjs scripts/visualizer-stock.ts`); the uploads bucket takes files up to 100 MB, which also needs the project's global upload limit at 100 MB or more.
2. Insert the administrator email into `admin_allowlist` before that administrator's first sign-in.
3. In hosted Supabase Auth, disable signups, enable email confirmations, set Site URL to `https://mellodifai.com`, and set the redirect allowlist to exactly `https://mellodifai.com/**` and `https://www.mellodifai.com/**`.
4. Google Cloud OAuth consent screen set to In production (Testing tokens expire after 7 days and publishing stops).
5. Configure the worker environment locally.
6. Perform the first magic-link smoke test.

Preview deployments intentionally do not receive authentication: only the two production domains are trusted redirect targets.

Deploy the web app to Vercel with `apps/web` as the project root. Configure only `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, and `NEXT_PUBLIC_SITE_URL` in Vercel. Add repository secrets `SUPABASE_URL` and `SUPABASE_ANON_KEY` for the keepalive workflow. Outlook link scanning can consume a one-time link; open the link in the same browser that requested it.

## Weekly backup

`apps/worker/scripts/backup.ps1` reads the Supabase session pooler `DATABASE_URL` from `apps/worker/.env.local`, runs `pg_dump`, writes `E:\mellodifai\backups\mellodifai-<date>.sql`, and retains the newest eight backups. `pg_dump` must match the server major version. Schedule it with Windows Task Scheduler if you want weekly backups.

Copy the **Session pooler** URI from Supabase Connect into the local worker environment:
`DATABASE_URL=postgresql://postgres.PROJECT_REF:PASSWORD@aws-0-REGION.pooler.supabase.com:5432/postgres`.
Use your project's actual host and URL-encode the password. Session mode uses port 5432; transaction mode on port 6543 is unsuitable for this backup. Check `pg_dump --version` against `show server_version;` before scheduling the backup.

## Test

```sh
pnpm lint
pnpm typecheck
pnpm test
```

## M1 local production recovery (owner only)

The first cutover remains gated by Task 33: owner authorization, runtime ACLs,
production credentials, dedicated `E:/mellodifai/deploy` clone and service setup.
Run these tools from the operator checkout through pnpm, never from that deploy clone.

`pnpm ops cutover.ts` stops writers, records every public/auth/storage table count,
takes a private data backup, stops the legacy CLI containers and renders the pinned
Compose stack with project `mellodifai`. It adopts the existing database and media
volumes as external volumes; it never deletes them or runs migrations. Any changed
or missing table count fails the cutover. Application services stay stopped for the
subsequent owner-approved deploy. An attempted cutover leaves `legacy-volumes.json`
and before/after counts under `stacks/prod`; inspect these before any manual retry.

`pnpm ops restore.ts E:/mellodifai/backups/<timestamp>-<m1-tag>.sql` validates the
backup tag against `m1-floor` before stopping writers, takes a safety backup, checks
out the backup tag in the deploy clone, resets only SQL with `--no-seed`, imports
with fail-fast transactional psql, reapplies stored passwords and deploys with
`--skip-migrations`. The current deploy must have an exact m1 tag so its safety
backup is identifiable. Backups from before the migration floor are refused.
Keep the media volume: SQL backups contain metadata, not audio/video bytes.

CLI 3.0.0 classifies matching loopback URLs as its local Docker stack even with
`--remote`. The reset subprocess overrides only CLI local-port hints and disables
seed loading, forcing the explicit SQL target with loopback TLS disabled. It never
uses `stop --no-backup`. Auth/Storage migration history is retained because Supabase
data-only dumps exclude it. Failures leave writers stopped; inspect the retained
safety backup before retrying. Never run production recovery as a test.
