import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // The floating dev badge sits on the player bar; build errors still show as an overlay.
  devIndicators: false,
  transpilePackages: ["@mellodifai/shared"],
  turbopack: {
    // Shared sources retain NodeNext .js specifiers for the worker's emitted ESM.
    resolveAlias: {
      "./i18n.js": "../../packages/shared/src/i18n.ts",
      "./lyric-pack.js": "../../packages/shared/src/lyric-pack.ts",
      "./song-settings.js": "../../packages/shared/src/song-settings.ts",
      "./stages.js": "../../packages/shared/src/stages.ts",
      "./status.js": "../../packages/shared/src/status.ts",
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
