import { spawnSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { expect, it, vi } from "vitest";
import {
  assertDataDiskFree,
  RotatingLog,
  securePrivateDirectory,
  serviceLog,
  watchDataDisk,
} from "../../lib/native/logs.js";
import { childService, runLogged } from "../../lib/native/processes.js";
import { fixture } from "./fixtures.js";

// Synthetic credentials: they open nothing.
const JWT =
  "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJzeW50aGV0aWMifQ.c3ludGhldGljLXNpZ25hdHVyZQ";
const HOP = "synthetic-hop-secret-0123456789abcdef0123456789";
const PASSWORD = "Synthetic/Pass@word";
const SIGNED = "synthetic-signed-url-token-value";
const REFRESH = "synthetic-refresh-token-9876";
// Short and plain: only the child's own environment can identify it.
const SMTP = "short-p4ss";

const leaks = [
  JWT,
  HOP,
  PASSWORD,
  encodeURIComponent(PASSWORD),
  SIGNED,
  REFRESH,
  SMTP,
  "postgres://supabase_auth_admin:",
];

function noLeak(text: string) {
  for (const value of leaks) expect(text, value).not.toContain(value);
}

it("writes every line of a child's output redacted, even split across writes", async () => {
  const dir = fixture();
  const file = join(dir, "auth.log");
  const env = {
    ...process.env,
    MDF_HOP_SECRET: HOP,
    GOTRUE_DB_DATABASE_URL: `postgres://supabase_auth_admin:${encodeURIComponent(PASSWORD)}@127.0.0.1:45622/postgres`,
  } as Record<string, string>;
  // Everything Auth, Storage or a driver could print, written in pieces.
  const script = [
    `const out = (t) => process.stdout.write(t);`,
    `out('{"level":"info","msg":"request completed","referer":"http://127.0.0.1:3210/auth/confirm?token_hash=${SIGNED}&type=signup","path":"/verify"}\\n');`,
    `out('redirect_to=http://127.0.0.1:3210/after?refresh=${REFRESH}\\n');`,
    `out('apikey: ${SIGNED}\\n'); out('Authorization: Bearer ${JWT}\\n');`,
    `out('jwt in a field ${JWT.slice(0, 20)}'); out('${JWT.slice(20)} done\\n');`,
    `out('GET /storage/v1/object/sign/b/o.mp3?token=${SIGNED} 200\\n');`,
    `process.stderr.write('could not connect to ' + process.env.GOTRUE_DB_DATABASE_URL + '\\n');`,
    `process.stderr.write('hop ' + process.env.MDF_HOP_SECRET + '\\n');`,
    `out('plain line kept\\n'); out('last line without a break');`,
  ].join("\n");
  const code = await runLogged(process.execPath, ["-e", script], {
    cwd: dir,
    env,
    logFile: file,
  });
  expect(code).toBe(0);
  const text = readFileSync(file, "utf8");
  noLeak(text);
  expect(text).toContain("plain line kept\n");
  expect(text).toContain("last line without a break\n");
  expect(text.split("\n").length).toBeGreaterThanOrEqual(9);
});

it("redacts a supervised service's output before it reaches its log", async () => {
  const dir = fixture();
  const file = join(dir, "storage.log");
  const service = childService(
    {
      id: "storage",
      command: process.execPath,
      args: [
        "-e",
        `console.log('ready'); console.log('Bearer ${JWT}'); console.error(process.env.MDF_HOP_SECRET); console.log('smtp ready ' + process.env.GOTRUE_SMTP_PASS); setTimeout(() => {}, 60000);`,
      ],
      env: {
        ...process.env,
        MDF_HOP_SECRET: HOP,
        GOTRUE_SMTP_PASS: SMTP,
      } as Record<string, string>,
      cwd: dir,
      dependsOn: [],
      ready: "http://127.0.0.1:1/",
    },
    file,
  );
  const running = await service.start();
  try {
    await vi.waitFor(
      () => expect(readFileSync(file, "utf8")).toContain("ready\n"),
      { timeout: 10_000 },
    );
    await vi.waitFor(
      () =>
        expect(readFileSync(file, "utf8").split("\n").length).toBeGreaterThan(
          4,
        ),
      { timeout: 10_000 },
    );
  } finally {
    await running.stop();
  }
  noLeak(readFileSync(file, "utf8"));
}, 30_000);

it("keeps each log under its size with a fixed number of rotated files", () => {
  const dir = fixture();
  const file = join(dir, "gateway.log");
  const log = new RotatingLog(file, { maxBytes: 1000, keep: 3 });
  for (let index = 0; index < 400; index++)
    log.line(`request ${String(index).padStart(4, "0")} ${"x".repeat(40)}`);
  log.close();
  for (const name of [file, `${file}.1`, `${file}.2`, `${file}.3`]) {
    expect(existsSync(name), name).toBe(true);
    expect(statSync(name).size, name).toBeLessThanOrEqual(1000);
  }
  expect(existsSync(`${file}.4`)).toBe(false);
  // Newest lines live, older ones shifted in order.
  expect(readFileSync(file, "utf8")).toContain("request 0399");
  const first = (name: string) =>
    Number(/request (\d{4})/.exec(readFileSync(name, "utf8"))?.[1]);
  expect(first(`${file}.1`)).toBeLessThan(first(file));
  expect(first(`${file}.2`)).toBeLessThan(first(`${file}.1`));
  expect(first(`${file}.3`)).toBeLessThan(first(`${file}.2`));
});

it("counts what a log already holds when a restart reopens it", () => {
  const file = join(fixture(), "auth.log");
  const first = new RotatingLog(file, { maxBytes: 1000, keep: 2 });
  for (let index = 0; index < 19; index++) first.line("y".repeat(50));
  first.close();
  expect(statSync(file).size).toBe(969);
  const again = new RotatingLog(file, { maxBytes: 1000, keep: 2 });
  again.line("z".repeat(50));
  again.close();
  expect(statSync(file).size).toBe(51);
  expect(statSync(`${file}.1`).size).toBe(969);
});

it("cuts a line that never ends instead of holding it in memory", () => {
  const dir = fixture();
  const file = join(dir, "rest.log");
  const log = serviceLog(file);
  const lines = log.stream();
  lines.write("a".repeat(200 * 1024));
  lines.end();
  log.close();
  expect(readFileSync(file, "utf8").split("\n").length).toBeGreaterThan(3);
});

it.runIf(process.platform === "win32")(
  "makes the log folder and the files in it private to their owner",
  async () => {
    const base = fixture();
    const dir = join(base, "logs");
    await securePrivateDirectory(dir);
    const preExisting = join(base, "logs-elevated");
    mkdirSync(preExisting, { recursive: true });
    expect(
      spawnSync("icacls", [preExisting, "/grant", "*S-1-5-32-544:F"]).status,
    ).toBe(0);
    await securePrivateDirectory(preExisting);
    const file = join(dir, "postgres.log");
    writeFileSync(file, "x");
    for (const target of [dir, preExisting, file]) {
      const acl = spawnSync("icacls", [target], { encoding: "utf8" }).stdout;
      const entries = acl
        .split(/\r?\n/)
        .map((line) => line.replace(target, "").trim())
        .filter((line) => line.includes(":("));
      expect(entries.length, acl).toBeGreaterThan(0);
      for (const entry of entries)
        expect(entry.toLowerCase(), acl).toContain(
          (process.env.USERNAME as string).toLowerCase(),
        );
      expect(acl).not.toMatch(
        /Everyone|Users|Authenticated|SYSTEM|Administrators/i,
      );
    }
  },
);

it("refuses to start below the data volume reserve and warns once while running", async () => {
  expect(() => assertDataDiskFree("E:/data", 100, () => 99)).toThrow(
    /below the 0 MB reserve|reserve/,
  );
  expect(() => assertDataDiskFree("E:/data", 100, () => 100)).not.toThrow();
  const free = [500, 90, 80, 70, 200, 50, 40];
  const warnings: string[] = [];
  vi.useFakeTimers();
  try {
    const stop = watchDataDisk("E:/data", (line) => warnings.push(line), {
      reserve: 100,
      free: () => free.shift() ?? 40,
      intervalMs: 1000,
    });
    for (let tick = 0; tick < 8; tick++) vi.advanceTimersByTime(1000);
    stop();
  } finally {
    vi.useRealTimers();
  }
  expect(warnings).toHaveLength(2);
  expect(warnings[0]).toMatch(
    /^warning: the data volume of E:\/data has 0 MB free/,
  );
});
