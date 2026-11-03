import type { ChildProcess } from "node:child_process";
import { mkdir } from "node:fs/promises";
import { expect, test } from "@playwright/test";

import {
  E2E_ADMIN_EMAIL,
  getAdminId,
  serviceClient,
  signIn,
  startFakeWorker,
  stopWorker,
} from "./support";

// "Rifai da YouTube" and the AI lyric buttons (task 27) on the fake worker: the remake stages run
// with the fixture analysis and lyrics of packages/remake/test/fixtures, the lyric jobs with
// canned text. Nothing is downloaded and no model is called.
let worker: ChildProcess | undefined;

test.beforeAll(async () => {
  worker = await startFakeWorker();
});

test.afterAll(async () => {
  if (worker) await stopWorker(worker);
});

// Each test starts with no remake on screen: earlier ones are put away as the panel would.
test.beforeEach(async () => {
  const { error } = await serviceClient()
    .from("remakes")
    .update({ dismissed_at: new Date().toISOString() })
    .eq("owner_id", await getAdminId())
    .is("dismissed_at", null);
  if (error) throw error;
});

test("remake: paste a link, follow the progress, review, edit a line, accept and continue", async ({
  page,
}) => {
  test.setTimeout(180_000);
  await signIn(page, E2E_ADMIN_EMAIL);
  const card = page.getByRole("region", { name: "Rifai da YouTube" });
  const link = card.getByLabel("Link YouTube");

  // The link is checked before anything is queued.
  await link.fill("https://example.com/watch?v=49rDdMbXd_w");
  await card.getByRole("button", { name: "Analizza" }).click();
  await expect(card.getByRole("alert")).toHaveText(
    "Non è un link a un video di YouTube.",
  );

  await link.fill("https://youtu.be/49rDdMbXd_w");
  await card.getByLabel("Lingua del testo").selectOption("it");
  await card.getByRole("button", { name: "Analizza" }).click();

  // Progress: the steps of R1 to R3 as the worker reports them.
  await expect(card.getByRole("progressbar")).toBeVisible();
  await expect(card.getByRole("status")).toContainText(
    /Leggo il video|Scarico|Prendo|Cerco|Preparo|Separo|Trovo|Riconosco|Scrivo|Rifinisco|In attesa|In coda/u,
  );

  // Review: the analysis, the new title, the jury and the lines.
  const title = card.getByRole("textbox", { name: "Titolo nuovo" });
  await expect(title).toHaveValue("Mille volti", { timeout: 90_000 });
  await expect(card.getByText("79", { exact: true })).toBeVisible();
  await expect(card.getByText("D minore")).toBeVisible();
  await expect(
    card.getByRole("region", { name: "Giuria" }).getByText("Originalità"),
  ).toBeVisible();
  const accept = card.getByRole("button", { name: "Accetta e genera" });
  await expect(
    card.getByText("Righe da riscrivere prima di continuare: 1"),
  ).toBeVisible();
  await expect(accept).toBeDisabled();

  // The flagged line is too close to the source: the person rewrites it, the gates run again.
  await card.getByRole("button", { name: /^Modifica la riga 9:/u }).click();
  const input = card.getByRole("textbox", { name: "Modifica la riga 9" });
  await input.fill("il mondo corre e non mi vede");
  await input.press("Enter");
  await expect(
    card.getByRole("button", {
      name: "Modifica la riga 9: il mondo corre e non mi vede",
    }),
  ).toBeVisible();
  await expect(accept).toBeEnabled({ timeout: 60_000 });
  await expect(
    card.getByText("Righe da riscrivere prima di continuare: 1"),
  ).toHaveCount(0);

  const db = serviceClient();
  const verse = card.getByRole("region", { name: "Verse 2" });
  const firstLine = verse.getByRole("button", {
    name: /^Modifica la riga 14:/u,
  });
  const beforeLine = await firstLine.getAttribute("aria-label");
  const { data: beforeRemake, error: beforeError } = await db
    .from("remakes")
    .select("lyrics")
    .eq("video_id", "49rDdMbXd_w")
    .single();
  if (beforeError || !beforeRemake)
    throw beforeError ?? new Error("Remake lyrics missing");
  const beforeVerse = (
    beforeRemake.lyrics as {
      sections: { id: string; lines: { text: string }[] }[];
    }
  ).sections
    .find((section) => section.id === "verse-2")
    ?.lines.map((line) => line.text);
  if (!beforeLine || !beforeVerse)
    throw new Error("Verse 2 missing before regeneration");
  await card
    .getByRole("button", { name: "Rigenera la sezione Verse 2" })
    .click();
  await expect
    .poll(() => firstLine.getAttribute("aria-label"))
    .not.toBe(beforeLine);
  await expect(accept).toBeEnabled({ timeout: 60_000 });
  const { data: remake, error: remakeError } = await db
    .from("remakes")
    .select("id,version_id,stage,revision,lyrics")
    .eq("video_id", "49rDdMbXd_w")
    .single();
  if (remakeError || !remake) throw remakeError ?? new Error("Remake missing");
  expect(remake.stage).toBe("review");
  expect(remake.revision).toBeGreaterThan(1);
  const afterVerse = (
    remake.lyrics as { sections: { id: string; lines: { text: string }[] }[] }
  ).sections
    .find((section) => section.id === "verse-2")
    ?.lines.map((line) => line.text);
  expect(afterVerse).toBeDefined();
  expect(afterVerse).not.toEqual(beforeVerse);
  expect(await firstLine.getAttribute("aria-label")).toContain(afterVerse?.[0]);
  expect(JSON.stringify(remake.lyrics)).toContain(
    "il mondo corre e non mi vede",
  );
  const { data: remakeJobs } = await db
    .from("jobs")
    .select("stage,payload,status")
    .eq("version_id", remake.version_id);
  expect(remakeJobs).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ stage: "remake_ingest", status: "done" }),
      expect.objectContaining({ stage: "remake_analyse", status: "done" }),
      expect.objectContaining({
        stage: "remake_rewrite",
        payload: expect.objectContaining({
          mode: "section",
          section: "verse-2",
        }),
        status: "done",
      }),
    ]),
  );
  const shots = "E:/mellodifai/codex-streams/e2e-coverage/shots";
  await mkdir(shots, { recursive: true });
  for (const [width, height] of [
    [1440, 900],
    [1360, 600],
  ] as const) {
    await page.setViewportSize({ width, height });
    await firstLine.scrollIntoViewIfNeeded();
    await expect(firstLine).toBeInViewport();
    await expect(accept).toBeVisible();
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth),
    ).toBeLessThanOrEqual(width);
    await page.screenshot({
      path: `${shots}/remake-verse-${width}x${height}.png`,
      animations: "disabled",
    });
    await accept.scrollIntoViewIfNeeded();
    await expect(accept).toBeInViewport();
    await page.screenshot({
      path: `${shots}/remake-review-${width}x${height}.png`,
      animations: "disabled",
    });
  }

  // Accept: the reviewed lyrics become the song, and the normal generation starts.
  await accept.click();
  await expect(
    card.getByText("Testo accettato: la canzone è in coda"),
  ).toBeVisible();
  await card.getByRole("link", { name: "Vai alla canzone" }).click();
  await expect(page).toHaveURL(/\/projects\/[0-9a-f-]+\?lang=it/u);
  await expect(page.getByText("IT Revisione take")).toBeVisible({
    timeout: 60_000,
  });
  const { data: accepted } = await db
    .from("remakes")
    .select("stage")
    .eq("id", remake.id)
    .single();
  const { data: version } = await db
    .from("versions")
    .select("lyric_pack,status")
    .eq("id", remake.version_id)
    .single();
  if (!version) throw new Error("Accepted version missing");
  expect(accepted?.stage).toBe("accepted");
  expect(version.status).toBe("takes_review");
  expect((version.lyric_pack as { lyrics: string }).lyrics).toContain(
    "il mondo corre e non mi vede",
  );
});

test("remake: a private video stops with a clear reason", async ({ page }) => {
  await signIn(page, E2E_ADMIN_EMAIL);
  const card = page.getByRole("region", { name: "Rifai da YouTube" });
  await card.getByLabel("Link YouTube").fill("https://youtu.be/PrivateVid0");
  await card.getByRole("button", { name: "Analizza" }).click();
  await expect(card.getByRole("alert")).toContainText(
    "Il video è privato o per soli membri: scegline uno pubblico.",
    { timeout: 60_000 },
  );
  await card.getByRole("button", { name: "Chiudi" }).click();
  await expect(card.getByLabel("Link YouTube")).toBeVisible();
});

test("lyrics editor: write with AI, then improve", async ({ page }) => {
  await signIn(page, E2E_ADMIN_EMAIL);
  await page.getByRole("radio", { name: "Avanzato" }).click();
  const lyrics = page.getByRole("textbox", { name: "Testo", exact: true });
  await page.getByRole("button", { name: "Scrivi con AI" }).click();
  await page
    .getByLabel("Di cosa parla la canzone?")
    .fill("una mattina di sole in città");
  await page.getByRole("button", { name: "Scrivi", exact: true }).click();
  await expect(lyrics).toHaveValue(/Apro la finestra sul mattino/u, {
    timeout: 60_000,
  });
  await expect(page.getByText("Testo pronto")).toBeVisible();
  await page.getByRole("button", { name: "Migliora" }).click();
  await expect(lyrics).toHaveValue(/Apro la finestra sul mattino, sì/u, {
    timeout: 60_000,
  });
});
