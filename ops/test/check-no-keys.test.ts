import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { afterEach, beforeEach, expect, it } from "vitest";
import { findKeyMaterial } from "../check-no-keys.js";
import { realRunner } from "../lib/run.js";

let root: string;
beforeEach(async () => {
  const base = process.env.RUNNER_TEMP ?? "E:/mellodifai/tmp";
  await mkdir(base, { recursive: true });
  root = await mkdtemp(join(base, "ops-test-"));
});
afterEach(async () => {
  if (root) await rm(root, { recursive: true, force: true });
});
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
