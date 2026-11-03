import type { ChildProcess } from "node:child_process";
import { mkdir } from "node:fs/promises";
import { expect, test } from "@playwright/test";
import {
  E2E_ADMIN_EMAIL,
  serviceClient,
  signIn,
  startFakeWorker,
  stopWorker,
} from "./support";

const shots = "E:/mellodifai/codex-streams/e2e-coverage/shots";
let worker: ChildProcess | undefined;

test.beforeAll(async () => {
  worker = await startFakeWorker();
});

test.afterAll(async () => {
  if (worker) await stopWorker(worker);
});

test("brief, AI lyrics, take, branded Video Studio render and private publication", async ({
  page,
}) => {
  test.setTimeout(240_000);
  const db = serviceClient();
  const title = `Sole ${Date.now().toString(36)}`;
  await signIn(page, E2E_ADMIN_EMAIL);
  await page.getByRole("radio", { name: "Avanzato" }).click();
  await page.getByRole("textbox", { name: "Stili" }).fill("Pop luminoso");
  await page.getByPlaceholder("Titolo della canzone (facoltativo)").fill(title);
  await page.getByRole("button", { name: "Scrivi con AI" }).click();
  await page
    .getByLabel("Di cosa parla la canzone?")
    .fill("una mattina di sole in città");
  await page.getByRole("button", { name: "Scrivi", exact: true }).click();
  const lyrics = page.getByRole("textbox", { name: "Testo", exact: true });
  await expect(lyrics).toHaveValue(/Apro la finestra sul mattino/u);
  await page.getByRole("button", { name: "Migliora" }).click();
  await expect(lyrics).toHaveValue(/Apro la finestra sul mattino, sì/u);
  const approvedLyrics = await lyrics.inputValue();
  await page.getByRole("button", { name: "Crea canzone" }).click();
  await page.getByRole("link", { name: title }).first().click();
  await expect(page).toHaveURL(/\/projects\/[0-9a-f-]+\?lang=it/u);
  const projectId = /\/projects\/([^?]+)/u.exec(page.url())?.[1];
  if (!projectId) throw new Error("Project id missing");
  await expect(page.getByText("IT Revisione testi")).toBeVisible();
  const { data: version, error: versionError } = await db
    .from("versions")
    .select("id,lyric_pack")
    .eq("project_id", projectId)
    .eq("lang", "it")
    .single();
  if (versionError || !version)
    throw versionError ?? new Error("Version missing");
  const { data: project } = await db
    .from("projects")
    .select("brief")
    .eq("id", projectId)
    .single();
  expect(project?.brief).toBe(approvedLyrics.trim());
  await expect(page.locator("#lyric-lyrics")).toHaveValue(
    /Apro la finestra sul mattino, sì/u,
  );
  expect((version.lyric_pack as { lyrics: string }).lyrics).toContain(
    approvedLyrics.trim(),
  );

  await page
    .getByRole("button", { name: /Approva e genera la canzone/u })
    .click();
  await page
    .getByRole("alertdialog")
    .getByRole("button", { name: "Conferma" })
    .click();
  await expect(page.getByText("IT Revisione take")).toBeVisible();
  const { data: selectedTake } = await db
    .from("takes")
    .select("id")
    .eq("version_id", version.id)
    .eq("take_number", 1)
    .single();
  if (!selectedTake) throw new Error("First take missing");
  await page
    .getByRole("article")
    .filter({ has: page.getByRole("heading", { name: "Take 1" }) })
    .getByRole("button", { name: "Scegli" })
    .click();
  await expect(page.getByText("IT Revisione video")).toBeVisible();
  const { data: chosen } = await db
    .from("versions")
    .select("chosen_take_id")
    .eq("id", version.id)
    .single();
  expect(chosen?.chosen_take_id).toBe(selectedTake.id);

  await page.goto("/library");
  const song = page.getByRole("article", { name: title });
  await expect(song).toBeVisible();
  await song
    .getByRole("button", { name: `Crea video visualizer: ${title}` })
    .click();
  const studio = page.getByTestId("video-studio");
  await studio.getByRole("radio", { name: /Contorni/u }).click();
  await studio.getByRole("tab", { name: "Stile" }).click();
  const logo = await page.evaluate(() => {
    const canvas = document.createElement("canvas");
    canvas.width = 96;
    canvas.height = 96;
    const context = canvas.getContext("2d");
    if (!context) throw new Error("Canvas unavailable");
    context.fillStyle = "#1d4ed8";
    context.fillRect(0, 0, 96, 96);
    context.fillStyle = "#ffffff";
    context.beginPath();
    context.arc(48, 48, 30, 0, Math.PI * 2);
    context.fill();
    return canvas.toDataURL("image/png").split(",")[1];
  });
  await studio.getByTestId("upload-logo").setInputFiles({
    name: "owner-logo.png",
    mimeType: "image/png",
    buffer: Buffer.from(logo, "base64"),
  });
  await expect(studio.getByRole("group", { name: "Logo 1" })).toBeVisible();
  await studio.getByRole("group", { name: "Logo 1" }).scrollIntoViewIfNeeded();
  for (const [width, height] of [
    [1440, 900],
    [1360, 600],
  ] as const) {
    await page.setViewportSize({ width, height });
    await expect(studio.getByTestId("visualizer-preview")).toBeVisible();
    expect(
      await studio.evaluate(
        (element) => element.scrollWidth <= element.clientWidth,
      ),
    ).toBe(true);
    await mkdir(shots, { recursive: true });
    await page.screenshot({
      path: `${shots}/studio-logo-${width}x${height}.png`,
      animations: "disabled",
    });
  }
  await studio.getByRole("button", { name: "Renderizza video (MP4)" }).click();
  await expect
    .poll(async () => {
      const { data } = await db
        .from("renders")
        .select("id,path,preview_path,visualizer_params")
        .eq("version_id", version.id)
        .eq("kind", "visualizer")
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      return data?.preview_path ? data : null;
    })
    .not.toBeNull();
  const { data: visualizer } = await db
    .from("renders")
    .select("id,path,preview_path,visualizer_params")
    .eq("version_id", version.id)
    .eq("kind", "visualizer")
    .order("created_at", { ascending: false })
    .limit(1)
    .single();
  if (!visualizer?.path || !visualizer.preview_path)
    throw new Error("Visualizer render missing");
  const logoUrl = (
    visualizer.visualizer_params as { logos: { assetUrl: string }[] }
  ).logos[0]?.assetUrl;
  expect(logoUrl).toMatch(/^\/media\/uploads\//u);
  const uploadedLogo = await db.storage
    .from("uploads")
    .download(
      logoUrl
        .slice("/media/uploads/".length)
        .split("/")
        .map(decodeURIComponent)
        .join("/"),
    );
  if (uploadedLogo.error || !uploadedLogo.data)
    throw uploadedLogo.error ?? new Error("Uploaded logo missing");
  expect(Buffer.from(await uploadedLogo.data.arrayBuffer())).toEqual(
    Buffer.from(logo, "base64"),
  );
  expect((visualizer.visualizer_params as { preset: string }).preset).toBe(
    "contours",
  );
  expect(
    (await db.storage.from("previews").download(visualizer?.preview_path))
      .error,
  ).toBeNull();
  await studio.getByRole("button", { name: "Chiudi", exact: true }).click();

  await page.goto(`/projects/${projectId}?lang=it`);
  await page.getByRole("button", { name: "Approva video" }).click();
  await expect(page.getByText("IT Approvato")).toBeVisible();
  await page.getByRole("radio", { name: "Video visualizer" }).check();
  const publishTitle = await page.getByLabel("Titolo video").inputValue();
  const description = await page.getByLabel("Descrizione").inputValue();
  expect(description).toContain(title);
  await page.getByRole("button", { name: "Carica come privato" }).click();
  await expect(
    page.getByRole("button", { name: "Rendi pubblico" }),
  ).toBeVisible();
  await expect(page.getByText(`Video: ${publishTitle}`)).toBeVisible();
  for (const [width, height] of [
    [1440, 900],
    [1360, 600],
  ] as const) {
    await page.setViewportSize({ width, height });
    await page.getByText(/Visibilit/u).scrollIntoViewIfNeeded();
    await page.screenshot({
      path: `${shots}/published-visualizer-${width}x${height}.png`,
      fullPage: true,
      animations: "disabled",
    });
  }
  await expect(page.getByText("Visibilità: Privato")).toBeVisible();
  const { data: publication, error: publicationError } = await db
    .from("publications")
    .select("render_id,privacy,metadata,youtube_video_id")
    .eq("render_id", visualizer.id)
    .single();
  if (publicationError || !publication)
    throw publicationError ?? new Error("Publication missing");
  expect(publication).toMatchObject({
    render_id: visualizer.id,
    privacy: "private",
    metadata: { title: publishTitle, description },
  });
  expect(publication.youtube_video_id).toBeTruthy();
  expect(
    (await db.storage.from("previews").download(visualizer.preview_path)).error,
  ).toBeNull();
});
