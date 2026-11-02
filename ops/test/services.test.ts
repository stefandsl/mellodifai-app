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
  planStart,
  SERVICE_ORDER,
  startAll,
  stopAll,
} from "../lib/services.js";
import { probe } from "../probe.js";
import { reapplyDbPasswords } from "../rotate-db-passwords.js";
import { presentServices } from "../services.js";

vi.mock("../rotate-db-passwords.js", () => ({ reapplyDbPasswords: vi.fn() }));
vi.mock("../probe.js", () => ({ probe: vi.fn() }));

describe("services", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.mocked(probe).mockResolvedValue({ ok: true, failures: [] });
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
      SERVICE_ORDER.filter((service) => service !== "auth"),
    );
    const runner = recordingRunner();
    await startAll(runner, { root: runtimeRoot(), present });
    expect(runner.calls.map((call) => call.args.at(-1))).toEqual(
      planStart(present),
    );
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
      events.push(args.at(-1) as string);
      return { code: 0, stdout: "", stderr: "" };
    });
    await startAll(runner, {
      root: runtimeRoot(),
      present: new Set(["supabase", "web"]),
    });
    expect(events).toEqual(["supabase", "passwords", "probe", "web"]);
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
      runner.calls.some((call) => call.args.at(-1) === "cloudflared"),
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
        { env: { MELLODIFAI_ROOT: root } },
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
        "console.log('fake service ready'); console.error('fake stderr'); setInterval(() => {}, 1000);",
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
      expect(readFileSync(join(root, "logs/web.log"), "utf8")).toContain(
        "fake stderr",
      );
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
