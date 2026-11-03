import { randomUUID } from "node:crypto";
import { expect, it } from "vitest";
import {
  actor,
  call,
  fixture,
  grant,
  hash,
  interaction,
  resource,
} from "./helpers/token-fixture";

it("oauth_upsert accepts AccessToken only through grant -> agent_tokens -> used consent with same client and subset scopes (Major 12)", async () => {
  await fixture(async (tx) => {
    const ctx = await actor(tx);
    const g = await grant(tx, ctx);
    const payload = {
      clientId: g.client,
      scope: "read",
      aud: resource,
      grantId: g.grant_id,
      jti: "must-not-be-stored",
    };
    const upsert = (value: object, grantId = g.grant_id) =>
      call(tx, "mdf_auth", "oauth_upsert", [
        "AccessToken",
        hash("access"),
        value,
        grantId,
        null,
        new Date(Date.now() + 3500000),
      ]);
    await upsert(payload);
    const found = await call(tx, "mdf_auth", "oauth_find", [
      "AccessToken",
      hash("access"),
    ]);
    expect(found).not.toHaveProperty("jti");
    expect(found.scope).toBe("read");
    expect(
      await call(tx, "mdf_web", "resolve_access_token", [
        hash("access"),
        resource,
      ]),
    ).toMatchObject({
      user_id: ctx.user_id,
      token_id: g.token_id,
      scopes: ["read"],
      test_mode: false,
    });
    expect(
      await call(tx, "mdf_web", "idem_begin", [
        { actor_kind: "oauth", access_token_hash: hash("access"), resource },
        "oauth-key",
        "hash",
      ]),
    ).toMatchObject({ ok: true });
    for (const bad of [
      { ...payload, clientId: "other" },
      { ...payload, scope: "spend" },
      { ...payload, grantId: "other" },
    ])
      await expect(upsert(bad)).rejects.toMatchObject({ code: "MDF03" });
    await expect(upsert(payload, "unknown")).rejects.toMatchObject({
      code: "MDF03",
    });
    await tx`update public.agent_tokens set scopes = array['create'] where id = ${g.token_id}`;
    expect(
      await call(tx, "mdf_web", "resolve_access_token", [
        hash("access"),
        resource,
      ]),
    ).toMatchObject({ scopes: [] });
    await tx`update public.profiles set role = 'customer' where id = ${ctx.user_id}`;
    await expect(
      call(tx, "mdf_web", "resolve_access_token", [hash("access"), resource]),
    ).rejects.toMatchObject({ message: "admin required" });
  });
});
it("oauth_upsert refuses a grant without a used consent and a lifetime over the limit (MDF03)", async () => {
  await fixture(async (tx) => {
    const ctx = await actor(tx);
    const g = await grant(tx, ctx);
    for (const [model, seconds] of [
      ["AccessToken", 3600],
      ["RefreshToken", 2592000],
      ["AuthorizationCode", 600],
    ] as const) {
      const args = [
        model,
        hash(model),
        { clientId: g.client, scope: "read" },
        g.grant_id,
        null,
      ];
      await expect(
        call(tx, "mdf_auth", "oauth_upsert", [
          ...args,
          new Date(Date.now() + (seconds + 60) * 1000),
        ]),
      ).rejects.toMatchObject({ code: "MDF03" });
      await call(tx, "mdf_auth", "oauth_upsert", [
        ...args,
        new Date(Date.now() + (seconds - 10) * 1000),
      ]);
    }
    await tx`update public.oauth_consents set used_at = null where uid = ${g.uid}`;
    await expect(
      call(tx, "mdf_auth", "oauth_upsert", [
        "AccessToken",
        hash("unused"),
        { clientId: g.client, scope: "read" },
        g.grant_id,
        null,
        new Date(Date.now() + 60000),
      ]),
    ).rejects.toMatchObject({ code: "MDF03" });
  });
});
it("oauth_flow_nonce_set stores the hash on an existing Interaction row only (Major 13)", async () => {
  await fixture(async (tx) => {
    await expect(
      call(tx, "mdf_auth", "oauth_flow_nonce_set", ["missing", hash("nonce")]),
    ).rejects.toMatchObject({ code: "MDF03" });
    const ctx = await actor(tx);
    const flow = await interaction(tx, ctx);
    expect(
      await tx`select flow_nonce_hash from public.oauth_store where uid = ${flow.uid}`,
    ).toEqual([{ flow_nonce_hash: hash(flow.nonce) }]);
    await expect(
      call(tx, "mdf_auth", "oauth_flow_nonce_set", [
        flow.uid,
        hash("replacement"),
      ]),
    ).rejects.toMatchObject({ code: "MDF03" });
  });
});
it("oauth_interaction_result is single use and needs the matching nonce", async () => {
  await fixture(async (tx) => {
    const ctx = await actor(tx);
    const f = await interaction(tx, ctx);
    expect(
      await call(tx, "mdf_web", "oauth_consent_info", [ctx, f.uid, "wrong"]),
    ).toMatchObject({ code: "unauthorized" });
    expect(
      await call(tx, "mdf_web", "oauth_consent", [
        ctx,
        f.uid,
        f.nonce,
        ["read"],
        true,
      ]),
    ).toMatchObject({ ok: true });
    await expect(
      call(tx, "mdf_auth", "oauth_bind_grant", [f.uid, randomUUID()]),
    ).rejects.toMatchObject({ code: "MDF03" });
    await expect(
      call(tx, "mdf_auth", "oauth_interaction_result", [f.uid, "wrong"]),
    ).rejects.toMatchObject({ code: "MDF03" });
    expect(
      await call(tx, "mdf_auth", "oauth_interaction_result", [f.uid, f.nonce]),
    ).toMatchObject({
      user_id: ctx.user_id,
      scopes: ["read"],
      test_mode: true,
    });
    await expect(
      call(tx, "mdf_auth", "oauth_interaction_result", [f.uid, f.nonce]),
    ).rejects.toMatchObject({ code: "MDF03" });
    await call(tx, "mdf_auth", "oauth_bind_grant", [f.uid, "first-grant"]);
    await expect(
      call(tx, "mdf_auth", "oauth_bind_grant", [f.uid, "replacement"]),
    ).rejects.toMatchObject({ code: "MDF03" });
  });
});
it("registration_claim succeeds once per window and closes it (Major 27)", async () => {
  await fixture(async (tx) => {
    const ctx = await actor(tx);
    await call(tx, "mdf_web", "admin_pairing_open", [ctx]);
    expect(
      await call(tx, "mdf_auth", "oauth_registration_claim", [
        "first",
        "First",
        ["https://example.test/callback"],
      ]),
    ).toBe(true);
    expect(
      await call(tx, "mdf_auth", "oauth_registration_claim", [
        "second",
        "Second",
        ["https://example.test/callback"],
      ]),
    ).toBe(false);
    expect(
      await call(tx, "mdf_web", "admin_pairing_status", [ctx]),
    ).toMatchObject({
      ok: true,
      data: {
        client_id: "first",
        client_name: "First",
        redirect_host: "example.test",
      },
    });
  });
});
it.each(["localhost", "LOCALHOST", "127.0.0.1"])(
  "a loopback-only client consent is refused when remote is true (Major 27): %s",
  async (host) => {
    await fixture(async (tx) => {
      const ctx = await actor(tx);
      const f = await interaction(tx, ctx, {
        redirects: [`http://${host}:3456/callback`],
      });
      expect(
        await call(tx, "mdf_web", "oauth_consent", [
          { ...ctx, remote: true },
          f.uid,
          f.nonce,
          ["read"],
          false,
        ]),
      ).toMatchObject({ code: "forbidden_scope" });
      expect(
        await call(tx, "mdf_web", "oauth_consent", [
          ctx,
          f.uid,
          f.nonce,
          ["read"],
          false,
        ]),
      ).toMatchObject({ ok: true });
    });
  },
);
it("consent for the same client revokes the expired grant and the abandoned unbound row first (Major 14)", async () => {
  await fixture(async (tx) => {
    const ctx = await actor(tx);
    const g = await grant(tx, ctx);
    await tx`update public.agent_tokens set expires_at = now() - interval '1 day' where id = ${g.token_id}`;
    await tx`insert into public.oauth_store (model, id_hash, payload, grant_id) values ('Grant', ${hash("old")}, '{}', ${g.grant_id})`;
    for (let i = 0; i < 2; i++) {
      const f = await interaction(tx, ctx, { client: g.client });
      expect(
        await call(tx, "mdf_web", "oauth_consent", [
          ctx,
          f.uid,
          f.nonce,
          ["read"],
          false,
        ]),
      ).toMatchObject({ ok: true });
    }
    expect(
      await tx`select 1 from public.oauth_store where grant_id = ${g.grant_id}`,
    ).toEqual([]);
    expect(
      await tx`select 1 from public.agent_tokens where owner_id = ${ctx.user_id} and revoked_at is null`,
    ).toHaveLength(1);
    expect(
      await tx`select 1 from public.agent_tokens where owner_id = ${ctx.user_id} and revoked_at is not null`,
    ).toHaveLength(2);
  });
});
it("long and markup client names are truncated to 60 characters and stored (Nit 19, Review Focus 5)", async () => {
  await fixture(async (tx) => {
    const ctx = await actor(tx);
    const name = `<b>${"🎵".repeat(200)}</b>`;
    const expected = Array.from(name).slice(0, 60).join("");
    const f = await interaction(tx, ctx, { name });
    expect(
      await call(tx, "mdf_web", "oauth_consent_info", [ctx, f.uid, f.nonce]),
    ).toMatchObject({
      ok: true,
      data: {
        client_name: expected,
        client_id: f.client,
        requested_scopes: ["read", "create", "spend"],
      },
    });
    await call(tx, "mdf_web", "oauth_consent", [
      ctx,
      f.uid,
      f.nonce,
      ["read"],
      false,
    ]);
    expect(
      await tx`select name from public.agent_tokens where oauth_client_id = ${f.client}`,
    ).toEqual([{ name: expected }]);
    expect(
      await tx`select "limit", period from public.spend_caps where key in (select id::text from public.agent_tokens where oauth_client_id = ${f.client})`,
    ).toEqual([{ limit: "1.0000", period: "day" }]);
  });
});
it("revoke deletes the grant's oauth_store rows; resolve_access_token then returns unauthorized", async () => {
  await fixture(async (tx) => {
    const ctx = await actor(tx);
    const g = await grant(tx, ctx);
    await call(tx, "mdf_auth", "oauth_upsert", [
      "Grant",
      hash(g.grant_id),
      { clientId: g.client, jti: g.grant_id },
      null,
      null,
      null,
    ]);
    await call(tx, "mdf_auth", "oauth_upsert", [
      "AccessToken",
      hash("access"),
      { clientId: g.client, scope: "read", aud: resource },
      g.grant_id,
      null,
      new Date(Date.now() + 60000),
    ]);
    expect(
      await call(tx, "mdf_web", "admin_token_revoke", [ctx, g.token_id]),
    ).toMatchObject({ ok: true });
    expect(
      await tx`select 1 from public.oauth_store where grant_id = ${g.grant_id}`,
    ).toEqual([]);
    expect(
      await call(tx, "mdf_auth", "oauth_find", ["Grant", hash(g.grant_id)]),
    ).toBeNull();
    await expect(
      call(tx, "mdf_web", "resolve_access_token", [hash("access"), resource]),
    ).rejects.toMatchObject({ code: "MDF03" });
  });
});
it("remote_mcp off makes resolve_access_token and oauth_consent fail", async () => {
  await fixture(async (tx) => {
    const ctx = await actor(tx);
    const g = await grant(tx, ctx);
    await call(tx, "mdf_auth", "oauth_upsert", [
      "AccessToken",
      hash("access"),
      { clientId: g.client, scope: "read", aud: resource },
      g.grant_id,
      null,
      new Date(Date.now() + 60000),
    ]);
    const f = await interaction(tx, ctx);
    await call(tx, "mdf_web", "admin_flag_set", [ctx, "remote_mcp", false]);
    await expect(
      call(tx, "mdf_web", "resolve_access_token", [hash("access"), resource]),
    ).rejects.toMatchObject({ code: "MDF03" });
    expect(
      await call(tx, "mdf_web", "oauth_consent", [
        ctx,
        f.uid,
        f.nonce,
        ["read"],
        false,
      ]),
    ).toMatchObject({ code: "forbidden_scope" });
  });
});
it("storage expiry, consume, destroy and grant revocation fail closed", async () => {
  await fixture(async (tx) => {
    const ctx = await actor(tx);
    const g = await grant(tx, ctx);
    await call(tx, "mdf_auth", "oauth_upsert", [
      "AccessToken",
      hash("access"),
      { clientId: g.client, scope: "read", aud: resource },
      g.grant_id,
      null,
      new Date(Date.now() + 60000),
    ]);
    await expect(
      call(tx, "mdf_web", "resolve_access_token", [
        hash("access"),
        "wrong-resource",
      ]),
    ).rejects.toMatchObject({ code: "MDF03" });
    await call(tx, "mdf_auth", "oauth_consume", [
      "AccessToken",
      hash("access"),
    ]);
    expect(
      await call(tx, "mdf_auth", "oauth_find", ["AccessToken", hash("access")]),
    ).toHaveProperty("consumed");
    await expect(
      call(tx, "mdf_web", "resolve_access_token", [hash("access"), resource]),
    ).rejects.toMatchObject({ code: "MDF03" });
    await call(tx, "mdf_auth", "oauth_destroy", [
      "AccessToken",
      hash("access"),
    ]);
    expect(
      await call(tx, "mdf_auth", "oauth_find", ["AccessToken", hash("access")]),
    ).toBeNull();
    await call(tx, "mdf_auth", "oauth_revoke_by_grant", [g.grant_id]);
    expect(
      await tx`select 1 from public.agent_tokens where id = ${g.token_id} and revoked_at is null`,
    ).toEqual([]);
    await tx`update public.oauth_store set expires_at = now() - interval '1 second' where uid = ${g.uid}`;
    expect(await call(tx, "mdf_auth", "oauth_find_by_uid", [g.uid])).toBeNull();
  });
});

it("registered client provenance survives another pairing and cannot be replaced by the adapter", async () => {
  await fixture(async (tx) => {
    const ctx = await actor(tx);
    const first = await interaction(tx, ctx, { name: "First client" });
    await interaction(tx, ctx, { name: "Second client" });
    const client = await call(tx, "mdf_auth", "oauth_find", [
      "Client",
      hash(first.client),
    ]);
    expect(client).not.toHaveProperty("_mdf_registration");
    await call(tx, "mdf_auth", "oauth_upsert", [
      "Client",
      hash(first.client),
      {
        ...client,
        client_name: "Forged",
        _mdf_registration: { loopback_only: false },
      },
      null,
      null,
      null,
    ]);
    expect(
      await call(tx, "mdf_web", "oauth_consent_info", [
        ctx,
        first.uid,
        first.nonce,
      ]),
    ).toMatchObject({ ok: true, data: { client_name: "First client" } });
    await expect(
      call(tx, "mdf_auth", "oauth_upsert", [
        "Client",
        hash("unregistered"),
        { client_id: "unregistered", redirect_uris: [] },
        null,
        null,
        null,
      ]),
    ).rejects.toMatchObject({ code: "MDF03" });
    await expect(
      call(tx, "mdf_auth", "oauth_upsert", [
        "Interaction",
        hash(first.uid),
        { params: { client_id: "replacement" } },
        null,
        first.uid,
        new Date(Date.now() + 60000),
      ]),
    ).rejects.toMatchObject({ code: "MDF03" });
  });
});

it("OAuth resolution requires its cap, unexpired access token and live grant", async () => {
  await fixture(async (tx) => {
    const ctx = await actor(tx);
    const g = await grant(tx, ctx);
    const args = [
      "AccessToken",
      hash("access"),
      { clientId: g.client, scope: "read", aud: resource },
      g.grant_id,
      null,
      new Date(Date.now() + 60000),
    ];
    await call(tx, "mdf_auth", "oauth_upsert", args);
    await tx`delete from public.spend_caps where key = ${g.token_id}`;
    await expect(
      call(tx, "mdf_web", "resolve_access_token", [hash("access"), resource]),
    ).rejects.toMatchObject({ code: "MDF06" });
    await tx`insert into public.spend_caps (scope, key, period, "limit") values ('token', ${g.token_id}, 'day', 1)`;
    await tx`update public.oauth_store set expires_at = now() - interval '1 second' where model = 'AccessToken'`;
    await expect(
      call(tx, "mdf_web", "resolve_access_token", [hash("access"), resource]),
    ).rejects.toMatchObject({ code: "MDF03" });
    await call(tx, "mdf_auth", "oauth_upsert", args);
    await tx`update public.agent_tokens set expires_at = now() - interval '1 second' where id = ${g.token_id}`;
    await expect(
      call(tx, "mdf_web", "resolve_access_token", [hash("access"), resource]),
    ).rejects.toMatchObject({ code: "MDF03" });
    await expect(
      call(tx, "mdf_auth", "oauth_upsert", args),
    ).rejects.toMatchObject({ code: "MDF03" });
  });
});

it("mdf_web cannot use OAuth storage, mdf_auth cannot consent, and neither can read the private tables", async () => {
  await fixture(async (tx) => {
    const ctx = await actor(tx);
    await expect(
      call(tx, "mdf_web", "oauth_find", ["Client", hash("client")]),
    ).rejects.toMatchObject({ code: "42501" });
    await expect(
      call(tx, "mdf_auth", "oauth_consent", [
        ctx,
        "uid",
        "nonce",
        ["read"],
        false,
      ]),
    ).rejects.toMatchObject({ code: "42501" });
    for (const role of ["mdf_web", "mdf_auth", "anon", "authenticated"])
      for (const table of [
        "oauth_store",
        "oauth_consents",
        "oauth_pairing",
        "spend_caps",
      ]) {
        const [permissions] =
          await tx`select has_table_privilege(${role}, ${`public.${table}`}, 'SELECT,INSERT,UPDATE,DELETE') as allowed`;
        expect(permissions.allowed).toBe(false);
      }
  });
});

it("oauth_find_by_uid supports the provider's Session lookup without exposing jti", async () => {
  await fixture(async (tx) => {
    const uid = randomUUID();
    await call(tx, "mdf_auth", "oauth_upsert", [
      "Session",
      hash("session-id"),
      { uid, accountId: "account", jti: "session-id" },
      null,
      uid,
      new Date(Date.now() + 60000),
    ]);
    expect(await call(tx, "mdf_auth", "oauth_find_by_uid", [uid])).toEqual({
      uid,
      accountId: "account",
    });
    await tx`update public.oauth_store set expires_at = now() - interval '1 second' where model = 'Session' and uid = ${uid}`;
    expect(await call(tx, "mdf_auth", "oauth_find_by_uid", [uid])).toBeNull();
  });
});
