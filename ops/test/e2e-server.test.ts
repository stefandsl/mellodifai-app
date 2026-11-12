import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { expect, it } from "vitest";
import { prepareE2EServer } from "../e2e-server.js";

it("copies the server outside C without local secrets, dependencies or generated files", () => {
  const root = process.env.RUNNER_TEMP ?? "E:/mellodifai/tmp";
  mkdirSync(root, { recursive: true });
  const fixture = mkdtempSync(join(root, "e2e-server-test-"));
  try {
    const source = join(fixture, "source");
    for (const dir of [
      "apps/web",
      "node_modules",
      ".git",
      ".claude/worktrees",
      "apps/web/.next",
    ]) {
      mkdirSync(join(source, dir), { recursive: true });
      writeFileSync(join(source, dir, "marker"), "fixture");
    }
    writeFileSync(join(source, "apps/web/.env.local"), "fixture-secret");
    writeFileSync(join(source, "apps/web/tsconfig.tsbuildinfo"), "cache");
    writeFileSync(join(source, "apps/web/page.ts"), "export default 1;");
    const target = prepareE2EServer(source, join(fixture, "runtime"));
    expect(target.startsWith(join(fixture, "runtime"))).toBe(true);
    expect(readFileSync(join(target, "apps/web/page.ts"), "utf8")).toBe(
      "export default 1;",
    );
    for (const path of [
      "node_modules",
      ".git",
      ".claude",
      "apps/web/.next",
      "apps/web/.env.local",
      "apps/web/tsconfig.tsbuildinfo",
    ]) {
      expect(existsSync(join(target, path))).toBe(false);
    }
    expect(() => prepareE2EServer(source, "C:/unsafe-runtime")).toThrow();
  } finally {
    rmSync(fixture, { recursive: true, force: true });
  }
});
