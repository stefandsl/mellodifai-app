import { execFileSync } from "node:child_process";
import { cp, mkdir, readdir, rm, stat, symlink } from "node:fs/promises";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, it } from "vitest";
import { fixtureDirectory, testRuntimeRoot } from "./runtime.js";

it("the packed tarball has no workspace: dependency", async () => {
  const dir = await fixtureDirectory("pack-");
  const source = fileURLToPath(new URL("../", import.meta.url));
  const originalBundle = join(source, "dist/mellodifai.js");
  const before = await stat(originalBundle).catch(() => null);
  try {
    const workspace = join(dir, "source");
    const copy = join(workspace, "packages/cli");
    await mkdir(copy, { recursive: true });
    for (const file of ["package.json", "pnpm-workspace.yaml"]) {
      await cp(join(source, "../..", file), join(workspace, file));
    }
    for (const file of ["package.json", "build.mjs", "src", "skill"]) {
      await cp(join(source, file), join(copy, file), { recursive: true });
    }
    await mkdir(join(workspace, "packages/shared"), { recursive: true });
    await cp(
      join(source, "../shared/package.json"),
      join(workspace, "packages/shared/package.json"),
    );
    // Installed dependencies are read-only; prepack writes only into this copy.
    await symlink(
      resolve(source, "node_modules"),
      join(copy, "node_modules"),
      "junction",
    );
    const pnpm = process.env.npm_execpath;
    if (!pnpm) throw new Error("Run this test with pnpm test");
    execFileSync(process.execPath, [pnpm, "pack", "--pack-destination", dir], {
      cwd: copy,
      stdio: "pipe",
      env: {
        ...process.env,
        TEMP: dir,
        TMP: dir,
        TMPDIR: dir,
        npm_config_cache: join(testRuntimeRoot(), "cache/npm"),
        npm_config_store_dir: join(testRuntimeRoot(), "cache/pnpm"),
        COREPACK_HOME: join(testRuntimeRoot(), "cache/corepack"),
      },
    });
    const tarball =
      (await readdir(dir)).find((name) => name.endsWith(".tgz")) ?? "missing";
    const manifest = execFileSync(
      "tar",
      ["-xOf", tarball, "package/package.json"],
      { cwd: dir, encoding: "utf8" },
    );
    expect(manifest).not.toContain("workspace:");
    expect(JSON.parse(manifest).dependencies ?? {}).toEqual({});
    const files = execFileSync("tar", ["-tf", tarball], {
      cwd: dir,
      encoding: "utf8",
    });
    expect(files).toContain("package/dist/mellodifai.js");
    expect(files).toContain("package/skill/SKILL.md");
    expect(files).toContain("package/skill/AGENTS.md");
    execFileSync("tar", ["-xf", tarball], { cwd: dir });
    const help = execFileSync(
      process.execPath,
      [join(dir, "package/dist/mellodifai.js"), "--help", "--json"],
      { encoding: "utf8" },
    );
    expect(JSON.parse(help).data.commands).toContain("mcp");
    expect(await stat(originalBundle).catch(() => null)).toEqual(before);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}, 60000);
