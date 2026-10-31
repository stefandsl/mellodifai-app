import { E2E_ADMIN_EMAIL, serviceClient } from "./support";

export default async function globalSetup() {
  const db = serviceClient();
  const { error: allowlistError } = await db
    .from("admin_allowlist")
    .upsert({ email: E2E_ADMIN_EMAIL }, { onConflict: "email" });
  if (allowlistError) throw allowlistError;

  const { data: users, error: usersError } = await db.auth.admin.listUsers({
    page: 1,
    perPage: 1000,
  });
  if (usersError) throw usersError;
  let user = users.users.find(
    (candidate) => candidate.email === E2E_ADMIN_EMAIL,
  );
  if (!user) {
    const { data, error } = await db.auth.admin.createUser({
      email: E2E_ADMIN_EMAIL,
      email_confirm: true,
    });
    if (error || !data.user)
      throw error ?? new Error("Admin user was not created");
    user = data.user;
  }

  const { error: profileError } = await db.from("profiles").upsert({
    id: user.id,
    email: E2E_ADMIN_EMAIL,
    role: "admin",
  });
  if (profileError) throw profileError;

  const { error: projectsError } = await db
    .from("projects")
    .delete()
    .eq("owner_id", user.id);
  if (projectsError) throw projectsError;
  const { error: workerError } = await db
    .from("workers")
    .delete()
    .eq("owner_id", user.id);
  if (workerError) throw workerError;
}
