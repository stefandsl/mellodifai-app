import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  AUTH_ORIGINS,
  mcpResource,
  OWNER_STACK_PORTS,
  patOnlySite,
} from "../lib/auth-origins.js";
import {
  API_URL,
  appWindowArgs,
  backupFolder,
  buildStamp,
  DESKTOP,
  desktopEnvValues,
  desktopPaths,
  formatEnvFile,
  isAppWindowProcess,
  isBackupFolder,
  isDesktopProcess,
  parseEnvFile,
  SITE_URL,
  validOwnerEmail,
  WEB_PORT,
  WORKER_KEYS_TEMPLATE,
  workerSettings,
} from "../lib/desktop.js";
import { ENV_TABLE, type StackEnv } from "../lib/envs.js";
import { nativePorts } from "../lib/native/layout.js";
import { assertTestStack } from "../test-db-guard.js";

const passwords = { mdf_web: "web pass/&", mdf_auth: "auth" };
const secrets = { anon: "anon-key", service: "service-key" };

afterEach(() => vi.unstubAllEnvs());

describe("desktop stack", () => {
  const ports = (env: StackEnv) =>
    [
      ...Object.values(ENV_TABLE[env].ports),
      ...Object.values(ENV_TABLE[env].listeners),
    ].filter((port): port is number => port !== null);

  it("keeps every port below the Windows dynamic range, where reserved blocks move", () => {
    for (const port of [...ports("desktop"), WEB_PORT])
      expect(port).toBeLessThan(49152);
  });

  it("shares no port, project or origin with any other stack", () => {
    const others = (Object.keys(ENV_TABLE) as StackEnv[]).filter(
      (env) => env !== "desktop",
    );
    for (const env of others) {
      for (const port of ports("desktop"))
        expect(ports(env)).not.toContain(port);
      expect(ENV_TABLE[env].projectId).not.toBe(DESKTOP.projectId);
      expect(ENV_TABLE[env].siteUrl).not.toBe(SITE_URL);
    }
    // The old CLI launcher used project "mellodifai", which is production's volume name.
    expect(DESKTOP.projectId).toBe("mellodifai_desktop");
  });

  it("runs real engines with a mail catcher and no Studio", () => {
    expect(DESKTOP.fakeStack).toBe(false);
    expect(DESKTOP.smtp).toBe("catcher");
    expect(DESKTOP.ports.studio).toBeNull();
    expect(SITE_URL).toBe("http://127.0.0.1:46300");
    expect(API_URL).toBe("http://127.0.0.1:46321");
  });

  it("is an owner stack: tests and e2e refuse it", () => {
    expect(OWNER_STACK_PORTS).toEqual(
      expect.arrayContaining([
        String(DESKTOP.ports.api),
        String(DESKTOP.ports.db),
      ]),
    );
    expect(() =>
      assertTestStack({
        SUPABASE_URL: API_URL,
        TEST_DB_URL: "postgresql://postgres:x@127.0.0.1:46322/postgres",
      }),
    ).toThrow(/non-test stack/);
  });

  it("serves PAT-only MCP from its own origin, like dev", () => {
    expect(patOnlySite(SITE_URL)).toBe(true);
    expect(patOnlySite(AUTH_ORIGINS.dev.siteUrl)).toBe(true);
    expect(patOnlySite(AUTH_ORIGINS.prod.siteUrl)).toBe(false);
    expect(patOnlySite(undefined)).toBe(false);
    expect(mcpResource(SITE_URL)).toBe("http://127.0.0.1:46300/api/mcp");
  });

  it("keeps its files under MELLODIFAI_ROOT", () => {
    const root = mkdtempSync(join(tmpdir(), "mdf-desktop-"));
    vi.stubEnv("MELLODIFAI_ROOT", root);
    const paths = desktopPaths();
    expect(paths.stack).toBe(join(root, "stacks", "desktop"));
    expect(paths.workerKeys).toBe(join(root, "config", "worker.env"));
    expect(paths.browser).toBe(join(root, "browser"));
  });

  it("runs every native listener inside its own block 46300-46329", () => {
    const native = Object.values(nativePorts("desktop")).filter(
      (port): port is number => port !== null,
    );
    const all = [...native, WEB_PORT];
    expect(new Set(all).size).toBe(all.length);
    for (const port of all) {
      expect(port).toBeGreaterThanOrEqual(46300);
      expect(port).toBeLessThanOrEqual(46329);
    }
    for (const env of ["dev", "e2e", "prod"] as StackEnv[])
      for (const port of Object.values(nativePorts(env)))
        expect(native).not.toContain(port);
    // The mail catcher needs both its web and SMTP listener, or status reports it stopped.
    expect(nativePorts("desktop").mailHttp).not.toBeNull();
    expect(nativePorts("desktop").mailSmtp).not.toBeNull();
  });

  it("never runs Docker or WSL: the controller drives the native runtime only", () => {
    const source = readFileSync(
      new URL("../desktop.ts", import.meta.url),
      "utf8",
    ).replaceAll(/^\s*(\/\/|\*).*$/gm, "");
    expect(source).not.toMatch(/docker|wsl/i);
    expect(source).toContain('runtime: "native"');
  });
});

describe("app window", () => {
  it("closes only Edge processes of this install's own profile", () => {
    const profile = "E:/MellodifAI/data/browser";
    const windows = "E:\\MellodifAI\\data\\browser";
    const edge = "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe";
    const line = (args: string) => `"${edge}" ${args}`;
    expect(
      isAppWindowProcess(
        line(`--app=http://127.0.0.1:46300 --user-data-dir=${windows} --x`),
        profile,
      ),
    ).toBe(true);
    expect(
      isAppWindowProcess(
        line(`--type=renderer --user-data-dir="${windows}"`),
        profile,
      ),
    ).toBe(true);
    // The owner's own Edge, another install's window, a longer folder name.
    expect(
      isAppWindowProcess(line("--profile-directory=Default"), profile),
    ).toBe(false);
    expect(
      isAppWindowProcess(
        line("--user-data-dir=E:\\Other\\data\\browser"),
        profile,
      ),
    ).toBe(false);
    expect(
      isAppWindowProcess(line(`--user-data-dir=${windows}2 --x`), profile),
    ).toBe(false);
  });

  it("opens the link as an app window with its own profile", () => {
    const args = appWindowArgs(
      "http://127.0.0.1:46321/auth/v1/verify?token=t&type=magiclink",
      "E:\\MellodifAI\\data\\browser",
    );
    expect(args[0]).toBe(
      "--app=http://127.0.0.1:46321/auth/v1/verify?token=t&type=magiclink",
    );
    expect(args).toContain("--user-data-dir=E:\\MellodifAI\\data\\browser");
    expect(args.some((arg) => arg.startsWith("--profile-directory"))).toBe(
      false,
    );
  });
});

describe("desktop env files", () => {
  it("gives the web app no service key and the worker no database password", () => {
    const { web, worker } = desktopEnvValues(secrets, passwords);
    expect(Object.values(web)).not.toContain("service-key");
    expect(web.MDF_WEB_DATABASE_URL).toBe(
      "postgresql://mdf_web:web%20pass%2F%26@127.0.0.1:46322/postgres",
    );
    expect(web.NEXT_PUBLIC_SUPABASE_URL).toBe(API_URL);
    expect(web.SITE_URL).toBe(SITE_URL);
    expect(worker).toEqual({
      SUPABASE_URL: API_URL,
      SUPABASE_ANON_KEY: "anon-key",
      SUPABASE_SERVICE_ROLE_KEY: "service-key",
    });
    expect(JSON.stringify(worker)).not.toContain("mdf_web");
  });

  it("gives the worker the fonts the installer ships, never the data folder's", () => {
    const paths = { workerKeys: "D:/keys.env", workerEnv: "D:/stack.env" };
    const settings = workerSettings(
      "I:/MellodifAI/app",
      paths,
      "owner-1",
      "PC1",
    );
    expect(settings.MELLODIFAI_FONTS).toBe(join("I:/MellodifAI/app", "fonts"));
    expect(settings.WORKER_ID).toBe("desktop-PC1");
    expect(settings.WORKER_OWNER_ID).toBe("owner-1");
    // Later files win: the stack's own keys override the owner's file.
    expect(settings.WORKER_ENV_FILES).toBe("D:/keys.env;D:/stack.env");
    expect(workerSettings("I:/app", paths, undefined)).not.toHaveProperty(
      "WORKER_OWNER_ID",
    );
  });

  it("round-trips through the env file format and refuses line breaks", () => {
    const { web } = desktopEnvValues(secrets, passwords);
    expect(parseEnvFile(formatEnvFile(web))).toEqual(web);
    expect(() => formatEnvFile({ KEY: "a\nINJECTED=1" })).toThrow();
    expect(() => formatEnvFile({ "bad key": "x" })).toThrow();
  });

  it("reads the owner's keys file, skipping comments and quotes", () => {
    expect(
      parseEnvFile(
        "# KIE_API_KEY=\nKIE_API_KEY = 'abc'\n\nOPENROUTER_API_KEY=\"x y\"\nnot a line",
      ),
    ).toEqual({ KIE_API_KEY: "abc", OPENROUTER_API_KEY: "x y" });
  });

  it("rebuilds the web app when the version or a public value changes", () => {
    const { web } = desktopEnvValues(secrets, passwords);
    const stamp = buildStamp("v1", web);
    expect(buildStamp("v1", { ...web })).toBe(stamp);
    expect(buildStamp("v2", web)).not.toBe(stamp);
    expect(
      buildStamp("v1", { ...web, NEXT_PUBLIC_SUPABASE_ANON_KEY: "other" }),
    ).not.toBe(stamp);
    // A rotated database password needs no rebuild: it is read at run time.
    expect(
      buildStamp("v1", { ...web, MDF_WEB_DATABASE_URL: "postgresql://other" }),
    ).toBe(stamp);
  });
});

describe("desktop processes", () => {
  const app = "E:\\MellodifAI\\app";
  it("recognises only this install's web server on its port", () => {
    const web = `"E:\\MellodifAI\\node\\node.exe" E:\\MellodifAI\\app\\node_modules\\.pnpm\\next@16\\node_modules\\next\\dist\\bin\\next start --hostname 127.0.0.1 --port ${WEB_PORT}`;
    expect(isDesktopProcess("web", web, app)).toBe(true);
    expect(
      isDesktopProcess("web", web.replaceAll("MellodifAI\\app", "deploy"), app),
    ).toBe(false);
    expect(
      isDesktopProcess("web", web.replace(String(WEB_PORT), "3000"), app),
    ).toBe(false);
    expect(isDesktopProcess("worker", web, app)).toBe(false);
  });
  it("never takes a sibling install whose folder name starts with this one's", () => {
    const worker = `"E:\\MellodifAI\\node\\node.exe" E:\\MellodifAI\\app2\\node_modules\\tsx\\dist\\cli.mjs E:\\MellodifAI\\app2\\apps\\worker\\src\\main.ts`;
    expect(isDesktopProcess("worker", worker, app)).toBe(false);
    expect(
      isDesktopProcess("worker", worker.replaceAll("app2", "app"), app),
    ).toBe(true);
  });
  it("recognises the worker by its entry file, with either slash", () => {
    expect(
      isDesktopProcess(
        "worker",
        "node e:/mellodifai/app/node_modules/tsx/dist/cli.mjs E:/MellodifAI/app/apps/worker/src/main.ts",
        app,
      ),
    ).toBe(true);
    expect(
      isDesktopProcess(
        "worker",
        "node tsx E:\\mellodifai\\deploy\\apps\\worker\\src\\main.ts",
        app,
      ),
    ).toBe(false);
  });
});

describe("desktop backups and checks", () => {
  it("names backup folders by time so they sort and can be recognised", () => {
    const at = new Date("2026-11-13T01:02:03.004Z");
    const folder = backupFolder("E:\\x\\backups", at);
    expect(folder).toBe(
      join("E:\\x\\backups", "2026-11-13T01-02-03-004Z-desktop"),
    );
    expect(isBackupFolder("2026-11-13T01-02-03-004Z-desktop")).toBe(true);
    expect(isBackupFolder("2026-11-13T01-02-03-004Z-m1-final.sql")).toBe(false);
    expect(isBackupFolder("..")).toBe(false);
  });

  it("accepts plain emails only", () => {
    expect(validOwnerEmail("nome@esempio.it")).toBe(true);
    for (const bad of [
      "",
      "nome",
      "nome@",
      "a b@c.it",
      `${"x".repeat(250)}@c.it`,
    ])
      expect(validOwnerEmail(bad)).toBe(false);
  });

  it("starts the owner's keys file with no active entry", () => {
    expect(parseEnvFile(WORKER_KEYS_TEMPLATE)).toEqual({});
    expect(WORKER_KEYS_TEMPLATE).toContain("# KIE_API_KEY=\n");
  });
});
