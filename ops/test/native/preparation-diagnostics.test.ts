import { expect, it, vi } from "vitest";
import {
  applyAppMigrations,
  applyStackSettings,
} from "../../lib/native/migrate.js";
import { applyLogins } from "../../lib/native/postgres.js";
import { migrateApp, type NativeContext } from "../../lib/native/supervisor.js";
import { applyRolePasswords } from "../../lib/roles.js";

vi.mock("../../lib/roles.js", () => ({
  applyRolePasswords: vi.fn(async () => {}),
  readStackPasswords: async () => ({}),
}));
vi.mock("../../lib/native/migrate.js", () => ({
  applyAppMigrations: vi.fn(async () => []),
  applyStackSettings: vi.fn(async () => {}),
}));
vi.mock("../../lib/native/postgres.js", () => ({
  roleConnection: () => ({ end: async () => {} }),
  applyLogins: vi.fn(async () => {}),
}));

it.each([
  [applyAppMigrations, "app migrations"],
  [applyStackSettings, "stack settings"],
  [applyRolePasswords, "app role credentials"],
  [applyLogins, "login normalization and default-login probes"],
] as const)(
  "identifies the preparation stage for a connection reset without exposing SQL",
  async (operation, stage) => {
    vi.mocked(operation).mockRejectedValueOnce(
      Object.assign(new Error("private query and private value"), {
        code: "ECONNRESET",
      }),
    );
    const context = {
      env: "e2e",
      layout: { ports: { db: 46302 } },
      native: {
        logins: { postgres: "synthetic" },
        passwordFor: async () => "synthetic",
      },
    } as unknown as NativeContext;
    const error = await migrateApp(context, () => {}).catch((e) => e as Error);
    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toContain(
      `failed at ${stage}: operation failed (code ECONNRESET)`,
    );
    expect((error as Error).message).not.toContain("private");
  },
);
