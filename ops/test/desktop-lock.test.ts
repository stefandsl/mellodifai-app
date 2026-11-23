import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { expect, it } from "vitest";
import { oneAtATime, StartBusy } from "../lib/desktop-lock.js";

const sleep = (ms: number) => new Promise<void>((done) => setTimeout(done, ms));

it.skipIf(process.platform !== "win32")(
  "runs two starts of the same install one after the other and tells the second it waits",
  async () => {
    const root = mkdtempSync(
      join(process.env.TEMP ?? "E:/mellodifai/tmp", "mdf-start-lock-"),
    );
    const lock = join(root, "start.lease");
    const events: string[] = [];
    // Every try starts a PowerShell helper, which under load takes longer than any fixed
    // sleep: the logon start holds the lock until the icon start says it waits.
    const iconWaits = async () => {
      const deadline = Date.now() + 40_000;
      while (!events.includes("icon waits") && Date.now() < deadline)
        await sleep(50);
    };
    const start = (name: string, hold: () => Promise<void>) =>
      oneAtATime(
        lock,
        async () => {
          events.push(`${name} in`);
          await hold();
          events.push(`${name} out`);
        },
        { onWait: () => events.push(`${name} waits`) },
      );
    try {
      await Promise.all([
        start("logon", iconWaits),
        sleep(300).then(() => start("icon", () => sleep(100))),
      ]);
      // The icon click came second: it said it waits, then ran after the logon start left.
      expect(events).toEqual([
        "logon in",
        "icon waits",
        "logon out",
        "icon in",
        "icon out",
      ]);
      // A start that failed releases the lock for the next one.
      await expect(
        oneAtATime(lock, async () => {
          throw new Error("boom");
        }),
      ).rejects.toThrow("boom");
      expect(await oneAtATime(lock, async () => "next")).toBe("next");
      // Still held at the deadline: a StartBusy, never a generic error.
      // The holder takes the lock through a PowerShell helper too, so wait until it is
      // inside, and keep it there until the late start was refused.
      let entered = () => {};
      const inside = new Promise<void>((done) => {
        entered = done;
      });
      let release = () => {};
      const released = new Promise<void>((done) => {
        release = done;
      });
      const holder = oneAtATime(lock, async () => {
        entered();
        await released;
      });
      await inside;
      try {
        await expect(
          oneAtATime(lock, async () => "late", { timeoutMs: 500 }),
        ).rejects.toBeInstanceOf(StartBusy);
      } finally {
        release();
        await holder;
      }
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  },
  60_000,
);
