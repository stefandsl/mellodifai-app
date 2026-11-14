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
}
export const rollbackPath = (layout: NativeLayout) =>
  join(layout.root, "schema-rollback.json");
const hash = (rows: { version: string; sha256: string | null }[]) =>
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
  return existsSync(path)
    ? (JSON.parse(readFileSync(path, "utf8")) as SchemaRollback)
    : undefined;
}
export function validateRollback(
  marker: SchemaRollback,
  files: MigrationFile[],
  applied: AppliedMigration[],
): void {
  if (
    marker.format !== 1 ||
    marker.ledgerHead !== hash(applied) ||
    marker.releaseHead !== hash(files) ||
    marker.latestVersion !==
      applied
        .map((row) => row.version)
        .sort()
        .at(-1) ||
    files.some((file) => !applied.some((row) => row.version === file.version))
  )
    throw new NativeDiagnosticError(
      "Recorded schema rollback does not match this exact ledger and release; startup refused",
    );
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
    releaseHead: hash(files),
    ledgerHead: hash(applied),
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
