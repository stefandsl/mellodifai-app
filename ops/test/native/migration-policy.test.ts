import { fileURLToPath } from "node:url";
import { expect, it } from "vitest";
import {
  migrationChecksum,
  planMigrations,
  readMigrations,
} from "../../lib/native/migrate.js";

const files = readMigrations(
  fileURLToPath(new URL("../../../supabase/migrations", import.meta.url)),
);
const applied = files.map(({ version, sha256 }) => ({ version, sha256 }));
it("refuses versions beyond the mandatory final lockdown", () => {
  expect(() =>
    planMigrations(
      [
        ...files,
        {
          version: "20261103080002",
          name: "too_late",
          sql: "select 1",
          sha256: migrationChecksum("select 1"),
        },
      ],
      applied,
    ),
  ).toThrow(/after.*lockdown/i);
});
it("explains why an insertion cannot replay this non-idempotent lockdown", () => {
  expect(() =>
    planMigrations(
      [
        ...files,
        {
          version: "20261103079001",
          name: "inserted",
          sql: "select 1",
          sha256: migrationChecksum("select 1"),
        },
      ],
      applied,
    ),
  ).toThrow(/lockdown.*not idempotent/i);
});
it("applies older unapplied files in version order before lockdown has run", () => {
  const lockdown = files.at(-1);
  if (!lockdown) throw new Error("Missing lockdown");
  const earlier = {
    version: "001",
    name: "early",
    sql: "select 1",
    sha256: migrationChecksum("select 1"),
  };
  const later = { ...earlier, version: "002" };
  expect(
    planMigrations(
      [lockdown, later, earlier],
      [{ version: "002", sha256: later.sha256 }],
    ).pending.map((file) => file.version),
  ).toEqual(["001", lockdown.version]);
});
