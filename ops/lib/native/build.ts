import { createHash } from "node:crypto";
import {
  copyFileSync,
  cpSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { basename, delimiter, dirname, join } from "node:path";
import {
  type InstallOptions,
  installArtifact,
  loadManifest,
  type Manifest,
  nativeAssets,
  nativeCacheRoot,
  obtainArchive,
  platformKey,
  type Recipe,
  requireArtifact,
  seedDirsFromEnv,
} from "./artifacts.js";
import { applyPatch } from "./patch.js";
import { runLogged } from "./processes.js";

const AUTH_PATCHES = [
  join(nativeAssets, "auth/listener-portable.patch"),
  join(nativeAssets, "auth/hop-guard.patch"),
];
const STORAGE_PATCH = join(nativeAssets, "storage/hop-guard.patch");
const XATTR_MODULE = join(nativeAssets, "storage/fs-xattr");

function digest(...parts: string[]): string {
  const hash = createHash("sha256");
  for (const part of parts) hash.update(part).update("\0");
  return hash.digest("hex").slice(0, 16);
}

/** Recipe identities change whenever a recipe input changes, so an edited
 * patch or stand-in module forces a rebuild at the next install.
 */
export function recipeIds(manifest: Manifest = loadManifest()) {
  const version = (id: string) => manifest.artifacts[id]?.version ?? "";
  return {
    auth: `auth-${digest(
      ...AUTH_PATCHES.map((path) => readFileSync(path, "utf8")),
      version("go"),
    )}`,
    storage: `storage-${digest(
      readFileSync(join(XATTR_MODULE, "index.js"), "utf8"),
      readFileSync(join(XATTR_MODULE, "package.json"), "utf8"),
      readFileSync(STORAGE_PATCH, "utf8"),
      manifest.artifacts[PG_BOSS]?.downloads.source?.sha256 ?? "",
      version("node"),
    )}`,
  };
}

/** Run a build tool with its output in a log file: build chatter is long, and
 * nothing a tool prints should reach the operator's terminal unreviewed.
 */
async function run(
  name: string,
  command: string,
  args: string[],
  options: { cwd: string; env: Record<string, string>; log: string },
): Promise<void> {
  const code = await runLogged(command, args, {
    cwd: options.cwd,
    env: { ...(process.env as Record<string, string>), ...options.env },
    logFile: options.log,
  });
  if (code !== 0)
    throw new Error(`${name} failed (exit ${code}); see ${options.log}`);
}

function pathWith(dir: string): string {
  return `${dir}${delimiter}${process.env.PATH ?? ""}`;
}

/** Packages the lockfile marks as unable to run on this operating system and
 * that are not optional. On Windows that must be exactly fs-xattr.
 */
export function blockedPackages(lockfile: string, os: string): string[] {
  const lock = JSON.parse(lockfile) as {
    packages: Record<string, { os?: string[]; optional?: boolean }>;
  };
  return Object.entries(lock.packages)
    .filter(([, info]) => {
      if (!info.os || info.optional) return false;
      const allowed = info.os.filter((name) => !name.startsWith("!"));
      return (
        info.os.includes(`!${os}`) ||
        (allowed.length > 0 && !allowed.includes(os))
      );
    })
    .map(([name]) => name)
    .sort();
}

/** Storage's lockfile names one dependency by Git commit, with no digest. */
export const PG_BOSS = "pg-boss";
const PG_BOSS_SPEC = "github:supabase/pg-boss#feat/exactly_once";
const PG_BOSS_COMMIT = "89b675b057ff7cec3ca2c434e4d3005c35a76bd9";
const PG_BOSS_RESOLVED = `git+ssh://git@github.com/supabase/pg-boss.git#${PG_BOSS_COMMIT}`;

interface Lockfile {
  packages: Record<
    string,
    {
      link?: boolean;
      integrity?: string;
      resolved?: string;
      dependencies?: Record<string, string>;
    }
  >;
}

/** Installed lockfile packages npm would fetch without an integrity digest. */
export function unpinnedPackages(lockfile: string): string[] {
  const lock = JSON.parse(lockfile) as Lockfile;
  return Object.entries(lock.packages)
    .filter(([name, info]) => name !== "" && !info.link && !info.integrity)
    .map(([name]) => name)
    .sort();
}

/** Point pg-boss at a local copy of the archive the manifest pins. npm then
 * installs it from that file and checks its digest instead of fetching Git.
 * Anything but the expected Git commit is refused.
 */
export function pinPgBoss(
  files: { packageJson: string; lockfile: string },
  archive: { spec: string; integrity: string },
): { packageJson: string; lockfile: string } {
  const pkg = JSON.parse(files.packageJson) as {
    dependencies?: Record<string, string>;
  };
  const lock = JSON.parse(files.lockfile) as Lockfile;
  const root = lock.packages[""]?.dependencies;
  const entry = lock.packages[`node_modules/${PG_BOSS}`];
  if (
    !pkg.dependencies ||
    pkg.dependencies[PG_BOSS] !== PG_BOSS_SPEC ||
    !root ||
    root[PG_BOSS] !== PG_BOSS_SPEC ||
    !entry ||
    entry.resolved !== PG_BOSS_RESOLVED
  )
    throw new Error(
      "Storage's pg-boss dependency is not the pinned Git commit",
    );
  pkg.dependencies[PG_BOSS] = archive.spec;
  root[PG_BOSS] = archive.spec;
  entry.resolved = archive.spec;
  entry.integrity = archive.integrity;
  return {
    packageJson: `${JSON.stringify(pkg, null, 2)}\n`,
    lockfile: `${JSON.stringify(lock, null, 2)}\n`,
  };
}

/** The pinned pg-boss archive, from the verified download cache, a seed
 * folder or its publisher, checked against the manifest's SHA-256.
 */
export function pgBossArchive(
  options: Pick<InstallOptions, "seedDirs" | "fetchImpl" | "log"> & {
    manifest?: Manifest;
    cache?: string;
  } = {},
): Promise<string> {
  const manifest = options.manifest ?? loadManifest();
  const download = manifest.artifacts[PG_BOSS]?.downloads.source;
  if (!download?.url.includes(PG_BOSS_COMMIT))
    throw new Error("The native manifest does not pin Storage's pg-boss");
  return obtainArchive(download, options.cache ?? nativeCacheRoot(), options);
}

export function authRecipe(goDir: string, work: string): Recipe {
  return async ({ source, output, artifact, platform }) => {
    for (const patch of AUTH_PATCHES)
      applyPatch(source, readFileSync(patch, "utf8"));
    const state = join(work, "go");
    const binary = platform.startsWith("win32") ? "auth.exe" : "auth";
    await run(
      "Auth build",
      join(goDir, "bin", platform.startsWith("win32") ? "go.exe" : "go"),
      [
        "build",
        "-o",
        join(output, binary),
        "-buildvcs=false",
        "-trimpath",
        "-ldflags",
        `-X github.com/supabase/auth/internal/utilities.Version=v${artifact.version}`,
        ".",
      ],
      {
        cwd: source,
        log: join(work, "logs/auth-build.log"),
        env: {
          GOROOT: goDir,
          GOTOOLCHAIN: "local",
          GOFLAGS: "-mod=readonly",
          GOENV: "off",
          CGO_ENABLED: "0",
          GOCACHE: process.env.GOCACHE ?? join(state, "build"),
          GOMODCACHE: process.env.GOMODCACHE ?? join(state, "mod"),
          GOPATH: process.env.GOPATH ?? join(state, "path"),
          // Go keeps telemetry counters under the user's roaming profile.
          APPDATA: join(state, "appdata"),
          PATH: pathWith(join(goDir, "bin")),
        },
      },
    );
  };
}

export function storageRecipe(
  nodeDir: string,
  work: string,
  pgBoss: () => Promise<string>,
): Recipe {
  return async ({ source, output, platform }) => {
    const windows = platform.startsWith("win32");
    for (const name of readdirSync(source))
      renameSync(join(source, name), join(output, name));
    applyPatch(output, readFileSync(STORAGE_PATCH, "utf8"));
    // The Git dependency comes from the verified archive, never from Git.
    const archive = await pgBoss();
    mkdirSync(join(output, ".mdf-deps"));
    const local = join(output, ".mdf-deps", basename(archive));
    copyFileSync(archive, local);
    const pinned = pinPgBoss(
      {
        packageJson: readFileSync(join(output, "package.json"), "utf8"),
        lockfile: readFileSync(join(output, "package-lock.json"), "utf8"),
      },
      {
        spec: `file:.mdf-deps/${basename(archive)}`,
        integrity: `sha512-${createHash("sha512").update(readFileSync(local)).digest("base64")}`,
      },
    );
    const unpinned = unpinnedPackages(pinned.lockfile);
    if (unpinned.length > 0)
      throw new Error(
        `Storage dependencies without an integrity digest: ${unpinned.join(", ")}`,
      );
    writeFileSync(join(output, "package.json"), pinned.packageJson);
    writeFileSync(join(output, "package-lock.json"), pinned.lockfile);
    const node = join(nodeDir, windows ? "node.exe" : "bin/node");
    const npm = join(
      nodeDir,
      windows ? "" : "lib",
      "node_modules/npm/bin/npm-cli.js",
    );
    const env = {
      PATH: pathWith(windows ? nodeDir : join(nodeDir, "bin")),
      npm_config_cache: process.env.npm_config_cache ?? join(work, "npm"),
      npm_config_update_notifier: "false",
      npm_config_fund: "false",
      npm_config_audit: "false",
    };
    const log = join(work, "logs/storage-build.log");
    const blocked = blockedPackages(
      readFileSync(join(output, "package-lock.json"), "utf8"),
      platform.split("-")[0] as string,
    );
    const expected = windows ? ["node_modules/fs-xattr"] : [];
    if (JSON.stringify(blocked) !== JSON.stringify(expected))
      throw new Error(
        `Storage dependencies that cannot run on ${platform}: ${blocked.join(", ") || "none"} (expected ${expected.join(", ") || "none"})`,
      );
    // Lifecycle scripts stay off: the only native build in the lockfile is
    // fs-xattr, which is replaced below. --force is needed solely for the
    // platform refusal checked above.
    await run(
      "Storage dependency install",
      node,
      [npm, "ci", "--ignore-scripts", ...(windows ? ["--force"] : [])],
      { cwd: output, env, log },
    );
    if (windows) {
      const installed = join(output, "node_modules/fs-xattr");
      if (!existsSync(join(installed, "package.json")))
        throw new Error("Storage install did not place fs-xattr");
      rmSync(installed, { recursive: true, force: true });
      cpSync(XATTR_MODULE, installed, { recursive: true });
    }
    await run("Storage build", node, ["build.js"], { cwd: output, env, log });
  };
}

export interface NativeTools {
  pgBin: string;
  postgrest: string;
  auth: string;
  node: string;
  storageDir: string;
  mailpit: string;
}

/** Download, verify, extract and build everything the native stack runs. */
export async function installNative(
  options: Pick<InstallOptions, "seedDirs" | "log" | "fetchImpl"> = {},
): Promise<void> {
  const manifest = loadManifest();
  const cache = nativeCacheRoot();
  const work = join(cache, "build");
  const shared: InstallOptions = {
    manifest,
    cache,
    seedDirs: options.seedDirs ?? seedDirsFromEnv(),
    log: options.log,
    fetchImpl: options.fetchImpl,
  };
  const dirs: Record<string, string> = {};
  for (const id of ["postgres", "postgrest", "mailpit", "go", "node"])
    dirs[id] = await installArtifact(id, shared);
  const ids = recipeIds(manifest);
  await installArtifact("auth", {
    ...shared,
    recipes: {
      auth: { id: ids.auth, run: authRecipe(dirs.go as string, work) },
    },
  });
  await installArtifact("storage", {
    ...shared,
    recipes: {
      storage: {
        id: ids.storage,
        run: storageRecipe(dirs.node as string, work, () =>
          pgBossArchive({ ...shared, manifest, cache }),
        ),
      },
    },
  });
}

/** Installed tool locations for routine start; never downloads or builds. */
export function nativeTools(): NativeTools {
  const manifest = loadManifest();
  const platform = platformKey();
  const ids = recipeIds(manifest);
  const options = { manifest, platform };
  return {
    pgBin: dirname(requireArtifact("postgres", options).entry),
    postgrest: requireArtifact("postgrest", options).entry,
    auth: requireArtifact("auth", { ...options, recipeId: ids.auth }).entry,
    node: requireArtifact("node", options).entry,
    storageDir: requireArtifact("storage", {
      ...options,
      recipeId: ids.storage,
    }).dir,
    mailpit: requireArtifact("mailpit", options).entry,
  };
}
