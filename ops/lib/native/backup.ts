import { createHash, randomUUID } from "node:crypto";
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  statSync,
} from "node:fs";
import { dirname, join } from "node:path";
import { parse } from "yaml";
import {
  getAttributeSync,
  setAttributeSync,
} from "../../native/storage/fs-xattr/index.js";
import { safeEntryPath } from "./zip.js";
export function safeFile(path: string): string {
  const safe = safeEntryPath(path);
  if (!safe) throw new Error("Invalid Storage file path");
  return safe;
}

import { runtimePath, type StackEnv, stackDir } from "../envs.js";
import { writePrivate } from "../private-file.js";
import { type Runner, realRunner } from "../run.js";
import { runtimeRoot } from "../runtime.js";
import { loadStackSecrets } from "../stack-secrets.js";
import { nativeTools } from "./build.js";
import { executable } from "./host.js";
import {
  compareLedgers,
  type DumpData,
  dataTables,
  importSql,
  parseDump,
  tableRows,
} from "./import-data.js";
import { nativeLayout } from "./layout.js";
import { baseEnvironment } from "./plan.js";
import {
  rebuildStorageMetadata,
  type StorageRow,
  storageFileLayout,
  storageObjectPath,
} from "./storage-metadata.js";

export function objectLayout(root: string) {
  const source = parse(
    readFileSync(new URL("../../compose/base.yml", import.meta.url), "utf8"),
  );
  return storageFileLayout(root, source.services.storage.environment);
}
export function objectRows(dump: DumpData): StorageRow[] {
  const table = dump.tables.find((entry) => entry.name === "storage.objects");
  if (!table) throw new Error("Missing storage.objects data");
  return tableRows(table).map((row) => ({
    bucket_id: row.bucket_id as string,
    name: row.name as string,
    version: row.version ?? null,
    metadata: row.metadata ? JSON.parse(row.metadata) : null,
  }));
}
export const fileHash = (path: string) =>
  createHash("sha256").update(readFileSync(path)).digest("hex");

/** Only reads already provisioned secrets. Check mode must never bootstrap. */
export async function nativeDatabase(
  env: StackEnv,
  runner: Runner = realRunner,
) {
  const layout = nativeLayout(env);
  const secretPath =
    env === "prod"
      ? join(runtimeRoot(), "secrets/supabase/native-logins.json")
      : join(stackDir(env), "native-logins.json");
  const logins = JSON.parse(readFileSync(secretPath, "utf8")) as Record<
    string,
    string
  >;
  const secrets = await loadStackSecrets(env);
  const tools = nativeTools();
  const privateEnv = {
    ...baseEnvironment(layout),
    PGPASSWORD: logins.supabase_admin as string,
    PGCLIENTENCODING: "UTF8",
    PGCONNECT_TIMEOUT: "10",
  };
  const connection = [
    "-h",
    "127.0.0.1",
    "-p",
    String(layout.ports.db),
    "-U",
    "supabase_admin",
    "-d",
    "postgres",
    "-w",
  ];
  const run = async (name: string, args: string[], input?: string) => {
    const reply = await runner(join(tools.pgBin, executable(name)), args, {
      env: privateEnv,
      ...(input === undefined ? {} : { input }),
    });
    if (reply.code !== 0)
      throw new Error(
        `Native ${name} failed (exit ${reply.code}); private subprocess output withheld`,
      );
    return reply.stdout;
  };
  return {
    layout,
    tools,
    logins,
    secrets,
    async dump() {
      return run("pg_dump", [
        ...connection,
        "--data-only",
        "--no-owner",
        "--no-privileges",
        "--schema=public",
        "--schema=auth",
        "--schema=storage",
        "--schema=supabase_migrations",
      ]);
    },
    async readArchive(file: string) {
      return parseDump(
        await run("pg_restore", [
          "--data-only",
          "--no-owner",
          "--no-privileges",
          "--schema=public",
          "--schema=auth",
          "--schema=storage",
          "--schema=supabase_migrations",
          "--file=-",
          file,
        ]),
      );
    },
    async execute(input: string) {
      return run(
        "psql",
        [
          ...connection,
          "-X",
          "-q",
          "-A",
          "-t",
          "-v",
          "ON_ERROR_STOP=1",
          "--single-transaction",
          "-f",
          "-",
        ],
        input,
      );
    },
  };
}
export interface BackupManifest {
  format: 1;
  dumpHash: string;
  objects: { row: StorageRow; hash: string }[];
  historical?: {
    path: string;
    hash: string;
    attributes: Record<string, string>;
  }[];
  created: string;
}
export async function backupNative(
  env: StackEnv,
  directory: string,
  runner: Runner = realRunner,
): Promise<string> {
  runtimePath(directory);
  if (existsSync(directory))
    throw new Error("Refusing to overwrite a native backup");
  const db = await nativeDatabase(env, runner);
  const dump = await db.dump();
  const rows = objectRows(parseDump(dump));
  const layout = objectLayout(db.layout.objects);
  // Refuse links, missing files and bad sizes before copying any private data.
  const report = rebuildStorageMetadata(layout, rows);
  if (
    report.missingFiles.length ||
    report.sizeMismatches.length ||
    report.invalidMetadata.length
  )
    throw new Error("Native backup Storage verification failed");
  mkdirSync(directory, { recursive: true });
  await writePrivate(join(directory, "database.sql"), dump);
  const objects: BackupManifest["objects"] = [];
  for (const row of rows) {
    const from = storageObjectPath(layout, row);
    const to = storageObjectPath(objectLayout(join(directory, "objects")), row);
    mkdirSync(dirname(to), { recursive: true });
    await writePrivate(to, "");
    copyFileSync(from, to);
    objects.push({ row, hash: fileHash(to) });
  }
  const historical: NonNullable<BackupManifest["historical"]> = [];
  for (const path of report.orphanFiles) {
    const from = join(layout.root, path);
    const to = join(directory, "objects", safeFile(path.replaceAll("\\", "/")));
    mkdirSync(dirname(to), { recursive: true });
    await writePrivate(to, "");
    copyFileSync(from, to);
    const attributes = Object.fromEntries(
      ["user.supabase.content-type", "user.supabase.cache-control"].map(
        (name) => [name, getAttributeSync(from, name).toString()],
      ),
    );
    historical.push({
      path: path.replaceAll("\\", "/"),
      hash: fileHash(to),
      attributes,
    });
  }
  // A complete manifest is the commit marker. Metadata is portable JSON, never ADS-dependent.
  await writePrivate(
    join(directory, "manifest.json"),
    JSON.stringify({
      format: 1,
      dumpHash: fileHash(join(directory, "database.sql")),
      objects,
      historical,
      created: new Date().toISOString(),
    } satisfies BackupManifest),
  );
  return directory;
}
export function readBackup(directory: string): {
  manifest: BackupManifest;
  dump: DumpData;
} {
  runtimePath(directory);
  const manifest = JSON.parse(
    readFileSync(join(directory, "manifest.json"), "utf8"),
  ) as BackupManifest;
  if (
    manifest.format !== 1 ||
    fileHash(join(directory, "database.sql")) !== manifest.dumpHash
  )
    throw new Error("Native backup checksum mismatch");
  const dump = parseDump(readFileSync(join(directory, "database.sql"), "utf8"));
  const rows = objectRows(dump);
  if (
    JSON.stringify(rows) !==
    JSON.stringify(manifest.objects.map((entry) => entry.row))
  )
    throw new Error("Native backup metadata mismatch");
  for (const item of manifest.objects) {
    const file = storageObjectPath(
      objectLayout(join(directory, "objects")),
      item.row,
    );
    if (
      fileHash(file) !== item.hash ||
      statSync(file).size !== item.row.metadata?.size
    )
      throw new Error("Native backup object checksum mismatch");
  }
  for (const item of manifest.historical ?? [])
    if (fileHash(join(directory, "objects", safeFile(item.path))) !== item.hash)
      throw new Error("Historical Storage checksum mismatch");
  return { manifest, dump };
}
/** Caller owns maintenance shutdown and rollback. Stage before any database write. */
export async function restoreNativeData(
  env: StackEnv,
  directory: string,
): Promise<void> {
  const { manifest, dump } = readBackup(directory);
  const db = await nativeDatabase(env);
  const current = parseDump(await db.dump());
  compareLedgers(dump, current);
  if (
    JSON.stringify(
      dataTables(dump)
        .map((table) => table.name)
        .sort(),
    ) !==
    JSON.stringify(
      dataTables(current)
        .map((table) => table.name)
        .sort(),
    )
  )
    throw new Error("Backup and native target tables differ");
  const stage = `${db.layout.objects}.restore-${randomUUID()}`;
  mkdirSync(stage);
  for (const { row } of manifest.objects) {
    const destination = storageObjectPath(objectLayout(stage), row);
    mkdirSync(dirname(destination), { recursive: true });
    copyFileSync(
      storageObjectPath(objectLayout(join(directory, "objects")), row),
      destination,
    );
  }
  rebuildStorageMetadata(objectLayout(stage), objectRows(dump), true);
  for (const item of manifest.historical ?? []) {
    const path = safeFile(item.path);
    const destination = join(stage, path);
    mkdirSync(dirname(destination), { recursive: true });
    copyFileSync(join(directory, "objects", path), destination);
    for (const name of [
      "user.supabase.content-type",
      "user.supabase.cache-control",
    ]) {
      const value = item.attributes[name];
      if (typeof value !== "string")
        throw new Error("Missing historical Storage metadata");
      setAttributeSync(destination, name, value);
    }
  }
  await db.execute(importSql(dump));
  // Preserve the old directory for manual recovery; never delete owner data.
  if (existsSync(db.layout.objects))
    renameSync(
      db.layout.objects,
      `${db.layout.objects}.before-restore-${randomUUID()}`,
    );
  renameSync(stage, db.layout.objects);
  const actual = parseDump(await db.dump());
  for (const table of dataTables(dump))
    if (
      actual.tables.find((item) => item.name === table.name)?.lines.length !==
      table.lines.length
    )
      throw new Error("Restored native row counts differ");
}
