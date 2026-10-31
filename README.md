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

Deploy the web app to Vercel with `apps/web` as the project root. Configure only `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, and `NEXT_PUBLIC_SITE_URL` in Vercel.

In hosted Supabase Auth, disable signups and enable email confirmations. Set the Site URL to `https://mellodifai.com`, and add `https://mellodifai.com/**` and `https://*-*.vercel.app/**` as redirect URLs.

## Weekly backup

`apps/worker/scripts/backup.ps1` reads `DATABASE_URL` from `apps/worker/.env.local`, runs `pg_dump`, writes `E:\mellodifai\backups\mellodifai-<date>.sql`, and retains the newest eight backups. Schedule it with Windows Task Scheduler if you want weekly backups.

## Test

```sh
pnpm lint
pnpm typecheck
pnpm test
```
