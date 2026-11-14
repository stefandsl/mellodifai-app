import { readdirSync } from "node:fs";
import { expect, it } from "vitest";
import { checksLockdown, LOCKDOWN_VERSION } from "../lib/native/migrate.js";

it("keeps the ACL lockdown and checks its guarantees after every later migration", () => {
  const migrations = readdirSync(
    new URL("../../supabase/migrations/", import.meta.url),
  )
    .filter((name) => /^\d+_.*\.sql$/.test(name))
    .sort();
  expect(migrations).toContain(
    `${LOCKDOWN_VERSION}_ops_alignment_lockdown.sql`,
  );
  const versions = migrations.map((name) => name.split("_")[0] as string);
  expect(new Set(versions).size).toBe(versions.length);
  // A migration after the lockdown may change the schema but never undo the
  // lockdown: the native runner asserts its guarantees in the same transaction.
  for (const version of versions.filter((v) => v >= LOCKDOWN_VERSION))
    expect(
      checksLockdown({ version, name: "", sql: "", sha256: "" }),
      version,
    ).toBe(true);
});
