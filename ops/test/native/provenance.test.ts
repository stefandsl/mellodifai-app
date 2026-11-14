import type { Sql } from "postgres";
import { afterEach, expect, it, vi } from "vitest";
import {
  assertBackupSource,
  dumpLedgerHead,
  stackIdentity,
} from "../../lib/native/identity.js";
import { parseDump } from "../../lib/native/import-data.js";
import { applyStackSettings } from "../../lib/native/migrate.js";
import { fixture } from "./fixtures.js";

afterEach(() => vi.unstubAllEnvs());

it("does not hide a restored fake stack on production startup", async () => {
  const query = vi.fn(async (_sql: TemplateStringsArray) => [
    { fake_stack: true },
  ]);
  await expect(
    applyStackSettings(query as unknown as Sql, false),
  ).rejects.toThrow(/fake stack/i);
  expect(
    query.mock.calls.some(([sql]) =>
      String(sql).includes("update public.stack_settings"),
    ),
  ).toBe(false);
});

it("retains installation identity and checks source flags and the complete ledger", async () => {
  vi.stubEnv("MELLODIFAI_ROOT", fixture());
  const identity = await stackIdentity("e2e");
  expect(await stackIdentity("e2e")).toEqual(identity);
  const dump = parseDump(
    "COPY public.stack_settings (id, fake_stack) FROM stdin;\nt\tt\n\\.\nCOPY supabase_migrations.schema_migrations (version, name) FROM stdin;\n001\tfirst\n\\.\n",
  );
  const source = {
    ...identity,
    fakeStack: true,
    ledgerHead: dumpLedgerHead(dump),
  };
  expect(() => assertBackupSource(source, dump, "prod")).toThrow(
    /production source identity/,
  );
  expect(() => assertBackupSource(undefined, dump, "prod")).toThrow(
    /production source identity/,
  );
  expect(() =>
    assertBackupSource(
      { ...source, fakeStack: false, env: "prod" },
      dump,
      "prod",
    ),
  ).toThrow(/does not match/);
  expect(() =>
    assertBackupSource({ ...source, ledgerHead: "changed" }, dump),
  ).toThrow(/does not match/);
});
