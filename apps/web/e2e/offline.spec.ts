import { expect, test } from "@playwright/test";

import {
  createFrenchProject,
  removeE2EWorker,
  serviceClient,
  signIn,
} from "./support";

test("projects can be created while the worker is offline", async ({
  page,
}) => {
  await removeE2EWorker();
  await signIn(page);
  await page.goto("/library");
  await expect(page.getByText("Offline", { exact: true })).toBeVisible();

  await createFrenchProject(page, `E2E offline ${Date.now()}`);
  await expect(page.getByText("FR Bozza testi")).toBeVisible();
  await expect(page.getByText("Bozza testi").last()).toBeVisible();
  const projectId = /\/projects\/([^?]+)/u.exec(page.url())?.[1];
  if (!projectId) throw new Error("Project id was not present in the URL");
  const { data: version, error } = await serviceClient()
    .from("versions")
    .select("id")
    .eq("project_id", projectId)
    .eq("lang", "fr")
    .single();
  if (error || !version)
    throw error ?? new Error("French version was not found");
  await expect
    .poll(async () => {
      const { data } = await serviceClient()
        .from("jobs")
        .select("status")
        .eq("version_id", version.id)
        .eq("stage", "draft_lyrics")
        .single();
      return data?.status;
    })
    .toBe("queued");
});
