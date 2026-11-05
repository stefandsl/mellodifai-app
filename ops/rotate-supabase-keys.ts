import { type JsonWebKey, randomUUID } from "node:crypto";
import {
  accessSync,
  constants,
  existsSync,
  mkdirSync,
  readFileSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parse } from "smol-toml";
import { composeEnvironment } from "./lib/compose.js";
import { ENV_TABLE, runtimePath, stackDir } from "./lib/envs.js";
import { writePrivate } from "./lib/private-file.js";
import { checked } from "./lib/recovery.js";
import { randomPassword } from "./lib/roles.js";
import { type Runner, realRunner } from "./lib/run.js";
import { runtimeRoot } from "./lib/runtime.js";
import { serviceCommand } from "./lib/services.js";
import { loadStackSecrets, signApiToken } from "./lib/stack-secrets.js";
import { planStackCommand } from "./stack.js";

function replaceEnvValue(file: string, name: string, value: string) {
  if (/[\r\n\0]/u.test(value))
    throw new Error("Invalid application credential");
  const lines = readFileSync(file, "utf8")
    .split(/\r?\n/u)
    .filter(
      (line) => !new RegExp(`^\\s*(?:export\\s+)?${name}\\s*=`).test(line),
    );
  while (lines.at(-1) === "") lines.pop();
  // Preserve the installed service account's read ACL.
  writeFileSync(file, `${[...lines, `${name}=${value}`].join("\n")}\n`);
}

/** Rotate the provisioned Compose stack; failed activation restores the old credentials. */
export async function rotateSupabaseKeys(
  runner: Runner = realRunner,
): Promise<void> {
  const root = runtimePath(runtimeRoot());
  const dir = stackDir("prod");
  const keyFile = ENV_TABLE.prod.signingKeysPath;
  const secretDir = dirname(keyFile);
  const storeFile = join(secretDir, "stack-secrets.json");
  const jwtFile = join(secretDir, "jwt-secret");
  const deploy = join(root, "deploy");
  const webFile = runtimePath(join(deploy, "apps/web/.env.local"));
  const workerFile = runtimePath(join(deploy, "apps/worker/.env.local"));
  // Do not rotate around an unresolved owner ACL/provisioning action.
  try {
    for (const file of [webFile, workerFile]) {
      accessSync(file, constants.R_OK | constants.W_OK);
      if (!readFileSync(file, "utf8").trim())
        throw new Error("Empty environment");
    }
  } catch {
    throw new Error(
      "Canonical application environment files need owner provisioning and read/write access",
    );
  }
  if (
    !existsSync(join(dir, "compose.json")) ||
    !existsSync(keyFile) ||
    !existsSync(storeFile)
  )
    throw new Error(
      "Production stack and signing material must be provisioned first",
    );
  const config = parse(readFileSync(join(dir, "supabase/config.toml"), "utf8"));
  const auth = config.auth as {
    signing_keys_path?: string;
    jwt_secret?: string;
  };
  if (
    config.project_id !== ENV_TABLE.prod.projectId ||
    !auth?.signing_keys_path ||
    resolve(auth.signing_keys_path) !== resolve(keyFile) ||
    auth.jwt_secret !== "env(MDF_SUPABASE_JWT_SECRET)"
  )
    throw new Error(
      "Production config must reference the external signing key and JWT environment",
    );
  await loadStackSecrets("prod");
  const temp = runtimePath(join(root, "tmp"));
  mkdirSync(temp, { recursive: true });
  const childEnv = {
    TEMP: temp,
    TMP: temp,
    TMPDIR: temp,
    npm_config_cache: runtimePath(join(root, "cache/npm")),
    npm_config_store_dir: runtimePath(join(root, "cache/pnpm")),
  };
  const previous = new Map<string, string>();
  for (const file of [keyFile, storeFile, webFile, workerFile])
    previous.set(file, readFileSync(file, "utf8"));
  if (existsSync(jwtFile)) previous.set(jwtFile, readFileSync(jwtFile, "utf8"));
  const backup = join(secretDir, `rotation-${randomUUID()}.backup`);
  await writePrivate(backup, JSON.stringify(Object.fromEntries(previous)));
  const restartStack = async () => {
    const secrets = await loadStackSecrets("prod");
    const env = { ...childEnv, ...composeEnvironment("prod", secrets) };
    for (const [cmd, ...args] of planStackCommand("start", "prod", {})) {
      if (!cmd) throw new Error("Missing stack command");
      await checked(runner, cmd, args, { env });
    }
    // Kong restarts before its upstream DNS is ready; check the actual credential path.
    for (let attempt = 0; attempt < 30; attempt++) {
      try {
        const response = await fetch(
          `http://127.0.0.1:${ENV_TABLE.prod.ports.api}/auth/v1/admin/users?page=1&per_page=1`,
          {
            headers: {
              apikey: secrets.service,
              Authorization: `Bearer ${secrets.service}`,
            },
            signal: AbortSignal.timeout(5000),
          },
        );
        await response.body?.cancel();
        if (response.status === 200) return;
      } catch {
        /* Readiness retries do not expose response bodies or credentials. */
      }
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
    throw new Error("Rotated stack API readiness failed");
  };
  const build = async () =>
    checked(
      runner,
      "powershell.exe",
      [
        "-NoProfile",
        "-NonInteractive",
        "-Command",
        "pnpm --filter @mellodifai/web build",
      ],
      {
        cwd: deploy,
        env: {
          ...childEnv,
          NEXT_PUBLIC_SUPABASE_ANON_KEY: (await loadStackSecrets("prod")).anon,
        },
      },
    );
  let buildAttempted = false;
  let stackAttempted = false;
  let preserveBackup = false;
  try {
    await serviceCommand(runner, "stop", "worker", root);
    await serviceCommand(runner, "stop", "web", root);
    const cli = createRequire(import.meta.url).resolve(
      "supabase/dist/supabase.js",
    );
    await checked(
      runner,
      process.execPath,
      [cli, "gen", "signing-key", "--algorithm", "ES256", "--workdir", dir],
      { env: childEnv },
    );
    // CLI writes directly to the configured external path; output stays captured.
    const keys = JSON.parse(readFileSync(keyFile, "utf8")) as Array<
      JsonWebKey & { kid: string; alg: string }
    >;
    if (
      keys.length !== 1 ||
      keys[0]?.alg !== "ES256" ||
      !keys[0].kid ||
      !keys[0].d ||
      readFileSync(keyFile, "utf8") === previous.get(keyFile)
    )
      throw new Error("Supabase did not write a new ES256 signing key");
    await writePrivate(keyFile, JSON.stringify(keys));
    const secrets = await loadStackSecrets("prod");
    const rotated = {
      ...secrets,
      jwt: randomPassword(),
      anon: signApiToken("anon", keys[0]),
      service: signApiToken("service_role", keys[0]),
    };
    await writePrivate(jwtFile, rotated.jwt);
    await writePrivate(storeFile, JSON.stringify(rotated));
    stackAttempted = true;
    await restartStack();
    // Accepted Spike 2 status equivalent for the pinned Compose backend.
    const status = await loadStackSecrets("prod");
    replaceEnvValue(webFile, "NEXT_PUBLIC_SUPABASE_ANON_KEY", status.anon);
    replaceEnvValue(workerFile, "SUPABASE_SERVICE_ROLE_KEY", status.service);
    buildAttempted = true;
    await build();
    await serviceCommand(runner, "start", "worker", root);
    await serviceCommand(runner, "start", "web", root);
  } catch {
    try {
      await serviceCommand(runner, "stop", "worker", root);
      await serviceCommand(runner, "stop", "web", root);
      for (const [file, content] of previous) {
        if (file === webFile || file === workerFile)
          writeFileSync(file, content);
        else await writePrivate(file, content);
      }
      if (!previous.has(jwtFile) && existsSync(jwtFile)) unlinkSync(jwtFile);
      if (stackAttempted) await restartStack();
      if (buildAttempted) await build();
      await serviceCommand(runner, "start", "worker", root);
      await serviceCommand(runner, "start", "web", root);
    } catch {
      preserveBackup = true;
      throw new Error(
        `Rotation and recovery failed; restore private backup at ${backup}`,
      );
    }
    throw new Error(
      "Supabase rotation failed; previous credentials and services restored",
    );
  } finally {
    if (!preserveBackup) unlinkSync(backup);
  }
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
)
  rotateSupabaseKeys().catch(() => {
    process.stderr.write(
      "Supabase rotation failed; verify canonical env access, service health and private rotation backups\n",
    );
    process.exitCode = 1;
  });
