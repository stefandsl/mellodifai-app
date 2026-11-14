import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import { ENV_TABLE, stackDir } from "../../lib/envs.js";
import { rotateNativeLogins } from "../../lib/native/credentials.js";
import { NativeDiagnosticError } from "../../lib/native/diagnostics.js";
import { maintenanceDatabase } from "../../lib/native/maintenance.js";
import { superuserConnection } from "../../lib/native/postgres.js";
import { runStack } from "../../stack.js";
import { fixture } from "./fixtures.js";

vi.mock("../../stack.js", () => ({ runStack: vi.fn(async () => undefined) }));
vi.mock("../../lib/native/backup.js", () => ({
  nativeDatabase: async () => ({ layout: {}, logins: {} }),
}));
vi.mock("../../lib/native/maintenance.js", () => ({
  maintenanceDatabase: vi.fn(async () => ({
    db: { layout: {} },
    stop: async () => {},
  })),
}));
vi.mock("../../lib/native/secrets.js", () => ({
  loadNativeLogins: async () => ({
    logins: { postgres: "old-synthetic-credential" },
  }),
}));
vi.mock("../../lib/private-file.js", () => ({
  writePrivate: async (path: string, text: string) => {
    writeFileSync(path, text);
  },
}));
vi.mock("../../lib/native/postgres.js", () => {
  const sql = Object.assign(
    async () => [{ rolname: "postgres", ddl: "safe fixture ddl" }],
    {
      end: async () => {},
      unsafe: async () => {},
      begin: async (fn: (tx: unknown) => Promise<unknown>) => fn(sql),
    },
  );
  return {
    superuserConnection: vi.fn(() => sql),
    applyLogins: async () => {},
    roleConnection: () =>
      Object.assign(
        async () => {
          throw Object.assign(new Error("private driver text"), {
            code: "28P01",
          });
        },
        { end: async () => {} },
      ),
  };
});
afterEach(() => {
  vi.clearAllMocks();
  vi.unstubAllEnvs();
});

it("rolls back a lost pre-commit connection using the unchanged old login", async () => {
  vi.stubEnv("MELLODIFAI_ROOT", fixture());
  const secretDir = dirname(ENV_TABLE.e2e.signingKeysPath);
  mkdirSync(secretDir, { recursive: true });
  mkdirSync(stackDir("e2e"), { recursive: true });
  const files = [
    join(secretDir, "stack-secrets.json"),
    join(stackDir("e2e"), "role-passwords.json"),
    join(stackDir("e2e"), "native-logins.json"),
  ];
  for (const file of files)
    writeFileSync(
      file,
      JSON.stringify({ postgres: "old-synthetic-credential" }),
    );
  const original = superuserConnection({} as never, {});
  const failedUpdate = Object.assign(async () => [], {
    end: async () => {},
    begin: async () => {
      throw Object.assign(new Error("private query"), {
        code: "CONNECTION_CLOSED",
      });
    },
  });
  const wrongLogin = Object.assign(
    async () => {
      throw Object.assign(new Error("private login"), { code: "28P01" });
    },
    { end: vi.fn(async () => {}) },
  );
  vi.mocked(superuserConnection)
    .mockReturnValueOnce(original)
    .mockReturnValueOnce(failedUpdate as never)
    .mockReturnValueOnce(wrongLogin as never)
    .mockReturnValueOnce(original);
  await expect(rotateNativeLogins("e2e")).rejects.toThrow(
    "old credentials restored",
  );
  expect(wrongLogin.end).toHaveBeenCalledOnce();
  expect(vi.mocked(superuserConnection).mock.calls.at(-1)?.[1]).toEqual({
    postgres: "old-synthetic-credential",
  });
  expect(runStack).toHaveBeenCalledOnce();
  for (const file of files)
    expect(JSON.parse(readFileSync(file, "utf8")).postgres).toBe(
      "old-synthetic-credential",
    );
  const journal = JSON.parse(
    readFileSync(join(secretDir, "native-db-rotation.json"), "utf8"),
  );
  expect(journal.phase).toBe("rolled-back");
  expect(journal.failure).toContain("CONNECTION_CLOSED");
  expect(journal.failure).not.toContain("private query");
});

it("does not leave a blocking rotation journal when PostgreSQL fails before any role changes", async () => {
  vi.stubEnv("MELLODIFAI_ROOT", fixture());
  const secretDir = dirname(ENV_TABLE.e2e.signingKeysPath);
  mkdirSync(secretDir, { recursive: true });
  mkdirSync(stackDir("e2e"), { recursive: true });
  const files = [
    join(secretDir, "stack-secrets.json"),
    join(stackDir("e2e"), "role-passwords.json"),
    join(stackDir("e2e"), "native-logins.json"),
  ];
  for (const file of files)
    writeFileSync(
      file,
      JSON.stringify({ postgres: "old-synthetic-credential" }),
    );
  vi.mocked(maintenanceDatabase).mockRejectedValueOnce(
    new NativeDiagnosticError(
      "Native service postgres exited (exit code 1); see postgres.log",
    ),
  );
  await expect(rotateNativeLogins("e2e")).rejects.toThrow("exit code 1");
  const journal = JSON.parse(
    readFileSync(join(secretDir, "native-db-rotation.json"), "utf8"),
  );
  expect(journal.phase).toBe("rolled-back");
  expect(journal.failure).toContain("preparation");
  for (const file of files)
    expect(JSON.parse(readFileSync(file, "utf8")).postgres).toBe(
      "old-synthetic-credential",
    );
  expect(runStack).not.toHaveBeenCalled();
});

it.each([
  [
    new NativeDiagnosticError(
      "Native service rest exited during startup (exit code 23); see rest.log\nlast log line",
    ),
    "exit code 23",
  ],
  [
    Object.assign(new Error("query contained old-synthetic-credential"), {
      code: "ECONNRESET",
    }),
    "ECONNRESET",
  ],
])(
  "retains the activation cause through a clean rotation rollback",
  async (cause, expected) => {
    vi.stubEnv("MELLODIFAI_ROOT", fixture());
    const secretDir = dirname(ENV_TABLE.e2e.signingKeysPath);
    mkdirSync(secretDir, { recursive: true });
    mkdirSync(stackDir("e2e"), { recursive: true });
    const files = [
      join(secretDir, "stack-secrets.json"),
      join(stackDir("e2e"), "role-passwords.json"),
      join(stackDir("e2e"), "native-logins.json"),
    ];
    for (const file of files)
      writeFileSync(
        file,
        JSON.stringify({ postgres: "old-synthetic-credential" }),
      );
    vi.mocked(runStack).mockRejectedValueOnce(cause);
    const error = await rotateNativeLogins("e2e").catch((e) => e as Error);
    expect(error).toBeInstanceOf(NativeDiagnosticError);
    expect((error as Error).message).toContain("failed at restart");
    expect((error as Error).message).toContain(expected);
    expect((error as Error).message).not.toContain("old-synthetic-credential");
    expect(vi.mocked(runStack)).toHaveBeenCalledTimes(2);
    for (const file of files)
      expect(JSON.parse(readFileSync(file, "utf8")).postgres).toBe(
        "old-synthetic-credential",
      );
    const journal = JSON.parse(
      readFileSync(join(secretDir, "native-db-rotation.json"), "utf8"),
    );
    expect(journal.phase).toBe("rolled-back");
    expect(journal.failure).toContain(expected);
    expect(journal.failure).not.toContain("old-synthetic-credential");
  },
);
