# Pinned Supabase Compose inputs

Public upstream inputs from Supabase commit
`3dd097c78804b672e5f2c1fb954ede0bbf727620`, `docker/`.
See LICENSE. The baseline YAML is input only, never executed directly.
`lib/compose.ts` pins the images, removes unused services and host listeners,
and renders an external workdir. Credentials are supplied through the process
environment from the private external secret store.

Vector is disabled because the spike found its Docker log endpoint unavailable.
Analytics is available without Docker log ingestion. Image transformations and
the pooler are disabled as in the verified spike. Email templates are served on
the private Compose network when configured in the repository TOML.

The functions gateway's verifier is adapted to the ES256 public JWKS. Auth's
private JWK is supplied only to Auth. REST, Storage, Realtime and Functions
receive public verification keys. API anon/service tokens use ES256 as well.

## Operations

Run `pnpm -s ops stack.ts render --env e2e`, then `start`, `migrate`, `stop`,
`reset` or `env-file` with the same `--env`. `env-file` prints only its path;
source its shell-quoted contents without echoing them. Production cannot export
a test env file. Production reset aliases and `stop --no-backup` are refused.
Every migration command uses the pinned CLI and external `--workdir`.

All runtime files live under `MELLODIFAI_ROOT` (default `E:/mellodifai`), or
`RUNNER_TEMP` for CI. Set TEMP/TMP and npm_config_cache off C: too. CI execution
requires `CI=true`. Do not start the CI port block on a developer PC.

The external secret directory beside `signing_keys.json` holds
`stack-secrets.json` (JWT secret, API tokens and service credentials). Dev/e2e
role passwords are stable in `stacks/<env>/role-passwords.json`; CI persists
them for its job in `RUNNER_TEMP/stack`. The separate `login-passwords.json`
records all enumerated logins. Active Compose services share POSTGRES_PASSWORD
as verified by Spike 2; unused logins receive independent random passwords.
Tests provision and probe them on each start/migrate. Production instead requires
Task 8's `secrets/supabase/db-passwords.json`, and Tasks 8/10's production probes.
The production active service passwords must follow the same Compose shared
password contract. Owner SMTP and production cutover remain pending owner work.

Startup creates the empty postgres-owned `ops` namespace because Task 5 exposes
it and PostgREST refuses its entire schema cache if it is absent. Task 14 still
owns all ops functions, grants, tables and `stack_settings.fake_stack`.

For the accepted port-conflict ruling, start e2e with `E2E_PORT=3219` to allow
that local browser callback in addition to the canonical 3210/3212 URLs.
Production is never affected by this override.

Load the generated private `test.env` and run role integration fixtures with
`pnpm test:integration` (or append `ops/test/roles.integration.test.ts`).
The fixture guard rejects production ports outside isolated CI. All cluster
role fixture changes roll back, including temporary renaming of existing roles.

CI pulls the exact image digests in `ci-image-mirrors.json` through
`ops/pull-ci-images.ts`, then tags them with the rendered ECR names. The map was
verified against the installed pinned images and their upstream registry
manifests. This avoids anonymous public ECR throttling without changing image
contents. A changed pin fails closed until its immutable mirror is verified.
