import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { afterEach, expect, it } from "vitest";
import {
  loadManifest,
  nativeAssets,
  nativeCacheRoot,
} from "../../lib/native/artifacts.js";
import {
  PG_BOSS,
  pinPgBoss,
  recipeIds,
  unpinnedPackages,
} from "../../lib/native/build.js";
import { applyPatch } from "../../lib/native/patch.js";
import { extractZip } from "../../lib/native/zip.js";

const tempBase = process.env.RUNNER_TEMP ?? "E:/mellodifai/tmp";
const COMMIT = "89b675b057ff7cec3ca2c434e4d3005c35a76bd9";
const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0))
    rmSync(dir, { recursive: true, force: true });
});

// The shape of Storage 1.84.19's manifest and lockfile around pg-boss.
const packageJson = JSON.stringify({
  name: "storage",
  dependencies: {
    "pg-boss": "github:supabase/pg-boss#feat/exactly_once",
    pg: "^8.16.0",
  },
});
const lockfile = (
  resolved = `git+ssh://git@github.com/supabase/pg-boss.git#${COMMIT}`,
) =>
  JSON.stringify({
    lockfileVersion: 3,
    packages: {
      "": {
        dependencies: {
          "pg-boss": "github:supabase/pg-boss#feat/exactly_once",
          pg: "^8.16.0",
        },
      },
      "node_modules/pg": {
        version: "8.16.0",
        resolved: "https://registry.npmjs.org/pg/-/pg-8.16.0.tgz",
        integrity: "sha512-abc",
      },
      "node_modules/pg-boss": { version: "10.3.2", resolved },
      "node_modules/linked": { link: true, resolved: "packages/linked" },
    },
  });
const archive = {
  spec: `file:.mdf-deps/pg-boss-${COMMIT}.tar.gz`,
  integrity: "sha512-pinned",
};

it("points pg-boss at the verified archive and leaves no dependency without a digest", () => {
  expect(unpinnedPackages(lockfile())).toEqual(["node_modules/pg-boss"]);
  const pinned = pinPgBoss({ packageJson, lockfile: lockfile() }, archive);
  expect(unpinnedPackages(pinned.lockfile)).toEqual([]);
  const lock = JSON.parse(pinned.lockfile);
  expect(lock.packages["node_modules/pg-boss"]).toEqual({
    version: "10.3.2",
    resolved: archive.spec,
    integrity: archive.integrity,
  });
  // npm ci refuses a lockfile that disagrees with package.json.
  expect(lock.packages[""].dependencies["pg-boss"]).toBe(archive.spec);
  expect(JSON.parse(pinned.packageJson).dependencies).toEqual({
    "pg-boss": archive.spec,
    pg: "^8.16.0",
  });
  expect(lock.packages["node_modules/pg"].integrity).toBe("sha512-abc");
});

it("refuses a pg-boss that is not the pinned commit", () => {
  expect(() =>
    pinPgBoss(
      {
        packageJson,
        lockfile: lockfile(
          "git+ssh://git@github.com/supabase/pg-boss.git#0000",
        ),
      },
      archive,
    ),
  ).toThrow("not the pinned Git commit");
  expect(() =>
    pinPgBoss(
      {
        packageJson: packageJson.replace("feat/exactly_once", "master"),
        lockfile: lockfile(),
      },
      archive,
    ),
  ).toThrow("not the pinned Git commit");
});

it("pins the pg-boss archive in the manifest and in Storage's recipe identity", () => {
  const manifest = loadManifest();
  const download = manifest.artifacts[PG_BOSS]?.downloads.source;
  expect(download?.url).toBe(
    `https://github.com/supabase/pg-boss/archive/${COMMIT}.tar.gz`,
  );
  expect(download?.sha256).toMatch(/^[0-9a-f]{64}$/);
  const changed = structuredClone(manifest);
  const source = changed.artifacts[PG_BOSS]?.downloads.source;
  if (source) source.sha256 = "0".repeat(64);
  expect(recipeIds(changed).storage).not.toBe(recipeIds(manifest).storage);
  expect(recipeIds(changed).auth).toBe(recipeIds(manifest).auth);
});

// The real pinned archives, when this machine has them in its native cache.
const downloads = join(nativeCacheRoot(), "downloads");
const real = (file: string) => join(downloads, file);
const haveSources =
  existsSync(real("auth-v2.197.0.zip")) &&
  existsSync(real("storage-v1.84.19.zip"));

it.runIf(haveSources)(
  "applies every patch to the pinned sources and finds pg-boss the only undigested dependency",
  () => {
    const manifest = loadManifest();
    const extract = (id: "auth" | "storage") => {
      const dir = mkdtempSync(join(tempBase, `pins-${id}-`));
      dirs.push(dir);
      const download = manifest.artifacts[id]?.downloads.source;
      if (!download) throw new Error(`No ${id} download`);
      extractZip(real(download.file), dir, download);
      return dir;
    };
    const auth = extract("auth");
    for (const patch of ["listener-portable.patch", "hop-guard.patch"])
      applyPatch(auth, readFileSync(join(nativeAssets, "auth", patch), "utf8"));
    expect(readFileSync(join(auth, "internal/api/api.go"), "utf8")).toContain(
      "api.handler = hopGuard(corsHandler.Handler(r))",
    );
    const storage = extract("storage");
    expect(
      unpinnedPackages(
        readFileSync(join(storage, "package-lock.json"), "utf8"),
      ),
    ).toEqual(["node_modules/pg-boss"]);
    pinPgBoss(
      {
        packageJson: readFileSync(join(storage, "package.json"), "utf8"),
        lockfile: readFileSync(join(storage, "package-lock.json"), "utf8"),
      },
      archive,
    );
    applyPatch(
      storage,
      readFileSync(join(nativeAssets, "storage/hop-guard.patch"), "utf8"),
    );
    expect(readFileSync(join(storage, "src/app.ts"), "utf8")).toContain(
      "serverFactory: hopGuardServerFactory",
    );
  },
);
