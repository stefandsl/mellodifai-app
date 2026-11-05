import { readFileSync } from "node:fs";
import { join } from "node:path";
import { runtimeRoot } from "./runtime.js";

export function workerEnvFile(root = runtimeRoot()): string {
  // Temporary fallback until the owner repairs the canonical file's ACL.
  for (const relative of [
    "deploy/apps/worker/.env.local",
    "config/worker.env",
  ]) {
    const path = join(root, relative);
    try {
      if (readFileSync(path, "utf8").trim()) return path;
    } catch (error) {
      if (
        !["ENOENT", "EACCES", "EPERM"].includes(
          (error as NodeJS.ErrnoException).code ?? "",
        )
      )
        throw error;
    }
  }
  throw new Error("Worker environment file is required");
}
