import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Confirmation URLs carry single-use sign-in credentials.
  logging: { incomingRequests: { ignore: [/^\/auth\/confirm(?:\?|$)/] } },
  // The floating dev badge sits on the player bar; build errors still show as an overlay.
  devIndicators: false,
  transpilePackages: ["@mellodifai/shared"],
  turbopack: {
    // Shared sources retain NodeNext .js specifiers for the worker's emitted ESM.
    resolveAlias: {
      "./i18n.js": "../../packages/shared/src/i18n.ts",
      "./lyric-pack.js": "../../packages/shared/src/lyric-pack.ts",
      "./lyrics-assist.js": "../../packages/shared/src/lyrics-assist.ts",
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
