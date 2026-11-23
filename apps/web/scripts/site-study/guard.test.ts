// @vitest-environment node
import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { runGuard } from "./guard.mjs";

const TMP_ROOT = "E:/mellodifai/tmp/c14-guard-tests";
const tempDirs: string[] = [];

function makeFixtureRepo() {
  mkdirSync(TMP_ROOT, { recursive: true });
  const root = mkdtempSync(join(TMP_ROOT, "repo-"));
  tempDirs.push(root);
  mkdirSync(join(root, "apps", "web", "public", "site", "recipes", "demo"), {
    recursive: true,
  });
  mkdirSync(join(root, "packages", "shared", "src"), { recursive: true });
  mkdirSync(join(root, "content", "recipes", "demo"), { recursive: true });

  const mediaBytes = Buffer.from("synthetic-demo");
  const sha = createHash("sha256").update(mediaBytes).digest("hex");
  writeFileSync(
    join(root, "apps", "web", "public", "site", "recipes", "demo", "cover.jpg"),
    mediaBytes,
  );
  writeFileSync(
    join(root, "apps", "web", "public", "site", "assets.manifest.json"),
    JSON.stringify({
      schemaVersion: 1,
      assets: [
        {
          path: "recipes/demo/cover.jpg",
          origin: "own",
          sha256: sha,
          bytes: mediaBytes.length,
        },
      ],
    }),
  );
  writeFileSync(
    join(root, "content", "recipes", "demo", "recipe.json"),
    JSON.stringify({
      slug: "demo",
      title: { it: "Demo", en: "Demo" },
      media: { cover: "cover.jpg", preview: "cover.jpg", example: "cover.jpg" },
    }),
  );
  return root;
}

afterAll(() => {
  for (const dir of tempDirs) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe("site-study guard.mjs", () => {
  it("passes on the real repository", () => {
    const result = runGuard();
    expect(result.failures).toEqual([]);
    expect(result.pass).toBe(true);
    expect(result.checkedAssets).toBeGreaterThanOrEqual(50);
  });

  it("fails when a file in public/site is missing from assets.manifest.json", () => {
    const root = makeFixtureRepo();
    writeFileSync(
      join(root, "apps", "web", "public", "site", "unlisted.webp"),
      Buffer.from("extra"),
    );
    const result = runGuard({ root, checkCapture: false });
    expect(result.pass).toBe(false);
    expect(
      result.failures.some((f: string) => f.includes("unlisted.webp")),
    ).toBe(true);
  });

  it("fails on a forbidden reference domain or brand token in source", () => {
    const root = makeFixtureRepo();
    const leaked = ["card", "board", ".ai"].join("");
    writeFileSync(
      join(root, "packages", "shared", "src", "leak.ts"),
      `export const bad = "https://${leaked}/recipes";\n`,
    );
    const result = runGuard({ root, checkCapture: false });
    expect(result.pass).toBe(false);
    expect(result.failures.some((f: string) => f.includes("leak.ts"))).toBe(
      true,
    );
  });
});
