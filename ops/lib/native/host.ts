import { randomUUID } from "node:crypto";
import { readFileSync, rmSync, statfsSync, writeFileSync } from "node:fs";
import { connect } from "node:net";
import { join, parse } from "node:path";
import { type Runner, realRunner } from "../run.js";

/** Everything that differs between operating systems lives here; the rest of
 * the native runtime stays free of platform checks.
 */
export interface ProcessIdentity {
  pid: number;
  /** Creation time as the host reports it; stable for the life of the pid. */
  startedAt: string;
}

const WINDOWS_QUERY =
  "$ErrorActionPreference='Stop'; $ids=$env:MDF_PIDS -split ',' | ForEach-Object { [int]$_ }; Get-CimInstance Win32_Process | Where-Object { $ids -contains $_.ProcessId } | ForEach-Object { '{0} {1}' -f $_.ProcessId, $_.CreationDate.ToUniversalTime().ToString('o') }";

/** Identity of each live pid in the list. A pid that is gone is absent. */
export async function processIdentities(
  pids: number[],
  runner: Runner = realRunner,
  platform: NodeJS.Platform = process.platform,
): Promise<Map<number, ProcessIdentity>> {
  const wanted = [...new Set(pids)].filter(
    (pid) => Number.isInteger(pid) && pid > 0,
  );
  const found = new Map<number, ProcessIdentity>();
  if (wanted.length === 0) return found;
  const result =
    platform === "win32"
      ? await runner(
          "powershell.exe",
          ["-NoProfile", "-NonInteractive", "-Command", WINDOWS_QUERY],
          { env: { MDF_PIDS: wanted.join(",") } },
        )
      : await runner("ps", ["-o", "pid=,lstart=", "-p", wanted.join(",")]);
  // ps exits 1 when none of the pids exist; that is an empty answer.
  if (result.code !== 0 && (platform === "win32" || result.stdout.trim()))
    throw new Error("Cannot read the host process table");
  for (const line of result.stdout.split(/\r?\n/)) {
    const match = /^\s*(\d+)\s+(\S.*?)\s*$/.exec(line);
    if (match)
      found.set(Number(match[1]), {
        pid: Number(match[1]),
        startedAt: match[2] as string,
      });
  }
  return found;
}

/** True only when the recorded pid is still the same process. A reused pid
 * has a different creation time and is never touched.
 */
export async function sameProcess(
  recorded: ProcessIdentity,
  runner: Runner = realRunner,
): Promise<boolean> {
  const live = (await processIdentities([recorded.pid], runner)).get(
    recorded.pid,
  );
  return live?.startedAt === recorded.startedAt;
}

export function pidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === "EPERM";
  }
}

/** End one verified process and the children it started. Windows has no
 * signal a console service can catch, so this is a hard stop there; stateful
 * services (PostgreSQL) are shut down through their own tool instead.
 */
export async function terminateTree(
  recorded: ProcessIdentity,
  runner: Runner = realRunner,
  platform: NodeJS.Platform = process.platform,
): Promise<void> {
  if (!(await sameProcess(recorded, runner))) return;
  if (platform === "win32") {
    await runner("taskkill", ["/PID", String(recorded.pid), "/T", "/F"]);
  } else {
    try {
      process.kill(recorded.pid, "SIGTERM");
    } catch {
      return;
    }
  }
  for (let attempt = 0; attempt < 100; attempt++) {
    if (!pidAlive(recorded.pid)) return;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  if (platform !== "win32" && (await sameProcess(recorded, runner)))
    process.kill(recorded.pid, "SIGKILL");
  if (await sameProcess(recorded, runner))
    throw new Error(`Process ${recorded.pid} did not stop`);
}

export function portOpen(port: number, timeoutMs = 1000): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = connect({ host: "127.0.0.1", port });
    const done = (open: boolean) => {
      socket.destroy();
      resolve(open);
    };
    socket.setTimeout(timeoutMs, () => done(false));
    socket.once("connect", () => done(true));
    socket.once("error", () => done(false));
  });
}

export const executable = (
  name: string,
  platform: NodeJS.Platform = process.platform,
) => (platform === "win32" ? `${name}.exe` : name);

const MIN_SYSTEM_FREE = 20 * 1024 ** 3;

/** The owner's standing rule: stop when the Windows system volume is nearly
 * full, because a full C: takes the whole machine down with it.
 */
export function assertSystemDiskFree(
  platform: NodeJS.Platform = process.platform,
  free: (path: string) => number = (path) => {
    const stats = statfsSync(path);
    return stats.bavail * stats.bsize;
  },
): void {
  if (platform !== "win32") return;
  const drive = parse(process.env.SystemRoot ?? "C:\\Windows").root;
  if (free(drive) < MIN_SYSTEM_FREE)
    throw new Error(
      `Native stack refused: ${drive} has less than 20 GB free`,
    );
}

/** Storage keeps object metadata in NTFS alternate data streams on Windows.
 * Refuse a volume that cannot hold them before any object is written there.
 */
export function assertObjectMetadataSupport(
  directory: string,
  platform: NodeJS.Platform = process.platform,
): void {
  if (platform !== "win32") return;
  const probe = join(directory, `.mdf-stream-probe-${randomUUID()}`);
  try {
    writeFileSync(probe, "");
    writeFileSync(`${probe}:mdf.probe`, "ok");
    if (readFileSync(`${probe}:mdf.probe`, "utf8") !== "ok") throw new Error();
  } catch {
    throw new Error(
      `Native Storage needs an NTFS volume for object metadata; ${directory} does not support alternate data streams`,
    );
  } finally {
    rmSync(probe, { force: true });
  }
}
