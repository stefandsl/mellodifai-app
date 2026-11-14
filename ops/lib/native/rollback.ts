import { createHash } from "node:crypto";
import { existsSync, readFileSync, unlinkSync } from "node:fs";
import { join } from "node:path";
import { NativeDiagnosticError } from "./diagnostics.js";
import { durableJson } from "./journal.js";
import type { NativeLayout } from "./layout.js";
import type { AppliedMigration, MigrationFile } from "./migrate.js";

export interface SchemaRollback {
  format: 1;
  release: string;
  releaseHead: string;
  ledgerHead: string;
  latestVersion: string;
  /** Where the marker was read from; never written into the file. */
  path?: string;
}
export const rollbackPath = (layout: NativeLayout) =>
  join(layout.root, "schema-rollback.json");
export const rollbackHash = (
  rows: { version: string; sha256: string | null }[],
) =>
  createHash("sha256")
    .update(
      JSON.stringify(
        [...rows]
          .sort((a, b) => a.version.localeCompare(b.version))
          .map(({ version, sha256 }) => ({ version, sha256 })),
      ),
    )
    .digest("hex");
export function readRollback(layout: NativeLayout): SchemaRollback | undefined {
  const path = rollbackPath(layout);
  if (!existsSync(path)) return undefined;
  const marker = JSON.parse(readFileSync(path, "utf8")) as SchemaRollback;
  return { ...marker, path };
}
export function validateRollback(
  marker: SchemaRollback,
  files: MigrationFile[],
  applied: AppliedMigration[],
): void {
  if (
    marker.format !== 1 ||
    marker.ledgerHead !== rollbackHash(applied) ||
    marker.releaseHead !== rollbackHash(files) ||
    marker.latestVersion !==
      applied
        .map((row) => row.version)
        .sort()
        .at(-1) ||
    // Every file of the older release must be the exact text its ledger row ran.
    files.some(
      (file) =>
        !applied.some(
          (row) => row.version === file.version && row.sha256 === file.sha256,
        ),
    )
  )
    throw new NativeDiagnosticError(
      `Recorded schema rollback ${marker.path ?? "schema-rollback.json"} does not match this exact ledger and release; startup refused. Deploy the release it names, or remove the marker only after reviewing that this release accepts the current schema`,
    );
}
/** Restore, import and recovery replace the data the marker was bound to.
 * Keep the marker only if it still exactly fits the running release and the
 * ledger now in the database (re-recorded); otherwise remove it, so startup
 * plans normally and refuses an unknown forward schema on its own terms.
 */
export async function refreshRollback(
  layout: NativeLayout,
  files: MigrationFile[],
  applied: AppliedMigration[],
): Promise<"none" | "kept" | "cleared"> {
  if (!existsSync(rollbackPath(layout))) return "none";
  let release: string | undefined;
  try {
    const marker = readRollback(layout);
    if (marker && marker.releaseHead === rollbackHash(files))
      release = marker.release;
  } catch {
    // An unreadable marker can never authorize anything.
  }
  if (
    release !== undefined &&
    applied.some((row) => !files.some((file) => file.version === row.version))
  )
    try {
      await recordRollback(layout, release, files, applied);
      return "kept";
    } catch {
      // Falls through: the marker no longer fits this ledger.
    }
  clearRollback(layout);
  return "cleared";
}
export async function recordRollback(
  layout: NativeLayout,
  release: string,
  files: MigrationFile[],
  applied: AppliedMigration[],
): Promise<void> {
  if (
    !applied.length ||
    applied.some((row) => !row.sha256 || !/^[a-f0-9]{64}$/.test(row.sha256))
  )
    throw new NativeDiagnosticError(
      "Cannot record rollback without a complete native checksum ledger",
    );
  const marker: SchemaRollback = {
    format: 1,
    release,
    releaseHead: rollbackHash(files),
    ledgerHead: rollbackHash(applied),
    latestVersion: applied
      .map((row) => row.version)
      .sort()
      .at(-1) as string,
  };
  validateRollback(marker, files, applied);
  await durableJson(rollbackPath(layout), marker);
}
export function clearRollback(layout: NativeLayout): void {
  if (existsSync(rollbackPath(layout))) unlinkSync(rollbackPath(layout));
}
