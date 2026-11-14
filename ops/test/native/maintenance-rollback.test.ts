import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { nativeLayout } from "../../lib/native/layout.js";
import { planMigrations, readMigrations } from "../../lib/native/migrate.js";
import {
  readRollback,
  recordRollback,
  rollbackPath,
} from "../../lib/native/rollback.js";
import { nativeBackup } from "../../native-backup.js";
import { runStack } from "../../stack.js";
import { fixture } from "./fixtures.js";

const files = readMigrations(
  fileURLToPath(new URL("../../../supabase/migrations", import.meta.url)),
);
const applied = files.map(({ version, sha256 }) => ({ version, sha256 }));
// The ledger the maintenance database holds after the data load.
let ledger = applied;
const ledgerDump = () =>
  [
    "COPY supabase_migrations.schema_migrations (version, name) FROM stdin;",
    ...ledger.map((row) => `${row.version}\tm${row.version}`),
    "\\.",
    "COPY supabase_migrations.mdf_checksums (version, sha256) FROM stdin;",
    ...ledger.map((row) => `${row.version}\t${row.sha256}`),
    "\\.",
    "",
  ].join("\n");

vi.mock("../../lib/native/lease.js", () => ({
  withStackLease: async (_env: string, _cmd: string, fn: () => unknown) => fn(),
  assertStackLease: () => {},
}));
vi.mock("../../lib/native/maintenance.js", () => ({
  maintenanceDatabase: async () => ({
    db: { dump: async () => ledgerDump() },
    stop: async () => {},
  }),
}));
vi.mock("../../lib/native/backup.js", async (original) => ({
  ...(await original<typeof import("../../lib/native/backup.js")>()),
  backupNative: vi.fn(async () => ""),
  readBackup: vi.fn(),
  restoreNativeData: vi.fn(async () => {}),
}));
// Startup plans exactly as the supervisor does: this checkout's files, the
// restored ledger and whatever marker is on disk at that moment.
vi.mock("../../stack.js", () => ({
  runStack: vi.fn(async (cmd: string, env: "e2e") => {
    if (cmd === "start")
      planMigrations(files, ledger, readRollback(nativeLayout(env)));
  }),
}));

beforeEach(() => {
  vi.stubEnv("MELLODIFAI_ROOT", fixture());
  ledger = applied;
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.clearAllMocks();
});

// A deploy rollback recorded for the older release (without the newest file);
// the operator then restores from the current checkout.
const recordOlderRelease = () =>
  recordRollback(
    nativeLayout("e2e"),
    "older-reviewed-release",
    files.slice(0, -1),
    applied,
  );

it("names the marker file when a recorded rollback refuses startup", async () => {
  await recordOlderRelease();
  const layout = nativeLayout("e2e");
  expect(() => planMigrations(files, applied, readRollback(layout))).toThrow(
    rollbackPath(layout),
  );
});

it("restore clears a rollback marker that no longer fits this release, so its start works", async () => {
  await recordOlderRelease();
  const layout = nativeLayout("e2e");
  await nativeBackup(["restore", "--env", "e2e", `${layout.root}/some-backup`]);
  expect(vi.mocked(runStack)).toHaveBeenCalledWith("start", "e2e", {
    runtime: "native",
  });
  expect(existsSync(rollbackPath(layout))).toBe(false);
});

it("restore re-records a marker that still fits the running release", async () => {
  const layout = nativeLayout("e2e");
  // This checkout is the older release; the ledger holds one forward row.
  ledger = [...applied, { version: "29991231000000", sha256: "a".repeat(64) }];
  await recordRollback(layout, "this-release", files, ledger);
  const before = readRollback(layout);
  await nativeBackup(["restore", "--env", "e2e", `${layout.root}/some-backup`]);
  expect(readRollback(layout)).toEqual(before);
});
