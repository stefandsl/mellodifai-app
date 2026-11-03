import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { createRequire } from "node:module";
import { userInfo } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { realRunner, recordingRunner } from "../lib/run.js";
import { runtimeRoot } from "../lib/runtime.js";
import {
  aclCommands,
  aclProbePaths,
  expectedPortOwners,
  icaclsProbe,
  installCommands,
  planStart,
  portOwners,
  SERVICE_ORDER,
  startAll,
  stopAll,
  watchPorts,
} from "../lib/services.js";
import { probe } from "../probe.js";
import { reapplyDbPasswords } from "../rotate-db-passwords.js";
import {
  main,
  managedService,
  presentServices,
  SERVICE_ACCOUNTS,
} from "../services.js";

vi.mock("../rotate-db-passwords.js", () => ({ reapplyDbPasswords: vi.fn() }));
vi.mock("../probe.js", () => ({ probe: vi.fn() }));

describe("services", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.mocked(probe).mockResolvedValue({ ok: true, failures: [] });
  });

  it("install prints account, ACL and firewall commands and runs nothing without --apply", async () => {
    const commands = installCommands({ root: runtimeRoot() });
    const output = commands.flat().join(" ");
    expect(output).toContain("mdf-web");
    expect(output).toContain("mdf-auth");
    expect(output).toContain("mdf-tunnel");
    expect(output).toContain("icacls");
    expect(output).toContain("New-NetFirewallRule");
    const write = vi
      .spyOn(process.stdout, "write")
      .mockImplementation(() => true);
    try {
      const runner = recordingRunner();
      const check = vi.fn();
      await main(["install"], runner, check);
      expect(write.mock.calls.map(([line]) => line).join("")).toBe(
        commands
          .map((command) => `${command.map((part) => `"${part}"`).join(" ")}\n`)
          .join(""),
      );
      expect(runner.calls).toEqual([]);
      expect(check).not.toHaveBeenCalled();
    } finally {
      write.mockRestore();
    }
  });

  it("the icacls probe fails install when mdf-web can read secrets or write the deploy clone", async () => {
    const runner = recordingRunner([
      { code: 0, stdout: "read:secrets\\auth\nwrite:deploy\n", stderr: "" },
    ]);
    const empty = mkdtempSync(join(runtimeRoot(), "tmp", "acl-probe-"));
    try {
      await expect(icaclsProbe("mdf-web", empty, runner)).resolves.toEqual([
        "read:secrets\\auth",
        "write:deploy",
      ]);
    } finally {
      rmSync(empty, { recursive: true, force: true });
    }
    const installRunner = recordingRunner();
    const checkAcl = vi.fn(async () => ["read:secrets/auth", "write:deploy"]);
    const write = vi
      .spyOn(process.stdout, "write")
      .mockImplementation(() => true);
    try {
      await expect(
        main(["install", "--apply"], installRunner, checkAcl),
      ).rejects.toThrow(/ACL probe failed for mdf-web/);
      expect(installRunner.calls).toHaveLength(
        installCommands({ root: runtimeRoot() }).length,
      );
      expect(checkAcl).toHaveBeenCalledTimes(1);
    } finally {
      write.mockRestore();
    }
  });

  it("portOwners normalizes Windows account names", async () => {
    const runner = recordingRunner([
      {
        code: 0,
        stdout: JSON.stringify([
          { port: 3000, owner: "PC\\mdf-web" },
          { port: 3010, owner: "PC\\mdf-auth" },
          { port: 3080, owner: "PC\\mdf-web" },
        ]),
        stderr: "",
      },
    ]);
    await expect(portOwners(runner)).resolves.toEqual({
      3000: "pc\\mdf-web",
      3010: "pc\\mdf-auth",
      3080: "pc\\mdf-web",
    });
  });

  it("assigns every exposed process to its dedicated account", () => {
    expect(SERVICE_ACCOUNTS).toEqual({
      web: "mdf-web",
      edge: "mdf-web",
      auth: "mdf-auth",
      cloudflared: "mdf-tunnel",
    });
  });

  it("a port owned by another account stops cloudflared", async () => {
    const runner = vi.fn(async (_cmd: string, args: string[]) => ({
      code: 0,
      stdout: args.some((a) => a.includes("Get-LocalUser"))
        ? JSON.stringify({
            3000: "pc\\mdf-web",
            3010: "pc\\mdf-auth",
            3080: "pc\\mdf-web",
          })
        : args.includes("__start")
          ? ""
          : args.some((a) => a.includes("Get-NetTCPConnection"))
            ? JSON.stringify([
                { port: 3000, owner: "DOMAIN\\mdf-web" },
                { port: 3010, owner: "PC\\mdf-auth" },
                { port: 3080, owner: "PC\\mdf-web" },
              ])
            : "",
      stderr: "",
    }));
    await expect(
      startAll(runner, {
        root: runtimeRoot(),
        present: new Set(SERVICE_ORDER),
      }),
    ).rejects.toThrow(/port owner/i);
    expect(
      runner.mock.calls.some(
        ([, args]) =>
          args.at(-1) === "cloudflared" && args.at(-2) === "__start",
      ),
    ).toBe(false);
  });

  it("cloudflared starts last, only after password re-apply and a passing probe", async () => {
    const events: string[] = [];
    vi.mocked(reapplyDbPasswords).mockImplementation(async () => {
      events.push("passwords");
    });
    vi.mocked(probe).mockImplementation(async () => {
      events.push("probe");
      return { ok: true, failures: [] };
    });
    const runner = vi.fn(async (_cmd: string, args: string[]) => {
      if (args.some((a) => a.includes("Get-LocalUser")))
        return {
          code: 0,
          stdout: JSON.stringify({
            3000: "pc\\mdf-web",
            3010: "pc\\mdf-auth",
            3080: "pc\\mdf-web",
          }),
          stderr: "",
        };
      if (args.some((a) => a.includes("Get-NetTCPConnection"))) {
        events.push("ports");
        return {
          code: 0,
          stdout: JSON.stringify([
            { port: 3000, owner: "PC\\mdf-web" },
            { port: 3010, owner: "PC\\mdf-auth" },
            { port: 3080, owner: "PC\\mdf-web" },
          ]),
          stderr: "",
        };
      }
      if (args.at(-2) === "__start") events.push(String(args.at(-1)));
      return { code: 0, stdout: "", stderr: "" };
    });
    await startAll(runner, {
      root: runtimeRoot(),
      present: new Set(SERVICE_ORDER),
    });
    expect(events).toEqual([
      "supabase",
      "passwords",
      "probe",
      "worker",
      "auth",
      "web",
      "edge",
      "ports",
      "cloudflared",
    ]);
  });

  it("watchPorts reports a later owner mismatch", async () => {
    vi.useFakeTimers();
    const mismatch = vi.fn();
    const stop = watchPorts(
      { 3000: "PC\\mdf-web" },
      mismatch,
      100,
      async () => ({
        3000: "DOMAIN\\mdf-web",
      }),
    );
    try {
      await vi.advanceTimersByTimeAsync(100);
      expect(mismatch).toHaveBeenCalledTimes(1);
    } finally {
      stop();
      vi.useRealTimers();
    }
  });

  it("tunnel drift: a live config differing from the template refuses start", async () => {
    mkdirSync(join(runtimeRoot(), "tmp"), { recursive: true });
    const base = mkdtempSync(join(runtimeRoot(), "tmp", "tunnel-drift-"));
    try {
      mkdirSync(join(base, "deploy/ops/cloudflared"), { recursive: true });
      mkdirSync(join(base, "secrets/cloudflared"), { recursive: true });
      const template = join(base, "deploy/ops/cloudflared/config.template.yml");
      const config = join(base, "secrets/cloudflared/config.yml");
      writeFileSync(
        template,
        "ingress:\n  - service: http://127.0.0.1:3080\n  - service: http_status:404\n",
      );
      writeFileSync(
        config,
        "ingress:\n  - service: http://127.0.0.1:54321\n  - service: http_status:404\n",
      );
      await expect(
        managedService("start", "cloudflared", base),
      ).rejects.toThrow(/drift/);
      expect(existsSync(join(base, "logs/cloudflared.pid.json"))).toBe(false);
    } finally {
      rmSync(base, { recursive: true, force: true });
    }
  });

  it("enumerates exact nested secret and executable paths as the owner", () => {
    const root = mkdtempSync(join(runtimeRoot(), "tmp", "acl-paths-"));
    try {
      for (const path of [
        "secrets/auth/nested/key.json",
        "stacks/e2e/config.json",
        "backups/day/db.sql",
        "deploy/apps/worker/bin/run.js",
        "tmp/nested/run.exe",
        "wt/branch/run.js",
      ]) {
        mkdirSync(join(root, path, ".."), { recursive: true });
        writeFileSync(join(root, path), "fixture");
      }
      const paths = aclProbePaths("mdf-web", root);
      expect(paths.reads).toContain(join(root, "secrets/auth/nested/key.json"));
      expect(paths.reads).toContain(join(root, "stacks/e2e/config.json"));
      expect(paths.writes).toContainEqual({
        path: join(root, "deploy/apps/worker/bin/run.js"),
        directory: false,
      });
      expect(paths.writes).toContainEqual({
        path: join(root, "tmp/nested"),
        directory: true,
      });
      expect(paths.writes).toContainEqual({
        path: join(root, "wt/branch/run.js"),
        directory: false,
      });
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("starts in SERVICE_ORDER and skips services the target lacks", async () => {
    expect(SERVICE_ORDER).toEqual([
      "supabase",
      "worker",
      "auth",
      "web",
      "edge",
      "cloudflared",
    ]);
    const present = new Set(
      SERVICE_ORDER.filter(
        (service) => service !== "auth" && service !== "cloudflared",
      ),
    );
    const runner = recordingRunner();
    await startAll(runner, { root: runtimeRoot(), present });
    expect(
      runner.calls
        .filter((call) => call.args.at(-2) === "__start")
        .map((call) => call.args.at(-1)),
    ).toEqual(planStart(present));
  });

  it("re-applies passwords and probes after supabase starts", async () => {
    const events: string[] = [];
    vi.mocked(reapplyDbPasswords).mockImplementation(async () => {
      events.push("passwords");
    });
    vi.mocked(probe).mockImplementation(async () => {
      events.push("probe");
      return { ok: true, failures: [] };
    });
    const runner = vi.fn(async (_cmd: string, args: string[]) => {
      events.push(`${args.at(-2)}:${args.at(-1)}`);
      return { code: 0, stdout: "", stderr: "" };
    });
    await startAll(runner, {
      root: runtimeRoot(),
      present: new Set(["supabase", "web"]),
    });
    expect(events).toEqual([
      "__stop:cloudflared",
      "__start:supabase",
      "passwords",
      "probe",
      "__start:web",
    ]);
    expect(reapplyDbPasswords).toHaveBeenCalledWith("prod", runner);
    expect(probe).toHaveBeenCalledWith("prod", runner);
  });

  it("never starts cloudflared when the probe fails", async () => {
    vi.mocked(probe).mockResolvedValue({
      ok: false,
      failures: ["probe refused"],
    });
    const runner = recordingRunner();
    await expect(
      startAll(runner, {
        root: runtimeRoot(),
        present: new Set(SERVICE_ORDER),
      }),
    ).rejects.toThrow("probe");
    expect(
      runner.calls.some(
        (call) =>
          call.args.at(-2) === "__start" && call.args.at(-1) === "cloudflared",
      ),
    ).toBe(false);
  });

  it("acl removes inheritance and grants only the owner and SYSTEM", () => {
    expect(aclCommands(runtimeRoot()).slice(0, 1)).toEqual([
      [
        "icacls",
        resolve(runtimeRoot()),
        "/inheritance:r",
        "/grant:r",
        `${userInfo().username}:(OI)(CI)F`,
        "SYSTEM:(OI)(CI)F",
      ],
    ]);
  });

  it("stops the selected services in reverse order", async () => {
    const runner = recordingRunner();
    await stopAll(runner, ["worker", "cloudflared", "web"]);
    expect(runner.calls.map((call) => call.args.at(-1))).toEqual([
      "cloudflared",
      "web",
      "worker",
    ]);
  });

  it("refuses a tunnel without a verified database start", async () => {
    await expect(
      startAll(recordingRunner(), {
        root: runtimeRoot(),
        present: new Set(["cloudflared"]),
      }),
    ).rejects.toThrow("supabase");
  });

  it("stops startup on command or password errors", async () => {
    const runner = recordingRunner([
      { code: 0, stdout: "", stderr: "" },
      { code: 1, stdout: "", stderr: "private detail" },
    ]);
    await expect(
      startAll(runner, {
        root: runtimeRoot(),
        present: new Set(SERVICE_ORDER),
      }),
    ).rejects.toThrow("supabase");
    expect(reapplyDbPasswords).not.toHaveBeenCalled();
    vi.mocked(reapplyDbPasswords).mockRejectedValue(
      new Error("password provisioning failed"),
    );
    await expect(
      startAll(recordingRunner(), {
        root: runtimeRoot(),
        present: new Set(SERVICE_ORDER),
      }),
    ).rejects.toThrow("provisioning");
    expect(probe).not.toHaveBeenCalled();
  });

  it.each(["passwords", "probe", "probe exception"])(
    "stops an existing tunnel before Supabase and keeps it stopped on %s failure",
    async (failure) => {
      let tunnelRunning = true;
      const runner = vi.fn(async (_cmd: string, args: string[]) => {
        const action = args.at(-2);
        const service = args.at(-1);
        if (service === "supabase") expect(tunnelRunning).toBe(false);
        if (service === "cloudflared") tunnelRunning = action === "__start";
        return { code: 0, stdout: "", stderr: "" };
      });
      if (failure === "passwords")
        vi.mocked(reapplyDbPasswords).mockRejectedValue(
          new Error("password failure"),
        );
      else if (failure === "probe exception")
        vi.mocked(probe).mockRejectedValue(new Error("probe failure"));
      else
        vi.mocked(probe).mockResolvedValue({
          ok: false,
          failures: ["refused"],
        });
      // Even when the target no longer includes tunnel config, its tracked process must stop.
      await expect(
        startAll(runner, {
          root: runtimeRoot(),
          present: new Set(["supabase", "web"]),
        }),
      ).rejects.toThrow();
      expect(runner.mock.calls[0]?.[1].slice(-2)).toEqual([
        "__stop",
        "cloudflared",
      ]);
      expect(tunnelRunning).toBe(false);
    },
  );

  it("does not touch Supabase when stopping the tunnel fails", async () => {
    const runner = recordingRunner([{ code: 1, stdout: "", stderr: "" }]);
    await expect(
      startAll(runner, {
        root: runtimeRoot(),
        present: new Set(SERVICE_ORDER),
      }),
    ).rejects.toThrow("stop failed: cloudflared");
    expect(runner.calls).toHaveLength(1);
    expect(reapplyDbPasswords).not.toHaveBeenCalled();
  });

  it("rejects C: runtime paths before starting a process", async () => {
    const runner = recordingRunner();
    await expect(
      startAll(runner, { root: "C:/runtime", present: new Set(SERVICE_ORDER) }),
    ).rejects.toThrow("outside C:");
    expect(runner.calls).toEqual([]);
  });
});

it.skipIf(process.platform !== "win32")(
  "manages a detached fake service and applies an owner-only ACL",
  async () => {
    const base = join(runtimeRoot(), "tmp");
    mkdirSync(base, { recursive: true });
    const root = mkdtempSync(join(base, "services-test-"));
    const cli = (args: string[]) =>
      realRunner(
        process.execPath,
        [
          createRequire(import.meta.url).resolve("tsx/cli"),
          fileURLToPath(new URL("../services.ts", import.meta.url)),
          ...args,
        ],
        {
          env: {
            MELLODIFAI_ROOT: root,
            npm_execpath: join(root, "fake-pnpm.cjs"),
          },
        },
      );
    try {
      const app = join(root, "deploy/apps/web");
      mkdirSync(app, { recursive: true });
      writeFileSync(
        join(app, "package.json"),
        JSON.stringify({ scripts: { start: "node fake.cjs" } }),
      );
      writeFileSync(
        join(app, "fake.cjs"),
        "const child = require('node:child_process').spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { detached: true, stdio: 'ignore' }); require('node:fs').writeFileSync('grandchild.pid', String(child.pid)); child.unref(); console.log('fake service ready'); console.error('fake stderr'); setInterval(() => {}, 1000);",
      );
      writeFileSync(
        join(root, "fake-pnpm.cjs"),
        "require(process.cwd() + '/fake.cjs');",
      );
      expect([...presentServices(root)]).toEqual(["web"]);
      expect((await cli(["acl"])).code).toBe(0);
      expect(existsSync(join(root, "logs"))).toBe(false);
      expect((await cli(["start"])).code).toBe(0);
      expect((await cli(["status"])).stdout.trim()).toBe("web: running");
      await vi.waitFor(
        () =>
          expect(readFileSync(join(root, "logs/web.log"), "utf8")).toContain(
            "fake service ready",
          ),
        { timeout: 15000 },
      );
      expect(readFileSync(join(root, "logs/web.error.log"), "utf8")).toContain(
        "fake stderr",
      );
      const grandchild = Number(
        readFileSync(join(app, "grandchild.pid"), "utf8"),
      );
      expect(grandchild).toBeGreaterThan(0);
      const state = JSON.parse(
        readFileSync(join(root, "logs/web.pid.json"), "utf8").replace(
          /^\uFEFF/,
          "",
        ),
      );
      expect(
        state.owner
          .toLowerCase()
          .endsWith(`\\${userInfo().username.toLowerCase()}`),
      ).toBe(true);
      expect(
        (
          await realRunner("taskkill.exe", [
            "/PID",
            String(state.supervisorPid),
            "/F",
          ])
        ).code,
      ).toBe(0);
      await vi.waitFor(
        async () => {
          const result = await realRunner("powershell.exe", [
            "-NoProfile",
            "-Command",
            `if (Get-Process -Id ${state.pid},${grandchild} -ErrorAction SilentlyContinue) { exit 1 }`,
          ]);
          expect(result.code).toBe(0);
        },
        { timeout: 10000 },
      );
      expect((await cli(["stop"])).code).toBe(0);
      expect((await cli(["start"])).code).toBe(0);
      expect((await cli(["start"])).code).toBe(1);
      expect((await cli(["stop"])).code).toBe(0);
      expect((await cli(["status"])).stdout.trim()).toBe("web: stopped");
      writeFileSync(
        join(root, "logs/web.pid.json"),
        JSON.stringify({ pid: process.pid, identity: "stale" }),
      );
      expect((await cli(["stop"])).code).toBe(0);
      mkdirSync(join(root, "deploy/ops/cloudflared"), { recursive: true });
      mkdirSync(join(root, "secrets/cloudflared"), { recursive: true });
      writeFileSync(
        join(root, "deploy/ops/cloudflared/config.template.yml"),
        "ingress:\n  - service: http_status:404\n",
      );
      writeFileSync(
        join(root, "secrets/cloudflared/config.yml"),
        "ingress:\n  - service: http://127.0.0.1:54321\n",
      );
      expect((await cli(["__start", "cloudflared"])).code).toBe(1);
      expect(existsSync(join(root, "logs/cloudflared.pid.json"))).toBe(false);
      expect(
        (await realRunner("icacls", [root, "/grant", "*S-1-1-0:(OI)(CI)R"]))
          .code,
      ).toBe(0);
      expect((await cli(["acl", "--apply"])).code).toBe(0);
      const acl = await realRunner(
        "powershell.exe",
        [
          "-NoProfile",
          "-NonInteractive",
          "-Command",
          "$a=Get-Acl -LiteralPath $env:MDF_ACL_ROOT; $a.AreAccessRulesProtected; $a.Access | ForEach-Object { $_.IdentityReference.Translate([System.Security.Principal.SecurityIdentifier]).Value }",
        ],
        { env: { MDF_ACL_ROOT: root } },
      );
      expect(acl.code).toBe(0);
      const lines = acl.stdout.trim().split(/\r?\n/);
      expect(lines[0]).toBe("True");
      expect(lines.slice(1)).toHaveLength(2);
      expect(lines).toContain("S-1-5-18");
      expect(lines).not.toContain("S-1-1-0");
    } finally {
      await cli(["stop"]);
      rmSync(root, { recursive: true, force: true });
    }
  },
  60000,
);

it.skipIf(process.platform !== "win32")(
  "removes unrelated explicit grants from nested protected paths before service grants",
  async () => {
    const root = mkdtempSync(join(runtimeRoot(), "tmp", "acl-reset-"));
    try {
      const files = [
        "deploy/apps/web/.env.local",
        "deploy/bin/start.js",
        "secrets/auth/key.json",
        "stacks/e2e/config.json",
        "backups/day/db.sql",
      ];
      for (const file of files) {
        mkdirSync(join(root, file, ".."), { recursive: true });
        writeFileSync(join(root, file), "fixture");
        expect(
          (
            await realRunner("icacls", [
              join(root, file),
              "/grant",
              "*S-1-1-0:F",
            ])
          ).code,
        ).toBe(0);
      }
      const commands = installCommands({ root });
      // Execute only the pre-account ACL hardening, never account creation or firewall changes.
      for (const [cmd, ...args] of commands.slice(1)) {
        if (args.some((arg) => arg.includes("Get-Credential"))) break;
        expect((await realRunner(cmd as string, args)).code).toBe(0);
      }
      for (const file of files) {
        const result = await realRunner("powershell.exe", [
          "-NoProfile",
          "-Command",
          `$a=Get-Acl -LiteralPath '${join(root, file)}'; $a.Access | ForEach-Object { $_.IdentityReference.Translate([Security.Principal.SecurityIdentifier]).Value }`,
        ]);
        expect(result.code).toBe(0);
        expect(result.stdout).not.toContain("S-1-1-0");
      }
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  },
  30000,
);

it("direct tunnel startup refuses a failing database probe after password reapplication", async () => {
  const root = mkdtempSync(join(runtimeRoot(), "tmp", "tunnel-db-"));
  try {
    for (const dir of ["deploy/ops/cloudflared", "secrets/cloudflared"])
      mkdirSync(join(root, dir), { recursive: true });
    for (const file of [
      "deploy/ops/cloudflared/config.template.yml",
      "secrets/cloudflared/config.yml",
    ])
      writeFileSync(
        join(root, file),
        "ingress:\n  - service: http_status:404\n",
      );
    const events: string[] = [];
    vi.mocked(reapplyDbPasswords).mockImplementation(async () => {
      events.push("passwords");
    });
    vi.mocked(probe).mockImplementation(async () => {
      events.push("probe");
      return { ok: false, failures: [] };
    });
    await expect(managedService("start", "cloudflared", root)).rejects.toThrow(
      /database probe/i,
    );
    expect(events).toEqual(["passwords", "probe"]);
    expect(reapplyDbPasswords).toHaveBeenCalledWith("prod", realRunner);
    expect(probe).toHaveBeenCalledWith("prod", realRunner);
    expect(existsSync(join(root, "logs/cloudflared.launch.json"))).toBe(false);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

it("rejects different domains on listeners sharing one port", async () => {
  const runner = recordingRunner([
    {
      code: 0,
      stderr: "",
      stdout: JSON.stringify([
        { port: 3000, owner: "PC\\mdf-web" },
        { port: 3000, owner: "DOMAIN\\mdf-web" },
      ]),
    },
  ]);
  await expect(portOwners(runner)).rejects.toThrow(/owner mismatch/);
});

it.each(["PC\\mdf-web", "DOMAIN\\owner"])(
  "preserves the expected identity %s",
  async (owner) => {
    const runner = recordingRunner([
      {
        code: 0,
        stderr: "",
        stdout: JSON.stringify({ 3000: owner, 3010: owner, 3080: owner }),
      },
    ]);
    expect(await expectedPortOwners(runner)).toEqual({
      3000: owner.toLowerCase(),
      3010: owner.toLowerCase(),
      3080: owner.toLowerCase(),
    });
  },
);

it.skipIf(process.platform !== "win32")(
  "reads fully qualified expected identities from Windows",
  async () => {
    const owners = await expectedPortOwners();
    expect(Object.keys(owners).sort()).toEqual(["3000", "3010", "3080"]);
    for (const owner of Object.values(owners))
      expect(owner).toMatch(/^[^\\]+\\[^\\]+$/);
  },
);

it.skipIf(process.platform !== "win32")(
  "keeps the existing firewall rule when its update fails",
  async () => {
    const command = installCommands({ root: runtimeRoot() }).find((parts) =>
      parts.some((part) => part.includes("New-NetFirewallRule")),
    );
    expect(command).toBeDefined();
    const script = `
$script:protected=$true
$script:updated=$false
function Get-NetFirewallRule { [pscustomobject]@{Name='existing'} }
function Remove-NetFirewallRule { $script:protected=$false }
function New-NetFirewallRule { throw 'injected failure' }
function Set-NetFirewallRule { $script:updated=$true; throw 'injected failure' }
try { & { ${command?.at(-1)} } } catch {}
if (-not $script:protected -or -not $script:updated) { exit 1 }
exit 0
`;
    expect(
      (
        await realRunner("powershell.exe", [
          "-NoProfile",
          "-NonInteractive",
          "-Command",
          script,
        ])
      ).code,
    ).toBe(0);
  },
);

it.skipIf(process.platform !== "win32")(
  "does not execute a suspended service until it is contained and resumed",
  async () => {
    const root = mkdtempSync(join(runtimeRoot(), "tmp", "suspended-service-"));
    try {
      writeFileSync(
        join(root, "child.cjs"),
        "require('node:fs').writeFileSync('executed', 'yes'); setInterval(() => {}, 1000);",
      );
      const source = fileURLToPath(
        new URL("../service-process.cs", import.meta.url),
      );
      const script = `
$ErrorActionPreference='Stop'
Add-Type -Path '${source}'
$service=[ServiceProcess]::CreateSuspended('${process.execPath}', '"${join(root, "child.cjs")}"', '${root}', '${join(root, "out.log")}', '${join(root, "err.log")}', $null, $null, $null)
try {
  Start-Sleep -Milliseconds 300
  if (Test-Path '${join(root, "executed")}') { throw 'Service ran before resume' }
  $service.Resume()
  for ($i=0; $i -lt 50 -and -not (Test-Path '${join(root, "executed")}'); $i++) { Start-Sleep -Milliseconds 100 }
  if (-not (Test-Path '${join(root, "executed")}')) { throw 'Service did not resume' }
} finally { $service.Dispose() }
`;
      expect(
        (
          await realRunner("powershell.exe", [
            "-NoProfile",
            "-NonInteractive",
            "-Command",
            script,
          ])
        ).code,
      ).toBe(0);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  },
  15000,
);
