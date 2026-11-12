import { readdirSync } from "node:fs";
import { expect, it } from "vitest";

it("keeps the ACL lockdown after every application migration", () => {
  const migrations = readdirSync(
    new URL("../../supabase/migrations/", import.meta.url),
  )
    .filter((name) => /^\d+_.*\.sql$/.test(name))
    .sort();
  expect(migrations.at(-1)).toMatch(/_ops_alignment_lockdown\.sql$/);
  const versions = migrations.map((name) => name.split("_")[0]);
  expect(new Set(versions).size).toBe(versions.length);
});
