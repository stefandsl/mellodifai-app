# MellodifAI for Windows

The owner's local app, installed with one click and opened from an icon. This page is for the
owner (first part) and for whoever maintains it (second part). Production on this PC
(`E:/mellodifai/deploy`, port 3000, `docs/production-logon.md`) is a separate installation and
is not touched by anything here.

## For the owner

**Install.** Double-click `MellodifAI-Setup-<version>.exe` as your normal user (no administrator,
no Docker, no WSL). Keep the suggested folder (a disk other than C:, for example
`E:\MellodifAI`; the installer refuses C:), write your email, keep the boxes you want (desktop
icon, start at Windows logon) and press Installa. If a MellodifAI icon is already on the
desktop (for example the one that opens production) it stays, and the new one is called
"MellodifAI app". A black window called MellodifAI prepares the app: the first time it
downloads and builds its components (10-30 minutes, needs Internet), creates the database and
your account (the email you wrote, with administrator role), then opens MellodifAI in its own
window, already signed in.

**Every day.** Double-click the MellodifAI icon on the desktop (or in the Start menu). The app
opens in its own window (Microsoft Edge in app mode, with its own profile under
`<folder>\data\browser`), signed in, at `http://127.0.0.1:46300`. If it was off, the black
window first turns it on and closes by itself.

**After a restart of the PC** nothing is needed if you ticked "Avvia all'accesso a Windows":
MellodifAI starts itself in a minimised window. The icon then only opens the window.

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
again. Answer Yes to delete database, songs and backups as well. Nothing outside the
installation folder, the shortcuts and the per-user registry entries is touched.

**If something goes wrong** the black window says what to do in one line and keeps itself open;
the details are in `<folder>\data\logs\desktop-<date>.log` and the database's own logs in
`<folder>\data\stacks\desktop\native\logs`. The most common cases:

- "Windows ha riservato una porta" or "La porta ... e' usata": restart the PC.
- "Non riesco a preparare i componenti": check Internet and open the icon again; the download
  continues where it stopped.
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
hands over to the controller. Dependencies, native components and the web build are made on the
owner's PC rather than shipped: pnpm's junctions and Next's build hold absolute paths, so
building in place is what makes any install folder work, and it keeps the installer small.

Installed layout (`<folder>`, default the non-system fixed drive with most free space):

```
<folder>\app\        this release (replaced on update)
<folder>\node\       node.exe
<folder>\pnpm\       pnpm
<folder>\data\       MELLODIFAI_ROOT: stacks\desktop (native database, files, logs),
                     secrets\supabase\desktop, config\, logs\, backups\, run\, browser\,
                     cache\ (native components, npm, pnpm store), tmp\
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
the layout from its own path, keeps caches and temp files in `data\`, sets
`MELLODIFAI_RUNTIME=native`, installs dependencies if `node_modules` is missing, then runs
`ops/desktop.ts` through tsx:

| Command | Effect |
| --- | --- |
| `setup --email <e>` | First install: owner file, empty keys file, `start`, app window. |
| `start` | Components, native stack, owner account, web build if stale, web, worker, then app window. |
| `autostart` | `start` without the window (logon). |
| `open` | `start` if the web app is down, then app window. |
| `stop` | Kills this install's web and worker, `stack.ts stop --env desktop` (data kept). |
| `status [--json]` | Reads `/api/health`. |
| `backup` | Verified native bundle (`native-backup.ts backup --env desktop`): dump, files, checksums. |
| `restore [folder] [--yes]` | `native-backup.ts restore`: saves the current state, restores, rolls back by itself on failure. |
| `update` | Backs the data up before the new release's first start applies its migrations. |
| `remove-data --yes` | Stops everything that holds files in `data\`; the uninstaller then deletes the folder. |

The stack is the native runtime (`docs/native-production.md`), environment `desktop` in
`ops/lib/envs.ts`, with `MELLODIFAI_ROOT=<folder>\data`. Block 46300-46329: web 46300, gateway
(API) 46321, PostgreSQL 46322, Mailpit web 46324 and SMTP 46327, mail templates 46325, Auth
46320, PostgREST 46328, Storage 46329. All are below the Windows dynamic range 49152-65535
(whose reserved blocks move at every boot) and away from production (3000, 3210-3212,
44320-44329) and e2e (45620-45629); the native start checks Windows' excluded ranges and that
each port is free. The rehearsal lab `native-lab-prod` borrows 46300-46309 only while its
tests run: do not run that gate while the desktop app is on.

Components: the first start runs `stack.ts install --env desktop`, which downloads the pinned
PostgreSQL, PostgREST, Mailpit, Go and Node archives (checksums in
`ops/lib/native/manifest.json`), builds Auth and Storage from pinned source, and keeps all of
it in the app's own cache `data\cache\native`. A folder of already verified archives can be
offered with `MELLODIFAI_NATIVE_SEED` (every file is checked against the manifest). Later
starts never download.

Sign-in: the controller mints a one-time link with the stack's service key
(`ops/sign-in-link.ts`) and opens it in the app window, so the owner never types a password or
a code. The owner account is created once from `data\config\owner.json` through
`ops/add-user.ts` (allowlist row with role admin, then the Auth user): there is no separate
first-user flow in this repo. MCP on the desktop origin is PAT-only, like dev (`patOnlySite`).

Process env: the web app gets `data\stacks\desktop\web.env` (anon key, `mdf_web` URL, no
service key); the worker gets `WORKER_ENV_FILES=data\config\worker.env;data\stacks\desktop\worker.env`
(the stack's own keys win). Every `SUPABASE_*`, `MDF_*`, `NEXT_PUBLIC_*` and `TEST_*` variable
from the calling shell is dropped first. Desktop ports are in `OWNER_STACK_PORTS`, so
`test:db`, Playwright and the e2e redirect rules refuse them like production.

Logon: the Startup shortcut runs `autostart`, as the owner, with no scheduled task, service or
elevation. Windows ends the processes at logoff; PostgreSQL recovers at the next start (see
"Windows logoff and shutdown" in `docs/native-production.md`).

Limits: Windows x64 only; the worker's real engines still use the owner's fixed paths on this
PC (M8 task 6), so on another PC the app runs but those engines need their paths configured
first.

### Verify a build

```bash
node apps/windows/src/build.mjs --out E:/mellodifai/dist/windows
```

Then: silent install into a scratch folder on E: (`/S /EMAIL=<email> /D=<folder>`),
`run.mjs status --json`, open the sign-in link, create a project, `stop`, `start`, install a
newer build over it, silent uninstall (keeps data) and then with `/REMOVEDATA`. Never point a
test at the ports of the owner's real installation.
