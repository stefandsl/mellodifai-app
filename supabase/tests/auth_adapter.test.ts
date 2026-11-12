import { generateKeyPairSync, randomUUID } from "node:crypto";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { expect, it } from "vitest";
import { connectOps, digest, OpsAdapter } from "../../apps/auth/src/adapter";
import { createAuth } from "../../apps/auth/src/main";
import { assertTestWebStack } from "../../ops/test-db-guard";
import { ownerSql } from "./helpers/pg";

it("the real auth adapter registers once and round-trips JSON storage through mdf_auth", async () => {
  assertTestWebStack({
    ...process.env,
    MDF_WEB_DATABASE_URL: process.env.TEST_MDF_AUTH_URL,
  });
  const sql = ownerSql();
  const db = connectOps(process.env.TEST_MDF_AUTH_URL as string);
  const [original] = await sql`select * from public.oauth_pairing where id`;
  const name = `adapter-${randomUUID()}`;
  const interactionId = randomUUID();
  const { privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
  const app = createAuth({
    issuer: "http://127.0.0.1:3212/oauth",
    cookieKeys: ["test-cookie-key-with-at-least-32-characters"],
    jwks: {
      keys: [
        {
          ...privateKey.export({ format: "jwk" }),
          use: "sig",
          alg: "RS256",
          kid: "test",
        },
      ],
    },
    call: db.call,
  });
  const server = createServer(app.handler);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const register = () =>
    fetch(`${origin}/oauth/reg`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        client_name: name,
        redirect_uris: ["http://127.0.0.1:8765/cb"],
        token_endpoint_auth_method: "none",
        grant_types: ["authorization_code", "refresh_token"],
        response_types: ["code"],
      }),
    });
  try {
    await sql`update public.oauth_pairing set open_until=null where id`;
    const closed = await register();
    await closed.body?.cancel();
    expect(closed.status).toBe(403);
    await sql`update public.oauth_pairing set open_until=now()+interval '10 minutes' where id`;
    const results = await Promise.all([register(), register()]);
    await Promise.all(results.map((response) => response.body?.cancel()));
    expect(results.map((response) => response.status).sort()).toEqual([
      201, 403,
    ]);
    const [client] =
      await sql`select payload from public.oauth_store where model='Client' and payload->>'client_name'=${name}`;
    expect(client.payload.redirect_uris).toEqual(["http://127.0.0.1:8765/cb"]);
    expect(client.payload).not.toHaveProperty("jti");
    const adapter = new OpsAdapter("Interaction", db.call);
    await adapter.upsert(
      interactionId,
      {
        uid: interactionId,
        params: { client_id: client.payload.client_id, scope: "read" },
      },
      900,
    );
    expect(await adapter.find(interactionId)).toMatchObject({
      uid: interactionId,
      params: { scope: "read" },
    });
    await adapter.destroy(interactionId);
    expect(await adapter.find(interactionId)).toBeUndefined();
  } finally {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await db.close();
    await sql`delete from public.oauth_store where (model='Client' and payload->>'client_name'=${name}) or (model='Interaction' and id_hash=${digest(interactionId)})`;
    await sql`update public.oauth_pairing set ${sql(original)} where id`;
    await sql.end();
  }
}, 30_000);
