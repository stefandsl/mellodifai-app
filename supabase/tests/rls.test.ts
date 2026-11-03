import { readFileSync } from "node:fs";
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
const createdEmails: string[] = [];
let userSequence = 0;
let service: SupabaseClient;

function requireEnvironment(): void {
  for (const name of requiredEnvironment) {
    if (!environment[name]) {
      throw new Error(`${name} must be set to run database tests`);
    }
  }
}

async function createUser(allowlisted: boolean): Promise<TestUser> {
  const email = `${allowlisted ? "allowed" : "blocked"}-${runId}-${userSequence++}@example.test`;

  if (allowlisted) {
    const { error } = await service
      .from("admin_allowlist")
      .insert({ email, role: "admin" });
    expect(error).toBeNull();
    createdEmails.push(email);
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
  if (createdEmails.length) {
    const cleanup = await service
      .from("admin_allowlist")
      .delete()
      .in("email", createdEmails.splice(0));
    expect(cleanup.error).toBeNull();
  }
});

async function fixture(user: TestUser) {
  const project = await user.client
    .from("projects")
    .insert({ topic: "Security test" })
    .select("id")
    .single();
  expect(project.error).toBeNull();
  const version = await user.client
    .from("versions")
    .insert({ project_id: project.data?.id, lang: "en" })
    .select("id")
    .single();
  expect(version.error).toBeNull();
  const intent = {
    version_id: version.data?.id,
    stage: "draft_lyrics",
    idempotency_key: `security-${user.id}`,
  };
  const job = await user.client
    .from("jobs")
    .insert(intent)
    .select("id")
    .single();
  expect(job.error).toBeNull();
  if (!job.data || !version.data) throw new Error("Missing fixture");
  return { intent, jobId: job.data.id, versionId: version.data.id };
}

function anonClient() {
  return createClient(
    environment.SUPABASE_URL ?? "",
    environment.SUPABASE_ANON_KEY ?? "",
    {
      auth: { persistSession: false, autoRefreshToken: false },
    },
  );
}

describe("row level security", () => {
  it("requires confirmed email before provisioning an allowlisted customer", async () => {
    const email = `unconfirmed-${runId}@example.test`;
    expect(
      (await service.from("admin_allowlist").insert({ email })).error,
    ).toBeNull();
    createdEmails.push(email);
    const created = await service.auth.admin.createUser({
      email,
      password: "database-test-password",
      email_confirm: false,
    });
    expect(created.error).toBeNull();
    if (!created.data.user) throw new Error("Missing unconfirmed user");
    const id = created.data.user.id;
    createdUserIds.push(id);
    expect(created.data.user.email_confirmed_at).toBeFalsy();
    const profile = await service.from("profiles").select("id").eq("id", id);
    expect(profile.error).toBeNull();
    expect(profile.data).toEqual([]);
    const client = anonClient();
    // Depending on Auth configuration an unconfirmed login is denied or has no profile.
    await client.auth.signInWithPassword({
      email,
      password: "database-test-password",
    });
    for (const table of ["profiles", "projects", "versions", "jobs"]) {
      const rows = await client.from(table).select("id");
      expect(rows.data ?? []).toEqual([]);
    }
    expect(
      (await service.auth.admin.updateUserById(id, { email_confirm: true }))
        .error,
    ).toBeNull();
    const confirmed = await service
      .from("profiles")
      .select("id, role")
      .eq("id", id)
      .single();
    expect(confirmed.error).toBeNull();
    expect(confirmed.data).toEqual({ id, role: "customer" });
  });

  it("refuses anonymous signup with a new email", async () => {
    const signup = await anonClient().auth.signUp({
      email: `new-signup-${runId}@example.test`,
      password: "database-test-password",
    });
    if (signup.data.user) createdUserIds.push(signup.data.user.id);
    expect(signup.error?.code).toBe("signup_disabled");
    expect(signup.data.user).toBeNull();
    expect(signup.data.session).toBeNull();
  });

  it("rejects public email signup even for an allowlisted address", async () => {
    const email = `signup-${runId}@example.test`;
    expect(
      (await service.from("admin_allowlist").insert({ email })).error,
    ).toBeNull();
    createdEmails.push(email);
    const signup = await anonClient().auth.signUp({
      email,
      password: "database-test-password",
    });
    if (signup.data.user) createdUserIds.push(signup.data.user.id);
    expect(signup.error?.code).toBe("signup_disabled");
    expect(signup.data.session).toBeNull();
  });

  it("allows enqueue and cancellation but denies worker-owned writes", async () => {
    const user = await createUser(true);
    const { intent, jobId } = await fixture(user);
    for (const patch of [
      { status: "done" },
      { attempts: 1 },
      { worker_id: "forged" },
      { result: {} },
      { error: "forged" },
      { heartbeat_at: new Date().toISOString() },
      { started_at: new Date().toISOString() },
      { finished_at: new Date().toISOString() },
    ]) {
      const insert = await user.client.from("jobs").insert({
        ...intent,
        idempotency_key: `${intent.idempotency_key}-${Object.keys(patch)[0]}`,
        ...patch,
      });
      expect(insert.error?.code).toBe("42501");
      const update = await user.client
        .from("jobs")
        .update(patch)
        .eq("id", jobId);
      expect(update.error?.code).toBe("42501");
    }
    expect(
      (
        await user.client
          .from("jobs")
          .update({ status: "running" })
          .eq("id", jobId)
      ).error?.code,
    ).toBe("42501");
    expect(
      (await user.client.from("jobs").delete().eq("id", jobId)).error?.code,
    ).toBe("42501");
    expect(
      (
        await user.client
          .from("job_events")
          .insert({ job_id: jobId, message: "forged" })
      ).error?.code,
    ).toBe("42501");
    expect(
      (await user.client.from("workers").insert({ id: `forged-${user.id}` }))
        .error?.code,
    ).toBe("42501");
    const cancel = await user.client
      .from("jobs")
      .update({ status: "cancelled" })
      .eq("id", jobId)
      .select("status")
      .single();
    expect(cancel.error).toBeNull();
    expect(cancel.data).toEqual({ status: "cancelled" });
    expect(
      (await service.from("jobs").update({ status: "running" }).eq("id", jobId))
        .error,
    ).toBeNull();
    const cancelRunning = await user.client
      .from("jobs")
      .update({ status: "cancelled" })
      .eq("id", jobId)
      .select("id");
    expect(cancelRunning.error).toBeNull();
    expect(cancelRunning.data).toEqual([]);
    for (const table of ["job_events", "workers"]) {
      expect(
        (
          await user.client
            .from(table)
            .update({ owner_id: user.id })
            .eq("owner_id", user.id)
        ).error?.code,
      ).toBe("42501");
      expect(
        (await user.client.from(table).delete().eq("owner_id", user.id)).error
          ?.code,
      ).toBe("42501");
    }
  });

  it("lets every admin read the render PC status, but not customers", async () => {
    const owner = await createUser(true);
    const otherAdmin = await createUser(true);
    const customer = await createUser(true);
    await service
      .from("profiles")
      .update({ role: "customer" })
      .eq("id", customer.id);
    const worker = await service
      .from("workers")
      .upsert({
        id: `pc-${owner.id}`,
        owner_id: owner.id,
        engines: { "ace-step": { installed: true, passedLangs: ["it"] } },
      })
      .select("id")
      .single();
    expect(worker.error).toBeNull();
    const read = (client: typeof owner.client) =>
      client
        .from("workers")
        .select("id,last_seen,kie_balance,engines")
        .eq("id", `pc-${owner.id}`)
        .maybeSingle();
    expect((await read(otherAdmin.client)).data?.engines).toMatchObject({
      "ace-step": { installed: true },
    });
    expect((await read(customer.client)).data).toBeNull();
    expect(
      (
        await otherAdmin.client
          .from("workers")
          .update({ engines: {} })
          .eq("id", `pc-${owner.id}`)
      ).error?.code,
    ).toBe("42501");
  });

  it("rejects cross-owner events and publication confirmers, but lets a worker track any job", async () => {
    const a = await createUser(true);
    const b = await createUser(true);
    const { jobId, versionId } = await fixture(a);
    expect(
      (
        await service
          .from("job_events")
          .insert({ owner_id: b.id, job_id: jobId, message: "cross-owner" })
      ).error?.code,
    ).toBe("23503");
    const worker = await service
      .from("workers")
      .upsert({ id: `cross-${b.id}`, owner_id: b.id, busy_job_id: jobId })
      .select("id")
      .single();
    expect(worker.error).toBeNull();
    expect(worker.data?.id).toBe(`cross-${b.id}`);
    const forbiddenWorkerField = await b.client
      .from("workers")
      .select("busy_job_id")
      .eq("id", worker.data?.id ?? "")
      .maybeSingle();
    expect(forbiddenWorkerField.error?.code).toBe("42501");
    const workerStatus = await b.client
      .from("workers")
      .select(
        "id,last_seen,kie_balance,youtube_uploads_today,youtube_quota_day,engine_version",
      )
      .eq("id", worker.data?.id ?? "")
      .maybeSingle();
    expect(workerStatus.error).toBeNull();
    expect(workerStatus.data?.id).toBe(worker.data?.id);
    const render = await service
      .from("renders")
      .insert({ owner_id: a.id, version_id: versionId, kind: "master" })
      .select("id")
      .single();
    expect(render.error).toBeNull();
    expect(
      (
        await a.client
          .from("publications")
          .insert({ render_id: render.data?.id, confirmed_by: b.id })
      ).error?.code,
    ).toBe("42501");
    const publication = await service
      .from("publications")
      .insert({ owner_id: a.id, render_id: render.data?.id })
      .select("id, confirmed_by")
      .single();
    expect(publication.error).toBeNull();
    expect(publication.data?.confirmed_by).toBeNull();
    expect(
      (
        await a.client
          .from("publications")
          .update({ confirmed_by: b.id })
          .eq("id", publication.data?.id)
      ).error?.code,
    ).toBe("42501");
    expect(
      (
        await service
          .from("job_events")
          .insert({ owner_id: a.id, job_id: jobId, message: "valid" })
      ).error,
    ).toBeNull();
    expect(
      (
        await service
          .from("workers")
          .insert({ id: `valid-${a.id}`, owner_id: a.id, busy_job_id: jobId })
      ).error,
    ).toBeNull();
  });

  it("denies queue RPCs to anonymous and authenticated clients", async () => {
    // These direct calls prove that worker RPCs cannot be reached through PostgREST.
    const user = await createUser(true);
    for (const client of [anonClient(), user.client]) {
      for (const [name, args] of [
        ["claim_job", { p_worker: "forged" }],
        [
          "heartbeat_job",
          { p_job: "00000000-0000-0000-0000-000000000000", p_worker: "forged" },
        ],
        ["requeue_stale", { p_seconds: 120 }],
      ] as const) {
        expect((await client.rpc(name, args)).error?.code).toBe("42501");
      }
    }
  });

  it("revokes profile trigger execution explicitly from all client roles", () => {
    const sql = readFileSync(
      "supabase/migrations/20261031000003_security.sql",
      "utf8",
    );
    expect(sql).toMatch(
      /revoke all on function public\.create_allowlisted_profile\(\) from public, anon, authenticated;/,
    );
  });

  it("prevents profile creation and self-promotion by authenticated users", async () => {
    const user = await createUser(false);
    expect(
      (
        await user.client.from("profiles").insert({
          id: user.id,
          email: `forged-${runId}@example.test`,
          role: "admin",
        })
      ).error?.code,
    ).toBe("42501");
    expect(
      (
        await service.from("profiles").insert({
          id: user.id,
          email: `customer-${user.id}@example.test`,
          role: "customer",
        })
      ).error,
    ).toBeNull();
    expect(
      (
        await user.client
          .from("profiles")
          .update({ role: "admin" })
          .eq("id", user.id)
      ).error?.code,
    ).toBe("42501");
    const profile = await service
      .from("profiles")
      .select("role")
      .eq("id", user.id)
      .single();
    expect(profile.error).toBeNull();
    expect(profile.data?.role).toBe("customer");
  });

  it("allows customers to read only their own preview paths", async () => {
    const a = await createUser(true);
    const b = await createUser(true);
    expect(
      (
        await service
          .from("profiles")
          .update({ role: "customer" })
          .eq("id", b.id)
      ).error,
    ).toBeNull();
    // Stored as the worker stores previews: previews/<owner>/... (migration 20261101000021).
    const paths = [
      `previews/${a.id}/security.txt`,
      `previews/${b.id}/security.txt`,
    ];
    try {
      for (const path of paths) {
        expect(
          (
            await service.storage
              .from("previews")
              .upload(path, "test", { contentType: "text/plain" })
          ).error,
        ).toBeNull();
      }
      expect(
        (await b.client.storage.from("previews").download(paths[0] ?? ""))
          .error,
      ).not.toBeNull();
      expect(
        (
          await b.client.storage
            .from("previews")
            .createSignedUrl(paths[0] ?? "", 60)
        ).error,
      ).not.toBeNull();
      expect(
        (await b.client.storage.from("previews").download(paths[1] ?? ""))
          .error,
      ).toBeNull();
      expect(
        (await a.client.storage.from("previews").download(paths[1] ?? ""))
          .error,
      ).toBeNull();
    } finally {
      expect(
        (await service.storage.from("previews").remove(paths)).error,
      ).toBeNull();
    }
  });
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
