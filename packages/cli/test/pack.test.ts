import { execFileSync } from "node:child_process";
import { mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it } from "vitest";

it("the packed tarball has no workspace: dependency", async () => {
  const dir = await mkdtemp(join(tmpdir(), "cli-pack-"));
  try {
    execFileSync(
      process.platform === "win32" ? "pnpm.cmd" : "pnpm",
      ["pack", "--pack-destination", dir],
      { shell: process.platform === "win32", stdio: "pipe" },
    );
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
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}, 60000);
