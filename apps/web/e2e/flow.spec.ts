import type { ChildProcess } from "node:child_process";
import { expect, test } from "@playwright/test";

import {
  createFrenchProject,
  E2E_ADMIN_EMAIL,
  serviceClient,
  signIn,
  startFakeWorker,
  stopWorker,
} from "./support";

let worker: ChildProcess | undefined;

test.beforeAll(async () => {
  worker = await startFakeWorker();
});

test.afterAll(async () => {
  if (worker) await stopWorker(worker);
});

test("admin completes the French song-to-public-video flow", async ({
  page,
}) => {
  const topic = `E2E flow ${Date.now()}`;
  await signIn(page, E2E_ADMIN_EMAIL);
  await createFrenchProject(page, topic);

  await expect(page.getByText("FR Revisione testi")).toBeVisible();
  await page.getByRole("button", { name: "Approva" }).click();
  await expect(page.getByText("FR Revisione take")).toBeVisible();
  await page.getByRole("button", { name: "Scegli" }).first().click();
  await expect(page.getByText("FR Produzione")).toBeVisible();
  await expect(page.getByText("FR Revisione video")).toBeVisible({
    timeout: 60_000,
  });

  await page.getByRole("button", { name: "Approva video" }).click();
  await expect(page.getByText("FR Approvato")).toBeVisible();
  await page.getByRole("button", { name: "Carica come privato" }).click();
  await expect(
    page.getByRole("button", { name: "Rendi pubblico" }),
  ).toBeVisible();
  await expect(page.getByText("FR Approvato")).toBeVisible({ timeout: 60_000 });

  const projectId = /\/projects\/([^?]+)/u.exec(page.url())?.[1];
  if (!projectId) throw new Error("Project id was not present in the URL");
  const db = serviceClient();
  const { data: version, error: versionError } = await db
    .from("versions")
    .select("id")
    .eq("project_id", projectId)
    .eq("lang", "fr")
    .single();
  if (versionError || !version)
    throw versionError ?? new Error("French version was not found");
  const versionId = version.id;
  const { count: beforeConfirm, error: beforeError } = await db
    .from("jobs")
    .select("id", { count: "exact", head: true })
    .eq("version_id", version.id)
    .eq("stage", "set_privacy");
  if (beforeError) throw beforeError;
  expect(beforeConfirm).toBe(0);

  async function privacyJobCount() {
    const { count, error } = await db
      .from("jobs")
      .select("id", { count: "exact", head: true })
      .eq("version_id", versionId)
      .eq("stage", "set_privacy");
    if (error) throw error;
    return count;
  }

  await page.getByRole("button", { name: "Rendi pubblico" }).click();
  const dialog = page.getByRole("alertdialog");
  await expect(dialog).toContainText("A little brighter");
  expect(await privacyJobCount()).toBe(0);
  await dialog.getByRole("button", { name: "Annulla" }).click();
  await expect(dialog).not.toBeVisible();
  expect(await privacyJobCount()).toBe(0);
  await page.getByRole("button", { name: "Rendi pubblico" }).click();
  await expect(dialog).toContainText("A little brighter");
  expect(await privacyJobCount()).toBe(0);
  await dialog.getByRole("button", { name: "Conferma" }).click();
  await expect(page.getByText("FR Pubblicato")).toBeVisible({
    timeout: 60_000,
  });
  await expect
    .poll(
      async () => {
        const { count } = await db
          .from("jobs")
          .select("id", { count: "exact", head: true })
          .eq("version_id", version.id)
          .eq("stage", "set_privacy");
        return count;
      },
      { timeout: 60_000 },
    )
    .toBe(1);
});
