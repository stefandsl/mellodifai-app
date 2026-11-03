import { createHash, randomUUID } from "node:crypto";
import type { TransactionSql } from "postgres";
import { expect } from "vitest";
import { ownerSql } from "./pg";

export const hash = (value: string) =>
  createHash("sha256").update(value).digest("hex");
export const resource = "http://127.0.0.1:3212/api/mcp";
export async function fixture(work: (tx: TransactionSql) => Promise<void>) {
  const sql = ownerSql();
  const rollback = new Error("rollback fixture");
  try {
    await sql
      .begin(async (tx) => {
        await tx`grant mdf_web, mdf_auth to postgres with set true`;
        await work(tx);
        throw rollback;
      })
      .catch((error: unknown) => {
        if (error !== rollback) throw error;
      });
  } finally {
    await sql.end();
  }
}
export async function actor(tx: TransactionSql, role = "admin") {
  const user_id = randomUUID();
  const session_id = randomUUID();
  const email = `${user_id}@example.test`;
  await tx`insert into public.admin_allowlist (email, role) values (${email}, ${role})`;
  await tx`insert into auth.users (id, email, email_confirmed_at) values (${user_id}, ${email}, now())`;
  await tx`insert into auth.sessions (id, user_id, created_at) values (${session_id}, ${user_id}, now())`;
  return { actor_kind: "session", user_id, session_id, remote: false };
}
export async function call(
  tx: TransactionSql,
  role: "mdf_web" | "mdf_auth",
  name: string,
  args: unknown[] = [],
) {
  try {
    return await tx.savepoint(async (sp) => {
      await sp.unsafe(`set local role ${role}`);
      const [row] = await sp.unsafe(
        `select ops.${name}(${args.map((_, i) => `$${i + 1}`).join(",")}) as result`,
        args as never[],
      );
      await sp`reset role`;
      return row.result;
    });
  } finally {
    await tx`reset role`;
  }
}
export async function pat(tx: TransactionSql, ctx: object, remote = false) {
  return call(tx, "mdf_web", "admin_token_create", [
    ctx,
    "Test PAT",
    hash("test-pat"),
    "mdf_pat_...test",
    ["read"],
    remote,
    false,
    remote ? new Date(Date.now() + 86400000) : null,
  ]);
}
export async function interaction(
  tx: TransactionSql,
  ctx: object,
  options: {
    uid?: string;
    client?: string;
    name?: string;
    redirects?: string[];
  } = {},
) {
  const uid = options.uid ?? randomUUID();
  const client = options.client ?? randomUUID();
  const nonce = `nonce-${uid}`;
  await call(tx, "mdf_web", "admin_flag_set", [ctx, "remote_mcp", true]);
  if (
    !(
      await tx`select 1 from public.oauth_store where model = 'Client' and id_hash = ${hash(client)}`
    ).length
  ) {
    await call(tx, "mdf_web", "admin_pairing_open", [ctx]);
    expect(
      await call(tx, "mdf_auth", "oauth_registration_claim", [
        client,
        options.name ?? "Client",
        options.redirects ?? ["https://example.test/callback"],
      ]),
    ).toBe(true);
  }
  await call(tx, "mdf_auth", "oauth_upsert", [
    "Interaction",
    hash(uid),
    {
      uid,
      params: {
        client_id: client,
        scope: "read create spend",
        redirect_uri: options.redirects?.[0] ?? "https://example.test/callback",
      },
    },
    null,
    uid,
    new Date(Date.now() + 600000),
  ]);
  await call(tx, "mdf_auth", "oauth_flow_nonce_set", [uid, hash(nonce)]);
  return { uid, client, nonce };
}
export async function grant(tx: TransactionSql, ctx: object) {
  const flow = await interaction(tx, ctx);
  const consent = await call(tx, "mdf_web", "oauth_consent", [
    ctx,
    flow.uid,
    flow.nonce,
    ["read", "create"],
    false,
  ]);
  expect(consent.ok).toBe(true);
  await call(tx, "mdf_auth", "oauth_interaction_result", [
    flow.uid,
    flow.nonce,
  ]);
  const grant_id = randomUUID();
  await call(tx, "mdf_auth", "oauth_bind_grant", [flow.uid, grant_id]);
  return { ...flow, grant_id, token_id: consent.data.token_id };
}
