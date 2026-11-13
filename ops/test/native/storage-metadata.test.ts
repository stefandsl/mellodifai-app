import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { expect, it, vi } from "vitest";
import {
  rebuildStorageMetadata,
  type StorageRow,
  storageFileLayout,
  storageObjectPath,
} from "../../lib/native/storage-metadata.js";
import { getAttributeSync } from "../../native/storage/fs-xattr/index.js";
import { metadataArguments } from "../../storage-metadata.js";
import { fixture } from "./fixtures.js";

it("uses the pinned internal bucket, tenant and optional version layout", () => {
  const root = fixture();
  const layout = storageFileLayout(root, {
    GLOBAL_S3_BUCKET: "internal",
    TENANT_ID: "tenant",
  });
  const row: StorageRow = {
    bucket_id: "bucket",
    name: "folder/object.mp3",
    version: "version",
    metadata: null,
  };
  expect(storageObjectPath(layout, row)).toBe(
    join(root, "internal/tenant/bucket/folder/object.mp3/version"),
  );
  expect(
    storageObjectPath({ ...layout, fileVersionSeparator: true }, row),
  ).toBe(join(root, "internal/tenant/bucket/folder/object.mp3-$v-version"));
  expect(storageObjectPath(layout, { ...row, version: null })).toBe(
    join(root, "internal/tenant/bucket/folder/object.mp3"),
  );
  expect(() =>
    storageObjectPath(layout, { ...row, name: "../escape" }),
  ).toThrow("escapes");
});
it("check reports every discrepancy without writing; apply restores attributes and is idempotent", () => {
  const root = fixture();
  const layout = storageFileLayout(root, {
    GLOBAL_S3_BUCKET: "stub",
    TENANT_ID: "stub",
  });
  const rows: StorageRow[] = [
    {
      bucket_id: "bucket",
      name: "found",
      version: "v1",
      metadata: { size: 9, mimetype: "audio/mpeg", cacheControl: "max-age=90" },
    },
    { bucket_id: "bucket", name: "missing", version: null, metadata: null },
  ];
  const path = storageObjectPath(layout, rows[0] as StorageRow);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, "bytes");
  writeFileSync(join(root, "orphan"), "orphan");
  const values = new Map<string, string>();
  values.set("user.supabase.cache-control", "no-cache");
  const attributes = {
    get: vi.fn((_path: string, attribute: string) => {
      const value = values.get(attribute);
      if (value === undefined)
        throw Object.assign(new Error("missing"), { code: "ENODATA" });
      return Buffer.from(value);
    }),
    set: vi.fn((_path: string, attribute: string, value: string) => {
      values.set(attribute, value);
    }),
  };
  const check = rebuildStorageMetadata(layout, rows, false, attributes);
  expect(check.missingFiles).toEqual([join("stub/stub/bucket/missing")]);
  expect(check.orphanFiles).toEqual(["orphan"]);
  expect(check.sizeMismatches).toEqual([
    { file: join("stub/stub/bucket/found/v1"), expected: 9, actual: 5 },
  ]);
  expect(check.attributeMismatches.map((item) => item.attribute)).toEqual([
    "user.supabase.content-type",
    "user.supabase.cache-control",
  ]);
  expect(attributes.set).not.toHaveBeenCalled();
  expect(rebuildStorageMetadata(layout, rows, true, attributes).updated).toBe(
    2,
  );
  expect(attributes.set).toHaveBeenCalledWith(
    path,
    "user.supabase.content-type",
    "audio/mpeg",
  );
  expect(attributes.set).toHaveBeenCalledWith(
    path,
    "user.supabase.cache-control",
    "max-age=90",
  );
  expect(rebuildStorageMetadata(layout, rows, true, attributes).updated).toBe(
    0,
  );
  expect(readFileSync(path, "utf8")).toBe("bytes");
});
it("defaults to check and rejects conflicting or unknown modes", () => {
  expect(metadataArguments(["--env", "e2e"])).toEqual({
    env: "e2e",
    apply: false,
  });
  expect(metadataArguments(["--env", "e2e", "--apply"]).apply).toBe(true);
  expect(() =>
    metadataArguments(["--env", "e2e", "--check", "--apply"]),
  ).toThrow("Usage");
  expect(() => metadataArguments(["--env", "unknown"])).toThrow("valid --env");
});

it.skipIf(process.platform !== "win32")(
  "restores real streams on a copied file without changing its bytes",
  () => {
    const layout = storageFileLayout(fixture(), {
      GLOBAL_S3_BUCKET: "internal",
    });
    const row: StorageRow = {
      bucket_id: "bucket",
      name: "copied",
      version: "v1",
      metadata: { size: 5, mimetype: "audio/mpeg", cacheControl: "max-age=60" },
    };
    const path = storageObjectPath(layout, row);
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, "bytes");
    expect(
      rebuildStorageMetadata(layout, [row]).attributeMismatches,
    ).toHaveLength(2);
    expect(rebuildStorageMetadata(layout, [row], true).updated).toBe(2);
    expect(
      getAttributeSync(path, "user.supabase.content-type").toString(),
    ).toBe("audio/mpeg");
    expect(
      getAttributeSync(path, "user.supabase.cache-control").toString(),
    ).toBe("max-age=60");
    expect(rebuildStorageMetadata(layout, [row]).attributeMismatches).toEqual(
      [],
    );
    expect(readFileSync(path, "utf8")).toBe("bytes");
  },
);
