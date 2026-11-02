import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseEnv } from "node:util";
import type { Sql } from "postgres";
import { runtimeRoot } from "./lib/runtime.js";
import { localOwnerSql, validateEmail } from "./lib/user-admin.js";

export function ownerEmail(): string {
  const email =
    process.env.MELLODIFAI_OWNER_EMAIL ??
    parseEnv(readFileSync(join(runtimeRoot(), "config/ops.env"), "utf8"))
      .MELLODIFAI_OWNER_EMAIL;
  if (!email) throw new Error("MELLODIFAI_OWNER_EMAIL is required");
  validateEmail(email);
  return email;
}

export async function setOwner(
  sql: Pick<Sql, "begin">,
  email: string,
): Promise<{ admins: 1 }> {
  validateEmail(email);
  return sql.begin(async (tx) => {
    await tx`lock table public.admin_allowlist, public.profiles in share row exclusive mode`;
    for (const table of ["admin_allowlist", "profiles"]) {
      await tx`update ${tx(`public.${table}`)} set role = case when lower(email) = lower(${email}) then 'admin' else 'customer' end`;
      const [row] =
        await tx`select count(*)::int as admins from ${tx(`public.${table}`)} where role = 'admin'`;
      if (row?.admins !== 1)
        throw new Error("setOwner requires exactly one admin in both tables");
    }
    return { admins: 1 as const };
  });
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  const main = async () => {
    const email = ownerEmail();
    const sql = localOwnerSql();
    try {
      await setOwner(sql, email);
    } finally {
      await sql.end();
    }
  };
  main().catch(() => {
    process.stderr.write(
      "Owner provisioning failed; configure the owner and confirm the allowlisted account first\n",
    );
    process.exitCode = 1;
  });
}
