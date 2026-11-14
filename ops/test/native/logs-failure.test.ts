import * as fs from "node:fs";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import { RotatingLog } from "../../lib/native/logs.js";
import { fixture } from "./fixtures.js";

vi.mock("node:fs", async (original) => {
  const real = await original<typeof import("node:fs")>();
  return {
    ...real,
    renameSync: vi.fn(real.renameSync),
    writeSync: vi.fn(real.writeSync),
  };
});
afterEach(() => {
  vi.mocked(fs.renameSync).mockReset();
  vi.mocked(fs.writeSync).mockReset();
});

const failure = (code: string) =>
  Object.assign(new Error(`${code}: synthetic failure`), { code });

it("keeps the live file and its handle when a rotation rename fails", () => {
  const file = join(fixture(), "auth.log");
  const log = new RotatingLog(file, { maxBytes: 200, keep: 2 });
  log.line(`first ${"a".repeat(80)}`);
  log.line(`second ${"b".repeat(80)}`);
  vi.mocked(fs.renameSync).mockImplementation(() => {
    throw failure("EBUSY");
  });
  // Past the bound: the rename is refused, as when a reader locks the file.
  expect(() => log.line(`third ${"c".repeat(80)}`)).not.toThrow();
  expect(() => log.line(`fourth ${"d".repeat(80)}`)).not.toThrow();
  const live = readFileSync(file, "utf8");
  expect(live).toContain("first");
  expect(live).toContain("fourth");
  vi.mocked(fs.renameSync).mockReset();
  // Once the rename works again the next line rotates normally.
  log.line(`fifth ${"e".repeat(80)}`);
  log.close();
  expect(readFileSync(`${file}.1`, "utf8")).toContain("first");
  expect(readFileSync(file, "utf8")).toContain("fifth");
});

it("stops growing past twice its bound while rotation keeps failing", () => {
  const file = join(fixture(), "rest.log");
  const log = new RotatingLog(file, { maxBytes: 200, keep: 2 });
  vi.mocked(fs.renameSync).mockImplementation(() => {
    throw failure("EBUSY");
  });
  for (let index = 0; index < 50; index++) log.line("x".repeat(40));
  log.close();
  expect(fs.statSync(file).size).toBeLessThanOrEqual(400);
  expect(log.dropped).toBeGreaterThan(0);
});

it("drops and counts a line it cannot write instead of throwing", () => {
  const file = join(fixture(), "storage.log");
  const log = new RotatingLog(file);
  log.line("before");
  vi.mocked(fs.writeSync).mockImplementationOnce(() => {
    throw failure("ENOSPC");
  });
  expect(() => log.line("lost")).not.toThrow();
  expect(log.dropped).toBe(1);
  log.line("after");
  log.close();
  const text = readFileSync(file, "utf8");
  expect(text).not.toContain("lost");
  expect(text).toMatch(/before\n.*1 log line\(s\) dropped.*\nafter\n/);
});

it("survives a write failure inside a child's stream handler", () => {
  const file = join(fixture(), "gateway.log");
  const log = new RotatingLog(file);
  const lines = log.stream();
  vi.mocked(fs.writeSync).mockImplementation(() => {
    throw failure("EIO");
  });
  expect(() => lines.write("one\ntwo\n")).not.toThrow();
  expect(() => lines.end()).not.toThrow();
  expect(log.dropped).toBe(2);
  vi.mocked(fs.writeSync).mockReset();
  log.close();
});
