import { fileURLToPath } from "node:url";

const launcher = fileURLToPath(
  new URL("../../native/restricted.ps1", import.meta.url),
);

/** One argument quoted the way the Microsoft C runtime splits a command line. */
export function windowsArgument(value: string): string {
  if (value && !/[\s"]/u.test(value)) return value;
  return `"${value.replace(/(\\*)"/gu, '$1$1\\"').replace(/(\\+)$/u, "$1$1")}"`;
}

/**
 * On Windows, run the command under a restricted token, as pg_ctl does for
 * PostgreSQL: the Administrators and Power Users groups are deny-only and every
 * privilege is dropped. PostgreSQL refuses an administrator token, so without
 * this it cannot start from an elevated terminal or a CI runner. The command
 * keeps the standard handles and gets its own hidden console; the launcher
 * exits with the command's exit code. With `reportPid`, the command's stdout goes to the launcher's
 * stderr and the launcher's stdout carries only the command's pid.
 */
export function restrictedLaunch(
  command: string,
  args: string[],
  options: { reportPid?: boolean } = {},
  platform: NodeJS.Platform = process.platform,
): { command: string; args: string[]; env: Record<string, string> } {
  if (platform !== "win32") return { command, args, env: {} };
  return {
    command: "powershell.exe",
    args: [
      "-NoProfile",
      "-NonInteractive",
      "-ExecutionPolicy",
      "Bypass",
      "-File",
      launcher,
    ],
    env: {
      MDF_RESTRICTED_COMMAND: [command, ...args].map(windowsArgument).join(" "),
      ...(options.reportPid ? { MDF_RESTRICTED_REPORT_PID: "1" } : {}),
    },
  };
}
