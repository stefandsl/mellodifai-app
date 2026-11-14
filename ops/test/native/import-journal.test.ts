import { existsSync } from "node:fs";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { backupNative } from "../../lib/native/backup.js";
import { assertNoMaintenance, journalPath } from "../../lib/native/journal.js";
import { nativeLayout } from "../../lib/native/layout.js";
import { nativeBackup } from "../../native-backup.js";
import { prepareImport } from "../../native-prepare-import.js";
import { fixture } from "./fixtures.js";

const seeds: Record<string, number> = {
  "public.app_flags": 5,
  "public.oauth_pairing": 1,
  "public.price_book": 14,
  "public.provider_operations": 21,
  "public.scheduled_tasks": 5,
  "public.spend_caps": 6,
  "public.stack_settings": 1,
  "storage.buckets": 2,
};
let tables = seeds;
const dump = () =>
  Object.entries(tables)
    .map(([name, count]) =>
      [
        `COPY ${name} (id) FROM stdin;`,
        ...Array.from({ length: count }, (_, i) => String(i)),
        "\\.",
      ].join("\n"),
    )
    .join("\n");

vi.mock("../../lib/native/lease.js", () => ({
  withStackLease: async (_env: string, _cmd: string, fn: () => unknown) => fn(),
  assertStackLease: () => {},
}));
vi.mock("../../lib/native/maintenance.js", () => ({
  maintenanceDatabase: async () => ({
    db: { dump: async () => dump(), execute: vi.fn(async () => "") },
    stop: async () => {},
  }),
}));
vi.mock("../../lib/native/backup.js", () => ({
  backupNative: vi.fn(async () => ""),
  readBackup: vi.fn(),
  restoreNativeData: vi.fn(async () => {}),
  refreshSchemaRollback: vi.fn(async () => "none"),
}));
vi.mock("../../stack.js", () => ({ runStack: vi.fn(async () => {}) }));

beforeEach(() => {
  vi.stubEnv("MELLODIFAI_ROOT", fixture());
  tables = seeds;
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.clearAllMocks();
});

const prepare = () =>
  prepareImport([
    "--env",
    "e2e",
    `${nativeLayout("e2e").root}/prepare-backup`,
    "--apply",
  ]);

it("a preparation refused before any change leaves no journal, so normal start is allowed", async () => {
  tables = { ...seeds, "public.projects": 1 };
  await expect(prepare()).rejects.toThrow("Not a fresh bootstrap");
  expect(existsSync(journalPath(nativeLayout("e2e")))).toBe(false);
  expect(() => assertNoMaintenance(nativeLayout("e2e"))).not.toThrow();
  expect(vi.mocked(backupNative)).not.toHaveBeenCalled();
});

it("a preparation whose backup fails before any data change leaves no journal", async () => {
  vi.mocked(backupNative).mockRejectedValueOnce(
    new Error("Native backup Storage verification failed"),
  );
  await expect(prepare()).rejects.toThrow("Storage verification failed");
  expect(() => assertNoMaintenance(nativeLayout("e2e"))).not.toThrow();
});

it("a completed preparation keeps its journal for the import", async () => {
  await prepare();
  expect(() => assertNoMaintenance(nativeLayout("e2e"))).toThrow(
    "maintenance is pending",
  );
});

it("a restore whose safety backup fails before any data change leaves no journal", async () => {
  vi.mocked(backupNative).mockRejectedValueOnce(
    new Error("Native backup Storage verification failed"),
  );
  await expect(
    nativeBackup([
      "restore",
      "--env",
      "e2e",
      `${nativeLayout("e2e").root}/some-backup`,
    ]),
  ).rejects.toThrow("Storage verification failed");
  expect(() => assertNoMaintenance(nativeLayout("e2e"))).not.toThrow();
});
