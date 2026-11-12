import { randomUUID } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import { afterAll, expect, it } from "vitest";
import { ownerSql } from "./helpers/pg";

const sql = ownerSql();
afterAll(() => sql.end());
const oauthStorage = new Set([
  "oauth_find",
  "oauth_find_by_uid",
  "oauth_upsert",
  "oauth_consume",
  "oauth_destroy",
  "oauth_revoke_by_grant",
  "oauth_registration_claim",
  "oauth_flow_nonce_set",
  "oauth_interaction_result",
  "oauth_bind_grant",
]);

it("mdf_web and mdf_auth cannot execute public functions or each other's ops functions", async () => {
  const rows = await sql`
    select p.proname, n.nspname,
      has_function_privilege('mdf_web', p.oid, 'EXECUTE') as web,
      has_function_privilege('mdf_auth', p.oid, 'EXECUTE') as auth
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname in ('public', 'ops')
  `;
  for (const row of rows) {
    if (row.nspname === "public") {
      expect(row.web, row.proname).toBe(false);
      expect(row.auth, row.proname).toBe(false);
    } else if (oauthStorage.has(row.proname)) {
      expect(row.web, row.proname).toBe(false);
      expect(row.auth, row.proname).toBe(true);
    } else {
      expect(row.auth, row.proname).toBe(false);
      if (row.proname.startsWith("oauth_")) {
        expect(["oauth_consent_info", "oauth_consent"]).toContain(row.proname);
      }
    }
  }
});

it("customer and admin JWTs cannot write jobs or projects or call write RPCs directly", async () => {
  const url = process.env.SUPABASE_URL;
  const anon = process.env.SUPABASE_ANON_KEY;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !anon || !serviceKey)
    throw new Error("e2e Supabase environment required");
  const service = createClient(url, serviceKey, {
    auth: { persistSession: false },
  });
  for (const role of ["customer", "admin"] as const) {
    const id = randomUUID();
    const email = `${id}@example.test`;
    const password = `test-${randomUUID()}`;
    try {
      expect(
        (await service.from("admin_allowlist").insert({ email, role })).error,
      ).toBeNull();
      expect(
        (
          await service.auth.admin.createUser({
            id,
            email,
            password,
            email_confirm: true,
          })
        ).error,
      ).toBeNull();
      const client = createClient(url, anon, {
        auth: { persistSession: false, autoRefreshToken: false },
      });
      expect(
        (await client.auth.signInWithPassword({ email, password })).error,
      ).toBeNull();
      const project = await service
        .from("projects")
        .insert({ owner_id: id, topic: "Lockdown fixture" })
        .select("id")
        .single();
      expect(project.error).toBeNull();
      const version = await service
        .from("versions")
        .insert({ owner_id: id, project_id: project.data?.id, lang: "en" })
        .select("id")
        .single();
      expect(version.error).toBeNull();
      const job = await service
        .from("jobs")
        .insert({
          owner_id: id,
          version_id: version.data?.id,
          stage: "draft_lyrics",
          idempotency_key: randomUUID(),
        })
        .select("id")
        .single();
      expect(job.error).toBeNull();
      expect(
        (
          await client.from("jobs").insert({
            version_id: version.data?.id,
            stage: "draft_lyrics",
            idempotency_key: randomUUID(),
          })
        ).error?.code,
      ).toBe("42501");
      expect(
        (
          await client
            .from("jobs")
            .update({ status: "cancelled" })
            .eq("id", job.data?.id)
        ).error?.code,
      ).toBe("42501");
      expect(
        (await client.from("projects").insert({ topic: "Forbidden" })).error
          ?.code,
      ).toBe("42501");
      for (const [name, args] of [
        ["approve_lyrics", { p_version: version.data?.id, p_pack: {} }],
        ["generate_again", { p_version: version.data?.id, p_generation: 1 }],
        ["enqueue_publish", { p_render: randomUUID(), p_metadata: {} }],
        [
          "confirm_publication",
          { p_publication: randomUUID(), p_privacy: "private" },
        ],
      ] as const) {
        expect(
          (await client.rpc(name, args)).error?.code,
          `${role} ${name}`,
        ).toBe("42501");
      }
    } finally {
      await service.auth.admin.deleteUser(id);
      await service.from("admin_allowlist").delete().eq("email", email);
    }
  }
});
