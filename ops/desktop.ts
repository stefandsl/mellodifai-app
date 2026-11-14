// MellodifAI for Windows: the one controller behind the Start-menu shortcuts.
// Usage: desktop.ts <setup|start|autostart|open|stop|status|backup|restore|update|remove-data>
// MELLODIFAI_ROOT is the install's data folder (the shortcuts set it). See docs/windows-app.md.
import { spawn } from "node:child_process";
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
import { createRequire } from "node:module";
import { connect } from "node:net";
import { dirname, join, resolve } from "node:path";
import { createInterface } from "node:readline/promises";
import { fileURLToPath } from "node:url";
import { createClient } from "@supabase/supabase-js";
import { addUser } from "./add-user.js";
import {
  API_URL,
  appWindowArgs,
  backupFolder,
  buildStamp,
  DESKTOP,
  type DesktopProcess,
  desktopPaths,
  isBackupFolder,
  isDesktopProcess,
  MSG,
  parseEnvFile,
  SITE_URL,
  validOwnerEmail,
  WEB_HOST,
  WEB_PORT,
  WORKER_KEYS_TEMPLATE,
} from "./lib/desktop.js";
import { nativeTools } from "./lib/native/build.js";
import { nativeLayout } from "./lib/native/layout.js";
import { witness } from "./lib/native/postgres.js";
import { databaseUrl, ownerConnection } from "./lib/pg.js";
import { writePrivate } from "./lib/private-file.js";
import { loadStackSecrets } from "./lib/stack-secrets.js";
import { nativeBackup } from "./native-backup.js";
import { signInLink } from "./sign-in-link.js";
import { runStack } from "./stack.js";

const app = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const webDir = join(app, "apps", "web");
const workerDir = join(app, "apps", "worker");
const P = desktopPaths();
const STAMP = join(webDir, ".next", "mellodifai-desktop-stamp");
const day = new Date().toISOString().slice(0, 10);
const logFile = (name: string) => join(P.logs, `${name}-${day}.log`);
const LOG = logFile("desktop");

class Explained extends Error {}
const fail = (message: string): never => {
  throw new Explained(message);
};
const log = (line: string) =>
  appendFileSync(LOG, `${new Date().toISOString()} ${line}\n`);
const say = (line: string) => {
  log(line);
  console.log(line);
};
const sleep = (ms: number) => new Promise((done) => setTimeout(done, ms));

type Reply = { code: number; stdout: string; stderr: string };
/** Every child process has a deadline. */
function run(
  cmd: string,
  args: string[],
  timeoutMs = 120_000,
  cwd = app,
): Promise<Reply> {
  return new Promise((done) => {
    let stdout = "";
    let stderr = "";
    const child = spawn(cmd, args, { cwd, windowsHide: true });
    const timer = setTimeout(() => {
      child.kill();
      done({ code: -1, stdout, stderr: `${stderr}timed out` });
    }, timeoutMs);
    child.stdout.setEncoding("utf8").on("data", (chunk: string) => {
      stdout += chunk;
    });
    child.stderr.setEncoding("utf8").on("data", (chunk: string) => {
      stderr += chunk;
    });
    child.on("error", (error) => {
      clearTimeout(timer);
      done({ code: -1, stdout, stderr: error.message });
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      done({ code: code ?? -1, stdout, stderr });
    });
  });
}
const powershell = (command: string) =>
  run("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", command]);

function appVersion(): string {
  const file = join(app, "VERSION");
  if (existsSync(file)) return readFileSync(file, "utf8").trim();
  return "checkout";
}

// ---- native stack ----

/** The stack runs from the app's own artifact cache under the data folder. The first start
 * downloads (or takes from MELLODIFAI_NATIVE_SEED) the pinned, checksummed components and
 * builds Auth and Storage; later starts only check that they are there. */
async function ensureComponents() {
  try {
    nativeTools();
    return;
  } catch {}
  say(MSG.components);
  try {
    await runStack("install", "desktop", { runtime: "native" });
    nativeTools();
  } catch (error) {
    log(`native install: ${(error as Error).message}`);
    fail(MSG.componentsFailed);
  }
}

/** The database exists once the native first boot completed. */
function databaseExists(): boolean {
  return existsSync(witness(nativeLayout("desktop")).done);
}

// ---- processes ----

const pidFile = (kind: DesktopProcess) => join(P.run, `${kind}.pid`);

async function desktopProcesses(kind: DesktopProcess): Promise<number[]> {
  const listed = await powershell(
    "Get-CimInstance Win32_Process -Filter \"name='node.exe'\" | ForEach-Object { '{0}|{1}' -f $_.ProcessId, $_.CommandLine }",
  );
  return listed.stdout
    .split(/\r?\n/)
    .map((line) => {
      const at = line.indexOf("|");
      return { pid: Number(line.slice(0, at)), command: line.slice(at + 1) };
    })
    .filter(
      ({ pid, command }) => pid > 0 && isDesktopProcess(kind, command, app),
    )
    .map(({ pid }) => pid);
}

async function killDesktop(kind: DesktopProcess) {
  for (const pid of await desktopProcesses(kind)) {
    log(`stopping ${kind} pid ${pid}`);
    await run("taskkill", ["/PID", String(pid), "/T", "/F"]);
  }
  rmSync(pidFile(kind), { force: true });
}

function spawnDetached(
  kind: DesktopProcess,
  args: string[],
  cwd: string,
  env: NodeJS.ProcessEnv,
): Promise<number> {
  const out = createWriteStream(logFile(kind), { flags: "a" });
  return new Promise((done, reject) => {
    out.once("error", reject);
    out.once("open", (fd) => {
      const child = spawn(process.execPath, args, {
        cwd,
        env,
        detached: true,
        windowsHide: true,
        stdio: ["ignore", fd, fd],
      });
      child.unref();
      writeFileSync(pidFile(kind), String(child.pid));
      log(`started ${kind} pid ${child.pid}`);
      done(child.pid ?? 0);
    });
  });
}

function portFree(port: number): Promise<boolean> {
  return new Promise((done) => {
    const socket = connect({ host: WEB_HOST, port });
    socket.once("connect", () => {
      socket.destroy();
      done(false);
    });
    socket.once("error", () => done(true));
  });
}

type Health = {
  web?: string;
  db?: string;
  ops?: string;
  worker_heartbeat_age_s?: number | null;
};
async function health(): Promise<Health | null> {
  try {
    const response = await fetch(`${SITE_URL}/api/health`, {
      signal: AbortSignal.timeout(5000),
    });
    return (await response.json()) as Health;
  } catch {
    return null;
  }
}
const webUp = async () => (await health())?.web === "ok";

// ---- pieces of start ----

function readEnv(path: string): Record<string, string> {
  if (!existsSync(path)) fail(MSG.dbFailed);
  return parseEnvFile(readFileSync(path, "utf8"));
}

function baseEnv(): NodeJS.ProcessEnv {
  // Never pass another stack's keys from the parent shell to our processes.
  const env: NodeJS.ProcessEnv = { ...process.env };
  for (const name of Object.keys(env))
    if (/^(SUPABASE_|NEXT_PUBLIC_|MDF_|TEST_|SITE_URL$|E2E_)/.test(name))
      delete env[name];
  const temp = join(P.root, "tmp");
  mkdirSync(temp, { recursive: true });
  return {
    ...env,
    MELLODIFAI_ROOT: P.root,
    MELLODIFAI_RUNTIME: "native",
    TEMP: temp,
    TMP: temp,
    TMPDIR: temp,
    NEXT_TELEMETRY_DISABLED: "1",
  };
}

function webEnv(): NodeJS.ProcessEnv {
  return { ...baseEnv(), ...readEnv(P.webEnv), NODE_ENV: "production" };
}

async function startStack() {
  await ensureComponents();
  say(MSG.dbStarting);
  try {
    await runStack("start", "desktop", { runtime: "native" });
  } catch (error) {
    const message = (error as Error).message;
    log(`stack start: ${message}`);
    if (/reserved|excluded/i.test(message)) fail(MSG.ports(message));
    const busy = /port (\d+) is already in use/.exec(message)?.[1];
    if (busy) fail(MSG.portBusy(Number(busy)));
    fail(MSG.dbFailed);
  }
}

/** Creates the owner's account once and returns its id, which the worker's row is owned by. */
async function ensureOwner(): Promise<string | undefined> {
  if (!existsSync(P.owner)) return undefined;
  const { email } = JSON.parse(readFileSync(P.owner, "utf8")) as {
    email: string;
  };
  const secrets = await loadStackSecrets("desktop");
  const sql = ownerConnection(
    databaseUrl("postgres", secrets.postgres, DESKTOP.ports.db),
  );
  try {
    const rows =
      await sql`select 1 from public.admin_allowlist where lower(email) = lower(${email})`;
    if (!rows.length) {
      say(MSG.owner);
      const admin = createClient(API_URL, secrets.service, {
        auth: { persistSession: false, autoRefreshToken: false },
      }).auth.admin;
      await addUser(sql, admin, email, "admin");
    }
    const [profile] =
      await sql`select id from public.profiles where lower(email) = lower(${email})`;
    return profile?.id as string | undefined;
  } finally {
    await sql.end();
  }
}

async function ensureBuild() {
  const env = webEnv();
  const stamp = buildStamp(appVersion(), env as Record<string, string>);
  const saved = existsSync(STAMP) ? readFileSync(STAMP, "utf8").trim() : "";
  if (existsSync(join(webDir, ".next", "BUILD_ID")) && saved === stamp) return;
  say(MSG.building);
  const next = createRequire(join(webDir, "package.json")).resolve(
    "next/dist/bin/next",
  );
  const out = logFile("build");
  const built = await new Promise<number>((done) => {
    const child = spawn(process.execPath, [next, "build"], {
      cwd: webDir,
      env,
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"],
    });
    const file = createWriteStream(out, { flags: "a" });
    child.stdout.pipe(file);
    child.stderr.pipe(file);
    child.on("error", () => done(-1));
    child.on("close", (code) => done(code ?? -1));
  });
  if (built !== 0) fail(`${MSG.buildFailed}\n${MSG.log(out)}`);
  writeFileSync(join(webDir, ".next", "mdf-version"), `${appVersion()}\n`);
  writeFileSync(STAMP, stamp);
}

async function ensureWeb() {
  if (await webUp()) return;
  await killDesktop("web");
  if (!(await portFree(WEB_PORT))) fail(MSG.portBusy(WEB_PORT));
  await ensureBuild();
  say(MSG.webStarting);
  const next = createRequire(join(webDir, "package.json")).resolve(
    "next/dist/bin/next",
  );
  await spawnDetached(
    "web",
    [next, "start", "--hostname", WEB_HOST, "--port", String(WEB_PORT)],
    webDir,
    webEnv(),
  );
  const until = Date.now() + 120_000;
  while (Date.now() < until) {
    await sleep(1000);
    const state = await health();
    if (state?.web === "ok" && state.db === "ok") return;
  }
  fail(`${MSG.webFailed}\n${MSG.log(logFile("web"))}`);
}

async function ensureWorker(ownerId: string | undefined) {
  if ((await desktopProcesses("worker")).length) return;
  if (!existsSync(P.workerKeys))
    await writePrivate(P.workerKeys, WORKER_KEYS_TEMPLATE);
  const keys = parseEnvFile(readFileSync(P.workerKeys, "utf8"));
  if (!Object.keys(keys).length) say(MSG.workerKeys(P.workerKeys));
  say(MSG.workerStarting);
  const tsx = createRequire(join(workerDir, "package.json")).resolve("tsx/cli");
  await spawnDetached(
    "worker",
    [tsx, join(workerDir, "src", "main.ts")],
    workerDir,
    {
      ...baseEnv(),
      WORKER_ID: `desktop-${process.env.COMPUTERNAME ?? "pc"}`,
      // The worker creates its own row, owned by the owner's account.
      ...(ownerId ? { WORKER_OWNER_ID: ownerId } : {}),
      // Later files win: the stack's own keys override anything in the owner's file.
      WORKER_ENV_FILES: [P.workerKeys, P.workerEnv].join(";"),
    },
  );
  const until = Date.now() + 90_000;
  while (Date.now() < until) {
    await sleep(3000);
    const age = (await health())?.worker_heartbeat_age_s;
    if (typeof age === "number" && age < 60) return;
    if (!(await desktopProcesses("worker")).length) break;
  }
  say(`${MSG.workerFailed}\n${MSG.log(logFile("worker"))}`);
}

function requireInstall() {
  if (!existsSync(join(app, "node_modules")) || !existsSync(webDir))
    fail(MSG.notInstalled);
}

async function start() {
  requireInstall();
  for (const dir of [P.logs, P.run, P.backups, P.config])
    mkdirSync(dir, { recursive: true });
  await startStack();
  const ownerId = await ensureOwner();
  await ensureWeb();
  await ensureWorker(ownerId);
  writeFileSync(
    P.state,
    JSON.stringify({ startedAt: new Date().toISOString() }),
  );
  say(MSG.ready);
}

function edgeExe(): string | null {
  for (const base of [
    process.env["ProgramFiles(x86)"],
    process.env.ProgramFiles,
    process.env.LOCALAPPDATA,
  ]) {
    if (!base) continue;
    const exe = join(base, "Microsoft", "Edge", "Application", "msedge.exe");
    if (existsSync(exe)) return exe;
  }
  return null;
}

async function openBrowser() {
  let target = SITE_URL;
  if (existsSync(P.owner)) {
    const { email } = JSON.parse(readFileSync(P.owner, "utf8")) as {
      email: string;
    };
    const secrets = await loadStackSecrets("desktop");
    const admin = createClient(API_URL, secrets.service, {
      auth: { persistSession: false, autoRefreshToken: false },
    }).auth.admin;
    try {
      target = await signInLink(admin, email, SITE_URL);
    } catch {
      log("sign-in link failed; opening the login page");
    }
  }
  say(MSG.opening);
  // No shell anywhere: the link carries '&', which cmd would split.
  const edge = edgeExe();
  if (edge) {
    mkdirSync(P.browser, { recursive: true });
    spawn(edge, appWindowArgs(target, P.browser), {
      detached: true,
      stdio: "ignore",
    }).unref();
    return;
  }
  spawn("rundll32.exe", ["url.dll,FileProtocolHandler", target], {
    detached: true,
    stdio: "ignore",
  }).unref();
}

// ---- commands ----

async function setup(args: string[]) {
  mkdirSync(P.config, { recursive: true });
  const given = args[args.indexOf("--email") + 1];
  let email = args.includes("--email") ? given?.trim() : undefined;
  if (!existsSync(P.owner)) {
    if (!email) {
      const rl = createInterface({
        input: process.stdin,
        output: process.stdout,
      });
      email = (
        await rl.question("La tua email (serve per il tuo account): ")
      ).trim();
      rl.close();
    }
    if (!email || !validOwnerEmail(email))
      fail("Email non valida. Riapri l'installazione e scrivila di nuovo.");
    await writePrivate(P.owner, JSON.stringify({ email: email.toLowerCase() }));
  }
  if (!existsSync(P.workerKeys))
    await writePrivate(P.workerKeys, WORKER_KEYS_TEMPLATE);
  await start();
  if (!args.includes("--no-browser")) await openBrowser();
}

async function stopStack() {
  try {
    await runStack("stop", "desktop", { runtime: "native" });
  } catch (error) {
    log(`stack stop: ${(error as Error).message}`);
  }
}

async function stop() {
  say(MSG.stopping);
  await killDesktop("worker");
  await killDesktop("web");
  if (existsSync(P.stack)) await stopStack();
  rmSync(P.state, { force: true });
  say(MSG.stopped);
}

async function status(json: boolean) {
  const state = await health();
  const result = {
    version: appVersion(),
    url: SITE_URL,
    web: state?.web === "ok",
    db: state?.db === "ok",
    worker:
      typeof state?.worker_heartbeat_age_s === "number" &&
      state.worker_heartbeat_age_s < 60,
    root: P.root,
  };
  if (json) console.log(JSON.stringify(result));
  else {
    console.log(`MellodifAI ${result.version}  ${result.url}`);
    console.log(`App: ${result.web ? "accesa" : "spenta"}`);
    console.log(`Database: ${result.db ? "acceso" : "spento"}`);
    console.log(`Motore canzoni: ${result.worker ? "acceso" : "spento"}`);
    console.log(`Dati: ${result.root}`);
  }
}

/** A verified native bundle (database dump, every stored file, checksums, manifest last).
 * Writers stop for the dump; the stack starts again afterwards, the app if it was on. */
async function backup(): Promise<string> {
  if (!databaseExists()) fail(MSG.backupFailed);
  say(MSG.backupStart);
  const dir = backupFolder(P.backups);
  const wasOn = await webUp();
  await killDesktop("worker");
  await killDesktop("web");
  try {
    await nativeBackup(["backup", "--env", "desktop", dir]);
  } catch (error) {
    log(`backup: ${(error as Error).message}`);
    fail(MSG.backupFailed);
  }
  say(MSG.backupDone(dir));
  if (wasOn) await start();
  return dir;
}

function backups(): string[] {
  if (!existsSync(P.backups)) return [];
  return readdirSync(P.backups)
    .filter(
      (name) =>
        isBackupFolder(name) &&
        existsSync(join(P.backups, name, "manifest.json")),
    )
    .sort()
    .reverse();
}

async function restore(args: string[]) {
  const all = backups();
  const named = args.find((arg) => !arg.startsWith("--"));
  let dir = named ? resolve(named) : null;
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  try {
    if (!dir) {
      if (!all.length) fail(MSG.restoreNone(P.backups));
      console.log("Backup disponibili (il piu' recente e' il numero 1):");
      for (const [index, name] of all.slice(0, 15).entries())
        console.log(`  ${index + 1}) ${name}`);
      const choice = Number(
        await rl.question("Numero del backup da ripristinare: "),
      );
      const picked = all[choice - 1];
      if (!picked) fail("Numero non valido. Nessuna modifica fatta.");
      dir = join(P.backups, picked as string);
    }
    if (!existsSync(join(dir, "manifest.json")))
      fail("Cartella di backup non valida.");
    console.log(
      `Ripristino ${dir}.\nTutto quello che hai creato dopo quel backup viene sostituito (prima salvo comunque lo stato attuale).`,
    );
    const answer = args.includes("--yes")
      ? "SI"
      : await rl.question("Scrivi SI per continuare: ");
    if (answer.trim().toUpperCase() !== "SI")
      fail("Annullato. Nessuna modifica fatta.");
  } finally {
    rl.close();
  }
  await killDesktop("worker");
  await killDesktop("web");
  say("Ripristino database e file...");
  // Saves the current state first and puts it back by itself if anything fails.
  try {
    await nativeBackup(["restore", "--env", "desktop", dir as string]);
  } catch (error) {
    log(`restore: ${(error as Error).message}`);
    fail(
      "Ripristino non riuscito: i tuoi dati di prima sono stati rimessi a posto.",
    );
  }
  await start();
  say(MSG.restoreDone);
}

async function update() {
  // The installer has just replaced the app files. Back up the data before the new
  // release's first start applies its migrations.
  await killDesktop("worker");
  await killDesktop("web");
  if (databaseExists()) {
    await stopStack();
    await backup();
  }
  await start();
}

async function removeData(args: string[]) {
  if (!args.includes("--yes"))
    fail("Serve --yes: elimina database e file di MellodifAI.");
  // Everything lives in the data folder, which the uninstaller deletes next: here only
  // every process that holds files in it is stopped.
  await stop();
}

async function main(argv: string[]) {
  const [command = "start", ...args] = argv;
  mkdirSync(P.logs, { recursive: true });
  switch (command) {
    case "setup":
      return setup(args);
    case "start":
      await start();
      if (!args.includes("--no-browser")) await openBrowser();
      return;
    case "autostart":
      return start();
    case "open":
      if (!(await webUp())) await start();
      return openBrowser();
    case "stop":
      return stop();
    case "status":
      return status(args.includes("--json"));
    case "backup":
      await backup();
      return;
    case "restore":
      return restore(args);
    case "update":
      await update();
      if (!args.includes("--no-browser")) await openBrowser();
      return;
    case "remove-data":
      return removeData(args);
    default:
      fail(`Comando sconosciuto: ${command}`);
  }
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
)
  main(process.argv.slice(2)).catch((error: unknown) => {
    const explained = error instanceof Explained;
    try {
      log(
        `ERROR ${explained ? (error as Error).message : ((error as Error)?.stack ?? String(error))}`,
      );
    } catch {}
    console.error(
      `\n${explained ? (error as Error).message : MSG.unexpected}\n${MSG.log(LOG)}`,
    );
    process.exitCode = 1;
  });
