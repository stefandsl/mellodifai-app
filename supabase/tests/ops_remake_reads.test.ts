import { expect, it } from "vitest";
import { actor, call, fixture, hash, pat } from "./helpers/token-fixture";

it("remake reads use the resolved session owner and enforce the test rule", async () => {
  await fixture(async (tx) => {
    const a = await actor(tx);
    const b = await actor(tx);
    const started = await call(tx, "mdf_web", "remake_start", [
      a,
      "https://youtu.be/49rDdMbXd_w",
      "49rDdMbXd_w",
      "it",
      null,
    ]);
    expect(started.ok).toBe(true);
    const [request] =
      await tx`insert into public.lyric_requests(owner_id,mode,lang,input) values(${a.user_id},'write','it','{}') returning id`;
    for (const [name, args] of [
      ["my_remake", []],
      ["lyrics_assist_state", [request.id]],
    ] as const) {
      await tx`select set_config('request.jwt.claims',${JSON.stringify({ sub: a.user_id, role: "authenticated" })},true)`;
      expect(await call(tx, "mdf_web", name, [b, ...args])).toEqual({
        ok: true,
        data: null,
      });
      expect(await call(tx, "mdf_web", name, [a, ...args])).toMatchObject({
        ok: true,
      });
      expect(
        await call(tx, "mdf_web", name, [
          { ...a, session_id: b.session_id },
          ...args,
        ]),
      ).toMatchObject({ ok: false, code: "unauthorized" });
    }
    await tx`update public.versions set test_run=true where id=(select version_id from public.remakes where id=${started.data.id})`;
    expect(await call(tx, "mdf_web", "my_remake", [a])).toEqual({
      ok: true,
      data: null,
    });
    await pat(tx, a);
    for (const [name, args] of [
      ["my_remake", []],
      ["lyrics_assist_state", [request.id]],
    ] as const) {
      expect(
        await call(tx, "mdf_web", name, [
          { actor_kind: "pat", token_hash: hash("test-pat"), remote: false },
          ...args,
        ]),
      ).toMatchObject({ ok: false, code: "forbidden_scope" });
    }
  });
});

it("remake reads have only the web grant and fixed definer settings", async () => {
  await fixture(async (tx) => {
    const functions =
      await tx`select p.oid,p.prosecdef,p.proconfig,pg_get_userbyid(p.proowner) as owner from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='ops' and p.proname in ('my_remake','lyrics_assist_state')`;
    expect(functions).toHaveLength(2);
    for (const fn of functions) {
      expect(fn).toMatchObject({ prosecdef: true, owner: "postgres" });
      expect(fn.proconfig).toContain('search_path=""');
      expect(fn.proconfig).toContain("TimeZone=UTC");
      for (const role of [
        "mdf_web",
        "mdf_auth",
        "service_role",
        "anon",
        "authenticated",
      ]) {
        const [grant] =
          await tx`select has_function_privilege(${role},${fn.oid}::oid,'execute') as allowed`;
        expect(grant.allowed).toBe(role === "mdf_web");
      }
    }
  });
});
