import { expect, it } from "vitest";
import { actor, call, fixture, hash, pat } from "./helpers/token-fixture";

const token = {
  actor_kind: "pat",
  token_hash: hash("test-pat"),
  remote: false,
};

it("resolves a valid PAT without requiring read scope or creating an idempotency row", async () => {
  await fixture(async (tx) => {
    const owner = await actor(tx);
    const created = await pat(tx, owner);
    expect(created.ok).toBe(true);
    await tx`update public.agent_tokens set scopes = array['create'] where id = ${created.data.id}`;
    const [before] =
      await tx`select count(*)::int as n from public.idempotency_keys`;
    expect(await call(tx, "mdf_web", "resolve_pat", [token])).toEqual({
      user_id: owner.user_id,
      token_id: created.data.id,
    });
    const [after] =
      await tx`select count(*)::int as n from public.idempotency_keys`;
    expect(after.n).toBe(before.n);
  });
});

it("rejects unknown, expired and revoked PATs on every resolution", async () => {
  await fixture(async (tx) => {
    const owner = await actor(tx);
    await expect(
      call(tx, "mdf_web", "resolve_pat", [token]),
    ).rejects.toMatchObject({ message: "authentication required" });
    const created = await pat(tx, owner);
    expect(created.ok).toBe(true);
    expect(await call(tx, "mdf_web", "resolve_pat", [token])).toHaveProperty(
      "token_id",
      created.data.id,
    );
    await tx`update public.agent_tokens set expires_at = now() - interval '1 second' where id = ${created.data.id}`;
    await expect(
      call(tx, "mdf_web", "resolve_pat", [token]),
    ).rejects.toMatchObject({ message: "authentication required" });
    await tx`update public.agent_tokens set expires_at = null, revoked_at = now() where id = ${created.data.id}`;
    await expect(
      call(tx, "mdf_web", "resolve_pat", [token]),
    ).rejects.toMatchObject({ message: "authentication required" });
  });
});

it("enforces remote permission, remote_mcp, owner role and token cap", async () => {
  await fixture(async (tx) => {
    const owner = await actor(tx);
    expect(
      await call(tx, "mdf_web", "admin_flag_set", [owner, "remote_mcp", false]),
    ).toMatchObject({ ok: true });
    const created = await pat(tx, owner);
    expect(created.ok).toBe(true);
    const remote = { ...token, remote: true };
    await expect(
      call(tx, "mdf_web", "resolve_pat", [remote]),
    ).rejects.toMatchObject({ code: "42501" });
    await tx`update public.agent_tokens set remote = true, expires_at = now() + interval '1 day' where id = ${created.data.id}`;
    await expect(
      call(tx, "mdf_web", "resolve_pat", [remote]),
    ).rejects.toMatchObject({ code: "42501" });
    expect(
      await call(tx, "mdf_web", "admin_flag_set", [owner, "remote_mcp", true]),
    ).toMatchObject({ ok: true });
    expect(await call(tx, "mdf_web", "resolve_pat", [remote])).toHaveProperty(
      "token_id",
      created.data.id,
    );
    expect(
      await call(tx, "mdf_web", "admin_flag_set", [owner, "remote_mcp", false]),
    ).toMatchObject({ ok: true });
    await expect(
      call(tx, "mdf_web", "resolve_pat", [remote]),
    ).rejects.toMatchObject({ code: "42501" });
    await tx`update public.profiles set role = 'customer' where id = ${owner.user_id}`;
    await expect(
      call(tx, "mdf_web", "resolve_pat", [token]),
    ).rejects.toMatchObject({ code: "42501" });
    await tx`update public.profiles set role = 'admin' where id = ${owner.user_id}`;
    await tx`delete from public.spend_caps where scope = 'token' and key = ${created.data.id}`;
    await expect(
      call(tx, "mdf_web", "resolve_pat", [token]),
    ).rejects.toMatchObject({ code: "MDF06" });
  });
});

it("rejects non-PAT contexts and grants execution only to mdf_web", async () => {
  await fixture(async (tx) => {
    await expect(
      call(tx, "mdf_web", "resolve_pat", [await actor(tx)]),
    ).rejects.toMatchObject({ message: "authentication required" });
    for (const role of [
      "anon",
      "authenticated",
      "mdf_auth",
      "service_role",
      "mdf_web",
    ]) {
      const [grant] =
        await tx`select has_function_privilege(${role}, 'ops.resolve_pat(jsonb)', 'EXECUTE') as allowed`;
      expect(grant.allowed).toBe(role === "mdf_web");
    }
    const [security] =
      await tx`select p.prosecdef, p.proconfig, pg_get_userbyid(p.proowner) as owner from pg_proc p where p.oid = 'ops.resolve_pat(jsonb)'::regprocedure`;
    expect(security).toMatchObject({ prosecdef: true, owner: "postgres" });
    expect(security.proconfig).toEqual(
      expect.arrayContaining(['search_path=""', "TimeZone=UTC"]),
    );
  });
});
