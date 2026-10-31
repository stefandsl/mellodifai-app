import { readFile } from "node:fs/promises";
import { expect, it } from "vitest";

it("requires production Google OAuth before worker setup", async () => {
  const readme = await readFile(
    new URL("../../../README.md", import.meta.url),
    "utf8",
  );
  const requirement =
    "Google Cloud OAuth consent screen set to In production (Testing tokens expire after 7 days and publishing stops)";
  expect(readme).toContain(requirement);
  expect(readme.indexOf(requirement)).toBeLessThan(
    readme.indexOf("Configure the worker environment locally"),
  );
});
