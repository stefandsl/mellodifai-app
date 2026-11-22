// Likeness judge, command line: measures one of our pages in Chromium at the three study widths
// and compares it with the study's layout reference.
// Usage (from apps/web):
//   pnpm exec tsx scripts/site-judge/likeness.ts --url=http://127.0.0.1:3241/ \
//     --ref=E:/mellodifai/research/2026-11-20/cardboard/pages/home/layout-ref.json [--steps=1] [--out=file.json]
// The tolerance is in steps of the spacing scale: one step is the theme's --spacing-1 (4 px).
import { readFileSync, writeFileSync } from "node:fs";
import { chromium } from "@playwright/test";
import {
  compareLayout,
  type LayoutRef,
  measureLayoutInPage,
} from "../../lib/site/judge/likeness";

const arg = (name: string, fallback?: string) =>
  process.argv
    .find((a) => a.startsWith(`--${name}=`))
    ?.slice(name.length + 3) ?? fallback;

const url = arg("url");
const refPath = arg("ref");
if (!url || !refPath) {
  console.error(
    "usage: likeness.ts --url=<page> --ref=<layout-ref.json> [--steps=1] [--out=<file>]",
  );
  process.exit(2);
}
const steps = Number(arg("steps", "1"));
const reference = JSON.parse(readFileSync(refPath, "utf8")) as LayoutRef;
const HEIGHT: Record<string, number> = { "1440": 900, "1024": 768, "390": 844 };

const browser = await chromium.launch();
const candidate: LayoutRef = {
  slug: reference.slug,
  route: reference.route,
  sections: reference.sections,
  widths: {},
};
let stepPx = 0;
try {
  for (const w of Object.keys(reference.widths)) {
    const page = await browser.newPage({
      viewport: { width: Number(w), height: HEIGHT[w] ?? 900 },
      colorScheme: "dark",
    });
    // tsx keeps function names with a __name helper that the page does not have.
    await page.addInitScript("globalThis.__name = (f) => f");
    await page.goto(url, { waitUntil: "networkidle" });
    await page.evaluate(() => document.fonts.ready);
    stepPx = await page.evaluate(() => {
      const probe = document.createElement("div");
      probe.style.width = "var(--spacing-1)";
      (document.querySelector("[data-astryx-theme]") ?? document.body).append(
        probe,
      );
      const px = probe.getBoundingClientRect().width;
      probe.remove();
      return px;
    });
    candidate.widths[w] = await page.evaluate(measureLayoutInPage, {
      names: reference.sections,
      width: Number(w),
    });
    await page.close();
  }
} finally {
  await browser.close();
}
const result = compareLayout(reference, candidate, { stepPx, steps });
const out = arg("out");
if (out) writeFileSync(out, JSON.stringify({ result, candidate }, null, 1));
for (const f of result.failures) console.log(`FAIL ${f}`);
console.log(
  `${result.pass ? "PASSED" : "FAILED"}: ${result.checked} values, step ${stepPx} px, tolerance ${result.tolerancePx} px (${steps} step), worst ${result.worstSteps} steps, ${result.failures.length} differences`,
);
process.exit(result.pass ? 0 : 1);
