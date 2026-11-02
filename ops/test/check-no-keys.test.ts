import { link, mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { findKeyMaterial } from "../check-no-keys.js";
import { realRunner } from "../lib/run.js";

const canonicalAliases = vi.hoisted(() => new Map<string, string>());
vi.mock("node:fs/promises", async (importOriginal) => {
  const original = await importOriginal<typeof import("node:fs/promises")>();
  return {
    ...original,
    realpath: (path: string) =>
      original.realpath(canonicalAliases.get(path) ?? path),
  };
});

let root: string;
beforeEach(async () => {
  const base = process.env.RUNNER_TEMP ?? "E:/mellodifai/tmp";
  await mkdir(base, { recursive: true });
  root = await mkdtemp(join(base, "ops-test-"));
});
afterEach(async () => {
  canonicalAliases.clear();
  if (root) await rm(root, { recursive: true, force: true });
});

async function fileAlias(target: string, alias: string) {
  try {
    await symlink(target, alias, "file");
  } catch (error) {
    if (
      process.platform !== "win32" ||
      (error as NodeJS.ErrnoException).code !== "EPERM"
    )
      throw error;
    // Windows may deny file symlinks without Developer Mode. Preserve real file
    // reads via a hard link and emulate only the symlink's canonical path.
    await link(target, alias);
    canonicalAliases.set(alias, target);
  }
}
async function fixture(path: string, content = "{}") {
  const file = join(root, path);
  await mkdir(dirname(file), { recursive: true });
  await writeFile(file, content);
  return file;
}

it("flags signing key and jwks file names", async () => {
  await fixture("a/signing_keys.json");
  await fixture("b/my-jwks.json");
  expect((await findKeyMaterial([root])).map((f) => f.reason)).toEqual([
    "name",
    "name",
  ]);
});

it("flags a private JWK by kty plus d, not a bare d", async () => {
  const path = await fixture("c.json", '{"kty":"EC","d":"x"}');
  await fixture("d.json", '{"d":"x"}');
  await fixture("public.json", '{"kty":"EC","x":"public"}');
  await fixture("invalid.json", "not JSON");
  expect(await findKeyMaterial([root])).toEqual([{ path, reason: "jwk" }]);
});

it("finds private JWKs nested in objects and arrays", async () => {
  const path = await fixture("nested.json", '{"keys":[{"kty":"RSA","d":"x"}]}');
  await fixture("separate.json", '{"kty":"EC","child":{"d":"x"}}');
  expect(await findKeyMaterial([root])).toEqual([{ path, reason: "jwk" }]);
});

it("scans ignored folders but skips node_modules, .git, .next, .turbo and .claude/worktrees", async () => {
  await fixture(".gitignore", "ignored/\n");
  const path = await fixture("ignored/signing_keys-test.json");
  for (const dir of [
    "node_modules",
    ".git",
    ".next",
    ".turbo",
    ".claude/worktrees",
  ]) {
    await fixture(`${dir}/nested/jwks.json`);
  }
  expect(await findKeyMaterial([root])).toEqual([{ path, reason: "name" }]);
});

it("scans <runtime root>/stacks when given as a root (round-5 Major 1)", async () => {
  const path = await fixture("stacks/prod/leaked.json", '{"kty":"EC","d":"x"}');
  expect(await findKeyMaterial([join(root, "stacks")])).toEqual([
    { path, reason: "jwk" },
  ]);
});

async function cli(args: string[], runtime = root) {
  return realRunner(
    process.execPath,
    ["--import", "tsx", "check-no-keys.ts", ...args],
    {
      cwd: join(import.meta.dirname, ".."),
      env: { MELLODIFAI_ROOT: runtime },
    },
  );
}

it("CLI lists paths without contents and accepts repeated roots", async () => {
  const path = await fixture(
    "a/private.json",
    '{"kty":"EC","d":"never-print-this"}',
  );
  await fixture("b/ordinary.json");
  const result = await cli([
    "--root",
    join(root, "a"),
    "--root",
    join(root, "b"),
  ]);
  expect(result.code).toBe(1);
  expect(result.stderr).toContain(path);
  expect(result.stderr + result.stdout).not.toContain("never-print-this");
  expect((await cli(["--root", join(root, "b")])).code).toBe(0);
});

it("CLI defaults to the repo and runtime stacks, and allows absent stacks", async () => {
  expect((await cli([])).code).toBe(0);
  const path = await fixture("stacks/dev/signing_keys.json");
  const result = await cli([]);
  expect(result.code).toBe(1);
  expect(result.stderr).toContain(path);
});

it("CLI fails closed on invalid arguments and missing explicit roots", async () => {
  expect((await cli(["--root"])).code).toBe(1);
  expect((await cli(["--unknown", root])).code).toBe(1);
  expect((await cli(["--root", join(root, "missing")])).code).toBe(1);
});

it("scans linked directory roots and terminates directory cycles", async () => {
  await fixture("target/private.json", '{"kty":"EC","d":"x"}');
  const linkedRoot = join(root, "stacks");
  await symlink(join(root, "target"), linkedRoot, "junction");
  await symlink(join(root, "target"), join(root, "target/loop"), "junction");
  expect(await findKeyMaterial([linkedRoot])).toEqual([
    { path: join(linkedRoot, "private.json"), reason: "jwk" },
  ]);
  const result = await cli([]);
  expect(result.code).toBe(1);
  expect(result.stderr).toContain(join(linkedRoot, "private.json"));
});

it("checks prohibited link filenames even after scanning the target", async () => {
  const target = await fixture("a.json");
  const link = join(root, "jwks.json");
  await fileAlias(target, link);
  expect(await findKeyMaterial([root])).toEqual([
    { path: link, reason: "name" },
  ]);
});

it("inspects JSON aliases even when a non-JSON target was visited first", async () => {
  const target = await fixture("a.txt", '{"kty":"EC","d":"x"}');
  const link = join(root, "private.json");
  await fileAlias(target, link);
  expect(await findKeyMaterial([root])).toEqual([
    { path: link, reason: "jwk" },
  ]);
});

it("fails closed on broken directory links", async () => {
  await symlink(join(root, "missing"), join(root, "stacks"), "junction");
  await expect(findKeyMaterial([join(root, "stacks")])).rejects.toMatchObject({
    code: "ENOENT",
  });
  expect((await cli([])).code).toBe(1);
});
