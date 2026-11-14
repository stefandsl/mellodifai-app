# MellodifAI for Windows

The owner's local app, installed with one click and opened from an icon. This page is for the
owner (first part) and for whoever maintains it (second part). Production on this PC
(`E:/mellodifai/deploy`, port 3000, `docs/production-logon.md`) is a separate installation and
is not touched by anything here.

## For the owner

**Install.** Docker Desktop must be installed (it is on this PC). Double-click
`MellodifAI-Setup-<version>.exe`, keep the suggested folder (a disk other than C:, for example
`E:\MellodifAI`), write your email, keep both boxes ticked (desktop icon, start at Windows
logon) and press Installa (if a MellodifAI icon is already on the desktop, for example the one
that opens production, it stays and the new one is called "MellodifAI app"). A black window
called MellodifAI prepares the app: the first time it
downloads components (5-20 minutes, needs Internet), then opens MellodifAI in the browser with
you already signed in.

**Every day.** Double-click the MellodifAI icon on the desktop (or in the Start menu). The app
opens in the browser at `http://127.0.0.1:46300`, signed in. If it was off, the black window
first turns it on (Docker Desktop included) and closes by itself.

**After a restart of the PC** nothing is needed: at logon MellodifAI starts Docker Desktop and
itself in a minimised window. The icon then only opens the browser.

**Start menu, folder MellodifAI:**

| Shortcut | What it does |
| --- | --- |
| MellodifAI | Turns the app on if needed and opens it, signed in. |
| Ferma MellodifAI | Turns the app, its song engine and its database off. Data stays. |
| Salva un backup | Saves database and files to `<folder>\data\backups\<date>-desktop`. |
| Ripristina un backup | Lists the backups and puts one back (it saves the current state first). |
| Stato di MellodifAI | Shows what is on. |
| Le tue chiavi | Opens the file for your kie and OpenRouter keys (`data\config\worker.env`). After a change: Ferma MellodifAI, then the icon. |
| Cartella dei backup | Opens the backup folder. |
| Disinstalla MellodifAI | Removes the app; asks whether to delete your data too (default: keep it). |

**Update.** Run the newer `MellodifAI-Setup-<version>.exe`. It finds the installation, turns it
off, replaces the app files, saves a backup of your data, then starts the new version. Your
songs, videos, keys and account stay.

**Uninstall.** Start menu > MellodifAI > Disinstalla MellodifAI (or Windows Settings > Apps).
Answer No to keep your data in `<folder>\data`: a new installation in the same folder finds it
again. Answer Yes to delete database, songs and backups as well.

**If something goes wrong** the black window says what to do in one line and keeps itself open;
the details are in `<folder>\data\logs\desktop-<date>.log`. The most common cases:

- "Docker Desktop non si avvia": open Docker Desktop from the Start menu and wait for "Engine
  running". If it stays stopped, restart the PC. (MellodifAI already clears the stale files
  that made Docker 4.41 quit at start after an unclean shutdown.)
- "Windows ha riservato una porta": restart the PC.
- "Per creare canzoni servono le tue chiavi": open "Le tue chiavi" and add them.

## For maintainers

### Packaging decision

One per-user NSIS installer (`apps/windows/installer.nsi`), no administrator rights, built from
the committed HEAD by `node apps/windows/src/build.mjs` (or `pnpm --filter @mellodifai/windows
build:installer`). It carries:

- `app\`: `git archive HEAD` plus a `VERSION` file;
- `node\node.exe`: the Node.js the build ran on (Node 22), so the owner needs no Node;
- `pnpm\`: the pinned pnpm package (`packageManager` in package.json);
- `mellodifai.ico`: built from `apps/web/app/icon.png` with classic DIB entries only, because
  NSIS silently drops PNG-compressed entries (the electron-builder 26 lesson). The build fails
  if the produced installer has no icon group.

The installer then runs `run.mjs install`, which installs the dependencies from the lockfile
into the install's own pnpm store (`--frozen-lockfile --ignore-scripts`, like production) and
hands over to the controller. Dependencies, Docker images and the web build are made on the
owner's PC rather than shipped: pnpm's junctions and Next's build hold absolute paths, so
building in place is what makes any install folder work, and it keeps the installer small.

Installed layout (`<folder>`, default the non-system fixed drive with most free space):

```
<folder>\app\        this release (replaced on update)
<folder>\node\       node.exe
<folder>\pnpm\       pnpm
<folder>\data\       MELLODIFAI_ROOT: stacks\desktop, secrets\supabase\desktop, config\,
                     logs\, backups\, run\, cache\ (npm, pnpm store), tmp\
<folder>\Disinstalla MellodifAI.exe
```

Registry (HKCU only): `Software\MellodifAI` (InstallDir, Version) and the Apps & features
entry `Software\Microsoft\Windows\CurrentVersion\Uninstall\MellodifAI`. Shortcuts: Start menu
folder, Desktop, and `Startup\MellodifAI.lnk` (logon start, minimised window).

Silent install for tests: `MellodifAI-Setup-<v>.exe /S /EMAIL=<email> /D=<folder>` (exit code 2
when the preparation did not finish, 3 for a refused folder or missing email). Silent
uninstall: `"<folder>\Disinstalla MellodifAI.exe" /S` keeps data, add `/REMOVEDATA` to delete it.

### Runtime

`apps/windows/src/run.mjs` (plain Node, no packages) is what every shortcut runs. It derives
the layout from its own path, keeps caches and temp files in `data\`, installs dependencies if
`node_modules` is missing, then runs `ops/desktop.ts` through tsx:

| Command | Effect |
| --- | --- |
| `setup --email <e>` | First install: owner file, empty keys file, `start`, browser. |
| `start` | Docker, stack, owner account, web build if stale, web, worker, then browser. |
| `autostart` | `start` without the browser, waiting up to 15 minutes for Docker (logon). |
| `open` | `start` if the web app is down, then browser. |
| `stop` | Kills this install's web and worker, `docker compose stop` (data kept). |
| `status [--json]` | Reads `/api/health`. |
| `backup` | Verified data-only dump (`recoveryDatabase().backup`) plus a copy of the storage folder. |
| `restore [folder] [--yes]` | Safety backup, `restoreDatabase("desktop")`, storage files back, start. |
| `update` | Starts only the old database, backs it up, then `start` (migrates and rebuilds). |
| `remove-data --yes` | `docker compose down --volumes` for project `mellodifai_desktop` only. |

The stack is the ops Compose stack, environment `desktop` in `ops/lib/envs.ts`: project
`mellodifai_desktop`, API 46321, DB 46322, Mailpit 46324, shadow/inspector/pooler
46320/46328/46329, web on `http://127.0.0.1:46300`. All are below the Windows dynamic range
49152-65535 (whose reserved blocks move at every boot; the old launcher died on 54322 inside
54231-54330), and `assertWindowsPorts` checks the exclusions before every start. Database and
storage files are bind mounts under `data\stacks\desktop`, so backups and uninstall need no
Docker volume tricks. The old launcher's Supabase CLI stack used project id `mellodifai`, whose
volume `supabase_db_mellodifai` is production's database since the cutover: the desktop app
must never use that id (a test pins it).

Sign-in: the controller mints a one-time link with the stack's service key
(`ops/sign-in-link.ts`) and opens it, so the owner never types a password or a code. The owner
account is created once from `data\config\owner.json` through `ops/add-user.ts` (allowlist row,
then the Auth user). MCP on the desktop origin is PAT-only, like dev (`patOnlySite`).

Process env: the web app gets `data\stacks\desktop\web.env` (anon key, `mdf_web` URL, no
service key); the worker gets `WORKER_ENV_FILES=data\config\worker.env;data\stacks\desktop\worker.env`
(the stack's own keys win). Every `SUPABASE_*`, `MDF_*`, `NEXT_PUBLIC_*` and `TEST_*` variable
from the calling shell is dropped first. Desktop ports are in `OWNER_STACK_PORTS`, so
`test:db`, Playwright and the e2e redirect rules refuse them like production.

Reboot: the Startup shortcut runs `autostart`. If Docker Desktop is not running and its
`%LOCALAPPDATA%\Docker\run` folder still holds socket files, it is renamed aside before Docker
is launched: Docker 4.41 otherwise quits at start ("initializing Inference manager ...
dockerInference"), which is what kept production down after the boot of 2026-11-12.

Limits: Windows x64 with Docker Desktop (WSL2) only; the worker's real engines still use the
owner's fixed paths on this PC (M8 task 6), so on another PC the app runs but those engines
need their paths configured first. The native no-Docker runtime remains M8.

### Verify a build

```bash
node apps/windows/src/build.mjs
```

Then on a Docker-ready PC: silent install into a scratch folder on E:, `run.mjs status --json`,
open the sign-in link, `stop`, `autostart`, `backup`, silent uninstall with `/REMOVEDATA`.
Never point a test at ports 46321/46322 of the owner's real installation.
