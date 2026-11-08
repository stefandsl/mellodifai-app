import { describe, expect, it } from "vitest";
import { run, withSignal } from "./run.js";

describe("run", () => {
  it("stops the child when the job is cancelled", async () => {
    const controller = new AbortController();
    const started = Date.now();
    const pending = withSignal(run, controller.signal)(process.execPath, [
      "-e",
      "setTimeout(() => {}, 20000)",
    ]);
    setTimeout(() => controller.abort(), 200);
    const result = await pending;
    expect(result.code).not.toBe(0);
    expect(Date.now() - started).toBeLessThan(10_000);
  });

  it("refuses to start after the cancel", async () => {
    const controller = new AbortController();
    controller.abort();
    await expect(
      run(process.execPath, ["-e", "1"], { signal: controller.signal }),
    ).rejects.toThrow(/cancelled/u);
  });

  it("bounds captured stdout while keeping its tail", async () => {
    const result = await run(process.execPath, [
      "-e",
      "process.stdout.write('x'.repeat(250000) + 'END')",
    ]);
    expect(result.code).toBe(0);
    expect(result.stdout.length).toBe(200_000);
    expect(result.stdout.endsWith("END")).toBe(true);
  });
});
