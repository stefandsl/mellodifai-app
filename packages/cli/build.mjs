import { build } from "esbuild";

await build({
  entryPoints: ["src/main.ts"],
  outfile: "dist/mellodifai.js",
  bundle: true,
  platform: "node",
  target: "node22",
  format: "esm",
  banner: { js: "#!/usr/bin/env node" },
});
