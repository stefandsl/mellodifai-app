import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { Sql } from "postgres";
import { localOwnerSql, userAdmin, validateEmail } from "./lib/user-admin.js";

type Admin = {
  createUser(input: {
    email: string;
    email_confirm: true;
  }): Promise<{ error: Error | null }>;
};

export async function addUser(
  sql: Sql,
  admin: Admin,
  email: string,
  role: "admin" | "customer",
) {
  validateEmail(email);
  if (role !== "admin" && role !== "customer") throw new Error("Invalid role");
  // Commit before the Auth service's separate transaction runs the profile trigger.
  await sql`insert into public.admin_allowlist (email, role) values (${email}, ${role})`;
  const { error } = await admin.createUser({ email, email_confirm: true });
  if (error) throw error;
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  const main = async () => {
    const [email, role, extra] = process.argv.slice(2);
    if (!email || (role !== "admin" && role !== "customer") || extra)
      throw new Error("Usage: add-user.ts <email> <admin|customer>");
    const admin = userAdmin();
    const sql = localOwnerSql();
    try {
      await addUser(sql, admin, email, role);
    } finally {
      await sql.end();
    }
  };
  main().catch(() => {
    process.stderr.write(
      "User creation failed; check the role, worker configuration and allowlist before retrying\n",
    );
    process.exitCode = 1;
  });
}
