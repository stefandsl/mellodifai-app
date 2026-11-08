import { createHash } from "node:crypto";
import { type Adapter, type AdapterPayload, errors } from "oidc-provider";
import postgres from "postgres";
import redirects from "../redirect-allowlist.json" with { type: "json" };

const functions = {
  oauth_find: "$1, $2",
  oauth_find_by_uid: "$1",
  // OpsCall carries serialized JSON strings. Infer text so postgres.js does not
  // encode those strings a second time before PostgreSQL parses the JSON.
  oauth_upsert: "$1, $2, $3::text::jsonb, $4, $5, $6::timestamptz",
  oauth_consume: "$1, $2",
  oauth_destroy: "$1, $2",
  oauth_revoke_by_grant: "$1",
  oauth_registration_claim:
    "$1, $2, array(select jsonb_array_elements_text($3::text::jsonb))",
  oauth_flow_nonce_set: "$1, $2",
  oauth_interaction_result: "$1, $2",
  oauth_bind_grant: "$1, $2",
} as const;
export type OpsCall = (
  name: keyof typeof functions,
  args: (string | null)[],
) => Promise<unknown>;

export function connectOps(url: string) {
  const parsed = new URL(url);
  if (
    !["postgres:", "postgresql:"].includes(parsed.protocol) ||
    parsed.hostname !== "127.0.0.1" ||
    parsed.username !== "mdf_auth" ||
    parsed.search ||
    parsed.hash
  )
    throw new Error("Auth requires the loopback mdf_auth connection");
  const sql = postgres(url, {
    max: 5,
    connect_timeout: 10,
    onnotice: () => {},
  });
  const call: OpsCall = async (name, args) => {
    if (!Object.hasOwn(functions, name))
      throw new Error("Unknown auth storage function");
    const [row] = await sql.unsafe(
      `select ops.${name}(${functions[name]}) as result`,
      args,
    );
    return row?.result;
  };
  return { call, close: () => sql.end() };
}

export const digest = (id: string) =>
  createHash("sha256").update(id).digest("hex");

export function redirectAllowed(uri: string): boolean {
  if (redirects.includes(uri)) return true;
  // Match the raw host too: URL normalization accepts noncanonical loopback IPs.
  if (!/^http:\/\/(?:127\.0\.0\.1|localhost):[0-9]+\//u.test(uri)) return false;
  try {
    const url = new URL(uri);
    return (
      !url.username &&
      !url.password &&
      !url.hash &&
      !uri.includes("#") &&
      !/[\\\s]/u.test(uri)
    );
  } catch {
    return false;
  }
}

export class OpsAdapter implements Adapter {
  constructor(
    private readonly model: string,
    private readonly call: OpsCall,
  ) {}

  async upsert(id: string, payload: AdapterPayload, expiresIn?: number) {
    const { jti: _jti, ...safe } = payload;
    if (this.model === "Client") {
      if (
        !safe.redirect_uris?.length ||
        !safe.redirect_uris.every(redirectAllowed)
      )
        throw new errors.InvalidClientMetadata("redirect URI is not allowed");
      if (!safe.client_name?.trim())
        throw new errors.InvalidClientMetadata("client_name is required");
      safe.client_name = Array.from(safe.client_name).slice(0, 60).join("");
      // Registration management is disabled; every Client write is a new DCR.
      if (
        !(await this.call("oauth_registration_claim", [
          id,
          safe.client_name,
          JSON.stringify(safe.redirect_uris),
        ]))
      )
        throw new errors.InvalidRequest("pairing window is closed", 403);
    }
    const expires =
      expiresIn === undefined
        ? null
        : new Date(
            Math.min(
              Date.now() + expiresIn * 1000,
              typeof safe.exp === "number" ? safe.exp * 1000 : Infinity,
            ),
          ).toISOString();
    await this.call("oauth_upsert", [
      this.model,
      digest(id),
      JSON.stringify(safe),
      safe.grantId ?? null,
      this.model === "Interaction" ? id : (safe.uid ?? null),
      expires,
    ]);
  }

  async find(id: string): Promise<AdapterPayload | undefined> {
    const payload = (await this.call("oauth_find", [
      this.model,
      digest(id),
    ])) as AdapterPayload | null;
    // oidc-provider needs jti at hydration; it is never persisted.
    return payload ? { ...payload, jti: id } : undefined;
  }
  async findByUid(uid: string): Promise<AdapterPayload | undefined> {
    return (
      ((await this.call("oauth_find_by_uid", [
        uid,
      ])) as AdapterPayload | null) ?? undefined
    );
  }
  async findByUserCode() {
    return undefined;
  }
  async consume(id: string) {
    await this.call("oauth_consume", [this.model, digest(id)]);
  }
  async destroy(id: string) {
    await this.call("oauth_destroy", [this.model, digest(id)]);
  }
  async revokeByGrantId(id: string) {
    await this.call("oauth_revoke_by_grant", [id]);
  }
}
