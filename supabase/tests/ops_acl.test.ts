import { readFileSync } from "node:fs";
import type { Sql, TransactionSql } from "postgres";
import { afterAll, expect, it } from "vitest";
import { ownerSql } from "./helpers/pg";

const sql = ownerSql();
afterAll(() => sql.end());

async function columnGrants(connection: Sql | TransactionSql) {
  return connection`
    select 'column|' || n.nspname || '.' || c.relname || '.' || a.attname || '|'
      || case when x.grantee = 0 then 'PUBLIC' else r.rolname end || '|' || x.privilege_type as line
    from pg_attribute a
    join pg_class c on c.oid = a.attrelid
    join pg_namespace n on n.oid = c.relnamespace
    cross join lateral aclexplode(a.attacl) x
    left join pg_roles r on r.oid = x.grantee
    where n.nspname in ('public', 'ops') and c.relkind in ('r', 'p', 'v', 'm', 'f')
      and a.attnum > 0 and not a.attisdropped
      and (x.grantee = 0 or r.rolname in ('anon', 'authenticated', 'mdf_web', 'mdf_auth', 'service_role'))
    order by line
  `;
}

it("detects an unreviewed PUBLIC column grant and rolls it back", async () => {
  const before = await columnGrants(sql);
  const rollback = new Error("rollback PUBLIC column grant");
  await expect(
    sql.begin(async (tx) => {
      await tx`grant select (topic) on public.projects to public`;
      const after = await columnGrants(tx);
      expect(after).toContainEqual({
        line: "column|public.projects.topic|PUBLIC|SELECT",
      });
      expect(after).not.toEqual(before);
      throw rollback;
    }),
  ).rejects.toBe(rollback);
  expect(await columnGrants(sql)).toEqual(before);
});

it("matches the reviewed public and ops ACL allowlist", async () => {
  const objects = await sql`
    with roles(name) as (values ('anon'), ('authenticated'), ('mdf_web'), ('mdf_auth'), ('service_role')),
    functions as (
      select n.nspname || '.' || p.proname || '(' || pg_get_function_identity_arguments(p.oid) || ')' as object,
        'function' as kind, p.oid
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname in ('public', 'ops')
    ), relations as (
      select n.nspname || '.' || c.relname as object, c.relkind, c.oid
      from pg_class c join pg_namespace n on n.oid = c.relnamespace
      where n.nspname in ('public', 'ops') and c.relkind in ('r', 'p', 'v', 'm', 'f', 'S')
    )
    select 'function|' || f.object || '|' || r.name || '|EXECUTE=' || has_function_privilege(r.name, f.oid, 'EXECUTE') as line
    from functions f cross join roles r
    union all
    select (case when c.relkind = 'S' then 'sequence' else 'relation' end) || '|' || c.object || '|' || r.name || '|'
      || (case when c.relkind = 'S' then
        'USAGE=' || has_sequence_privilege(r.name, c.oid, 'USAGE') || ',SELECT=' || has_sequence_privilege(r.name, c.oid, 'SELECT') || ',UPDATE=' || has_sequence_privilege(r.name, c.oid, 'UPDATE')
      else
        'SELECT=' || has_table_privilege(r.name, c.oid, 'SELECT') || ',INSERT=' || has_table_privilege(r.name, c.oid, 'INSERT')
        || ',UPDATE=' || has_table_privilege(r.name, c.oid, 'UPDATE') || ',DELETE=' || has_table_privilege(r.name, c.oid, 'DELETE')
        || ',TRUNCATE=' || has_table_privilege(r.name, c.oid, 'TRUNCATE') || ',REFERENCES=' || has_table_privilege(r.name, c.oid, 'REFERENCES')
        || ',TRIGGER=' || has_table_privilege(r.name, c.oid, 'TRIGGER')
      end) as line
    from relations c cross join roles r
    order by line
  `;
  const columns = await columnGrants(sql);
  const schemas = await sql`
    select 'schema|' || n.nspname || '|' || r.name || '|USAGE=' || has_schema_privilege(r.name, n.oid, 'USAGE') as line
    from pg_namespace n cross join (values ('mdf_web'), ('mdf_auth')) r(name)
    where n.nspname not like 'pg_%' and n.nspname <> 'information_schema'
    order by line
  `;
  const policies = await sql`
    select 'storage_policy|' || policyname || '|' || cmd || '|' || roles::text || '|' || coalesce(qual, '') || '|' || coalesce(with_check, '') as line
    from pg_policies where schemaname = 'storage' and tablename = 'objects'
    order by line
  `;
  const memberships = await sql`
    select 'membership|' || member.rolname || '|' || parent.rolname as line
    from pg_auth_members m
    join pg_roles member on member.oid = m.member
    join pg_roles parent on parent.oid = m.roleid
    where member.rolname in ('mdf_web', 'mdf_auth')
    order by line
  `;
  const security = await sql`
    select 'ops_security|' || p.proname || '(' || pg_get_function_identity_arguments(p.oid) || ')|definer=' || p.prosecdef
      || '|search_path=' || coalesce((select split_part(v, '=', 2) from unnest(p.proconfig) v where v like 'search_path=%'), '<unset>') as line
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'ops'
    order by line
  `;
  const actual = [
    ...objects,
    ...columns,
    ...schemas,
    ...policies,
    ...memberships,
    ...security,
  ]
    .map((row) => row.line as string)
    .sort();
  const allowlist = JSON.parse(
    readFileSync(new URL("./acl-allowlist.json", import.meta.url), "utf8"),
  ) as string[];
  // These schemas belong to extensions and services that only the Docker
  // runtime ships (Realtime, pg_graphql, pg_net, webhooks, vault). Where one
  // is absent it grants nothing, so its lines are not expected; where it is
  // present its lines must match like every other.
  const dockerOnly = [
    "_realtime",
    "graphql",
    "net",
    "supabase_functions",
    "vault",
  ];
  const present = new Set(
    (await sql`select nspname from pg_namespace`).map(
      (row) => row.nspname as string,
    ),
  );
  const expected = allowlist.filter((line) => {
    const [kind, schema] = line.split("|");
    return (
      kind !== "schema" ||
      !dockerOnly.includes(schema as string) ||
      present.has(schema as string)
    );
  });
  expect(actual).toEqual(expected);
  expect(memberships).toEqual([]);
  expect(
    security.every((row) => row.line.endsWith('|definer=true|search_path=""')),
  ).toBe(true);
  const opsGrants = objects
    .map((row) => row.line as string)
    .filter(
      (line) =>
        line.startsWith("function|ops.") && line.endsWith("EXECUTE=true"),
    );
  expect(opsGrants).toHaveLength(security.length);
  expect(new Set(opsGrants.map((line) => line.split("|")[1])).size).toBe(
    security.length,
  );
});
