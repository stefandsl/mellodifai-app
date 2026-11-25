import { execFile } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { promisify } from "node:util";
import { type NextRequest, NextResponse } from "next/server";

const execFileAsync = promisify(execFile);

const WEB_DIR = process.cwd();
const BUILD_SCRIPT = path.join(WEB_DIR, "scripts", "build-site-static.mjs");

const WATCHED_PATHS = [
  path.join(WEB_DIR, "lib", "site"),
  path.join(WEB_DIR, "components", "site"),
  path.join(WEB_DIR, "app", "(site)", "site.css"),
  path.join(WEB_DIR, "src", "site-astryx.css"),
  path.join(WEB_DIR, "src", "site-astryx-table.css"),
  path.join(WEB_DIR, "src", "themes", "mesh", "mesh.css"),
];

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

function runDevBuild(staticDir: string): Promise<void> {
  if (!devBuildPromise) {
    devBuildPromise = execFileAsync(process.execPath, [BUILD_SCRIPT], {
      cwd: WEB_DIR,
      env: { ...process.env, SITE_STATIC_OUT_DIR: staticDir },
    })
      .then(() => {
        cache.clear();
        cachedManifest = null;
        devBuiltAt = Date.now();
      })
      .finally(() => {
        devBuildPromise = null;
      });
  }
  return devBuildPromise;
}

async function ensureDevBuilt(
  staticDir: string,
  fullPath: string,
): Promise<void> {
  const exists = fs.existsSync(fullPath);
  if (!exists || devBuiltAt === 0 || sourcesChangedSince(devBuiltAt)) {
    await runDevBuild(staticDir);
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
  options: { cacheControl: string; varyCookie?: boolean; required?: boolean },
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

  await ensureDevBuilt(staticDir, full);
  if (!fs.existsSync(/*turbopackIgnore: true*/ full)) {
    return new NextResponse("Not Found", { status: 404 });
  }
  const text = fs.readFileSync(/*turbopackIgnore: true*/ full, "utf8");
  return buildOkResponse(text, contentType, options);
}

function buildOkResponse(
  body: string,
  contentType: string,
  options: { cacheControl: string; varyCookie?: boolean },
): NextResponse {
  const headers: Record<string, string> = {
    "content-type": contentType,
    "cache-control": options.cacheControl,
  };
  if (options.varyCookie) {
    headers.vary = "Cookie";
  }
  return new NextResponse(body, { status: 200, headers });
}
