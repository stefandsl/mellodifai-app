import { createHash, randomUUID } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { ENV_TABLE, type StackEnv } from "../envs.js";
import { assertEmptyTarget, type DumpData, tableRows } from "./import-data.js";
import { durableJson } from "./journal.js";
import { nativeLayout } from "./layout.js";

export interface StackIdentity {
  format: 1;
  env: StackEnv;
  stackId: string;
}
export interface BackupSource extends StackIdentity {
  fakeStack: boolean;
  ledgerHead: string;
}

/** First native boot creates the ID. Existing native roots adopt an ID once;
 * imported data never replaces this installation identity.
 */
export async function stackIdentity(env: StackEnv): Promise<StackIdentity> {
  const path = join(nativeLayout(env).root, "stack-identity.json");
  if (!existsSync(path))
    await durableJson(path, { format: 1, env, stackId: randomUUID() });
  const identity = JSON.parse(readFileSync(path, "utf8")) as StackIdentity;
  if (
    identity.format !== 1 ||
    identity.env !== env ||
    !/^[a-f0-9-]{36}$/.test(identity.stackId)
  )
    throw new Error("Native stack identity mismatch");
  return identity;
}
export function dumpLedgerHead(dump: DumpData): string {
  const ledger = dump.tables.find(
    (table) => table.name === "supabase_migrations.schema_migrations",
  );
  if (!ledger) throw new Error("Missing source migration ledger");
  const checksums = dump.tables.find(
    (table) => table.name === "supabase_migrations.mdf_checksums",
  );
  const hashes = new Map(
    (checksums ? tableRows(checksums) : []).map((row) => [
      row.version,
      row.sha256,
    ]),
  );
  const rows = tableRows(ledger)
    .map((row) => ({
      version: row.version,
      name: row.name,
      sha256: hashes.get(row.version) ?? null,
    }))
    .sort((a, b) => String(a.version).localeCompare(String(b.version)));
  return createHash("sha256").update(JSON.stringify(rows)).digest("hex");
}
/** The application ledger with its native checksums, as startup reads it. */
export function dumpAppliedMigrations(
  dump: DumpData,
): { version: string; sha256: string | null }[] {
  const ledger = dump.tables.find(
    (table) => table.name === "supabase_migrations.schema_migrations",
  );
  if (!ledger) throw new Error("Missing migration ledger");
  const checksums = dump.tables.find(
    (table) => table.name === "supabase_migrations.mdf_checksums",
  );
  const hashes = new Map(
    (checksums ? tableRows(checksums) : []).map((row) => [
      row.version,
      row.sha256,
    ]),
  );
  return tableRows(ledger).map((row) => ({
    version: String(row.version),
    sha256: hashes.get(row.version) ?? null,
  }));
}
export function dumpFakeStack(dump: DumpData, env: StackEnv): boolean {
  const table = dump.tables.find(
    (entry) => entry.name === "public.stack_settings",
  );
  const rows = table ? tableRows(table) : [];
  if (rows.length === 0) {
    // An explicit empty-target import backs up the prepared, seedless target.
    assertEmptyTarget(dump);
    return ENV_TABLE[env].fakeStack;
  }
  if (rows.length !== 1 || !["t", "f"].includes(rows[0]?.fake_stack ?? ""))
    throw new Error("Invalid source fake-stack flag");
  return rows[0]?.fake_stack === "t";
}
export function assertBackupSource(
  source: BackupSource | undefined,
  dump: DumpData,
  target?: StackEnv,
): void {
  if (
    source &&
    (source.format !== 1 ||
      !Object.hasOwn(ENV_TABLE, source.env) ||
      !/^[a-f0-9-]{36}$/.test(source.stackId) ||
      source.ledgerHead !== dumpLedgerHead(dump) ||
      source.fakeStack !== dumpFakeStack(dump, source.env))
  )
    throw new Error("Native backup source identity does not match its data");
  if (
    target === "prod" &&
    (source?.env !== "prod" || source.fakeStack !== false)
  )
    throw new Error(
      "Production restore requires a production source identity with fake_stack=false; use native-import only for the verified offline Docker recovery",
    );
}
