import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import type { Runner } from "../lib/run.js";
import { isRestoreAuthorization, productionRestore } from "../restore.js";

const f = vi.hoisted(() => ({
  calls: [] as string[],
  reset: vi.fn(),
  prepare: vi.fn(),
}));
vi.mock("../lib/recovery.js", async (original) => ({
  ...(await original<object>()),
  stopWriters: async () => {
    f.calls.push("stop");
  },
  recoveryDatabase: async () => ({
    url: "unused",
    quiesce: async () => {
      f.calls.push("quiesce");
    },
    backup: async () => {
      f.calls.push("backup");
    },
    import: async () => {
      f.calls.push("import");
    },
  }),
}));
vi.mock("../stack.js", () => ({
  runStackCommand: (...args: unknown[]) => {
    f.calls.push("reset");
    f.reset(...args);
  },
}));
vi.mock("../lib/roles.js", () => ({
  applyRolePasswords: async () => {},
  readStackPasswords: async () => ({}),
}));
vi.mock("../rotate-db-passwords.js", () => ({
  reapplyDbPasswords: async () => {
    f.calls.push("passwords");
  },
}));
vi.mock("../deploy.js", () => ({
  main: async (args: string[]) => {
    f.calls.push(args.join(" "));
  },
}));
vi.mock("../lib/render.js", () => ({
  prepareStackDir: (...args: unknown[]) => f.prepare(...args),
}));
let root = "";
afterEach(() => {
  vi.unstubAllEnvs();
  vi.clearAllMocks();
  f.calls.length = 0;
  if (root) rmSync(root, { recursive: true, force: true });
});
function fixture(belowFloor = false, legacy = false) {
  const base = process.env.RUNNER_TEMP ?? "E:/mellodifai/tmp";
  mkdirSync(base, { recursive: true });
  root = mkdtempSync(join(base, "restore-unit-"));
  vi.stubEnv("MELLODIFAI_ROOT", root);
  const backup = legacy
    ? join(root, "backups", "2026-11-03-task-33-pre-cutover.sql")
    : join(root, "2026-11-02T22-00-00-000Z-m1-floor.sql");
  mkdirSync(join(root, "backups"), { recursive: true });
  writeFileSync(
    backup,
    "-- PostgreSQL database dump\n-- PostgreSQL database dump complete",
  );
  const repo = join(root, "deploy");
  const runner: Runner = async (_cmd, args) => {
    let stdout = "";
    if (args.includes("--show-toplevel")) stdout = repo;
    else if (args[0] === "rev-parse") stdout = "abc123";
    else if (args[0] === "describe") stdout = "m1-current";
    else if (args[0] === "checkout") {
      expect(args.at(-1)).toBe("abc123");
      f.calls.push("checkout");
    }
    return {
      code: belowFloor && args[0] === "merge-base" ? 1 : 0,
      stdout,
      stderr: "",
    };
  };
  return { backup, runner, repo };
}
it("production restore validates first, backs up before checkout/reset, and deploys the backup tag without migrations", async () => {
  const x = fixture();
  await productionRestore(x.backup, x.runner);
  expect(f.calls).toEqual([
    "stop",
    "quiesce",
    "backup",
    "checkout",
    "reset",
    "import",
    "passwords",
    "--to m1-floor --skip-migrations",
  ]);
  const call = f.reset.mock.calls[0];
  expect(call?.slice(0, 2)).toEqual(["reset", "prod"]);
  expect(isRestoreAuthorization(call?.[2].restore)).toBe(true);
  expect(f.prepare).toHaveBeenCalledWith(expect.any(String), x.repo);
});
it("restores the exact legacy pre-cutover backup through the reviewed floor", async () => {
  const x = fixture(false, true);
  await productionRestore(x.backup, x.runner);
  expect(f.calls).toEqual([
    "stop",
    "quiesce",
    "backup",
    "checkout",
    "reset",
    "import",
    "passwords",
    "--to m1-floor --skip-migrations",
  ]);
});
it("a below-floor backup never stops, dumps, checks out or resets production", async () => {
  const x = fixture(true);
  await expect(productionRestore(x.backup, x.runner)).rejects.toThrow(
    "m1-floor",
  );
  expect(f.calls).toEqual([]);
});

it("rejects an incomplete backup before stopping writers", async () => {
  const x = fixture();
  writeFileSync(x.backup, "-- interrupted dump");
  await expect(productionRestore(x.backup, x.runner)).rejects.toThrow(
    "incomplete",
  );
  expect(f.calls).toEqual([]);
});
