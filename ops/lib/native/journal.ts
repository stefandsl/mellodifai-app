import { randomUUID } from "node:crypto";
import {
  closeSync,
  existsSync,
  fsyncSync,
  openSync,
  readFileSync,
  renameSync,
  unlinkSync,
} from "node:fs";
import { join } from "node:path";
import { writePrivate } from "../private-file.js";
import type { NativeLayout } from "./layout.js";

export interface MaintenanceJournal {
  format: 1;
  operation: "import" | "restore" | "prepare-import";
  phase: "preparing" | "applying" | "prepared";
  backup: string;
}
export const journalPath = (layout: NativeLayout) =>
  join(layout.root, "maintenance-journal.json");

/** Flush the complete new record before atomic publication. No partially written
 * JSON can replace a previous durable record. Unknown/corrupt records fail closed.
 */
export async function durableJson(path: string, value: unknown): Promise<void> {
  const temp = `${path}.${randomUUID()}.tmp`;
  await writePrivate(temp, JSON.stringify(value));
  flushFile(temp);
  renameSync(temp, path);
  flushFile(path);
}
export function flushFile(path: string): void {
  const fd = openSync(path, "r+");
  try {
    fsyncSync(fd);
  } finally {
    closeSync(fd);
  }
}
export function readJournal(
  layout: NativeLayout,
): MaintenanceJournal | undefined {
  const path = journalPath(layout);
  if (!existsSync(path)) return undefined;
  const value = JSON.parse(readFileSync(path, "utf8")) as MaintenanceJournal;
  if (
    value.format !== 1 ||
    !["import", "restore", "prepare-import"].includes(value.operation) ||
    !["preparing", "applying", "prepared"].includes(value.phase) ||
    typeof value.backup !== "string"
  )
    throw new Error("Invalid maintenance journal; manual recovery required");
  return value;
}
export function assertNoMaintenance(layout: NativeLayout): void {
  if (existsSync(journalPath(layout)))
    throw new Error(
      "Native maintenance is pending; recover with native-backup.ts recover-import using the backup in maintenance-journal.json before start",
    );
  const legacy = join(layout.root, "import-journal.json");
  if (
    existsSync(legacy) &&
    !["complete", "rolled-back"].includes(
      JSON.parse(readFileSync(legacy, "utf8")).phase,
    )
  )
    throw new Error(
      "Legacy import maintenance is pending; recover its backup before start",
    );
}
export async function saveJournal(
  layout: NativeLayout,
  journal: MaintenanceJournal,
): Promise<void> {
  await durableJson(journalPath(layout), journal);
}
export function clearJournal(layout: NativeLayout): void {
  if (existsSync(journalPath(layout))) unlinkSync(journalPath(layout));
}
