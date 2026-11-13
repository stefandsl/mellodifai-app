import { existsSync, lstatSync, readdirSync, realpathSync } from "node:fs";
import { isAbsolute, join, relative, resolve, sep } from "node:path";
import {
  getAttributeSync,
  setAttributeSync,
} from "../../native/storage/fs-xattr/index.js";
import { safeEntryPath } from "./zip.js";

export interface StorageRow {
  bucket_id: string;
  name: string;
  version: string | null;
  metadata: {
    mimetype?: unknown;
    cacheControl?: unknown;
    size?: unknown;
  } | null;
}
export interface StorageFileLayout {
  root: string;
  internalBucket: string;
  tenant: string;
  fileVersionSeparator: boolean;
}
export const STORAGE_ATTRIBUTES = {
  mimetype: "user.supabase.content-type",
  cacheControl: "user.supabase.cache-control",
} as const;

/** Storage v1.84.19: TenantLocation.getKeyLocation (src/storage/locator.ts),
 * withOptionalVersion (backend/adapter.ts), and FileBackend (backend/file.ts).
 * The default separator is '/', with '-$v-' only when explicitly enabled.
 * The internal S3 bucket is a filesystem prefix even for the file backend.
 */
export function storageObjectPath(
  layout: StorageFileLayout,
  row: StorageRow,
): string {
  for (const component of [
    layout.internalBucket,
    layout.tenant,
    row.bucket_id,
    ...(row.version ? [row.version] : []),
  ])
    if (!component || component.includes("/") || component.includes("\\"))
      throw new Error("Invalid Storage path component");
  const versioned =
    row.name +
    (row.version
      ? `${layout.fileVersionSeparator ? "-$v-" : "/"}${row.version}`
      : "");
  const key = `${layout.internalBucket}/${layout.tenant}/${row.bucket_id}/${versioned}`;
  const safe = safeEntryPath(key);
  if (!safe) throw new Error("Invalid Storage object path");
  return resolve(layout.root, safe);
}

export function storageFileLayout(
  root: string,
  environment: Record<string, string>,
): StorageFileLayout {
  const internalBucket =
    environment.STORAGE_S3_BUCKET || environment.GLOBAL_S3_BUCKET;
  if (!internalBucket || environment.IS_MULTITENANT === "true")
    throw new Error(
      "Storage metadata requires a configured single-tenant file backend",
    );
  return {
    root,
    internalBucket,
    tenant:
      environment.PROJECT_REF ||
      environment.TENANT_ID ||
      "storage-single-tenant",
    fileVersionSeparator: environment.TUS_USE_FILE_VERSION_SEPARATOR === "true",
  };
}

export interface MetadataReport {
  rows: number;
  missingFiles: string[];
  orphanFiles: string[];
  sizeMismatches: { file: string; expected: number; actual: number }[];
  attributeMismatches: {
    file: string;
    attribute: string;
    expected: string;
    actual: string | null;
  }[];
  invalidMetadata: string[];
  updated: number;
}
export interface AttributeStore {
  get(path: string, attribute: string): Buffer;
  set(path: string, attribute: string, value: string): void;
}

/** Never follows links or changes database rows or object bytes. Check does
 * not write anything. Apply repairs only the two attributes present in SQL;
 * missing metadata is reported rather than replaced with guessed defaults.
 */
export function rebuildStorageMetadata(
  layout: StorageFileLayout,
  rows: StorageRow[],
  apply = false,
  attributes: AttributeStore = { get: getAttributeSync, set: setAttributeSync },
): MetadataReport {
  const root = resolve(layout.root);
  const paths = rows.map((row) => ({
    row,
    path: storageObjectPath(layout, row),
  }));
  const files = new Set<string>();
  const visit = (directory: string) => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name);
      if (entry.isSymbolicLink())
        throw new Error("Storage metadata refuses filesystem links");
      if (entry.isDirectory()) visit(path);
      else if (entry.isFile()) files.add(path);
    }
  };
  if (existsSync(root)) {
    if (lstatSync(root).isSymbolicLink())
      throw new Error("Storage metadata refuses filesystem links");
    visit(root);
  }
  const report: MetadataReport = {
    rows: rows.length,
    missingFiles: [],
    orphanFiles: [],
    sizeMismatches: [],
    attributeMismatches: [],
    invalidMetadata: [],
    updated: 0,
  };
  const expectedFiles = new Set(paths.map((item) => item.path));
  report.orphanFiles = [...files]
    .filter((path) => !expectedFiles.has(path))
    .map((path) => relative(root, path))
    .sort();
  for (const { row, path } of paths) {
    const file = relative(root, path);
    if (!files.has(path)) {
      report.missingFiles.push(file);
      continue;
    }
    const canonical = relative(realpathSync(root), realpathSync(path));
    if (
      canonical === ".." ||
      canonical.startsWith(`..${sep}`) ||
      isAbsolute(canonical)
    )
      throw new Error("Storage object escapes the storage root");
    const size = lstatSync(path).size;
    if (typeof row.metadata?.size === "number" && row.metadata.size !== size)
      report.sizeMismatches.push({
        file,
        expected: row.metadata.size,
        actual: size,
      });
    if (typeof row.metadata?.size !== "number")
      report.invalidMetadata.push(`${file}:size`);
    for (const [field, attribute] of Object.entries(STORAGE_ATTRIBUTES)) {
      const expected = row.metadata?.[field as keyof typeof STORAGE_ATTRIBUTES];
      if (typeof expected !== "string") {
        report.invalidMetadata.push(`${file}:${field}`);
        continue;
      }
      let actual: string | null;
      try {
        actual = attributes.get(path, attribute).toString();
      } catch (error) {
        if (
          !["ENODATA", "ENOATTR"].includes(
            (error as NodeJS.ErrnoException).code ?? "",
          )
        )
          throw error;
        actual = null;
      }
      if (actual === expected) continue;
      report.attributeMismatches.push({ file, attribute, expected, actual });
      if (apply) {
        attributes.set(path, attribute, expected);
        report.updated++;
      }
    }
  }
  return report;
}
