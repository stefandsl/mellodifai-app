import { randomUUID } from "node:crypto";
import {
  chmodSync,
  closeSync,
  existsSync,
  linkSync,
  mkdirSync,
  openSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { dirname } from "node:path";
import { runtimePath } from "./envs.js";
import { realRunner } from "./run.js";

/** Replace the DACL and owner on Windows with the current user only.
 * Runs atomically via .NET SetAccessControl so elevated sessions (which default
 * new-object ownership to BUILTIN\Administrators and materialize explicit
 * CREATOR OWNER grants) never leave extra grants or a non-user owner behind. */
export async function secureWindowsOwnerOnly(
  path: string,
  directory: boolean,
): Promise<void> {
  const secType = directory
    ? "System.Security.AccessControl.DirectorySecurity"
    : "System.Security.AccessControl.FileSecurity";
  const ioType = directory ? "System.IO.Directory" : "System.IO.File";
  const inherit = directory ? "ContainerInherit,ObjectInherit" : "None";
  const script =
    `$ErrorActionPreference='Stop'; ` +
    `$user=[Security.Principal.WindowsIdentity]::GetCurrent().User; ` +
    `$sec=New-Object ${secType}; ` +
    `$sec.SetOwner($user); ` +
    `$sec.SetAccessRuleProtection($true,$false); ` +
    `$sec.SetAccessRule((New-Object System.Security.AccessControl.FileSystemAccessRule($user,'FullControl','${inherit}','None','Allow'))); ` +
    `[${ioType}]::SetAccessControl($env:MDF_PRIVATE_PATH,$sec)`;
  const result = await realRunner(
    "powershell.exe",
    ["-NoProfile", "-NonInteractive", "-Command", script],
    { env: { MDF_PRIVATE_PATH: path } },
  );
  if (result.code !== 0)
    throw new Error(
      directory
        ? "Cannot secure the log folder ACL"
        : "Cannot secure private file ACL",
    );
}

/** Establish permissions before placing secret bytes in a file. */
export async function writePrivate(
  path: string,
  content: string,
): Promise<void> {
  runtimePath(path);
  mkdirSync(dirname(path), { recursive: true });
  if (!existsSync(path)) closeSync(openSync(path, "wx", 0o600));
  if (process.platform === "win32") {
    await secureWindowsOwnerOnly(path, false);
  } else chmodSync(path, 0o600);
  writeFileSync(path, content, { encoding: "utf8", mode: 0o600 });
}

/** Publish a complete private file once. A hard link makes the no-overwrite
 * operation atomic on both NTFS and POSIX; concurrent readers never see an empty
 * reservation file while its ACL is being set.
 */
export async function writePrivateOnce(
  path: string,
  content: string,
): Promise<void> {
  runtimePath(path);
  if (existsSync(path)) return;
  const temp = `${path}.${randomUUID()}.tmp`;
  try {
    await writePrivate(temp, content);
    try {
      linkSync(temp, path);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
    }
  } finally {
    if (existsSync(temp)) unlinkSync(temp);
  }
}
