import { mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";

/** Base directory for temporary test folders, outside C: on owner PCs and CI. */
export async function testTempBase(): Promise<string> {
  const base = resolve(process.env.RUNNER_TEMP || process.env.TEMP || tmpdir());
  await mkdir(base, { recursive: true });
  return base;
}
