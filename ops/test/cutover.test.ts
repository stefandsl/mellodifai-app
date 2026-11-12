import { expect, it } from "vitest";
import { planCutover, runCutover } from "../cutover.js";
import { compareCounts } from "../lib/counts.js";

it("cutover: counts, backup, stop, render prod with project mellodifai, start, counts again, refuses on any difference", async () => {
  expect(planCutover().map((s) => s.kind)).toEqual([
    "validate",
    "stop-writers",
    "counts-before",
    "backup",
    "stop",
    "render",
    "start",
    "counts-after",
    "compare",
  ]);
  expect(planCutover().find((s) => s.kind === "render")).toMatchObject({
    projectId: "mellodifai",
    env: "prod",
  });
  const calls: string[] = [];
  await expect(
    runCutover(async (step) => {
      calls.push(step.kind);
      if (step.kind === "counts-before") return { "public.tracks": 2 };
      if (step.kind === "counts-after") return { "public.tracks": 1 };
    }),
  ).rejects.toThrow("public.tracks");
  expect(calls.at(-1)).toBe("counts-after");
});
it("compares the union of schema-qualified names, including missing empty tables", () => {
  expect(
    compareCounts(
      { "auth.a": 0, "public.a": 1 },
      { "public.a": 2, "storage.b": 0 },
    ),
  ).toEqual(["auth.a", "public.a", "storage.b"]);
  expect(compareCounts({ "public.a": 1 }, { "public.a": 1 })).toEqual([]);
});
