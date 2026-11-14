import { writeFileSync } from "node:fs";
import { join } from "node:path";
import type { Sql } from "postgres";
import { expect, it, vi } from "vitest";
import {
  type AppliedMigration,
  applyAppMigrations,
  type MigrationFile,
  migrationChecksum,
  planMigrations,
} from "../../lib/native/migrate.js";
import { fixture } from "./fixtures.js";

const file = (version: string): MigrationFile => ({
  version,
  name: "test",
  sql: `select ${version};`,
  sha256: migrationChecksum(`select ${version};`),
});
it("fresh apply records each migration once and the second run is a no-op", async () => {
  const root = fixture();
  const migration = file("001");
  writeFileSync(join(root, "001_test.sql"), migration.sql);
  const rows: AppliedMigration[] = [];
  const query = vi.fn(
    async (strings: TemplateStringsArray, ...values: unknown[]) => {
      const text = strings.join("?");
      if (text.includes("select m.version")) return rows;
      if (text.includes("insert into supabase_migrations.schema_migrations"))
        rows.push({ version: String(values[0]), sha256: null });
      if (text.includes("insert into supabase_migrations.mdf_checksums")) {
        const row = rows.find((r) => r.version === values[0]);
        if (row) row.sha256 = String(values[1]);
      }
      return [];
    },
  );
  const execute = vi.fn(async (..._args: unknown[]) => []);
  const sql = Object.assign(query, {
    unsafe: execute,
    begin: async (run: (tx: Sql) => unknown) => run(sql as unknown as Sql),
  });
  expect(await applyAppMigrations(sql as unknown as Sql, root)).toEqual([
    "001",
  ]);
  expect(rows).toEqual([{ version: "001", sha256: migration.sha256 }]);
  expect(await applyAppMigrations(sql as unknown as Sql, root)).toEqual([]);
  expect(
    execute.mock.calls.filter((args) => String(args[0]) === migration.sql),
  ).toHaveLength(1);
});
it("refuses edited and missing applied migrations, includes older unapplied files", () => {
  const files = [file("001"), file("002")];
  expect(() =>
    planMigrations(files, [{ version: "001", sha256: "edited" }]),
  ).toThrow("was edited");
  expect(() =>
    planMigrations(files, [{ version: "003", sha256: "missing" }]),
  ).toThrow("has no file");
  expect(
    planMigrations(files, [{ version: "002", sha256: file("002").sha256 }]),
  ).toEqual({ pending: [file("001")], adopt: [] });
});
it("adopts legacy rows without rerunning their SQL", async () => {
  const root = fixture();
  const migration = file("001");
  writeFileSync(join(root, "001_test.sql"), migration.sql);
  expect(
    planMigrations([migration], [{ version: "001", sha256: null }]),
  ).toEqual({ pending: [], adopt: [migration] });
  const insert = vi.fn();
  const query = Object.assign(
    async (strings: TemplateStringsArray, ...values: unknown[]) => {
      if (strings.join("").includes("select m.version"))
        return [{ version: "001", sha256: null }];
      insert(...values);
      return [];
    },
    { unsafe: vi.fn(async () => []), begin: vi.fn() },
  );
  expect(await applyAppMigrations(query as unknown as Sql, root)).toEqual([]);
  expect(insert).toHaveBeenCalledWith("001", migration.sha256);
  expect(query.begin).not.toHaveBeenCalled();
});
