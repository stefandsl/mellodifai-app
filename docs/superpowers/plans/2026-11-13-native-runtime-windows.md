# Native runtime on Windows: execution plan (2026-11-13)

**Why now:** on 2026-11-12 a Windows update left WSL hanging on every boot, so Docker Desktop and
production have been down since. On 2026-11-13 the owner decided: "redevelop without docker".

**Goal:** MellodifAI runs on the owner's Windows PC with no Docker and no WSL: database, sign-in,
files, web, worker, tests, deploy and backup.

**Reads first:** [design of 2026-11-08](../specs/2026-11-08-native-runtime-design.md),
[M8 plan of 2026-11-08](2026-11-08-native-runtime.md), and the spike report at
`E:/mellodifai/codex-streams/no-docker/spike-report.md` (spike files in
`E:/mellodifai/spikes/no-docker`). This document overrides those two where they differ.

## Rulings

1. **Windows x64 first.** macOS and Linux artifact matrices and the CI matrix are deferred. Shared
   modules stay free of Windows-only assumptions; Windows specifics live in one host module.
2. **Native is the target runtime.** `stack.ts ... --runtime native|docker`; `MELLODIFAI_RUNTIME`
   sets the default; with neither set, the default is `native`. The Docker path stays in the code,
   unchanged, for anyone who still has it.
3. **No Supabase Realtime service.** It would add an Erlang runtime, a compiled `wal2json` plugin
   and a logical replication slot that fills the disk when the service is down. The web app polls a
   cheap change cursor instead, with one code path for every runtime. The `supabase_realtime`
   publication still exists (migrations alter it); no slot is created and `wal_level` stays
   `replica`.
4. **Services:** PostgreSQL 17.11 (EDB binaries zip), PostgREST v16.5 (official Windows binary),
   Supabase Auth v2.197.0 (pinned source plus one committed listener patch, built once with a pinned
   Go toolchain), Supabase Storage v1.84.19 (pinned source run on a pinned Node; `fs-xattr`
   replaced by a small in-repo module, no edit of Storage's own files), a Node gateway in `ops/`
   in place of Kong, Mailpit for dev/e2e/ci mail. No Studio, pg-meta, imgproxy, edge runtime,
   analytics, vector or pooler.
5. **Storage metadata:** prefer sidecar files over NTFS alternate data streams when copy, move,
   delete and listing semantics can be kept, because sidecars survive zip backups and non-NTFS
   volumes. Whichever is chosen needs tests for write, read, copy, move, delete and restart.
6. **Extensions:** the 54 app migrations create none and call none of `pg_net`, `pg_cron`,
   `vault`, `pgsodium`. Bootstrap installs what EDB ships and the Supabase init scripts and service
   migrations need (`pgcrypto`, `uuid-ossp`, `pg_stat_statements` if required). Nothing is stubbed.
7. **Ports stay inside each environment's reserved block.** Public API = `ports.api`, Postgres =
   `ports.db`, Auth = `listeners.shadow`, PostgREST = `listeners.inspector`, Storage =
   `listeners.pooler`, Mailpit HTTP = `ports.inbucket`, Mailpit SMTP = `ports.analytics`. All bind
   127.0.0.1. Start refuses when a port is taken or inside a Windows excluded range.
8. **Artifacts:** a committed manifest pins URL, SHA-256, version and licence for every download.
   Install verifies the hash before extraction, extracts atomically into
   `<MELLODIFAI_ROOT>/cache/native/<service>/<version>/win32-x64`, and may seed from a local file
   whose hash matches (the spike folder has the archives). Routine start never downloads or builds.
9. **Data and secrets:** mutable data under `<MELLODIFAI_ROOT>/stacks/<env>/native`. The existing
   secret files, signing keys and role-password files are reused, so keys and logins survive the
   move. Role passwords are distinct and persist across restarts.
10. **Production move** is a separate, explicit, backup-first step after all gates are green on a
    private native stack. It needs a database dump of the old Docker volume.

## Streams

| Stream | Owns | Done when |
| --- | --- | --- |
| A services | `ops/lib/native/*` except `gateway.ts`, `ops/stack.ts`, `ops/lib/envs.ts`, `ops/test/native/*` except `gateway.test.ts`, `ops/native/` recipes and patches | `stack.ts start --env e2e --runtime native` on an isolated root brings up Postgres, Auth, PostgREST, Storage, Mailpit and the gateway; all app migrations apply; `pnpm test:db` passes against it; stop and second start are clean |
| B gateway | `ops/lib/native/gateway.ts`, `ops/native-gateway.ts`, `ops/test/native/gateway.test.ts` | unit tests cover every rule in the design's gateway paragraph |
| C live updates | `apps/web` only | no Realtime client use remains; the three consumers update by polling a change cursor; unit tests pass |
| D after A-C | e2e server, worker and web env wiring, `ops/services.ts` supervision, backup, restore, deploy, Docker-to-native move, installer | `pnpm e2e` passes on native; production runs native |

## Gateway interface (shared by A and B)

```ts
// ops/lib/native/gateway.ts
export interface GatewayConfig {
  host: "127.0.0.1";
  port: number;
  upstreams: { auth: string; rest: string; storage: string }; // e.g. "http://127.0.0.1:45620"
  keys: { anon: string; service: string }; // accepted apikey values
  appOrigins: string[]; // origins allowed by CORS on non-public routes
}
export function createGateway(config: GatewayConfig): import("node:http").Server;
```

`ops/native-gateway.ts` is the process entry: it reads the path of a private JSON config file from
`MDF_GATEWAY_CONFIG`, calls `createGateway` and listens. `/realtime/v1` answers 404.
