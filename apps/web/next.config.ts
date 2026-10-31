import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  transpilePackages: ["@mellodifai/shared"],
  turbopack: {
    // Shared sources retain NodeNext .js specifiers for the worker's emitted ESM.
    resolveAlias: {
      "./i18n.js": "../../packages/shared/src/i18n.ts",
      "./lyric-pack.js": "../../packages/shared/src/lyric-pack.ts",
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
