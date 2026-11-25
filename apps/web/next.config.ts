import path from "node:path";
import { pathToFileURL } from "node:url";
import type { NextConfig } from "next";

const importEsm = new Function("u", "return import(u)") as <T>(
  specifier: string,
) => Promise<T>;

const nextConfig: NextConfig = {
  compiler: {
    runAfterProductionCompile: async ({ projectDir }) => {
      const mod = await importEsm<{
        buildSiteStatic: (outDir: string) => Promise<{
          outDir: string;
          pages: string[];
          islands: string[];
        }>;
      }>(
        pathToFileURL(path.join(projectDir, "scripts", "build-site-static.mjs"))
          .href,
      );
      const res = await mod.buildSiteStatic(
        path.join(projectDir, ".next", "site-static"),
      );
      console.log(
        `build-site-static: wrote ${res.pages.length} pages and ${res.islands.length} islands to ${res.outDir}`,
      );
    },
  },
  experimental: {
    globalNotFound: true,
    // The desktop app builds unattended on the owner's PC: Next's upgrade nudge for coding
    // agents stops `next build` with an error when the build runs under one, so turn it off there.
    ...(process.env.MDF_UNATTENDED_BUILD === "1" && {
      agentUpgrade: false as const,
    }),
    serverActions: {
      allowedOrigins: [
        "app.mellodifai.com",
        "127.0.0.1:3000",
        "localhost:3000",
      ],
    },
  },
  // Confirmation URLs carry single-use sign-in credentials.
  logging: { incomingRequests: { ignore: [/^\/auth\/confirm(?:\?|$)/] } },
  // The floating dev badge sits on the player bar; build errors still show as an overlay.
  devIndicators: false,
  transpilePackages: ["@mellodifai/shared"],
  turbopack: {
    // Shared sources retain NodeNext .js specifiers for the worker's emitted ESM.
    resolveAlias: {
      "../status.js": "../../packages/shared/src/status.ts",
      "./reads.js": "../../packages/shared/src/ops/reads.ts",
      "./inputs.js": "../../packages/shared/src/ops/inputs.ts",
      "../stages.js": "../../packages/shared/src/stages.ts",
      "../lyric-pack.js": "../../packages/shared/src/lyric-pack.ts",
      "../song-settings.js": "../../packages/shared/src/song-settings.ts",
      "../visualizer/viz-params.js":
        "../../packages/shared/src/visualizer/viz-params.ts",

      "./ops/index.js": "../../packages/shared/src/ops/index.ts",
      "../ops/errors.js": "../../packages/shared/src/ops/errors.ts",
      "../ops/inputs.js": "../../packages/shared/src/ops/inputs.ts",
      "../remake/workflow.js": "../../packages/shared/src/remake/workflow.ts",
      "../song-source.js": "../../packages/shared/src/song-source.ts",
      "./recipes/index.js": "../../packages/shared/src/recipes/index.ts",
      "./schema.js": "../../packages/shared/src/recipes/schema.ts",
      "./search.js": "../../packages/shared/src/recipes/search.ts",
      "./start.js": "../../packages/shared/src/recipes/start.ts",
      "./i18n.js": "../../packages/shared/src/i18n.ts",
      "./lyric-pack.js": "../../packages/shared/src/lyric-pack.ts",
      "./publication-defaults.js":
        "../../packages/shared/src/publication-defaults.ts",
      "./lyrics-assist.js": "../../packages/shared/src/lyrics-assist.ts",
      "./music-video/index.js":
        "../../packages/shared/src/music-video/index.ts",
      "./cut-plan.js": "../../packages/shared/src/music-video/cut-plan.ts",
      "./shot-list.js": "../../packages/shared/src/music-video/shot-list.ts",
      "./bible.js": "../../packages/shared/src/music-video/bible.ts",
      "./gates.js": "../../packages/shared/src/music-video/gates.ts",
      "./composer.js": "../../packages/shared/src/music-video/composer.ts",
      "./mv-ops.js": "../../packages/shared/src/music-video/mv-ops.ts",
      "./prices.js": "../../packages/shared/src/music-video/prices.ts",
      "./storyboard.js": "../../packages/shared/src/music-video/storyboard.ts",
      "./publishing/index.js": "../../packages/shared/src/publishing/index.ts",
      "./lint.js": "../../packages/shared/src/publishing/lint.ts",
      "./provider.js": "../../packages/shared/src/publishing/provider.ts",
      "./rules.js": "../../packages/shared/src/publishing/rules.ts",
      "./remake/index.js": "../../packages/shared/src/remake/index.ts",
      "./analysis.js": "../../packages/shared/src/remake/analysis.ts",
      "./blueprint.js": "../../packages/shared/src/remake/blueprint.ts",
      "./timing-check.js": "../../packages/shared/src/remake/timing-check.ts",
      "./workflow.js": "../../packages/shared/src/remake/workflow.ts",
      "./rewrite.js": "../../packages/shared/src/rewrite.ts",
      "./song-settings.js": "../../packages/shared/src/song-settings.ts",
      "./song-source.js": "../../packages/shared/src/song-source.ts",
      "./stages.js": "../../packages/shared/src/stages.ts",
      "./status.js": "../../packages/shared/src/status.ts",
      "./suggest-take.js": "../../packages/shared/src/suggest-take.ts",
      "./visualizer/index.js": "../../packages/shared/src/visualizer/index.ts",
      "./visualizer/viz-params.js":
        "../../packages/shared/src/visualizer/viz-params.ts",
      "./viz-audio.js": "../../packages/shared/src/visualizer/viz-audio.ts",
      "./viz-draw.js": "../../packages/shared/src/visualizer/viz-draw.ts",
      "./viz-kit.js": "../../packages/shared/src/visualizer/viz-kit.ts",
      "./viz-logos.js": "../../packages/shared/src/visualizer/viz-logos.ts",
      "./viz-looks.js": "../../packages/shared/src/visualizer/viz-looks.ts",
      "./viz-params.js": "../../packages/shared/src/visualizer/viz-params.ts",
    },
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
