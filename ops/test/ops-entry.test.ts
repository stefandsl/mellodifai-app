import { readFileSync } from "node:fs";
import { expect, it } from "vitest";

// `pnpm ops deploy.ts` used to run through ops/node_modules/.bin/tsx.CMD. cmd.exe reads a batch
// file line by line from disk, and the deploy's own `pnpm install --package-import-method copy`
// rewrites that shim 100 bytes longer while it runs: cmd then read the tail of the new file,
// printed `"S" non e riconosciuto come comando` (the "S" of ".JS;") and started the whole
// deploy a second time, exiting 0. The entry must start node itself, never a .bin batch shim.
it("runs ops scripts with node itself, not through a rewritable batch shim", () => {
  const root = JSON.parse(
    readFileSync(new URL("../../package.json", import.meta.url), "utf8"),
  ) as { scripts: Record<string, string> };
  const words = (root.scripts.ops ?? "").split(/\s+/u);
  const tool = words[words.indexOf("exec") + 1];
  expect(words.slice(0, 3)).toEqual(["pnpm", "--dir", "ops"]);
  expect(tool).toBe("node");
  expect(root.scripts.ops).toContain("--import tsx");
});
