import { isAbsolute, join } from "node:path";

export function workerRuntimeRoot(): string {
  const root =
    process.env.RUNNER_TEMP ?? process.env.MELLODIFAI_ROOT ?? "E:/mellodifai";
  if (!isAbsolute(root) || /^[cC]:[/\\]/.test(root))
    throw new Error("Worker runtime must be absolute and outside C:");
  return root;
}

export function workerTempDir(): string {
  return join(workerRuntimeRoot(), "tmp");
}
