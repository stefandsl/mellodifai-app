import { expect, it } from "vitest";
import { realRunner } from "../lib/run.js";
import { probe } from "../probe.js";

it("reports the private Studio port as open from a container", async () => {
  const dbPort = new URL(process.env.TEST_DB_URL ?? "").port;
  const env =
    process.env.CI === "true" ? "ci" : dbPort === "55322" ? "dev" : "e2e";
  if (env !== "ci" && !["45622", "55322"].includes(dbPort))
    throw new Error("Expected a private test database");
  const port = env === "ci" ? 54323 : env === "dev" ? 55323 : 45623;
  const result = await probe(env, realRunner);
  expect(result.ok).toBe(false);
  expect(result.failures).toContain(`${port}: open`);
  expect(result.failures).toContain(`${port}: host 127.0.0.1 open`);
  expect(
    result.failures.filter((failure) => failure.startsWith("postgres:")),
  ).toEqual([]);
}, 180_000);
