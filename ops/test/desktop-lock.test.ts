import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { expect, it } from "vitest";
import { oneAtATime } from "../lib/desktop-lock.js";

const sleep = (ms: number) => new Promise((done) => setTimeout(done, ms));

it.skipIf(process.platform !== "win32")(
  "runs two starts of the same install one after the other, never together",
  async () => {
    const root = mkdtempSync(
      join(process.env.TEMP ?? "E:/mellodifai/tmp", "mdf-start-lock-"),
    );
    const lock = join(root, "start.lease");
    const events: string[] = [];
    const start = (name: string) =>
      oneAtATime(lock, async () => {
        events.push(`${name} in`);
        await sleep(1500);
        events.push(`${name} out`);
      });
    try {
      await Promise.all([start("logon"), start("icon")]);
      expect(events).toHaveLength(4);
      // Whoever got in first left before the other came in.
      expect(events[1]).toBe(events[0]?.replace(" in", " out"));
      expect(events[3]).toBe(events[2]?.replace(" in", " out"));
      // A start that failed releases the lock for the next one.
      await expect(
        oneAtATime(lock, async () => {
          throw new Error("boom");
        }),
      ).rejects.toThrow("boom");
      expect(await oneAtATime(lock, async () => "next", 5000)).toBe("next");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  },
  60_000,
);
