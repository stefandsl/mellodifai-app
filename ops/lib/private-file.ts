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

/** Establish permissions before placing secret bytes in a file. */
export async function writePrivate(
  path: string,
  content: string,
): Promise<void> {
  runtimePath(path);
  mkdirSync(dirname(path), { recursive: true });
  if (!existsSync(path)) closeSync(openSync(path, "wx", 0o600));
  if (process.platform === "win32") {
    const user = process.env.USERNAME;
    if (!user) throw new Error("USERNAME is required for private file ACLs");
    const result = await realRunner("icacls", [
      path,
      "/inheritance:r",
      "/grant:r",
      `${user}:F`,
    ]);
    if (result.code !== 0) throw new Error("Cannot secure private file ACL");
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
