import { createHash } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { readBackup, restoreNativeData } from "../../lib/native/backup.js";
import { saveJournal } from "../../lib/native/journal.js";
import { nativeLayout } from "../../lib/native/layout.js";
import { nativeBackup } from "../../native-backup.js";
import { fixture } from "./fixtures.js";

vi.mock("../../lib/native/lease.js", () => ({
  withStackLease: async (_env: string, _cmd: string, fn: () => unknown) => fn(),
  assertStackLease: () => {},
}));
vi.mock("../../lib/native/maintenance.js", () => ({
  maintenanceDatabase: async () => ({
    db: { dump: async () => "" },
    stop: async () => {},
  }),
}));
vi.mock("../../lib/native/backup.js", async (original) => ({
  ...(await original<typeof import("../../lib/native/backup.js")>()),
  backupNative: vi.fn(async () => ""),
  restoreNativeData: vi.fn(async () => {}),
  refreshSchemaRollback: vi.fn(async () => "none"),
}));
vi.mock("../../stack.js", () => ({ runStack: vi.fn(async () => {}) }));

/** A complete, checksum-valid bundle in the old format 1 (no source identity). */
function formatOneBundle(directory: string): string {
  mkdirSync(directory, { recursive: true });
  const sql =
    "COPY storage.objects (bucket_id, name, version, metadata) FROM stdin;\n\\.\n";
  writeFileSync(join(directory, "database.sql"), sql);
  writeFileSync(
    join(directory, "manifest.json"),
    JSON.stringify({
      format: 1,
      dumpHash: createHash("sha256").update(sql).digest("hex"),
      objects: [],
      created: new Date(0).toISOString(),
    }),
  );
  return directory;
}

beforeEach(() => vi.stubEnv("MELLODIFAI_ROOT", fixture()));
afterEach(() => {
  vi.unstubAllEnvs();
  vi.clearAllMocks();
});

it("refuses a format-1 bundle for ordinary reads and restores", async () => {
  const bundle = formatOneBundle(join(nativeLayout("e2e").root, "old"));
  expect(() => readBackup(bundle, "e2e")).toThrow(/source identity/);
  await expect(
    nativeBackup(["restore", "--env", "e2e", bundle]),
  ).rejects.toThrow(/source identity/);
  expect(vi.mocked(restoreNativeData)).not.toHaveBeenCalled();
});

it("accepts a format-1 bundle only in recover-import for the backup a legacy journal names", async () => {
  const layout = nativeLayout("e2e");
  const bundle = formatOneBundle(join(layout.root, "before-import-old"));
  mkdirSync(layout.root, { recursive: true });
  writeFileSync(
    join(layout.root, "import-journal.json"),
    JSON.stringify({ phase: "applying", backup: bundle }),
  );
  await nativeBackup(["recover-import", "--env", "e2e", bundle]);
  expect(vi.mocked(restoreNativeData)).toHaveBeenCalledWith(
    "e2e",
    bundle,
    expect.any(Function),
    { allowLegacy: true },
  );
});

it("refuses a format-1 bundle in recover-import driven by a current journal", async () => {
  const layout = nativeLayout("e2e");
  const bundle = formatOneBundle(join(layout.root, "before-import-new"));
  await saveJournal(layout, {
    format: 1,
    operation: "import",
    phase: "applying",
    backup: bundle,
  });
  await expect(
    nativeBackup(["recover-import", "--env", "e2e", bundle]),
  ).rejects.toThrow(/source identity/);
  expect(vi.mocked(restoreNativeData)).not.toHaveBeenCalled();
});
