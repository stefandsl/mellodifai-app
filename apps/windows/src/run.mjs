// Entry point of every MellodifAI shortcut and of the installer. Plain Node, no packages:
// it runs before the app's dependencies exist. Layout of an install (docs/windows-app.md):
//   <install>\node\node.exe   <install>\pnpm\   <install>\app\ (this release)   <install>\data\
import { spawn } from "node:child_process";
import { existsSync, mkdirSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";
import { createInterface } from "node:readline/promises";
import { fileURLToPath } from "node:url";

export function layout(here) {
  const app = resolve(here, "..", "..", "..");
  const install = dirname(app);
  return {
    install,
    app,
    data: join(install, "data"),
    pnpm: join(install, "pnpm", "bin", "pnpm.cjs"),
    desktop: join(app, "ops", "desktop.ts"),
  };
}

export function childEnv(paths, env = process.env) {
  const temp = join(paths.data, "tmp");
  return {
    ...env,
    MELLODIFAI_ROOT: paths.data,
    MELLODIFAI_RUNTIME: "native",
    TEMP: temp,
    TMP: temp,
    TMPDIR: temp,
    npm_config_cache: join(paths.data, "cache", "npm"),
    npm_config_store_dir: join(paths.data, "cache", "pnpm"),
    PATH: `${dirname(process.execPath)};${env.PATH ?? ""}`,
    CI: "true",
  };
}

export function installArgs(paths) {
  return [
    paths.pnpm,
    "install",
    "--frozen-lockfile",
    "--ignore-scripts",
    "--store-dir",
    join(paths.data, "cache", "pnpm"),
    "--config.confirmModulesPurge=false",
  ];
}

/** What the controller runs: the installer's "install" is setup (new) or update. */
export function desktopCommand(command, args, ownerExists) {
  const own = args.filter((a) => a !== "--unattended");
  if (command !== "install") return [command, ...own];
  return ownerExists
    ? ["update", ...own.filter((a) => a === "--no-browser")]
    : ["setup", ...own];
}

/** Which windows wait for Enter: errors always, readable results too, never at logon
 * or under a silent installer (whose console still looks interactive). */
export function shouldPause(command, code, interactive, args = []) {
  if (!interactive || command === "autostart" || args.includes("--unattended"))
    return false;
  return code !== 0 || ["status", "backup", "restore"].includes(command);
}

function exec(args, paths, env) {
  return new Promise((done) => {
    const child = spawn(process.execPath, args, {
      cwd: paths.app,
      env,
      stdio: "inherit",
      windowsHide: false,
    });
    child.on("error", () => done(1));
    child.on("close", (code) => done(code ?? 1));
  });
}

async function main() {
  const [command = "start", ...args] = process.argv.slice(2);
  const paths = layout(dirname(fileURLToPath(import.meta.url)));
  const env = childEnv(paths);
  mkdirSync(env.TEMP, { recursive: true });
  process.title = "MellodifAI";
  let code = 0;
  if (command === "install" || !existsSync(join(paths.app, "node_modules"))) {
    console.log(
      "Installo i componenti di MellodifAI (serve Internet, qualche minuto)...",
    );
    code = await exec(installArgs(paths), paths, env);
    if (code !== 0)
      console.error(
        "\nInstallazione dei componenti non riuscita. Controlla Internet e riprova.",
      );
  }
  if (code === 0) {
    const tsx = createRequire(join(paths.app, "ops", "package.json")).resolve(
      "tsx/cli",
    );
    const owner = existsSync(join(paths.data, "config", "owner.json"));
    code = await exec(
      [tsx, paths.desktop, ...desktopCommand(command, args, owner)],
      paths,
      env,
    );
  }
  if (shouldPause(command, code, Boolean(process.stdin.isTTY), args)) {
    const rl = createInterface({
      input: process.stdin,
      output: process.stdout,
    });
    await rl.question("\nPremi Invio per chiudere questa finestra.");
    rl.close();
  } else if (
    code === 0 &&
    process.stdin.isTTY &&
    command !== "autostart" &&
    !args.includes("--unattended")
  ) {
    console.log("\nPuoi chiudere questa finestra.");
    await new Promise((done) => setTimeout(done, 4000));
  }
  process.exitCode = code;
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
)
  await main();
