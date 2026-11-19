import { describe, expect, it, vi } from "vitest";
import { localEngines, localEnginesOn } from "../src/main.js";

describe("local engines switched off (desktop app)", () => {
  it("reads MELLODIFAI_LOCAL_ENGINES=off and nothing else as off", () => {
    expect(localEnginesOn({ MELLODIFAI_LOCAL_ENGINES: "off" })).toBe(false);
    expect(localEnginesOn({})).toBe(true);
  });

  it("never creates a ComfyUI supervisor and lists no local engine", async () => {
    const makeSupervisor = vi.fn(() => {
      throw new Error("must not touch ComfyUI");
    });
    const published: unknown[] = [];
    const lines: string[] = [];
    const local = await localEngines({
      on: false,
      fake: false,
      makeSupervisor,
      publish: async (check) => {
        published.push(await check?.());
      },
      report: (line) => lines.push(line),
    });
    expect(makeSupervisor).not.toHaveBeenCalled();
    expect(local.comfy).toBeUndefined();
    expect(published).toEqual([{}]);
    expect(lines.join("\n")).toContain("local engines off");
    await local.stop();
  });
});
