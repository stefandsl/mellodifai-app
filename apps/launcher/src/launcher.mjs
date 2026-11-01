// Mellodifai local launcher: start, stop, backup and restore the app on the owner's PC.
// Usage: node launcher.mjs start | stop | status | backup [--json] | restore [folder]
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import {
  appendFileSync,
  createWriteStream,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { connect } from "node:net";
import { dirname, join, resolve } from "node:path";
import { createInterface } from "node:readline/promises";
import { fileURLToPath } from "node:url";
import {
  APP_URL,
  backupFolderName,
  buildStamp,
  classifyMigrations,
  formatEnv,
  HOST,
  isBuildStale,
  localKeys,
  MAILPIT_URL,
  MSG,
  PORT,
  parseEnv,
  parseMigrationList,
  paths,
  restoreCheck,
  secretValues,
  workerEnvFiles,
  workerOverrides,
} from "./lib.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const repo = resolve(here, "..", "..", "..");
const webDir = join(repo, "apps", "web");
const workerDir = join(repo, "apps", "worker");
const P = paths();
// Tests point this at a scratch Supabase project; the owner never sets it.
const supaDir = process.env.MELLODIFAI_SUPABASE_WORKDIR ?? repo;
const SUPABASE_CLI = ["--yes", "supabase@2.122.0"];
const DOCKER_DESKTOP = "C:\\Program Files\\Docker\\Docker\\Docker Desktop.exe";
const projectId =
  /^project_id\s*=\s*"([^"]+)"/mu.exec(
    readFileSync(join(supaDir, "supabase", "config.toml"), "utf8"),
  )?.[1] ?? "mellodifai";
const DB_CONTAINER = `supabase_db_${projectId}`;
const STORAGE_CONTAINER = `supabase_storage_${projectId}`;

for (const dir of [P.logs, P.run, P.backups])
  mkdirSync(dir, { recursive: true });
const today = new Date().toISOString().slice(0, 10);
const logFile = (name) => join(P.logs, `${name}-${today}.log`);
const LAUNCHER_LOG = logFile("launcher");
let secrets = [];
const redact = (text) =>
  secrets.reduce((out, s) => out.split(s).join("***"), String(text));
const log = (line) =>
  appendFileSync(LAUNCHER_LOG, `${new Date().toISOString()} ${redact(line)}\n`);
let jsonMode = false;
const say = (line) => {
  log(line);
  if (!jsonMode) console.log(line);
};

class Explained extends Error {}
const fail = (message) => {
  throw new Explained(message);
};

function run(
  cmd,
  args,
  { cwd = repo, env = process.env, timeout = 600_000, input } = {},
) {
  return new Promise((done) => {
    const shell = /\.cmd$/iu.test(cmd);
    const child = spawn(cmd, args, { cwd, env, shell, windowsHide: true });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (d) => {
      stdout += d;
    });
    child.stderr.on("data", (d) => {
      stderr += d;
    });
    if (input) child.stdin.end(input);
    const timer = setTimeout(() => child.kill(), timeout);
    child.on("error", (error) => {
      clearTimeout(timer);
      done({ code: -1, stdout, stderr: `${stderr}${error.message}` });
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      done({ code: code ?? -1, stdout, stderr });
    });
  });
}

const supabase = (args, opts) =>
  run("npx.cmd", [...SUPABASE_CLI, ...args], { cwd: supaDir, ...opts });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function httpOk(url) {
  try {
    const res = await fetch(url, {
      redirect: "manual",
      signal: AbortSignal.timeout(5000),
    });
    return res.status < 500;
  } catch {
    return false;
  }
}

function portInUse(port) {
  return new Promise((done) => {
    const socket = connect({ host: HOST, port });
    socket.once("connect", () => {
      socket.destroy();
      done(true);
    });
    socket.once("error", () => done(false));
  });
}

const pidFile = (name) => join(P.run, `${name}.pid`);
function readPid(name) {
  try {
    return Number(readFileSync(pidFile(name), "utf8").trim()) || null;
  } catch {
    return null;
  }
}
async function alive(pid) {
  if (!pid) return false;
  const { stdout } = await run("tasklist", [
    "/FI",
    `PID eq ${pid}`,
    "/FO",
    "CSV",
    "/NH",
  ]);
  return /"node\.exe"/iu.test(stdout);
}
async function killTree(name) {
  const pid = readPid(name);
  if (pid && (await alive(pid))) {
    log(`stopping ${name} pid ${pid}`);
    await run("taskkill", ["/PID", String(pid), "/T", "/F"]);
  }
  rmSync(pidFile(name), { force: true });
}

function spawnDetached(name, args, cwd, env) {
  const out = createWriteStream(logFile(name), { flags: "a" });
  return new Promise((done) => {
    out.once("open", (fd) => {
      const child = spawn(process.execPath, args, {
        cwd,
        env,
        detached: true,
        windowsHide: true,
        stdio: ["ignore", fd, fd],
      });
      child.unref();
      writeFileSync(pidFile(name), String(child.pid));
      log(`started ${name} pid ${child.pid}`);
      done(child.pid);
    });
  });
}

function openBrowser() {
  spawn("cmd", ["/c", "start", '""', APP_URL], {
    detached: true,
    windowsHide: true,
    stdio: "ignore",
  }).unref();
}

// ---- pieces ----

async function ensureDocker() {
  if ((await run("docker", ["info"], { timeout: 30_000 })).code === 0) return;
  if (!existsSync(DOCKER_DESKTOP)) fail(MSG.dockerMissing);
  say(MSG.dockerStarting);
  spawn(DOCKER_DESKTOP, [], { detached: true, stdio: "ignore" }).unref();
  const until = Date.now() + 240_000;
  while (Date.now() < until) {
    await sleep(5000);
    if ((await run("docker", ["info"], { timeout: 30_000 })).code === 0) return;
  }
  fail(MSG.dockerTimeout);
}

async function supabaseKeys() {
  const status = await supabase(["status", "-o", "env"], { timeout: 120_000 });
  if (status.code !== 0) return null;
  const values = parseEnv(status.stdout);
  // Every key, secret and password the CLI prints stays out of the logs.
  secrets = [...new Set([...secrets, ...secretValues(values)])].sort(
    (a, b) => b.length - a.length,
  );
  return localKeys(values);
}

async function ensureSupabase() {
  let keys = await supabaseKeys();
  if (!keys) {
    say(MSG.dbStarting);
    // stdout of `supabase start` prints the keys, so only stderr is logged.
    const started = await supabase(["start"], { timeout: 900_000 });
    keys = await supabaseKeys();
    log(`supabase start exit ${started.code}\n${started.stderr}`);
    if (!keys) fail(MSG.dbFailed);
  }
  writeFileSync(
    P.supabaseEnv,
    formatEnv({
      SUPABASE_URL: keys.url,
      SUPABASE_SERVICE_ROLE_KEY: keys.service,
      SUPABASE_ANON_KEY: keys.anon,
    }),
  );
  return keys;
}

async function applyMigrations() {
  const list = await supabase(["migration", "list", "--local"], {
    timeout: 120_000,
  });
  const rows = list.code === 0 ? parseMigrationList(list.stdout) : null;
  if (!rows) {
    log(`migration list failed: ${list.stdout}
${list.stderr}`);
    fail(MSG.migrationsFailed);
  }
  const { pending, unknown } = classifyMigrations(rows);
  if (unknown.length) {
    say(MSG.migrationsNewer);
    log(`database has migrations unknown to this code: ${unknown.join(", ")}`);
    return;
  }
  if (!pending.length) return;
  say(MSG.migrations(pending.length));
  await backup({ label: "prima-aggiornamento", storage: false });
  const up = await supabase(["migration", "up", "--local", "--include-all"], {
    timeout: 600_000,
  });
  log(`migration up exit ${up.code}\n${up.stdout}\n${up.stderr}`);
  if (up.code !== 0) fail(MSG.migrationsFailed);
}

function webEnv(keys) {
  return {
    ...process.env,
    NODE_ENV: "production",
    NEXT_TELEMETRY_DISABLED: "1",
    NEXT_PUBLIC_SUPABASE_URL: keys.url,
    NEXT_PUBLIC_SUPABASE_ANON_KEY: keys.anon,
    NEXT_PUBLIC_SITE_URL: APP_URL,
    MAILPIT_URL,
    MELLODIFAI_LAUNCHER: fileURLToPath(import.meta.url),
  };
}

async function currentStamp(keys) {
  const git = (args) =>
    run("git", args, { timeout: 60_000 }).then((r) => r.stdout);
  const scope = ["--", "apps/web", "packages/shared"];
  const head = (await git(["rev-parse", "HEAD"])).trim();
  const dirty = createHash("sha256")
    .update(await git(["status", "--porcelain", ...scope]))
    .update(await git(["diff", "HEAD", ...scope]))
    .digest("hex");
  return buildStamp({
    head,
    dirty,
    publicEnv: [keys.url, keys.anon, APP_URL].join("|"),
  });
}

const NEXT = join(webDir, "node_modules", "next", "dist", "bin", "next");
const STAMP = join(webDir, ".next", "mellodifai-stamp.txt");

async function ensureBuild(keys) {
  const stamp = await currentStamp(keys);
  const savedStamp = existsSync(STAMP)
    ? readFileSync(STAMP, "utf8").trim()
    : null;
  const hasBuild = existsSync(join(webDir, ".next", "BUILD_ID"));
  if (!isBuildStale({ hasBuild, savedStamp, stamp })) return;
  say(MSG.building);
  const built = await run(process.execPath, [NEXT, "build"], {
    cwd: webDir,
    env: webEnv(keys),
    timeout: 1_800_000,
  });
  appendFileSync(
    logFile("build"),
    redact(`${built.stdout}\n${built.stderr}\n`),
  );
  if (built.code !== 0)
    fail(`${MSG.buildFailed}\n${MSG.log(logFile("build"))}`);
  writeFileSync(STAMP, stamp);
}

async function ensureWeb(keys) {
  if (await httpOk(`${APP_URL}/login`)) return;
  if (await portInUse(PORT)) fail(MSG.portBusy(PORT));
  await ensureBuild(keys);
  say(MSG.webStarting);
  await spawnDetached(
    "web",
    [NEXT, "start", "--hostname", HOST, "--port", String(PORT)],
    webDir,
    webEnv(keys),
  );
  const until = Date.now() + 120_000;
  while (Date.now() < until) {
    await sleep(1000);
    if (await httpOk(`${APP_URL}/login`)) return;
  }
  fail(`${MSG.webFailed}\n${MSG.log(logFile("web"))}`);
}

function workerFiles() {
  const home = process.env.USERPROFILE ?? "C:\\Users\\Asus";
  return workerEnvFiles(
    [
      join(home, "Documents", "Claude", "Projects", "ita", ".env"),
      join(home, "Documents", "suno-remake", "publish", ".env"),
      P.workerEnv,
      P.supabaseEnv,
    ],
    existsSync,
  );
}

// A worker started by hand (or from another checkout) also counts: never run two.
async function otherWorker() {
  const r = await run("powershell", [
    "-NoProfile",
    "-Command",
    "Get-CimInstance Win32_Process -Filter \"name='node.exe'\" | Where-Object { $_.CommandLine -match 'tsx.*src[\\/]main.ts' -and $_.CommandLine -notmatch 'preflight' } | ForEach-Object { $_.ProcessId }",
  ]);
  return r.stdout.split(/\s+/u).filter(Boolean).map(Number);
}

async function ensureWorker() {
  if (await alive(readPid("worker"))) return true;
  if ((await otherWorker()).length) {
    say(MSG.workerElsewhere);
    return true;
  }
  say(MSG.workerStarting);
  const tsx = join(workerDir, "node_modules", "tsx", "dist", "cli.mjs");
  const env = { ...process.env, WORKER_ENV_FILES: workerFiles().join(";") };
  const pid = await spawnDetached(
    "worker",
    [tsx, "src/main.ts"],
    workerDir,
    env,
  );
  await sleep(10_000);
  if (await alive(pid)) return true;
  say(`${MSG.workerFailed}\n${MSG.log(logFile("worker"))}`);
  return false;
}

// ---- commands ----

async function isUp() {
  return (
    (await httpOk(`${APP_URL}/login`)) &&
    ((await alive(readPid("worker"))) || (await otherWorker()).length > 0)
  );
}

async function start() {
  if (await isUp()) {
    say(MSG.alreadyRunning);
    openBrowser();
    return;
  }
  await ensureDocker();
  const keys = await ensureSupabase();
  await applyMigrations();
  await ensureWeb(keys);
  await ensureWorker();
  say(MSG.opening);
  openBrowser();
  say(MSG.done);
}

async function stop() {
  say(MSG.stopping);
  await killTree("worker");
  await killTree("web");
  if ((await run("docker", ["info"], { timeout: 30_000 })).code === 0) {
    const stopped = await supabase(["stop"], { timeout: 300_000 });
    log(`supabase stop exit ${stopped.code}\n${stopped.stderr}`);
  }
  say(MSG.stopped);
}

async function status() {
  const web = await httpOk(`${APP_URL}/login`);
  const worker =
    (await alive(readPid("worker"))) || (await otherWorker()).length > 0;
  const db =
    (
      await run("docker", ["inspect", "-f", "{{.State.Running}}", DB_CONTAINER])
    ).stdout.trim() === "true";
  console.log(`Database: ${db ? "acceso" : "spento"}`);
  console.log(`App (${APP_URL}): ${web ? "accesa" : "spenta"}`);
  console.log(`Motore canzoni: ${worker ? "acceso" : "spento"}`);
}

function dockerToFile(args, file) {
  return new Promise((done) => {
    const out = createWriteStream(file);
    const child = spawn("docker", args, {
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stderr = "";
    child.stdout.pipe(out);
    child.stderr.on("data", (d) => {
      stderr += d;
    });
    child.on("close", (code) =>
      out.end(() => done({ code: code ?? -1, stderr })),
    );
  });
}

async function dbMigrations() {
  const r = await run("docker", [
    "exec",
    DB_CONTAINER,
    "psql",
    "-U",
    "supabase_admin",
    "-d",
    "postgres",
    "-tAc",
    "select version from supabase_migrations.schema_migrations order by version",
  ]);
  if (r.code !== 0) fail(MSG.backupFailed);
  return r.stdout.split(/\r?\n/u).filter(Boolean);
}

const DATA_DUMP = [
  "pg_dump",
  "-U",
  "supabase_admin",
  "-d",
  "postgres",
  "--data-only",
  "--schema=public",
  "--schema=auth",
  "--schema=storage",
  "--exclude-table=auth.schema_migrations",
  "--exclude-table=storage.migrations",
];

async function backup({ label = "", storage = true } = {}) {
  const running = (
    await run("docker", ["inspect", "-f", "{{.State.Running}}", DB_CONTAINER])
  ).stdout.trim();
  if (running !== "true") fail(MSG.backupFailed);
  const dir = join(P.backups, backupFolderName() + (label ? `_${label}` : ""));
  mkdirSync(dir, { recursive: true });
  if (!label) say(MSG.backupStart);
  const full = await dockerToFile(
    [
      "exec",
      DB_CONTAINER,
      "pg_dump",
      "-U",
      "supabase_admin",
      "-d",
      "postgres",
      "-Fc",
    ],
    join(dir, "database-completo.dump"),
  );
  const data = await dockerToFile(
    ["exec", DB_CONTAINER, ...DATA_DUMP],
    join(dir, "dati.sql"),
  );
  log(
    `backup pg_dump exit ${full.code}/${data.code} ${full.stderr}${data.stderr}`,
  );
  if (full.code !== 0 || data.code !== 0) fail(MSG.backupFailed);
  if (storage) {
    const cp = await run(
      "docker",
      ["cp", `${STORAGE_CONTAINER}:/mnt/.`, join(dir, "file")],
      { timeout: 1_800_000 },
    );
    log(`backup storage exit ${cp.code} ${cp.stderr}`);
    if (cp.code !== 0) fail(MSG.backupFailed);
  }
  writeFileSync(
    join(dir, "manifest.json"),
    JSON.stringify(
      {
        createdAt: new Date().toISOString(),
        projectId,
        storage,
        migrations: await dbMigrations(),
      },
      null,
      2,
    ),
  );
  if (!label) say(MSG.backupDone(dir));
  return dir;
}

function codeMigrations() {
  return readdirSync(join(supaDir, "supabase", "migrations"))
    .map((f) => /^(\d+)_/u.exec(f)?.[1])
    .filter(Boolean);
}

async function restore(chosen) {
  const all = readdirSync(P.backups)
    .filter((d) => existsSync(join(P.backups, d, "manifest.json")))
    .sort()
    .reverse();
  let dir = chosen ? resolve(chosen) : null;
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  if (!dir) {
    if (!all.length) fail(`Non ci sono backup in ${P.backups}`);
    console.log("Backup disponibili:");
    for (const [i, d] of all.slice(0, 15).entries())
      console.log(`  ${i + 1}) ${d}`);
    const n = Number(await rl.question("Numero del backup da ripristinare: "));
    if (!all[n - 1]) fail("Numero non valido. Nessuna modifica fatta.");
    dir = join(P.backups, all[n - 1]);
  }
  const manifest = JSON.parse(readFileSync(join(dir, "manifest.json"), "utf8"));
  const check = restoreCheck(manifest.migrations, codeMigrations());
  if (!check.ok)
    fail(
      "Questo backup viene da una versione dell'app piu' recente: aggiorna l'app prima di ripristinarlo. Nessuna modifica fatta.",
    );
  console.log(
    `Ripristino ${dir}. Tutto quello creato dopo questo backup verra' sostituito.`,
  );
  console.log("Prima salvo comunque un backup dello stato attuale.");
  const answer =
    process.env.MELLODIFAI_RESTORE_CONFIRM ??
    (await rl.question("Scrivi SI per continuare: "));
  rl.close();
  if (answer.trim().toUpperCase() !== "SI")
    fail("Annullato. Nessuna modifica fatta.");
  await ensureDocker();
  await ensureSupabase();
  const safety = await backup({ label: "prima-ripristino" });
  say(`Stato attuale salvato in ${safety}`);
  await killTree("worker");
  await killTree("web");
  say("Ricreo il database...");
  const reset = await supabase(["db", "reset", "--local", "--no-seed"], {
    timeout: 900_000,
  });
  log(`db reset exit ${reset.code}\n${reset.stdout}\n${reset.stderr}`);
  if (reset.code !== 0)
    fail(
      "Ripristino non riuscito durante la ricreazione del database. Il backup di sicurezza e' in " +
        safety,
    );
  say("Carico i dati...");
  const truncate = `do $$ declare r record; begin for r in select schemaname, tablename from pg_tables where schemaname in ('public','auth','storage') and tablename not in ('schema_migrations','migrations') loop execute format('truncate table %I.%I cascade', r.schemaname, r.tablename); end loop; end $$;`;
  const sql = `set session_replication_role = replica;\n${truncate}\n${readFileSync(join(dir, "dati.sql"), "utf8")}`;
  const load = await run(
    "docker",
    [
      "exec",
      "-i",
      DB_CONTAINER,
      "psql",
      "-U",
      "supabase_admin",
      "-d",
      "postgres",
      "-v",
      "ON_ERROR_STOP=1",
      "-q",
      "-f",
      "-",
    ],
    { input: sql, timeout: 1_800_000 },
  );
  log(`restore psql exit ${load.code}\n${load.stderr}`);
  if (load.code !== 0)
    fail(
      "Caricamento dei dati non riuscito. Il backup di sicurezza e' in " +
        safety,
    );
  if (manifest.storage && existsSync(join(dir, "file"))) {
    say("Copio i file...");
    await run("docker", [
      "exec",
      STORAGE_CONTAINER,
      "sh",
      "-c",
      "rm -rf /mnt/*",
    ]);
    const cp = await run(
      "docker",
      ["cp", `${join(dir, "file")}${"\\."}`, `${STORAGE_CONTAINER}:/mnt/`],
      { timeout: 1_800_000 },
    );
    log(`restore storage exit ${cp.code} ${cp.stderr}`);
    if (cp.code !== 0)
      fail(
        `Copia dei file non riuscita. Il backup di sicurezza e' in ${safety}`,
      );
  }
  await applyMigrations();
  say("Ripristino completato. Avvia Mellodifai con l'icona sul desktop.");
}

// One-time setup: the owner's worker settings and the desktop shortcuts.
async function install() {
  const legacy = join(workerDir, ".env.local");
  if (!existsSync(P.workerEnv) && existsSync(legacy)) {
    writeFileSync(
      P.workerEnv,
      formatEnv(workerOverrides(parseEnv(readFileSync(legacy, "utf8")))),
    );
    say(`Impostazioni del motore copiate in ${P.workerEnv}`);
  }
  const icon = join(webDir, "app", "favicon.ico");
  const shortcuts = [
    ["Mellodifai", "Mellodifai.cmd", "Apri Mellodifai"],
    ["Ferma Mellodifai", "Ferma Mellodifai.cmd", "Spegni Mellodifai"],
    [
      "Esporta backup Mellodifai",
      "Esporta backup.cmd",
      "Salva un backup su E:",
    ],
  ];
  const ps = shortcuts
    .map(
      ([name, target, description]) =>
        `$s=$w.CreateShortcut((Join-Path $d '${name}.lnk'));$s.TargetPath='${join(repo, target)}';$s.WorkingDirectory='${repo}';$s.IconLocation='${icon}';$s.Description='${description}';$s.Save()`,
    )
    .join(";");
  const r = await run("powershell", [
    "-NoProfile",
    "-Command",
    `$w=New-Object -ComObject WScript.Shell;$d=[Environment]::GetFolderPath('Desktop');${ps};Write-Output $d`,
  ]);
  if (r.code !== 0)
    fail(`Non riesco a creare i collegamenti sul desktop.
${r.stderr}`);
  say(
    `Collegamenti creati sul desktop (${r.stdout.trim()}): ${shortcuts.map((s) => s[0]).join(", ")}`,
  );
}

const [command = "start", ...rest] = process.argv.slice(2);
jsonMode = rest.includes("--json");
const commands = {
  start,
  stop,
  install,
  status,
  backup: async () => {
    const dir = await backup();
    if (jsonMode) console.log(JSON.stringify({ ok: true, dir }));
  },
  restore: () => restore(rest.find((a) => !a.startsWith("--"))),
};
try {
  if (!commands[command]) fail(`Comando sconosciuto: ${command}`);
  await commands[command]();
} catch (error) {
  const explained = error instanceof Explained;
  log(`ERROR ${error?.stack ?? error}`);
  const message = explained
    ? error.message
    : "Qualcosa e' andato storto. Manda il file di log a chi ti assiste.";
  if (jsonMode) console.log(JSON.stringify({ ok: false, error: message }));
  else console.error(`\n${message}\n${MSG.log(LAUNCHER_LOG)}`);
  process.exitCode = 1;
}
