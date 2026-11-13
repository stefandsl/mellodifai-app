# Native Windows test gates

The e2e stack runs without Docker, WSL, Kong, Realtime or the Supabase CLI.
PostgREST, Auth, Storage and Mailpit run behind the native gateway. App updates
poll REST cursors. Mail tests read Mailpit's HTTP API at the exported MAILPIT_URL,
which stack.ts derives from ports.inbucket.

Use the isolated lab only. On the owner's PC, start in Git Bash:

```bash
cd E:/mellodifai/wt/native-runtime
source E:/mellodifai/tmp/native-a/env.sh
export npm_config_store_dir=E:/mellodifai/cache/pnpm
export WORKER_FAKE=1
export PLAYWRIGHT_BROWSERS_PATH=G:/caches/ms-playwright
export NEXT_TELEMETRY_DISABLED=1

pnpm install --frozen-lockfile
pnpm lint
pnpm typecheck
pnpm --filter @mellodifai/web exec tsc --noEmit
pnpm test

export E2E_PORT=3234 E2E_AUTH_PORT=3235 E2E_EDGE_PORT=3236
export E2E_SCREENSHOT_DIR=E:/mellodifai/tmp/run3/screens
pnpm ops stack.ts install --env e2e --runtime native
pnpm ops stack.ts start --env e2e --runtime native < /dev/null
set -a
source "$MELLODIFAI_ROOT/stacks/e2e/test.env"
set +a
pnpm test:db
pnpm ops rotate-auth-keys.ts --env e2e
pnpm e2e
pnpm ops stack.ts stop --env e2e --runtime native < /dev/null
```

Keep TEMP, TMP and TMPDIR on E: as set by env.sh. When collecting shell logs,
redirect directly to a file; never pipe a stack startup command. Never print the
test environment or private OAuth files. Always stop the lab, including after
a failed test. A stopped stack's status command returns 1 by design.

The API block remains 45620-45629. Browser, OAuth service and edge ports are
separate. Export the port overrides before starting the stack so Auth callbacks,
gateway CORS and the browser agree. The edge override also selects the OAuth
issuer and MCP audience. The historical defaults remain 3210/3211/3212 for other
installations; they must not be used for this lab. The application services and
fake workers are owned by Playwright and shut down with its run. The stack itself
is started and stopped only through stack.ts.

pnpm test runs workspace suites sequentially with at most four Vitest workers.
test:db explicitly uses one worker and a 30-second integration-test budget.
Native Windows backend creation measured 2.6-5.2 seconds per cold connection,
while queries on an open connection took about 1 ms. The database RPC helper
therefore reuses a bounded pool per file and closes it at teardown. Tests that
deliberately open independent clients still do so, including the 20-client cap
race. E2E refuses to start without WORKER_FAKE=1.
Worker unit fixtures register their mock handlers in both dispatch tables, so
WORKER_FAKE=1 can remain set throughout the gates. The legacy import check uses
temporary packs and real FFmpeg previews for all eleven languages; it no longer
needs TEST_LEGACY_FILES or the owner's media directories. Legacy preview output
uses the worker runtime temp directory, with an explicit test-directory override.
Playwright uses the exported mdf_web and mdf_auth connections, both checked against the
same isolated database. No worker configuration from the production stack is
needed. A working FFmpeg on PATH and the lockfile-compatible Playwright Chromium
are prerequisites. Screenshot output defaults to the runtime's test-results/screens
and can be redirected with E2E_SCREENSHOT_DIR. Credential-bearing traces stay off.

## CI

.github/workflows/ci.yml uses windows-latest, a non-C runtime root, the same
e2e environment, all seven gates, and unconditional native shutdown. It caches
only native download archives under a key containing the manifest.json hash;
installation verifies hashes and rebuilds Auth/Storage through the pinned recipes.
It does not use the local spike seed directory. Missing publisher downloads fail
with an explicit diagnostic rather than substituting an artifact.

All seven manifest publisher URLs answered HTTP 200 during Run 3. That availability
check is not a hosted CI execution or a new checksum verification of remote bodies.
FFmpeg is not yet a manifest artifact: the workflow requires it on PATH and fails
with a clear message if the runner lacks it, instead of downloading an unpinned
binary. Playwright installs its lockfile-selected Chromium from its publisher.
