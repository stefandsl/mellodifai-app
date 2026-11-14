import { createHash } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { Sql } from "postgres";
import { type SchemaRollback, validateRollback } from "./rollback.js";

export interface MigrationFile {
  version: string;
  name: string;
  sql: string;
  sha256: string;
}

export interface AppliedMigration {
  version: string;
  /** null for a row written by the Supabase CLI before this ledger existed. */
  sha256: string | null;
}

/** Checksums ignore line-ending style so a checkout setting cannot make an
 * unchanged migration look edited.
 */
export function migrationChecksum(sql: string): string {
  return createHash("sha256")
    .update(sql.replaceAll("\r\n", "\n"))
    .digest("hex");
}

export function readMigrations(directory: string): MigrationFile[] {
  const files: MigrationFile[] = [];
  for (const file of readdirSync(directory).sort()) {
    if (!file.endsWith(".sql")) continue;
    const match = /^(\d+)_(.+)\.sql$/.exec(file);
    if (!match)
      throw new Error(
        `Migration file name is not <version>_<name>.sql: ${file}`,
      );
    const sql = readFileSync(join(directory, file), "utf8");
    files.push({
      version: match[1] as string,
      name: match[2] as string,
      sql,
      sha256: migrationChecksum(sql),
    });
  }
  const versions = new Set(files.map((file) => file.version));
  if (versions.size !== files.length)
    throw new Error("Two migration files share one version");
  return files;
}

const LOCKDOWN_VERSION = "20261103080001";

/** Include unapplied older versions, while preserving the repository's
 * lockdown-last rule. The existing lockdown uses CREATE FUNCTION and cannot
 * safely be replayed after inserting a migration into an installed schema. */
export function planMigrations(
  files: MigrationFile[],
  applied: AppliedMigration[],
  rollback?: SchemaRollback,
): { pending: MigrationFile[]; adopt: MigrationFile[] } {
  if (rollback) {
    validateRollback(rollback, files, applied);
    return { pending: [], adopt: [] };
  }
  if (files.some((file) => file.version > LOCKDOWN_VERSION))
    throw new Error(
      `Migration version after final lockdown ${LOCKDOWN_VERSION} is forbidden`,
    );
  const local = new Map(files.map((file) => [file.version, file]));
  const done = new Map(applied.map((row) => [row.version, row]));
  for (const row of applied)
    if (!local.has(row.version))
      throw new Error(
        `Applied migration ${row.version} has no file in supabase/migrations`,
      );
  const pending: MigrationFile[] = [];
  const adopt: MigrationFile[] = [];
  for (const file of [...files].sort((a, b) =>
    a.version.localeCompare(b.version),
  )) {
    const row = done.get(file.version);
    if (!row) {
      pending.push(file);
    } else if (row.sha256 === null) adopt.push(file);
    else if (row.sha256 !== file.sha256)
      throw new Error(
        `Applied migration ${file.version}_${file.name} was edited after it ran; add a new migration instead`,
      );
  }
  if (done.has(LOCKDOWN_VERSION) && pending.length)
    throw new Error(
      `Cannot insert migrations before applied lockdown ${LOCKDOWN_VERSION}: the lockdown is not idempotent (plain CREATE FUNCTION). A reviewed replay-safe lockdown policy is required before upgrading this schema`,
    );
  return { pending, adopt };
}

/** Apply pending app migrations in file name order, each in one transaction
 * together with its ledger rows. The version table is the Supabase CLI's own
 * (supabase_migrations.schema_migrations), so a database moved from the
 * Docker runtime continues where it stopped; checksums sit beside it.
 */
export async function applyAppMigrations(
  sql: Sql,
  directory: string,
  log: (message: string) => void = () => {},
  rollback?: SchemaRollback,
): Promise<string[]> {
  await sql.unsafe(`
    create schema if not exists supabase_migrations;
    create table if not exists supabase_migrations.schema_migrations (
      version text not null primary key,
      statements text[],
      name text
    );
    create table if not exists supabase_migrations.mdf_checksums (
      version text not null primary key,
      sha256 text not null,
      recorded_at timestamptz not null default now()
    );
  `);
  const applied = (await sql`
    select m.version, c.sha256
    from supabase_migrations.schema_migrations m
    left join supabase_migrations.mdf_checksums c using (version)
    order by m.version`) as unknown as AppliedMigration[];
  const { pending, adopt } = planMigrations(
    readMigrations(directory),
    applied,
    rollback,
  );
  for (const file of adopt)
    await sql`insert into supabase_migrations.mdf_checksums (version, sha256) values (${file.version}, ${file.sha256})`;
  for (const file of pending) {
    log(`migration ${file.version}_${file.name}`);
    try {
      await sql.begin(async (tx) => {
        await tx.unsafe(file.sql);
        await tx`insert into supabase_migrations.schema_migrations (version, name, statements) values (${file.version}, ${file.name}, ${[file.sql]})`;
        await tx`insert into supabase_migrations.mdf_checksums (version, sha256) values (${file.version}, ${file.sha256})`;
      });
    } catch (error) {
      // Migration SQL is repository code: its database error is safe to show.
      const detail = (error as { message?: string }).message ?? "error";
      throw new Error(
        `Migration ${file.version}_${file.name} failed and was rolled back: ${detail}`,
      );
    }
  }
  return pending.map((file) => file.version);
}

/** Settings the Docker start applies after migrations, kept identical. */
export async function applyStackSettings(
  sql: Sql,
  fakeStack: boolean,
): Promise<void> {
  const rows = await sql`select fake_stack from public.stack_settings where id`;
  if (rows.length !== 1 || typeof rows[0]?.fake_stack !== "boolean")
    throw new Error(
      "Missing or invalid stack settings; import or recover before startup",
    );
  if (!fakeStack && rows[0]?.fake_stack !== false)
    throw new Error(
      "Refusing to hide a fake stack on production or development startup",
    );
  if (fakeStack)
    await sql`update public.stack_settings set fake_stack = true where id`;
  await sql`notify pgrst, 'reload schema'`;
}
