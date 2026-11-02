import { randomUUID } from "node:crypto";
import { mkdirSync, mkdtempSync } from "node:fs";
import { join } from "node:path";
import { createClient } from "@supabase/supabase-js";
import { expect, it } from "vitest";
import { compareCounts, tableCounts } from "../lib/counts.js";
import { ownerConnection } from "../lib/pg.js";
import { recoveryDatabase } from "../lib/recovery.js";
import { restoreDatabase } from "../restore.js";
import { assertTestStack } from "../test-db-guard.js";

it("an end-to-end restore on the e2e stack keeps storage objects readable", async () => {
  assertTestStack(process.env);
  const env = process.env.CI === "true" ? "ci" : "e2e";
  if (
    env === "e2e" &&
    new URL(process.env.TEST_DB_URL as string).port !== "45622"
  )
    throw new Error("Expected e2e database");
  const root = process.env.RUNNER_TEMP ?? "E:/mellodifai/tmp";
  mkdirSync(root, { recursive: true });
  const directory = mkdtempSync(join(root, "restore-integration-"));
  const backup = join(directory, "before.sql");
  const client = createClient(
    process.env.SUPABASE_URL as string,
    process.env.SUPABASE_SERVICE_ROLE_KEY as string,
    { auth: { persistSession: false, autoRefreshToken: false } },
  );
  const bucket = `restore-${randomUUID()}`;
  const bytes = Buffer.from("Task 12 persistent storage fixture");
  expect((await client.storage.createBucket(bucket)).error).toBeNull();
  expect(
    (await client.storage.from(bucket).upload("test.txt", bytes)).error,
  ).toBeNull();
  const db = await recoveryDatabase(env);
  const sql = ownerConnection(process.env.TEST_DB_URL as string);
  try {
    const probe = `task12_restore_${randomUUID().replaceAll("-", "")}`;
    await sql`create schema ${sql(probe)}`;
    const before = await tableCounts(sql);
    await db.backup(backup);
    await restoreDatabase(env, backup);
    expect(compareCounts(before, await tableCounts(sql))).toEqual([]);
    const [reset] = await sql`select to_regnamespace(${probe}) as name`;
    expect(reset?.name).toBeNull();
    const rest = await client.from("profiles").select("id").limit(1);
    expect(rest.error).toBeNull();
    const downloaded = await client.storage.from(bucket).download("test.txt");
    expect(downloaded.error).toBeNull();
    if (!downloaded.data) throw new Error("Restored object is missing");
    expect(Buffer.from(await downloaded.data.arrayBuffer())).toEqual(bytes);
  } finally {
    await sql.end();
    await client.storage.from(bucket).remove(["test.txt"]);
    await client.storage.deleteBucket(bucket);
    // Retain the safety dump off C: for diagnosis if reset/import fails.
  }
}, 240_000);
