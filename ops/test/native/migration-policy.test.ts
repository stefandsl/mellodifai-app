import { fileURLToPath } from "node:url";
import { expect, it } from "vitest";
import { safeFailure } from "../../lib/native/diagnostics.js";
import {
  checksLockdown,
  lockdownGuarantees,
  migrationChecksum,
  planMigrations,
  readMigrations,
} from "../../lib/native/migrate.js";

const files = readMigrations(
  fileURLToPath(new URL("../../../supabase/migrations", import.meta.url)),
);
const applied = files.map(({ version, sha256 }) => ({ version, sha256 }));
it("preserves the safe lockdown explanation at the operator boundary", () => {
  let message = "no refusal";
  try {
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
    );
  } catch (error) {
    message = safeFailure(error);
  }
  expect(message).toMatch(/lockdown.*not idempotent/i);
});
it("plans a new migration after the applied lockdown and checks the lockdown after it", () => {
  const later = {
    version: "20261201000001",
    name: "additive",
    sql: "select 1",
    sha256: migrationChecksum("select 1"),
  };
  const { pending } = planMigrations([...files, later], applied);
  expect(pending).toEqual([later]);
  expect(pending.every(checksLockdown)).toBe(true);
  // The check starts at the lockdown itself; no file before it runs it.
  expect(files.filter(checksLockdown)[0]?.version).toBe("20261103080001");
  expect(
    files
      .filter((file) => file.version < "20261103080001")
      .some(checksLockdown),
  ).toBe(false);
});
it("refuses a file older than a migration applied after the lockdown", () => {
  const make = (version: string) => ({
    version,
    name: `m${version}`,
    sql: "select 1",
    sha256: migrationChecksum("select 1"),
  });
  const newer = make("20261201000002");
  const backdated = make("20261201000001");
  expect(() =>
    planMigrations(
      [...files, newer, backdated],
      [...applied, { version: newer.version, sha256: newer.sha256 }],
    ),
  ).toThrow(/20261201000001 before applied migration 20261201000002/);
});
it("asserts every lockdown guarantee in one block that fails with its own code", () => {
  const sql = lockdownGuarantees();
  for (const guarantee of [
    "ops.lyric_alignment_request(jsonb, uuid, uuid)",
    "public.playlist_membership(uuid[])",
    "'public.jobs', 'INSERT'",
    "'public.jobs', 'UPDATE'",
    "'public.projects', 'INSERT'",
    "'public.versions', 'INSERT'",
    "owners enqueue jobs",
    "owners cancel queued jobs",
    "resolve_kie_submission",
    "owners delete studio files",
  ])
    expect(sql).toContain(guarantee);
  expect(sql).toContain("errcode = 'MDFLK'");
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
