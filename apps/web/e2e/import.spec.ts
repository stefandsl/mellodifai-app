import { execFile } from "node:child_process";
import type { ChildProcess } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { promisify } from "node:util";
import { expect, test } from "@playwright/test";
import {
  getAdminId,
  screenshotDir,
  serviceClient,
  signIn,
  startFakeWorker,
  stopWorker,
} from "./support";

const run = promisify(execFile);
let worker: ChildProcess | undefined;

test.beforeAll(async () => {
  worker = await startFakeWorker(await getAdminId(), `e2e-import-${Date.now()}`);
});

test.afterAll(async () => {
  if (worker) await stopWorker(worker);
});

// What Suno's download gives: an MP3 whose ID3 tag carries the song's artwork.
async function sunoMp3(directory: string): Promise<Buffer> {
  const file = join(directory, "suno-song.mp3");
  const args = (codec: string) => [
    "-hide_banner",
    "-loglevel",
    "error",
    "-y",
    "-f",
    "lavfi",
    "-i",
    "sine=frequency=440:duration=6",
    "-f",
    "lavfi",
    "-i",
    "color=c=0xd02060:s=300x300",
    "-frames:v",
    "1",
    "-map",
    "0:a",
    "-map",
    "1:v",
    "-c:a",
    codec,
    "-b:a",
    "128k",
    "-c:v",
    "mjpeg",
    "-disposition:v",
    "attached_pic",
    "-id3v2_version",
    "3",
    file,
  ];
  try {
    await run("ffmpeg", args("libmp3lame"), { windowsHide: true });
  } catch {
    // Conda's Windows FFmpeg build has MediaFoundation MP3 but no libmp3lame.
    await run("ffmpeg", args("mp3_mf"), { windowsHide: true });
  }
  return readFile(file);
}

test("an MP3 from Suno with lyrics and artwork becomes a song that shows both", async ({
  page,
}) => {
  test.setTimeout(180_000);
  const title = `Import Suno ${Date.now().toString(36)}`;
  const lyrics = "[Strofa]\nLa luna sul mare\nCanto piano con te";
  const temp = await mkdtemp(
    join(process.env.MELLODIFAI_ROOT ?? "E:/mellodifai/tmp", "e2e-import-"),
  );
  try {
    const mp3 = await sunoMp3(temp);
    await signIn(page);
    await page.goto("/library");
    await page.getByRole("button", { name: "Importa da Suno" }).click();
    const dialog = page.getByRole("dialog", { name: "Importa da Suno" });
    await dialog.locator('input[type="file"]').setInputFiles({
      name: "suno-song.mp3",
      mimeType: "audio/mpeg",
      buffer: mp3,
    });
    await dialog.getByRole("textbox", { name: "Titolo" }).fill(title);
    await dialog.getByRole("textbox", { name: "Testo" }).fill(lyrics);
    await dialog.getByRole("button", { name: "Importa la canzone" }).click();
    await expect(dialog).not.toBeVisible();

    const db = serviceClient();
    // The worker turns the upload into take 1 with the MP3's own artwork as its cover.
    await expect
      .poll(
        async () => {
          const { data: project } = await db
            .from("projects")
            .select("versions(id,status)")
            .eq("topic", title)
            .maybeSingle();
          const version = (
            (project?.versions ?? []) as { id: string; status: string }[]
          )[0];
          if (!version) return "no song";
          const { data: take } = await db
            .from("takes")
            .select("cover_path")
            .eq("version_id", version.id)
            .maybeSingle();
          return `${version.status}:${take?.cover_path ?? "no cover"}`;
        },
        { timeout: 90_000 },
      )
      .toMatch(/^audio_ready:previews\/.+\/take-1-cover\.jpg$/u);

    await page.goto("/library");
    const song = page.getByRole("article", { name: title, exact: true });
    await expect(song).toBeVisible();
    // The card's art is the imported artwork, not the generated pattern.
    await expect
      .poll(
        () =>
          song.evaluate((element) =>
            [element, ...element.querySelectorAll("*")]
              .map((node) => getComputedStyle(node).backgroundImage)
              .some((image) => image.includes("take-1-cover.jpg")),
          ),
        { timeout: 30_000 },
      )
      .toBe(true);
    await song.getByRole("button", { name: `Riproduci: ${title}` }).click();
    await page.getByRole("button", { name: "Testo" }).click();
    const panel = page.getByRole("dialog");
    await expect(panel.getByText("La luna sul mare")).toBeVisible();
    await expect(panel.getByText("Canto piano con te")).toBeVisible();
    const screens = screenshotDir();
    await mkdir(screens, { recursive: true });
    await page.screenshot({ path: join(screens, "import-suno.png") });
  } finally {
    await rm(temp, { recursive: true, force: true });
  }
});
