import { randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { expect, it } from "vitest";
import { redactServiceOutput } from "../../lib/native/diagnostics.js";
import { serviceLog } from "../../lib/native/logs.js";
import { fixture } from "./fixtures.js";

const UUID = "550e8400-e29b-41d4-a716-446655440000";

/** Write a line as a service would when it is longer than one pipe read:
 * the text first, its line break in a later chunk. */
function written(line: string) {
  const file = join(fixture(), "service.log");
  const log = serviceLog(file);
  const lines = log.stream();
  lines.write(line);
  lines.write("\n");
  lines.end();
  log.close();
  return readFileSync(file, "utf8");
}

it("keeps paths and UUIDs in service output and still redacts keys and hashes", () => {
  const path = `E:/mellodifai/native-lab/stacks/e2e/native/storage/stub/uploads/${UUID}/take-01.mp3`;
  const hex = randomBytes(32).toString("hex");
  const base64 = "AbCdEfGhIjKlMn0pQrStUvWx/Yz0123456789AbCdEfGhIj+k=";
  const text = [
    `opened ${path}`,
    `job ${UUID} finished`,
    `object uploads/${UUID}/${UUID}.wav stored`,
    `rotated E:/mellodifai/native-lab/stacks/e2e/native/logs/supervisor.log.1`,
    `value ${hex}`,
    `value ${base64}`,
    `value ${"a".repeat(64)}`,
  ].join("\n");
  const safe = redactServiceOutput(text);
  expect(safe).toContain(path);
  expect(safe).toContain(`job ${UUID} finished`);
  expect(safe).toContain(`uploads/${UUID}/${UUID}.wav`);
  expect(safe).toContain(
    "E:/mellodifai/native-lab/stacks/e2e/native/logs/supervisor.log.1",
  );
  for (const value of [hex, base64, "a".repeat(64), hex.slice(0, 32)])
    expect(safe).not.toContain(value);
  for (const piece of base64.split("/"))
    expect(safe).not.toContain(piece.slice(0, 16));
});

it("never leaves a fragment of a key that crosses the cut of a long line", () => {
  const secret = randomBytes(32).toString("hex");
  // Spaces before the key, which starts 20 bytes before the 64 KiB cut.
  const filler = "w ".repeat((64 * 1024 - 20) / 2);
  const text = written(`${filler}${secret} tail`);
  expect(text).not.toContain(secret.slice(0, 20));
  expect(text).not.toContain(secret.slice(20));
  expect(text).toContain(" tail\n");
});

it("redacts both sides of a token too long to keep whole across the cut", () => {
  const secret = randomBytes(8 * 1024).toString("hex");
  const filler = "w ".repeat(30 * 1024);
  const text = written(`${filler}${secret} tail`);
  for (let index = 0; index + 24 <= secret.length; index += 24)
    expect(text).not.toContain(secret.slice(index, index + 24));
  expect(text).toContain(" tail\n");
});

it("omits both pieces when a credential word sits at the cut of a long line", () => {
  const value = "hunter2";
  // Separators that no token contains, no spaces: the word starts 4 bytes
  // before the hard cut.
  const filler = "x;".repeat((64 * 1024 - 4) / 2);
  const text = written(`${filler}password=${value};${"y;".repeat(100)}`);
  expect(text).not.toContain(value);
  expect(text).not.toContain("pass");
  expect(text).toContain("[REDACTED sensitive log line]");
});

it("cuts long lines on a UTF-8 boundary within the byte bound", () => {
  const text = written(`${"é".repeat(70_000)}`);
  expect(text).not.toContain("\uFFFD");
  const pieces = text.split("\n").filter(Boolean);
  expect(pieces.length).toBe(3);
  for (const piece of pieces)
    expect(Buffer.byteLength(piece)).toBeLessThanOrEqual(64 * 1024);
  expect(pieces.join("")).toBe("é".repeat(70_000));
});
