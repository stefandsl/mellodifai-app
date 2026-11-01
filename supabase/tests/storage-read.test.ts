import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, expect, it } from "vitest";

function env(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} must be set to run database tests`);
  return value;
}

const prefix = `storage-read-${Date.now()}`;
const users: string[] = [];
const paths: string[] = [];
let service: SupabaseClient;

async function customer(suffix: string) {
  const email = `${prefix}-${suffix}@example.test`;
  expect(
    (await service.from("admin_allowlist").insert({ email })).error,
  ).toBeNull();
  const created = await service.auth.admin.createUser({
    email,
    password: "storage-read-password",
    email_confirm: true,
  });
  const id = created.data.user?.id;
  if (!id) throw new Error("user missing");
  users.push(id);
  // Allowlisted users start as admins; these play paying customers.
  await service.from("profiles").update({ role: "customer" }).eq("id", id);
  const client = createClient(env("SUPABASE_URL"), env("SUPABASE_ANON_KEY"), {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  expect(
    (
      await client.auth.signInWithPassword({
        email,
        password: "storage-read-password",
      })
    ).error,
  ).toBeNull();
  return { id, client };
}

async function preview(owner: string) {
  // The worker's layout: previews/<owner>/<project>/<lang>/<file>.
  const path = `previews/${owner}/project/it/take-1-preview.mp3`;
  const upload = await service.storage
    .from("previews")
    .upload(path, new Blob([new Uint8Array([1, 2, 3])]), {
      contentType: "audio/mpeg",
      upsert: true,
    });
  expect(upload.error).toBeNull();
  paths.push(path);
  return path;
}

beforeAll(() => {
  service = createClient(
    env("SUPABASE_URL"),
    env("SUPABASE_SERVICE_ROLE_KEY"),
    {
      auth: { persistSession: false, autoRefreshToken: false },
    },
  );
});

afterAll(async () => {
  if (!service) return;
  if (paths.length) await service.storage.from("previews").remove(paths);
  for (const id of users) await service.auth.admin.deleteUser(id);
  await service.from("admin_allowlist").delete().like("email", `${prefix}%`);
});

it("lets a customer play their own song previews but not another customer's", async () => {
  const alice = await customer("alice");
  const bob = await customer("bob");
  const own = await preview(alice.id);
  const other = await preview(bob.id);
  const mine = await alice.client.storage
    .from("previews")
    .createSignedUrl(own, 60);
  expect(mine.error).toBeNull();
  expect(mine.data?.signedUrl).toContain("take-1-preview.mp3");
  const theirs = await alice.client.storage
    .from("previews")
    .createSignedUrl(other, 60);
  expect(theirs.data?.signedUrl).toBeUndefined();
});
