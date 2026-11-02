import { expect, it } from "vitest";
import { realRunner } from "../lib/run.js";
import { probe } from "../probe.js";

it("reports the e2e Studio port as open from a container", async () => {
  const env = process.env.CI === "true" ? "ci" : "e2e";
  const port = env === "ci" ? 54323 : 45623;
  const result = await probe(env, realRunner);
  expect(result.ok).toBe(false);
  expect(result.failures).toContain(`${port}: open`);
  expect(
    result.failures.filter((failure) => failure.startsWith("postgres:")),
  ).toEqual([]);
}, 180_000);
