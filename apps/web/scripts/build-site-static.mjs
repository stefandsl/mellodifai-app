import { createHash } from "node:crypto";
import fs from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const SCRIPT_DIR = import.meta.dirname;
const WEB_DIR = path.resolve(SCRIPT_DIR, "..");
const REPO_ROOT = path.resolve(WEB_DIR, "../..");
const OUT_DIR = path.join(WEB_DIR, ".next", "site-static");

export const EXPECTED_STATIC_PAGES = [
  "home-en.html",
  "home-it.html",
  "pricing-en.html",
  "pricing-it.html",
  "recipes-canvas-en.html",
  "recipes-canvas-it.html",
  "recipes-grid-en.html",
  "recipes-grid-it.html",
  "recipes-canvas-24-en.html",
  "recipes-canvas-24-it.html",
  "recipes-grid-24-en.html",
  "recipes-grid-24-it.html",
];

export const EXPECTED_STATIC_ISLANDS = ["home", "pricing", "recipes"];

function contentHash(content) {
  return createHash("sha256").update(content).digest("hex").slice(0, 12);
}

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

function isNonEmptyFile(filePath) {
  try {
    const stat = fs.statSync(filePath);
    return stat.isFile() && stat.size > 0;
  } catch {
    return false;
  }
}

export function verifySiteStaticOutput(outDir = OUT_DIR) {
  const missing = [];
  const manifestPath = path.join(outDir, "manifest.json");
  if (!isNonEmptyFile(manifestPath)) {
    throw new Error(`build-site-static: missing manifest.json in ${outDir}`);
  }
  const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));

  for (const page of EXPECTED_STATIC_PAGES) {
    if (!isNonEmptyFile(path.join(outDir, page))) {
      missing.push(page);
    }
  }

  if (
    typeof manifest.fontsFile !== "string" ||
    !/^fonts\.[0-9a-f]{12}\.css$/u.test(manifest.fontsFile) ||
    !isNonEmptyFile(path.join(outDir, manifest.fontsFile))
  ) {
    missing.push(manifest.fontsFile || "fonts.<hash>.css");
  }

  for (const base of EXPECTED_STATIC_ISLANDS) {
    const file = manifest.islandFiles?.[base];
    const pattern = new RegExp(`^${base}\\.[0-9a-f]{12}\\.js$`, "u");
    if (
      typeof file !== "string" ||
      !pattern.test(file) ||
      !isNonEmptyFile(path.join(outDir, "islands", file))
    ) {
      missing.push(`islands/${file || `${base}.<hash>.js`}`);
    }
  }

  if (missing.length > 0) {
    throw new Error(
      `build-site-static: missing expected output in ${outDir}: ${missing.join(", ")}`,
    );
  }
  return manifest;
}

export async function buildSiteStatic(outDir = OUT_DIR) {
  const esbuild = resolveEsbuild();
  fs.rmSync(outDir, { recursive: true, force: true });
  fs.mkdirSync(path.join(outDir, "islands"), { recursive: true });

  // 1. Bundle the SSR prerenderer first so we can compute the hashed fonts.css URL
  //    before bundling the islands (shell embeds the hashed fonts stylesheet URL).
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
  let fontsFile;
  let fontsUrl;
  const islandFiles = {};
  const islandUrls = {};

  try {
    const mod = await import(
      `${pathToFileURL(runnerPath).href}?t=${Date.now()}`
    );

    fontsCss = mod.buildSiteFontsCss();
    const fontsHash = contentHash(fontsCss);
    fontsFile = `fonts.${fontsHash}.css`;
    fontsUrl = `/site/styles/${fontsFile}`;

    // 2. Bundle vanilla ES module islands with the hashed fonts URL injected,
    //    then emit content-hashed filenames for immutable caching.
    const islandsDir = path.join(WEB_DIR, "lib/site/islands");
    const islandEntries = EXPECTED_STATIC_ISLANDS.map((base) =>
      path.join(islandsDir, `${base}.ts`),
    );

    const islandBuild = await esbuild.build({
      entryPoints: islandEntries,
      outdir: path.join(outDir, "islands"),
      bundle: true,
      minify: true,
      write: false,
      format: "esm",
      target: ["es2022"],
      platform: "browser",
      define: {
        __SITE_FONTS_URL__: JSON.stringify(fontsUrl),
      },
      plugins: [makeAliasPlugin()],
    });

    for (const outputFile of islandBuild.outputFiles) {
      const base = path.basename(outputFile.path, ".js");
      const hash = contentHash(outputFile.contents);
      const hashedName = `${base}.${hash}.js`;
      fs.writeFileSync(
        path.join(outDir, "islands", hashedName),
        outputFile.contents,
      );
      islandFiles[base] = hashedName;
      islandUrls[base] = `/site/islands/${hashedName}`;
    }

    // 3. Render all 12 static HTML documents referencing the hashed URLs.
    ({ pages } = mod.renderAllStaticPages({
      fontsUrl,
      islandUrls,
    }));
  } finally {
    if (prevWebDir === undefined) delete process.env.SITE_STATIC_WEB_DIR;
    else process.env.SITE_STATIC_WEB_DIR = prevWebDir;
    fs.rmSync(runnerPath, { force: true });
  }

  for (const [name, html] of Object.entries(pages)) {
    fs.writeFileSync(path.join(outDir, name), html, "utf8");
  }
  fs.writeFileSync(path.join(outDir, fontsFile), fontsCss, "utf8");

  const manifest = {
    pages: Object.keys(pages),
    islands: EXPECTED_STATIC_ISLANDS.map((base) => islandFiles[base]),
    islandFiles,
    islandUrls,
    fontsFile,
    fontsUrl,
  };
  fs.writeFileSync(
    path.join(outDir, "manifest.json"),
    JSON.stringify(manifest, null, 2),
    "utf8",
  );

  verifySiteStaticOutput(outDir);

  return {
    outDir,
    ...manifest,
  };
}

function isDirectCliInvocation() {
  if (!process.argv[1]) return false;
  try {
    return (
      fs.realpathSync(process.argv[1]) ===
      fs.realpathSync(fileURLToPath(import.meta.url))
    );
  } catch {
    return false;
  }
}

if (isDirectCliInvocation()) {
  const targetDir = process.env.SITE_STATIC_OUT_DIR || OUT_DIR;
  const res = await buildSiteStatic(targetDir);
  console.log(
    `build-site-static: wrote ${res.pages.length} pages and ${res.islands.length} islands to ${res.outDir}`,
  );
}
