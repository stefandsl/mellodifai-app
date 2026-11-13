import { describe, expect, it } from "vitest";
import {
  assertEmptyTarget,
  compareLedgers,
  counts,
  importSql,
  parseDump,
  tableRows,
} from "../../lib/native/import-data.js";
import { rehearsalPorts } from "../../lib/native/rehearsal.js";
import { importArguments } from "../../native-import.js";
import { assertBootstrapSeeds } from "../../native-prepare-import.js";

const table = (name: string, columns: string, rows = "") =>
  `COPY ${name} (${columns}) FROM stdin;\n${rows ? `${rows}\n` : ""}\\.\n`;
const ledgers =
  table("auth.schema_migrations", "version", "123") +
  table(
    "storage.migrations",
    "id, name, hash, executed_at",
    "1\tfirst\tabc\tyesterday",
  ) +
  table(
    "supabase_migrations.schema_migrations",
    "version, name",
    "20261103080001\tlockdown",
  );
describe("recovered native data", () => {
  it("requires an explicit environment, production confirmation and empty-only apply", () => {
    expect(() => importArguments(["--from", "recovery"])).toThrow("--env");
    expect(() =>
      importArguments(["--from", "recovery", "--env", "prod"]),
    ).toThrow("--confirm-production");
    expect(() =>
      importArguments(["--from", "recovery", "--env", "e2e", "--apply"]),
    ).toThrow("--replace-empty-only");
    expect(importArguments(["--from", "recovery", "--env", "e2e"]).apply).toBe(
      false,
    );
    expect(() =>
      importArguments([
        "--from",
        "recovery",
        "--env",
        "e2e",
        "--check",
        "--apply",
      ]),
    ).toThrow("Duplicate");
  });
  it("refuses production port overrides on the real root before filesystem access", () => {
    expect(() => rehearsalPorts("E:/mellodifai", "46320")).toThrow(
      "native-lab-prod",
    );
  });
  it("counts COPY rows, decodes escapes, and accepts quoted column identifiers", () => {
    const dump = parseDump(
      table(
        "public.playlist_items",
        'id, "position", name',
        "1\t2\ta\\tb\\ntext\\\\end",
      ),
    );
    expect(counts(dump)).toEqual({ "public.playlist_items": 1 });
    const first = dump.tables[0];
    if (!first) throw new Error("Missing parsed table");
    expect(tableRows(first)[0]).toEqual({
      id: "1",
      position: "2",
      name: "a\tb\ntext\\end",
    });
    expect(() => parseDump("COPY public.x (id) FROM stdin;\n1")).toThrow(
      "Truncated",
    );
    expect(() =>
      parseDump(table("public.x", "id") + table("public.x", "id")),
    ).toThrow("Duplicate");
    expect(() => parseDump(table("vault.secrets", "id", "1"))).toThrow(
      "Unsupported",
    );
  });
  it("compares ledger identities and Storage hashes without replaying them", () => {
    const source = parseDump(ledgers);
    compareLedgers(source, parseDump(ledgers.replace("yesterday", "today")));
    expect(() =>
      compareLedgers(source, parseDump(ledgers.replace("abc", "def"))),
    ).toThrow("storage.migrations");
    expect(() =>
      compareLedgers(
        source,
        parseDump(ledgers.replace("20261103080001", "20261103080002")),
      ),
    ).toThrow("supabase_migrations");
    expect(
      importSql(parseDump(ledgers + table("public.projects", "id", "1"))),
    ).not.toContain("COPY auth.schema_migrations");
  });
  it("refuses seeded public tables as well as users and objects", () => {
    for (const name of [
      "public.projects",
      "public.stack_settings",
      "auth.users",
      "storage.objects",
    ])
      expect(() =>
        assertEmptyTarget(parseDump(ledgers + table(name, "id", "1"))),
      ).toThrow("Target is not empty");
    assertEmptyTarget(parseDump(ledgers + table("public.projects", "id")));
  });
  it("never prepares a target with users or changed bootstrap counts", () => {
    expect(() => assertBootstrapSeeds({ "auth.users": 1 })).toThrow(
      "Not a fresh bootstrap",
    );
    expect(() => assertBootstrapSeeds({ "public.projects": 1 })).toThrow(
      "Not a fresh bootstrap",
    );
    expect(() => assertBootstrapSeeds({ "public.price_book": 15 })).toThrow(
      "Not a fresh bootstrap",
    );
  });
  it("suppresses history triggers, restores sequences and revalidates foreign keys", () => {
    const sql = importSql(
      parseDump(
        table("public.audit_log", "id", "10") +
          "SELECT pg_catalog.setval('public.audit_log_id_seq', 10, true);\n",
      ),
    );
    expect(sql.indexOf("session_replication_role = replica")).toBeLessThan(
      sql.indexOf("COPY public.audit_log"),
    );
    expect(sql).toContain("setval('public.audit_log_id_seq', 10, true)");
    expect(sql).toContain("ADD CONSTRAINT");
    expect(sql).toContain("session_replication_role = origin");
    expect(sql).not.toContain("CASCADE");
  });
});
