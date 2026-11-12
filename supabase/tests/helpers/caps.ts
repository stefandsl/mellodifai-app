import type { Sql, TransactionSql } from "postgres";

// Keep force_caps and any SET LOCAL ROLE at the wrapper call on this transaction.
export async function withRealCaps<T>(
  sql: Sql,
  fn: (tx: TransactionSql) => Promise<T>,
): Promise<T> {
  return sql.begin(async (tx) => {
    await tx`set local mdf.force_caps = 'on'`;
    return fn(tx);
  }) as Promise<T>;
}
