import type { ChildProcess } from "node:child_process";
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
