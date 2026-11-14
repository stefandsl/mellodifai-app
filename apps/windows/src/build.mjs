// Builds MellodifAI-Setup-<version>.exe from the committed HEAD (docs/windows-app.md).
// Usage: node apps/windows/src/build.mjs [--out <dir>] [--allow-dirty]
// Needs makensis (NSIS 3, MAKENSIS or the electron-builder cache), git and Windows tar.
import { execFileSync, spawnSync } from "node:child_process";
import {
  cpSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { pngToIco } from "./icon.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const repo = resolve(here, "..", "..", "..");

export function versionName(describe, date = new Date()) {
  const clean = describe.trim().replaceAll(/[^0-9A-Za-z._-]/g, "-");
  return clean || date.toISOString().slice(0, 10);
}

/** NSIS 3 from MAKENSIS, the PATH, or the electron-builder caches already on this PC. */
export function findMakensis(
  env = process.env,
  exists = existsSync,
  list = readdirSync,
) {
  if (env.MAKENSIS && exists(env.MAKENSIS)) return env.MAKENSIS;
  const roots = [
    env.LOCALAPPDATA &&
      join(env.LOCALAPPDATA, "electron-builder", "Cache", "nsis"),
    env.LOCALAPPDATA && join(env.LOCALAPPDATA, "electron-builder", "Cache"),
    "G:\\caches\\electron-builder",
  ].filter(Boolean);
  for (const root of roots) {
    if (!exists(root)) continue;
    for (const entry of list(root)) {
      if (!entry.startsWith("nsis-3")) continue;
      const direct = join(root, entry, "Bin", "makensis.exe");
      if (exists(direct)) return direct;
      // electron-builder unpacks into <version>\<version>-<suffix>\Bin.
      let subs = [];
      try {
        subs = list(join(root, entry));
      } catch {}
      for (const sub of subs) {
        const nested = join(root, entry, sub, "Bin", "makensis.exe");
        if (exists(nested)) return nested;
      }
    }
  }
  const where = spawnSync("where", ["makensis"], { encoding: "utf8" });
  const found = where.stdout?.split(/\r?\n/).find(Boolean);
  if (found) return found;
  throw new Error("makensis not found: install NSIS 3 or set MAKENSIS");
}

/** The pnpm package the repo pins, found next to the pnpm on PATH. */
export function findPnpm(pinned) {
  const where = spawnSync("where", ["pnpm.cmd"], { encoding: "utf8" });
  const candidates = [
    process.env.PNPM_PACKAGE,
    ...(where.stdout ?? "")
      .split(/\r?\n/)
      .filter(Boolean)
      .map((shim) => join(dirname(shim), "node_modules", "pnpm")),
  ].filter(Boolean);
  for (const dir of candidates) {
    const manifest = join(dir, "package.json");
    if (!existsSync(manifest)) continue;
    const { version } = JSON.parse(readFileSync(manifest, "utf8"));
    if (version === pinned && existsSync(join(dir, "bin", "pnpm.cjs")))
      return dir;
  }
  throw new Error(`pnpm ${pinned} package not found; set PNPM_PACKAGE`);
}

function git(...args) {
  return execFileSync("git", args, { cwd: repo, encoding: "utf8" }).trim();
}

function main(argv) {
  const at = argv.indexOf("--out");
  const out = resolve(
    at >= 0 && argv[at + 1]
      ? argv[at + 1]
      : join(process.env.MELLODIFAI_ROOT ?? "E:/mellodifai", "dist", "windows"),
  );
  if (/^[cC]:/.test(out)) throw new Error("Build output must stay off C:");
  if (git("status", "--porcelain") && !argv.includes("--allow-dirty"))
    throw new Error("Commit first: the installer is built from HEAD");
  const version = versionName(git("describe", "--tags", "--always", "--dirty"));
  const stage = join(out, `stage-${version}`);
  rmSync(stage, { recursive: true, force: true });
  mkdirSync(join(stage, "app"), { recursive: true });

  console.log(`Staging ${version} in ${stage}`);
  const tar = join(out, `app-${version}.tar`);
  execFileSync("git", ["archive", "--format=tar", "-o", tar, "HEAD"], {
    cwd: repo,
  });
  // Windows' own bsdtar: a GNU tar from Git Bash reads "E:" as a remote host.
  const windowsTar = join(
    process.env.SystemRoot ?? "C:\\Windows",
    "System32",
    "tar.exe",
  );
  execFileSync(windowsTar, ["-xf", tar, "-C", join(stage, "app")]);
  rmSync(tar);
  writeFileSync(join(stage, "app", "VERSION"), `${version}\n`);

  mkdirSync(join(stage, "node"), { recursive: true });
  cpSync(process.execPath, join(stage, "node", "node.exe"));
  const { packageManager } = JSON.parse(
    readFileSync(join(repo, "package.json"), "utf8"),
  );
  const pinned = packageManager.replace(/^pnpm@/, "");
  cpSync(findPnpm(pinned), join(stage, "pnpm"), { recursive: true });
  writeFileSync(
    join(stage, "THIRD-PARTY.txt"),
    [
      "MellodifAI bundles these programs, unchanged:",
      `- Node.js ${process.version} (node\\node.exe), MIT licence: https://github.com/nodejs/node/blob/${process.version}/LICENSE`,
      `- pnpm ${pinned} (pnpm\\), MIT licence: pnpm\\LICENSE`,
      "The app's own dependencies are installed from the npm registry at setup; their licences are in app\\node_modules.",
      "",
    ].join("\r\n"),
  );
  writeFileSync(
    join(stage, "mellodifai.ico"),
    pngToIco(readFileSync(join(repo, "apps", "web", "app", "icon.png"))),
  );

  mkdirSync(out, { recursive: true });
  const outfile = join(out, `MellodifAI-Setup-${version}.exe`);
  const makensis = findMakensis();
  console.log(`makensis: ${makensis}`);
  const built = spawnSync(
    makensis,
    [
      "/V2",
      `/DVERSION=${version}`,
      `/DSTAGE=${stage}`,
      `/DOUTFILE=${outfile}`,
      join(repo, "apps", "windows", "installer.nsi"),
    ],
    { stdio: "inherit" },
  );
  if (built.status !== 0) throw new Error(`makensis failed (${built.status})`);
  // electron-builder 26 taught us: count the icon groups NSIS really kept.
  const icons = spawnSync(
    "powershell.exe",
    [
      "-NoProfile",
      "-Command",
      `Add-Type -Namespace W -Name I -MemberDefinition '[DllImport("shell32.dll", CharSet=CharSet.Unicode)] public static extern uint ExtractIconEx(string f, int i, System.IntPtr[] l, System.IntPtr[] s, uint n);'; [W.I]::ExtractIconEx('${outfile.replaceAll("'", "''")}', -1, $null, $null, 0)`,
    ],
    { encoding: "utf8" },
  );
  const groups = Number(icons.stdout.trim());
  if (!(groups > 0))
    throw new Error(`Installer has no icon groups (${icons.stdout.trim()})`);
  rmSync(stage, { recursive: true, force: true });
  const size = (statSync(outfile).size / 1024 / 1024).toFixed(1);
  console.log(`Built ${outfile} (${size} MB, ${groups} icon group(s))`);
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  try {
    main(process.argv.slice(2));
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
