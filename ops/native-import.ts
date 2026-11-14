import { randomUUID } from "node:crypto";
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  statSync,
} from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { ENV_TABLE, type StackEnv } from "./lib/envs.js";
import {
  backupNative,
  fileHash,
  nativeDatabase,
  objectLayout,
  objectRows,
  readBackup,
  refreshSchemaRollback,
  restoreNativeData,
  safeFile,
} from "./lib/native/backup.js";
import {
  assertEmptyTarget,
  compareLedgers,
  counts,
  type DumpData,
  dataTables,
  importSql,
  parseDump,
  tableDigest,
  tableRows,
} from "./lib/native/import-data.js";
import {
  assertNoMaintenance,
  clearJournal,
  preparing,
  readJournal,
  saveJournal,
} from "./lib/native/journal.js";
import { nativeLayout, resolveRuntime } from "./lib/native/layout.js";
import { withStackLease } from "./lib/native/lease.js";
import { maintenanceDatabase } from "./lib/native/maintenance.js";
import { superuserConnection } from "./lib/native/postgres.js";
import {
  rebuildStorageMetadata,
  storageObjectPath,
} from "./lib/native/storage-metadata.js";
import { writePrivate } from "./lib/private-file.js";
import { setAttributeSync } from "./native/storage/fs-xattr/index.js";
import { runStack } from "./stack.js";

export interface ImportOptions {
  from: string;
  env: StackEnv;
  apply: boolean;
  replaceEmptyOnly: boolean;
  confirmProduction: boolean;
}
export function importArguments(args: string[]): ImportOptions {
  const result: ImportOptions = {
    from: "",
    env: "e2e",
    apply: false,
    replaceEmptyOnly: false,
    confirmProduction: false,
  };
  const seen = new Set<string>();
  for (let i = 0; i < args.length; i++) {
    const key = args[i] as string;
    const group = key === "--apply" || key === "--check" ? "mode" : key;
    if (seen.has(group)) throw new Error("Duplicate native import argument");
    seen.add(group);
    if (key === "--from") result.from = args[++i] ?? "";
    else if (key === "--env") result.env = args[++i] as StackEnv;
    else if (key === "--apply") result.apply = true;
    else if (key === "--check") result.apply = false;
    else if (key === "--replace-empty-only") result.replaceEmptyOnly = true;
    else if (key === "--confirm-production") result.confirmProduction = true;
    else throw new Error("Unknown native import argument");
  }
  if (
    !result.from ||
    !seen.has("--env") ||
    !Object.hasOwn(ENV_TABLE, result.env)
  )
    throw new Error(
      "Usage: native-import.ts --from <recovery directory> --env <env> [--check|--apply] [--replace-empty-only] [--confirm-production]",
    );
  if (result.env === "prod" && !result.confirmProduction)
    throw new Error("Production import requires --confirm-production");
  if (result.apply && !result.replaceEmptyOnly)
    throw new Error(
      "Apply requires --replace-empty-only; only a bootstrapped empty database is accepted",
    );
  return result;
}
const expected: Record<string, number> = {
  "auth.users": 15,
  "public.projects": 18,
  "public.versions": 28,
  "public.jobs": 24,
  "storage.objects": 101,
  "public.audit_log": 2180,
};
function validateRecovered(dump: DumpData): void {
  const found = counts(dump);
  for (const [name, count] of Object.entries(expected))
    if (found[name] !== count)
      throw new Error(`Recovered count mismatch: ${name}`);
  const settings = dump.tables.find(
    (table) => table.name === "public.stack_settings",
  );
  if (
    !settings ||
    tableRows(settings).length !== 1 ||
    tableRows(settings)[0]?.fake_stack !== "f"
  )
    throw new Error(
      "Offline recovery requires production provenance with fake_stack=false",
    );
  const ledger = dump.tables.find(
    (table) => table.name === "supabase_migrations.schema_migrations",
  );
  if (
    ledger?.lines.length !== 54 ||
    tableRows(ledger)
      .map((row) => row.version)
      .sort()
      .at(-1) !== "20261103080001"
  )
    throw new Error("Offline recovery migration provenance mismatch");
}
async function verifyData(env: StackEnv, source: DumpData) {
  const db = await nativeDatabase(env);
  const actual = parseDump(await db.dump());
  for (const table of dataTables(source)) {
    const other = actual.tables.find((item) => item.name === table.name);
    if (!other || tableDigest(table) !== tableDigest(other))
      throw new Error(`Imported data differs: ${table.name}`);
  }
  return counts(actual);
}
async function verifyApis(env: StackEnv, source: DumpData) {
  const db = await nativeDatabase(env);
  const headers = {
    apikey: db.secrets.service,
    Authorization: `Bearer ${db.secrets.service}`,
  };
  const base = `http://127.0.0.1:${db.layout.ports.api}`;
  for (const row of objectRows(source).slice(0, 5)) {
    const response = await fetch(
      `${base}/storage/v1/object/authenticated/${encodeURIComponent(row.bucket_id)}/${row.name.split("/").map(encodeURIComponent).join("/")}`,
      { headers, signal: AbortSignal.timeout(30_000) },
    );
    const bytes = Buffer.from(await response.arrayBuffer());
    const local = readFileSync(
      storageObjectPath(objectLayout(db.layout.objects), row),
    );
    if (
      !response.ok ||
      !bytes.equals(local) ||
      response.headers.get("content-type")?.split(";")[0] !==
        row.metadata?.mimetype
    )
      throw new Error("Gateway Storage sample verification failed");
  }
  const users = source.tables.find((table) => table.name === "auth.users");
  const id = users && tableRows(users)[0]?.id;
  const response = await fetch(`${base}/auth/v1/admin/users/${id}`, {
    headers,
    signal: AbortSignal.timeout(15_000),
  });
  if (!response.ok || ((await response.json()) as { id?: string }).id !== id)
    throw new Error("Auth admin user verification failed");
  return {
    downloads: 5,
    authAdminUser: true,
    patRows: counts(source)["public.agent_tokens"],
    oauthStoreRows: counts(source)["public.oauth_store"],
    oauthClientRows: counts(source)["auth.oauth_clients"],
    authSessions: counts(source)["auth.sessions"],
  };
}
export async function nativeImport(
  options: ImportOptions,
  log = console.log,
  checkpoint: (step: string) => Promise<void> = async () => {},
): Promise<void> {
  return withStackLease(options.env, "import", () =>
    nativeImportLocked(options, log, checkpoint),
  );
}
async function nativeImportLocked(
  options: ImportOptions,
  log: (message: string) => void,
  checkpoint: (step: string) => Promise<void>,
): Promise<void> {
  if (options.env === "prod" && !options.confirmProduction)
    throw new Error("Production import requires --confirm-production");
  if (options.apply && !options.replaceEmptyOnly)
    throw new Error("Apply requires --replace-empty-only");
  if (resolveRuntime(undefined) !== "native")
    throw new Error("native-import requires the native runtime");
  const layout = nativeLayout(options.env);
  if (existsSync(join(resolve(options.from), "manifest.json")))
    readBackup(resolve(options.from), options.env);
  if (readJournal(layout)?.phase !== "prepared") assertNoMaintenance(layout);
  if (!existsSync(join(layout.root, "first-boot.done")))
    throw new Error("Target must be a freshly bootstrapped native stack");
  let maintenance: Awaited<ReturnType<typeof maintenanceDatabase>> | undefined =
    await maintenanceDatabase(options.env);
  try {
    const db = maintenance.db;
    const source = await db.readArchive(
      join(resolve(options.from), "prod-full.dump"),
    );
    validateRecovered(source);
    const target = parseDump(await db.dump());
    compareLedgers(source, target);
    const sourceNames = dataTables(source)
      .map((table) => table.name)
      .sort();
    if (
      JSON.stringify(sourceNames) !==
      JSON.stringify(
        dataTables(target)
          .map((table) => table.name)
          .sort(),
      )
    )
      throw new Error("Source and target data tables differ");
    const sql = superuserConnection(layout, db.logins);
    let policies: string;
    try {
      const roles = new Set(
        (await sql`select rolname from pg_roles`).map((row) => row.rolname),
      );
      const users = source.tables.find((table) => table.name === "auth.users");
      for (const row of users ? tableRows(users) : [])
        if (row.role && !roles.has(row.role))
          throw new Error(
            "Recovered Auth data refers to a missing database role",
          );
      policies = JSON.stringify(
        await sql`select schemaname, tablename, policyname, roles, cmd, qual, with_check from pg_policies order by schemaname, tablename, policyname`,
      );
      if (policies === "[]") throw new Error("Target has no RLS policies");
    } finally {
      await sql.end();
    }
    const rows = objectRows(source);
    const recoveryLayout = {
      ...objectLayout(join(resolve(options.from), "r3/storage")),
      internalBucket: "stub",
      tenant: "stub",
      fileVersionSeparator: false,
    };
    // The recovery manifest is read only. SQL metadata is authoritative for current versions.
    const manifest = readFileSync(
      join(resolve(options.from), "r3/storage.manifest.jsonl"),
      "utf8",
    )
      .trim()
      .split(/\r?\n/)
      .map((line) => JSON.parse(line))
      .filter((entry) => entry.type === "file");
    if (manifest.length !== 181)
      throw new Error("Unexpected recovered Storage manifest count");
    const recoveredMetadata = rebuildStorageMetadata(
      recoveryLayout,
      rows,
      false,
      {
        get: () => Buffer.from(""),
        set: () => {
          throw new Error("Recovery is read only");
        },
      },
    );
    if (
      recoveredMetadata.missingFiles.length ||
      recoveredMetadata.sizeMismatches.length ||
      recoveredMetadata.invalidMetadata.length
    )
      throw new Error("Recovered Storage metadata is incomplete");
    const sourceHashes = new Map<string, string>();
    for (const entry of manifest) {
      const path = safeFile(entry.path);
      if (!path.startsWith("stub/stub/") || sourceHashes.has(path))
        throw new Error("Invalid or duplicate recovered Storage path");
      for (const name of [
        "user.supabase.content-type",
        "user.supabase.cache-control",
      ])
        if (typeof entry.xattr?.[name] !== "string")
          throw new Error("Missing recovered Storage metadata");
      sourceHashes.set(path, fileHash(join(recoveryLayout.root, path)));
    }
    for (const row of rows) {
      const path = storageObjectPath(recoveryLayout, row);
      if (statSync(path).size !== row.metadata?.size)
        throw new Error("Recovered Storage size mismatch");
      const entry = manifest.find(
        (item) =>
          item.path ===
          relative(recoveryLayout.root, path).replaceAll("\\", "/"),
      );
      if (
        !entry ||
        entry.xattr?.["user.supabase.content-type"] !==
          row.metadata?.mimetype ||
        entry.xattr?.["user.supabase.cache-control"] !==
          row.metadata?.cacheControl
      )
        throw new Error("Recovery manifest metadata differs from database");
    }
    assertEmptyTarget(target);
    log(
      JSON.stringify({
        mode: options.apply ? "apply" : "check",
        counts: counts(source),
        ledgers: "match",
        storageFiles: rows.length,
        historicalFiles: manifest.length,
        passwords: "native logins preserved",
        action:
          "backup, stop writers, transactional data import, copy and rebuild metadata, verify",
      }),
    );
    if (!options.apply) return;
    const journal = join(layout.root, "import-journal.json");
    const started = Date.now();
    const backup = join(layout.root, `before-import-${randomUUID()}`);
    let backedUp = false;
    try {
      if (existsSync(journal)) {
        const prior = JSON.parse(readFileSync(journal, "utf8"));
        if (prior.phase !== "complete" && prior.phase !== "rolled-back")
          throw new Error(
            "Interrupted import exists; run native-backup.ts recover-import before retrying",
          );
      }
      assertEmptyTarget(parseDump(await maintenance.db.dump()));
      // A refusal or failure before any data change leaves no journal.
      await preparing(layout, { format: 1, operation: "import", backup }, () =>
        backupNative(options.env, backup, undefined, checkpoint),
      );
      backedUp = true;
      await saveJournal(layout, {
        format: 1,
        operation: "import",
        phase: "applying",
        backup,
      });
      await writePrivate(
        journal,
        JSON.stringify({ phase: "applying", backup }),
      );
      const stage = join(layout.root, `import-objects-${randomUUID()}`);
      mkdirSync(stage);
      for (const row of rows) {
        const from = storageObjectPath(recoveryLayout, row);
        const to = storageObjectPath(objectLayout(stage), row);
        mkdirSync(dirname(to), { recursive: true });
        copyFileSync(from, to);
        if (fileHash(from) !== fileHash(to))
          throw new Error("Copied Storage hash mismatch");
      }
      rebuildStorageMetadata(objectLayout(stage), rows, true);
      const current = new Set(
        rows.map((row) =>
          relative(
            recoveryLayout.root,
            storageObjectPath(recoveryLayout, row),
          ).replaceAll("\\", "/"),
        ),
      );
      for (const entry of manifest) {
        if (current.has(entry.path)) continue;
        const path = safeFile(entry.path);
        if (!path.startsWith("stub/stub/"))
          throw new Error("Unexpected historical Storage prefix");
        const destination = join(stage, path);
        mkdirSync(dirname(destination), { recursive: true });
        copyFileSync(join(recoveryLayout.root, path), destination);
        if (sourceHashes.get(path) !== fileHash(destination))
          throw new Error("Historical Storage copy hash mismatch");
        for (const name of [
          "user.supabase.content-type",
          "user.supabase.cache-control",
        ]) {
          if (typeof entry.xattr?.[name] !== "string")
            throw new Error("Missing recovered Storage metadata");
          setAttributeSync(destination, name, entry.xattr[name]);
        }
      }
      await maintenance.db.execute(importSql(source));
      await checkpoint("database-committed");
      renameSync(
        layout.objects,
        `${layout.objects}.before-import-${randomUUID()}`,
      );
      await checkpoint("between-renames");
      renameSync(stage, layout.objects);
      await verifyData(options.env, source);
      const check = superuserConnection(layout, db.logins);
      try {
        if (
          JSON.stringify(
            await check`select schemaname, tablename, policyname, roles, cmd, qual, with_check from pg_policies order by schemaname, tablename, policyname`,
          ) !== policies
        )
          throw new Error("RLS policies changed during import");
      } finally {
        await check.end();
      }
      await refreshSchemaRollback(options.env, await maintenance.db.dump());
      await maintenance.stop();
      maintenance = undefined;
      await writePrivate(
        journal,
        JSON.stringify({ phase: "complete", backup }),
      );
      clearJournal(layout);
      await runStack("start", options.env, { runtime: "native" });
      const api = await verifyApis(options.env, source);
      await writePrivate(
        journal,
        JSON.stringify({ phase: "complete", backup }),
      );
      log(
        JSON.stringify({
          result: "verified",
          counts: counts(source),
          ...api,
          foreignKeys: "validated",
          rls: "unchanged",
          seconds: (Date.now() - started) / 1000,
          backup,
        }),
      );
    } catch (error) {
      if (backedUp) {
        try {
          await saveJournal(layout, {
            format: 1,
            operation: "import",
            phase: "applying",
            backup,
          });
          if (maintenance) {
            await maintenance.stop();
            maintenance = undefined;
          }
          maintenance = await maintenanceDatabase(options.env);
          await restoreNativeData(options.env, backup);
          await maintenance.stop();
          maintenance = undefined;
          await writePrivate(
            journal,
            JSON.stringify({ phase: "rolled-back", backup }),
          );
          clearJournal(layout);
          log(
            "IMPORT FAILED: target data restored from the pre-import backup; stack and application writers remain stopped.",
          );
        } catch {
          log(
            `IMPORT ROLLBACK FAILED: keep writers stopped. Recover using native-backup.ts recover-import --env ${options.env} ${backup}${options.env === "prod" ? " --confirm-production" : ""}.`,
          );
          throw new Error(
            "Import and automatic rollback failed; backup and recovery journal retained",
          );
        }
      }
      throw error;
    }
  } finally {
    if (maintenance) await maintenance.stop();
  }
}
if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
)
  nativeImport(importArguments(process.argv.slice(2))).catch(
    (error: unknown) => {
      const message =
        error instanceof Error ? error.message : "Native import failed";
      process.stderr.write(
        `${/password|postgresql:|COPY|DETAIL|token/i.test(message) ? "Native import failed; private diagnostics withheld" : message}\n`,
      );
      process.exitCode = 1;
    },
  );
