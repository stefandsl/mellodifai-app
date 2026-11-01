import { describe, expect, it } from "vitest";
import {
  backupFolderName,
  buildStamp,
  classifyMigrations,
  formatEnv,
  isBuildStale,
  localKeys,
  MSG,
  parseEnv,
  parseMigrationList,
  paths,
  restoreCheck,
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
