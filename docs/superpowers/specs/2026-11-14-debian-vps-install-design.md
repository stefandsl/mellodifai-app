# Debian 13 VPS installation design

Date: 2026-11-14. Status: EGM reviewed and remediated in D2; implementation and release gates remain unvalidated. Owner: MellodifAI. Source baseline: `2554b7955bc88e3d87c54ac28c7ba786fe342406`, branch `feat/native-runtime`. Concurrent data-safety work in `ops/` is a prerequisite, not part of this change. Review evidence: `E:/mellodifai/codex-streams/debian-vps/egm/consolidated_review_report.md`. No independent re-audit of the final remediation is claimed.

## Feature specification

### Problem and outcome

The owner needs to install MellodifAI on an empty Debian 13 VPS with a command fetched from GitHub. The Windows installation must remain supported. Today the native runtime has portable application logic but Windows artifact entries, paths, process handling and installation assumptions. Copying the Windows launcher to Linux would expose private upstream services and would not install a working worker engine.

The result is a versioned, repeatable bootstrap and the same native runtime on both platforms. A fresh installation creates private identities, builds a release, initializes production explicitly, starts systemd services and provides an owner access path. Repeating the command upgrades the installation without replacing its data or identity. Restore uses the existing portable native bundle with stronger provenance checks. The installer is maintained by shared inputs and release tests, not a second set of handwritten version numbers.

Goals are Debian 13 amd64, one supervisor and gateway implementation, private services, HTTPS when a domain is supplied, recoverable upgrades, portable backups and unchanged Windows gates. A CPU VPS can serve the web application, OAuth, database, storage and the worker operations whose dependencies are available. It is not a replacement for the owner's GPU workstation.

Non-goals are Cloudflare Tunnel, new product features, GPU engines on the VPS, a distributed render system, high availability, managed databases and other distributions. Existing restrictions on remote studio actions remain. The installer does not promise that a private source tarball contains the external engine or model assets absent from this repository.

### Binding decisions and explicit qualifications

The Windows design at `docs/superpowers/plans/2026-11-13-native-runtime-windows.md` remains binding except for the platform extensions below. `docs/native-production.md`, `docs/production-logon.md`, `docs/HANDOFF.md` sections 1-3 and [run7's review](E:/mellodifai/codex-streams/native-runtime/run7-review.md) inform the operational contracts. No database migration is proposed here. The required final lockdown migration remains last.

| Ruling | Evidence and decision |
| --- | --- |
| Debian 13 amd64; arm64 only with official artifacts | Node, Go, PostgREST and Mailpit publish both architectures. Auth and Storage are source builds by ruling 3. No official standalone Storage arm64 executable was established. Recommend interpreting the rule as official binaries for binary dependencies plus tested source builds. Until that interpretation and arm64 build tests pass, the installer rejects arm64. It must not silently emulate amd64. |
| PostgreSQL 17 from Debian | Debian lists 17.12, whereas the Windows manifest pins 17.11. Select Debian's signed, moving 17.x security candidate and record its installed version. Do not freeze 17.11 or add PGDG to recreate the Windows minor. This is an intentional platform exception to identical artifact pins. |
| Install and build everything | The worker invokes an external `suno-remake` tree that is not shipped here. Recommend qualifying this as all repository-supplied services and declared CPU dependencies. Start a visibly limited worker. Full engine packaging requires its source, lockfiles, licences and verified artifacts in a separate prerequisite project. Do not claim a full render pipeline on day one. |
| Public web and gateway | Existing remote-studio guards reject remote actions. Preserve that policy by marking public ingress as remote. Owner studio access is through SSH loopback. Opening the full studio would change product/security policy and is outside this design. |
| Preserve pre-move sessions and tokens | Retain the database, all signing/cookie keys and the same public origin. Moving to a different hostname cannot preserve old browser cookie scope or OAuth issuer/audience bindings. Recommend making same-origin DNS migration a condition of this promise. |
| One curl command on an empty VM | The command needs curl and CA certificates to exist before it can fetch anything. Minimal images without them require `apt-get update && apt-get install -y ca-certificates curl` once. This is a bootstrap prerequisite, not something a remote script can repair before it is downloaded. |

These qualifications are visible release constraints. They are not permission to weaken Windows, enable fake production engines or advertise untested arm64 support.

### Architecture and ownership

```text
Internet :443 -> Caddy -> web :3000
                     -> OAuth issuer :3010
                     -> shared API gateway :44321
SSH tunnel -> loopback Caddy :8080 -> same routes, owner access
API gateway -> GoTrue :44326 / PostgREST :44328 / Storage :44329
services -> PostgreSQL :44322
systemd -> stack Node supervisor -> PostgreSQL, GoTrue, PostgREST, Storage, gateway
systemd -> web / OAuth app / worker (one unit each)
```

All application listeners bind to `127.0.0.1`; IPv6 wildcard listeners are forbidden. Only Caddy has public listeners. The auth unit is the repository's OAuth application, not GoTrue. The existing Node supervisor owns its stack children, dependency readiness and bounded child restart policy. systemd owns that foreground supervisor process and the three application processes. It does not create competing units for PostgreSQL, GoTrue, Storage or PostgREST.

Releases live at `/opt/mellodifai/releases/<commit>-<buildId>`. The source commit identifies code; buildId is the SHA-256 of canonical build inputs: source commit, lockfile/requirements/artifact receipts, build flags and public configuration fingerprint. Public configuration includes the browser API origin and anonymous key, never private credentials. `/opt/mellodifai/current` selects that complete build generation. Releases and the pointer are root-owned and not writable by services. Runtime data lives below `MELLODIFAI_ROOT`, default `/var/lib/mellodifai`: `stacks/prod/native`, `secrets`, `cache`, `logs`, `backups`, `recovery`, `workspaces` and `deploy`. Existing runtime-root helpers remain the only path authority. A root other than the default must be an absolute normalized local path, outside the checkout and release tree, with no whitespace, control characters, `..` or symlink ancestors. The installer renders all system integration paths from it. The Windows drive-C refusal remains Windows-only; Linux checks mount capacity, ownership and persistence instead.

System users are `mdf-stack`, `mdf-web`, `mdf-auth`, `mdf-worker` and `mdf-build`, each with its own private primary group, no login shell and no password. Debian supplies `caddy`. No application user belongs to another application's group. Root coordinates installation and maintenance. Builds run as `mdf-build`, without production credentials. The stack directory belongs to `mdf-stack`; app state, caches and workspaces belong to their respective users. Parent directories permit traversal only where needed. Root writes service credential sources with mode 0600. Public code is readable, private data directories use 0700 and private files 0600. ACLs on Windows retain the existing equivalent policy.

Only `/etc/systemd`, `/etc/caddy`, the dedicated nftables configuration and apt policy contain machine integration outside the runtime root. They contain configuration, not application data. A small launch link at `/opt/mellodifai/bin/mdf` invokes the current release's operations entry point. It is generated, root-owned and atomically replaced.

### Artifact and package evidence

The following observations were made on 2026-11-14 from the publishers. They are research results, not a claim that this design ran an installation. Keep the existing Windows entries byte-for-byte. Add Linux entries to `ops/lib/native/manifest.json`; use manifest schema 2 with a discriminated `download` or `debian-package` provider. Preserve schema 1 reading for existing receipts. Downloads record URL, archive format, digest, size, strip count, entry point and notices. Package receipts record signed repository origin, package version, architecture and binary path. Never fabricate a stable SHA for an apt candidate.

| Artifact | Official Linux download and publisher evidence | amd64 SHA-256 | arm64 SHA-256 |
| --- | --- | --- | --- |
| Node 24.22.2 | [x64 tar.xz](https://nodejs.org/dist/v24.22.2/node-v24.22.2-linux-x64.tar.xz), [arm64 tar.xz](https://nodejs.org/dist/v24.22.2/node-v24.22.2-linux-arm64.tar.xz); [SHASUMS256.txt](https://nodejs.org/dist/v24.22.2/SHASUMS256.txt) fetched and inspected | `48cc0e21e048790e54c0cf5749c2725005313d652651c40b7a21feb9697aaf75` | `eb187837a2230d4047161ac0be008584e16b46f726e9c9490ee35dc6b17d9ba8` |
| Go 1.27.0 | [amd64 tar.gz](https://go.dev/dl/go1.27.0.linux-amd64.tar.gz), [arm64 tar.gz](https://go.dev/dl/go1.27.0.linux-arm64.tar.gz); [publisher JSON](https://go.dev/dl/?mode=json&include=all) | `675c26c449cbb18fc24b74650de1eabbae6e16f64326fd85a283fb3b58280685` | `51798d2c42d0e1c6ed7fd9f48728b4193abac9e8aad6dbac2fe96a81f5909bda` |
| PostgREST 16.5 | [x86-64 tar.xz](https://github.com/PostgREST/postgrest/releases/download/v16.5/postgrest-v16.5-linux-static-x86-64.tar.xz), [aarch64 tar.xz](https://github.com/PostgREST/postgrest/releases/download/v16.5/postgrest-v16.5-linux-static-aarch64.tar.xz); [publisher asset digests](https://github.com/PostgREST/postgrest/releases/expanded_assets/v16.5) | `5099e7ada38f9f6846cd87c14c5f158b7c165f1e9959665ad412e61f4dceba95` | `96d75a34c7c095d5f97b87f88042f898192724350861328db9e1509e696ea057` |
| Mailpit 1.33.0 | [amd64 tar.gz](https://github.com/axllent/mailpit/releases/download/v1.33.0/mailpit-linux-amd64.tar.gz), [arm64 tar.gz](https://github.com/axllent/mailpit/releases/download/v1.33.0/mailpit-linux-arm64.tar.gz); [publisher asset digests](https://github.com/axllent/mailpit/releases/expanded_assets/v1.33.0) | `d0ec50080cbf3e7c1fa2cda2ee68125d7894175811084b1f8f47c6cfc6f487c8` | `1d27c819e1a5dd2761ed9fd07022443e35a47793b2e92de5b49cf3656a649ef9` |

PostgREST and Mailpit downloads were hashed locally and matched the table. Node and Go checksum listings were inspected; their Linux archives were not executed. Mailpit is a test dependency, not a production SMTP server or public inbox.

| Remaining manifest artifact | Linux decision and verification |
| --- | --- |
| PostgreSQL 17 | [Debian trixie package](https://packages.debian.org/trixie/postgresql-17) listed `17.12-0+deb13u1` for amd64 and arm64 on 2026-11-14. Install `postgresql-17` and `postgresql-client-17` through apt's signed InRelease/Packages chain and package hashes. Use `/usr/lib/postgresql/17/bin`. PGDG is unnecessary for this candidate; Debian does not offer the manifest's Windows 17.11 as today's security candidate. Reject a major other than 17. |
| Auth 2.197.0 | Build the [same source ZIP](https://github.com/supabase/auth/archive/refs/tags/v2.197.0.zip), SHA-256 `359a3235b3280e8c8c175559450a07b72249504edc55b266ab9be1776470526b`, on both architectures. The downloaded ZIP matched the existing manifest. No independent publisher checksum for this generated ZIP was found. This is a reviewed project pin, not a publisher signature. [Official release binaries](https://github.com/supabase/auth/releases/expanded_assets/v2.197.0) exist for Linux amd64/arm64 but lose because the same source patches are required. |
| Storage 1.84.19 | Build the [same source ZIP](https://github.com/supabase/storage/archive/refs/tags/v1.84.19.zip), SHA-256 `513089c295f186f8b7137ebaaf17200c2c4d97485dd745b5b0a243239dff6d95`, on both architectures with pinned Node. Download matched the manifest. No independent publisher checksum for this generated ZIP or standalone official Linux executable was established. Architecture support therefore depends on the native dependency build and tests. |

Verify all archive bytes before extraction. Reject traversal, absolute paths, escaping links and device entries; use a temporary destination and atomic completion marker. Verify cached entries again against the receipt. Source verification does not make package lifecycle scripts trusted. Auth uses `GOTOOLCHAIN=local`, `CGO_ENABLED=0`, readonly modules and the current Go checksum policy. Apply `listener-portable.patch` on both platforms. Its Unix helper preserves socket reuse; the Windows helper is a no-op for the Windows listener problem.

Storage retains `npm ci --ignore-scripts` and an explicit allowlist of required build steps. Its pg-boss dependency currently resolves through Git SSH at commit `89b675b057ff7cec3ca2c434e4d3005c35a76bd9` without archive integrity. Replace that transport in the shared build recipe with a publisher archive at that commit and a reviewed SHA-256 pin. This digest was not established in D1. Task 2 must fetch and review it before any release; an unresolved dependency makes the supply-chain gate fail. Do not fall back to SSH, a moving branch or an unverified npm lifecycle download.

Use Node 24.22.2 from the manifest. [Debian Node](https://packages.debian.org/trixie/nodejs) listed `20.19.2+dfsg-1+deb13u3` on 2026-11-14, below the repository's `>=22.12` requirement. Select pnpm through Corepack at `pnpm@10.2.1`, read from `package.json`, with strict integrity verification and caches below the runtime root. Do not install a global moving pnpm or Debian Node as the application runtime. Frozen lockfiles, Corepack package integrity and an approved lifecycle-script allowlist are required. Build telemetry is disabled. The root `prepare` hook must not attempt Git configuration in an archive installation; the installer invokes dependency installation without repository hook setup.

### System requirements and build policy

The following package names are the selected Debian trixie requirements, dated 2026-11-14. They are a design input. A real apt resolution test must verify their closure and repository origins before release. Versions float within trixie and trixie-security, with exact versions retained in installation receipts. Do not add third-party apt repositories. The names and their phase classifications live once in `ops/native/debian-requirements.json`.

| Phase | Exact package names | Reason |
| --- | --- | --- |
| Bootstrap | `ca-certificates`, `curl`, `jq` | TLS downloads and GitHub metadata parsing before Node exists. |
| Bootstrap | `tar`, `gzip`, `xz-utils`, `coreutils`, `util-linux` | Archive extraction, hashes, atomic file operations, disk/mount checks and installer flock. |
| Build | `build-essential`, `python3`, `libattr1-dev`, `pkg-config`, `git` | Approved native addon compilation, node-gyp, xattr headers and readonly build metadata. Git is not an excuse for unpinned SSH dependency fetching. |
| Runtime | `postgresql-17`, `postgresql-client-17`, `postgresql-common` | Supervisor-owned PostgreSQL, dump/restore tools and package integration. |
| Runtime | `libattr1`, `libstdc++6`, `ca-certificates`, `openssl`, `tzdata`, `locales` | Native addon/shared libraries, TLS, credential generation, UTC and locale support. |
| Runtime | `procps`, `iproute2`, `nftables`, `systemd`, `openssh-server` | Process diagnostics, listener inspection, private-upstream access control, service management and the owner tunnel. Preserve existing SSH keys and access configuration. |
| Runtime edge | `caddy` | HTTPS and the loopback owner proxy in both domain and tunnel modes. |
| Runtime CPU media | `ffmpeg`, `chromium`, `chromium-sandbox`, `fontconfig` | Media probing/transcoding and Remotion browser rendering. `ffprobe` comes with ffmpeg. |
| Runtime CPU media | `fonts-dejavu-core`, `fonts-noto-core`, `fonts-noto-cjk`, `fonts-noto-color-emoji`, `python3`, `python3-pil` | Font coverage and the repository's Pillow thumbnail script. |
| Test host only | `shellcheck`, `shfmt`, `qemu-system-x86`, `qemu-utils`, `cloud-image-utils`, `openssh-client` | Installer lint and the Linux VM harness. Not application dependencies. |

Debian's [Caddy package](https://packages.debian.org/trixie/caddy) listed `2.6.2-12+deb13u1`, [ffmpeg](https://packages.debian.org/trixie/ffmpeg) `7:7.1.5-0+deb13u1` and [Python](https://packages.debian.org/trixie/python3) `3.13.5-1` on 2026-11-14. Test against Debian Chromium from the signed repositories and record its installed version. Do not run an automatic browser download during a service start. A specific Chromium version is not frozen here because apt security updates must continue.

Do not install Debian `yt-dlp` as a supported worker engine: its [listed version](https://packages.debian.org/trixie/yt-dlp), `2025.04.30-1` on the research date, does not establish compatibility with the worker's `--js-runtimes node` invocation. A verified current yt-dlp distribution and its JavaScript dependencies belong to the missing external-engine requirements. Scientific Python wheels, model weights and their Python 3.13 compatibility were not established. They are not silently installed with unpinned pip. No CUDA, NVIDIA driver, ComfyUI or GPU model package belongs in the server package list.

Before configuring PostgreSQL packages, set `create_main_cluster = false` in Debian's createcluster configuration. Temporarily prevent package-triggered service starts while preserving and restoring any pre-existing `policy-rc.d`. Refuse a machine with an existing unmanaged PostgreSQL cluster; do not delete or adopt it. Disable the unused default cluster unit. The native initializer uses its own data directory, TCP loopback and a private Unix socket directory with 0700 permissions. Keep SCRAM authentication and the existing role/bootstrap SQL. Use Linux `C.UTF-8` for libc locale and retain the design's ICU `en-US` collation choice and UTC. Verify the required extensions from `ops/native/postgres` against the package; never add extension stubs to make initialization appear successful.

The package-start guard also covers Caddy: its default HTTP site must never start during apt installation. Mask new application-facing package units until the private firewall and rendered configuration pass validation, then unmask only the selected Caddy service. Preserve an existing SSH connection and SSH configuration. If no SSH key is provisioned, print the required key-setup step; do not enable password or unrestricted root login. Apt upgrades keep security fixes available; record the new package receipt and perform a coordinated native stack restart in the maintenance window. Do not downgrade a newer authorized Debian 17 minor to match an old receipt.

The initial installation thresholds are **4 vCPU, 8 GiB RAM and an 80 GiB persistent local disk**. These are engineering budgets selected on 2026-11-14. VM tests must validate them before release; they are not measured minima or vendor figures. Reserve 20 GiB free before building and additional space for a database dump, a complete storage copy and two retained releases. The free-space formula is `20 GiB + estimatedBackupBytes + stagedStorageBytes`; fail if the destination cannot satisfy it. Media and models are extra. A preliminary idle/core runtime allowance is 2-3 GiB; media jobs can exceed it.

Build serially: Go, Storage, then Next.js. Limit Go to two build processes, pnpm workspace build concurrency to one, Node build heap to 4 GiB and server media concurrency to one. The Next.js and Go builds are expected peaks. Record peak RSS, elapsed time and disk use in the VM test before changing these budgets. Refuse a smaller machine before modifying production. Do not create swap automatically: swap can conceal an unsupported build, cause long I/O stalls and put sensitive memory on disk. An owner can resize the machine; manually configured swap does not waive the RAM gate. Retain build tools for repeatable upgrades. An optional prune operation may remove only packages the installer added exclusively for build use, after successful publication. Never run broad autoremove or remove shared Python/runtime libraries.

### Storage attributes and portable data

Use upstream `fs-xattr@0.4.0` on Linux and the existing in-repo ADS replacement on Windows. Storage's lockfile pins the upstream package with SHA-512 integrity `Lw90zx483YTGiHfR67IPtrbrZ+yBr1/W98v/iyTeSkUbixg/wrHfX5x9oMUOnirC5P7SZ5HlrpnIRMMqt8Ej0A==` (source inspection, 2026-11-14). After ignore-scripts installation, compile only that approved addon, using headers included in the pinned Node distribution. Check whether its build invokes node-gyp and supply the locked tool from the dependency closure; do not allow an implicit latest download. Keep the shared Storage recipe and its existing patches.

The metadata adapter in `ops/lib/native/storage-metadata.ts` resolves the platform backend used by the built Storage service. It uses the synchronous xattr API already expected by Storage. Do not implement a second Linux xattr binding or path-keyed sidecar database. Sidecars fail when Storage renames, deletes or replaces an object without notifying the wrapper. A new in-repo Linux syscall binding would recreate the native build and ABI maintenance already present upstream.

Accept ext4, XFS or Btrfs only after a real create/set/read/rename/remove probe on the selected data mount. Filesystem names alone do not prove xattr support. Reject unsupported mounts, including unqualified NFS, CIFS and FUSE deployments, before initialization. Report permission errors, exhausted xattr space and unsupported operations as failures, not empty metadata. Do not fall back to sidecars.

The portable bundle records bytes, object hashes, current and historical object metadata and attributes in JSON. Restore validates them and reconstructs platform attributes explicitly. Tar flags or ordinary file copies are not a portability guarantee. Test Windows ADS -> Linux xattr -> Windows ADS, including old versions, missing files, malicious paths, hash mismatches, unknown attributes and interrupted publication. Backup and restore share the existing maintenance transaction and lease.

### Application and worker runtime inventory

This inventory comes from `apps/web`, `apps/auth`, `apps/worker` and `packages/*` at the source baseline, inspected on 2026-11-14. Program names include commands launched by the worker through the remake and visualizer packages. This inventory excludes dependencies used internally by the external engine because its source is absent from this repository.

Web runs Next.js with the pinned Node runtime. It needs its build output, static/public assets, shared packages, database role credentials and Supabase public configuration. It does not need Python or a GPU. Auth runs `apps/auth/src/main.ts` with Node/tsx, `oidc-provider`, its database role, JWKS and cookie keys. Shared TypeScript packages have no service of their own. The CLI remains optional client software. Visualizer adds browser/compositor processes; remake adds the commands below. Build and runtime copies must retain the workspace packages that these applications import.

| Consumer | Production environment contract |
| --- | --- |
| Web | `NODE_ENV=production`, `HOSTNAME=127.0.0.1`, `PORT=3000`, `SITE_URL`, `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_INTERNAL_URL`, `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `MDF_WEB_DATABASE_URL`, `MELLODIFAI_ROOT`; optional `LYRICS_MODEL_FAST` retains the existing model selection. Public variables contain no service key or role password. The installer maps duplicated SDK names from one configuration record. |
| OAuth application | `HOST=127.0.0.1`, `PORT=3010`, `MDF_AUTH_ISSUER`, `MDF_AUTH_DATABASE_URL`, `MDF_AUTH_COOKIE_KEYS`, `MDF_AUTH_JWKS_PATH` pointing into systemd credentials, `MELLODIFAI_ROOT`. |
| Native stack | Existing `ops/lib/native/plan.ts` remains the producer of PostgreSQL login settings, PostgREST database/JWT configuration, GoTrue database/JWT/site/SMTP configuration and Storage database/JWT/file-backend settings. The Linux installer supplies the same typed inputs: logins, signing keys, API keys, SMTP settings, origins, ports and paths. It does not copy that environment map into shell. No production Mailpit variables are generated. |
| Worker and remake | Settings enumerated below, plus `HF_HOME` under the worker cache if an optional model environment is later packaged. `COMPUTERNAME` is not a Linux identity source; a persisted WORKER_ID is mandatory. |
| Test-only inputs | `WORKER_FAKE`, `ALLOW_TEST_KIE`, `TEST_DB_URL`, `TEST_MDF_WEB_URL`, `MAILPIT_URL`, `E2E_*`, `RUNNER_TEMP` and arbitrary provider-base overrides are rejected by production provisioning. CI sets these only in its separate test root. `CI` controls build behavior but cannot grant test privileges. |

`MDF_AUTH_DATABASE_URL` occurrences in web tests do not grant the production web UID the auth role credential. Native settings are derived by the same planner on each OS. Schema tests enumerate planner keys so a new required runtime setting cannot be omitted from the installer unnoticed.

| Program or local engine | Call site and use | CPU VPS decision |
| --- | --- | --- |
| Pinned `node` | `apps/worker/src/engine.ts` runs external `tools/kie.mjs` for credit checks, jobs, generation, polling and lyric timestamps | CPU/network work, but the script is absent. Disabled until a verified engine tree exists. |
| Pinned `node` | External `motion/scripts/r.mjs` for master/hook rendering | CPU possible in principle; external motion tree and its browser/assets are absent. Not installed by this release. |
| `process.execPath` / Node | Worker visualizer invokes `packages/visualizer/scripts/render.mjs`, which invokes Remotion tooling | CPU supported after the Linux rendering test. Use installed Chromium, software rendering and concurrency one. |
| Chromium and Remotion compositor/helper binaries | Remotion render process tree | CPU, no GPU required for the selected profile. Native helper versions and hashes must be covered by the lockfile/build receipt. No browser downloads at runtime. |
| `ffmpeg` | Preview, gain, splice, format conversion, stem MP3 conversion, FLAC conversion, loudness QA, thumbnails/contact sheets, visualizer mux and upscale | CPU supported. Upscale is ffmpeg processing, not an unlisted AI GPU engine. |
| `ffprobe` | Audio/video durations, dimensions and stream metadata | CPU supported. |
| `bash` | External `tools/workspace_pipeline.sh` timing pipeline | Linux command exists, but script/closure absent. Disabled until engine packaging. |
| Python | External `tools/score_takes.py`, `tools/make_srt.py`, `publish/yt.py` for scoring, subtitles and YouTube publishing/privacy | CPU/network possible; scripts and credentials are external. Disabled by default. |
| Python + Pillow | `apps/worker/src/stages/thumbnail.py` | CPU supported using Debian Pillow and explicit Linux font paths. |
| Python + librosa/numpy | `packages/remake/python/music.py`; external `tools/analyze_audio.py` | CPU algorithms. Scientific environment and external script are not packaged. Not enabled by the basic installer. |
| Python + Groq client | External `tools/whisper_words.py` in remake analysis | Cloud transcription, not a local GPU requirement. Requires absent script and an explicit Groq key. |
| `yt-dlp` | Remake ingest: metadata, subtitles, audio/video; passes `--js-runtimes node`; may launch ffmpeg | CPU/network capable. Unsupported until a compatible verified yt-dlp/JS dependency closure is supplied. |
| Demucs `htdemucs` | Worker stems uses fixed Windows `E:/suno-remake-archive/.venv-stems/Scripts/python`; remake accepts `REMAKE_STEMS_PYTHON` and requests CPU with `-d cpu --shifts 0` | CPU is possible but expensive. Model, Python environment and script packaging missing. Do not advertise as installed. |
| `beat_this`, model `final0` | `packages/remake/python/beats.py` | CPU path exists. Model and dependency closure not packaged; optional, off. |
| Local Whisper `base` | Lyric alignment through the Windows karaoke environment; `fp16=False` | CPU possible. Replace hardcoded interpreter/cache defaults with platform paths, but leave engine off until packaged. |
| Sentence Transformers `sentence-transformers/LaBSE` | `packages/remake/python/embed.py`, `REMAKE_LABSE_PYTHON` | CPU possible, optional, not installed without verified model/wheel closure. |
| ComfyUI 0.43.0 embedded Python | `apps/worker/src/comfy/*`, Windows standalone layout and `python.exe` | Windows GPU workstation only in this design. No Linux installer promise. |
| YuE 2 int8 and ACE-Step 1.5 SFT | Local-engine stages through ComfyUI | Keep on the owner's Windows GPU PC. No CPU VPS claim or automatic cloud fallback. |
| `nvidia-smi` | GPU/VRAM availability | Windows local GPU mode only; not required or invoked by server profile. |
| `tasklist.exe`, `taskkill.exe` | Python process identity, ComfyUI shutdown and Windows cancellation | Windows adapter only. Linux uses verified identities and process groups, never these commands. |

No Higgsfield executable was found in the shipped worker: a credential name/filter is not proof of an engine. No unlisted Real-ESRGAN dependency is inferred. Engine capability status must distinguish installed, configured and unavailable. Merely installing Python does not mark a model ready.

The selected server profile sets `REMOTION_BROWSER=/usr/bin/chromium`, software GL (`swiftshader`), render concurrency one and an explicit font directory. Replace Windows Consolas/CJK font defaults with DejaVu/Noto mappings. Avoid `--no-sandbox`; the worker service must permit Chromium's user-namespace sandbox, with Debian's sandbox package available. A browser smoke test must prove the sandbox works under the actual unit. Cache and temporary render paths belong below the runtime root.

Required worker settings are `SUPABASE_URL`, the service-role credential, a persistent `WORKER_ID`, the selected `WORKER_OWNER_ID` and `WORKER_ENV_FILES` using its existing semicolon-separated format. Path inputs include `MELLODIFAI_ROOT`, `MELLODIFAI_ENGINE_ROOT`, `MELLODIFAI_FONTS`, `REMAKE_ENGINE_ROOT`, `REMAKE_PYTHON`, `REMAKE_STEMS_PYTHON`, `REMAKE_LABSE_PYTHON`, `RENDER_TMP` and `REMOTION_BROWSER`. The server generates explicit values instead of inheriting Windows defaults. Keep worker identity stable across upgrades. No owner means healthy but not claiming work; owner provisioning activates it.

Optional paid-service credentials are `KIE_API_KEY`, `OPENROUTER_API_KEY` or `LYRICS_OPENROUTER_KEY`, and `GROQ_API_KEY`. Preserve existing spend gates. `HIGGSFIELD_API_KEY` is recognized by filtering but does not add a shipped engine. Production rejects fake/test flags and arbitrary `KIE_API_BASE`, `GROQ_BASE_URL` or `OPENROUTER_BASE_URL` overrides. Credentials never enter release files or build environments.

Outbound dependencies include Kie (`api.kie.ai`, `kieai.redpandaai.co`), provider/media hosts such as `cdn1.suno.ai`, `cdn2.suno.ai` and `tempfile.aiquickdraw.com`, OpenRouter, Groq, YouTube/Google APIs and their media hosts, configured SMTP (the current configuration supports Resend), plus GitHub, package registries and artifact publishers during installation. Caddy needs DNS and ACME HTTPS. Runtime model downloads are disabled in the basic profile. Do not install a brittle fixed IP egress allowlist for CDN services; retain application URL validation and download limits, and document each configured provider.

Today `claim_job` uses `SKIP LOCKED`; workers and jobs have heartbeats. The `workers.engines` data is status information, not a claim-time capability scheduler. Workspaces and recovery records reference local files. There is no supported transfer of a half-finished workspace to another machine. Two heterogeneous workers on one production queue can claim incompatible work. The server therefore runs a single active worker for an owner. It checks the complete required pipeline before any paid call, reports a precise missing dependency and fails the job without spending when that pipeline is unavailable. Independent supported stages can run only through existing job paths that actually permit them. It must not claim that heartbeat support makes remote GPU routing work. Moving a job between a VPS and the GPU PC, capability-aware claims and workspace transfer require a separate project. Do not add a queue schema or product UI in this work.

### Public origins, routes and private upstreams

With `--domain example.net --email owner@example.net`, validate a DNS hostname without a scheme, path, port, wildcard or shell metacharacters. Verify public DNS points to the VPS and explain ACME failure without exposing HTTP application traffic. Email is the ACME contact, not automatically the first application account. Caddy obtains and renews certificates. It listens publicly on TCP 80 for ACME and HTTPS redirection and TCP 443 for HTTPS. Disable HTTP/3 so UDP 443 is not an undocumented firewall opening. No domain means no public web listener and no certificate request. In both modes, owner access is `ssh -N -L 8080:127.0.0.1:8080 root@VPS`, then `http://127.0.0.1:8080`. The default owner tunnel is restricted to root-owned forwarding sockets. Supporting a different SSH login requires an explicit audited UID addition to the private owner-access configuration; it is not granted to every local account.

| Path, preserving the original path | Target | Public policy |
| --- | --- | --- |
| `/oauth/*`, `/.well-known/oauth-authorization-server/oauth`, `/.well-known/openid-configuration/oauth` | OAuth app, loopback 3010 | Preserve discovery and issuer path. Proxy only through the trusted ingress configuration. |
| `/auth/v1/*` | API gateway, loopback 44321 | GoTrue auth and sign-in confirmation. Keep the gateway's exact method/path public exceptions, not a prefix bypass. |
| `/rest/v1/*` | API gateway | Require the existing API key/JWT checks and database RLS. |
| `/storage/v1/*` | API gateway | Normal API checks; only exact signed-object GET/HEAD paths with valid tokens use the existing public exception. |
| All other paths, including `/_next/*`, `/login`, `/consent`, `/auth/confirm`, `/api/mcp`, `/api/v1/*` and protected-resource discovery | Web, loopback 3000 | Existing authentication, token scopes and remote-studio restrictions apply. |

There is no public PostgreSQL, Mailpit, Studio, Realtime, template server or direct GoTrue/Storage/PostgREST listener. Caddy matcher precedence handles discovery and API paths before the web catch-all. Reject ambiguous encoded separators, duplicate framing and invalid Host values consistently with the gateway's raw HTTP tests. Retain run7 B0's Connection-nominated Content-Length regression test through both Caddy and direct gateway tests.

Use one validated origin configuration. `publicOrigin` is `https://<domain>` or the tunnel origin when no domain exists; `ownerOrigin` is `http://127.0.0.1:8080`. The shared resolver supplies:

- GoTrue `API_EXTERNAL_URL`, `GOTRUE_SITE_URL` and the exact `GOTRUE_URI_ALLOW_LIST` confirmation/redirect URLs. No wildcard hostname or arbitrary caller-supplied redirect.
- Gateway `appOrigins`, approved public Host values and the trusted edge origin. Keep internal service URLs on loopback.
- `MDF_AUTH_ISSUER=<publicOrigin>/oauth`, OAuth resource/audience `<publicOrigin>/api/mcp`, discovery URLs and approved callback origins. The owner tunnel uses the canonical issuer when a domain exists; it does not create a second issuer.
- Next.js public Supabase URL and anonymous key, server Supabase URL, application URL used by sign-in mail, server-action allowed origins and OAuth resource metadata. Search and replace the current hardcoded production origin through this resolver, not scattered string substitutions. Next public configuration is built for the selected origin; changing origin requires a rebuild.
- Cookie Secure behavior from the validated scheme, SameSite=Lax and host-only scope. Set trusted proxy behavior only behind the enforced ingress boundary. Plain HTTP loopback is allowed only for the tunnel profile.
- Signed media URLs returned to browsers use the public gateway origin, even if an SDK talks to the internal gateway. Rewrite only validated same-service URL origins; preserve signed path/query bytes. Test actual signed media retrieval and expiry through HTTPS and the tunnel.

Public ingress removes caller-supplied `x-mdf-remote`, forwarded client/origin headers and any edge authentication header. It sets `x-mdf-remote=1`. The loopback owner listener sets `x-mdf-remote=0`. This preserves the existing studio restriction. The gateway currently validates loopback Host values, so Caddy sends the fixed loopback Host upstream and the validated external origin through trusted configuration. Do not trust arbitrary forwarded Host headers.

With a domain configured, owner studio login still starts in the SSH tunnel. `mdf owner` link generation calls the existing `signInLink` helper with `ownerOrigin`, producing `http://127.0.0.1:8080/auth/confirm?...` in the private output file. Opening it verifies the one-time token through the server's internal Supabase client, sets a host-only session cookie for 127.0.0.1 with Secure=false for this validated HTTP loopback request, then redirects to the studio at that same origin. Public confirmation uses the public HTTPS origin and Secure=true. Select the cookie policy from validated ingress, never raw forwarding headers. Use one explicit Supabase auth storage/cookie key in the browser, server and refresh proxy so different internal/public SDK hosts do not generate different cookie names. The browser can call the public gateway from ownerOrigin through its exact CORS allowance. The public OAuth issuer remains unchanged; its browser session is separate and does not transfer cookies to loopback. Task 10 must test both sessions and the complete owner journey, not just discovery.

Generate a random edge-hop credential shared only by Caddy and ingress validators. Caddy injects it after deleting the inbound header. Web, OAuth and gateway validate it in constant time before accepting forwarded identity. They remove it before further forwarding and never log it. Requests without a valid hop credential have no remote-header privileges and are rejected at public-app ingress; internal gateway calls use their existing application authentication and ignore forwarded identity. Caddy's credential is loaded from a private systemd credential file by its launcher, not written into a public Caddyfile. Use environment substitution in the rendered configuration. Caddy's admin API is disabled, preventing a local user from extracting expanded configuration.

Stock Debian Caddy has no general request-rate-limit module. Preserve the existing edge policy in shared TypeScript middleware used by the web and OAuth ingress, and the gateway for API routes. Keep the source policy's limits and trusted client-IP handling, rather than inventing a Caddy plugin or losing limits. Bounded maps and expiry are required. Caddy disables access logs by default; application logs use redacted structured events. Configure streaming and body limits per existing routes; do not buffer signed media into memory. Verify uploads, streaming downloads and OAuth callbacks through the proxy.

Loopback alone does not resolve run7 S3. A different local UID must not call upstream GoTrue, Storage or PostgREST directly. Install a dedicated nftables table with input and output chains. Input allows established/related traffic, loopback, required ICMP/ICMPv6, and TCP 22; domain mode additionally allows TCP 80/443. Other unsolicited input is dropped. Output permits ordinary egress but restricts loopback destination ports by socket UID before any broad loopback accept. Resolve names to numeric UIDs at render time. Apply the rules atomically and check them before starting services.

| Loopback destination | Allowed initiating UIDs |
| --- | --- |
| PostgreSQL 44322 | root, mdf-stack, mdf-web, mdf-auth; worker uses the gateway, not a direct SQL credential |
| GoTrue 44326, PostgREST 44328, Storage 44329, templates 44325 | root, mdf-stack only |
| Gateway 44321 | root, caddy, mdf-stack, mdf-web, mdf-auth, mdf-worker |
| Web 3000 | root, caddy, mdf-web for its own readiness check |
| OAuth 3010 | root, caddy, mdf-auth for its own readiness check |
| Owner proxy 8080 | root and explicitly configured owner SSH UIDs only, over loopback; other local UIDs denied |

Apply equivalent IPv4 and IPv6 denial, even though service listeners are IPv4-only. Scope the table to MellodifAI; never flush unrelated firewall tables. Refuse an existing non-MellodifAI firewall setup that cannot be proven compatible, and print the conflict. Check SSH remains reachable before closing the installer connection. Root remains trusted and can inspect data or bypass the firewall; this is not isolation from root or from a compromised stack UID. systemd sandboxes reduce service reach, while PostgreSQL roles limit database access. No service starts if the isolation unit fails.

### systemd contract and complete unit templates

The following are complete application unit templates for the default root. The requirements renderer substitutes the configured root, release launcher paths and users. `.runtime/node` is the verified Node distribution inside a release. `.runtime/tsx.mjs` is a generated link to the frozen installed tsx loader, not a moving package. `ops/server-service.ts` loads the service's credential file from `CREDENTIALS_DIRECTORY`, validates it and runs the existing service entry point. Stack mode imports the retained schema release selected by the deploy journal. App modes use the current application release. The launcher performs no restart loop. Web mode starts Next's production CLI as its child, relays shutdown, sanitizes output and exits with it; auth and worker call exported entry functions in-process. Readiness mode is readonly and prints no configuration.

The unit contents follow [systemd.service](https://www.freedesktop.org/software/systemd/man/latest/systemd.service.html) and [systemd.exec](https://www.freedesktop.org/software/systemd/man/latest/systemd.exec.html), consulted 2026-11-14. Directive compatibility and sandbox behavior must be checked against Debian's installed systemd, not assumed from the latest manual.

`mellodifai-stack.service`:

```ini
[Unit]
Description=MellodifAI native stack
Requires=mellodifai-isolation.service
After=network.target mellodifai-isolation.service
Before=mellodifai-auth.service mellodifai-web.service mellodifai-worker.service
StartLimitIntervalSec=300
StartLimitBurst=5

[Service]
Type=exec
User=mdf-stack
Group=mdf-stack
WorkingDirectory=/opt/mellodifai/current
Environment=MELLODIFAI_ROOT=/var/lib/mellodifai
Environment=MELLODIFAI_RUNTIME=native
LoadCredential=environment:/var/lib/mellodifai/secrets/services/stack.env
ExecStart=/opt/mellodifai/current/.runtime/node/bin/node --import /opt/mellodifai/current/.runtime/tsx.mjs /opt/mellodifai/current/ops/server-service.ts stack
ExecStartPost=/opt/mellodifai/current/.runtime/node/bin/node --import /opt/mellodifai/current/.runtime/tsx.mjs /opt/mellodifai/current/ops/server-service.ts ready stack
Restart=on-failure
RestartSec=5
TimeoutStartSec=240
TimeoutStopSec=240
KillSignal=SIGTERM
KillMode=mixed
SendSIGKILL=yes
UMask=0077
StateDirectory=mellodifai/stacks
StateDirectoryMode=0700
ReadWritePaths=/var/lib/mellodifai/stacks /var/lib/mellodifai/cache/stack /var/lib/mellodifai/recovery
ProtectSystem=strict
ProtectHome=yes
PrivateTmp=yes
PrivateDevices=yes
NoNewPrivileges=yes
ProtectKernelTunables=yes
ProtectKernelModules=yes
ProtectControlGroups=yes
ProtectProc=invisible
RestrictSUIDSGID=yes
RestrictAddressFamilies=AF_UNIX AF_INET AF_INET6
CapabilityBoundingSet=
LimitCORE=0
StandardOutput=journal
StandardError=journal
LogNamespace=mellodifai

[Install]
WantedBy=multi-user.target
```

`mellodifai-auth.service`:

```ini
[Unit]
Description=MellodifAI OAuth issuer
Requires=mellodifai-stack.service
After=mellodifai-stack.service
StartLimitIntervalSec=300
StartLimitBurst=5

[Service]
Type=exec
User=mdf-auth
Group=mdf-auth
WorkingDirectory=/opt/mellodifai/current
Environment=MELLODIFAI_ROOT=/var/lib/mellodifai
LoadCredential=environment:/var/lib/mellodifai/secrets/services/auth.env
LoadCredential=oauth-jwks:/var/lib/mellodifai/secrets/auth/jwks.json
ExecStart=/opt/mellodifai/current/.runtime/node/bin/node --import /opt/mellodifai/current/.runtime/tsx.mjs /opt/mellodifai/current/ops/server-service.ts auth
ExecStartPost=/opt/mellodifai/current/.runtime/node/bin/node --import /opt/mellodifai/current/.runtime/tsx.mjs /opt/mellodifai/current/ops/server-service.ts ready auth
Restart=on-failure
RestartSec=5
TimeoutStartSec=120
TimeoutStopSec=60
KillMode=mixed
UMask=0077
StateDirectory=mellodifai/auth
StateDirectoryMode=0700
ReadWritePaths=/var/lib/mellodifai/auth
ProtectSystem=strict
ProtectHome=yes
PrivateTmp=yes
PrivateDevices=yes
NoNewPrivileges=yes
ProtectKernelTunables=yes
ProtectKernelModules=yes
ProtectControlGroups=yes
ProtectProc=invisible
RestrictSUIDSGID=yes
RestrictAddressFamilies=AF_UNIX AF_INET AF_INET6
CapabilityBoundingSet=
LimitCORE=0
StandardOutput=journal
StandardError=journal
LogNamespace=mellodifai

[Install]
WantedBy=multi-user.target
```

`mellodifai-web.service`:

```ini
[Unit]
Description=MellodifAI web application
Requires=mellodifai-stack.service mellodifai-auth.service
After=mellodifai-stack.service mellodifai-auth.service
StartLimitIntervalSec=300
StartLimitBurst=5

[Service]
Type=exec
User=mdf-web
Group=mdf-web
WorkingDirectory=/opt/mellodifai/current
Environment=MELLODIFAI_ROOT=/var/lib/mellodifai
LoadCredential=environment:/var/lib/mellodifai/secrets/services/web.env
ExecStart=/opt/mellodifai/current/.runtime/node/bin/node --import /opt/mellodifai/current/.runtime/tsx.mjs /opt/mellodifai/current/ops/server-service.ts web
ExecStartPost=/opt/mellodifai/current/.runtime/node/bin/node --import /opt/mellodifai/current/.runtime/tsx.mjs /opt/mellodifai/current/ops/server-service.ts ready web
Restart=on-failure
RestartSec=5
TimeoutStartSec=180
TimeoutStopSec=90
KillMode=mixed
UMask=0077
StateDirectory=mellodifai/web
StateDirectoryMode=0700
ReadWritePaths=/var/lib/mellodifai/web /var/lib/mellodifai/cache/web
ProtectSystem=strict
ProtectHome=yes
PrivateTmp=yes
PrivateDevices=yes
NoNewPrivileges=yes
ProtectKernelTunables=yes
ProtectKernelModules=yes
ProtectControlGroups=yes
ProtectProc=invisible
RestrictSUIDSGID=yes
RestrictAddressFamilies=AF_UNIX AF_INET AF_INET6
CapabilityBoundingSet=
LimitCORE=0
StandardOutput=journal
StandardError=journal
LogNamespace=mellodifai

[Install]
WantedBy=multi-user.target
```
`mellodifai-worker.service`:

```ini
[Unit]
Description=MellodifAI CPU worker
Requires=mellodifai-stack.service
After=mellodifai-stack.service
StartLimitIntervalSec=300
StartLimitBurst=5

[Service]
Type=exec
User=mdf-worker
Group=mdf-worker
WorkingDirectory=/opt/mellodifai/current
Environment=MELLODIFAI_ROOT=/var/lib/mellodifai
LoadCredential=environment:/var/lib/mellodifai/secrets/services/worker.env
ExecStart=/opt/mellodifai/current/.runtime/node/bin/node --import /opt/mellodifai/current/.runtime/tsx.mjs /opt/mellodifai/current/ops/server-service.ts worker
ExecStartPost=/opt/mellodifai/current/.runtime/node/bin/node --import /opt/mellodifai/current/.runtime/tsx.mjs /opt/mellodifai/current/ops/server-service.ts ready worker
Restart=on-failure
RestartSec=5
TimeoutStartSec=180
TimeoutStopSec=180
KillMode=mixed
UMask=0077
StateDirectory=mellodifai/worker
StateDirectoryMode=0700
ReadWritePaths=/var/lib/mellodifai/worker /var/lib/mellodifai/workspaces /var/lib/mellodifai/cache/worker
ProtectSystem=strict
ProtectHome=yes
PrivateTmp=yes
PrivateDevices=yes
NoNewPrivileges=yes
ProtectKernelTunables=yes
ProtectKernelModules=yes
ProtectControlGroups=yes
ProtectProc=invisible
RestrictSUIDSGID=yes
RestrictAddressFamilies=AF_UNIX AF_INET AF_INET6 AF_NETLINK
CapabilityBoundingSet=
LimitCORE=0
StandardOutput=journal
StandardError=journal
LogNamespace=mellodifai

[Install]
WantedBy=multi-user.target
```

Do not add `MemoryDenyWriteExecute` to Node/V8 services or a syscall filter copied from a non-JIT daemon. Do not set `RestrictNamespaces` on the worker: Chromium needs its user-namespace sandbox. `PrivateDevices` is suitable for the CPU profile and deliberately excludes GPU device access. `NoNewPrivileges` requires Chromium's namespace sandbox rather than its setuid fallback; fail the browser gate if the VM disables that facility. Temporary data uses paths under `MELLODIFAI_ROOT`; `PrivateTmp` prevents accidental cross-service sharing. Next's writable cache is redirected to `cache/web` at build/install time, never left inside the immutable release. No unit may use a broad writable `/opt` exception.

For a non-default root, omit `StateDirectory` and `StateDirectoryMode` and let the same requirements-driven directory provisioner create the corresponding directories with the same owners/modes. Render `ReadWritePaths` and environment values to that root. This avoids systemd creating a second data tree under `/var/lib`. The default units use StateDirectory for service-owned state, not the shared runtime root, so systemd cannot recursively change another service's ownership.

`mellodifai-isolation.service` uses the system nft binary, with no shell interpolation:

```ini
[Unit]
Description=MellodifAI network isolation
Before=mellodifai-stack.service caddy.service

[Service]
Type=oneshot
ExecStart=/usr/sbin/nft -f /etc/mellodifai/isolation.nft
RemainAfterExit=yes
User=root
Group=root
UMask=0077
ProtectHome=yes
ProtectSystem=strict
NoNewPrivileges=yes
CapabilityBoundingSet=CAP_NET_ADMIN
StandardOutput=journal
StandardError=journal
LogNamespace=mellodifai

[Install]
WantedBy=multi-user.target
```

The rendered nft file replaces only the named MellodifAI table atomically. It persists on service stop and is replaced on upgrades, never temporarily removed. The following complete Caddy drop-in retains Debian's installed base unit and overrides its launch contract. The `caddy` launcher loads its credential, starts Debian Caddy without a restart loop, forwards signals and exits with the child. It filters output before journald. Type=exec deliberately replaces the base unit's notify protocol. Caddy configuration follows the official [reverse_proxy documentation](https://caddyserver.com/docs/caddyfile/directives/reverse_proxy), consulted 2026-11-14.

```ini
# /etc/systemd/system/caddy.service.d/mellodifai.conf
[Unit]
Requires=mellodifai-isolation.service mellodifai-web.service
After=mellodifai-isolation.service mellodifai-web.service

[Service]
Type=exec
Environment=MELLODIFAI_ROOT=/var/lib/mellodifai
Environment=HOME=/var/lib/mellodifai/caddy
Environment=XDG_DATA_HOME=/var/lib/mellodifai/caddy/data
Environment=XDG_CONFIG_HOME=/var/lib/mellodifai/caddy/config
Environment=XDG_CACHE_HOME=/var/lib/mellodifai/caddy/cache
LoadCredential=environment:/var/lib/mellodifai/secrets/services/caddy.env
ExecStart=
ExecStart=/opt/mellodifai/current/.runtime/node/bin/node --import /opt/mellodifai/current/.runtime/tsx.mjs /opt/mellodifai/current/ops/server-service.ts caddy
ExecReload=
KillMode=mixed
Restart=on-failure
UMask=0077
StateDirectory=
CacheDirectory=
LogsDirectory=
ReadWritePaths=
ReadWritePaths=/var/lib/mellodifai/caddy
LimitCORE=0
StandardOutput=journal
StandardError=journal
LogNamespace=mellodifai
```

Create the caddy state directory as caddy:caddy 0700 before startup. Keep the package's capability bounding and ambient bind-service capability for ports 80/443; verify these survive the Node launcher. Admin API is disabled, so apply a changed Caddyfile by controlled restart, not its inherited reload command. Disable access logs and HTTP/3. Test certificate issuance and renewal with this exact sandbox. apt upgrades must rerun unit verification against the installed Caddy base unit, since a drop-in does not freeze that base unit.

`After` includes completion of `ExecStartPost`; downstream applications do not start just because a PID exists. Readiness checks the supervisor state, database, gateway and required upstreams, then OAuth discovery and web health. Worker readiness means heartbeat active and capability status known, including the supported idle state without an owner. It does not require a paid API call. Failed readiness fails the unit. A stack child that exhausts the shared supervisor's restart budget makes the supervisor exit nonzero so systemd can restart the stack. Do not report the stack as ready after a required child exhausts its restart budget.

On `systemctl stop mellodifai-stack`, systemd first stops dependent worker/web/auth units. The worker stops claiming, drains or records interrupted work, and cancels its verified process groups. The supervisor's SIGTERM/SIGINT handler invokes the same ordered shutdown as the native stop command: reject new work, stop gateway/upstreams, then `pg_ctl stop -m fast -w -t 120` against the verified data directory and postmaster identity. Wait for a clean database stop and removal of its live PID state. `KillMode=mixed` sends the first signal only to the main process, allowing this order. Only after the 240-second stop deadline does systemd kill the remaining cgroup. That path is an error requiring crash recovery on boot, not a successful clean stop. Never use SIGKILL as routine PostgreSQL shutdown.

A crashed supervisor may leave children until systemd cleans its cgroup; the next supervisor verifies identities and exclusive ownership before binding ports. Linux process identities use boot ID plus `/proc/<pid>/stat` start ticks, not second-resolution `ps` timestamps. Preserve a separate epoch start time for postmaster validation. Non-systemd test stacks use process groups; Windows retains the console host and Windows process-tree adapter. `status` combines systemd ActiveState/SubState, current and schema release IDs, native child readiness, maintenance state and worker capabilities. It prints no argv, environment, connection URLs or secrets.

The deliberate failure policy is bounded restart of each unit, not an availability guarantee. If a failed stack causes dependent units to stop, stack restart alone does not imply that systemd restarts those dependents. `mdf start` invokes the existing ordered start-all operation and restores them after recovery. Status reports this partial state, and the runbook names that command. Do not add a hidden second monitor to restart dependents during maintenance. Normal boot and explicit restart use the same ordered controller; shutdown ordering follows the units above.

### Logs, secrets and first use

All services emit sanitized events before journald receives them. Do not send raw child stdout/stderr, SQL error text, email links, Authorization headers or signed URL query strings to the journal. The supervisor's shared log adapter allows fixed event names, service IDs, exit codes and validated error categories; unknown upstream output becomes a bounded generic diagnostic event. Application logging uses the same redaction rules. Disable PostgreSQL statement/parameter logging, including `log_min_error_statement=panic` and `log_parameter_max_length_on_error=0`, then test that remaining messages cannot bypass the adapter. Scrubbing only a log reader repeats run7 S1.

Use the `mellodifai` journal namespace. `/etc/systemd/journald@mellodifai.conf` sets `Storage=persistent`, `SystemMaxUse=256M`, `SystemKeepFree=1G`, `MaxRetentionSec=14day` and `Compress=yes`. These are chosen retention budgets dated 2026-11-14, not measured needs. A drop-in for `systemd-journald@mellodifai.service` clears its `LogsDirectory`, binds the root-owned `MELLODIFAI_ROOT/logs/journal` onto `/var/log/journal` in that unit's mount namespace and permits that path to be written. Create it before the journal unit starts. Verify journal files physically reside under the runtime root, including with a custom root. `mdf logs` resolves `/etc/machine-id` and invokes `journalctl --directory=<root>/logs/journal/<machine-id>.mellodifai`; `mdf logs --disk-usage` uses the same directory. Do not rely on host `journalctl --namespace` to discover a bind mount private to journald. Limit installer logs to five files of 20 MiB, owned root 0600. Rotation reserves disk headroom and never records raw package or build output without filtering.

```ini
# /etc/systemd/journald@mellodifai.conf
[Journal]
Storage=persistent
SystemMaxUse=256M
SystemKeepFree=1G
MaxRetentionSec=14day
Compress=yes
```

```ini
# /etc/systemd/system/systemd-journald@mellodifai.service.d/storage.conf
[Service]
LogsDirectory=
BindPaths=/var/lib/mellodifai/logs/journal:/var/log/journal
ReadWritePaths=/var/lib/mellodifai/logs/journal /var/log/journal
```

The package unit still owns its runtime journal sockets under `/run`; these are volatile OS endpoints, not persistent application logs. The installer restarts the namespace journal before enabling application units, flushes it, and confirms persistent storage with `mdf logs --disk-usage`. Tests write a known non-secret event, rotate the journal, reboot and retrieve it through `mdf logs`, for default and custom roots. Secret-canary tests scan that persistent directory, the transient namespace journal via `journalctl --namespace=mellodifai`, and the default journal. This reader choice follows [systemd's private BindPaths semantics](https://www.freedesktop.org/software/systemd/man/latest/systemd.exec.html#BindPaths=) and [journalctl's explicit directory selection](https://www.freedesktop.org/software/systemd/man/latest/journalctl.html), reviewed 2026-11-14; the VM tests must verify the installed version's layout.

| Secret or identity | Source of truth and access | Migration requirement |
| --- | --- | --- |
| Supabase asymmetric signing keys | `secrets/supabase/signing_keys.json`, mdf-stack 0600 | Copy exactly; retain key IDs and rotation history. |
| API keys, database bootstrap identity, legacy HMAC | `secrets/supabase/stack-secrets.json`, `jwt-secret`, mdf-stack 0600 | Preserve anon/service keys and HMAC used by existing tokens/signed storage links. |
| Database application passwords and native role logins | `secrets/supabase/db-passwords.json`, `native-logins.json`, mdf-stack 0600 | Restore exact values and reconcile roles through existing code. Do not regenerate on missing files. |
| OAuth signing keys | `secrets/auth/jwks.json`, mdf-auth 0600 | Preserve private JWKS, kids and public discovery continuity. |
| OAuth cookie keys and issuer | Existing Windows auth environment, including `MDF_AUTH_COOKIE_KEYS` and issuer | Import into root-only `secrets/services/auth.env`; preserve order of active/old cookie keys. |
| Per-service settings | `secrets/services/{stack,web,auth,worker,caddy}.env`, root 0600, parent 0700 | Extract relevant settings from Windows private deployment env files into these files. Never copy them into releases. |
| SMTP password and optional worker provider keys | Existing private SMTP/worker environment sources | Import only to consumers. A missing optional provider disables that capability. Never synthesize credentials. |

Directory traversal is deliberate: `secrets` is root-owned 0711, service-owned subdirectories are 0700, and `services` is root-owned 0700. systemd `LoadCredential` gives each unit only its own private copy. OAuth loads JWKS from its credential path. The stack launcher receives only stack credentials. Supabase service-role credentials go to the worker and only existing web server code that requires them; browser bundles get the anonymous key only. Caddy's credential does not grant database access. Environment values needed by a process remain visible to that UID and root; separate UIDs and `ProtectProc` reduce exposure but do not make a compromised service unable to read its own credentials.

For a genuinely empty root, a root-only `provision-production-identity` operation generates the existing required keys through the shared provisioning functions before `stack ... --init-production`. It refuses partially populated identity directories and uses exclusive creation plus atomic private writes. Ordinary start/restore still refuses missing production identity. An alternative that made startup regenerate absent files would destroy token continuity and mask data loss. An interrupted first provision resumes only from its private receipt; it must not mix old and new keys.

For a Windows move, export an explicit private identity capsule alongside the portable data bundle through the existing backup/maintenance machinery. It includes the files above, normalized service configuration, stack UUID and fingerprints binding it to the data bundle. Transport both over SSH/SCP or another owner-controlled encrypted channel; receive into a root-owned 0700 directory and verify mode before opening. On Windows use existing private-file ACL helpers. No secret enters a readable temporary directory, shell argument or report. Refuse missing/mismatched capsule data rather than generating replacements. Portable hashes establish consistency, not the sender's identity; the owner verifies the bundle digest through a separate trusted channel.

Opaque PAT/OAuth token hashes, grants, consent and user/session records remain in the restored database. No new token pepper is invented. Keeping keys, database and the original hostname preserves the existing verification inputs; acceptance tests must prove an old refresh token, OAuth token, cookie and signed storage URL still work within their original lifetime. Same-origin migration requires DNS cutover to the VPS and a valid certificate. An intentional hostname change is a separate reauthentication event.

After initialization, print service status, the HTTPS/tunnel address, limited worker capabilities and the next owner command. `mdf owner create --email <address>` reuses `ops/lib/user-admin.ts`. Sign-in link creation writes to a specified root-only output file and prints its path, never the link in installer logs. The owner reads it through their SSH session or configures SMTP first. `mdf configure-mail` writes the existing SMTP settings privately and restarts only affected services through the shared service controller. A missing SMTP setup does not launch public Mailpit or claim that mail was delivered. The ACME email does not silently create an application account.

### Bootstrap, installation and trust

`install.sh` is Bash with `set -euo pipefail`, a restrictive umask, explicit cleanup traps and no xtrace. It refuses non-root execution, anything except `/etc/os-release` ID `debian` and VERSION_ID `13`, and unsupported architectures. It validates all flags before a mutation. The selected flags are `--ref <tag-or-commit>`, `--source <path-or-https-url>`, `--source-sha256 <hex>`, `--offline`, `--restore <bundle>`, `--identity <capsule>`, `--root <path>`, `--domain <name>` and `--email <address>`. Restore requires identity; domain requires email. Unknown flags fail. `--ref` defaults to the latest non-prerelease GitHub release tag; only a confirmed absence of releases falls back to `main`. Authentication, rate-limit and network failures must not masquerade as no releases.

Use a root shell with a read-only fine-grained GitHub token that grants contents access to `stefandsl/mellodifai-app`. Set it with a hidden prompt and export it; never paste it into the command text. With `GITHUB_TOKEN` already in the environment, the exact private-repository one-line command is:

```bash
set -o pipefail; curl --fail --silent --show-error --location --proto '=https' --proto-redir '=https' --config <(printf 'header = "Authorization: Bearer %s"\n' "$GITHUB_TOKEN") -H 'Accept: application/vnd.github.raw+json' 'https://api.github.com/repos/stefandsl/mellodifai-app/contents/install.sh?ref=main' | bash -s -- --domain example.net --email owner@example.net
```

The exact public-repository form, when the repository is public, is:

```bash
set -o pipefail; curl --fail --silent --show-error --location --proto '=https' --proto-redir '=https' 'https://raw.githubusercontent.com/stefandsl/mellodifai-app/main/install.sh' | bash -s -- --domain example.net --email owner@example.net
```

Remove both domain flags for tunnel-only mode. These are proposed commands for the installer once released, not working installation claims in D1. They fetch the bootstrap from `main`; the payload defaults to the latest release. For a reviewed bootstrap, replace the URL's `main` with its immutable commit. The token is expanded by Bash's builtin printf into an anonymous pipe, not a curl argument or a regular file. Validate its syntax before using curl config; reject CR/LF or quote characters. Do not enable shell tracing. No token is forwarded to a different host or mirrored source. Bootstrap unsets it before running build tools or service processes.

Offer the two-step form prominently in installation documentation: download the same bootstrap to a root-only directory with `curl ... -o /root/mellodifai-install.sh`, inspect it with `less`, then run `bash /root/mellodifai-install.sh --ref <reviewed-tag> ...`. Pinning the bootstrap commit and independently checking its digest is stronger than inspecting a moving branch. `curl | bash` executes bytes before the complete response has arrived; TLS and a final curl error cannot undo commands already executed. No checksum stored inside that fetched script removes this risk.

The bootstrap trusts Debian's installed archive keys, HTTPS to GitHub and artifact publishers, the selected repository ref and its manifest. Resolve tags, including annotated tags, to an immutable commit through GitHub metadata before downloading the repository archive. Record requested ref, resolved commit, archive hash and bootstrap hash in a root-only receipt. Download once into a private temporary directory, hash before extraction and validate the archive layout. A hash computed from the download is a receipt, not independent authentication. If GitHub does not provide an independently authenticated archive digest, the commit resolution and TLS are the trust basis; do not claim a publisher signature. A compromised authorized ref can change the manifest and installer together. Reviewed immutable tags/commits and release attestations can reduce that risk; this design does not invent an existing signing infrastructure.

`--source` accepts a local tarball or HTTPS mirror without a GitHub token. Require `--source-sha256` for both, supplied through a trusted channel. Do not infer authenticity from a checksum downloaded beside an untrusted mirror. The tarball contains a generated source receipt with commit ID and normalized tree metadata; validate it against the requested ref when an authenticated GitHub lookup is available. Offline mode explicitly trusts the owner-supplied digest and source receipt, not an unavailable lookup. Refuse unexpected embedded symlinks or secrets. A source-only tarball is not a full offline installation: apt packages, Node/Go/PostgREST artifacts, pnpm/npm/Go dependencies and browser helper assets also need a verified local cache. Offline mode fails listing missing artifacts before stopping services; it never quietly goes online.

The installer never accepts an HTTP source URL. For the QEMU test, the harness downloads the host-served tarball from `10.0.2.2` into a guest root-only staging directory, verifies the expected digest delivered through SSH, then invokes `--source <local-file> --source-sha256 <digest>`. This exercises real production initialization without an insecure-source exception in the installer. The host server is loopback-only, and the independently supplied digest protects the source bytes. There is no special flag that relaxes production provenance.

Source selection does not select offline operation. Without `--offline`, `bash install.sh --source /private/source.tar.gz --source-sha256 <digest>` may fetch dependencies through the declared verified channels. Adding `--offline` forbids all installer network access, requires a local source and the complete verified package/artifact/dependency cache, and skips GitHub ref lookup. The source receipt supplies the immutable commit; an explicit ref must match its recorded ref or commit. Offline mode requires tunnel-only configuration, with no DNS lookup or ACME request. Preflight lists missing cache entries before package or service mutation. Tests deny outbound network and prove no fallback occurs. This is an installation policy, not a promise that optional provider features work without network access.

Before package mutation, the bootstrap acquires a machine-wide flock at `/run/lock/mellodifai-install.lock`, independent of the chosen runtime root. This is a volatile OS coordination endpoint. The Debian base must already provide Bash, coreutils and util-linux's flock; missing lock tooling fails preflight without an unlocked apt fallback. On a fresh host only, it installs the bootstrap package group under this lock with package starts suppressed. On an existing installation it only checks prerequisites, never invokes apt before the coordinator, and directs missing/changed packages through the installed release's maintenance entry point. A damaged installation that cannot run that entry point fails with a package-repair instruction; it does not mutate packages while services run. The lock stays held across the versioned handoff, which inherits its descriptor and never reacquires it.

The bootstrap stages the fetched ref and executes `ops/native/install-debian.sh` from those verified bytes. That versioned handoff reads `debian-requirements.json`, installs the pinned Node artifact, then calls `ops/install-debian.ts`. This Node coordinator owns all subsequent logic. Bootstrap has no duplicated service definitions, application versions or migration rules. Its tiny pre-Node package list is a generated, checksum-marked slice of the requirements file and a test compares it byte-for-byte.

The coordinator validates capacity, apt origins, filesystem attributes, root layout and existing installation receipts. On a fresh machine it creates users/directories and installs package groups with unattended prompts disabled. It provisions identity only on an empty root, or validates and imports the private identity capsule for a restore, before the web build needs the anonymous key. It passes mdf-build only the public build configuration projection, never private identity files or service credentials. It stages/builds unprivileged, verifies executable receipts, then invokes explicit production initialization or restore. It renders units/firewall/Caddy, verifies them, starts isolation, stack, auth, web, worker and Caddy, and waits for health. A repeat with the same commit and build inputs repairs only generated integration drift and missing verified cache entries. Changed public configuration produces a new build generation through the shared publisher, even at the same commit. No repeat reinitializes populated data, reseeds production, changes worker identity or replaces keys.

If installation is interrupted, the root-only journal records the last durable phase and artifact hashes. The next invocation resumes or cleans only that incomplete staging directory after verifying it belongs to this installer. Never delete an unrecognized runtime tree. A source, hash or build failure before machine-package maintenance leaves the old running release untouched. No `latest` tool installation or network dependency resolution is allowed during service startup.

Repeat installation separates application preparation from machine maintenance. Resolve and download required apt changes first, recording installed and candidate versions without installing them. Prepare the candidate against already installed packages where compatible. If preparation requires changed shared packages, enter the existing maintenance controller first: stop writers/services, take the verified backup, suppress package-triggered starts, then apply apt changes and build. Record actual dpkg progress even on failure. PostgreSQL, Caddy and shared libraries are machine state, outside the atomic release switch. After package mutation, a failed build leaves the old application selected but stopped until package configuration is repaired and that application passes readiness against the updated packages. Never automatically downgrade apt packages or claim that application rollback restores them. Security-only package updates use this same maintenance path and coordinated restart; unattended restarts outside it are unsupported.

### Upgrade, rollback, backup and recovery

`install.sh --ref <tag>` prepares a new immutable release while the old release runs when preparation needs no shared-package changes. Otherwise it stops services and follows the package-maintenance procedure above. The existing deploy state machine remains the single owner of backup, maintenance, migrations, health checks, publication and recovery. Add a platform service controller and release-location adapter to it, not a Linux deploy implementation. The installer has a machine-level lock; shared operations acquire the same stack lease as backups, restore, import and key rotation. Reentrant calls stay in-process through the shared command adapter. An environment flag cannot grant lease ownership.

The shared durable phases are prepare, acquire lease, stop writers, backup, migrate, publish, health, commit. Persist phase changes before irreversible steps. Stop worker/web/auth and block gateway writes before database or storage snapshots. Record backup completion and exact hashes before migration. Keep the old app release and forward schema source. Publish `current` by an atomic same-filesystem rename of a temporary symlink. Do not overwrite files in the running release. Before migration, a failure leaves the old release usable only if shared packages remain unchanged. After package changes, keep services stopped until package repair and readiness checks succeed. A failure after migration does not authorize a downgrade or automatic destructive restore. Recovery checks the journal and chooses the already specified compatible app rollback, or leaves services stopped with a named recovery action.

Run7 S9 is a cold-boot requirement. Application rollback must not point the migration loader at an older tree that lacks applied migrations. Persist `applicationRelease`, `schemaRelease`, native artifact receipts, applied migration names/hashes and the journal phase in `MELLODIFAI_ROOT/deploy/state.json`. After an app rollback, load the forward schema tree and forward Auth/Storage versions on every boot. Retain those release directories while referenced. An explicit release compatibility declaration must name the forward schema digest accepted by the older app. Missing declarations, altered migration bytes or missing forward sources fail closed. Do not ignore unknown applied migrations, run down migrations, roll back apt PostgreSQL or silently assume schema compatibility. If no compatible app rollback exists, restore the pre-upgrade backup only through an explicit owner recovery command, with lost writes clearly stated.

The declaration is a reviewed `ops/release-compatibility.json` in the retained forward-schema source release, covered by its verified source receipt. Schema is `{version: 1, entries: [{id, targetCommit, acceptedSchemaDigest}]}`; id is a unique lowercase identifier, targetCommit a full commit SHA and acceptedSchemaDigest the normalized complete migration-ledger SHA-256. Unknown fields, duplicate IDs or altered source bytes fail. Root selects an entry by ID and checks target commit, current ledger digest, retained schema/artifact receipts and current public-build fingerprint. The existing rollback marker records execution of that authorization; it does not replace the declaration. An empty entries list allows no rollback. The operator uses `mdf rollback --to <build-id> --compatibility <entry-id>`, never a caller-supplied digest as authorization. A missing, stale or mismatched entry leaves writers stopped after a schema-changing failure.

Extend the existing bundle to format 3; current format 2 already carries environment, installation UUID, fake-stack status and ledger fingerprint. Format 3 adds source commit, PostgreSQL major, migration digests, object hashes, identity fingerprints and optional legacy-attestation metadata. Cross-check them against dump facts, the verified source receipt and the private identity capsule. New backups require a known source commit from that receipt. A manifest flag alone is forgeable and insufficient; reject fake/e2e data as production even if its outer metadata is edited.

Continue reading unchanged formats 1 and 2 for inspection and their existing non-production uses. Production import requires VerifiedBundle format 3. `mdf backup attest --bundle <legacy> --identity <capsule> --trust <private-json> --output <new-directory> --confirm-production` reads LegacyTrustReceipt `{ bundleSha256, identitySha256 }` from the owner-private --trust file, validates those independently verified digests, dump flags/ledger, PG major and identity before writing a separate format-3 bundle; it never rewrites the original. It cannot convert fake/e2e data. Unrecoverable source commit or format-1 source UUID is represented as null under an explicit owner-attestation record, never fabricated. The record contains the original format/digest, independently supplied identity digest, checked facts and the root operator's confirmation. Its trust is the owner's verified input, not a publisher signature. Missing identity or ambiguous database provenance is refused. Shared import and restore consume this one verifier.

`ops/lib/native/identity.ts` retains its current distinction: sourceStackId identifies the exporting installation and binds its capsule; destinationStackId identifies the target runtime root. Restore never replaces an existing destination UUID. A fresh target creates its own UUID once and records the source UUID as import provenance. Signing identity transfers independently, so token continuity does not require copying installation UUIDs. Subsequent backups identify the destination as their source and retain the import receipt for history. Interrupted identity import is journaled and cannot regenerate keys. Archive extraction and publication remain behind the shared lease/journal; failure never exposes database and storage from different snapshots.

Backups live at `MELLODIFAI_ROOT/backups/prod`, root/stack private, with a daily timer at 03:15 local server time and randomized delay up to 15 minutes. Retain seven daily and four weekly successful bundles. These are design defaults chosen on 2026-11-14. Never delete the last verified bundle or one referenced by a live recovery journal. Retention runs only after a new verified backup and free-space checks. Identity capsules share the private retention policy. Off-site copies, transport and retention are the owner's choice; local backups do not survive VPS/disk loss. No automatic upload or paid storage is configured.

`mellodifai-backup.service` and `.timer`:

```ini
# mellodifai-backup.service
[Unit]
Description=MellodifAI native backup
After=mellodifai-stack.service

[Service]
Type=oneshot
User=root
Group=root
Environment=MELLODIFAI_ROOT=/var/lib/mellodifai
ExecStart=/opt/mellodifai/current/.runtime/node/bin/node --import /opt/mellodifai/current/.runtime/tsx.mjs /opt/mellodifai/current/ops/server-maintenance.ts backup
TimeoutStartSec=infinity
UMask=0077
ProtectHome=yes
PrivateTmp=yes
NoNewPrivileges=yes
LimitCORE=0
StandardOutput=journal
StandardError=journal
LogNamespace=mellodifai
```

```ini
# mellodifai-backup.timer
[Unit]
Description=Daily MellodifAI backup

[Timer]
OnCalendar=*-*-* 03:15:00
RandomizedDelaySec=15min
Persistent=yes
Unit=mellodifai-backup.service

[Install]
WantedBy=timers.target
```

The root maintenance adapter controls units, private identity packaging, credential-store access and release publication. It delegates database/storage work to the existing operations code under `mdf-stack`, using private pipes and shared lease ownership. It remembers which units were running and restores that state after a successful backup. It does not start a stopped installation just because a persistent timer fired. A watchdog reports a stuck backup; it must not kill PostgreSQL to meet a timer deadline. Restore, import and rotation remain explicit commands, with the same maintenance gates on Windows and Linux.

The delegated `mdf-stack` process is the sole owner of the stack lease and runs nested native operations in-process. The root coordinator does not acquire that lease and then launch a child that attempts to acquire it again. A private inherited pipe allows named service-control requests, publication of a prevalidated release, and the credential-store operations below. Root binds each request to the owner-selected command, operation ID and journal phase. No arbitrary shell command, path or environment is accepted. Installer flock remains a separate root coordination lock. Loss of either side closes the pipe, stops mutation and leaves the durable journal for recovery. This is a privilege adapter around the shared deploy/maintenance state machine, not a second transaction engine.

The shared rotation algorithms consume an injected `CredentialStore` instead of opening cross-UID files directly. Root resolves fixed credential IDs to the secret table's paths and owners; callers cannot supply paths. DB rotation may read/update DB passwords, native logins and the database fields of stack/web/auth service settings. Supabase rotation may read/update its signing/API/HMAC stores and affected stack/web/worker settings. OAuth rotation may read/update only OAuth JWKS and auth cookie/signing settings. Read access lasts only for the selected operation; Caddy and unrelated provider credentials are excluded. Secret bytes travel only through the inherited private pipe, never argv or logs.

While the shared lease is held and writers are stopped, the adapter stages the complete credential generation in a root-only directory with the required final owners/modes and fsyncs it. The existing rotation journal records the generation ID, old/new fingerprints and durable phase before applying database changes or replacing source files. Publish files by atomic private rename; multiple renames are not claimed to be atomic together. A pending generation blocks ordinary startup. Recovery follows the shared rotation algorithm to finish the new generation or restore the old database/file generation, and verifies all fingerprints before clearing the marker. Restart every affected unit after complete publication so `LoadCredential` takes fresh copies, then verify new credentials and the intended old-key acceptance/rejection policy. A crash between any two renames leaves services stopped for recovery. Tests cover DB, Supabase and OAuth rotation under actual Linux UIDs, interrupted publication and credential reload.

Supabase key rotation and public-origin changes also prepare a new immutable browser build using the staged public configuration. Build failure leaves the previous credential/build generation selected. Before activating changed credentials, record both old/new build IDs and public configuration fingerprints in the same operation journal. Publish credentials and the release pointer while writers stay stopped; interrupted publication cannot start a mismatched pair. Recovery verifies or restores the complete pair before readiness. Boot and application rollback compare the selected build's public fingerprint with active configuration as well as checking schema compatibility. An older source can be rebuilt against current public configuration into a new generation; its old embedded key is never silently accepted as a rollback target. Reuse shared release preparation and existing rotation rebuild behavior.

The lease-owning transaction requests `prepare-release` from root with operationId, a prevalidated source-receipt ID and publicBuildConfig. Root accepts it only in the journal's prepare phase, runs the shared prepareRelease function as mdf-build with a public-only environment and a private build staging directory, verifies the returned tree/receipt after that process exits, then returns PreparedRelease. No caller-selected executable, UID or arbitrary path is accepted. Package maintenance similarly requests `apply-packages` with a prevalidated plan ID only after stop-writers and verified-backup phases; root restricts package names/origins to requirements and records actual dpkg progress. The mdf-stack process retains the same lease while awaiting either response. Pipe loss aborts preparation, prevents publication/startup and leaves the journal pending; interrupted apt requires explicit package repair, never assumed rollback. Test coordinator death and build failure before/after credential staging. These are privileged adapters to the shared transaction, not independent deploy state machines.

### Platform differences and Windows protection

Paths below are repository-relative. Each listed test is a required implementation test, not a test run during D1. The design avoids scattered `process.platform` branches by keeping platform selection at these boundaries.

| File or module | Linux change; Windows behavior retained | Proof on each platform |
| --- | --- | --- |
| `ops/lib/native/manifest.json`, `ops/lib/native/artifacts.ts` | Extend the existing reader with package providers, tagged digests and explicit formats; retain Windows ZIP pins and receipts | Both: corrupt hash, unsafe archive and cached-receipt tests. Windows: existing extraction gates. Linux: real downloads and package receipt. |
| `ops/lib/native/build.ts`, `ops/native/auth/listener-portable.patch` | Linux Go executable/output and explicit xattr build; same Auth patch with Unix listener helper | Both: patch applies and Auth starts. Windows: no Unix socket option. Linux: socket helper and addon ABI tests. |
| `ops/native/storage/fs-xattr/**`, `ops/lib/native/storage-metadata.ts` | Select upstream addon on Linux, ADS replacement only on Windows | Real storage upload/version/delete and cross-platform bundle metadata round trip. |
| `ops/lib/native/host.ts`, new `platform/{windows,linux}.ts` | `/proc` boot/start identity, process groups, no `.exe`; retain CIM/taskkill/console behavior | Both: PID reuse and unrelated-process survival. Linux: child tree cancellation. Windows: console regression. |
| `ops/lib/native/processes.ts`, `supervisor.ts`, `stack.ts`, `postgres.ts`, `postgres-host.ts` | Foreground lifecycle and signal drain; Linux direct postgres, Windows console host unchanged | Both: ordered stop and forced-failure recovery. Linux: systemctl stop/reboot proves clean PG stop. |
| `ops/lib/native/lease.ts`, `ops/native/lease.ps1`, new `ops/native/lease-linux.sh` | Preserve `withStackLease` and ownership context; Linux uses OS flock held by a helper for operation lifetime | Both: contested lock, owner death, stale metadata, prepare/import races. Linux: helper death terminates mutator. |
| `ops/lib/private-file.ts` | POSIX exclusive create, no-follow validation, owner/mode checks, atomic rename/fsync; retain Windows ACLs | Both: symlink replacement and private receipt tests. Linux: other UID denied. Windows: inherited ACL denial. |
| `ops/lib/runtime.ts`, `envs.ts`, `native/layout.ts`, `native/plan.ts` | Linux default root, case-sensitive paths, executable names and locales; same layout/port table | Both: custom root, checkout/ancestor escapes and invalid roots. Windows: C-drive gate still fails. |
| `ops/lib/native/postgres.ts`, `ops/native/postgres/**` | Debian bin directory, no default cluster, private sockets and Linux locale; same vetted init SQL | Both: role grants and migration ledger DB tests. Linux: no listening distro cluster. |
| `ops/lib/native/gateway.ts`, `ops/edge-proxy.ts`, new `ops/lib/edge-policy.ts` | Trusted public origin/hop validation; shared request and rate policy, no bypass by direct upstreams | Both: framing/CORS/auth tests. Linux: UID firewall attack tests. Windows: original edge behavior retained. |
| `ops/services.ts`, `ops/lib/services.ts`, new `ops/lib/service-control.ts` and `platform/services-{windows,linux}.ts` | Linux systemd adapter; retain Windows logon/service host, no extra child restart loop | Both: same controller contract and status redaction. Windows: existing service plan snapshots. Linux: real units. |
| `ops/logon.ps1`, `ops/service-host.ps1` | Remain Windows entry points; only consume shared controller changes if required | Windows-only logon/console and stop gates; no Linux execution. |
| `ops/deploy.ts`, `ops/lib/recovery.ts`, `ops/lib/native/maintenance.ts`, backup/import/rotation commands | Shared durable journal, lease and schema-release rollback; platform publication/service adapters only | Both: fault injection at each phase and cold restart after app rollback. |
| `ops/lib/auth-origins.ts`; `apps/web/next.config.ts`, `apps/web/proxy.ts`, `apps/web/lib/remote.ts`, `apps/auth/src/main.ts` | Extend the existing filesystem-free origin resolver; validated ingress and cookies retain remote restrictions | Both: spoofed header, origin and cookie tests. Linux: HTTPS and tunnel smoke. |
| `apps/worker/src/engine.ts`, `comfy/{config,runtime,supervisor,availability}.ts`, worker stage adapters | Platform paths, CPU profile, dependency preflight and signals; keep Windows GPU profile | Both: unsupported pipeline fails before spend. Windows: ComfyUI plan tests without loading models. Linux: CPU media/browser tests. |
| `packages/remake/src/{paths,env,run,align,ingest}.ts`, `packages/visualizer/scripts/render.mjs`, `apps/worker/src/stages/thumbnail.py` | Explicit Python/browser/font/cache locations and CPU concurrency; preserve Windows overrides | Both: command-argument fixtures. Linux: ffmpeg/Pillow/Chromium smoke. Windows: same command gates. |

Linux flock is a lifetime lock, not a PID-file existence check. Hold an open file descriptor in a helper and release it only on the parent pipe closing or an explicit release. The mutator fails if the helper dies. Never unlink a live lock file: that would create two lock inodes. Holder JSON is diagnostic only. The same migration ledger, maintenance journal, backup format and rotation policy are used on both systems. Existing data-safety fixes must land before adapting their exported interfaces; D1 does not replace them.

### Alternatives and failure boundaries

| Chosen mechanism | Alternative rejected | Reason and remaining limit |
| --- | --- | --- |
| Shared native runtime | Docker or a separate Linux stack implementation | Violates the coordinator's target and duplicates migrations, backup and security behavior. Native packaging still needs real Linux tests. |
| Debian PostgreSQL 17 | PGDG or frozen Windows minor | Debian already supplies major 17 with security maintenance. Mixing repositories adds trust and update policy without a need. Minor mismatch is recorded and cross-platform logical restore is tested. |
| Pinned Node/Go | Debian Node or system Go | Node is below the declared engine floor; toolchain drift undermines identical recipes. Pin updates still need security review. |
| Upstream Linux xattr addon | A second in-repo native binding or metadata sidecars | Duplicate ABI maintenance or incorrect rename/delete semantics. Supported mounts are deliberately limited. |
| systemd plus foreground shared supervisor | One systemd unit per stack child or detached Node supervisor | Competing restart/order policy. The chosen stack unit must report child exhaustion as failure. |
| Root-only explicit provisioning | Generate keys whenever production startup sees missing files | Would hide identity loss and invalidate tokens. Partial provisioning requires recovery. |
| Private upstream UID rules | Loopback-only binding | Any local user could otherwise bypass gateway checks. UID rules do not protect against root or compromised authorized consumers. |
| Preserve remote-studio policy | Treat VPS HTTPS as authorization to expose the complete studio | Changes the product's current security boundary. The owner uses SSH for restricted actions. |
| Limited CPU worker with preflight | Enable pipelines without checking dependencies, fall back automatically to paid services, or dispatch work to another PC | Misleading capability, unexpected cost or a new distributed system. Full rendering requires separately packaged engine source, dependencies, scripts and assets, with verified versions and integrity checks. |
| Staged releases and forward schema record | In-place Git checkout or application rollback that loads an old migration tree | Mutable running files and run7 S9 failure after reboot. Schema rollback requires explicit restore. |
| No automatic swap | Create swap automatically when the machine fails the RAM requirement | Unbounded latency, disk pressure and memory disclosure risk. Minimum size remains unmeasured until release tests. |
| QEMU cloud image | Docker, WSL or an administrator-installed hypervisor on the owner's PC | Unavailable or unauthorized in this environment. TCG is slower and must have an explicit time budget. |

The release requires regression evidence for these run7 findings:

- B0: reject request framing that permits upstream request smuggling.
- B1: block startup until interrupted maintenance is recovered.
- B2/S5: retain exclusive stack ownership throughout each operation.
- S1/S2: prevent secret logging and bound log storage.
- S3: prevent unauthorized direct access to upstream services.
- S4: enforce the final lockdown migration's ordering.
- S7: fail enabled integration tests when prerequisites are missing.
- S8: reject test or unidentified backups as production data.
- S9: validate the retained schema after application rollback and reboot.
- S10: keep writers stopped during seed preparation and import.
- L2: stop PostgreSQL cleanly during shutdown.

Record the resolution or explicit coordinator decision for S6's missed polling events and L1's feed-query cost in the release report. Both concern shared code. Resolve L3's pg-boss dependency-integrity gap before the installation gate can pass.

Primary risks are incomplete external-engine packaging, unmeasured build peaks, Chromium behavior under systemd, upstream source archive changes, leaked child logs, local UID bypass and interrupted schema/data publication. The preceding fail-closed gates address these mechanisms. No VM, systemd service, certificate issuance or cross-platform restore was run for this design. Those are validation obligations, not evidence already obtained.

### Release proof and keeping the installer current

`ops/lib/native/manifest.json` owns artifact versions/digests and test-tool pins. `ops/native/debian-requirements.json` owns Debian package groups, users, directory modes, unit hardening, resource budgets and timer defaults. Shared ports remain in `ops/lib/envs.ts` (`ENV_TABLE` and `StackValues`); logical services and ordered controller operations remain in `ops/lib/services.ts` (`Service` and `SERVICE_ORDER`). Debian requirements reference those identities rather than copying their values. The unit renderer translates shared services into the explicit systemd dependencies shown above, including auth before web and isolation before listeners. Tests and the installer read these same inputs. Unit snapshots and firewall rules are rendered from shared planner output plus Debian requirements; bootstrap constants are generated from a marked requirements slice. A changed shared port, requirement or artifact input that leaves generated output stale must fail `debian-requirements.test.ts`. Behavioral tests also prove shutdown and readiness; matching JSON alone cannot.

The Windows VM harness uses a portable QEMU tree extracted without installation or administrator rights. [QEMU's Windows download page](https://www.qemu.org/download/#windows) links the [Weilnetz builds](https://qemu.weilnetz.de/w64/). That publisher offers installers, not an official portable ZIP. Select `qemu-w64-setup-20260811.exe`, verify [its SHA512 file](https://qemu.weilnetz.de/w64/qemu-w64-setup-20260811.exe.sha512), then extract with an already available 7-Zip executable. Do not execute the installer. The published SHA-512 fetched on 2026-11-14 is `5bcf9eed634e8575a37b74f445af41a2fe4106da512d0c30c368301d4c105037fdfab40a5287367a28a957624cddebbc8c07e16c88ab6634f554cdf3d16bf543`. QEMU itself was not downloaded or extracted in D1. Portable extraction and required DLL closure are a test gate; absence of a usable 7-Zip executable fails preflight with instructions, not an administrator prompt.

Use Debian's official [trixie genericcloud image directory](https://cloud.debian.org/images/cloud/trixie/latest/) and [SHA512SUMS](https://cloud.debian.org/images/cloud/trixie/latest/SHA512SUMS). On 2026-11-14 the downloaded image metadata identified build `20261111-2659`; the manifest must store that immutable directory and filename rather than `latest`. The observed `debian-13-genericcloud-amd64.qcow2` digest is `3247873136ba09b060fab45e9c115239f81c1d401fce00b8fa9b872013f7135d6a40b12462ab5ac03b9fa4ed5955dd0e8d1c900109a939ad7a0a4dafe7dea47b`. The arm64 image digest in the same published listing is `4a166ab9a73f27857896b799dff913199ea982e2379889340e60734ba43bea83840c1317f6257a9a8ca466b2293862181a597edc5cdb5d19d4cb704a85b4130a`. Only checksum/metadata files were fetched. Before pinning an immutable URL, Task 18 confirms those bytes at that path; mismatch fails instead of silently refreshing the digest. Verify Debian's signed checksum listing where available with the Debian cloud signing key obtained through an independently trusted Debian source; HTTPS plus the reviewed manifest digest remains the declared minimum trust path.

All Windows harness artifacts, SSH keys, logs, caches and overlays stay below `E:/mellodifai/tmp/debian-d1` or a specified E:/G: scratch root. Check C: has at least 20 GB free before running any step; never use it for test data. Use TCG explicitly: `-accel tcg,thread=multi -smp 4 -m 8192`, an 80 GiB qcow2 overlay and virtio storage/network. QEMU forwards only host `127.0.0.1:48222` to guest SSH 22. Open an SSH local forward from host `127.0.0.1:8080` to guest `127.0.0.1:8080`, using root's test key over port 48222. A direct slirp forward would target the guest network interface and cannot reach a loopback-only Caddy listener. Matching browser and guest ports also preserves the configured origin in login redirects. Fail preflight if host 8080 is occupied; do not terminate its owner. The separate e2e edge uses `E2E_EDGE_PORT=48082` and a matching SSH forward on host 48082. The host serves the generated source tarball on loopback port 48081; the guest reaches it through QEMU user networking at `10.0.2.2:48081`. No production Windows ports are touched. Validate that slirp reaches the host loopback source server; fail rather than bind that server publicly.

Create a cloud-init NoCloud seed with an ephemeral SSH public key, a non-password login, Debian apt sources and no application secrets. On Windows use the built-in IMAPI2 COM image writer to produce the CIDATA ISO in scratch. On Linux use `cloud-localds`. The harness requires these specific seed mechanisms and checks the resulting volume label and file contents. It does not require Docker, WSL, a Windows service or hardware-virtualization administrator rights. QEMU runs hidden with output redirected to scratch files.

The harness exports the candidate tree to a source tarball with a commit/tree receipt and digest, serves it locally, downloads and verifies it inside the guest as described above, then invokes the installer through local `--source`. Run the no-domain production install first. Verify real production initialization, unit ownership, loopback listeners, UID isolation, private files, worker status, owner sign-in and signed media through the forwarded port. Do not enable fake engines on that production stack. Use a separate `e2e` runtime root inside the VM for `pnpm test:db`, fixture users, fake-provider tests and Playwright fixture flows. The existing test DB guard must accept that test identity and reject production. Execute database tests inside the guest so port forwarding does not require weakening that guard.

Required sequence: fresh install; readonly stack status; database suite in the separate test root; Playwright through the host forward; a real CPU ffmpeg/Pillow/Chromium operation; create known storage versions; backup; restore to a separate root; compare bytes/attributes/rows; reboot; verify clean PostgreSQL shutdown and persistence; second installer run at a second candidate ref; verify upgrade and stable identity; fail a post-migration health check; perform declared app rollback; reboot again; verify forward schema-source retention. Negative cases include an invalid checksum, fake bundle passed as production, hostile tar paths, wrong OS/architecture, insufficient capacity, attempted direct upstream access from another UID, spoofed proxy headers and secret canaries in all journals/logs. Paid-provider network calls are disabled in the test environment.

The HTTP tunnel test does not prove TLS. The QEMU scenario also uses Caddy's local test CA, trusted only by the harness browser, to exercise HTTPS, cookies and redirects through SSH. This proves TLS routing but not public certificate issuance. A separate required release job targets an owner-provided disposable Debian 13 public test VM, with a DNS test name pointing to it and an ACME staging contact. It runs the same local-source installation over SSH and proves public ACME staging issuance and renewal. That job takes host, SSH key, domain and email from private CI configuration and does not provision or purchase infrastructure. Loopback-only QEMU networking is not presented as proof of an internet ACME challenge. Never use production certificate rate limits as a test loop. No credentials or domain are invented by D1.

Budget **2-6 hours** for a first TCG installation/build and **8 hours** for the full Windows VM run. These are unmeasured estimates made on 2026-11-14. Download caches and reused verified base images may reduce later runs. If TCG exceeds the budget, retain logs and phase timings, do not reduce required checks or call the test passed. Run the identical guest scenario on a Linux runner with KVM and report the Windows TCG result separately. Do not require the owner to enable WSL or administrator virtualization. An observed timeout becomes capacity evidence for revising the budget.

Linux CI uses the same pinned cloud image, tarball and guest assertions with `qemu-system-x86_64`, KVM when `/dev/kvm` is available, otherwise TCG. Allocate a runner with more than the guest's 8 GiB RAM and 4 vCPUs plus host overhead; a smaller default hosted runner is not sufficient. Initial KVM budget is 20-60 minutes for install and build, also an unmeasured estimate. The release job is required, not opt-in. Missing QEMU, virtualization, secrets for the TLS stage or an invoked integration environment is a failing gate, not a skip. Archive sanitized test receipts, resource peaks, package versions and commit IDs. Repeat the unchanged Windows native checks in parallel on their existing lab root. Arm64 remains rejected until the corresponding official-artifact build and native arm64 guest scenario passes.

Success means a fresh supported VM reaches a usable owner login and signed-media request, a second run preserves data/identity, a backup survives cross-platform restore, reboot stops and starts PostgreSQL cleanly, a cold app rollback retains forward schema validation, and all services resist the documented local-UID and ingress bypasses. Required lint is `shellcheck install.sh ops/native/install-debian.sh ops/native/lease-linux.sh` and `shfmt -d` on the same files. Required behavioral gates include the shared native, database, integration and Windows suites, plus the actual Debian VM install. D2 completed independent EGM review followed by Elephant remediation; it did not implement or execute these release gates.

## Detailed Implementation Plan

The tasks below are proposed implementation work, not code changed by D1 or D2. Paths are repository-relative. File actions are Create or Modify, never Delete; lists below state their action explicitly. Reuse current exports where stated. Run from the repository root with pinned pnpm. `T` means `pnpm typecheck` followed by `pnpm --filter web exec tsc --noEmit`, both exit 0. No task adds a migration or weakens final lockdown ordering.

`U <file>` is only for unit tests and uses that file's package configuration: for ops/test/x use `pnpm --dir ops exec vitest run --maxWorkers=4 test/x`; for apps/web/x use `pnpm --dir apps/web exec vitest run --maxWorkers=4 x`; for apps/worker/test/x use `pnpm --dir apps/worker exec vitest run --maxWorkers=4 test/x`. Other workspace tests use the same package-directory rule. Each required test must execute and pass. Never run web tests with a root default config.

`I <file>` means `pnpm exec tsx ops/test-platform-integration.ts <repository-relative-file>`. Task 3 creates this dispatcher. For ops/test/native it invokes the existing native runner with MDF_NATIVE_INTEGRATION=1, its dedicated config, one worker, no file parallelism, 300-second tests and 60-second hooks. For other Debian/CPU integration files it sets MDF_DEBIAN_INTEGRATION=1 and uses the new ops/vitest.debian.integration.config.ts with the same limits and explicit file selection. It fails missing prerequisites and any skipped required test by inspecting the machine-readable Vitest result. RUNNER_TEMP and all tool caches must be under the selected test scratch root. Linux integration requires env=e2e and the canonical non-linked root `/var/lib/mellodifai-test/e2e`; Windows retains the existing native-lab and explicitly validated CI-root guards. No production root is accepted. The guarded runner validates inputs before starting or stopping a stack and performs cleanup in finally. Existing production-rehearsal tests retain their Windows-only gate; Linux uses newly generated synthetic recovery fixtures, never the owner's historical recovery directory.

Dependencies are a directed graph: 1 -> 2 and 3; 3 -> 4; 2+3 -> 5; 2+4+5 -> 6; 6 -> 7; 3+6+7 -> 8; 1+3+8 -> 9; 7+8+9 -> 10; 3+10 -> 11; 4+5+11 -> 12; 4+8+12 -> 13; 3+8 -> 14; 1-14 -> 15; 9+12+13+15 -> 16; 10+14+15+16 -> 17; 15+16+17 -> 18; all prior tasks -> 19. Tasks 1-17 gate their own unit/type checks without executing unavailable later components. Full real-UID, cross-platform restore, unit-executable and end-to-end checks accumulate as mandatory Task 19 acceptance. Task 8 consumes release-selection types and fixture values from Task 1; Task 13 later supplies the durable loader. Task 12 implements and unit-tests bundle/capsule contracts; its complete Linux restore/token test executes after Task 13. Task 18 creates guest assertions before either host harness can run them. No placeholder is treated as a successful integration result.

### 1. Define the platform requirements and receipts (both platforms)

Files: Create `ops/native/debian-requirements.json`, `ops/lib/debian-requirements.ts`, `ops/lib/debian-contracts.ts` and `ops/test/debian-requirements.test.ts`. Modify `ops/lib/native/artifacts.ts`, `ops/lib/native/manifest.json` and `ops/test/native/artifacts.test.ts`. Keep `Artifact`, `Manifest` and `loadManifest` in artifacts.ts with compatible exports; there is no current manifest.ts. The requirements file defines Debian packages, users, unit hardening, directories, resource budgets and systemd mappings. It references shared service identities and reads ports from the environment planner. Do not duplicate ports or shared service order. The manifest defines artifact data only. Keep Windows entries unchanged.

Consumes current artifact schema and runtime layout. Produces `readDebianRequirements(file: string): DebianRequirements`, `validateRequirements(value: unknown): DebianRequirements` and the shared types consumed by Tasks 8 and 13: InstallReceipt, PreparedRelease, DeployState, PublicBuildConfig and ServiceReleaseSelection. Define their fields as specified in Task 13 now; their persistence arrives in Task 13. `InstallReceipt` contains schema version, requested ref, commit, source hash, platform, package versions, artifact hashes and requirements hash, with no private environment values.

Schema 2 keeps the existing `artifacts` entries and adds `platformProviders[artifactId][platformKey]`. Each download provider has kind='download', url, file, format, digest, size, strip, entry and notices; format is zip, tar.gz, tar.xz, raw-qcow2 or nsis-extract-only. Digest is `{algorithm: 'sha256' | 'sha512'; hex: string}`, validated at 64 or 128 lowercase hex characters. A package provider has kind='debian-package', package, major, binDir and allowedOrigins. Common version/licence/project and source-build kind remain in the artifact entry. Source-build providers reference the same pinned source bytes and recipe; they do not switch to upstream executables. `loadManifest` accepts schema 1 or 2 and normalizes schema-1 downloads to SHA-256 ZIP providers in memory, preserving all existing public exports and Windows behavior. Task 1 updates the reader and tests before changing the manifest schema; Task 2 adds executable Linux/tool entries. No checkpoint publishes schema 2 with a schema-1-only reader.

Tests `requirementsRejectUnknownFields`, `windowsPinsUnchanged`, `runtimePackagesHaveReasons`, `unitsUsersAndPortsResolve`, `schema1NormalizesWithoutChangingWindows`, `schema2ReaderPrecedesEntries` and `receiptRejectsSecretFields` assert complete classification, no orphan users/ports and backwards-readable Windows receipts. Run U on both named test files and T. Numbered task dependencies: none. Prerequisite: record finalized interfaces from concurrent shared data-safety work before starting.

### 2. Complete verified artifact and dependency closure (both; Linux execution)

Files: Create `ops/native/storage/pg-boss-integrity.patch`, `ops/test/native/debian-artifacts.integration.test.ts`. Modify `ops/lib/native/artifacts.ts`, `ops/lib/native/manifest.json`, `ops/lib/native/build.ts`, `ops/test/native/artifacts.test.ts`. Add table digests, measured download sizes and archive entry paths from actual verified downloads. Keep missing values as validation failures during development, never production placeholders. Resolve the pg-boss publisher archive digest and pin the deterministic lock patch. Pin Corepack/pnpm and approved Remotion native helpers through their lock integrity and receipts.

Consumes `ArtifactProvider`. Produces `resolveArtifact(id: string, platform: NodeJS.Platform, arch: string): ArtifactProvider`, `verifyPackageReceipt(name: string, major: number): Promise<PackageReceipt>` and the existing `installArtifact` contract extended for tar and the explicit test formats. PackageReceipt has name, version, architecture, origin and binDir. Reject escaping links and non-regular archive entries before publication. raw-qcow2 verifies SHA-512 and publishes an immutable image file without archive extraction; tests create separate overlays. nsis-extract-only verifies SHA-512 then uses the preflighted 7-Zip executable to extract into staging, validates the extracted tree and DLL closure, and never executes the installer. Keep algorithm/format checks in the shared artifact reader, not a harness-only downloader. No source hash is labelled a publisher signature.

Tests `tarTraversalRejected`, `downloadHashMismatchLeavesNoMarker`, `aptMajorAndOriginChecked`, `storageGitDependencyHasIntegrity`, `offlineClosureMissingFails` and existing ZIP tests. Run `U ops/test/native/artifacts.test.ts`; run T. After Task 3 supplies I, Task 19 runs `I ops/test/native/debian-artifacts.integration.test.ts` in the Linux lab; it must execute rather than skip. Expected verified executables report pinned versions and apt major 17. Dependency: 1.

### 3. Add POSIX roots and private files (both; Linux permission integration)

Files: Create `ops/lib/platform/paths.ts`, `ops/test/native/layout.test.ts`, `ops/test/runtime-paths.test.ts`, `ops/test/private-file.test.ts`, `ops/test/private-file-linux.integration.test.ts`. Modify `ops/lib/runtime.ts`, `ops/lib/envs.ts`, `ops/lib/private-file.ts`, `ops/lib/native/layout.ts`, `ops/test/production-runtime.test.ts`. Normalize platform defaults without changing explicit Windows roots.

Also Modify `ops/test/native/integration-env.ts`, `ops/test/native/fixtures.ts`, `ops/test/native/fixtures/deploy-rollback-child.ts`, `ops/test/native/fixtures/maintenance-child.ts`, `ops/test/native/fixtures/lease-child.ts`, `ops/test/native/fixtures/stack-child.ts`, `ops/test-native.ts` and `ops/vitest.native.integration.config.ts`. Create `ops/test-platform-integration.ts`, `ops/vitest.debian.integration.config.ts`, `ops/test/debian/integration-env.ts` and `ops/test/native/fixtures/portable-recovery.ts`. The native runner accepts an optional validated test-file selector. Remove Windows path defaults from shared fixture construction by requiring the validated scratch root. Generate production-shaped synthetic dump/object/identity fixtures in the disposable guest; do not adapt the owner-data import-crash test to read private recovery paths on Linux. Tests cover rejected real production roots, symlink roots, missing opt-in, missing prerequisites and skipped-result failure. Preserve Windows guard cases unchanged.

Consumes current `runtimeRoot`, `runtimePath`, private-file APIs and requirements. Produces `platformDefaultRoot(platform: NodeJS.Platform): string`, `validateRuntimeRoot(root: string, codeRoot: string): string` and `ensurePrivateDirectory(path: string, owner: {uid: number; gid: number}): Promise<void>` for Linux provisioning. Private writes use exclusive temporary files, fsync, no-follow checks and atomic rename; no caller chooses a weaker mode.

Tests `linuxRootOutsideRelease`, `customRootNoSecondDataTree`, `windowsDriveCStillRejected`, `symlinkParentRejected`, `otherUidCannotReadSecrets` and `privateRenameRetainsMode`. Run U on the named unit files and T. Task 19 runs I for each named integration, including the new fixture/runner contracts, on its supported OS. Dependency: 1.

### 4. Implement Linux process identity and lifetime leases (both)

Files: Create `ops/lib/native/platform/linux.ts`, `ops/lib/native/platform/windows.ts`, `ops/native/lease-linux.sh`. Modify `ops/lib/native/host.ts`, `ops/lib/native/processes.ts`, `ops/lib/native/lease.ts`, `ops/test/native/processes.test.ts`, `ops/test/native/lease.test.ts`, `ops/test/native/lease-race.integration.test.ts`, `ops/test/native/prepare-race.integration.test.ts`. Preserve `ops/native/lease.ps1` except shared protocol fixes proved on Windows.

Consumes current `acquireLease(path: string, command: string, timeoutMs?: number): Promise<() => Promise<void>>`, `withStackLease<T>(env: StackEnv, command: string, operation: () => Promise<T>): Promise<T>` and `assertStackLease(env: StackEnv): void`. Preserve these signatures. Extend shared ProcessIdentity with optional `identityVersion: 2`, `platform`, `token` and `startedAtEpochMs`, retaining required pid and startedAt for compatible Windows readers. New records always include all version-2 fields; startedAt remains an ISO epoch timestamp, never an opaque token. Linux token is boot ID plus start ticks; Windows token preserves the exact CIM creation-time string. `identifyProcess(pid: number): Promise<ProcessIdentity | null>` returns this representation; existing processIdentities, sameProcess and terminateTree exports adapt to it. `terminateProcessTree(identity: ProcessIdentity, graceMs: number): Promise<void>` uses the same comparison.

Task 4 also modifies `ops/lib/native/postgres.ts`, `ops/lib/native/supervisor.ts` and `ops/lib/native/postgres-host.ts`, including every identity serializer/comparator in these modules and processes.ts, before landing. Version-2 comparisons require matching pid/platform/token; PostgreSQL verifies its PID-file epoch against startedAtEpochMs with the existing bounded tolerance as an additional check. A missing/invalid token cannot authorize a Linux kill or adoption. Legacy Windows records retain their current CIM startedAt comparison and normalize on the next verified write. Legacy Linux/unknown-platform records are untrusted: refuse adoption and destructive cleanup, report a stale identity, and require explicit recovery after proving the process is stopped. Tests cover legacy Windows round trips, Linux PID reuse, boot changes and incompatible saved state. No lease bypass environment variable or lock-inode unlinking.

Tests `pidReuseDoesNotKillStranger`, `linuxGrandchildStops`, `leaseHeldUntilOperationEnds`, `helperDeathAbortsMutator`, `staleHolderCannotStealLease` and existing prepare/import races on each OS. Run U on the named unit files; Task 19 runs I on each named integration with the required environment. Run `shellcheck ops/native/lease-linux.sh`, `shfmt -d ops/native/lease-linux.sh`, and `T`. Dependency: 3 and finalized concurrent lease implementation.

### 5. Build Linux Auth/Storage and metadata access (both)

Files: Create `ops/test/native/linux-build.integration.test.ts`. Modify `ops/lib/native/build.ts`, `ops/lib/native/storage-metadata.ts`, `ops/lib/native/backup.ts`, `ops/native/storage/fs-xattr/index.js`, `ops/test/native/storage-metadata.test.ts`, `ops/test/native/storage.integration.test.ts`. Test the unchanged `ops/native/auth/listener-portable.patch`. Remove backup.ts's direct ADS import in favor of the shared metadata adapter. The Windows replacement remains selected only on Windows; no Linux syscall implementation is added to it.

Consumes verified artifacts and frozen source recipes. Produces `loadMetadataBackend(storageRoot: string, platform: NodeJS.Platform): Promise<MetadataBackend>` and `probeMetadataFilesystem(directory: string, backend: MetadataBackend): Promise<void>`. `MetadataBackend` exposes synchronous `list(path): string[]`, `get(path,name): Buffer`, `set(path,name,value: Buffer): void` and `remove(path,name): void`, normalized to the existing portable attribute representation. Build receipt includes toolchain, source, patch and native-addon hashes. Approved addon build uses pinned Node headers without a network fetch.

Tests `sameAuthPatchBuildsOnBothPlatforms`, `linuxAddonLoadsPinnedNode`, `renameRetainsAttributes`, `unsupportedFilesystemFailsBeforeInit` and `windowsAdsStillRoundTrips`. Run U on the named unit tests and T. Task 19 runs I for the two real storage/build integrations on their supported platforms. Expected Auth and Storage readiness plus versioned object round trip without leaked logs. Dependencies: 2, 3.

### 6. Add Debian PostgreSQL and foreground shutdown (both; real systemd later)

Files: Create `ops/native-supervisor.ts`, `ops/test/native/postgres.test.ts`, `ops/test/native/shutdown.integration.test.ts`. Modify `ops/lib/native/postgres.ts`, `ops/lib/native/plan.ts`, `ops/lib/native/supervisor.ts`, `ops/lib/native/stack.ts`, `ops/lib/native/processes.ts`, `ops/lib/native/postgres-host.ts`, `ops/test/native/processes.test.ts`, `ops/test/native/postgres-host.test.ts`, `ops/test/native/postgres-ready.test.ts`, `ops/test/native/postgres-startup.test.ts`. Keep vendored SQL unchanged; do not invent extensions or migrations.

Consumes verified package binDir, process adapter, existing `ProcessSpec`, dependency readiness and stack initialization. Produces `runForegroundSupervisor(env: StackEnv, signal: AbortSignal): Promise<void>` and `stopNativeStack(env: StackEnv, reason: 'command' | 'signal' | 'failure'): Promise<void>`. Route ordinary stop and signals through that same function. Preserve the Windows console host. Foreground completion rejects on exhausted child restarts. Linux initializer uses the specified locale, sockets and Debian binary directory.

Tests `stopOrdersGatewayBeforePostgres`, `postgresFastStopWaits`, `signalDoesNotKillPostgresFirst`, `exhaustedChildFailsSupervisor`, `postmasterIdentityRejectsReuse` and `debianDefaultClusterAbsent`. Run U on unit tests and T. Task 19 runs isolated `I ops/test/native/shutdown.integration.test.ts`. Expected no live postmaster after normal stop and no crash-recovery marker on next start. Dependencies: 2-5.

### 7. Make logs safe before their destination (both)

Files: Create `ops/lib/native/safe-log.ts`, `ops/test/native/log-redaction.test.ts`. Modify `ops/lib/native/processes.ts`, `ops/lib/native/postgres.ts`, `ops/lib/native/supervisor.ts`, `apps/auth/src/main.ts`, `apps/worker/src/main.ts`. Web child output is filtered by the service launcher in Task 8. Preserve useful fixed readiness/exit events without recording arbitrary payloads.

Consumes child output chunks and structured application events. Produces `sanitizeServiceEvent(service: string, event: unknown): SafeEvent | null` and `createSafeLogSink(service: string, write: (line: string) => void): {stdout(chunk: Buffer): void; stderr(chunk: Buffer): void; close(): void}`. SafeEvent has only timestamp, service, approved event code, numeric exit code and approved non-secret category. Bound buffered partial lines and rate-limit repetitive generic events.

Tests `splitChunkSecretNeverEscapes`, `sqlAndMailLinkRedactedBeforeWrite`, `unknownOutputBecomesGeneric`, `statusContainsNoArgv` and `rotationReservesSpace`. Use canary JWTs, passwords, URLs and SQL across chunk boundaries. Run `U ops/test/native/log-redaction.test.ts` and `T`. Expected no canary in any captured sink, including failures. Dependencies: 6 and shared run7 logging/rotation fixes.

### 8. Add service control and application launch contracts (both)

Files: Create `ops/lib/service-control.ts`, `ops/lib/platform/services-linux.ts`, `ops/lib/platform/services-windows.ts`, `ops/server-service.ts`, `ops/test/service-control.test.ts`, `ops/test/server-service.test.ts`. Modify `ops/services.ts`, `ops/lib/services.ts`, `apps/auth/src/main.ts`, `apps/worker/src/main.ts`. Keep `ops/logon.ps1` and `ops/service-host.ps1` Windows behavior; adjust only calls that move behind the controller, with matching tests.

Consumes requirements, current/schema release receipt, credentials directory and shared foreground supervisor. Produces `ServiceControl` with `start(service: Service): Promise<void>`, `stop(service: Service): Promise<void>`, `status(service: Service): Promise<ServiceStatus>` and `restart(service: Service): Promise<void>`. ServiceStatus contains name, active state, readiness and safe failure code. `runService(name: 'stack' | 'web' | 'auth' | 'worker' | 'caddy', signal: AbortSignal): Promise<void>` loads private credentials and existing application entry points. `waitServiceReady(name: string, timeoutMs: number): Promise<void>` is readonly. Expose `startAuth(signal: AbortSignal): Promise<void>` and `startWorker(signal: AbortSignal): Promise<void>` from their current mains, without changing application behavior.

Tests `linuxUsesSystemdOnce`, `windowsServicePlanUnchanged`, `launcherNeverRestartsChild`, `credentialMissingFailsClosed`, `webChildOutputFiltered` and `readinessWaitsForDependencies`. Run U on both new files, existing services tests and `T`. Expected both adapters satisfy the same contract; no Windows runtime invokes systemctl. Dependencies: 3, 6, 7.

### 9. Render units, directories and the private network boundary (Linux; renderer on both)

Files: Create `ops/native/systemd/mellodifai-stack.service`, `ops/native/systemd/mellodifai-web.service`, `ops/native/systemd/mellodifai-auth.service`, `ops/native/systemd/mellodifai-worker.service`, `ops/native/systemd/mellodifai-isolation.service`, `ops/native/systemd/mellodifai-backup.service`, `ops/native/systemd/mellodifai-backup.timer`, `ops/native/systemd/caddy.service.d/mellodifai.conf`, `ops/native/systemd/systemd-journald@mellodifai.service.d/storage.conf`, `ops/lib/debian-units.ts`, `ops/lib/debian-network.ts`, `ops/native/journald-mellodifai.conf`, `ops/test/debian-units.test.ts`, `ops/test/debian-isolation.integration.test.ts`. Requirements contains semantic unit definitions; these files are generated render snapshots checked by tests, not a second editable authority.

Consumes requirements, shared environment/service planner output, validated root and numeric user IDs. Produces `renderUnits(requirements: DebianRequirements, root: string): Map<string,string>` and `renderIsolation(config: {domain: string | null; uids: Record<string,number>; ports: Record<string,number>}): string`. Both renderers obtain service names and ports from the shared modules, not duplicated JSON literals. Tests change a shared port fixture and prove units and firewall change together. Installer creates private owned directories before verification. nft rules replace only this application's table and restrict owner proxy access as specified. Disable app starts if firewall/journal preparation fails.

Tests `unitsMatchRequirements`, `customRootHasNoVarLibData`, `workerAllowsChromiumSandbox`, `journalsStayUnderRoot`, `unprivilegedUidCannotReachUpstreams`, `spoofedOwnerProxyDenied`, `sshSurvivesFirewall` and `failedIsolationPreventsStack`. This task gates U on unit snapshots and T. After all referenced executables exist, Task 19 runs Linux `systemd-analyze verify` on every rendered unit, `nft --check --file <rendered-rules>` and `I ops/test/debian-isolation.integration.test.ts`. Expected no verification errors, known journal event retrievable after rotation/reboot, and only intended remote ports reachable. Dependencies: 1, 3, 8.

### 10. Centralize origins and public ingress policy (both)

Files: Create `ops/lib/edge-policy.ts`, `ops/test/origins.test.ts`, `ops/test/debian-proxy.integration.test.ts`. Modify `ops/lib/auth-origins.ts`, `ops/edge-proxy.ts`, `ops/lib/native/gateway.ts`, `ops/lib/native/plan.ts`, `ops/lib/render.ts`, `apps/web/next.config.ts`, `apps/web/proxy.ts`, `apps/web/lib/remote.ts`, `apps/web/lib/supabase/browser.ts`, `apps/web/lib/supabase/server.ts`, `apps/auth/src/main.ts`, `ops/test/native/gateway.test.ts`, `apps/web/proxy.test.ts`, `apps/web/lib/remote.test.ts`. Keep the resolver filesystem-free for Next imports. No new relative shared-package import is needed; if one is introduced mechanically, it requires the binding Next Turbopack alias.

Consumes validated domain/tunnel settings and existing edge limits. Produces `resolveOrigins(input: {publicOrigin: string; ownerOrigin: string}): ProductionOrigins`, `renderCaddy(config: ProductionOrigins): string` and `validateIngress(input: {headers: Record<string,string | string[] | undefined>; peer: string; hopToken: string}): {remote: boolean; clientIp: string; origin: string}`. ProductionOrigins has publicOrigin, ownerOrigin, issuer, resource, authRedirects, appOrigins and browserSupabaseUrl. Keep internal gateway URL separate. Invalid/absent hop credentials cannot grant owner identity. Use the same extracted edge policy for Windows and Linux.

Also Modify `apps/web/lib/redirect-url.ts`, `apps/web/lib/redirect-url.test.ts` and `apps/web/app/auth/confirm/route.ts`. Replace the helper's `<origin>/**` authorization check with exact membership in ProductionOrigins.appOrigins. That origin allowlist is distinct from GoTrue's exact confirmation/redirect URL list; do not broaden the latter. requestOrigin accepts only the validated ingress result, not raw forwarded host/protocol. Apply the same rule to sign-in mail, confirmation and refresh proxy redirects, preserving safeNext restrictions for remote requests. Tests prove exact owner confirmation, host-only cookie creation/refresh, public Secure cookies and forged-header refusal without wildcard redirects.

Tests `remoteStudioStillDenied`, `inboundRemoteHeaderCannotSpoof`, `originControlsMailAndIssuer`, `gatewayHostRemainsLoopback`, `signedMediaUsesPublicOrigin`, `framingSmuggleRejectedThroughProxy` and `ratePolicyUnchanged`. Run U on unit files and T. Task 19 runs Linux `caddy validate --config <rendered-config>` with a private test credential and `I ops/test/debian-proxy.integration.test.ts`. Expected real OAuth discovery/login and signed-media retrieval through HTTPS/tunnel. Dependencies: 7-9.

### 11. Provision first-run identities and owner access (both helpers; Linux installer)

Files: Create `ops/provision-production-identity.ts`, `ops/server-owner.ts`, `ops/test/production-identity.test.ts`, `ops/test/server-owner.test.ts`. Modify `ops/lib/stack-secrets.ts`, `ops/lib/roles.ts`, `ops/lib/native/secrets.ts`, `ops/lib/native/production-secrets.ts`, `ops/rotate-auth-keys.ts`, `ops/lib/private-file.ts`, `ops/lib/user-admin.ts`, `ops/sign-in-link.ts`. Reuse `loadStackSecrets(env: StackEnv, bootstrap?: boolean): Promise<StackSecrets>`, `randomPassword(): string` and the Auth key-generation recipe extracted from rotation into the same shared module. Explicit provisioning creates the production database-password file before calling `readStackPasswords`; that function retains its refusal to generate production passwords.

Consumes shared key generators, requirements users and validated origins. Produces `provisionEmptyProductionIdentity(root: string, origins: ProductionOrigins): Promise<IdentityReceipt>` and `writeOwnerSignInLink(email: string, outputFile: string): Promise<void>`. IdentityReceipt contains only stack UUID and public fingerprints. CLI requires root and genuinely empty state; interrupted private receipts resume consistently. Owner creation invokes existing user-admin behavior. Optional worker owner binding is written privately only after account creation.

Tests `missingIdentityOnStartStillRejected`, `partialIdentityRefusesRegeneration`, `emptyRootCreatesPrivateIdentityOnce`, `ownerLinkNeverLogged` and `secondProvisionPreservesKeys`. Run U on both new files and `T`; Linux verify owners/modes as part of Task 19. Expected first initialization succeeds only after explicit provision. Dependencies: 3, 10.

### 12. Extend portable provenance and identity transfer (both)

Files: Create `ops/lib/native/identity-capsule.ts`, `ops/test/native/backup-provenance.test.ts`, `ops/test/native/cross-platform-restore.integration.test.ts`. Modify `ops/lib/native/backup.ts`, `ops/lib/native/storage-metadata.ts`, `ops/native-backup.ts`, `ops/native-import.ts`, `ops/native-prepare-import.ts`, `ops/test/native/import.test.ts`, `ops/test/native/import-crash.integration.test.ts`, `ops/test/native/maintenance-crash.integration.test.ts`. Build on the finalized data-safety journal and provenance work; do not add a competing bundle parser.

Modify `ops/lib/native/identity.ts` alongside the listed bundle modules. Consume the existing format-1/2 parser, metadata backend and identity receipt. Produce `exportIdentityCapsule(destination: string, bundleDigest: string): Promise<CapsuleReceipt>`, `verifyProductionBundle(bundle: string, capsule: string): Promise<VerifiedBundle>` and `attestLegacyBundle(bundle: string, capsule: string, destination: string, trust: LegacyTrustReceipt): Promise<void>`. CapsuleReceipt exposes hashes only. VerifiedBundle is the format-3 verified result and binds source environment, sourceStackId, migration digest, PG major, data hashes and identity fingerprints to checked dump facts. Destination UUID comes from stackIdentity and never from the capsule. Preserve legacy readers and test fixed Windows format-2 fixtures, rejected unconverted production restore, explicit attestation, destination UUID retention and interruption before identity publication. Restore accepts only VerifiedBundle at mutation.

Tests `fakeDumpCannotBecomeProductionByEditingManifest`, `identityMismatchRejected`, `legacyBundleNeedsAttestation`, `historicalAttributesRoundTrip`, `oldTokensSurviveSameOriginMove` and `interruptedRestoreNeverPublishesMixedState`. Run U on the named unit files. Task 19 runs I on the named integrations, using portable synthetic fixtures on Linux and the existing historical fixture only on Windows. Expected exact object bytes/metadata and preserved auth inputs. Dependencies: 4, 5, 11 and shared B1/S8 fixes.

### 13. Add immutable releases and durable application rollback (both)

Files: Create `ops/lib/release-layout.ts`, `ops/lib/deploy-state.ts`, `ops/server-maintenance.ts`, `ops/test/deploy-state.test.ts`. Modify `ops/deploy.ts`, `ops/lib/recovery.ts`, `ops/lib/native/maintenance.ts`, `ops/lib/native/commands.ts`, `ops/lib/native/credentials.ts`, `ops/lib/native/rollback.ts`, `ops/test/deploy.test.ts`, `ops/test/native/rollback.test.ts`, `ops/test/native/deploy-rollback.integration.test.ts`. Existing rotations (`ops/rotate-auth-keys.ts`, `ops/rotate-db-passwords.ts`, `ops/rotate-supabase-keys.ts`) consume the shared controller/lease and private credential paths rather than a Linux branch of transaction logic.

Consumes `ServiceControl`, `VerifiedBundle`, shared lease/journal and `nativeEntry(entry: string, args: string[], from: string): Promise<void>`. Implements Task 1's contracts: `prepareRelease(source: string, receipt: InstallReceipt, publicConfig: PublicBuildConfig): Promise<PreparedRelease>`, `publishRelease(release: PreparedRelease): Promise<void>` and `loadDeployState(root: string): Promise<DeployState>`. PublicBuildConfig contains only browser API origin, anonymous key and declared non-secret build flags. PreparedRelease has immutable directory, commit, buildId, publicConfigFingerprint, requirements hash and artifact receipts. DeployState has applicationRelease, schemaRelease, phase, backup receipt, accepted migration digest and active credential/build generation references. `rollbackApplication(target: string, declarationId: string): Promise<void>` validates the committed declaration described above, retained forward sources and active public fingerprint. Create `ops/release-compatibility.json` with version 1 and an empty entries list until a real compatibility review authorizes an entry. Tests distinguish absent, altered, stale and wrong-target declarations from missing forward sources.

Root-control requests are `start`, `stop`, `status` for known units; `publish` for PreparedRelease ID; operation-scoped credential methods; `prepare-release` for validated source ID and PublicBuildConfig; and `apply-packages` for a validated package-plan ID. Each envelope contains operationId and expectedPhase. Root verifies both against the shared journal, never trusts a child-provided path, and returns a typed receipt or safe error code. Add tests for public-only build environment, wrong-phase package mutation, coordinator death, lost pipe during preparation and complete-generation recovery. Task 13 wires the durable release loader into Task 8's injected ServiceReleaseSelection contract.

Add `CredentialStore` to `ops/lib/native/credentials.ts`: `read(id: CredentialId): Promise<Buffer>`, `stage(values: ReadonlyMap<CredentialId, Buffer>): Promise<string>`, `publish(generationId: string): Promise<void>` and `recover(generationId: string): Promise<void>`. CredentialId is a closed enum for the secret-table stores; each rotation receives only its documented subset. Environment-store staging merges validated named fields into existing settings, preserving unrelated fields. Root rejects mismatched operation IDs, IDs outside that subset, unknown fields, stale phases and caller-supplied paths. Extend existing rotation journals for staged generation fingerprints and recovery, not a second transaction ledger. Tests `linuxRotationsPublishOwnedCredentials`, `credentialGenerationCrashBlocksStartup` and `systemdReloadsRotatedCredentials` cover all three rotations under real service UIDs.

The concurrently introduced `readRollback(layout: NativeLayout): SchemaRollback | undefined`, `validateRollback(marker: SchemaRollback, files: MigrationFile[], applied: AppliedMigration[]): void` and `recordRollback(layout: NativeLayout, release: string, files: MigrationFile[], applied: AppliedMigration[]): Promise<void>` remain the shared rollback authority. Extend their durable marker with the forward schema/artifact references and compatibility digest. `deploy-state.ts` is an adapter over that journal/marker, not an independent rollback validator. Persist cross-file updates through the existing durable journal and reject incomplete combinations after a crash.

Tests `failureBeforeMigrationKeepsOldRelease`, `publishIsAtomic`, `rollbackRetainsForwardSchemaOnColdBoot`, `missingCompatibilityRefusesRollback`, `maintenanceCannotPublishMixedData`, `rootPipeRejectsArbitraryCommands`, `leaseNotReacquiredAcrossPrivilegeBoundary`, `sameCommitNewPublicConfigGetsNewBuild`, `rotationCrashCannotStartMismatchedBrowser` and `rollbackRejectsObsoletePublicConfig`. Run U on new deploy-state and existing deploy tests and T. Task 19 executes crash/recovery integration through I on both platforms. Expected no downgrade or implicit restore after a migration failure. Dependencies: 4, 8, 12 and shared run7 S9 fix.

### 14. Implement CPU worker profile and dependency preflight (both)

Files: Create `apps/worker/src/runtime-profile.ts`, `apps/worker/src/dependency-preflight.ts`, `apps/worker/test/runtime-profile.test.ts`, `apps/worker/test/dependency-preflight.test.ts`, `apps/worker/test/cpu-media.integration.test.ts`. Modify `apps/worker/src/main.ts`, `apps/worker/src/engine.ts`, `apps/worker/src/comfy/config.ts`, `apps/worker/src/comfy/runtime.ts`, `apps/worker/src/comfy/supervisor.ts`, `apps/worker/src/comfy/availability.ts`, `apps/worker/src/stages/local-engine.ts`, `apps/worker/src/stages/remake.ts`, `apps/worker/src/stages/visualizer.ts`, `apps/worker/src/stages/thumbnail.py`, `packages/remake/src/paths.ts`, `packages/remake/src/env.ts`, `packages/remake/src/run.ts`, `packages/remake/src/align.ts`, `packages/remake/src/ingest.ts`, `packages/visualizer/scripts/render.mjs`. Keep product routes and queue schema unchanged.

Consumes explicit runtime paths, shared stage/status definitions and worker owner/identity. Produces `resolveRuntimeProfile(platform: NodeJS.Platform, env: NodeJS.ProcessEnv): RuntimeProfile`, `derivePipeline(input: {job: Job; version: Version | null; project: Project | null}): readonly Stage[]` and `checkPipelineDependencies(stages: readonly Stage[], profile: RuntimeProfile): Promise<{available: boolean; missing: string[]}>`; Job/Version/Project come from worker db.ts and Stage from shared. RuntimeProfile selects windows-local or linux-cpu, executable/font/cache paths and concurrency. Check the full requested pipeline before any paid call. When no owner is configured, report status without claiming jobs. Missing dependencies return a stable dependency-unavailable error, with no fake output or cloud fallback.

Also Modify `apps/worker/src/loop.ts` and `apps/worker/src/stages/index.ts`; Create `apps/worker/test/dependency-pipeline.test.ts`. Inject a required production preflight callback into WorkerLoop. Call it after authorizeStage or authorizeSongless and before workspace/engine/handler execution in both paths. Derive the automatic pipeline through the next human review gate using shared nextStages and stage constants: analysing is remake_ingest/analyse/rewrite; producing is timing/storyboard/render_master/render_hook/qa/art; publish includes set_privacy; drafting and generation stop at their existing review gates. On-demand stages, import_audio and songless lyrics_assist check their own complete handler dependencies. Remake section/check requests remain standalone. For resumed jobs check the remaining suffix plus required saved-input availability; do not re-run completed paid stages. Reject unknown stages or inconsistent job/status inputs before calling a provider.

The stage registry declares every executable/script/model dependency for each handler, including nested engine calls. Tests require registry coverage for every registered real stage and compare pipeline ordering to shared nextStages. An available paid first handler must not run when a later automatically required handler lacks a dependency; assert zero provider calls and the stable error. Fake test handlers retain isolated test-only behavior. No capability scheduler, new job type or database migration is introduced.

Tests `linuxNeverSpawnsWindowsGpuPrograms`, `missingExternalEngineFailsBeforeSpend`, `windowsGpuPlanUnchanged`, `linuxBrowserUsesSandboxAndSoftwareGl`, `fontMappingHasNoWindowsPaths` and `secondWorkerNotAdvertisedAsRemoteRenderer`. Run U on new unit files and existing remake/worker command tests. Task 19 runs Linux `I apps/worker/test/cpu-media.integration.test.ts`. Expected ffmpeg, Pillow and shipped visualizer operate on fixture media under the real worker unit. Dependencies: 3, 8; integration also needs 9. External model installs remain outside this task.

### 15. Implement the thin bootstrap and versioned installer (Linux; parsing tests on both)

Files: Create `install.sh`, `ops/native/install-debian.sh`, `ops/install-debian.ts`, `ops/lib/install-source.ts`, `ops/lib/install-journal.ts`, `ops/test/install-bootstrap.test.ts`, `ops/test/install-debian.test.ts`. Use the commands and trust model above. Do not hardcode a second artifact manifest or duplicate deployment logic.

Consumes requirements, receipts, source digest, production provisioning and shared deploy APIs. Produces `parseInstallArgs(args: readonly string[]): InstallOptions`, `resolveInstallSource(options: InstallOptions, githubToken?: string): Promise<VerifiedSource>`, `installDebian(options: InstallOptions): Promise<InstallReceipt>` and `resumeInstall(journalPath: string): Promise<InstallReceipt>`. InstallOptions contains only the documented flags; VerifiedSource contains private staging path, immutable commit when verified, source hash and trust mode (`github` or `owner-digest`). Token is never included in these return values. The shell handoff contract is `install-debian.sh --receipt <private-json> -- <validated-options>` with no secrets in arguments. Fail insufficient capacity before service changes. Preserve the inherited machine lock through handoff. On existing installations, pre-coordinator code cannot run apt. Provision or validate/import identity before prepareRelease receives its public-only build projection. Tests `bootstrapSerializesBeforeApt`, `existingBootstrapCannotMutatePackages`, `freshBuildReceivesRealAnonymousKey` and `buildUserCannotReadPrivateIdentity` prove these ordering and access rules.

Tests `wrongOsRefused`, `arm64RefusedUntilQualified`, `latestRelease404OnlyFallsBack`, `tokenAbsentFromArgvLogsAndDisk`, `sourceRequiresDigest`, `httpSourceUrlRejected`, `archiveCannotEscape`, `bootstrapDriftFails`, `secondInstallKeepsIdentity`, `failedBuildKeepsCurrent`, `packageChangeThenBuildFailureRequiresRepair` and `resumeDoesNotReinitialize`. The package-failure test proves that the old app pointer survives, services stay stopped, actual package versions are journaled and recovery requires package repair plus readiness, without an apt downgrade. Run U on both new files, `shellcheck install.sh ops/native/install-debian.sh`, `shfmt -d install.sh ops/native/install-debian.sh`, and `T`. Expected zero lint errors and deterministic sanitized receipts. Dependencies: 1-14 except external-engine packaging.

### 16. Add backup scheduling and retention (Linux integration; shared retention on both)

Files: Create `ops/lib/backup-retention.ts`, `ops/test/backup-retention.test.ts`. Modify `ops/server-maintenance.ts`. Modify the unit snapshots explicitly listed in Task 9. Wire the backup timer only after initial health and a first verified bundle. Keep off-site upload out of scope.

Consumes shared backup receipt and deploy/recovery references. Produces `selectRetainedBackups(bundles: readonly BackupReceipt[], references: ReadonlySet<string>, now: Date): {keep: string[]; remove: string[]}` and `runScheduledBackup(): Promise<void>`. The latter preserves preexisting unit state, obtains the shared lease through the stack operation and prunes only after verified success.

Tests `lastVerifiedBackupNeverRemoved`, `journalReferencedBackupRetained`, `failedBackupDoesNotPrune`, `stoppedStackNotStartedByTimer` and `backupUsesSameLeaseAsDeploy`. Run `U ops/test/backup-retention.test.ts`; Linux `systemctl start mellodifai-backup.service` in the disposable VM, expected successful verified receipt and preserved application state; `systemctl list-timers mellodifai-backup.timer`, expected the configured next run. Dependencies: 9, 12, 13, 15.

### 17. Close application configuration and document operator commands (both)

Create `ops/mdf.ts`, `ops/server-logs.ts` and `ops/test/mdf.test.ts`. `parseMdfArgs(args: readonly string[]): MdfCommand` returns a discriminated union for the commands below; `runMdf(command: MdfCommand): Promise<number>` dispatches to existing shared operations and adapters. Unknown flags/extra arguments fail before mutation. Every command accepts validated `--root`; precedence is flag, MELLODIFAI_ROOT, platform default. Linux commands require root. Generate the root-owned `/opt/mellodifai/bin/mdf` launcher with pinned Node/tsx and the installed root; it forwards arguments without eval. Print the absolute command after install. The short examples assume `PATH=/opt/mellodifai/bin:$PATH`, with no automatic shell-profile edits.

| Command | Required inputs and dispatch |
| --- | --- |
| start, stop, status | Ordered shared service controller; status returns 1 if not fully ready and includes maintenance state. |
| owner create | --email; shared user-admin provisioning, then private worker-owner binding. |
| owner link | --email and --output; existing signInLink at ownerOrigin; exclusive private output, path-only message. |
| configure-mail | --input pointing to an owner-private JSON file; strict SMTP fields enabled/host/port/user/password/admin_email/sender_name. Reuse smtp.ts validation/rendering; publish password to root-owned secrets/smtp.env and normalized settings to stack.env through the credential adapter. Restart the stack and restore previously active dependents through ServiceControl. No secret argument or arbitrary environment map. |
| backup | Optional --output; otherwise a new timestamped directory under backups/prod. Shared maintenance and identity capsule export. |
| backup attest | --bundle, --identity, --trust, --output and --confirm-production; legacy conversion described above, with independently verified source/capsule digests read from the private LegacyTrustReceipt file. |
| restore | --bundle, --identity and --confirm-production; verify before shutdown, then shared restore transaction. |
| recover | --operation matching a pending journal ID; dispatch its recorded recovery action, refuse a caller-provided backup path or unknown phase. Package-repair failures retain pending state. |
| rollback | --to build ID and --compatibility entry ID; shared rollback authorization and publisher. |
| logs | Optional --disk-usage or --follow; server-logs resolves the runtime-root namespace directory and invokes journalctl with an argument array. |

Exit codes: 0 success, 1 operation failure/unready, 2 invalid input, 3 pending recovery, 4 lease unavailable. Private inputs require no-follow checks and owner-only access before parsing. Tests assert each command reaches the actual shared operation adapter, rejects unknown arguments before side effects, uses the chosen root, protects mail/link inputs and preserves stopped service state. Extend CredentialId with smtp-env only for the configure-mail operation; unrelated provider/key stores remain inaccessible.

Files: Create `docs/debian-vps.md`, `ops/test/documented-commands.test.ts`. Modify `docs/native-production.md`, `docs/production-logon.md`, `docs/HANDOFF.md`, `README.md`, `package.json`, `ops/lib/auth-origins.ts`, `ops/lib/worker-env.ts`, `ops/lib/smtp.ts`, `ops/test/origins.test.ts`, `ops/test/worker-env.test.ts`, `ops/test/smtp.test.ts`. Documentation changes describe both platforms without removing Windows instructions. No secret example uses a real value.

Consumes installer CLI, ServiceControl and ProductionOrigins. Produces documented `mdf start`, `mdf stop`, `mdf status`, `mdf owner create`, `mdf configure-mail`, `mdf backup`, `mdf restore`, `mdf rollback` and unchanged shared `pnpm ops` entry points. Add package scripts `test:debian:vm` and `test:debian:contracts` pointing to Tasks 18-19 and the named contract tests. Document the one-line and two-step install forms, token scope, no-domain tunnel, worker limitation, same-origin migration, root capacity and off-site choice. Root `mdf start` uses existing start-all ordering after a stack failure; no new restart daemon is introduced.

Tests `allProductionOriginsComeFromResolver`, `mailAndBrowserOriginAgree`, `documentedCommandsParse` and `windowsCommandsStillParse`. Run U on all unit test files named in this task, `pnpm test:debian:contracts`, `T` and `pnpm lint`. Expected no hidden hardcoded production hostname and no drift in requirements/units/bootstrap. Dependencies: 10, 14-16.

### 18. Build the portable Windows VM harness (Windows only)

Files: Create `ops/test/debian/vm-windows.ps1`, `ops/test/debian/seed-windows.ps1`, `ops/test/debian/source-server.ts`, `ops/test/debian/scenario.ts`, `ops/test/debian/harness.test.ts`, `ops/test/debian/guest-checks.ts`, `ops/test/debian/vps-smoke.spec.ts`, `ops/test/debian/upgrade-rollback.integration.test.ts` and `ops/test/debian/playwright.config.ts`. Modify `ops/lib/native/manifest.json`, `ops/package.json` and `pnpm-lock.yaml`. Pin @playwright/test in ops to the same version as the web workspace. The separate config selects test/debian/vps-smoke.spec.ts, one worker and the harness-provided baseURL; it has no webServer launcher and requires a ready disposable guest receipt. Invoke `pnpm --dir ops exec playwright test --config test/debian/playwright.config.ts`. It never loads the existing web e2e server/fake-worker config. All generated files stay in scratch, not C: or the repository. Pin the confirmed image/QEMU digests and do not execute the installer.

Consumes verified tool/image artifacts, source archive receipt and `InstallOptions`. Produces `createSeed(output: string, sshPublicKey: string): Promise<string>` through the PowerShell IMAPI adapter, `startSourceServer(root: string, port: number): Promise<{url: string; close(): Promise<void>}>` and `runGuestScenario(config: {sshPort: number; webPort: number; sourceUrl: string; sourceSha256: string; scratch: string}): Promise<ScenarioReceipt>`. ScenarioReceipt lists checks, versions, timings, resource peaks and sanitized log paths. The PowerShell entry accepts `-Scratch <absolute-E-or-G-path> -Source <tarball> -SourceSha256 <hex>` and rejects a C: destination.

Tests `hostPortsBindLoopbackOnly`, `seedContainsNoPasswords`, `sourceServerCannotEscapeRoot`, `toolChecksumMismatchRefused`, `windowsNoAdminNoWsl` and `requiredGuestChecksCannotSkip`. Run `U ops/test/debian/harness.test.ts`; then `powershell.exe -NoProfile -File ops/test/debian/vm-windows.ps1 -Scratch E:/mellodifai/tmp/debian-d1/vm -Source <tarball> -SourceSha256 <digest>`. Pass only when ScenarioReceipt records every required check as executed and passed. On timeout or failure, identify the phase and mark the run unsuccessful. A skipped required check fails. Dependencies: 15-17. Shared guest assertions and browser/rollback checks are implemented in this task before running either host harness.

### 19. Run the same scenario in Linux CI and enforce release gates (Linux plus Windows regression)

Files: Create `ops/test/debian/vm-linux.sh` and `.github/workflows/debian-native.yml`. Modify `ops/test/debian/scenario.ts` and `.github/workflows/ci.yml` to require both platforms' results. Consume the guest assertions, browser config and rollback checks already created in Task 18. The Linux runner has sufficient host RAM/CPU/disk and exposes KVM or reports TCG use.

Consumes the same source tarball, manifest image, cloud-init seed data and ScenarioReceipt contract. Produces a required CI result for fresh install, DB tests, Playwright, CPU media, isolation, backup/restore, reboot, second-run upgrade and cold rollback. `runGuestChecks(root: string, phase: 'fresh' | 'restored' | 'rebooted' | 'upgraded' | 'rolled-back'): Promise<CheckResult[]>` uses the same assertions on Windows-hosted and Linux-hosted guests. A required check returning skipped is an error. Public ACME staging uses a configured test domain; local CA testing is labelled separately.

Commands: `shellcheck install.sh ops/native/install-debian.sh ops/native/lease-linux.sh ops/test/debian/vm-linux.sh`; `shfmt -d` on those files; `pnpm test:debian:vm`; guest `pnpm test:db` against the separate e2e root; `pnpm --dir ops exec playwright test --config test/debian/playwright.config.ts`; required native integrations through I; unchanged Windows lab `pnpm test`, `pnpm test:db`, `pnpm test:native` and `pnpm test:integration` with at most four workers and the DB/native suites' single worker. Run every integration deferred by Tasks 3-17, including all three credential rotations, persistent journal readback, declaration failures and portable legacy bundle fixtures. Expected all checks executed and passed, no secret canaries, stable identities after second install and clean PostgreSQL shutdown across reboot. Include existing Windows build, T and lint. These are implementation/release checks for disposable VMs and the isolated Windows lab; do not execute them during D1 or D2 design review.

Dependencies: 18 and all preceding implementation tasks. Publish measured budgets and unresolved inherited run7 findings in the release report. Release remains blocked on missing dependency integrity, failed Linux/Windows gates or unresolved security/data-safety blockers. Independent EGM review of this specification precedes implementation; its result must not be inferred from these planned tests.
