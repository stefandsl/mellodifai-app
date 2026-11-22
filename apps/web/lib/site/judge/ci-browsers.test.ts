import { readFileSync } from "node:fs";
import { join } from "node:path";
import { expect, it } from "vitest";

// `pnpm e2e` runs the site suite on every engine of playwright.site.config.ts, so CI must
// install each of those browsers before it runs.
const WEB = join(import.meta.dirname, "../../..");

it("CI installs every browser the site suite runs on", () => {
  const config = readFileSync(join(WEB, "playwright.site.config.ts"), "utf8");
  const engines = [
    ...config.matchAll(/name: "(chromium|firefox|webkit)"/gu),
  ].map((m) => m[1]);
  expect(engines).toEqual(["chromium", "firefox", "webkit"]);
  const ci = readFileSync(join(WEB, "../../.github/workflows/ci.yml"), "utf8");
  const installed = [...ci.matchAll(/playwright install([^\n]*)/gu)].flatMap(
    (m) => m[1].trim().split(/\s+/u),
  );
  expect(engines.filter((e) => !installed.includes(e))).toEqual([]);
  expect(ci).toMatch(/pnpm e2e/u);
});
