import type { Sql } from "postgres";

export async function tableCounts(sql: Sql): Promise<Record<string, number>> {
  return sql.begin("isolation level repeatable read read only", async (tx) => {
    const tables = await tx<{ schemaname: string; tablename: string }[]>`
      select schemaname, tablename from pg_catalog.pg_tables
      where schemaname in ('public', 'auth', 'storage') order by schemaname, tablename`;
    const counts: Record<string, number> = {};
    for (const table of tables) {
      const [row] =
        await tx`select count(*)::text as count from ${tx(table.schemaname)}.${tx(table.tablename)}`;
      const count = Number(row?.count);
      if (!Number.isSafeInteger(count))
        throw new Error("Table count exceeds safe integer range");
      counts[`${table.schemaname}.${table.tablename}`] = count;
    }
    return counts;
  });
}

export function compareCounts(
  before: Record<string, number>,
  after: Record<string, number>,
): string[] {
  return [...new Set([...Object.keys(before), ...Object.keys(after)])]
    .filter((name) => before[name] !== after[name])
    .sort();
}
