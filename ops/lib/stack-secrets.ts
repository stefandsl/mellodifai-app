import {
  createPrivateKey,
  generateKeyPairSync,
  type JsonWebKey,
  randomUUID,
  sign,
} from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { ENV_TABLE, runtimePath, type StackEnv } from "./envs.js";
import { writePrivateOnce } from "./private-file.js";
import { randomPassword } from "./roles.js";

export interface StackSecrets {
  postgres: string;
  anon: string;
  service: string;
  jwt: string;
  realtime: string;
  crypto: string;
  dashboard: string;
  analytics: string;
}

export function signApiToken(role: string, key: JsonWebKey & { kid: string }) {
  const encode = (v: object) =>
    Buffer.from(JSON.stringify(v)).toString("base64url");
  const body = `${encode({ alg: "ES256", typ: "JWT", kid: key.kid })}.${encode({ role, iss: "supabase", iat: Math.floor(Date.now() / 1000), exp: Math.floor(Date.now() / 1000) + 10 * 365 * 86400 })}`;
  return `${body}.${sign("sha256", Buffer.from(body), { key: createPrivateKey({ key, format: "jwk" }), dsaEncoding: "ieee-p1363" }).toString("base64url")}`;
}

/** Bootstrap once, never rotate implicitly. Production live activation is Task 33. */
export async function loadStackSecrets(
  env: StackEnv,
  bootstrap = false,
): Promise<StackSecrets> {
  const keyPath = ENV_TABLE[env].signingKeysPath;
  const path = runtimePath(join(dirname(keyPath), "stack-secrets.json"));
  if (!existsSync(keyPath)) {
    if (existsSync(path))
      throw new Error(
        "Signing material is missing from an existing stack; restore the secret store",
      );
    if (!bootstrap) throw new Error("Missing stack signing material");
    const { privateKey } = generateKeyPairSync("ec", { namedCurve: "P-256" });
    await writePrivateOnce(
      keyPath,
      JSON.stringify([
        {
          ...privateKey.export({ format: "jwk" }),
          kid: randomUUID(),
          alg: "ES256",
          use: "sig",
          key_ops: ["sign", "verify"],
        },
      ]),
    );
  }
  if (!existsSync(path)) {
    if (!bootstrap) throw new Error("Render the stack before loading secrets");
    const jwt = randomPassword();
    await writePrivateOnce(
      path,
      JSON.stringify({
        postgres: randomPassword(),
        jwt,
        anon: signApiToken(
          "anon",
          JSON.parse(readFileSync(keyPath, "utf8"))[0],
        ),
        service: signApiToken(
          "service_role",
          JSON.parse(readFileSync(keyPath, "utf8"))[0],
        ),
        realtime: randomPassword(),
        crypto: randomPassword(),
        dashboard: randomPassword(),
        analytics: randomPassword(),
      }),
    );
  }
  const secrets = JSON.parse(readFileSync(path, "utf8")) as StackSecrets;
  if (env === "prod") {
    const dbFile = join(dirname(keyPath), "db-passwords.json");
    if (existsSync(dbFile))
      secrets.postgres = JSON.parse(readFileSync(dbFile, "utf8")).postgres;
    else if (!bootstrap)
      throw new Error(
        "Production database passwords require Task 8 provisioning",
      );
  }
  for (const value of Object.values(secrets))
    if (typeof value !== "string" || !value)
      throw new Error("Invalid stack secret store");
  return secrets;
}
