import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { Sql } from "postgres";
import { expect, it, vi } from "vitest";
import { addUser } from "../add-user.js";
import { runtimePath } from "../lib/envs.js";
import { ownerEmail } from "../set-owner.js";
import { signInLink } from "../sign-in-link.js";

it("addUser inserts the allowlist row before createUser", async () => {
  const calls: string[] = [];
  const sql = vi.fn(async () => {
    calls.push("allowlist");
  }) as unknown as Sql;
  const admin = {
    createUser: vi.fn(async () => {
      calls.push("createUser");
      return { data: { user: { id: "user" } }, error: null };
    }),
  };
  await addUser(sql, admin, "owner@example.test", "admin");
  expect(calls).toEqual(["allowlist", "createUser"]);
  expect(admin.createUser).toHaveBeenCalledWith({
    email: "owner@example.test",
    email_confirm: true,
  });
});

it("addUser refuses invalid roles before writing and propagates auth failures", async () => {
  const sql = vi.fn(async () => {}) as unknown as Sql;
  const admin = {
    createUser: vi.fn(async () => ({ error: new Error("auth failed") })),
  };
  await expect(
    addUser(sql, admin, "a@example.test", "bad" as "admin"),
  ).rejects.toThrow();
  expect(sql).not.toHaveBeenCalled();
  await expect(
    addUser(sql, admin, "a@example.test", "customer"),
  ).rejects.toThrow("auth failed");
});

it("signInLink targets the selected origin and returns a token-hash confirmation link", async () => {
  const admin = {
    generateLink: vi.fn(async () => ({
      data: { properties: { hashed_token: "test-hash" } },
      error: null,
    })),
  };
  const link = await signInLink(
    admin,
    "owner@example.test",
    "http://127.0.0.1:3219",
  );
  expect(admin.generateLink).toHaveBeenCalledWith({
    type: "magiclink",
    email: "owner@example.test",
    options: { redirectTo: "http://127.0.0.1:3219/auth/confirm" },
  });
  expect(link).toBe(
    "http://127.0.0.1:3219/auth/confirm?token_hash=test-hash&type=magiclink",
  );
});

it("owner email uses the environment before runtime config and fails closed when missing", () => {
  const directory = runtimePath(
    join(process.env.RUNNER_TEMP ?? "E:/mellodifai/tmp", "task-9-owner-"),
  );
  const root = mkdtempSync(directory);
  mkdirSync(join(root, "config"));
  writeFileSync(
    join(root, "config/ops.env"),
    'MELLODIFAI_OWNER_EMAIL="file@example.test"\n',
  );
  vi.stubEnv("MELLODIFAI_ROOT", root);
  vi.stubEnv("MELLODIFAI_OWNER_EMAIL", undefined);
  try {
    expect(ownerEmail()).toBe("file@example.test");
    vi.stubEnv("MELLODIFAI_OWNER_EMAIL", "env@example.test");
    expect(ownerEmail()).toBe("env@example.test");
    vi.stubEnv("MELLODIFAI_OWNER_EMAIL", "");
    expect(() => ownerEmail()).toThrow("required");
    vi.stubEnv("MELLODIFAI_OWNER_EMAIL", undefined);
    writeFileSync(join(root, "config/ops.env"), "");
    expect(() => ownerEmail()).toThrow("required");
  } finally {
    vi.unstubAllEnvs();
  }
});

it("signInLink refuses malformed target origins and failed generation", async () => {
  const admin = {
    generateLink: vi.fn(async () => ({
      data: null,
      error: new Error("failure"),
    })),
  };
  for (const url of [
    "javascript:alert(1)",
    "https://name:secret@example.test",
    "http://localhost/path",
  ]) {
    await expect(signInLink(admin, "a@example.test", url)).rejects.toThrow();
  }
  expect(admin.generateLink).not.toHaveBeenCalled();
  await expect(
    signInLink(admin, "a@example.test", "http://localhost:3219"),
  ).rejects.toThrow("generation failed");
});
