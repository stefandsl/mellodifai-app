import { spawn, spawnSync } from "node:child_process";
import {
  closeSync,
  mkdirSync,
  mkdtempSync,
  openSync,
  readFileSync,
  rmSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it } from "vitest";
import {
  restrictedLaunch,
  windowsArgument,
} from "../../lib/native/restricted.js";

function run(command: string, args: string[]) {
  const launch = restrictedLaunch(command, args);
  return new Promise<{ code: number | null; stdout: string; stderr: string }>(
    (resolve, reject) => {
      const child = spawn(launch.command, launch.args, {
        env: { ...process.env, ...launch.env },
        stdio: ["ignore", "pipe", "pipe"],
        windowsHide: true,
      });
      let stdout = "";
      let stderr = "";
      child.stdout.on("data", (chunk: Buffer) => {
        stdout += chunk.toString();
      });
      child.stderr.on("data", (chunk: Buffer) => {
        stderr += chunk.toString();
      });
      child.once("error", reject);
      child.once("close", (code) => resolve({ code, stdout, stderr }));
    },
  );
}

it("quotes arguments the way the C runtime splits them", () => {
  expect(windowsArgument("plain")).toBe("plain");
  expect(windowsArgument("")).toBe('""');
  expect(windowsArgument("C:\\Program Files\\node.exe")).toBe(
    '"C:\\Program Files\\node.exe"',
  );
  expect(windowsArgument('say "hi"')).toBe('"say \\"hi\\""');
  expect(windowsArgument("dir with space\\")).toBe('"dir with space\\\\"');
});

it("leaves other platforms unchanged", () => {
  expect(restrictedLaunch("node", ["a b"], "linux")).toEqual({
    command: "node",
    args: ["a b"],
    env: {},
    detached: true,
  });
});

it.runIf(process.platform === "win32")(
  "gives the command a default DACL of the user and SYSTEM, so it can open the pipes it creates",
  async () => {
    // An elevated token's default DACL grants Administrators, which the restricted
    // token denies: tsx's esbuild pipe then breaks with EPIPE. A file created in a
    // folder that passes no rules down takes the token's default DACL.
    const root = mkdtempSync(
      join(process.env.TEMP ?? tmpdir(), "mdf-restricted-dacl-"),
    );
    try {
      const whoami = join(
        process.env.SystemRoot ?? "C:\\Windows",
        "System32",
        "whoami.exe",
      );
      const user = spawnSync(whoami, ["/user", "/fo", "csv", "/nh"], {
        encoding: "utf8",
      })
        .stdout.trim()
        .split(",")[1]
        ?.replaceAll('"', "");
      expect(user).toMatch(/^S-1-5-/u);
      const folder = join(root, "plain");
      mkdirSync(folder);
      const grant = spawnSync(
        "icacls",
        [folder, "/inheritance:r", "/grant:r", `*${user}:(F)`],
        { encoding: "utf8" },
      );
      expect(grant.status, grant.stderr).toBe(0);
      const file = join(folder, "made.txt");
      const made = await run(process.execPath, [
        "-e",
        `require("node:fs").writeFileSync(${JSON.stringify(file)}, "x")`,
      ]);
      expect(made.code, made.stderr).toBe(0);
      const acl = spawnSync(
        "powershell.exe",
        [
          "-NoProfile",
          "-NonInteractive",
          "-Command",
          "[System.IO.File]::GetAccessControl($env:MDF_FILE).GetAccessRules($true, $true, [System.Security.Principal.SecurityIdentifier]) | ForEach-Object { $_.IdentityReference.Value }",
        ],
        { encoding: "utf8", env: { ...process.env, MDF_FILE: file } },
      );
      expect(acl.status, acl.stderr).toBe(0);
      expect(acl.stdout.split(/\s+/u).filter(Boolean).sort()).toEqual(
        ["S-1-5-18", user].sort(),
      );
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  },
  60_000,
);

it.runIf(process.platform === "win32")(
  "runs a command that writes to a log file, spawned the way the stack starts its supervisor",
  async () => {
    // A detached Windows PowerShell has no console and exits 0 before the script runs.
    const root = mkdtempSync(
      join(process.env.TEMP ?? tmpdir(), "mdf-restricted-"),
    );
    try {
      const log = join(root, "out.log");
      const out = openSync(log, "w");
      const launch = restrictedLaunch(process.execPath, [
        "-e",
        "console.log('child ran'); console.error('child error'); process.exit(5)",
      ]);
      const child = spawn(launch.command, launch.args, {
        detached: launch.detached,
        stdio: ["ignore", out, out],
        windowsHide: true,
        env: { ...process.env, ...launch.env },
      });
      closeSync(out);
      const code = await new Promise<number | null>((resolve) =>
        child.once("exit", resolve),
      );
      expect(readFileSync(log, "utf8")).toMatch(/child ran\r?\nchild error/u);
      expect(code).toBe(5);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  },
  60_000,
);

it.runIf(process.platform === "win32")(
  "runs the command with every privilege dropped, its arguments intact and its exit code",
  async () => {
    // Privilege names are not translated: SeChangeNotifyPrivilege is the only one
    // a restricted token keeps. An unrestricted token always holds more.
    const privileges = await run("whoami", ["/priv", "/fo", "csv", "/nh"]);
    expect(privileges.code, privileges.stderr).toBe(0);
    const names = privileges.stdout
      .split(/\r?\n/u)
      .map((line) => line.split(",")[0]?.replaceAll('"', ""))
      .filter(Boolean);
    expect(names).toEqual(["SeChangeNotifyPrivilege"]);

    const args = ["a b", 'q"uote', "trail\\", "", "-flag"];
    const echo = await run(process.execPath, [
      "-e",
      "process.stdout.write(JSON.stringify(process.argv.slice(1))); process.exit(7)",
      ...args,
    ]);
    expect(echo.stderr).toBe("");
    expect(JSON.parse(echo.stdout)).toEqual(args);
    expect(echo.code).toBe(7);
  },
  60_000,
);
