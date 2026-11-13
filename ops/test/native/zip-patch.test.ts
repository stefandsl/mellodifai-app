import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { expect, it } from "vitest";
import { applyPatch } from "../../lib/native/patch.js";
import { extractZip } from "../../lib/native/zip.js";
import { fixture, zip } from "./fixtures.js";

it.each([
  [0, "stored", false],
  [8, "deflated", false],
  [8, "", false],
  [0, "zip64", true],
] as const)("extracts method %s data %s zip64 %s", (method, data, large) => {
  const root = fixture();
  const dest = join(root, "out");
  mkdirSync(dest);
  const archive = join(root, "input.zip");
  writeFileSync(archive, zip("nested/file", data, method, large));
  expect(extractZip(archive, dest)).toEqual(["nested/file"]);
  expect(readFileSync(join(dest, "nested/file"), "utf8")).toBe(data);
});
it.each([
  "../escaped",
  "a/../../escaped",
  "C:/escaped",
  "a\\..\\escaped",
  "file:stream",
])("refuses an escaping entry %s", (name) => {
  const root = fixture();
  const archive = join(root, "input.zip");
  writeFileSync(archive, zip(name, "hostile"));
  expect(() => extractZip(archive, join(root, "out"))).toThrow("escapes");
  expect(existsSync(join(root, "escaped"))).toBe(false);
});
it("refuses a truncated archive", () => {
  const root = fixture();
  const archive = join(root, "input.zip");
  writeFileSync(archive, zip("file", "data").subarray(0, -10));
  expect(() => extractZip(archive, join(root, "out"))).toThrow(/zip archive/);
});
const patch = "--- a/file\n+++ b/file\n@@ -1,2 +1,2 @@\n context\n-old\n+new\n";
it("applies exact context and refuses a second application", () => {
  const root = fixture();
  const file = join(root, "file");
  writeFileSync(file, "context\nold\n");
  applyPatch(root, patch);
  expect(readFileSync(file, "utf8")).toBe("context\nnew\n");
  expect(() => applyPatch(root, patch)).toThrow("does not apply");
});
it("refuses changed context without writing anything", () => {
  const root = fixture();
  const file = join(root, "file");
  writeFileSync(file, "different\nold\n");
  expect(() => applyPatch(root, patch)).toThrow("does not apply");
  expect(readFileSync(file, "utf8")).toBe("different\nold\n");
});
