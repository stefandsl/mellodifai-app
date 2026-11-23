import { randomUUID } from "node:crypto";
import { cpSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import postgres from "postgres";
import { expect, it } from "vitest";
import { nativeDatabase } from "../../lib/native/backup.js";
import { withStackLease } from "../../lib/native/lease.js";
import { applyAppMigrations } from "../../lib/native/migrate.js";
import {
  roleConnection,
  superuserConnection,
} from "../../lib/native/postgres.js";
import { runStack } from "../../stack.js";
import { fixture } from "./fixtures.js";
import { assertNativeTestRoot } from "./integration-env.js";

// Every repository migration is applied once, whatever their number.
const MIGRATIONS = readdirSync(
  new URL("../../../supabase/migrations/", import.meta.url),
).filter((name) => name.endsWith(".sql")).length;

it.skipIf(process.env.MDF_NATIVE_INTEGRATION !== "1")(
  "rolls back failed real migrations, refuses a lockdown replay and checks the lockdown after a new migration",
  async () => {
    assertNativeTestRoot();
    await runStack("start", "e2e", { runtime: "native" });
    try {
      await withStackLease("e2e", "migrate", async () => {
        const db = await nativeDatabase("e2e");
        const admin = superuserConnection(db.layout, db.logins);
        const name = `run8_${randomUUID().replaceAll("-", "")}`;
        await admin.unsafe(`create database ${name} owner postgres`);
        const sql = postgres({
          host: "127.0.0.1",
          port: db.layout.ports.db,
          database: name,
          user: "postgres",
          password: db.secrets.postgres,
          max: 1,
          onnotice: () => {},
        });
        try {
          const directory = fixture();
          writeFileSync(
            join(directory, "001_failure.sql"),
            "create table public.must_not_survive(id integer); select 1/0;",
          );
          await expect(applyAppMigrations(sql, directory)).rejects.toThrow(
            "rolled back",
          );
          expect(
            (
              await sql`select to_regclass('public.must_not_survive') as object`
            )[0]?.object,
          ).toBeNull();
          expect(
            (
              await sql`select count(*)::int as n from supabase_migrations.schema_migrations`
            )[0]?.n,
          ).toBe(0);
          expect(
            (
              await sql`select count(*)::int as n from supabase_migrations.mdf_checksums`
            )[0]?.n,
          ).toBe(0);
          writeFileSync(
            join(directory, "001_failure.sql"),
            "create table public.survives(id integer);",
          );
          expect(await applyAppMigrations(sql, directory)).toEqual(["001"]);
          expect(await applyAppMigrations(sql, directory)).toEqual([]);
          writeFileSync(
            join(directory, "000_inserted.sql"),
            "create table public.inserted_before_latest(id integer);",
          );
          expect(await applyAppMigrations(sql, directory)).toEqual(["000"]);
          expect(
            (
              await sql`select to_regclass('public.inserted_before_latest') as object`
            )[0]?.object,
          ).toBe("inserted_before_latest");
          const live = roleConnection(
            db.layout,
            "postgres",
            db.secrets.postgres,
          );
          try {
            const lockdown = readFileSync(
              new URL(
                "../../../supabase/migrations/20261103080001_ops_alignment_lockdown.sql",
                import.meta.url,
              ),
              "utf8",
            );
            await expect(
              live.begin(async (tx) => {
                await tx.unsafe(lockdown);
              }),
            ).rejects.toMatchObject({ code: "42723" });
            expect(
              (
                await live`select count(*)::int as n from supabase_migrations.schema_migrations`
              )[0]?.n,
            ).toBe(MIGRATIONS);
            const inserted = fixture();
            cpSync(
              new URL("../../../supabase/migrations", import.meta.url),
              inserted,
              { recursive: true },
            );
            writeFileSync(
              join(inserted, "20261103079001_inserted.sql"),
              "create table public.must_not_insert(id integer);",
            );
            await expect(applyAppMigrations(live, inserted)).rejects.toThrow(
              /lockdown.*not idempotent/i,
            );
            expect(
              (
                await live`select to_regclass('public.must_not_insert') as object`
              )[0]?.object,
            ).toBeNull();
            expect(
              (
                await live`select count(*)::int as n from supabase_migrations.schema_migrations`
              )[0]?.n,
            ).toBe(MIGRATIONS);
            // A new migration after the lockdown applies; one that undoes a
            // lockdown guarantee is rolled back with no ledger row.
            const forward = fixture();
            cpSync(
              new URL("../../../supabase/migrations", import.meta.url),
              forward,
              { recursive: true },
            );
            try {
              writeFileSync(
                join(forward, "29991231000001_run11_additive.sql"),
                "create table public.run11_additive(id integer);",
              );
              expect(await applyAppMigrations(live, forward)).toEqual([
                "29991231000001",
              ]);
              expect(
                (
                  await live`select to_regclass('public.run11_additive') as object`
                )[0]?.object,
              ).toBe("run11_additive");
              writeFileSync(
                join(forward, "29991231000002_run11_regrant.sql"),
                "create table public.run11_regrant(id integer); grant insert on public.jobs to authenticated;",
              );
              await expect(applyAppMigrations(live, forward)).rejects.toThrow(
                /rolled back: Lockdown guarantee broken: authenticated may insert into public\.jobs/,
              );
              expect(
                (
                  await live`select has_any_column_privilege('authenticated', 'public.jobs', 'INSERT') as granted, to_regclass('public.run11_regrant') as object`
                )[0],
              ).toEqual({ granted: false, object: null });
              expect(
                (
                  await live`select count(*)::int as n from supabase_migrations.schema_migrations where version = '29991231000002'`
                )[0]?.n,
              ).toBe(0);
              expect(
                (
                  await live`select count(*)::int as n from supabase_migrations.mdf_checksums where version = '29991231000002'`
                )[0]?.n,
              ).toBe(0);
              expect(
                (
                  await live`select count(*)::int as n from supabase_migrations.schema_migrations`
                )[0]?.n,
              ).toBe(MIGRATIONS + 1);
            } finally {
              await live.begin(async (tx) => {
                await tx`drop table if exists public.run11_additive, public.run11_regrant`;
                await tx`delete from supabase_migrations.mdf_checksums where version like '29991231%'`;
                await tx`delete from supabase_migrations.schema_migrations where version like '29991231%'`;
              });
            }
          } finally {
            await live.end();
          }
        } finally {
          await sql.end();
          await admin.unsafe(`drop database ${name} with (force)`);
          await admin.end();
        }
      });
    } finally {
      await runStack("stop", "e2e", { runtime: "native" });
    }
  },
  180_000,
);
