import { createHash, randomUUID } from "node:crypto";
import {
  copyFileSync,
  createReadStream,
  createWriteStream,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { setTimeout as sleep } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import { runtimePath } from "../envs.js";
import { runtimeRoot } from "../runtime.js";
import { extractZip } from "./zip.js";

export interface ArtifactDownload {
  url: string;
  file: string;
  sha256: string;
  size: number;
  strip: number;
  include?: string[];
  exclude?: string[];
  /** Licence notices inside the archive, relative to the installed folder. */
  notices: string[];
}

export interface Artifact {
  version: string;
  /** "dependency": an archive a source recipe installs, never on its own. */
  kind: "binary" | "source" | "dependency";
  licence: string;
  project: string;
  /** Licence notice kept in the repository under ops/native/. */
  noticeFile?: string;
  entry: Record<string, string>;
  downloads: Record<string, ArtifactDownload>;
}

export interface Manifest {
  schema: 1;
  artifacts: Record<string, Artifact>;
}

export type ArtifactId =
  | "postgres"
  | "postgrest"
  | "mailpit"
  | "go"
  | "node"
  | "ffmpeg"
  | "auth"
  | "storage";

/** Turns a verified, extracted source tree into the runnable service. */
export type Recipe = (context: {
  source: string;
  output: string;
  artifact: Artifact;
  platform: string;
}) => Promise<void>;

export interface InstallOptions {
  manifest?: Manifest | undefined;
  platform?: string | undefined;
  cache?: string | undefined;
  seedDirs?: string[] | undefined;
  fetchImpl?: typeof fetch | undefined;
  renameImpl?: ((from: string, to: string) => void) | undefined;
  sleepImpl?: ((ms: number) => Promise<void>) | undefined;
  recipes?: Partial<Record<string, { id: string; run: Recipe }>> | undefined;
  log?: ((message: string) => void) | undefined;
}

const MARKER = ".mdf-artifact.json";
export const nativeAssets = fileURLToPath(
  new URL("../../native/", import.meta.url),
);

export function platformKey(): string {
  return `${process.platform}-${process.arch}`;
}

export function loadManifest(
  text = readFileSync(new URL("./manifest.json", import.meta.url), "utf8"),
): Manifest {
  const manifest = JSON.parse(text) as Manifest;
  if (manifest.schema !== 1 || typeof manifest.artifacts !== "object")
    throw new Error("Unsupported native manifest");
  for (const [id, artifact] of Object.entries(manifest.artifacts)) {
    if (
      !/^[a-z][a-z0-9-]*$/.test(id) ||
      !/^[0-9][\w.+-]*$/.test(artifact.version)
    )
      throw new Error(`Invalid native artifact identity: ${id}`);
    if (!artifact.licence || !artifact.project)
      throw new Error(`Native artifact ${id} has no licence record`);
    for (const download of Object.values(artifact.downloads)) {
      if (
        !download.url.startsWith("https://") ||
        !/^[0-9a-f]{64}$/.test(download.sha256) ||
        !Number.isSafeInteger(download.size) ||
        download.size <= 0 ||
        !/^[\w.+-]+$/.test(download.file)
      )
        throw new Error(`Native artifact ${id} is not pinned`);
      if (download.notices.length === 0 && !artifact.noticeFile)
        throw new Error(`Native artifact ${id} has no licence notice`);
    }
  }
  return manifest;
}

/** Immutable artifacts live under the runtime root unless a shared cache is
 * named explicitly; either way never on the system volume or in the checkout.
 */
export function nativeCacheRoot(): string {
  return runtimePath(
    process.env.MELLODIFAI_NATIVE_CACHE ??
      join(runtimePath(runtimeRoot()), "cache/native"),
  );
}

export function seedDirsFromEnv(): string[] {
  return (process.env.MELLODIFAI_NATIVE_SEED ?? "")
    .split(process.platform === "win32" ? ";" : ":")
    .filter(Boolean);
}

function download(artifact: Artifact, id: string, platform: string) {
  const selected =
    artifact.downloads[artifact.kind === "source" ? "source" : platform];
  if (!selected || !artifact.entry[platform])
    throw new Error(`No native artifact for ${id} on ${platform}`);
  return selected;
}

export function artifactDir(
  id: string,
  options: Pick<InstallOptions, "manifest" | "platform" | "cache"> = {},
): string {
  const manifest = options.manifest ?? loadManifest();
  const artifact = manifest.artifacts[id];
  if (!artifact) throw new Error(`Unknown native artifact: ${id}`);
  return join(
    options.cache ?? nativeCacheRoot(),
    id,
    artifact.version,
    options.platform ?? platformKey(),
  );
}

export async function sha256File(path: string): Promise<string> {
  const hash = createHash("sha256");
  await pipeline(createReadStream(path), hash);
  return hash.digest("hex");
}

async function verified(path: string, expected: ArtifactDownload) {
  return (
    statSync(path).size === expected.size &&
    (await sha256File(path)) === expected.sha256
  );
}

/** Return a local archive whose bytes match the manifest, from the download
 * folder, a seed folder, or the pinned URL. Nothing unverified is left behind
 * under its final name.
 */
export async function obtainArchive(
  expected: ArtifactDownload,
  cache: string,
  options: Pick<InstallOptions, "seedDirs" | "fetchImpl" | "log"> = {},
): Promise<string> {
  const folder = join(cache, "downloads");
  mkdirSync(folder, { recursive: true });
  const final = join(folder, expected.file);
  if (existsSync(final)) {
    if (await verified(final, expected)) return final;
    rmSync(final);
  }
  const partial = join(folder, `${expected.file}.${randomUUID()}.part`);
  try {
    for (const seedDir of options.seedDirs ?? []) {
      if (!existsSync(seedDir)) continue;
      for (const name of readdirSync(seedDir)) {
        const candidate = join(seedDir, name);
        const info = statSync(candidate, { throwIfNoEntry: false });
        if (!info?.isFile() || info.size !== expected.size) continue;
        // Verify the private copy, not the seed, so a seed that changes after
        // the check can never be what gets extracted.
        copyFileSync(candidate, partial);
        if (await verified(partial, expected)) {
          renameSync(partial, final);
          options.log?.(`${expected.file}: seeded from a local file`);
          return final;
        }
        rmSync(partial);
      }
    }
    options.log?.(`${expected.file}: downloading`);
    const response = await (options.fetchImpl ?? fetch)(expected.url, {
      redirect: "follow",
    });
    if (!response.ok || !response.body)
      throw new Error(`Download failed for ${expected.file}`);
    await pipeline(
      Readable.fromWeb(
        response.body as import("node:stream/web").ReadableStream,
      ),
      createWriteStream(partial, { flags: "wx" }),
    );
    if (!(await verified(partial, expected)))
      throw new Error(
        `Checksum mismatch for ${expected.file}; the download was discarded`,
      );
    renameSync(partial, final);
    return final;
  } finally {
    rmSync(partial, { force: true });
  }
}

interface Marker {
  id: string;
  version: string;
  sha256: string;
  recipe: string | null;
}

function marker(dir: string): Marker | null {
  try {
    return JSON.parse(readFileSync(join(dir, MARKER), "utf8")) as Marker;
  } catch {
    return null;
  }
}

function expectedMarker(
  id: string,
  artifact: Artifact,
  expected: ArtifactDownload,
  recipe: { id: string } | undefined,
): Marker {
  return {
    id,
    version: artifact.version,
    sha256: expected.sha256,
    recipe: recipe?.id ?? null,
  };
}

const same = (a: Marker | null, b: Marker) =>
  a !== null &&
  a.id === b.id &&
  a.version === b.version &&
  a.sha256 === b.sha256 &&
  a.recipe === b.recipe;

const RETRYABLE_RENAME_CODES = new Set(["EPERM", "EACCES", "EBUSY"]);
const RENAME_MAX_ATTEMPTS = 10;
const RENAME_BACKOFF_STEP_MS = 100;

/** Retry folder renames when Windows briefly holds a freshly extracted tree. */
async function renameWithRetry(
  from: string,
  to: string,
  options: Pick<InstallOptions, "renameImpl" | "sleepImpl"> = {},
): Promise<void> {
  const rename = options.renameImpl ?? renameSync;
  const wait = options.sleepImpl ?? ((ms: number) => sleep(ms));
  for (let attempt = 1; ; attempt++) {
    try {
      rename(from, to);
      return;
    } catch (error) {
      const code = (error as NodeJS.ErrnoException | null)?.code;
      if (
        !code ||
        !RETRYABLE_RENAME_CODES.has(code) ||
        attempt >= RENAME_MAX_ATTEMPTS
      )
        throw error;
      await wait(attempt * RENAME_BACKOFF_STEP_MS);
    }
  }
}

/** Remove only folders this module created for the named artifact version. */
function removeOwn(path: string, parent: string): void {
  if (dirname(path) !== parent) throw new Error("Refusing to remove this path");
  rmSync(path, { recursive: true, force: true, maxRetries: 5 });
}

/** Verify, extract and (for sources) build one artifact into the cache. The
 * final folder appears only by a rename of a complete staging folder.
 */
export async function installArtifact(
  id: string,
  options: InstallOptions = {},
): Promise<string> {
  const manifest = options.manifest ?? loadManifest();
  const platform = options.platform ?? platformKey();
  const cache = options.cache ?? nativeCacheRoot();
  const artifact = manifest.artifacts[id];
  if (!artifact) throw new Error(`Unknown native artifact: ${id}`);
  const expected = download(artifact, id, platform);
  const recipe = options.recipes?.[id];
  if (artifact.kind === "source" && !recipe)
    throw new Error(`Native artifact ${id} needs a build recipe`);
  const target = artifactDir(id, { manifest, platform, cache });
  const wanted = expectedMarker(id, artifact, expected, recipe);
  if (same(marker(target), wanted)) return target;

  const parent = dirname(target);
  mkdirSync(parent, { recursive: true });
  for (const name of readdirSync(parent))
    if (name.startsWith(".staging-") || name.startsWith(".source-"))
      removeOwn(join(parent, name), parent);
  const archive = await obtainArchive(expected, cache, options);
  const staging = join(parent, `.staging-${randomUUID()}`);
  const source = join(parent, `.source-${randomUUID()}`);
  try {
    options.log?.(`${id} ${artifact.version}: installing`);
    mkdirSync(staging);
    if (recipe) {
      mkdirSync(source);
      extractZip(archive, source, expected);
      await recipe.run({ source, output: staging, artifact, platform });
      for (const notice of expected.notices)
        if (!existsSync(join(staging, notice)))
          copyFileSync(join(source, notice), join(staging, notice));
    } else extractZip(archive, staging, expected);
    if (artifact.noticeFile)
      copyFileSync(
        join(nativeAssets, artifact.noticeFile),
        join(staging, "LICENSE.txt"),
      );
    for (const required of [artifact.entry[platform], ...expected.notices])
      if (!required || !existsSync(join(staging, required)))
        throw new Error(`Native artifact ${id} is incomplete after install`);
    writeFileSync(join(staging, MARKER), JSON.stringify(wanted));
    if (existsSync(target)) {
      // A folder without the current marker is an older or interrupted install.
      const old = join(parent, `.staging-old-${randomUUID()}`);
      await renameWithRetry(target, old, options);
      removeOwn(old, parent);
    }
    await renameWithRetry(staging, target, options);
    return target;
  } finally {
    removeOwn(staging, parent);
    removeOwn(source, parent);
  }
}

/** Installed location of an artifact. Routine start calls this: it never
 * downloads or builds, it only refuses when install has not been run.
 */
export function requireArtifact(
  id: string,
  options: Pick<InstallOptions, "manifest" | "platform" | "cache"> & {
    recipeId?: string;
  } = {},
): { dir: string; entry: string; version: string } {
  const manifest = options.manifest ?? loadManifest();
  const platform = options.platform ?? platformKey();
  const artifact = manifest.artifacts[id];
  if (!artifact) throw new Error(`Unknown native artifact: ${id}`);
  const expected = download(artifact, id, platform);
  const dir = artifactDir(id, { ...options, manifest, platform });
  const found = marker(dir);
  if (
    !found ||
    found.id !== id ||
    found.version !== artifact.version ||
    found.sha256 !== expected.sha256 ||
    (options.recipeId !== undefined && found.recipe !== options.recipeId)
  )
    throw new Error(
      `Native artifact ${id} ${artifact.version} is not installed; run stack.ts install`,
    );
  return {
    dir,
    entry: join(dir, artifact.entry[platform] as string),
    version: artifact.version,
  };
}
