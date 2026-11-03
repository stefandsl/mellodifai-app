import { expect, it } from "vitest";
import {
  actor,
  call,
  fixture,
  hash,
  interaction,
  pat,
} from "./helpers/token-fixture";

it("a customer cannot create a token or complete a consent (forbidden_scope)", async () => {
  await fixture(async (tx) => {
    const customer = await actor(tx, "customer");
    const admin = await actor(tx);
    const flow = await interaction(tx, admin);
    expect(await pat(tx, customer)).toMatchObject({
      ok: false,
      code: "forbidden_scope",
    });
    expect(
      await call(tx, "mdf_web", "oauth_consent", [
        customer,
        flow.uid,
        flow.nonce,
        ["read"],
        false,
      ]),
    ).toMatchObject({ ok: false, code: "forbidden_scope" });
  });
});
it("every new token gets its 1 USD per day spend_caps row; a token without one is refused with no_cap", async () => {
  await fixture(async (tx) => {
    const ctx = await actor(tx);
    const result = await pat(tx, ctx);
    expect(result.ok).toBe(true);
    const [cap] =
      await tx`select * from public.spend_caps where scope = 'token' and key = ${result.data.id}`;
    expect(cap).toMatchObject({
      provider: "",
      unit: "usd",
      period: "day",
      limit: "1.0000",
    });
    const token = { actor_kind: "pat", token_hash: hash("test-pat") };
    expect(
      await call(tx, "mdf_web", "idem_begin", [token, "token-key", "hash"]),
    ).toMatchObject({ ok: true });
    await tx`delete from public.spend_caps where scope = 'token' and key = ${result.data.id}`;
    expect(
      await call(tx, "mdf_web", "idem_begin", [token, "no-cap-key", "hash"]),
    ).toMatchObject({
      ok: false,
      code: "cap_exceeded",
      details: { reason: "no_cap" },
    });
  });
});
it("a token call re-checks the owner's role: a token of a demoted owner is refused (Nit 30)", async () => {
  await fixture(async (tx) => {
    const ctx = await actor(tx);
    await pat(tx, ctx);
    await tx`update public.profiles set role = 'customer' where id = ${ctx.user_id}`;
    expect(
      await call(tx, "mdf_web", "idem_begin", [
        { actor_kind: "pat", token_hash: hash("test-pat") },
        "demoted-key",
        "hash",
      ]),
    ).toMatchObject({ ok: false, code: "forbidden_scope" });
  });
});
it("a remote PAT needs remote_mcp on (Nit 29)", async () => {
  await fixture(async (tx) => {
    const ctx = await actor(tx);
    await pat(tx, ctx, true);
    const token = {
      actor_kind: "pat",
      token_hash: hash("test-pat"),
      remote: true,
    };
    expect(
      await call(tx, "mdf_web", "idem_begin", [token, "remote-key", "hash"]),
    ).toMatchObject({ code: "forbidden_scope" });
    await call(tx, "mdf_web", "admin_flag_set", [ctx, "remote_mcp", true]);
    expect(
      await call(tx, "mdf_web", "idem_begin", [token, "remote-key", "hash"]),
    ).toMatchObject({ ok: true });
  });
});
it("administration requires a fresh local admin session and never exposes hashes", async () => {
  await fixture(async (tx) => {
    const ctx = await actor(tx);
    expect(await pat(tx, { ...ctx, remote: true })).toMatchObject({
      code: "forbidden_scope",
    });
    expect(
      await call(tx, "mdf_web", "admin_token_create", [
        ctx,
        "Test",
        hash("x"),
        "hint",
        ["publish"],
        false,
        false,
        null,
      ]),
    ).toMatchObject({ code: "validation" });
    const created = await pat(tx, ctx);
    expect(created.ok).toBe(true);
    const listed = await call(tx, "mdf_web", "admin_tokens_list", [ctx]);
    expect(listed.data).toHaveLength(1);
    expect(listed.data[0]).not.toHaveProperty("token_hash");
    expect(listed.data[0]).not.toHaveProperty("grant_id");
    expect(
      await call(tx, "mdf_web", "admin_token_revoke", [
        await actor(tx),
        created.data.id,
      ]),
    ).toMatchObject({ code: "not_found" });
    await tx`update auth.sessions set created_at = now() - interval '66 minutes' where id = ${ctx.session_id}`;
    expect(await call(tx, "mdf_web", "admin_tokens_list", [ctx])).toMatchObject(
      { code: "unauthorized" },
    );
  });
});
