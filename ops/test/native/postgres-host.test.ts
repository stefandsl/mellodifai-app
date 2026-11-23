import { spawn } from "node:child_process";
import { closeSync, openSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { expect, it } from "vitest";
import { pidAlive } from "../../lib/native/host.js";
import { postgresLaunch } from "../../lib/native/postgres-host.js";
import { waitFor } from "../../lib/native/processes.js";
import { realRunner } from "../../lib/run.js";
import { fixture } from "./fixtures.js";

it.skipIf(process.platform !== "win32")(
  "keeps the postmaster host alive after supervisor disconnect and forwards the child exit",
  async () => {
    const directory = fixture();
    const stop = join(directory, "stop");
    // The server runs under the restricted token: only SeChangeNotifyPrivilege is
    // left, or it exits 9 at once.
    const launch = postgresLaunch(process.execPath, [
      "-e",
      "const privileges = require('node:child_process').execFileSync(require('node:path').join(process.env.SystemRoot, 'System32', 'whoami.exe'), ['/priv', '/fo', 'csv', '/nh'], { encoding: 'utf8' }).trim().split(/\\r?\\n/); if (privileges.length !== 1) process.exit(9); setInterval(() => { if(require('node:fs').existsSync(process.env.MDF_HOST_STOP))process.exit(7); }, 50)",
    ]);
    const out = openSync(join(directory, "host.log"), "w");
    const host = spawn(launch.command, launch.args, {
      detached: true,
      windowsHide: true,
      env: { ...process.env, ...launch.env, MDF_HOST_STOP: stop },
      stdio: ["ignore", out, out, "ipc"],
    });
    closeSync(out);
    const exited = new Promise<number | null>((done) =>
      host.once("exit", done),
    );
    try {
      const pid = await new Promise<number>((done, fail) => {
        host.once("message", (message) =>
          done((message as { pid: number }).pid),
        );
        host.once("error", fail);
        host.once("exit", () =>
          fail(new Error("Host exited before identification")),
        );
      });
      expect(pid).not.toBe(host.pid);
      host.disconnect();
      await new Promise((done) => setTimeout(done, 300));
      expect(pidAlive(pid)).toBe(true);
      expect(host.exitCode).toBeNull();
      const console = await realRunner(
        "powershell.exe",
        [
          "-NoProfile",
          "-NonInteractive",
          "-Command",
          "@(Get-CimInstance Win32_Process -Filter \"Name='conhost.exe'\" | Where-Object { $_.ParentProcessId -eq [int]$env:MDF_CONSOLE_PID }).Count",
        ],
        { env: { MDF_CONSOLE_PID: String(pid) } },
      );
      expect(console.code).toBe(0);
      expect(console.stdout.trim()).toBe("1");
      writeFileSync(stop, "stop");
      expect(await exited).toBe(7);
      expect(await waitFor(async () => !pidAlive(pid), 1000, 20)).toBe(true);
    } finally {
      if (host.exitCode === null) host.kill();
      await exited;
    }
  },
  60_000,
);

it("keeps the direct server launch on non-Windows hosts", () => {
  expect(postgresLaunch("postgres", ["-D", "fixture"], "linux")).toEqual({
    command: "postgres",
    args: ["-D", "fixture"],
    ipc: false,
    env: {},
  });
});
