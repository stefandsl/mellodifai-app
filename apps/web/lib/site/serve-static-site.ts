import { execFile } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { promisify } from "node:util";
import { type NextRequest, NextResponse } from "next/server";
import { recipeStartHref } from "./nav";

const execFileAsync = promisify(execFile);

const WEB_DIR = process.cwd();
const REPO_ROOT = path.resolve(WEB_DIR, "..", "..");
const BUILD_SCRIPT = path.join(WEB_DIR, "scripts", "build-site-static.mjs");

/**
 * Every input of `scripts/build-site-static.mjs`, relative to the repo root: the bundled
 * sources and the files the prerender reads at run time. In dev, a file under one of these
 * paths that is newer than the last build start triggers a rebuild. site-static-build.test.ts
 * checks that the list covers every source file esbuild bundles.
 */
export const SITE_STATIC_SOURCES = [
  "apps/web/scripts/build-site-static.mjs",
  "apps/web/scripts/site-study/changelog-data.mjs",
  "apps/web/lib/site",
  "apps/web/lib/theme.ts",
  "apps/web/components/site",
  "apps/web/app/(site)/site.css",
  "apps/web/src/site-primitives.tsx",
  "apps/web/src/site-table-primitives.tsx",
  "apps/web/src/site-astryx.css",
  "apps/web/src/site-astryx-table.css",
  "apps/web/src/themes/mesh/mesh.css",
  "apps/web/public/site/assets.manifest.json",
  "apps/web/public/site/brand-mark.png",
  "apps/web/public/site/recipes",
  "content/changelog",
  "content/recipes",
  // The whole package, not only recipes/: the prerender bundles its index barrel.
  "packages/shared/src",
] as const;

const WATCHED_PATHS = SITE_STATIC_SOURCES.map((rel) =>
  path.join(REPO_ROOT, ...rel.split("/")),
);

type StaticManifest = {
  pages: string[];
  islands: string[];
  fontsFile: string;
};

const cache = new Map<string, string>();
let cachedManifest: StaticManifest | null = null;
let devBuiltAt = 0;
let devBuildPromise: Promise<void> | null = null;

function getStaticDir(): string {
  return (
    process.env.SITE_STATIC_DIR || path.join(WEB_DIR, ".next", "site-static")
  );
}

export function resetStaticSiteCacheForTest(): void {
  cache.clear();
  cachedManifest = null;
  devBuiltAt = 0;
  devBuildPromise = null;
}

function latestMtimeMs(target: string): number {
  let latest = 0;
  try {
    const stat = fs.statSync(/*turbopackIgnore: true*/ target);
    if (stat.isFile()) return stat.mtimeMs;
    if (stat.isDirectory()) {
      for (const entry of fs.readdirSync(/*turbopackIgnore: true*/ target, {
        withFileTypes: true,
      })) {
        if (entry.name.startsWith(".")) continue;
        const m = latestMtimeMs(
          path.join(/*turbopackIgnore: true*/ target, entry.name),
        );
        if (m > latest) latest = m;
      }
    }
  } catch {
    // Missing optional path.
  }
  return latest;
}

function sourcesChangedSince(sinceMs: number): boolean {
  for (const p of WATCHED_PATHS) {
    if (latestMtimeMs(p) > sinceMs) return true;
  }
  return false;
}

// One build at a time: requests that arrive during a build share its promise.
function runDevBuild(staticDir: string): Promise<void> {
  if (!devBuildPromise) {
    // Stamp the start, not the end: a source saved while the build runs is newer than
    // this stamp, so the next request rebuilds it.
    const startedAt = Date.now();
    devBuildPromise = execFileAsync(process.execPath, [BUILD_SCRIPT], {
      cwd: WEB_DIR,
      env: { ...process.env, SITE_STATIC_OUT_DIR: staticDir },
    })
      .then(() => {
        cache.clear();
        cachedManifest = null;
        devBuiltAt = startedAt;
      })
      .finally(() => {
        devBuildPromise = null;
      });
  }
  return devBuildPromise;
}

// Rebuilds only when there is no output yet or a watched source changed. A request for a
// name the build did not write (an old or made-up hash) never triggers a rebuild.
async function ensureDevBuilt(
  staticDir: string,
): Promise<StaticManifest | null> {
  let manifest = readManifest(staticDir);
  if (!manifest || devBuiltAt === 0 || sourcesChangedSince(devBuiltAt)) {
    await runDevBuild(staticDir);
    manifest = readManifest(staticDir);
  }
  return manifest;
}

function readStaticFile(fullPath: string): string | null {
  try {
    return fs.readFileSync(/*turbopackIgnore: true*/ fullPath, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
}

function readManifest(staticDir: string): StaticManifest | null {
  if (process.env.NODE_ENV === "production" && cachedManifest) {
    return cachedManifest;
  }
  const manifestPath = path.join(
    /*turbopackIgnore: true*/ staticDir,
    "manifest.json",
  );
  if (!fs.existsSync(/*turbopackIgnore: true*/ manifestPath)) return null;
  try {
    const parsed = JSON.parse(
      fs.readFileSync(/*turbopackIgnore: true*/ manifestPath, "utf8"),
    ) as StaticManifest;
    if (process.env.NODE_ENV === "production") {
      cachedManifest = parsed;
    }
    return parsed;
  } catch {
    return null;
  }
}

function isExpectedManifestAsset(
  manifest: StaticManifest,
  relFile: string,
): boolean {
  if (relFile === manifest.fontsFile) return true;
  if (relFile.startsWith("islands/")) {
    return manifest.islands.includes(relFile.slice("islands/".length));
  }
  return manifest.pages.includes(relFile);
}

export function getRequestLocale(request: NextRequest): "en" | "it" {
  return request.cookies.get("mellodifai_lang")?.value === "en" ? "en" : "it";
}

export async function serveStaticAsset(
  _request: NextRequest,
  relFile: string,
  contentType: string,
  options: {
    cacheControl: string;
    varyCookie?: boolean;
    required?: boolean;
    status?: number;
  },
): Promise<NextResponse> {
  const staticDir = getStaticDir();
  const full = path.join(/*turbopackIgnore: true*/ staticDir, relFile);
  const isProd = process.env.NODE_ENV === "production";
  const required = options.required ?? true;

  if (isProd) {
    if (cache.has(relFile)) {
      return buildOkResponse(cache.get(relFile) ?? "", contentType, options);
    }
    if (!fs.existsSync(/*turbopackIgnore: true*/ full)) {
      if (required) {
        console.error(
          `[site-static] missing required static asset: ${relFile} (${full})`,
        );
        return new NextResponse("Internal Server Error", { status: 500 });
      }
      const manifest = readManifest(staticDir);
      if (!manifest || isExpectedManifestAsset(manifest, relFile)) {
        console.error(
          `[site-static] missing static asset from build output: ${relFile} (${full})`,
        );
        return new NextResponse("Internal Server Error", { status: 500 });
      }
      return new NextResponse("Not Found", { status: 404 });
    }
    const text = fs.readFileSync(/*turbopackIgnore: true*/ full, "utf8");
    cache.set(relFile, text);
    return buildOkResponse(text, contentType, options);
  }

  const manifest = await ensureDevBuilt(staticDir);
  if (!manifest || !isExpectedManifestAsset(manifest, relFile)) {
    return new NextResponse("Not Found", { status: 404 });
  }
  // A rebuild started by another request can remove the file between the manifest
  // check and this read.
  const text = readStaticFile(full);
  if (text === null) {
    return new NextResponse("Not Found", { status: 404 });
  }
  return buildOkResponse(text, contentType, options);
}

const SAFE_SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/u;

type RecipeLookupResult =
  | { kind: "ok"; pageFile: string }
  | { kind: "not-found"; response: NextResponse }
  | { kind: "error"; response: NextResponse };

async function lookupStaticRecipePage(
  request: NextRequest,
  slug: string,
): Promise<RecipeLookupResult> {
  const lang = getRequestLocale(request);
  const htmlOpts = {
    cacheControl: "private, no-cache",
    varyCookie: true,
    required: true,
  };
  const notFoundFile = `not-found-${lang}.html`;

  if (!SAFE_SLUG_RE.test(slug)) {
    return {
      kind: "not-found",
      response: await serveStaticAsset(
        request,
        notFoundFile,
        "text/html; charset=utf-8",
        {
          ...htmlOpts,
          status: 404,
        },
      ),
    };
  }

  const pageFile = `recipe-${slug}-${lang}.html`;
  const staticDir = getStaticDir();
  const isProd = process.env.NODE_ENV === "production";
  const manifest = isProd
    ? readManifest(staticDir)
    : await ensureDevBuilt(staticDir);

  if (!manifest) {
    if (isProd) {
      console.error(
        `[site-static] missing manifest.json when serving ${pageFile} (${staticDir})`,
      );
      return {
        kind: "error",
        response: new NextResponse("Internal Server Error", { status: 500 }),
      };
    }
    return {
      kind: "not-found",
      response: new NextResponse("Not Found", { status: 404 }),
    };
  }

  if (!manifest.pages.includes(pageFile)) {
    return {
      kind: "not-found",
      response: await serveStaticAsset(
        request,
        notFoundFile,
        "text/html; charset=utf-8",
        {
          ...htmlOpts,
          status: 404,
        },
      ),
    };
  }

  return { kind: "ok", pageFile };
}

export async function serveStaticRecipeDetail(
  request: NextRequest,
  slug: string,
): Promise<NextResponse> {
  const lookup = await lookupStaticRecipePage(request, slug);
  if (lookup.kind !== "ok") return lookup.response;

  return serveStaticAsset(
    request,
    lookup.pageFile,
    "text/html; charset=utf-8",
    {
      cacheControl: "private, no-cache",
      varyCookie: true,
      required: true,
    },
  );
}

// Temporary bridge until C15 (#46) lands the anonymous recipe trial studio:
// redirect known slugs (307) to the existing /create?recipe=<slug> entry and
// return the static site 404 for unknown or malformed slugs.
export async function serveStaticRecipeTry(
  request: NextRequest,
  slug: string,
): Promise<NextResponse> {
  const lookup = await lookupStaticRecipePage(request, slug);
  if (lookup.kind !== "ok") return lookup.response;

  return new NextResponse(null, {
    status: 307,
    headers: {
      location: recipeStartHref(slug),
      "cache-control": "private, no-cache",
      vary: "Cookie",
    },
  });
}

function buildOkResponse(
  body: string,
  contentType: string,
  options: { cacheControl: string; varyCookie?: boolean; status?: number },
): NextResponse {
  const headers: Record<string, string> = {
    "content-type": contentType,
    "cache-control": options.cacheControl,
  };
  if (options.varyCookie) {
    headers.vary = "Cookie";
  }
  return new NextResponse(body, { status: options.status ?? 200, headers });
}
