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
 * On Windows, run the command under a restricted token: the Administrators and
 * Power Users groups are deny-only and every privilege is dropped, as pg_ctl
 * does for PostgreSQL. Its children (PostgreSQL among them) inherit that token,
 * so the stack starts from an elevated terminal or a CI runner too. The launcher
 * keeps the standard handles and exits with the command's exit code.
 *
 * `detached` is the spawn option for a command that must outlive its caller.
 * Windows PowerShell started without a console exits at once, so the launcher
 * runs attached and starts the command detached itself.
 */
export function restrictedLaunch(
  command: string,
  args: string[],
  platform: NodeJS.Platform = process.platform,
): {
  command: string;
  args: string[];
  env: Record<string, string>;
  detached: boolean;
} {
  if (platform !== "win32") return { command, args, env: {}, detached: true };
  return {
    detached: false,
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
    },
  };
}
