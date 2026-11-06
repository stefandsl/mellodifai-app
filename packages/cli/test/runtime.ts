import { mkdir, mkdtemp } from "node:fs/promises";
import { join, resolve } from "node:path";

export function testRuntimeRoot(env: NodeJS.ProcessEnv = process.env): string {
  const root = join(
    env.RUNNER_TEMP || env.MELLODIFAI_ROOT || "E:/mellodifai",
    "tmp",
    "cli-tests",
  );
  if (process.platform === "win32" && /^c:/i.test(resolve(root))) {
    throw new Error("CLI test runtime must not be on C:");
  }
  return root;
}

export async function fixtureDirectory(prefix: string): Promise<string> {
  const root = testRuntimeRoot();
  await mkdir(root, { recursive: true });
  return mkdtemp(join(root, prefix));
}
