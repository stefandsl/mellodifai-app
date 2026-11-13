import type { ChildProcess } from "node:child_process";
import { EventEmitter } from "node:events";
import { appendFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { expect, it } from "vitest";
import {
  logOffset,
  observeService,
  redactServiceOutput,
  safeFailure,
} from "../../lib/native/diagnostics.js";
import { fixture } from "./fixtures.js";

it("keeps a crash signal and excludes output from previous launches", async () => {
  const log = join(fixture(), "rest.log");
  writeFileSync(log, "old launch text\n");
  const child = new EventEmitter() as ChildProcess;
  const observed = observeService(child, "rest", log, logOffset(log));
  appendFileSync(log, "new launch text\n");
  child.emit("exit", null, "SIGTERM");
  await observed.exited;
  const message = observed.failure("exited during startup").message;
  expect(message).toContain("signal SIGTERM");
  expect(message).toContain("new launch text");
  expect(message).not.toContain("old launch text");
});

it("redacts known credentials, encoded passwords, SQL, headers, JWTs and hashes", () => {
  const password = "small/p@ss";
  const text = [
    password,
    encodeURIComponent(password),
    "postgres://u:other@127.0.0.1/db",
    "Authorization: Bearer unknown",
    "STATEMENT: alter role example password 'short'",
    "cookie=unknown",
    "secret: unknown",
    "a".repeat(64),
    "socket bind failed: WSAEADDRINUSE",
  ].join("\n");
  const safe = redactServiceOutput(text, {
    PGRST_DB_URI: `postgres://u:${encodeURIComponent(password)}@127.0.0.1/db`,
  });
  for (const value of [
    password,
    encodeURIComponent(password),
    "other",
    "unknown",
    "short",
    "a".repeat(64),
  ])
    expect(safe).not.toContain(value);
  expect(safe).toContain("socket bind failed: WSAEADDRINUSE");
  expect(
    safeFailure(Object.assign(new Error("private query"), { code: "28P01" })),
  ).toContain("28P01");
  expect(safeFailure(new Error("private query"))).not.toContain(
    "private query",
  );
});

it("names a spawn failure and its log without exposing the spawn error message", async () => {
  const log = join(fixture(), "missing.log");
  const child = new EventEmitter() as ChildProcess;
  const observed = observeService(child, "auth", log, 0);
  child.emit(
    "error",
    Object.assign(new Error("private argument"), { code: "ENOENT" }),
  );
  await observed.exited;
  const message = observed.failure("could not spawn").message;
  expect(message).toContain("Native service auth");
  expect(message).toContain("ENOENT");
  expect(message).toContain(log);
  expect(message).toContain("log unavailable");
  expect(message).not.toContain("private argument");
});
