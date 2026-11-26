// @vitest-environment node
import {
  mkdirSync,
  mkdtempSync,
  readdirSync,
  rmSync,
  statSync,
  utimesSync,
} from "node:fs";
import { join, resolve } from "node:path";
import { NextRequest } from "next/server";
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import { GET as getHome } from "@/app/(site)/route";
import { GET as getIsland } from "@/app/site/islands/[name]/route";
import { resetStaticSiteCacheForTest } from "./serve-static-site";

// Dev mode of serve-static-site.ts: the build child process is replaced by a fake that counts
// builds and writes a tiny output, so the tests observe exactly when a request rebuilds.
const fake = vi.hoisted(() => ({
  builds: 0,
  duringBuild: null as null | (() => Promise<void>),
}));

const ISLAND = "home.0123456789ab.js";

vi.mock("node:child_process", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:child_process")>();
  const fs = await import("node:fs");
  const path = await import("node:path");
  const execFile = (
    _file: string,
    _args: string[],
    options: { env: Record<string, string | undefined> },
    callback: (error: Error | null, out?: { stdout: string }) => void,
  ) => {
    fake.builds += 1;
    const build = fake.builds;
    const outDir = options.env.SITE_STATIC_OUT_DIR ?? "";
    void (async () => {
      await new Promise((r) => setTimeout(r, 30));
      await fake.duringBuild?.();
      fs.rmSync(outDir, { recursive: true, force: true });
      fs.mkdirSync(path.join(outDir, "islands"), { recursive: true });
      fs.writeFileSync(path.join(outDir, "home-en.html"), `build ${build}`);
      fs.writeFileSync(path.join(outDir, "islands", ISLAND), `// ${build}`);
      fs.writeFileSync(
        path.join(outDir, "manifest.json"),
        JSON.stringify({
          pages: ["home-en.html"],
          islands: [ISLAND],
          fontsFile: "fonts.0123456789ab.css",
        }),
      );
      callback(null, { stdout: "" });
    })().catch((error: Error) => callback(error));
    return {};
  };
  return { ...actual, execFile };
});

const WEB_DIR = resolve(import.meta.dirname, "../..");
const REPO_ROOT = resolve(WEB_DIR, "../..");
const TMP_PARENT = join(WEB_DIR, ".tmp-site-dev-tests");

const home = () =>
  getHome(
    new NextRequest("http://127.0.0.1/", {
      headers: { cookie: "mellodifai_lang=en" },
    }),
  );
const island = (name: string) =>
  getIsland(new NextRequest(`http://127.0.0.1/site/islands/${name}`), {
    params: Promise.resolve({ name }),
  });

function firstFile(target: string): string {
  if (statSync(target).isFile()) return target;
  for (const entry of readdirSync(target, { withFileTypes: true })) {
    if (entry.name.startsWith(".")) continue;
    const found = firstFile(join(target, entry.name));
    if (found) return found;
  }
  return "";
}

// Sets a real source file's mtime to now for the duration of fn, then restores it.
async function withTouched(file: string, fn: () => Promise<void>) {
  const before = statSync(file);
  try {
    utimesSync(file, before.atime, new Date());
    await fn();
  } finally {
    utimesSync(file, before.atime, before.mtime);
  }
}

describe("serve-static-site in dev", () => {
  const prevStaticDir = process.env.SITE_STATIC_DIR;
  let staticDir = "";

  beforeAll(() => {
    expect(process.env.NODE_ENV).not.toBe("production");
    mkdirSync(TMP_PARENT, { recursive: true });
    staticDir = mkdtempSync(join(TMP_PARENT, "dev-"));
    process.env.SITE_STATIC_DIR = staticDir;
  });

  afterAll(() => {
    if (prevStaticDir === undefined) delete process.env.SITE_STATIC_DIR;
    else process.env.SITE_STATIC_DIR = prevStaticDir;
    resetStaticSiteCacheForTest();
    rmSync(TMP_PARENT, { recursive: true, force: true });
  });

  beforeEach(() => {
    resetStaticSiteCacheForTest();
    rmSync(staticDir, { recursive: true, force: true });
    fake.builds = 0;
    fake.duringBuild = null;
  });

  it("runs one build for parallel first requests", async () => {
    const responses = await Promise.all([home(), home(), island(ISLAND)]);
    expect(responses.map((r) => r.status)).toEqual([200, 200, 200]);
    expect(fake.builds).toBe(1);
  });

  it("rebuilds on the next request when a source is saved during a build", async () => {
    const source = join(WEB_DIR, "lib/site/islands/pricing.ts");
    const before = statSync(source);
    try {
      fake.duringBuild = async () => {
        utimesSync(source, before.atime, new Date());
        await new Promise((r) => setTimeout(r, 30));
      };
      expect((await home()).status).toBe(200);
      expect(fake.builds).toBe(1);
      fake.duringBuild = null;

      expect(await (await home()).text()).toBe("build 2");
      expect(fake.builds).toBe(2);
      // The second build started after the save, so nothing is stale any more.
      expect((await home()).status).toBe(200);
      expect(fake.builds).toBe(2);
    } finally {
      utimesSync(source, before.atime, before.mtime);
    }
  });

  it("returns 404 for an island hash that is not in the manifest, without a rebuild", async () => {
    expect((await island(ISLAND)).status).toBe(200);
    expect(fake.builds).toBe(1);
    for (const name of ["home.000000000000.js", "recipes.0123456789ab.js"]) {
      expect((await island(name)).status, name).toBe(404);
    }
    expect(fake.builds).toBe(1);
  });

  it("returns 404, not 500, when a manifest file vanished from disk", async () => {
    expect((await island(ISLAND)).status).toBe(200);
    rmSync(join(staticDir, "islands", ISLAND));
    expect((await island(ISLAND)).status).toBe(404);
    expect(fake.builds).toBe(1);
  });

  it("rebuilds when any input the prerender reads changes", async () => {
    expect((await home()).status).toBe(200);
    let expected = 1;
    for (const rel of [
      "content/recipes",
      "apps/web/public/site/assets.manifest.json",
      "apps/web/public/site/brand-mark.png",
      "apps/web/public/site/recipes",
      "apps/web/src/site-primitives.tsx",
      "apps/web/src/site-table-primitives.tsx",
      "apps/web/lib/theme.ts",
      "packages/shared/src/recipes",
      "apps/web/lib/site",
      "apps/web/components/site",
      "apps/web/app/(site)/site.css",
    ]) {
      const file = firstFile(join(REPO_ROOT, rel));
      expect(file, rel).not.toBe("");
      await withTouched(file, async () => {
        expected += 1;
        expect((await home()).status, rel).toBe(200);
        expect(fake.builds, rel).toBe(expected);
      });
    }
  });
});
