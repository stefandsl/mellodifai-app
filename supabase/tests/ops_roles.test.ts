import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { afterAll, expect, it } from "vitest";
import { setOwner } from "../../ops/set-owner";
import { ownerSql } from "./helpers/pg";

const sql = ownerSql();
afterAll(() => sql.end());
const rollback = new Error("rollback test fixture");

it("a new allowlisted user becomes a customer", async () => {
  await expect(
    sql.begin(async (tx) => {
      const id = randomUUID();
      const email = `${id}@example.test`;
      await tx`insert into public.admin_allowlist (email) values (${email.toUpperCase()})`;
      await tx`insert into auth.users (id, email, email_confirmed_at) values (${id}, ${email}, now())`;
      expect(
        await tx`select role from public.profiles where id = ${id}`,
      ).toEqual([{ role: "customer" }]);
      throw rollback;
    }),
  ).rejects.toBe(rollback);
});

it("the migration copies today's roles from profiles", async () => {
  await expect(
    sql.begin(async (tx) => {
      await tx`alter table public.admin_allowlist drop column if exists role`;
      await tx`drop index if exists public.admin_allowlist_email_lower`;
      for (const role of ["admin", "customer"]) {
        const id = randomUUID();
        const email = `${id}@example.test`;
        await tx`insert into auth.users (id, email) values (${id}, ${email})`;
        await tx`insert into public.profiles (id, email, role) values (${id}, ${email}, ${role})`;
        await tx`insert into public.admin_allowlist (email) values (${email.toUpperCase()})`;
      }
      await tx.unsafe(
        readFileSync(
          new URL(
            "../migrations/20261102000027_ops_roles.sql",
            import.meta.url,
          ),
          "utf8",
        ),
      );
      const mismatches =
        await tx`select a.email from public.admin_allowlist a join public.profiles p on lower(a.email) = lower(p.email) where a.role <> p.role`;
      expect(mismatches).toEqual([]);
      throw rollback;
    }),
  ).rejects.toBe(rollback);
});

it("emails differing only by case are refused by the unique index", async () => {
  await expect(
    sql.begin(async (tx) => {
      const email = `${randomUUID()}@example.test`;
      await tx`insert into public.admin_allowlist (email) values (${email})`;
      await expect(
        tx.savepoint(async (nested) => {
          await nested`insert into public.admin_allowlist (email) values (${email.toUpperCase()})`;
        }),
      ).rejects.toMatchObject({ code: "23505" });
      throw rollback;
    }),
  ).rejects.toBe(rollback);
});

it("setOwner leaves exactly one admin in both tables and throws on zero", async () => {
  await expect(
    sql.begin(async (tx) => {
      const email = `${randomUUID()}@example.test`;
      const id = randomUUID();
      await tx`insert into public.admin_allowlist (email) values (${email})`;
      await tx`insert into auth.users (id, email, email_confirmed_at) values (${id}, ${email}, now())`;
      const owner = { begin: tx.savepoint.bind(tx) };
      expect(await setOwner(owner, email.toUpperCase())).toEqual({ admins: 1 });
      for (const table of ["admin_allowlist", "profiles"]) {
        expect(
          await tx`select email from ${tx(table)} where role = 'admin'`,
        ).toEqual([{ email }]);
      }
      await expect(setOwner(owner, "missing@example.test")).rejects.toThrow(
        "exactly one admin",
      );
      expect(
        await tx`select role from public.profiles where id = ${id}`,
      ).toEqual([{ role: "admin" }]);
      const unconfirmed = `${randomUUID()}@example.test`;
      await tx`insert into public.admin_allowlist (email) values (${unconfirmed})`;
      await expect(setOwner(owner, unconfirmed)).rejects.toThrow(
        "exactly one admin",
      );
      expect(
        await tx`select role from public.admin_allowlist where email = ${email}`,
      ).toEqual([{ role: "admin" }]);
      throw rollback;
    }),
  ).rejects.toBe(rollback);
});
