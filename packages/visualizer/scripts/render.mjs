// Renders the Visualizer composition with the Remotion CLI of this package.
//   node scripts/render.mjs <props.json> <out.mp4> <publicDir> [extra remotion flags]
// Chrome profiles, bundles and temp frames go to E: (RENDER_TMP), not the full C: drive, and
// the Chrome Headless Shell the engine repo already downloaded is reused when it is there.
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const TMP = process.env.RENDER_TMP || "E:\\mellodifai\\render-tmp";
const SHELL =
  process.env.REMOTION_BROWSER ||
  "C:\\Users\\Asus\\Documents\\suno-remake\\motion\\node_modules\\.remotion\\chrome-headless-shell\\win64\\chrome-headless-shell-win64\\chrome-headless-shell.exe";
const [props, out, publicDir, ...rest] = process.argv.slice(2);
if (!props || !out || !publicDir) {
  console.error(
    "usage: node scripts/render.mjs <props.json> <out.mp4> <publicDir>",
  );
  process.exit(1);
}
mkdirSync(TMP, { recursive: true });
mkdirSync(dirname(out), { recursive: true });
const args = [
  join(root, "node_modules", "@remotion", "cli", "remotion-cli.js"),
  "render",
  "src/index.ts",
  "Visualizer",
  out,
  `--props=${props}`,
  `--public-dir=${publicDir}`,
  "--codec=h264",
  "--crf=20",
  "--pixel-format=yuv420p",
  "--audio-codec=aac",
  "--bundle-cache=false",
  "--gl=angle",
  "--log=info",
  ...(existsSync(SHELL) ? [`--browser-executable=${SHELL}`] : []),
  ...(rest.some((a) => a.startsWith("--concurrency"))
    ? []
    : ["--concurrency=8"]),
  ...rest,
];
const r = spawnSync(process.execPath, args, {
  cwd: root,
  stdio: "inherit",
  env: { ...process.env, TEMP: TMP, TMP },
});
process.exit(r.status ?? 1);
