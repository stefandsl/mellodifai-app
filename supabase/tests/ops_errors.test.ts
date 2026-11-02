import { afterAll, expect, it } from "vitest";
import { MDF_STATES } from "../../packages/shared/src/ops/errors";
import { ownerSql } from "./helpers/pg";

const sql = ownerSql();
afterAll(() => sql.end());
async function map(state: string, message: string) {
  const [row] = await sql`select ops.map_error(${state}, ${message}) as result`;
  return row.result;
}
it("maps MDF02 and MDF06 to cap_exceeded, MDF03 to unauthorized, MDF05 to internal with reason price_missing", async () => {
  for (const [state, expected] of Object.entries(MDF_STATES)) {
    expect(await map(state, "required")).toEqual(expected);
  }
  for (const [state, code, reason] of [
    ["MDF01", "validation", "idempotency_key_required"],
    ["MDF02", "cap_exceeded", "cap"],
    ["MDF03", "unauthorized", "claim"],
    ["MDF04", "forbidden_scope", "test_rule"],
    ["MDF05", "internal", "price_missing"],
    ["MDF06", "cap_exceeded", "no_cap"],
    ["MDF07", "cap_exceeded", "entry_beyond_reservation"],
  ])
    expect(await map(state, "required")).toEqual({ code, reason });
  expect(await map("MDF03", "consent required")).toEqual({
    code: "unauthorized",
    reason: "consent",
  });
});
it("checks the SQLSTATE before message rules: an MDF message ending in required is not conflict", async () => {
  expect(await map("MDF02", "reservation required")).toEqual({
    code: "cap_exceeded",
    reason: "cap",
  });
});
it("maps uploaded audio required and current take required to validation (Nit 17)", async () => {
  for (const message of ["uploaded audio required", "current take required"]) {
    expect(await map("P0001", message)).toMatchObject({ code: "validation" });
  }
});
it("maps the ordered message rules and keeps unknown failures internal", async () => {
  for (const [message, code] of [
    ["authentication required", "unauthorized"],
    ["profile required", "unauthorized"],
    ["admin required", "forbidden_scope"],
    ["local engines are admin only", "forbidden_scope"],
    ["owned version required", "not_found"],
    ["render missing", "not_found"],
    ["song not found", "not_found"],
    ["kie submission state unknown: wait", "ambiguous_spend"],
    ["resolve unknown submission first", "ambiguous_spend"],
    ["invalid input", "validation"],
    ["title required", "validation"],
    ["input must be short", "validation"],
    ["version required", "conflict"],
    ["song already approved", "conflict"],
    ["transition not allowed", "conflict"],
    ["unexpected failure", "internal"],
  ])
    expect(await map("P0001", message)).toMatchObject({ code });
});
it("every raise reachable from an ops function maps to a code other than internal", async () => {
  const functions =
    await sql`select p.oid, n.nspname as schema, p.proname as name, p.prosrc as source from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname in ('ops','public')`;
  const queue = functions.filter((fn) => fn.schema === "ops");
  expect(queue.length).toBeGreaterThan(0);
  const visited = new Set<number>();
  while (queue.length) {
    const fn = queue.shift();
    if (!fn || visited.has(fn.oid)) continue;
    visited.add(fn.oid);
    for (const match of fn.source.matchAll(
      /\b(public|ops)\.([a-z_0-9]+)\s*\(/gi,
    )) {
      queue.push(
        ...functions.filter(
          (candidate) =>
            candidate.schema === match[1] && candidate.name === match[2],
        ),
      );
    }
    for (const match of fn.source.matchAll(
      /raise\s+exception\s+'((?:''|[^'])*)'([^;]*);/gi,
    )) {
      const state = /errcode\s*=\s*'([^']+)'/i.exec(match[2])?.[1] ?? "P0001";
      const result = await map(state, match[1].replaceAll("''", "'"));
      if (state === "MDF05")
        expect(result).toEqual({ code: "internal", reason: "price_missing" });
      else
        expect(result.code, `${fn.schema}.${fn.name}: ${match[1]}`).not.toBe(
          "internal",
        );
    }
  }
});
