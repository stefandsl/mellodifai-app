import { generateKeyPairSync, randomBytes, randomUUID } from "node:crypto";
import { existsSync, readFileSync, renameSync, unlinkSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseEnv } from "node:util";
import { ENV_TABLE, runtimePath, type StackEnv } from "./lib/envs.js";
import { safeFailure } from "./lib/native/diagnostics.js";
import { resolveRuntime } from "./lib/native/layout.js";
import { withStackLease } from "./lib/native/lease.js";
import { databaseUrl } from "./lib/pg.js";
import { writePrivate } from "./lib/private-file.js";
import { readStackPasswords } from "./lib/roles.js";
import { type Runner, realRunner } from "./lib/run.js";
import { runtimeRoot } from "./lib/runtime.js";
import { serviceCommand } from "./lib/services.js";

export async function rotateAuthKeys(
  env: Exclude<StackEnv, "dev">,
  runner: Runner = realRunner,
) {
  if (resolveRuntime(undefined) === "native")
    return withStackLease(env, "rotation", () =>
      rotateAuthKeysLocked(env, runner),
    );
  return rotateAuthKeysLocked(env, runner);
}
async function rotateAuthKeysLocked(
  env: Exclude<StackEnv, "dev">,
  runner: Runner,
) {
  const root = runtimePath(
    env === "ci" ? (process.env.RUNNER_TEMP ?? "") : runtimeRoot(),
  );
  if (env === "prod") {
    const account = await runner("powershell.exe", [
      "-NoProfile",
      "-NonInteractive",
      "-Command",
      "$ErrorActionPreference='Stop'; Get-LocalUser -Name 'mdf-auth' | Out-Null",
    ]);
    if (account.code !== 0)
      throw new Error(
        "Owner action pending: provision mdf-auth and its runtime ACLs",
      );
  }
  const dir = runtimePath(
    join(root, "secrets/auth", env === "prod" ? "" : env),
  );
  const keyFile = runtimePath(join(dir, "jwks.json"));
  const envFile = runtimePath(
    env === "prod"
      ? join(root, "deploy/apps/auth/.env.local")
      : join(dir, "auth.env"),
  );
  const previous = new Map(
    [keyFile, envFile].map((file) => [
      file,
      existsSync(file) ? readFileSync(file, "utf8") : null,
    ]),
  );
  const passwords = await readStackPasswords(env);
  const existingEnv = previous.get(envFile) ?? "";
  const values = parseEnv(existingEnv);
  const oldKeys = previous.get(keyFile)
    ? JSON.parse(previous.get(keyFile) as string).keys
    : [];
  const oldCookies = values.MDF_AUTH_COOKIE_KEYS
    ? JSON.parse(values.MDF_AUTH_COOKIE_KEYS)
    : [];
  if (!Array.isArray(oldKeys) || !Array.isArray(oldCookies))
    throw new Error("Invalid prior auth key material");
  const { privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
  const jwks = {
    keys: [
      {
        ...privateKey.export({ format: "jwk" }),
        use: "sig",
        alg: "RS256",
        kid: randomUUID(),
      },
      ...oldKeys,
    ],
  };
  const updates = {
    HOST: "127.0.0.1",
    PORT: env === "prod" ? "3010" : "3211",
    MDF_AUTH_ISSUER: ENV_TABLE[env].issuer as string,
    MDF_AUTH_JWKS_PATH: keyFile,
    MDF_AUTH_COOKIE_KEYS: JSON.stringify([
      randomBytes(32).toString("base64url"),
      ...oldCookies,
    ]),
    MDF_AUTH_DATABASE_URL: databaseUrl(
      "mdf_auth",
      passwords.mdf_auth,
      ENV_TABLE[env].ports.db,
    ),
  };
  const lines = existingEnv
    .split(/\r?\n/u)
    .filter(
      (line) =>
        !Object.keys(updates).some((name) =>
          new RegExp(`^\\s*(?:export\\s+)?${name}\\s*=`).test(line),
        ),
    );
  while (lines.at(-1) === "") lines.pop();
  for (const [name, value] of Object.entries(updates)) {
    if (/['\r\n\0]/u.test(value))
      throw new Error("Invalid auth environment value");
    lines.push(`${name}='${value}'`);
  }
  const publish = async (file: string, content: string) => {
    const temp = `${file}.${randomUUID()}.tmp`;
    try {
      // A fresh file avoids retaining any old explicit ACL entries.
      await writePrivate(temp, content);
      if (env === "prod") {
        const grant = await runner("icacls", [temp, "/grant:r", "mdf-auth:R"]);
        if (grant.code !== 0)
          throw new Error("Cannot grant mdf-auth read access");
      }
      renameSync(temp, file);
    } finally {
      if (existsSync(temp)) unlinkSync(temp);
    }
  };
  const restart = env === "prod" && previous.get(keyFile) !== null;
  const serviceRunner: Runner = (cmd, args, options) =>
    runner(cmd, args, {
      ...options,
      env: {
        ...options?.env,
        TEMP: join(root, "tmp"),
        TMP: join(root, "tmp"),
        TMPDIR: join(root, "tmp"),
        npm_config_cache: join(root, "cache/npm"),
        npm_config_store_dir: join(root, "cache/pnpm"),
      },
    });
  if (restart) await serviceCommand(serviceRunner, "stop", "auth", root);
  try {
    await publish(keyFile, JSON.stringify(jwks));
    await publish(envFile, `${lines.join("\n")}\n`);
    if (restart) await serviceCommand(serviceRunner, "start", "auth", root);
  } catch {
    if (restart) await serviceCommand(serviceRunner, "stop", "auth", root);
    for (const [file, content] of previous) {
      if (content !== null) await publish(file, content);
      else if (existsSync(file)) unlinkSync(file);
    }
    if (restart) await serviceCommand(serviceRunner, "start", "auth", root);
    throw new Error("Auth provisioning failed; previous material restored");
  }
  return { keyFile, envFile };
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  const args = process.argv.slice(2);
  const env = args[1];
  if (
    args.length !== 2 ||
    args[0] !== "--env" ||
    !["prod", "e2e", "ci"].includes(env ?? "")
  ) {
    process.stderr.write(
      "Usage: pnpm ops rotate-auth-keys.ts --env prod|e2e|ci\n",
    );
    process.exitCode = 1;
  } else {
    rotateAuthKeys(env as Exclude<StackEnv, "dev">)
      .then(() => {
        process.stdout.write(
          "Auth material provisioned. Start initial services with the private environment file.\n",
        );
      })
      .catch((error: unknown) => {
        process.stderr.write(`${safeFailure(error)}\n`);
        process.stderr.write(
          "Auth provisioning failed; verify service account, private environment access and service health\n",
        );
        process.exitCode = 1;
      });
  }
}
