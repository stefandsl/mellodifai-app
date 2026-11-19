// One `start` at a time per desktop install. The logon autostart and a click on the icon can
// run together; without this both see no worker and each spawns one. The lock is an OS file
// lock held by a helper process (lib/native/lease.ts): it is released when its holder exits,
// so a crashed start never blocks the next one.
import { acquireLease } from "./native/lease.js";

export async function oneAtATime<T>(
  path: string,
  work: () => Promise<T>,
  timeoutMs = 20 * 60_000,
): Promise<T> {
  // A start that lost its helper keeps going: the worst case is the old race, not a dead app.
  const release = await acquireLease(
    path,
    "desktop-start",
    timeoutMs,
    () => {},
  );
  try {
    return await work();
  } finally {
    await release();
  }
}
