import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import { ENV_TABLE, stackDir } from "../../lib/envs.js";
import { rotateNativeLogins } from "../../lib/native/credentials.js";
import { NativeDiagnosticError } from "../../lib/native/diagnostics.js";
import { runStack } from "../../stack.js";
import { fixture } from "./fixtures.js";

vi.mock("../../stack.js", () => ({ runStack: vi.fn(async () => undefined) }));
vi.mock("../../lib/native/backup.js", () => ({
  nativeDatabase: async () => ({ layout: {}, logins: {} }),
}));
vi.mock("../../lib/native/maintenance.js", () => ({
  maintenanceDatabase: async () => ({
    db: { layout: {} },
    stop: async () => {},
  }),
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
    superuserConnection: () => sql,
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
