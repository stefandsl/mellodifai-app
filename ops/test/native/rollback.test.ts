import { afterEach, expect, it, vi } from "vitest";
import { nativeLayout } from "../../lib/native/layout.js";
import { migrationChecksum, planMigrations } from "../../lib/native/migrate.js";
import { readRollback, recordRollback } from "../../lib/native/rollback.js";
import { fixture } from "./fixtures.js";

afterEach(() => vi.unstubAllEnvs());

it("continues to reject an unrecorded forward schema", () => {
  expect(() =>
    planMigrations(
      [
        {
          version: "001",
          name: "old",
          sql: "select 1",
          sha256: migrationChecksum("select 1"),
        },
      ],
      [
        { version: "001", sha256: migrationChecksum("select 1") },
        { version: "002", sha256: migrationChecksum("select 2") },
      ],
    ),
  ).toThrow("has no file");
});

it("accepts only the exact recorded schema and exact older release", async () => {
  vi.stubEnv("MELLODIFAI_ROOT", fixture());
  const old = {
    version: "001",
    name: "old",
    sql: "select 1",
    sha256: migrationChecksum("select 1"),
  };
  const applied = [
    { version: "001", sha256: old.sha256 },
    { version: "002", sha256: migrationChecksum("select 2") },
  ];
  await recordRollback(
    nativeLayout("e2e"),
    "older-reviewed-commit",
    [old],
    applied,
  );
  const marker = readRollback(nativeLayout("e2e"));
  expect(planMigrations([old], applied, marker)).toEqual({
    pending: [],
    adopt: [],
  });
  expect(() =>
    planMigrations(
      [old],
      [...applied, { version: "0015", sha256: old.sha256 }],
      marker,
    ),
  ).toThrow("exact ledger and release");
  expect(() =>
    planMigrations([{ ...old, sha256: "edited" }], applied, marker),
  ).toThrow("exact ledger and release");
  expect(() =>
    planMigrations(
      [old],
      applied.map((row, index) =>
        index === 0 ? { ...row, sha256: "edited" } : row,
      ),
      marker,
    ),
  ).toThrow("exact ledger and release");
  await expect(
    recordRollback(
      nativeLayout("e2e"),
      "unapplied-release",
      [{ ...old, version: "003" }],
      applied,
    ),
  ).rejects.toThrow("exact ledger and release");
});
