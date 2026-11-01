// Pure helpers of the local launcher: no processes, no network, so they are unit tested.
import { createHash } from "node:crypto";
import { join } from "node:path";

export const HOST = "127.0.0.1";
export const PORT = 3210;
export const APP_URL = `http://${HOST}:${PORT}`;
export const MAILPIT_URL = "http://127.0.0.1:54324";

export function paths(
  dataRoot = process.env.MELLODIFAI_DATA_ROOT ?? "E:\\mellodifai",
) {
  const state = join(dataRoot, "local");
  return {
    dataRoot,
    logs: join(dataRoot, "logs"),
    backups: join(dataRoot, "backup"),
    state,
    run: join(state, "run"),
    supabaseEnv: join(state, "supabase.env"),
    workerEnv: join(state, "worker.env"),
  };
}

// Reads KEY="value" lines as printed by `supabase status -o env`.
export function parseEnv(text) {
  const values = {};
  for (const raw of text.split(/\r?\n/u)) {
    const match =
      /^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/u.exec(raw);
    if (!match) continue;
    let value = match[2].trim();
    if (/^(".*"|'.*')$/u.test(value)) value = value.slice(1, -1);
    values[match[1]] = value;
  }
  return values;
}

export function formatEnv(values) {
  return `${Object.entries(values)
    .map(([key, value]) => `${key}=${value}`)
    .join("\n")}\n`;
}

// The local keys the web app and the worker need, from `supabase status -o env`.
export function localKeys(status) {
  const url = status.API_URL;
  const anon = status.ANON_KEY ?? status.PUBLISHABLE_KEY;
  const service = status.SERVICE_ROLE_KEY ?? status.SECRET_KEY;
  if (!url || !anon || !service) return null;
  const host = new URL(url).hostname;
  if (!["127.0.0.1", "localhost"].includes(host)) return null;
  return { url, anon, service };
}

// Keys from the worker override files that must not leak into the generated file.
const SUPABASE_KEYS = new Set([
  "SUPABASE_URL",
  "SUPABASE_SERVICE_ROLE_KEY",
  "SUPABASE_ANON_KEY",
  "DATABASE_URL",
]);

// Keeps only the owner's own worker settings (id, owner, caps) out of an old .env.local.
export function workerOverrides(values) {
  return Object.fromEntries(
    Object.entries(values).filter(([key]) => !SUPABASE_KEYS.has(key)),
  );
}

// Later files win in the worker's loadSecrets, so the generated local keys go last.
export function workerEnvFiles(candidates, exists) {
  return candidates.filter((file) => file && exists(file));
}

// `supabase migration list --local -o json` rows: what is pending and what the DB has that the
// code does not know (a newer checkout applied it).
// `supabase migration list --local` prints JSON or a markdown table depending on the CLI build.
export function parseMigrationList(text) {
  const start = text.indexOf("{");
  if (start >= 0) {
    try {
      return JSON.parse(text.slice(start)).migrations ?? [];
    } catch {}
  }
  const rows = [];
  for (const line of text.split(/\r?\n/u)) {
    const m = /^\s*`\s*(\d*)\s*`\s*\|\s*`\s*(\d*)\s*`\s*\|/u.exec(line);
    if (m) rows.push({ local: m[1], remote: m[2] });
  }
  return rows.length ? rows : null;
}

export function classifyMigrations(rows) {
  const pending = rows
    .filter((row) => row.local && !row.remote)
    .map((row) => row.local);
  const unknown = rows
    .filter((row) => row.remote && !row.local)
    .map((row) => row.remote);
  return { pending, unknown };
}

export function buildStamp({ head, dirty, publicEnv }) {
  return createHash("sha256")
    .update(JSON.stringify({ head, dirty, publicEnv }))
    .digest("hex");
}

export function isBuildStale({ hasBuild, savedStamp, stamp }) {
  return !hasBuild || savedStamp !== stamp;
}

export function backupFolderName(date = new Date()) {
  const pad = (n) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}_${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}`;
}

// A restore must target the same schema the backup was taken from.
export function restoreCheck(manifestMigrations, codeMigrations) {
  const code = new Set(codeMigrations);
  const missing = manifestMigrations.filter((m) => !code.has(m));
  return missing.length ? { ok: false, missing } : { ok: true, missing: [] };
}

export const MSG = {
  dockerMissing:
    "Docker Desktop non e' installato. Installalo da docker.com, poi riprova.",
  dockerStarting: "Avvio Docker Desktop (puo' richiedere un paio di minuti)...",
  dockerTimeout:
    "Docker non si avvia: apri Docker Desktop dal menu Start, aspetta che dica 'Running' e riprova.",
  dbStarting: "Avvio il database...",
  dbFailed:
    "Il database non parte. Riavvia Docker Desktop e riprova. Dettagli nel file di log indicato sotto.",
  migrations: (n) => `Aggiorno il database (${n} aggiornamenti)...`,
  migrationsNewer:
    "Il database e' piu' recente di questa versione dell'app: lo lascio com'e'.",
  migrationsFailed:
    "Aggiornamento del database non riuscito. I tuoi dati non sono stati toccati. Manda il file di log a chi ti assiste.",
  building:
    "Preparo l'app (solo la prima volta o dopo un aggiornamento, qualche minuto)...",
  buildFailed:
    "Preparazione dell'app non riuscita. Manda il file di log a chi ti assiste.",
  webStarting: "Avvio l'app...",
  webFailed: "L'app non risponde. Chiudi con 'Ferma Mellodifai' e riprova.",
  portBusy: (port) =>
    `La porta ${port} e' gia' usata da un altro programma. Chiudilo o riavvia il PC e riprova.`,
  workerStarting: "Avvio il motore che crea le canzoni...",
  workerFailed:
    "Il motore delle canzoni si e' fermato. L'app si apre lo stesso, ma le canzoni non vengono create. Dettagli nel log.",
  workerElsewhere: "Il motore delle canzoni e' gia' acceso.",
  alreadyRunning: "Mellodifai e' gia' acceso: apro il browser.",
  opening: "Apro Mellodifai nel browser...",
  done: "Fatto. Puoi chiudere questa finestra.",
  stopping: "Spengo Mellodifai...",
  stopped: "Mellodifai e' spento. I tuoi dati sono al sicuro.",
  backupStart: "Esporto il backup...",
  backupDone: (dir) => `Backup salvato in ${dir}`,
  backupFailed:
    "Backup non riuscito. Controlla che Mellodifai sia acceso e che il disco E: abbia spazio.",
  log: (file) => `Log: ${file}`,
};
