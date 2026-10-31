export function upsertJob<T extends { id: string; created_at: string }>(
  rows: T[],
  row: T,
): T[] {
  const index = rows.findIndex((r) => r.id === row.id);
  if (index >= 0) return rows.map((r, i) => (i === index ? row : r));
  return [...rows, row].sort(
    (a, b) =>
      a.created_at.localeCompare(b.created_at) || a.id.localeCompare(b.id),
  );
}
