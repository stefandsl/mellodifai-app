import { lstat, readdir, readFile, realpath, stat } from "node:fs/promises";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { runtimeRoot } from "./lib/runtime.js";

type Finding = { path: string; reason: "name" | "jwk" };
const skipped = new Set(["node_modules", ".git", ".next", ".turbo"]);

function privateJwk(value: unknown): boolean {
  if (value === null || typeof value !== "object") return false;
  if ("kty" in value && "d" in value) return true;
  return Object.values(value).some(privateJwk);
}

export async function findKeyMaterial(roots: string[]): Promise<Finding[]> {
  const findings: Finding[] = [];
  const visited = new Set<string>();
  async function visit(path: string): Promise<void> {
    const name = basename(path).toLowerCase();
    if (
      skipped.has(name) ||
      (name === "worktrees" &&
        basename(dirname(path)).toLowerCase() === ".claude")
    )
      return;
    const entry = await lstat(path);
    // Do not traverse directory links into other checkouts or runtime trees.
    // Linked files are still inspected, so a linked private key cannot bypass the check.
    const info = entry.isSymbolicLink() ? await stat(path) : entry;
    if (info.isDirectory() && entry.isSymbolicLink()) return;
    const canonical = await realpath(path);
    if (visited.has(canonical)) return;
    visited.add(canonical);
    if (info.isDirectory()) {
      for (const child of (await readdir(path)).sort())
        await visit(join(path, child));
    } else if (info.isFile()) {
      if (/^(signing_keys.*|.*jwks.*)\.json$/i.test(name)) {
        findings.push({ path, reason: "name" });
      } else if (name.endsWith(".json")) {
        const contents = await readFile(path, "utf8");
        let value: unknown;
        try {
          value = JSON.parse(contents.replace(/^\uFEFF/, ""));
        } catch {
          return;
        }
        if (privateJwk(value)) findings.push({ path, reason: "jwk" });
      }
    }
  }
  for (const root of roots) await visit(resolve(root));
  return findings;
}

async function main(args: string[]): Promise<void> {
  const roots: string[] = [];
  for (let i = 0; i < args.length; i += 2) {
    const root = args[i + 1];
    if (args[i] !== "--root" || !root || root.startsWith("--")) {
      throw new Error("Usage: tsx check-no-keys.ts [--root <dir>]...");
    }
    roots.push(root);
  }
  if (roots.length === 0) {
    roots.push(fileURLToPath(new URL("../", import.meta.url)));
    const stacks = join(runtimeRoot(), "stacks");
    try {
      await lstat(stacks);
      roots.push(stacks);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
  }
  const findings = await findKeyMaterial(roots);
  for (const finding of findings)
    console.error(`${finding.reason}: ${finding.path}`);
  if (findings.length) process.exitCode = 1;
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  main(process.argv.slice(2)).catch(() => {
    // Filesystem and parse errors must never expose file contents or credentials.
    console.error("check-no-keys failed: check arguments and scan-root access");
    process.exitCode = 1;
  });
}
