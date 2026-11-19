import { isAbsolute, join } from "node:path";
import { runtimeRootFrom } from "./paths.js";

export function workerRuntimeRoot(): string {
  const root = runtimeRootFrom(process.env);
  if (!isAbsolute(root) || /^[cC]:[/\\]/.test(root))
    throw new Error("Worker runtime must be absolute and outside C:");
  return root;
}

export function workerTempDir(): string {
  return join(workerRuntimeRoot(), "tmp");
}
