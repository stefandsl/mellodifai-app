import { spawn } from "node:child_process";
import {
  appendFileSync,
  cpSync,
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { connect } from "node:net";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  assertIsolatedConfig,
  redactE2eStderr,
  rewriteE2eConfig,
} from "./e2e-isolated-lib.mjs";

const repo = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const stack = process.env.MELLODIFAI_E2E_DIR ?? "E:\\mellodifai\\e2e-stack";
const logs = process.env.MELLODIFAI_LOGS ?? "E:\\mellodifai\\logs";
const webPort = Number(process.env.E2E_PORT ?? 3310);
const logFile = join(logs, "e2e-isolated.log");
mkdirSync(logs, { recursive: true });
const log = (text) =>
  appendFileSync(logFile, `${new Date().toISOString()} ${text}\n`);
function run(cmd, args, options = {}) {
  return new Promise((resolveRun) => {
    const child = spawn(cmd, args, {
      windowsHide: true,
      shell: /\.cmd$/iu.test(cmd),
      ...options,
    });
    let out = "";
    let err = "";
    child.stdout?.on("data", (d) => {
      out += d;
    });
    child.stderr?.on("data", (d) => {
      err += d;
    });
    child.on("close", (code) => resolveRun({ code: code ?? -1, out, err }));
    child.on("error", (error) =>
      resolveRun({ code: -1, out, err: error.message }),
    );
  });
}
function busy(port) {
  return new Promise((resolveBusy) => {
    const socket = connect({ host: "127.0.0.1", port });
    socket.once("connect", () => {
      socket.destroy();
      resolveBusy(true);
    });
    socket.once("error", () => resolveBusy(false));
  });
}
function envValues(text) {
  return Object.fromEntries(
    text
      .split(/\r?\n/u)
      .map((line) => /^\s*(\w+)\s*=\s*["']?(.*?)["']?\s*$/u.exec(line))
      .filter(Boolean)
      .map((match) => [match[1], match[2]]),
  );
}
const supabase = (args) =>
  run("npx.cmd", ["--yes", "supabase@2.122.0", ...args], { cwd: stack });
const fail = (message) => {
  log(`ERROR ${message}`);
  throw new Error(message);
};
if (process.argv.includes("--stop")) {
  const result = await supabase(["stop", "--workdir", stack]);
  log(`stop ${result.code}`);
  if (result.code) fail("Non riesco a fermare lo stack e2e.");
  process.exit(0);
}
if (!Number.isInteger(webPort) || webPort < 1 || webPort > 65535)
  fail("E2E_PORT non valido.");
if (await busy(webPort)) fail(`La porta e2e ${webPort} e' gia' in uso.`);
rmSync(join(stack, "supabase"), { recursive: true, force: true });
mkdirSync(join(stack, "supabase"), { recursive: true });
const config = rewriteE2eConfig(
  readFileSync(join(repo, "supabase", "config.toml"), "utf8"),
  webPort,
);
assertIsolatedConfig(config);
writeFileSync(join(stack, "supabase", "config.toml"), config);
for (const name of ["migrations", "seed.sql", "snippets"]) {
  const source = join(repo, "supabase", name);
  if (existsSync(source))
    cpSync(source, join(stack, "supabase", name), { recursive: true });
}
let result = await supabase(["start", "--workdir", stack]);
log(`start ${result.code} ${redactE2eStderr(result.err)}`);
if (result.code) fail("Avvio dello stack e2e non riuscito.");
result = await supabase(["db", "reset", "--workdir", stack]);
log(`reset ${result.code} ${redactE2eStderr(result.err)}`);
if (result.code) fail("Reset dello stack e2e non riuscito.");
result = await supabase(["status", "-o", "env", "--workdir", stack]);
log(`status ${result.code}`);
if (result.code) fail("Lettura dello stack e2e non riuscita.");
const values = envValues(result.out);
const anon = values.ANON_KEY ?? values.PUBLISHABLE_KEY;
const service = values.SERVICE_ROLE_KEY ?? values.SECRET_KEY;
if (!values.API_URL || !anon || !service)
  fail("Variabili dello stack e2e incomplete.");
const args = [
  "--filter",
  "@mellodifai/web",
  "e2e",
  ...process.argv.slice(2).filter((arg) => arg !== "--stop"),
];
result = await run("pnpm.cmd", args, {
  cwd: repo,
  stdio: "inherit",
  env: {
    ...process.env,
    SUPABASE_URL: values.API_URL,
    SUPABASE_ANON_KEY: anon,
    SUPABASE_SERVICE_ROLE_KEY: service,
    MAILPIT_URL: "http://127.0.0.1:45624",
    E2E_PORT: String(webPort),
    E2E_ISOLATED: "1",
  },
});
log(`playwright ${result.code}`);
process.exitCode = result.code;
