// Temporary CI diagnostic: which spawn context makes the lease helper hang?
import { spawn } from "node:child_process";
import { closeSync, mkdirSync, openSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";

const [mode, variant] = process.argv.slice(2);
const helper = resolve("ops/native/lease.ps1");
const root = join(process.env.RUNNER_TEMP ?? process.env.TEMP, "lease-diag");
mkdirSync(root, { recursive: true });

if (mode === "child") {
  const started = Date.now();
  const child = spawn(
    "powershell.exe",
    ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-File", helper,
      "-Path", join(root, `${variant}.lease`), "-Command", "supervisor",
      "-OwnerPid", String(process.pid), "-TimeoutMs", "5000"],
    { windowsHide: true, stdio: ["pipe", "pipe", "pipe"] },
  );
  let errors = "";
  child.stderr.on("data", (d) => { errors += d; });
  child.stdout.on("data", (d) => {
    console.log(`stdout ${JSON.stringify(String(d))} after ${Date.now() - started} ms`);
    child.stdin.end("release\n");
  });
  child.on("exit", (code) => {
    console.log(`helper exit ${code} after ${Date.now() - started} ms; stderr ${JSON.stringify(errors.slice(0, 800))}`);
    process.exit(0);
  });
  setTimeout(() => {
    console.log(`helper silent for 25000 ms; stderr ${JSON.stringify(errors.slice(0, 800))}`);
    child.kill();
    process.exit(0);
  }, 25_000);
} else {
  const keep = ["SystemRoot", "SystemDrive", "windir", "ComSpec", "PATHEXT", "NUMBER_OF_PROCESSORS",
    "PROCESSOR_ARCHITECTURE", "USERNAME", "USERPROFILE", "HOME", "LANG"];
  const minimal = {};
  for (const k of keep) if (process.env[k]) minimal[k] = process.env[k];
  const tmp = join(root, "tmp");
  Object.assign(minimal, { PATH: process.env.PATH, TEMP: tmp, TMP: tmp, TMPDIR: tmp,
    APPDATA: join(tmp, "appdata"), LOCALAPPDATA: join(tmp, "localappdata"), RUNNER_TEMP: process.env.RUNNER_TEMP });
  for (const [name, detached, env] of [
    ["attached-full", false, process.env],
    ["attached-minimal", false, minimal],
    ["detached-full", true, process.env],
    ["detached-minimal", true, minimal],
  ]) {
    const file = join(root, `${name}.log`);
    const out = openSync(file, "w");
    const child = spawn(process.execPath, [process.argv[1], "child", name], {
      detached, stdio: ["ignore", out, out], windowsHide: true, env,
    });
    closeSync(out);
    await new Promise((done) => child.once("exit", done));
    console.log(`${name}: ${readFileSync(file, "utf8").trim()}`);
  }
}
