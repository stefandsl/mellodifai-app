import fs from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { pathToFileURL } from "node:url";

const SCRIPT_DIR = import.meta.dirname;
const WEB_DIR = path.resolve(SCRIPT_DIR, "..");
const REPO_ROOT = path.resolve(WEB_DIR, "../..");
const OUT_DIR = path.join(WEB_DIR, ".next", "site-static");

function resolveEsbuild() {
  const cliPkg = fs.realpathSync(
    path.join(WEB_DIR, "node_modules/@astryxdesign/cli/package.json"),
  );
  return createRequire(cliPkg)("esbuild");
}

function makeAliasPlugin() {
  return {
    name: "web-aliases",
    setup(build) {
      build.onResolve({ filter: /^@\// }, (args) => {
        const rel = args.path.slice(2);
        const base = path.join(WEB_DIR, rel);
        for (const ext of [
          "",
          ".tsx",
          ".ts",
          ".mjs",
          ".js",
          "/index.tsx",
          "/index.ts",
        ]) {
          const full = base + ext;
          if (fs.existsSync(full) && fs.statSync(full).isFile()) {
            return { path: full };
          }
        }
        return null;
      });
      build.onResolve({ filter: /^@mellodifai\/shared(\/.*)?$/ }, (args) => {
        const sub = args.path.slice("@mellodifai/shared".length);
        const base = sub
          ? path.join(REPO_ROOT, "packages/shared/src", sub)
          : path.join(REPO_ROOT, "packages/shared/src/index");
        for (const ext of ["", ".ts", ".tsx", "/index.ts"]) {
          const full = base + ext;
          if (fs.existsSync(full) && fs.statSync(full).isFile()) {
            return { path: full };
          }
        }
        return null;
      });
      build.onResolve({ filter: /^next\/image$/ }, () => ({
        path: "next-image-shim",
        namespace: "next-image-shim",
      }));
      build.onLoad({ filter: /.*/, namespace: "next-image-shim" }, () => ({
        contents: `
          import { jsx } from "react/jsx-runtime";
          export default function NextImageShim({
            src,
            alt,
            fill,
            unoptimized: _u,
            priority,
            fetchPriority,
            sizes,
            className,
            draggable,
            style,
            ...rest
          }) {
            const fillStyle = fill
              ? {
                  position: "absolute",
                  height: "100%",
                  width: "100%",
                  left: 0,
                  top: 0,
                  right: 0,
                  bottom: 0,
                  color: "transparent",
                  ...style,
                }
              : style;
            const isDataUri =
              typeof src === "string" && src.startsWith("data:");
            return jsx("img", {
              src,
              alt,
              sizes,
              className,
              draggable,
              decoding: isDataUri ? "sync" : "async",
              fetchPriority: isDataUri ? "high" : undefined,
              style: fillStyle,
              ...rest,
            });
          }
        `,
        loader: "js",
        resolveDir: WEB_DIR,
      }));
      build.onResolve({ filter: /\.css$/ }, () => ({
        path: "empty-css",
        namespace: "empty-css",
      }));
      build.onLoad({ filter: /.*/, namespace: "empty-css" }, () => ({
        contents: "",
        loader: "js",
        resolveDir: WEB_DIR,
      }));
    },
  };
}

export async function buildSiteStatic(outDir = OUT_DIR) {
  const esbuild = resolveEsbuild();
  fs.mkdirSync(path.join(outDir, "islands"), { recursive: true });

  // 1. Bundle vanilla ES module islands (zero React, zero Astryx, zero Zod).
  const islandsDir = path.join(WEB_DIR, "lib/site/islands");
  const islandEntries = ["home.ts", "pricing.ts", "recipes.ts"]
    .map((f) => path.join(islandsDir, f))
    .filter((p) => fs.existsSync(p));

  if (islandEntries.length) {
    await esbuild.build({
      entryPoints: islandEntries,
      outdir: path.join(outDir, "islands"),
      bundle: true,
      minify: true,
      format: "esm",
      target: ["es2022"],
      platform: "browser",
      plugins: [makeAliasPlugin()],
    });
  }

  // 2. Bundle and execute the SSR prerenderer in Node to produce static HTML + fonts.css.
  const runnerPath = path.join(outDir, "_prerender-runner.mjs");
  await esbuild.build({
    entryPoints: [path.join(WEB_DIR, "lib/site/render-static-entry.tsx")],
    outfile: runnerPath,
    bundle: true,
    format: "esm",
    platform: "node",
    jsx: "automatic",
    packages: "external",
    plugins: [makeAliasPlugin()],
  });

  const prevWebDir = process.env.SITE_STATIC_WEB_DIR;
  process.env.SITE_STATIC_WEB_DIR = WEB_DIR;
  let pages;
  let fontsCss;
  try {
    const mod = await import(
      `${pathToFileURL(runnerPath).href}?t=${Date.now()}`
    );
    ({ pages, fontsCss } = mod.renderAllStaticPages());
  } finally {
    if (prevWebDir === undefined) delete process.env.SITE_STATIC_WEB_DIR;
    else process.env.SITE_STATIC_WEB_DIR = prevWebDir;
    fs.rmSync(runnerPath, { force: true });
  }
  for (const [name, html] of Object.entries(pages)) {
    fs.writeFileSync(path.join(outDir, name), html, "utf8");
  }
  fs.writeFileSync(path.join(outDir, "fonts.css"), fontsCss, "utf8");

  return {
    outDir,
    pages: Object.keys(pages),
    islands: islandEntries.map((e) => `${path.basename(e, ".ts")}.js`),
  };
}

if (
  process.argv[1] &&
  path.resolve(process.argv[1]) ===
    path.join(SCRIPT_DIR, "build-site-static.mjs")
) {
  const res = await buildSiteStatic();
  console.log(
    `build-site-static: wrote ${res.pages.length} pages and ${res.islands.length} islands to ${res.outDir}`,
  );
}
