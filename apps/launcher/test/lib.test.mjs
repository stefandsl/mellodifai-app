import { describe, expect, it } from "vitest";
import {
  assertIsolatedConfig,
  redactE2eStderr,
  rewriteE2eConfig,
} from "../../../tools/e2e-isolated-lib.mjs";
import {
  backupFolderName,
  buildStamp,
  classifyMigrations,
  formatEnv,
  isBuildStale,
  localKeys,
  MSG,
  normalizeEmail,
  parseEnv,
  parseMigrationList,
  paths,
  restoreCheck,
  secretValues,
  stopDecision,
  validatePassword,
  workerEnvFiles,
  workerOverrides,
} from "../src/lib.mjs";

describe("parseEnv", () => {
  it("reads supabase status -o env output with quotes and noise", () => {
    const text =
      "WARN: deprecated\r\nAPI_URL=\"http://127.0.0.1:54321\"\nANON_KEY='abc'\nexport X = y \n";
    expect(parseEnv(text)).toEqual({
      API_URL: "http://127.0.0.1:54321",
      ANON_KEY: "abc",
      X: "y",
    });
  });
  it("round-trips with formatEnv", () => {
    expect(parseEnv(formatEnv({ A: "1", B: "two" }))).toEqual({
      A: "1",
      B: "two",
    });
  });
});

describe("password validation", () => {
  it("requires a matching password of at least 10 characters", () => {
    expect(validatePassword("short", "short")).toContain("10");
    expect(validatePassword("long-password", "other-password")).toContain(
      "coincidono",
    );
    expect(validatePassword("long-password", "long-password")).toBeNull();
  });
});

it("normalizes an email before an exact allowlist lookup", () => {
  expect(normalizeEmail(" Admin@Mellodifai.Test ")).toBe(
    "admin@mellodifai.test",
  );
});

describe("stop decision", () => {
  it("only stops a stack it owns and that nobody else uses", () => {
    expect(
      stopDecision({
        startedSupabase: true,
        otherConsumers: false,
        force: false,
      }).stopSupabase,
    ).toBe(true);
    expect(
      stopDecision({
        startedSupabase: false,
        otherConsumers: false,
        force: false,
      }).message,
    ).toContain("non e' stato");
    expect(
      stopDecision({
        startedSupabase: true,
        otherConsumers: true,
        force: false,
      }).message,
    ).toContain("un'altra sessione");
    expect(
      stopDecision({
        startedSupabase: false,
        otherConsumers: true,
        force: true,
      }).stopSupabase,
    ).toBe(true);
  });
});

it("rewrites and rejects unsafe isolated e2e configuration", () => {
  const config = rewriteE2eConfig(
    'project_id = "mellodifai"\nport = 54321\nsite_url = "http://127.0.0.1:3000"',
    3310,
  );
  expect(config).toContain('project_id = "mellodifai_e2e"');
  expect(config).toContain("45621");
  expect(assertIsolatedConfig(config)).toBe(true);
  expect(() =>
    assertIsolatedConfig('project_id = "mellodifai"\nport = 54321'),
  ).toThrow();
});

it("redacts sensitive e2e stderr lines without logging stdout", () => {
  expect(
    redactE2eStderr("starting\nAPI_KEY=do-not-log\nJWT: do-not-log\nready"),
  ).toBe(
    "starting\n[redacted sensitive stderr line]\n[redacted sensitive stderr line]\nready",
  );
});

describe("localKeys", () => {
  const base = {
    API_URL: "http://127.0.0.1:54321",
    ANON_KEY: "a",
    SERVICE_ROLE_KEY: "s",
  };
  it("returns the local keys", () => {
    expect(localKeys(base)).toEqual({
      url: base.API_URL,
      anon: "a",
      service: "s",
    });
  });
  it("refuses a hosted project", () => {
    expect(localKeys({ ...base, API_URL: "https://x.supabase.co" })).toBeNull();
  });
  it("refuses incomplete output", () => {
    expect(localKeys({ API_URL: base.API_URL })).toBeNull();
  });
});

it("workerOverrides drops every Supabase connection value", () => {
  expect(
    workerOverrides({
      SUPABASE_URL: "u",
      SUPABASE_SERVICE_ROLE_KEY: "k",
      DATABASE_URL: "d",
      WORKER_ID: "w",
      WORKER_OWNER_ID: "o",
    }),
  ).toEqual({ WORKER_ID: "w", WORKER_OWNER_ID: "o" });
});

it("workerEnvFiles keeps order and skips missing files", () => {
  expect(workerEnvFiles(["a", "", "b", "c"], (f) => f !== "b")).toEqual([
    "a",
    "c",
  ]);
});

describe("classifyMigrations", () => {
  it("finds pending and unknown versions", () => {
    const rows = [
      { local: "1", remote: "1" },
      { local: "2", remote: "" },
      { local: "", remote: "9" },
    ];
    expect(classifyMigrations(rows)).toEqual({
      pending: ["2"],
      unknown: ["9"],
    });
  });
  it("is empty when in sync", () => {
    expect(classifyMigrations([{ local: "1", remote: "1" }])).toEqual({
      pending: [],
      unknown: [],
    });
  });
});

describe("build staleness", () => {
  const stamp = buildStamp({ head: "h", dirty: "d", publicEnv: "e" });
  it("changes with any input", () => {
    expect(buildStamp({ head: "h2", dirty: "d", publicEnv: "e" })).not.toBe(
      stamp,
    );
    expect(buildStamp({ head: "h", dirty: "d", publicEnv: "e2" })).not.toBe(
      stamp,
    );
  });
  it("rebuilds without a build or with a different stamp", () => {
    expect(isBuildStale({ hasBuild: false, savedStamp: stamp, stamp })).toBe(
      true,
    );
    expect(isBuildStale({ hasBuild: true, savedStamp: "old", stamp })).toBe(
      true,
    );
    expect(isBuildStale({ hasBuild: true, savedStamp: stamp, stamp })).toBe(
      false,
    );
  });
});

it("backupFolderName sorts by time", () => {
  expect(backupFolderName(new Date(2026, 0, 2, 3, 4, 5))).toBe(
    "2026-01-02_030405",
  );
});

it("restoreCheck refuses a backup from newer code", () => {
  expect(restoreCheck(["1", "2"], ["1", "2", "3"])).toEqual({
    ok: true,
    missing: [],
  });
  expect(restoreCheck(["1", "4"], ["1"])).toEqual({
    ok: false,
    missing: ["4"],
  });
});

it("paths stay under the data root on E:", () => {
  const p = paths("E:\\mellodifai");
  const { dataRoot, ...inside } = p;
  expect(dataRoot).toBe("E:\\mellodifai");
  for (const value of Object.values(inside))
    expect(value.startsWith("E:\\mellodifai\\")).toBe(true);
});

it("messages are plain Italian without the em dash", () => {
  const all = Object.values(MSG).map((m) =>
    typeof m === "function" ? m("x") : m,
  );
  for (const m of all) expect(m).not.toMatch(/\u2014/u);
  expect(MSG.dockerTimeout).toContain("Docker");
});

it("secretValues catches every key, secret and password URL", () => {
  expect(
    secretValues({
      API_URL: "http://127.0.0.1:54321",
      JWT_SECRET: "super-secret-jwt",
      S3_PROTOCOL_ACCESS_KEY_ID: "abcdefgh12",
      DB_URL: "postgresql://postgres:postgres@127.0.0.1:54322/postgres",
      SHORT_KEY: "abc",
    }).sort(),
  ).toEqual(
    [
      "abcdefgh12",
      "postgresql://postgres:postgres@127.0.0.1:54322/postgres",
      "super-secret-jwt",
    ].sort(),
  );
});

describe("parseMigrationList", () => {
  it("reads the markdown table", () => {
    const text = [
      "  `Local` | `Remote` | Time",
      "  `20261031000001` | `20261031000001` | `x`",
      "  ` ` | `20261101000023` | `y`",
      "  `2` | ` ` | `z`",
    ].join("\r\n");
    expect(parseMigrationList(text)).toEqual([
      { local: "20261031000001", remote: "20261031000001" },
      { local: "", remote: "20261101000023" },
      { local: "2", remote: "" },
    ]);
  });
  it("reads the JSON form", () => {
    expect(
      parseMigrationList(
        'Connecting\n{"migrations":[{"local":"1","remote":""}]}',
      ),
    ).toEqual([{ local: "1", remote: "" }]);
  });
  it("returns null for garbage", () => {
    expect(parseMigrationList("error: no db")).toBeNull();
  });
});

it("moves an e2e stack to another port block and project", () => {
  const config = rewriteE2eConfig(
    'project_id = "mellodifai"\nport = 54321\n[inbucket]\nport = 54324',
    3310,
    { base: 45720, project: "mellodifai_l2" },
  );
  expect(config).toContain('project_id = "mellodifai_l2"');
  expect(config).toContain("port = 45721");
  expect(config).toContain("port = 45724");
  expect(assertIsolatedConfig(config)).toBe(true);
  expect(() => rewriteE2eConfig("", 3310, { project: "mellodifai" })).toThrow();
  expect(() => rewriteE2eConfig("", 3310, { base: 45725 })).toThrow();
});
