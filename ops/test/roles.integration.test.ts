import {
  createHash,
  createHmac,
  pbkdf2Sync,
  timingSafeEqual,
} from "node:crypto";
import { expect, it } from "vitest";
import { ownerConnection } from "../lib/pg.js";
import { applyRolePasswordsInTransaction } from "../lib/roles.js";

async function fixture(present: boolean) {
  const url = process.env.TEST_DB_URL;
  if (!url) throw new Error("TEST_DB_URL is required");
  const parsed = new URL(url);
  if (
    parsed.hostname !== "127.0.0.1" ||
    (parsed.port !== "45622" &&
      !(parsed.port === "54322" && process.env.CI === "true"))
  )
    throw new Error("Role fixtures require the isolated e2e/CI database");
  const sql = ownerConnection(url);
  const rollback = new Error("rollback fixture");
  try {
    await sql.begin(async (tx) => {
      await tx`select pg_advisory_xact_lock(600600)`;
      for (const role of ["mdf_web", "mdf_auth"]) {
        const exists = await tx`select 1 from pg_roles where rolname = ${role}`;
        if (exists.length)
          await tx.unsafe(`alter role ${role} rename to task6_saved_${role}`);
        if (present) await tx.unsafe(`create role ${role} nologin noinherit`);
      }
      const result = await applyRolePasswordsInTransaction(tx, {
        mdf_web: "fixture'quote\\slash",
        mdf_auth: "fixture-auth",
      });
      expect(result).toEqual(
        present
          ? { set: ["mdf_web", "mdf_auth"], absent: [] }
          : { set: [], absent: ["mdf_web", "mdf_auth"] },
      );
      const rows =
        await tx`select rolname, rolcanlogin from pg_roles where rolname in ('mdf_web', 'mdf_auth')`;
      expect(rows.length).toBe(present ? 2 : 0);
      if (present) {
        expect(rows.every((r) => r.rolcanlogin)).toBe(true);
        const hashes =
          await tx`select rolname, rolpassword from pg_authid where rolname in ('mdf_web', 'mdf_auth')`;
        for (const row of hashes) {
          const password =
            row.rolname === "mdf_web" ? "fixture'quote\\slash" : "fixture-auth";
          const match = /^SCRAM-SHA-256\$(\d+):([^$]+)\$([^:]+):(.+)$/.exec(
            row.rolpassword,
          );
          if (!match?.[1] || !match[2] || !match[3])
            throw new Error("Expected SCRAM verifier");
          const salted = pbkdf2Sync(
            password,
            Buffer.from(match[2], "base64"),
            Number(match[1]),
            32,
            "sha256",
          );
          const client = createHmac("sha256", salted)
            .update("Client Key")
            .digest();
          const stored = createHash("sha256").update(client).digest();
          expect(timingSafeEqual(stored, Buffer.from(match[3], "base64"))).toBe(
            true,
          );
        }
      }
      throw rollback;
    });
  } catch (error) {
    if (error !== rollback) throw error;
  } finally {
    await sql.end();
  }
}

it("applyRolePasswords reports absent roles and does not create them", async () => {
  await fixture(false);
});
it("applyRolePasswords sets LOGIN PASSWORD on mdf_web and mdf_auth when they exist", async () => {
  await fixture(true);
});
