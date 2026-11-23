import { spawn } from "node:child_process";
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
  });
});

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
