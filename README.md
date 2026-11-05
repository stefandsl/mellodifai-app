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

Production runs on the owner's Windows PC behind a Cloudflare tunnel. Vercel plus
hosted Supabase is retired; there is no hosted keepalive workflow. Production runs
from the dedicated clone `E:/mellodifai/deploy`, detached at the deployed tag, not
from a development checkout. `MELLODIFAI_ROOT` defaults to `E:/mellodifai`; stacks,
backups, logs, temporary files and secrets stay under that runtime root, never C:.

| Service | Listener | Windows account |
| --- | --- | --- |
| Next | `127.0.0.1:3000` | `mdf-web` |
| Edge proxy (`ops/edge-proxy.ts`) | `127.0.0.1:3080` | `mdf-web` |
| Authorization server (`apps/auth`, when present in the target) | `127.0.0.1:3010` | `mdf-auth` |
| Worker | none | owner |
| Supabase in Docker | loopback API `54321`, database `54322` | Docker Desktop (owner) |
| `cloudflared` | outbound only | dedicated tunnel service account |

Production Studio, mail catcher and analytics are disabled. The tunnel sends
`app.mellodifai.com` to the edge proxy, which allows only the M1 API, MCP, OAuth,
sign-in, consent, health and supporting asset routes. All other routes return 404;
the ingress ends with `http_status:404`. The full remote web UI and public Supabase
gateway are W1 work. Never expose Postgres, Studio, the mail catcher, ComfyUI,
the worker, Docker API or the development server (`127.0.0.1:3001`).

### Owner prerequisites

Complete the applicable [owner actions in design section 22](docs/superpowers/specs/2026-11-01-agentic-studio-design.md#22-owner-actions-and-open-questions)
before enabling remote access. [HANDOFF.md](docs/HANDOFF.md#6-waiting-on-the-owner)
records what has actually been completed and what remains pending.

- Move the `mellodifai.com` nameservers to Cloudflare. Run `cloudflared tunnel login`
  and `cloudflared tunnel create mellodifai` as the owner. Keep credentials and the
  live `config.yml` under `<runtime root>/secrets/cloudflared/`; fill the tunnel ID
  and credentials path from [the ingress template](ops/cloudflared/config.template.yml)
  without changing its ingress. M1 needs no Cloudflare Access application or WAF rule.
- Use administrator rights for `mdf-web`, `mdf-auth`, the tunnel service account,
  NTFS ACLs and the LAN firewall rule. `pnpm ops services.ts install` previews the
  commands; follow [the owner setup script](ops/owner-admin.ps1) for application.
  The runtime root is owner/SYSTEM only; each service gets only its prescribed
  files. Web/auth may not read stacks, backups or other services' secrets, or write
  executable paths. Block LAN access to 3000, 3001, 3010, 3080, 4007, 8188 and
  54321-54329. Running everything as the owner voids the isolation guarantees:
  compromising Next or auth then compromises the PC.
- Provision production env files, Supabase signing material and rotated database
  passwords outside source control, plus auth signing/cookie keys before running
  `apps/auth`. Repair the pending canonical worker env-file ACL and finish the
  production key rotation as recorded in the handoff. Never print or commit keys.
- Configure an SMTP sender for remote sign-in codes. While it is pending, use the
  local no-SMTP sign-in below. While DNS/tunnel setup is pending, use local stdio
  only and keep `remote_mcp` off.
- Confirm the kie USD rate per credit; the current fallback is `0.005 USD` with
  `verified = false`. Separate OpenRouter and Groq keys for Next with low
  provider-side limits are recommended; pending that, copies of worker key values
  are the design fallback. Other provider/publishing actions and their milestone
  gates remain in section 22.

### Cutover and tagged deployments

These are owner operations. Run deploy, cutover and restore through `pnpm ops`
from the operator checkout; restore must not run from the deploy clone it changes.
Do not rerun the one-time cutover on an already adopted stack. Task 33 completed
the current installation's cutover; see [the Deploy log](docs/superpowers/plans/2026-11-02-m1-agent-access.md)
and handoff for evidence and the exact recovery command.

For a legacy installation, `pnpm ops cutover.ts` stops writers, records every
`public`, `auth` and `storage` table count, takes a private data backup, stops the
legacy CLI containers and renders `<runtime root>/stacks/prod` with the same
project ID, `mellodifai`. The pinned Compose backend adopts the existing database
and media volumes as external volumes. It neither deletes them nor migrates data.
Any changed or missing table count fails cutover. Application services stay stopped
for the owner-approved deploy. Inspect `legacy-volumes.json` and before/after count
files under `stacks/prod` before retrying a failed cutover.

Deploy a reviewed, published tag with `pnpm ops deploy.ts --to <m1-tag>`.
`m1-floor` must exist and the target must contain it; older targets are refused.
The tool pins its invoking ops package under `<runtime root>/ops-pinned/<timestamp>`
before changing the deploy clone, then:

1. Stops the tunnel and application writers, keeping the database available for backup.
2. Dumps `public,auth,storage` data to `<runtime root>/backups/<timestamp>-<tag>.sql`,
   recording the previous revision. Tool-managed backups are retained for 14 days.
3. Fetches and detaches the deploy clone at the target, scans for keys and installs
   frozen-lockfile dependencies.
4. Applies pending migrations to the explicit production database, reapplies stored
   role passwords and runs `ops/set-owner.ts`. Production refuses `fake_stack = true`.
5. Builds Next and, when present, auth. Starts services in order: Docker/Supabase,
   worker, auth, Next, edge proxy, tunnel. Startup reapplies database passwords and
   requires a passing security probe. The tunnel requires unchanged ingress and
   correct listener ownership; ownership is rechecked every 60 seconds.
6. Requires local `/api/health` to report `ops: "ok"` and the target's expected schema.

A failed health check rolls back automatically only if no migration was applied.
Otherwise services remain stopped and `<runtime root>/logs/deploy.log` records the
failure; use the owner restore procedure. Auth build/start is skipped when absent
from the target. Publishing a milestone tag does not deploy it or enable the tunnel.

After migrations, upload Video Studio stock backgrounds once from `apps/worker`
with `node node_modules/tsx/dist/cli.mjs scripts/visualizer-stock.ts`; the uploads
bucket and global limit must allow at least 100 MB. YouTube publishing separately
requires the owner's Google OAuth setup, in this order:

1. Google Cloud OAuth consent screen set to In production (Testing tokens expire after 7 days and publishing stops).
2. Configure the worker environment locally with the owner's publishing credentials.

### Sign-in, including without SMTP

Signups stay disabled. The owner adds people locally with
`pnpm ops add-user.ts <email> <admin|customer>`, which allowlists the address and
creates a confirmed auth user. `ops/set-owner.ts` uses `MELLODIFAI_OWNER_EMAIL`
from the environment or `<runtime root>/config/ops.env` to select the owner.

The web app uses `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_ANON_KEY`
for browser reads, and server-only `SUPABASE_INTERNAL_URL`, `SITE_URL` and
`MDF_WEB_DATABASE_URL`. Production `SITE_URL` is `https://app.mellodifai.com`.
Only configured stack origins are trusted sign-in targets. No service-role key
belongs in Next. See [the web README](apps/web/README.md) for sign-in settings.

For OAuth sign-in, the email link only works in the browser that started the flow,
where the authorization flow cookie lives. If the mail app opens another browser,
open the link in the original browser or type the email's 6-digit code on the
original login page. "Codice a 6 cifre" means "6-digit code"; "Accedi con il codice"
means "Sign in with code". If the flow cookie has expired, start the connection
again from the agent in that browser. Mail link scanners can consume one-time links.

With SMTP unset and the production mail catcher off, the owner can run:

```sh
pnpm ops sign-in-link.ts <email> http://127.0.0.1:3000
```

`ops/sign-in-link.ts` uses the worker's service configuration and
`auth.admin.generateLink` to print a single-use local link without sending email.
Open it on the PC to establish a cookie session. The explicit loopback origin
avoids inheriting the public `SITE_URL`. Treat the printed link as a credential:
do not paste it into logs, reports or commits. This fallback does not complete
remote SMTP setup.

### Remote kill

On the PC, turn off `remote_mcp` in Settings > Agenti ("Agents"). Remote PAT use,
OAuth consent and OAuth-token calls are refused immediately; revoke an individual
agent there when only that grant should stop. Enable `remote_mcp` only after local
exit tests and the tunnel smoke test pass, then complete the remote exit test.

Away from the PC, disable the public hostname `app.mellodifai.com` in the Cloudflare
dashboard. This is the remote kill outside the app. Alternatively, with remote
desktop access, stop `cloudflared` on the PC. The local-only settings page is not
available through the M1 tunnel.

### Restore and backups (owner only)

Run `pnpm ops restore.ts E:/mellodifai/backups/<timestamp>-<m1-tag>.sql` from the
operator checkout. It validates the dump and backup tag against `m1-floor` before
stopping writers, quiesces database services, takes a safety backup, checks out
the backup tag in the deploy clone, resets only SQL with `--no-seed`, imports with
fail-fast transactional psql, reapplies stored passwords and calls
`ops/deploy.ts --to <that tag> --skip-migrations`. The current deploy must have an
exact m1 tag so its safety backup is identifiable. Backups below the migration
floor are refused; the sole reviewed pre-cutover dump has an explicit mapping
to `m1-floor` in `ops/restore.ts` and the Task 33 Deploy log.

Keep the media volume: SQL backups contain metadata, not audio/video bytes.
The pinned Compose recovery path keeps that volume and Auth/Storage migration
history. It never uses `supabase stop --no-backup` on production. Failures leave
writers stopped; inspect the retained safety backup before retrying. Never run
production recovery as a test. The former hosted session-pooler weekly-backup
instructions do not apply to this topology; use the tagged deploy backups for
this restore workflow and preserve media separately.

## Test

```sh
pnpm lint
pnpm typecheck
pnpm test
```

Follow [HANDOFF.md](docs/HANDOFF.md#2-rules-you-must-follow-owners-standing-instructions)
for the complete commit gates and off-C validation setup. Database and browser
tests use the isolated e2e stack at API 45621, never live API 54321. Set
`E2E_PORT=3219` while the owner's launcher holds 3210. Never spend paid credits in tests.
