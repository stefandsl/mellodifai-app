import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { runtimeRoot } from "../lib/runtime.js";
import {
  backupTag,
  planRestore,
  restoreDatabase,
  runRestore,
} from "../restore.js";
import { planStackCommand } from "../stack.js";

const backup = "E:/mellodifai/backups/2026-11-02T22-00-00-000Z-m1-floor.sql";
describe("restore", () => {
  it("takes a safety backup, checks out the backup tag, resets without seed, imports, reapplies passwords and deploys without migrations", () => {
    expect(planRestore(backup).map((s) => s.kind)).toEqual([
      "validate",
      "stop",
      "backup",
      "checkout",
      "reset",
      "import",
      "passwords",
      "deploy",
    ]);
    expect(backupTag(backup)).toBe("m1-floor");
    expect(planRestore(backup).at(-1)).toMatchObject({
      target: "m1-floor",
      skipMigrations: true,
    });
  });
  it("never runs stop --no-backup and refuses a forged restore flag", () => {
    expect(JSON.stringify(planRestore(backup))).not.toContain("--no-backup");
    expect(() =>
      planStackCommand("reset", "prod", { restore: true } as never),
    ).toThrow();
    expect(() =>
      planStackCommand("stop", "prod", { noBackup: true }),
    ).toThrow();
    expect(typeof restoreDatabase).toBe("function");
  });
  it("validates the migration floor before stopping writers or resetting and stops on failure", async () => {
    const calls: string[] = [];
    await expect(
      runRestore(backup, async (step) => {
        calls.push(step.kind);
        throw new Error("below floor");
      }),
    ).rejects.toThrow("below floor");
    expect(calls).toEqual(["validate"]);
  });
  it("rejects malformed, ambiguous and pre-floor revision filenames", () => {
    for (const path of [
      "x.sql",
      "2026-11-02T22-00-00-000Z-main.sql",
      "2026-11-02T22-00-00-000Z-m1-floor.sql.bak",
    ])
      expect(() => backupTag(path)).toThrow();
  });
  it("accepts only the legacy backup in the runtime backup directory", () => {
    expect(
      backupTag(
        join(runtimeRoot(), "backups/2026-11-03-task-33-pre-cutover.sql"),
      ),
    ).toBe("m1-floor");
    expect(() =>
      backupTag(join(runtimeRoot(), "tmp/2026-11-03-task-33-pre-cutover.sql")),
    ).toThrow();
  });
});

it("uses a database-only reset target and disables seed without permitting a public restore flag", () => {
  const command = planStackCommand("reset", "e2e", {})[0];
  expect(command).toContain("--no-seed");
  expect(
    command?.some(
      (value) =>
        value.startsWith("--remote=postgresql:") && value.includes(":45622/"),
    ),
  ).toBe(true);
});
