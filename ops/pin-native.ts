import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { pinOps } from "./deploy.js";
import { realRunner } from "./lib/run.js";
import { runtimeRoot } from "./lib/runtime.js";

async function main(args: string[]) {
  if (
    args.length !== 2 ||
    args[0] !== "--stamp" ||
    !/^[a-zA-Z0-9][a-zA-Z0-9._-]*$/.test(args[1] ?? "") ||
    !process.env.npm_execpath
  )
    throw new Error("Usage: pnpm ops pin-native.ts --stamp <name>");
  const path = await pinOps(
    fileURLToPath(new URL("../", import.meta.url)),
    runtimeRoot(),
    realRunner,
    process.env.npm_execpath,
    args[1],
  );
  process.stdout.write(`${path}\n`);
}
if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
)
  main(process.argv.slice(2)).catch(() => {
    console.error(
      "Pinning failed; check the source lockfile and runtime access. No task was changed.",
    );
    process.exitCode = 1;
  });
