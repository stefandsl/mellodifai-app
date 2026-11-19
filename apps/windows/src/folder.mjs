// Checks the folder the installer is about to use, before it writes anything there.
// Plain Node, no packages: the installer runs it from its temp folder with the bundled node.
// Usage: node folder.mjs <folder>   (exit 0 = fine, 2 = refused with the reason on stdout)
import { existsSync, readdirSync, realpathSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

/** The production MellodifAI root on the owner's PC (MELLODIFAI_ROOT of the live site). */
export const PRODUCTION_ROOTS = ["E:\\mellodifai"];

/** Files only an install of this app (or the data it left behind) has. */
export const MARKERS = [
  join("app", "apps", "windows", "src", "run.mjs"),
  join("data", "config", "owner.json"),
];

const key = (path) =>
  resolve(path)
    .replace(/[\\/]+$/u, "")
    .toLowerCase();

/** The folder with every junction and symbolic link resolved, also when it does not exist
 * yet (its deepest existing parent is resolved and the rest appended). */
export function realFolder(dir, realpath = realpathSync.native) {
  let head = resolve(dir);
  const rest = [];
  for (;;) {
    try {
      return join(realpath(head), ...rest.reverse());
    } catch {
      const up = dirname(head);
      if (up === head) return resolve(dir);
      rest.push(head.slice(up.length).replace(/^[\\/]/u, ""));
      head = up;
    }
  }
}

/** Why the installer must not use `dir`, or null when it may. */
export function folderProblem(
  dir,
  {
    productionRoots = PRODUCTION_ROOTS,
    systemDrive = process.env.SystemDrive ?? "C:",
    realpath = realpathSync.native,
  } = {},
) {
  const real = realFolder(dir, realpath);
  if (real.slice(0, 2).toLowerCase() === systemDrive.slice(0, 2).toLowerCase())
    return `MellodifAI non puo' stare sul disco di sistema (${systemDrive}). Scegli un altro disco, per esempio E:.`;
  if (resolve(real, "..") === resolve(real))
    return "Scegli una cartella, non la radice del disco.";
  for (const root of productionRoots) {
    const prod = key(realFolder(root, realpath));
    const here = key(real);
    // The production root itself, a folder that holds it, or any folder inside it.
    if (
      here === prod ||
      prod.startsWith(`${here}\\`) ||
      here.startsWith(`${prod}\\`)
    )
      return `${real} e' (o contiene, o sta dentro) la cartella del MellodifAI in produzione: scegli un'altra cartella, per esempio E:\\MellodifAI-App.`;
  }
  if (existsSync(real)) {
    const entries = readdirSync(real);
    if (entries.length && !MARKERS.some((file) => existsSync(join(real, file))))
      return `${real} contiene gia' altri file: scegli una cartella vuota o nuova, per esempio E:\\MellodifAI-App.`;
  }
  return null;
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  const problem = folderProblem(process.argv[2] ?? "");
  if (problem) {
    console.log(problem);
    process.exitCode = 2;
  }
}
