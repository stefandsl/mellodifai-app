import { beforeEach as beforeDockerCase, vi as legacyRuntime } from "vitest";

beforeDockerCase(() => legacyRuntime.stubEnv("MELLODIFAI_RUNTIME", "docker"));

import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it, vi } from "vitest";
import { parse } from "yaml";
import {
  checkHealth,
  deployCommands,
  pinOps,
  productionDeploy,
  retainBackup,
} from "../deploy.js";
import {
  assertAtOrAfterFloor,
  planDeploy,
  runDeploy,
} from "../lib/deploy-plan.js";
import { type Runner, realRunner } from "../lib/run.js";

const mocks = vi.hoisted(() => ({
  secrets: vi.fn(async () => ({ postgres: "test-only-password" })),
  sql: Object.assign(
    vi.fn(async (strings: TemplateStringsArray) => {
      const query = strings.join("");
      if (query.includes("to_regclass")) return [{ name: "stack_settings" }];
      if (query.includes("fake_stack")) return [{ fake_stack: false }];
      return [{ version: "001" }];
    }),
    { end: vi.fn(async () => {}) },
  ),
  prepare: vi.fn(),
  passwords: vi.fn(async () => {}),
  probe: vi.fn(async () => ({ ok: true })),
}));
vi.mock("../lib/pg.js", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  ownerConnection: () => mocks.sql,
}));
vi.mock("../lib/stack-secrets.js", () => ({ loadStackSecrets: mocks.secrets }));
vi.mock("../lib/render.js", () => ({ prepareStackDir: mocks.prepare }));
vi.mock("../rotate-db-passwords.js", () => ({
  reapplyDbPasswords: mocks.passwords,
}));
vi.mock("../probe.js", () => ({ probe: mocks.probe }));
vi.mock("../services.js", () => ({
  presentServices: () =>
    new Set(["supabase", "worker", "auth", "web", "edge", "cloudflared"]),
}));

const scratch: string[] = [];
function temp() {
  const base = process.env.RUNNER_TEMP ?? "E:/mellodifai/tmp";
  mkdirSync(base, { recursive: true });
  const dir = mkdtempSync(join(base, "deploy-test-"));
  scratch.push(dir);
  return dir;
}
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.clearAllMocks();
  for (const dir of scratch.splice(0))
    rmSync(dir, { recursive: true, force: true });
});

function fixture(applied = false) {
  const calls: string[] = [];
  let migrated = false;
  return {
    calls,
    actions: {
      async step(step: { kind: string }) {
        calls.push(step.kind);
        if (step.kind === "migrate") migrated = true;
      },
      async migrations() {
        return migrated && applied ? ["001", "002"] : ["001"];
      },
      async fakeStack() {
        return false;
      },
      async rollback() {
        calls.push("rollback");
      },
      async log(message: string) {
        calls.push(message);
      },
    },
  };
}
const input = { target: "m1-test", hasAuth: true, skipMigrations: false };

it("loads pinned set-owner and deploy tools with only standalone dependencies", async () => {
  const root = temp();
  const pnpm = process.env.npm_execpath;
  if (!pnpm) throw new Error("Run the package tests through pnpm");
  const runner: Runner = (cmd, args, opts) => {
    const installArgs = [...args];
    // Share only the package store, never the invoking workspace's node_modules.
    installArgs[installArgs.indexOf("--store-dir") + 1] =
      process.env.npm_config_store_dir ??
      join(process.env.RUNNER_TEMP ?? "E:/mellodifai", "cache/pnpm");
    return realRunner(cmd, installArgs, opts);
  };
  const pinned = await pinOps(
    fileURLToPath(new URL("../../", import.meta.url)),
    root,
    runner,
    pnpm,
  );
  const script = join(pinned, "load-tools.mts");
  writeFileSync(
    script,
    `
    import { createRequire } from "node:module";
    import { dirname, join } from "node:path";
    import { fileURLToPath } from "node:url";
    import { setOwner } from "./set-owner.ts";
    import "./deploy.ts";
    import "./services.ts";
    import "./check-no-keys.ts";
    const require = createRequire(import.meta.url);
    const dependency = require.resolve("@supabase/supabase-js");
    if (!dependency.startsWith(join(dirname(fileURLToPath(import.meta.url)), "node_modules"))) throw new Error("Ancestor dependency used");
    if (typeof setOwner !== "function") throw new Error("setOwner did not load");
    console.log("Pinned tools loaded with standalone dependencies");
  `,
  );
  const result = await realRunner(
    process.execPath,
    [createRequire(join(pinned, "package.json")).resolve("tsx/cli"), script],
    {
      cwd: pinned,
      env: { NODE_PATH: "", TEMP: root, TMP: root, TMPDIR: root },
    },
  );
  expect(result.code, result.stderr).toBe(0);
  expect(result.stdout).toContain(
    "Pinned tools loaded with standalone dependencies",
  );
}, 120_000);

describe("deploy", () => {
  it("copies the invoking checkout's ops package to <root>/ops-pinned/<ts> and runs every tool from there", async () => {
    const calls: { args: string[]; cwd: string | undefined }[] = [];
    const runner: Runner = async (_cmd, args, opts) => {
      calls.push({ args, cwd: opts?.cwd });
      return { code: 0, stdout: "", stderr: "" };
    };
    const root = temp();
    const checkout = join(root, "invoking-checkout");
    mkdirSync(join(checkout, "ops"), { recursive: true });
    writeFileSync(join(checkout, "ops/deploy.ts"), "// invoking version");
    writeFileSync(join(checkout, "ops/.env.local"), "must not copy");
    writeFileSync(
      join(checkout, "ops/tsconfig.json"),
      '{"extends":"../tsconfig.base.json"}',
    );
    writeFileSync(
      join(checkout, "pnpm-lock.yaml"),
      "importers:\n  ops:\n    dependencies: {}\n",
    );
    const pinned = await pinOps(checkout, root, runner, "pnpm.cjs", "stamp");
    expect(pinned).toBe(join(root, "ops-pinned", "stamp"));
    expect(readFileSync(join(pinned, "deploy.ts"), "utf8")).toBe(
      "// invoking version",
    );
    expect(existsSync(join(pinned, ".env.local"))).toBe(false);
    expect(existsSync(join(pinned, "tsconfig.json"))).toBe(false);
    expect(
      parse(readFileSync(join(pinned, "pnpm-lock.yaml"), "utf8")).importers,
    ).toEqual({ ".": { dependencies: {} } });
    expect(calls[0]?.cwd).toBe(pinned);
    expect(calls[0]?.args).toContain("--frozen-lockfile");
  });
  it("orders: stop, backup, fetch+checkout, check-no-keys, install, migrate, reapply passwords, set-owner, build, start, health", () => {
    expect(planDeploy(input).map((s) => s.kind)).toEqual([
      "stop",
      "backup",
      "checkout",
      "check-no-keys",
      "install",
      "migrate",
      "passwords",
      "set-owner",
      "build-ops",
      "build-web",
      "build-auth",
      "start",
      "health",
    ]);
  });
  it("acts on the deploy clone <root>/deploy, never on the invoking checkout", () => {
    const repo = join(temp(), "deploy");
    const pinned = dirname(
      fileURLToPath(new URL("../deploy.ts", import.meta.url)),
    );
    const commands = planDeploy(input).flatMap((step) =>
      deployCommands(step, repo, pinned, "pnpm.cjs"),
    );
    expect(commands.length).toBeGreaterThan(5);
    for (const command of commands) expect(command.cwd).toBe(repo);
    for (const command of commands.filter((command) =>
      command.args.some((arg) => arg.endsWith(".ts")),
    )) {
      expect(command.args[1]?.startsWith(pinned)).toBe(true);
    }
    expect(
      commands.find((command) => command.args.includes("checkout"))?.args,
    ).toEqual(["checkout", "--detach", input.target]);
    expect(
      commands
        .find((command) =>
          command.args.some((arg) => arg.endsWith("check-no-keys.ts")),
        )
        ?.args.at(-1),
    ).toMatch(/[\\/]stacks$/);
  });
  it("skips the apps/auth build and start when the target has no apps/auth", () => {
    const plan = planDeploy({ ...input, hasAuth: false });
    expect(plan.some((s) => s.kind === "build-auth")).toBe(false);
    expect(plan.find((s) => s.kind === "start")?.hasAuth).toBe(false);
  });
  it("refuses when stack_settings.fake_stack is on in prod", async () => {
    const f = fixture();
    f.actions.fakeStack = async () => true;
    await expect(runDeploy(input, f.actions)).rejects.toThrow("fake_stack");
    expect(f.calls).toEqual([]);
  });
  it("on a failed health check rolls back only when no migration was applied; otherwise leaves services stopped and logs to deploy.log", async () => {
    for (const applied of [false, true]) {
      const f = fixture(applied);
      const step = f.actions.step;
      f.actions.step = async (s) => {
        await step(s);
        if (s.kind === "health") throw new Error("secret raw response");
      };
      await expect(runDeploy(input, f.actions)).rejects.toThrow(
        "Deploy failed at health",
      );
      expect(f.calls.includes("rollback")).toBe(!applied);
      expect(f.calls.filter((c) => c === "stop")).toHaveLength(2);
      expect(f.calls.at(-1)).toContain("Deploy failed at health");
      expect(f.calls.join()).not.toContain("secret raw response");
    }
  });
  it("skip-migrations still reapplies passwords and sets owner", () => {
    const kinds = planDeploy({ ...input, skipMigrations: true }).map(
      (s) => s.kind,
    );
    expect(kinds).not.toContain("migrate");
    expect(kinds).toContain("passwords");
    expect(kinds).toContain("set-owner");
  });
});

it("checks local ops and the exact schema and refuses redirects", async () => {
  const request = vi
    .fn<typeof fetch>()
    .mockResolvedValue(
      new Response(JSON.stringify({ ops: "ok", schema: "002" })),
    );
  await checkHealth("002", request);
  expect(request.mock.calls[0]?.[0]).toBe("http://127.0.0.1:3000/api/health");
  expect(request.mock.calls[0]?.[1]?.redirect).toBe("error");
  vi.useFakeTimers();
  for (const data of [
    { ops: "ok", schema: "001" },
    { ops: "failed", schema: "002" },
  ]) {
    const bad = vi
      .fn<typeof fetch>()
      .mockImplementation(async () => new Response(JSON.stringify(data)));
    const result = expect(checkHealth("002", bad)).rejects.toThrow("health");
    await vi.runAllTimersAsync();
    await result;
  }
});

it("retains backups for 14 days without deleting unrelated files", () => {
  const directory = temp();
  const old = join(directory, "old.sql");
  const current = join(directory, "current.sql");
  const unrelated = join(directory, "owner.sql");
  for (const file of [old, current, unrelated])
    writeFileSync(file, "test backup");
  writeFileSync(
    join(directory, ".deploy-backups.json"),
    JSON.stringify([{ file: "old.sql", created: Date.now() - 15 * 86400000 }]),
  );
  retainBackup(directory, current);
  expect(existsSync(old)).toBe(false);
  expect(existsSync(current)).toBe(true);
  expect(existsSync(unrelated)).toBe(true);
});

it("leaves services stopped when rollback fails or migration history cannot be read", async () => {
  for (const unreadable of [false, true]) {
    const f = fixture();
    const step = f.actions.step;
    f.actions.step = async (s) => {
      await step(s);
      if (s.kind === "health") throw new Error("unhealthy");
    };
    f.actions.rollback = async () => {
      throw new Error("failed rollback");
    };
    let reads = 0;
    f.actions.migrations = async () => {
      if (++reads > 1 && unreadable) throw new Error("unreadable");
      return ["001"];
    };
    await expect(runDeploy(input, f.actions)).rejects.toThrow(
      "manual recovery",
    );
    expect(f.calls.at(-2)).toBe("stop");
  }
});

it("executes only against the deploy clone, keeps the database running for its explicit backup, and starts no absent auth", async () => {
  const root = temp();
  const repo = join(root, "deploy");
  mkdirSync(join(repo, "supabase/migrations"), { recursive: true });
  writeFileSync(join(repo, "supabase/migrations/002_test.sql"), "-- test");
  const calls: { cmd: string; args: string[]; cwd: string | undefined }[] = [];
  const runner: Runner = async (cmd, args, opts) => {
    calls.push({ cmd, args, cwd: opts?.cwd });
    let stdout = "";
    if (args.includes("--show-toplevel")) stdout = repo;
    else if (args[0] === "rev-parse") stdout = "abc123";
    else if (args[0] === "describe") stdout = "m1-previous";
    if (args.includes("dump"))
      writeFileSync(args[args.indexOf("-f") + 1] as string, "-- fake backup");
    return { code: 0, stdout, stderr: "" };
  };
  vi.stubGlobal(
    "fetch",
    vi.fn(
      async () => new Response(JSON.stringify({ ops: "ok", schema: "002" })),
    ),
  );
  await productionDeploy(input, root, "pnpm.cjs", runner);
  expect(calls.every((call) => call.cwd === repo)).toBe(true);
  const dump = calls.find((call) => call.args.includes("dump"));
  expect(dump?.args).toEqual(
    expect.arrayContaining([
      "--data-only",
      "--schema",
      "public,auth,storage",
      "--workdir",
      "--db-url",
    ]),
  );
  expect(
    new URL(dump?.args[(dump?.args.indexOf("--db-url") ?? -1) + 1] as string)
      .port,
  ).toBe("44322");
  expect(dump?.args[dump.args.indexOf("-f") + 1]).toMatch(/-m1-previous\.sql$/);
  expect(
    calls.some(
      (call) => call.args.includes("__stop") && call.args.includes("supabase"),
    ),
  ).toBe(false);
  expect(calls.filter((call) => call.args.includes("__stop"))).toHaveLength(5);
  expect(calls.findIndex((call) => call.args.includes("dump"))).toBeGreaterThan(
    calls.findIndex(
      (call) => call.args.includes("__stop") && call.args.includes("worker"),
    ),
  );
  expect(
    calls.some(
      (call) => call.args.includes("__start") && call.args.includes("auth"),
    ),
  ).toBe(false);
  expect(mocks.passwords).toHaveBeenCalledOnce();
  expect(mocks.probe).toHaveBeenCalledOnce();
  expect(mocks.prepare).toHaveBeenCalledWith(expect.any(String), repo);
  expect(mocks.secrets).toHaveBeenCalledWith("prod");
});

it.each([false, true])(
  "native deploy uses the target migration tool and preserves skip-migrations=%s",
  async (skipMigrations) => {
    vi.stubEnv("MELLODIFAI_RUNTIME", "native");
    const root = temp();
    vi.stubEnv("MELLODIFAI_ROOT", root);
    const repo = join(root, "deploy");
    mkdirSync(join(repo, "supabase/migrations"), { recursive: true });
    writeFileSync(join(repo, "supabase/migrations/002_test.sql"), "-- test");
    const calls: string[][] = [];
    const runner: Runner = async (cmd, args) => {
      expect(cmd).not.toBe("docker");
      expect(args).not.toContain("--db-url");
      calls.push(args);
      const stdout = args.includes("--show-toplevel")
        ? repo
        : args[0] === "rev-parse"
          ? "abc123"
          : args[0] === "describe"
            ? "reviewed-tag"
            : "";
      return { code: 0, stdout, stderr: "" };
    };
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () => new Response(JSON.stringify({ ops: "ok", schema: "002" })),
      ),
    );
    await productionDeploy(
      { ...input, skipMigrations },
      root,
      "pnpm.cjs",
      runner,
      async (entry, args, from) => {
        await runner(process.execPath, [join(from, entry), ...args]);
      },
    );
    expect(
      calls.some(
        (args) =>
          args.some((arg) => arg.endsWith("native-backup.ts")) &&
          args.includes("backup"),
      ),
    ).toBe(true);
    const migration = calls.find((args) => args.includes("migrate"));
    expect(Boolean(migration)).toBe(!skipMigrations);
    if (migration) expect(migration).toContain(join(repo, "ops/stack.ts"));
    expect(
      calls.some((args) => args.includes("start") && args.includes("native")),
    ).toBe(true);
  },
);

async function gitRepo() {
  const repo = temp();
  const git = async (...args: string[]) => {
    const r = await realRunner("git", args, { cwd: repo });
    if (r.code) throw new Error("test git failed");
    return r.stdout.trim();
  };
  await git("init", "-b", "main");
  await git(
    "-c",
    "user.name=Test",
    "-c",
    "user.email=test@example.invalid",
    "commit",
    "--allow-empty",
    "-m",
    "old",
  );
  await git("tag", "old");
  return { repo, git };
}
it("refuses every target while the m1-floor tag does not exist", async () => {
  const { repo } = await gitRepo();
  for (const target of ["main", "old"])
    await expect(
      assertAtOrAfterFloor(repo, target, realRunner),
    ).rejects.toThrow("m1-floor");
}, 20_000);
it("refuses a tag that does not contain m1-floor", async () => {
  const { repo, git } = await gitRepo();
  await git(
    "-c",
    "user.name=Test",
    "-c",
    "user.email=test@example.invalid",
    "commit",
    "--allow-empty",
    "-m",
    "floor",
  );
  await git("tag", "m1-floor");
  await expect(assertAtOrAfterFloor(repo, "old", realRunner)).rejects.toThrow(
    "m1-floor",
  );
  await expect(
    assertAtOrAfterFloor(repo, "main", realRunner),
  ).resolves.toBeUndefined();
}, 20_000);
