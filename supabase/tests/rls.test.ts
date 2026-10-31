import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { afterEach, beforeAll, describe, expect, it } from "vitest";

type TestUser = {
  client: SupabaseClient;
  id: string;
};

const requiredEnvironment = [
  "SUPABASE_URL",
  "SUPABASE_ANON_KEY",
  "SUPABASE_SERVICE_ROLE_KEY",
] as const;

const environment = Object.fromEntries(
  requiredEnvironment.map((name) => [name, process.env[name]]),
) as Record<(typeof requiredEnvironment)[number], string | undefined>;

const runId = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
const createdUserIds: string[] = [];
let service: SupabaseClient;

function requireEnvironment(): void {
  for (const name of requiredEnvironment) {
    if (!environment[name]) {
      throw new Error(`${name} must be set to run database tests`);
    }
  }
}

async function createUser(allowlisted: boolean): Promise<TestUser> {
  const email = `${allowlisted ? "allowed" : "blocked"}-${runId}-${createdUserIds.length}@example.test`;

  if (allowlisted) {
    const { error } = await service.from("admin_allowlist").insert({ email });
    expect(error).toBeNull();
  }

  const { data, error } = await service.auth.admin.createUser({
    email,
    password: "database-test-password",
    email_confirm: true,
  });
  expect(error).toBeNull();
  expect(data.user).not.toBeNull();

  const user = data.user;
  if (!user) {
    throw new Error("Expected the test user to be created");
  }
  createdUserIds.push(user.id);

  const client = createClient(
    environment.SUPABASE_URL ?? "",
    environment.SUPABASE_ANON_KEY ?? "",
    { auth: { persistSession: false, autoRefreshToken: false } },
  );
  const { error: signInError } = await client.auth.signInWithPassword({
    email,
    password: "database-test-password",
  });
  expect(signInError).toBeNull();

  return { client, id: user.id };
}

beforeAll(() => {
  requireEnvironment();
  service = createClient(
    environment.SUPABASE_URL ?? "",
    environment.SUPABASE_SERVICE_ROLE_KEY ?? "",
    { auth: { persistSession: false, autoRefreshToken: false } },
  );
});

afterEach(async () => {
  await Promise.all(
    createdUserIds.splice(0).map(async (id) => {
      const { error } = await service.auth.admin.deleteUser(id);
      expect(error).toBeNull();
    }),
  );
});

describe("row level security", () => {
  it("isolates projects, versions, and jobs between allowlisted users", async () => {
    const userA = await createUser(true);
    const userB = await createUser(true);

    const { data: project, error: projectError } = await userA.client
      .from("projects")
      .insert({ topic: "User A project" })
      .select("id")
      .single();
    expect(projectError).toBeNull();
    expect(project).not.toBeNull();
    if (!project) throw new Error("Expected project");

    const { data: version, error: versionError } = await userA.client
      .from("versions")
      .insert({ project_id: project.id, lang: "en" })
      .select("id")
      .single();
    expect(versionError).toBeNull();
    expect(version).not.toBeNull();
    if (!version) throw new Error("Expected version");

    const { error: jobError } = await userA.client.from("jobs").insert({
      version_id: version.id,
      stage: "draft_lyrics",
      idempotency_key: `rls-owner-${runId}`,
    });
    expect(jobError).toBeNull();

    for (const table of ["projects", "versions", "jobs"] as const) {
      const { data, error } = await userB.client.from(table).select("id");
      expect(error).toBeNull();
      expect(data).toEqual([]);
    }

    const { error: crossTenantInsertError } = await userB.client
      .from("jobs")
      .insert({
        owner_id: userA.id,
        version_id: version.id,
        stage: "draft_lyrics",
        idempotency_key: `rls-cross-tenant-${runId}`,
      });
    expect(crossTenantInsertError).not.toBeNull();
  });

  it("gives non-allowlisted users no profile or application rows", async () => {
    const blockedUser = await createUser(false);

    const { data: profiles, error: profileError } = await blockedUser.client
      .from("profiles")
      .select("id");
    expect(profileError).toBeNull();
    expect(profiles).toEqual([]);

    const { data: projects, error: projectsError } = await blockedUser.client
      .from("projects")
      .select("id");
    expect(projectsError).toBeNull();
    expect(projects).toEqual([]);
  });
});
