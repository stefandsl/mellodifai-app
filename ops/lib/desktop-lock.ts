// One `start` at a time per desktop install. The logon autostart and a click on the icon can
// run together; without this both see no worker and each spawns one. The lock is an OS file
// lock held by a helper process (lib/native/lease.ts): it is released when its holder exits,
// so a crashed start never blocks the next one.
import { acquireLease } from "./native/lease.js";

/** The other start still held the lock at the deadline. */
export class StartBusy extends Error {}

export async function oneAtATime<T>(
  path: string,
  work: () => Promise<T>,
  options: { timeoutMs?: number; onWait?: () => void } = {},
): Promise<T> {
  const timeoutMs = options.timeoutMs ?? 20 * 60_000;
  // A start that lost its helper keeps going: the worst case is the old race, not a dead app.
  const take = (ms: number) =>
    acquireLease(path, "desktop-start", ms, () => {});
  let release: () => Promise<void>;
  try {
    release = await take(250);
  } catch {
    // Another start holds it: say so once, then wait for it.
    options.onWait?.();
    try {
      release = await take(timeoutMs);
    } catch (error) {
      throw new StartBusy((error as Error).message);
    }
  }
  try {
    return await work();
  } finally {
    await release();
  }
}
