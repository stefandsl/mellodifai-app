// Pure pieces of the Windows desktop app (docs/windows-app.md): paths, the env files the
// web app and worker read, process recognition, backups and the owner's messages.
// No processes or network here, so all of it is unit tested.
import { createHash } from "node:crypto";
import { join, resolve } from "node:path";
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

/**
 * The worker's own settings. Its workspaces copy fonts from MELLODIFAI_FONTS (default
 * `<data>\fonts`, which an install never has), so it gets the fonts the installer ships in
 * `<app>\fonts`; without them every song failed at its first stage with ENOENT.
 */
export function workerSettings(
  app: string,
  paths: Pick<ReturnType<typeof desktopPaths>, "workerKeys" | "workerEnv">,
  ownerId: string | undefined,
  computer = process.env.COMPUTERNAME,
): Record<string, string> {
  return {
    WORKER_ID: `desktop-${computer ?? "pc"}`,
    // The worker creates its own row, owned by the owner's account.
    ...(ownerId ? { WORKER_OWNER_ID: ownerId } : {}),
    // Later files win: the stack's own keys override anything in the owner's file.
    WORKER_ENV_FILES: [paths.workerKeys, paths.workerEnv].join(";"),
    MELLODIFAI_FONTS: join(app, "fonts"),
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
  const app = resolve(appDir).replaceAll("/", "\\").toLowerCase();
  if (!line.includes(app)) return false;
  if (kind === "web")
    return (
      line.includes("\\next\\dist\\bin\\next") &&
      line.includes(" start") &&
      line.includes(String(WEB_PORT))
    );
  return line.includes("\\apps\\worker\\src\\main.ts");
}

export function backupStamp(date = new Date()): string {
  return date.toISOString().replaceAll(/[:.]/g, "-");
}

export function backupFolder(backups: string, date = new Date()): string {
  return join(backups, `${backupStamp(date)}-desktop`);
}

export function isBackupFolder(name: string): boolean {
  return /^\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}-\d{3}Z-desktop$/.test(name);
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
  backupStart: "Salvo un backup...",
  backupDone: (dir: string) => `Backup salvato in ${dir}`,
  backupFailed: "Backup non riuscito. I tuoi dati non sono stati toccati.",
  restoreNone: (dir: string) => `Non ci sono backup in ${dir}`,
  restoreDone: "Ripristino completato.",
  log: (file: string) => `Dettagli: ${file}`,
  unexpected: "Qualcosa e' andato storto.",
};
