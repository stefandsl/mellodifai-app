import { mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";

/** Base directory for temporary test folders, outside C: on owner PCs and CI. */
export function testTempBase(): string {
  const base = resolve(process.env.RUNNER_TEMP || process.env.TEMP || tmpdir());
  mkdirSync(base, { recursive: true });
  return base;
}
