import type { SupabaseClient } from "@supabase/supabase-js";

// A stand-in for the browser Supabase client in unit tests: reads over rows held in memory, with
// the PostgREST behaviour the app's reads depend on (filters, order with nulls placed as Postgres
// places them, limit, exact count). Tests change `tables` between reads, as the worker would.

type Row = Record<string, unknown>;
type Reply = {
  data: unknown;
  error: { message: string } | null;
  count: number | null;
};

export type FakeRead = { table: string; columns: string; filters: string[] };

export type FakeDb = {
  tables: Record<string, Row[]>;
  // Every read started, in order.
  reads: FakeRead[];
  // Set to make every read fail with this message.
  error: string | null;
  // Set to hold reads back: a read answers when the promise it gets here resolves.
  gate: ((read: FakeRead) => Promise<void>) | null;
  client: SupabaseClient;
};

function compare(a: unknown, b: unknown): number {
  if (a === b) return 0;
  return (a as string | number) < (b as string | number) ? -1 : 1;
}

class Query implements PromiseLike<Reply> {
  private columns = "*";
  private readonly tests: ((row: Row) => boolean)[] = [];
  private readonly filters: string[] = [];
  private readonly orders: {
    column: string;
    ascending: boolean;
    nullsFirst: boolean;
  }[] = [];
  private max = Number.POSITIVE_INFINITY;
  private counted = false;
  private one = false;
  private signal: AbortSignal | null = null;

  constructor(
    private readonly db: FakeDb,
    private readonly table: string,
  ) {}

  select(columns = "*", options: { count?: "exact" } = {}) {
    this.columns = columns;
    this.counted = options.count === "exact";
    return this;
  }
  private where(filter: string, test: (row: Row) => boolean) {
    this.filters.push(filter);
    this.tests.push(test);
    return this;
  }
  eq(column: string, value: unknown) {
    return this.where(`${column}=eq.${value}`, (row) => row[column] === value);
  }
  gt(column: string, value: unknown) {
    return this.where(
      `${column}=gt.${value}`,
      (row) => compare(row[column], value) > 0,
    );
  }
  lte(column: string, value: unknown) {
    return this.where(
      `${column}=lte.${value}`,
      (row) => compare(row[column], value) <= 0,
    );
  }
  in(column: string, values: readonly unknown[]) {
    return this.where(`${column}=in.(${values.join(",")})`, (row) =>
      values.includes(row[column]),
    );
  }
  order(
    column: string,
    options: { ascending?: boolean; nullsFirst?: boolean } = {},
  ) {
    const ascending = options.ascending ?? true;
    // Postgres sorts nulls as larger than any value unless told otherwise.
    this.orders.push({
      column,
      ascending,
      nullsFirst: options.nullsFirst ?? !ascending,
    });
    return this;
  }
  limit(count: number) {
    this.max = count;
    return this;
  }
  abortSignal(signal: AbortSignal) {
    this.signal = signal;
    return this;
  }
  maybeSingle() {
    this.one = true;
    return this;
  }

  // biome-ignore lint/suspicious/noThenProperty: PostgREST builders are awaitable queries.
  then<A = Reply, B = never>(
    resolve?: ((reply: Reply) => A | PromiseLike<A>) | null,
    reject?: ((reason: unknown) => B | PromiseLike<B>) | null,
  ): PromiseLike<A | B> {
    return this.run().then(resolve, reject);
  }

  private async run(): Promise<Reply> {
    const read = {
      table: this.table,
      columns: this.columns,
      filters: this.filters,
    };
    this.db.reads.push(read);
    if (this.db.gate) await this.db.gate(read);
    const message = this.signal?.aborted ? "aborted" : this.db.error;
    if (message) return { data: null, error: { message }, count: null };
    const matching = (this.db.tables[this.table] ?? []).filter((row) =>
      this.tests.every((test) => test(row)),
    );
    const sorted = matching.toSorted((a, b) => {
      for (const { column, ascending, nullsFirst } of this.orders) {
        const [x, y] = [a[column] ?? null, b[column] ?? null];
        if (x === null || y === null) {
          if (x === y) continue;
          return (x === null) === nullsFirst ? -1 : 1;
        }
        const order = compare(x, y);
        if (order) return ascending ? order : -order;
      }
      return 0;
    });
    const names = this.columns.split(",").map((name) => name.trim());
    const rows = sorted
      .slice(0, this.max)
      .map((row) =>
        this.columns === "*"
          ? { ...row }
          : Object.fromEntries(names.map((name) => [name, row[name] ?? null])),
      );
    return {
      data: this.one ? (rows[0] ?? null) : rows,
      error: null,
      count: this.counted ? matching.length : null,
    };
  }
}

export function fakeDb(tables: Record<string, Row[]> = {}): FakeDb {
  const db: FakeDb = {
    tables,
    reads: [],
    error: null,
    gate: null,
    client: {
      from: (table: string) => new Query(db, table),
    } as unknown as SupabaseClient,
  };
  return db;
}
