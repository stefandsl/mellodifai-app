import { execFileSync } from "node:child_process";
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { join, resolve } from "node:path";
import { expect, it } from "vitest";
import { prepareE2EServer } from "../e2e-server.js";

const REPO_ROOT = resolve(import.meta.dirname, "../..");

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

it("writes content/changelog/tags.json from live git tags when copying a git repo without .git", () => {
  const root = process.env.RUNNER_TEMP ?? "E:/mellodifai/tmp";
  mkdirSync(root, { recursive: true });
  const fixture = mkdtempSync(join(root, "e2e-server-tags-"));
  try {
    const source = join(fixture, "source");
    mkdirSync(join(source, "apps/web/scripts/site-study"), { recursive: true });
    mkdirSync(join(source, "content/changelog"), { recursive: true });
    copyFileSync(
      join(REPO_ROOT, "apps/web/scripts/site-study/changelog-data.mjs"),
      join(source, "apps/web/scripts/site-study/changelog-data.mjs"),
    );

    const git = (args: string[], env?: Record<string, string>) =>
      execFileSync("git", args, {
        cwd: source,
        encoding: "utf8",
        env: env ? { ...process.env, ...env } : process.env,
        stdio: ["ignore", "pipe", "pipe"],
      });

    git(["init", "-b", "main"]);
    git(["config", "user.email", "test@mellodifai.local"]);
    git(["config", "user.name", "Test"]);
    writeFileSync(join(source, "README.md"), "one\n", "utf8");
    git(["add", "."]);
    git(["commit", "-m", "first"], {
      GIT_AUTHOR_DATE: "2026-11-10T10:00:00Z",
      GIT_COMMITTER_DATE: "2026-11-10T10:00:00Z",
    });
    git(["tag", "v1.0.0"]);

    writeFileSync(join(source, "README.md"), "two\n", "utf8");
    git(["add", "README.md"]);
    git(["commit", "-m", "second"], {
      GIT_AUTHOR_DATE: "2026-11-26T10:00:00Z",
      GIT_COMMITTER_DATE: "2026-11-26T10:00:00Z",
    });
    git(["tag", "-a", "v2.0.0-new", "-m", "New release"], {
      GIT_COMMITTER_DATE: "2026-11-26T10:00:00Z",
    });

    const target = prepareE2EServer(source, join(fixture, "runtime"));
    expect(existsSync(join(target, ".git"))).toBe(false);
    const snapshotPath = join(target, "content/changelog/tags.json");
    expect(existsSync(snapshotPath)).toBe(true);

    const snapshot = JSON.parse(readFileSync(snapshotPath, "utf8")) as {
      tags: Array<{ tag: string }>;
    };
    expect(snapshot.tags.map((t) => t.tag)).toEqual(["v2.0.0-new", "v1.0.0"]);

    const cliOut = execFileSync(
      process.execPath,
      [join(target, "apps/web/scripts/site-study/changelog-data.mjs")],
      { cwd: target, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
    );
    const entries = JSON.parse(cliOut) as Array<{ tag: string }>;
    expect(entries.map((e) => e.tag)).toEqual(["v2.0.0-new", "v1.0.0"]);
  } finally {
    rmSync(fixture, { recursive: true, force: true });
  }
}, 15_000);
