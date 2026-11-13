import { createHash } from "node:crypto";

export const LEDGERS = [
  "auth.schema_migrations",
  "storage.migrations",
  "supabase_migrations.schema_migrations",
] as const;
export interface CopyTable {
  name: string;
  columns: string[];
  lines: string[];
  copy: string;
}
export interface DumpData {
  tables: CopyTable[];
  sequences: string[];
}
export function parseDump(text: string): DumpData {
  const tables: CopyTable[] = [];
  const lines = text.replaceAll("\r\n", "\n").split("\n");
  for (let i = 0; i < lines.length; i++) {
    const header = lines[i] ?? "";
    if (!header.startsWith("COPY ")) continue;
    const match =
      /^COPY ((?:public|auth|storage|supabase_migrations)\.[a-z_][a-z0-9_]*) \(([a-z_0-9, "" ]+)\) FROM stdin;$/.exec(
        header,
      );
    if (!match) throw new Error("Unsupported dump COPY header");
    const name = match[1] as string;
    if (tables.some((table) => table.name === name))
      throw new Error("Duplicate dump table");
    const rows: string[] = [];
    while (++i < lines.length && lines[i] !== "\\.")
      rows.push(lines[i] as string);
    if (i >= lines.length) throw new Error("Truncated dump COPY data");
    tables.push({
      name,
      columns: (match[2] as string)
        .split(", ")
        .map((name) => name.replaceAll('"', "")),
      lines: rows,
      copy: `${header}\n${rows.join("\n")}${rows.length ? "\n" : ""}\\.\n`,
    });
  }
  const sequences = lines.filter((line) =>
    /^SELECT pg_catalog\.setval\('(?:public|auth|storage)\.[a-z_][a-z0-9_]*', [0-9]+, (?:true|false)\);$/.test(
      line,
    ),
  );
  if (!tables.length) throw new Error("Dump contains no supported table data");
  return { tables, sequences };
}
export function copyValue(value: string): string | null {
  if (value === "\\N") return null;
  return value.replace(
    /\\([bfnrtv\\]|[0-7]{1,3}|x[0-9a-fA-F]{1,2})/g,
    (_, code: string) => {
      const escapes: Record<string, string> = {
        b: "\b",
        f: "\f",
        n: "\n",
        r: "\r",
        t: "\t",
        v: "\v",
        "\\": "\\",
      };
      return (
        escapes[code] ??
        String.fromCharCode(
          Number.parseInt(
            code.startsWith("x") ? code.slice(1) : code,
            code.startsWith("x") ? 16 : 8,
          ),
        )
      );
    },
  );
}
export function tableRows(table: CopyTable): Record<string, string | null>[] {
  return table.lines.map((line) => {
    const values = line.split("\t");
    if (values.length !== table.columns.length)
      throw new Error("Invalid COPY row width");
    return Object.fromEntries(
      table.columns.map((name, index) => [
        name,
        copyValue(values[index] as string),
      ]),
    );
  });
}
export function dataTables(dump: DumpData): CopyTable[] {
  return dump.tables.filter(
    (table) =>
      /^(public|auth|storage)\./.test(table.name) &&
      !(LEDGERS as readonly string[]).includes(table.name),
  );
}
export function counts(dump: DumpData): Record<string, number> {
  return Object.fromEntries(
    dataTables(dump).map((table) => [table.name, table.lines.length]),
  );
}
export function tableDigest(table: CopyTable): string {
  return createHash("sha256")
    .update([...table.lines].sort().join("\n"))
    .digest("hex");
}
export function compareLedgers(source: DumpData, target: DumpData): void {
  for (const name of LEDGERS) {
    const left = source.tables.find((table) => table.name === name);
    const right = target.tables.find((table) => table.name === name);
    if (!left || !right) throw new Error(`Missing migration ledger: ${name}`);
    // Service migration timestamps and CLI statements differ across installations.
    // Compare identifiers plus migration names/checksums where the service stores them.
    const columns =
      name === "storage.migrations"
        ? ["id", "name", "hash"]
        : name === "supabase_migrations.schema_migrations"
          ? ["version", "name"]
          : ["version"];
    const normalize = (table: CopyTable) =>
      tableRows(table)
        .map((row) =>
          columns
            .filter((column) => table.columns.includes(column))
            .map((column) => row[column])
            .join("\t"),
        )
        .sort();
    if (JSON.stringify(normalize(left)) !== JSON.stringify(normalize(right)))
      throw new Error(`Migration ledger mismatch: ${name}`);
  }
}
export function assertEmptyTarget(target: DumpData): void {
  const occupied = dataTables(target).filter(
    (table) =>
      (table.name.startsWith("public.") ||
        table.name === "auth.users" ||
        table.name === "storage.objects") &&
      table.lines.length,
  );
  if (occupied.length)
    throw new Error(
      `Target is not empty: ${occupied.map((table) => `${table.name}=${table.lines.length}`).join(", ")}`,
    );
}
export function importSql(dump: DumpData): string {
  const tables = dataTables(dump);
  return [
    "SET LOCAL session_replication_role = replica;",
    `TRUNCATE ${tables.map((table) => table.name).join(", ")};`,
    ...tables.map((table) => table.copy),
    ...dump.sequences,
    "SET LOCAL session_replication_role = origin;",
    `DO $verify$ DECLARE item record; BEGIN
    FOR item IN SELECT conrelid::regclass AS tbl, conname, pg_get_constraintdef(oid) AS def FROM pg_constraint WHERE contype='f' AND connamespace IN ('public'::regnamespace,'auth'::regnamespace,'storage'::regnamespace) LOOP
      EXECUTE format('ALTER TABLE %s DROP CONSTRAINT %I', item.tbl, item.conname);
      EXECUTE format('ALTER TABLE %s ADD CONSTRAINT %I %s', item.tbl, item.conname, item.def);
    END LOOP;
  END $verify$;`,
  ].join("\n");
}
