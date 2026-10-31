// Local visual check of the studio: signs in through the local Mailpit inbox and saves
// full-resolution screenshots. Usage: node scripts/studio-shots.mjs <outDir> [email] [path...]
import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { chromium } from "@playwright/test";

const [outDir = "shots", email = "stefandsl@outlook.com", ...paths] =
  process.argv.slice(2);
const BASE = "http://localhost:3000";
const MAILPIT = "http://127.0.0.1:54324";

async function latestLink(after) {
  for (let i = 0; i < 40; i += 1) {
    const list = await (
      await fetch(`${MAILPIT}/api/v1/messages?limit=5`)
    ).json();
    const message = list.messages.find(
      (m) => m.To.some((t) => t.Address === email) && m.Created > after,
    );
    if (message) {
      const body = await (
        await fetch(`${MAILPIT}/api/v1/message/${message.ID}`)
      ).json();
      const link = /href="([^"]+)"/u.exec(body.HTML)?.[1];
      if (link) return link.replaceAll("&amp;", "&");
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error("no sign-in mail");
}

await mkdir(outDir, { recursive: true });
const browser = await chromium.launch();
const viewports = {
  desktop: { width: 1440, height: 900 },
  laptop: { width: 1024, height: 768 },
  phone: { width: 390, height: 844 },
};
const context = await browser.newContext({ viewport: viewports.desktop });
const page = await context.newPage();
const errors = [];
page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
page.on("pageerror", (e) => errors.push(String(e)));

const started = new Date().toISOString();
await page.goto(`${BASE}/login`);
await page.locator("#email").fill(email);
await page.locator("form button[type=submit]").click();
await page.goto(await latestLink(started));
await page.waitForURL(/\/create/u);

for (const path of paths.length ? paths : ["/create"]) {
  for (const [name, size] of Object.entries(viewports)) {
    await page.setViewportSize(size);
    await page.goto(`${BASE}${path}`);
    await page.waitForLoadState("networkidle");
    await page.waitForTimeout(600);
    const file = join(
      outDir,
      `${path.replaceAll(/[^a-z0-9]+/giu, "_") || "root"}-${name}.png`,
    );
    await page.screenshot({ path: file });
    console.log(file);
  }
}
console.log(
  errors.length ? `console errors:\n${errors.join("\n")}` : "no console errors",
);
await browser.close();
