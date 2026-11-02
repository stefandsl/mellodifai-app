import type { OpsResult } from "@mellodifai/shared";
import postgres, { type Sql } from "postgres";

let connection: Sql | undefined;
export function opsSql(): Sql {
  if (!connection) {
    const url = process.env.MDF_WEB_DATABASE_URL;
    if (!url) throw new Error("MDF_WEB_DATABASE_URL is required");
    connection = postgres(url, {
      max: 10,
      connect_timeout: 10,
      onnotice: () => {},
    });
  }
  return connection;
}

export async function callOps<T>(
  fn: string,
  args: unknown[],
): Promise<OpsResult<T>> {
  if (!/^[a-z][a-z0-9_]*$/.test(fn))
    return { ok: false, code: "validation", message: "Invalid operation" };
  try {
    const [row] = await opsSql().unsafe<{ result: OpsResult<T> }[]>(
      `select ops."${fn}"(${args.map((_, i) => `$${i + 1}`).join(", ")}) as result`,
      // Postgres describes parameter types and serializes JSON and SQL arrays accordingly.
      args as postgres.ParameterOrJSON<never>[],
    );
    if (!row || typeof row.result?.ok !== "boolean")
      throw new Error("Invalid ops response");
    return row.result;
  } catch {
    // SQL/network errors can contain credentials or private arguments.
    return { ok: false, code: "internal", message: "Internal error" };
  }
}
