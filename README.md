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

## Test e2e isolati / Isolated e2e tests

Esegui `pnpm e2e:isolated`. Crea e usa uno stack Supabase separato e una porta web separata, quindi non tocca lo stack predefinito, il worker reale o la porta 3000. By default the isolated stack remains running for quick reruns; use `pnpm e2e:isolated -- --stop` to stop only that stack.
