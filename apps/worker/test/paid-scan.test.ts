import { readdir, readFile } from "node:fs/promises";
import { join, relative } from "node:path";
import { expect, it } from "vitest";

it("no worker file outside providers/ names a paid host or reads a paid key", async () => {
  const root = join(import.meta.dirname, "..", "src");
  const violations: string[] = [];
  async function scan(dir: string): Promise<void> {
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) await scan(path);
      else if (
        entry.name.endsWith(".ts") &&
        !path.includes(`${join(root, "providers")}`)
      ) {
        const source = await readFile(path, "utf8");
        if (
          /https?:\/\/(?:api\.kie\.ai|kieai\.redpandaai\.co|openrouter\.ai|api\.groq\.com)/u.test(
            source,
          ) ||
          /(?:secrets\.values|values|env\.get|env\.require)\.(?:KIE_API_KEY|OPENROUTER_API_KEY|LYRICS_OPENROUTER_KEY|GROQ_API_KEY|HIGGSFIELD_API_KEY)|(?:secrets\.values|values|env\.get|env\.require)\[?["'](?:KIE_API_KEY|OPENROUTER_API_KEY|LYRICS_OPENROUTER_KEY|GROQ_API_KEY|HIGGSFIELD_API_KEY)/u.test(
            source,
          )
        )
          violations.push(relative(root, path));
      }
    }
  }
  await scan(root);
  expect(violations).toEqual([]);
});
