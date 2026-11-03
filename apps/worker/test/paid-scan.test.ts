import { readdir, readFile } from "node:fs/promises";
import { join, relative } from "node:path";
import { expect, it } from "vitest";
import { hasPaidAccess } from "./support/paid-scan.js";

it.each([
  'env.get("OPENROUTER_API_KEY")',
  'env.require("LYRICS_OPENROUTER_KEY")',
  "secrets.values.GROQ_API_KEY",
  'process.env["KIE_API_KEY"]',
  'import { OPENROUTER_CHAT_URL as endpoint } from "../providers/paid.js"; fetch(endpoint)',
  'import { openRouterKeyFromEnv as credential } from "../providers/paid.js"; createClient({ key: credential(env) })',
  'import { createClient as client } from "@mellodifai/remake"; client({key: token})',
  'import * as paid from "../providers/paid.js"; fetch(paid.OPENROUTER_CHAT_URL)',
])("detects paid access: %s", (source) => {
  expect(hasPaidAccess(source)).toBe(true);
});

it("allows a provider boundary and secret names passed to the engine", () => {
  expect(
    hasPaidAccess(
      'import { openRouterCall } from "../providers/openrouter.js"; openRouterCall(context); engine.run("tool", [], { secretEnv: ["GROQ_API_KEY"] });',
    ),
  ).toBe(false);
});

it("no worker file outside providers/ names a paid host or reads a paid key, including imported aliases", async () => {
  const root = join(import.meta.dirname, "..", "src");
  const violations: string[] = [];
  async function scan(dir: string): Promise<void> {
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      const path = join(dir, entry.name);
      if (path === join(root, "providers")) continue;
      if (entry.isDirectory()) await scan(path);
      else if (
        entry.name.endsWith(".ts") &&
        hasPaidAccess(await readFile(path, "utf8"))
      )
        violations.push(relative(root, path));
    }
  }
  await scan(root);
  expect(violations).toEqual([]);
});
