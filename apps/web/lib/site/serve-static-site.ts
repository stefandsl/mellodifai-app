import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { type NextRequest, NextResponse } from "next/server";

const WEB_DIR = process.cwd();
const STATIC_DIR = path.join(WEB_DIR, ".next", "site-static");
const BUILD_SCRIPT = path.join(WEB_DIR, "scripts", "build-site-static.mjs");

const cache = new Map<string, string>();
let devBuiltAt = 0;

function ensureStaticBuilt(relFile: string): string {
  const full = path.join(STATIC_DIR, relFile);
  if (process.env.NODE_ENV === "production") {
    if (fs.existsSync(full)) return full;
    execFileSync(process.execPath, [BUILD_SCRIPT], {
      cwd: WEB_DIR,
      stdio: "inherit",
    });
    return full;
  }

  const now = Date.now();
  if (!fs.existsSync(full) || now - devBuiltAt > 3000) {
    execFileSync(process.execPath, [BUILD_SCRIPT], {
      cwd: WEB_DIR,
      stdio: "inherit",
    });
    cache.clear();
    devBuiltAt = Date.now();
  }
  return full;
}

function readAsset(relFile: string): string | null {
  if (process.env.NODE_ENV === "production" && cache.has(relFile)) {
    return cache.get(relFile) ?? null;
  }
  const full = ensureStaticBuilt(relFile);
  if (!fs.existsSync(full)) return null;
  const text = fs.readFileSync(full, "utf8");
  cache.set(relFile, text);
  return text;
}

export function getRequestLocale(request: NextRequest): "en" | "it" {
  return request.cookies.get("mellodifai_lang")?.value === "en" ? "en" : "it";
}

export function serveStaticAsset(
  _request: NextRequest,
  relFile: string,
  contentType: string,
  options: { cacheControl: string; varyCookie?: boolean },
): NextResponse {
  const body = readAsset(relFile);
  if (body === null) {
    return new NextResponse("Not Found", { status: 404 });
  }
  const headers: Record<string, string> = {
    "content-type": contentType,
    "cache-control": options.cacheControl,
  };
  if (options.varyCookie) {
    headers.vary = "Cookie";
  }
  return new NextResponse(body, { status: 200, headers });
}
