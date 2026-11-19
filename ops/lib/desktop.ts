// Pure pieces of the Windows desktop app (docs/windows-app.md): paths, the env files the
// web app and worker read, process recognition, backups and the owner's messages.
// No processes here (only a loopback port probe), so all of it is unit tested.
import { createHash, randomUUID } from "node:crypto";
import {
  existsSync,
  readdirSync,
  realpathSync,
  rmSync,
  statfsSync,
  statSync,
} from "node:fs";
import { createServer } from "node:http";
import { connect } from "node:net";
import { dirname, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { ENV_TABLE, runtimePath, stackDir } from "./envs.js";
import { databaseUrl } from "./pg.js";
import { writePrivate } from "./private-file.js";
import type { RolePasswords } from "./roles.js";
import { runtimeRoot } from "./runtime.js";

export const DESKTOP = ENV_TABLE.desktop;
export const SITE_URL = DESKTOP.siteUrl;
export const WEB_HOST = "127.0.0.1";
export const WEB_PORT = Number(new URL(SITE_URL).port);
export const API_URL = `http://127.0.0.1:${DESKTOP.ports.api}`;

export function desktopPaths(root = runtimeRoot()) {
  const base = runtimePath(root);
  const stack = stackDir("desktop");
  return {
    root: base,
    stack,
    logs: join(base, "logs"),
    run: join(base, "run"),
    backups: join(base, "backups"),
    config: join(base, "config"),
    // The owner's provider keys (kie, OpenRouter...). Filled by the owner, never generated.
    workerKeys: join(base, "config", "worker.env"),
    owner: join(base, "config", "owner.json"),
    webEnv: join(stack, "web.env"),
    workerEnv: join(stack, "worker.env"),
    state: join(base, "run", "desktop-state.json"),
    // The app window's own browser profile: its sign-in cookie stays with the app.
    browser: join(base, "browser"),
  };
}

/** The engine folder of the live site on the owner's PC (the worker's built-in default): its
 * publish\ folder holds production's YouTube token. The desktop app never runs there. */
export const PRODUCTION_ENGINE_ROOTS = [
  "C:\\Users\\Asus\\Documents\\suno-remake",
];

/** The folder with every junction and link resolved, also when it does not exist yet (its
 * deepest existing parent is resolved and the rest appended). */
export function realFolder(dir: string): string {
  let head = resolve(dir);
  const rest: string[] = [];
  for (;;) {
    try {
      return join(realpathSync.native(head), ...rest.reverse());
    } catch {
      const up = dirname(head);
      if (up === head) return resolve(dir);
      rest.push(head.slice(up.length).replace(/^[\\/]/u, ""));
      head = up;
    }
  }
}

const folderKey = (path: string) =>
  realFolder(path)
    .replace(/[\\/]+$/u, "")
    .toLowerCase();

/**
 * Where the worker's engines run and whether it may publish. By default the engine folder is
 * `<data>\engine` (empty: engine stages fail with a clear error, nothing paid) and
 * publishing is off. The owner turns both on in his keys file with
 * MELLODIFAI_ENGINE_ROOT=<his own engine copy, with his own YouTube credentials> and
 * MELLODIFAI_PUBLISHING=on. Refused, after resolving junctions and in any letter case: any
 * folder on C: and production's engine folder or a folder inside it.
 */
export function engineSettings(
  keys: Record<string, string>,
  dataRoot: string,
  productionRoots: readonly string[] = PRODUCTION_ENGINE_ROOTS,
): { MELLODIFAI_ENGINE_ROOT: string; WORKER_PUBLISHING: "on" | "off" } {
  const chosen = keys.MELLODIFAI_ENGINE_ROOT?.trim();
  let own: string | null = null;
  if (chosen) {
    const real = folderKey(chosen);
    const production = productionRoots.some((root) => {
      const prod = folderKey(root);
      return real === prod || real.startsWith(`${prod}\\`);
    });
    if (!production && !real.startsWith("c:")) own = resolve(chosen);
  }
  return {
    MELLODIFAI_ENGINE_ROOT: own ?? join(dataRoot, "engine"),
    WORKER_PUBLISHING:
      own && keys.MELLODIFAI_PUBLISHING?.trim().toLowerCase() === "on"
        ? "on"
        : "off",
  };
}

/**
 * What every process of the app starts from: the parent's variables without another stack's
 * keys, without RUNNER_TEMP (it would replace the runtime root) or WORKER_FAKE (fake engines),
 * and without any spelling of a
 * name set here (Windows names ignore case), then the app's own root and temp folder.
 */
export function desktopBaseEnv(
  parent: NodeJS.ProcessEnv,
  root: string,
): NodeJS.ProcessEnv {
  const temp = join(root, "tmp");
  const own: Record<string, string> = {
    MELLODIFAI_ROOT: root,
    MELLODIFAI_RUNTIME: "native",
    TEMP: temp,
    TMP: temp,
    TMPDIR: temp,
    NEXT_TELEMETRY_DISABLED: "1",
  };
  const names = new Set(Object.keys(own).map((name) => name.toUpperCase()));
  const env: NodeJS.ProcessEnv = {};
  for (const [name, value] of Object.entries(parent))
    if (
      !/^(SUPABASE_|NEXT_PUBLIC_|MDF_|TEST_|SITE_URL$|E2E_|RUNNER_TEMP$|WORKER_FAKE$)/i.test(
        name,
      ) &&
      !names.has(name.toUpperCase())
    )
      env[name] = value;
  return { ...env, ...own };
}

/**
 * The worker's own settings. Its workspaces copy fonts from MELLODIFAI_FONTS (default
 * `<data>\fonts`, which an install never has), so it gets the fonts the installer ships in
 * `<app>\fonts`; without them every song failed at its first stage with ENOENT. Its engine
 * folder and publishing switch come from engineSettings.
 */
export function workerSettings(
  app: string,
  paths: Pick<
    ReturnType<typeof desktopPaths>,
    "root" | "workerKeys" | "workerEnv"
  >,
  ownerId: string | undefined,
  engine: ReturnType<typeof engineSettings>,
  computer = process.env.COMPUTERNAME,
): Record<string, string> {
  return {
    WORKER_ID: `desktop-${computer ?? "pc"}`,
    // The worker creates its own row, owned by the owner's account.
    ...(ownerId ? { WORKER_OWNER_ID: ownerId } : {}),
    // Later files win: the stack's own keys override anything in the owner's file.
    WORKER_ENV_FILES: [paths.workerKeys, paths.workerEnv].join(";"),
    MELLODIFAI_FONTS: join(app, "fonts"),
    ...engine,
    // ComfyUI listens on one shared port and is production's: the desktop app has none.
    MELLODIFAI_LOCAL_ENGINES: "off",
    // The remake package reads its own variables; their defaults are production's folders.
    REMAKE_ENGINE_ROOT: engine.MELLODIFAI_ENGINE_ROOT,
    REMAKE_LABSE_PYTHON: join(
      paths.root,
      "venvs",
      "labse",
      "Scripts",
      "python.exe",
    ),
    REMAKE_PYTHON: "python",
    HF_HOME: join(paths.root, "cache", "hf"),
    // Video renders: temp frames and the Chrome the app names (render.mjs refuses a missing one).
    RENDER_TMP: join(paths.root, "render-tmp"),
    REMOTION_BROWSER: join(
      paths.root,
      "browsers",
      "chrome-headless-shell-win64",
      "chrome-headless-shell.exe",
    ),
    REMAKE_STEMS_PYTHON: join(
      paths.root,
      "venvs",
      "stems",
      "Scripts",
      "python.exe",
    ),
  };
}

type Secrets = { anon: string; service: string };

/** What each process gets: the web app never sees the service key. */
export function desktopEnvValues(secrets: Secrets, passwords: RolePasswords) {
  return {
    web: {
      NEXT_PUBLIC_SUPABASE_URL: API_URL,
      NEXT_PUBLIC_SUPABASE_ANON_KEY: secrets.anon,
      SUPABASE_INTERNAL_URL: API_URL,
      SITE_URL,
      MDF_WEB_DATABASE_URL: databaseUrl(
        "mdf_web",
        passwords.mdf_web,
        DESKTOP.ports.db,
      ),
    },
    worker: {
      SUPABASE_URL: API_URL,
      SUPABASE_ANON_KEY: secrets.anon,
      SUPABASE_SERVICE_ROLE_KEY: secrets.service,
    },
  };
}

export function formatEnvFile(values: Record<string, string>): string {
  for (const [key, value] of Object.entries(values))
    if (!/^[A-Z_][A-Z0-9_]*$/.test(key) || /[\r\n]/.test(value))
      throw new Error("Invalid env file entry");
  return `${Object.entries(values)
    .map(([key, value]) => `${key}=${value}`)
    .join("\n")}\n`;
}

/** KEY=value lines; comments, blanks and malformed lines are skipped. */
export function parseEnvFile(text: string): Record<string, string> {
  const values: Record<string, string> = {};
  for (const raw of text.split(/\r?\n/)) {
    const match = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/.exec(raw);
    if (!match?.[1] || raw.trimStart().startsWith("#")) continue;
    const value = match[2] ?? "";
    values[match[1]] = /^(".*"|'.*')$/.test(value) ? value.slice(1, -1) : value;
  }
  return values;
}

export async function writeDesktopEnv(
  secrets: Secrets,
  passwords: RolePasswords,
): Promise<string> {
  const paths = desktopPaths();
  const values = desktopEnvValues(secrets, passwords);
  await writePrivate(paths.webEnv, formatEnvFile(values.web));
  await writePrivate(paths.workerEnv, formatEnvFile(values.worker));
  return paths.webEnv;
}

/** Template for the owner's own keys; created once, never overwritten. */
export const WORKER_KEYS_TEMPLATE = `# MellodifAI: le tue chiavi per i servizi esterni (una per riga, NOME=valore).
# Questo file resta solo su questo PC. Dopo una modifica: Ferma MellodifAI, poi riaprilo.
# Your provider keys (one NAME=value per line). They never leave this PC.
#
# KIE_API_KEY=
# OPENROUTER_API_KEY=
#
# Motore e pubblicazione su YouTube: spenti finche' non indichi il TUO motore, con le TUE
# credenziali YouTube (mai quello della produzione). Engine and publishing, off until set:
# MELLODIFAI_ENGINE_ROOT=E:\\cartella\\del\\tuo\\motore
# MELLODIFAI_PUBLISHING=on
`;

/** The public build inputs: a change means the web app must be rebuilt. */
export function buildStamp(version: string, web: Record<string, string>) {
  return createHash("sha256")
    .update(
      JSON.stringify({
        version,
        url: web.NEXT_PUBLIC_SUPABASE_URL,
        anon: web.NEXT_PUBLIC_SUPABASE_ANON_KEY,
        site: web.SITE_URL,
      }),
    )
    .digest("hex");
}

export type DesktopProcess = "web" | "worker";

/** True only for this install's own web or worker process. */
export function isDesktopProcess(
  kind: DesktopProcess,
  commandLine: string,
  appDir: string,
): boolean {
  const line = commandLine.replaceAll("/", "\\").toLowerCase();
  // The trailing separator keeps a sibling such as "app2" from matching "app".
  const app = `${resolve(appDir).replaceAll("/", "\\").toLowerCase()}\\`;
  if (!line.includes(app)) return false;
  if (kind === "web")
    return (
      line.includes("\\next\\dist\\bin\\next") &&
      line.includes(" start") &&
      line.includes(String(WEB_PORT))
    );
  return line.includes("\\apps\\worker\\src\\main.ts");
}

/** The ports of `ports` that accept a connection on 127.0.0.1 right now. */
export async function listeningPorts(ports: number[]): Promise<number[]> {
  const open = await Promise.all(
    ports.map(
      (port) =>
        new Promise<boolean>((done) => {
          const socket = connect({ host: WEB_HOST, port });
          socket.setTimeout(2000, () => {
            socket.destroy();
            done(false);
          });
          socket.once("connect", () => {
            socket.destroy();
            done(true);
          });
          socket.once("error", () => done(false));
        }),
    ),
  );
  return ports.filter((_, index) => open[index]);
}

export class StopFailed extends Error {}

/**
 * Stops the app window, worker and web, then the stack, and succeeds only when nothing of
 * the install listens any more: an uninstall deletes the data folder after this, which must
 * never happen under a running database.
 */
export async function stopEverything(steps: {
  closeWindow: () => Promise<void>;
  killWorker: () => Promise<void>;
  killWeb: () => Promise<void>;
  stopStack: () => Promise<void>;
  listening: () => Promise<number[]>;
  clearState: () => void;
}): Promise<void> {
  await steps.closeWindow();
  await steps.killWorker();
  await steps.killWeb();
  try {
    await steps.stopStack();
  } catch (error) {
    throw new StopFailed(`stack stop: ${(error as Error).message}`);
  }
  const left = await steps.listening();
  if (left.length) throw new StopFailed(`still listening: ${left.join(", ")}`);
  steps.clearState();
}

export function backupStamp(date = new Date()): string {
  return date.toISOString().replaceAll(/[:.]/g, "-");
}

/** "desktop" is the owner's own backup (kept until he deletes it); "update" is the one every
 * update takes before its migrations (only the newest UPDATE_BACKUPS are kept). */
export type BackupKind = "desktop" | "update";
export const UPDATE_BACKUPS = 3;

export function backupFolder(
  backups: string,
  date = new Date(),
  kind: BackupKind = "desktop",
): string {
  return join(backups, `${backupStamp(date)}-${kind}`);
}

export function isBackupFolder(name: string): boolean {
  return /^\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}-\d{3}Z-(desktop|update)$/.test(
    name,
  );
}

/** Deletes the update backups beyond the newest `keep`; the owner's own backups stay. */
export function pruneUpdateBackups(
  backups: string,
  keep = UPDATE_BACKUPS,
): string[] {
  if (!existsSync(backups)) return [];
  const old = readdirSync(backups)
    .filter((name) => isBackupFolder(name) && name.endsWith("-update"))
    .sort()
    .reverse()
    .slice(keep);
  for (const name of old)
    rmSync(join(backups, name), { recursive: true, force: true });
  return old;
}

/** Bytes under `dir` (files only; links are not followed). */
export function folderBytes(dir: string): number {
  if (!existsSync(dir)) return 0;
  let total = 0;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) total += folderBytes(path);
    else if (entry.isFile()) total += statSync(path).size;
  }
  return total;
}

const GIB = 1024 ** 3;
/** A backup copies the database and every stored file: it needs their size, a fifth more for
 * the dump's own overhead, and 1 GiB left over so the PC keeps working. */
export function backupBytesNeeded(dataBytes: number): number {
  return Math.ceil(dataBytes * 1.2) + GIB;
}

export function freeBytes(dir: string): number {
  const stats = statfsSync(dir);
  return Number(stats.bavail) * Number(stats.bsize);
}

export function validOwnerEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) && email.length <= 254;
}

/** Edge (part of Windows 11) as an app window: no tabs or address bar, its own profile
 * under the data folder, so the app's sign-in never mixes with the owner's browser. */
export function appWindowArgs(url: string, profile: string): string[] {
  return [
    `--app=${url}`,
    `--user-data-dir=${profile}`,
    "--no-first-run",
    "--no-default-browser-check",
    "--disable-sync",
    "--window-size=1440,900",
  ];
}

/**
 * The one-time sign-in link goes into a local page that the app window opens, never onto
 * Edge's command line, which every program on the PC can read. The page sends the window on
 * with location.replace, so the link is not kept in its history either.
 */
export function signInPage(link: string, beacon?: string): string {
  const url = new URL(link);
  if (url.protocol !== "http:" && url.protocol !== "https:")
    throw new Error("Sign-in link must be http(s)");
  // JSON is valid JavaScript; "<" escaped so a value cannot close the script element.
  const js = (value: string) =>
    JSON.stringify(value).replaceAll("<", "\\u003c");
  // The beacon tells the controller the window has read the page, which it then deletes.
  const loaded = beacon
    ? `try{navigator.sendBeacon(${js(new URL(beacon).href)})}catch(e){}`
    : "";
  return `<!doctype html><html lang="it"><head><meta charset="utf-8"><meta name="referrer" content="no-referrer"><title>MellodifAI</title></head><body><script>${loaded}location.replace(${js(url.href)});</script></body></html>\n`;
}

/** What openBrowser writes and runs: the page with the link, and Edge's arguments naming
 * only the page's file. */
export function signInLaunch(
  link: string,
  page: string,
  profile: string,
  beacon?: string,
) {
  return {
    html: signInPage(link, beacon),
    args: appWindowArgs(pathToFileURL(page).href, profile),
  };
}

/** Free ports of the app's own block 46300-46329 (web 46300, native services 46320-46329)
 * for the sign-in check, tried in order; and how long the console waits for it. */
export const SIGN_IN_PORTS = [46301, 46302, 46303, 46304, 46305] as const;
export const SIGN_IN_WAIT_MS = 60_000;

/**
 * A one-shot loopback listener the sign-in page reports to when the app window has loaded
 * it: `loaded` is true at that report, false at the deadline. Only a POST to its own random
 * path counts.
 */
export async function signInBeacon(
  timeoutMs: number,
): Promise<{ url: string; loaded: Promise<boolean> }> {
  const path = `/${randomUUID()}`;
  let settle: (value: boolean) => void = () => {};
  const loaded = new Promise<boolean>((done) => {
    settle = done;
  });
  const server = createServer((request, response) => {
    response.setHeader("Access-Control-Allow-Origin", "*");
    response.end();
    if (request.method === "POST" && request.url === path) settle(true);
  });
  let bound = false;
  for (const port of SIGN_IN_PORTS) {
    bound = await new Promise<boolean>((done) => {
      server.once("error", () => done(false));
      server.listen(port, WEB_HOST, () => done(true));
    });
    if (bound) break;
  }
  if (!bound) throw new Error("No free sign-in check port in 46301-46305");
  const timer = setTimeout(() => settle(false), timeoutMs);
  void loaded.then(() => {
    clearTimeout(timer);
    server.close();
    server.closeAllConnections();
  });
  const { port } = server.address() as { port: number };
  return { url: `http://${WEB_HOST}:${port}${path}`, loaded };
}

/** True only for an Edge process of this install's app window (its own profile folder). */
export function isAppWindowProcess(
  commandLine: string,
  profile: string,
): boolean {
  const line = commandLine.replaceAll("/", "\\").toLowerCase();
  const dir = resolve(profile).replaceAll("/", "\\").toLowerCase();
  return (
    line.includes("msedge.exe") &&
    (line.includes(`--user-data-dir=${dir} `) ||
      line.endsWith(`--user-data-dir=${dir}`) ||
      line.includes(`--user-data-dir="${dir}"`))
  );
}

export const MSG = {
  rootOnC:
    "MellodifAI non puo' tenere i dati sul disco C:. Reinstallalo su un altro disco (per esempio E:).",
  notInstalled:
    "MellodifAI non e' installato correttamente: esegui di nuovo il programma di installazione.",
  ports: (detail: string) =>
    `Windows ha riservato una porta che serve a MellodifAI. Riavvia il PC e riprova.\n(${detail})`,
  portBusy: (port: number) =>
    `La porta ${port} e' usata da un altro programma. Chiudilo o riavvia il PC, poi riprova.`,
  components:
    "Preparo i componenti del database (solo la prima volta, 10-30 minuti, serve Internet)...",
  componentsFailed:
    "Non riesco a preparare i componenti del database. Controlla la connessione a Internet e riprova.",
  alreadyStarting:
    "MellodifAI si sta gia' avviando (per esempio all'accesso a Windows): aspetto che finisca...",
  startBusy:
    "MellodifAI si sta gia' avviando da troppo tempo. Riavvia il PC e riprova: i tuoi dati non sono stati toccati.",
  dbStarting: "Avvio il database...",
  dbFailed:
    "Il database non parte. Riprova tra un minuto; se non basta riavvia il PC. I tuoi dati non sono stati toccati.",
  building:
    "Preparo l'app (la prima volta e dopo un aggiornamento, qualche minuto)...",
  buildFailed: "Preparazione dell'app non riuscita.",
  owner: "Creo il tuo account...",
  webStarting: "Avvio l'app...",
  webFailed: "L'app non risponde.",
  workerStarting: "Avvio il motore che crea canzoni e video...",
  workerFailed:
    "Il motore delle canzoni si e' fermato: l'app si apre lo stesso, ma non crea canzoni finche' non lo sistemi.",
  workerKeys: (file: string) =>
    `Per creare canzoni servono le tue chiavi (kie, OpenRouter): aggiungile in ${file}`,
  opening: "Apro MellodifAI...",
  ready: "MellodifAI e' pronto.",
  stopping: "Spengo MellodifAI...",
  stopped: "MellodifAI e' spento. I tuoi dati sono al sicuro.",
  stopFailed:
    "MellodifAI non si e' spento del tutto. Riavvia il PC e riprova: i tuoi dati non sono stati toccati.",
  backupStart: "Salvo un backup...",
  backupDone: (dir: string) => `Backup salvato in ${dir}`,
  backupFailed: "Backup non riuscito. I tuoi dati non sono stati toccati.",
  backupNoSpace: (needGb: number, freeGb: number) =>
    `Spazio insufficiente per il backup: servono ${needGb} GB, ne restano ${freeGb}. Libera spazio sul disco e riprova: i tuoi dati non sono stati toccati.`,
  restoreNone: (dir: string) => `Non ci sono backup in ${dir}`,
  restoreDone: "Ripristino completato.",
  log: (file: string) => `Dettagli: ${file}`,
  unexpected: "Qualcosa e' andato storto.",
};
