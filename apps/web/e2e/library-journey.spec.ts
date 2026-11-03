import { mkdir, readFile } from "node:fs/promises";
import { expect, test } from "@playwright/test";
import { E2E_ADMIN_EMAIL, getAdminId, serviceClient, signIn } from "./support";

function wav(seconds: number) {
  const samples = seconds * 8000;
  const audio = Buffer.alloc(44 + samples * 2);
  audio.write("RIFF", 0);
  audio.writeUInt32LE(audio.length - 8, 4);
  audio.write("WAVEfmt ", 8);
  audio.writeUInt32LE(16, 16);
  audio.writeUInt16LE(1, 20);
  audio.writeUInt16LE(1, 22);
  audio.writeUInt32LE(8000, 24);
  audio.writeUInt32LE(16000, 28);
  audio.writeUInt16LE(2, 32);
  audio.writeUInt16LE(16, 34);
  audio.write("data", 36);
  audio.writeUInt32LE(samples * 2, 40);
  return audio;
}

test("library actions, karaoke and trimmed WAV export keep the song data", async ({
  page,
}) => {
  test.setTimeout(180_000);
  const db = serviceClient();
  const owner = await getAdminId();
  const title = `Libreria ${Date.now().toString(36)}`;
  const project = await db
    .from("projects")
    .insert({ owner_id: owner, topic: title })
    .select("id")
    .single();
  if (project.error || !project.data)
    throw project.error ?? new Error("Project missing");
  const version = await db
    .from("versions")
    .insert({
      owner_id: owner,
      project_id: project.data.id,
      lang: "it",
      status: "audio_ready",
      display_title: title,
      lyric_pack: {
        title,
        lyrics: "[Strofa]\nLa luna splende\nCammino nella notte",
      },
    })
    .select("id")
    .single();
  if (version.error || !version.data)
    throw version.error ?? new Error("Version missing");
  const path = `previews/${owner}/${project.data.id}/it/library-e2e.wav`;
  const upload = await db.storage
    .from("previews")
    .upload(path, wav(12), { contentType: "audio/wav" });
  if (upload.error) throw upload.error;
  const take = await db
    .from("takes")
    .insert({
      owner_id: owner,
      version_id: version.data.id,
      generation: 1,
      take_number: 1,
      audio_preview_path: path,
      lyric_timing: {
        source: "whisper",
        lines: [
          {
            text: "La luna splende",
            start: 0,
            end: 4,
            words: [
              { word: "La", start: 0, end: 1 },
              { word: "luna", start: 1, end: 2 },
              { word: "splende", start: 2, end: 4 },
            ],
          },
          { text: "Cammino nella notte", start: 4, end: 10 },
        ],
      },
    })
    .select("id")
    .single();
  if (take.error || !take.data) throw take.error ?? new Error("Take missing");
  const chosen = await db
    .from("versions")
    .update({ chosen_take_id: take.data.id })
    .eq("id", version.data.id);
  if (chosen.error) throw chosen.error;
  try {
    await signIn(page, E2E_ADMIN_EMAIL);
    await page.goto("/library");
    const song = page.getByRole("article", { name: title });
    await expect(song).toBeVisible();
    await page.getByRole("searchbox", { name: "Cerca" }).fill(title);
    await expect(song).toBeVisible();
    await page.getByRole("searchbox", { name: "Cerca" }).fill("no-match-e2e");
    await expect(song).toHaveCount(0);
    await page.getByRole("searchbox", { name: "Cerca" }).fill("");
    await song.getByRole("button", { name: "Mi piace", exact: true }).click();
    await expect(
      song.getByRole("button", { name: "Mi piace", exact: true }),
    ).toHaveAttribute("aria-pressed", "true");
    await expect
      .poll(
        async () =>
          (
            await db
              .from("versions")
              .select("liked")
              .eq("id", version.data.id)
              .single()
          ).data?.liked,
      )
      .toBe(true);
    await page
      .locator("header")
      .getByRole("button", { name: "Mi piace", exact: true })
      .click();
    await expect(song).toBeVisible();
    await page
      .locator("header")
      .getByRole("button", { name: "Mi piace", exact: true })
      .click();

    await song.getByRole("button", { name: "Aggiungi a playlist" }).click();
    const dialog = page.getByRole("dialog");
    const playlistName = `Ascolti ${Date.now()}`;
    await dialog
      .getByRole("textbox", { name: "Nome della playlist" })
      .fill(playlistName);
    await dialog.getByRole("button", { name: "Nuova playlist" }).click();
    await expect(dialog).not.toBeVisible();
    const { data: playlist } = await db
      .from("playlists")
      .select("id")
      .eq("owner_id", owner)
      .eq("name", playlistName)
      .single();
    if (!playlist) throw new Error("Playlist missing");
    await expect
      .poll(
        async () =>
          (
            await db
              .from("playlist_items")
              .select("version_id")
              .eq("playlist_id", playlist.id)
          ).data?.length,
      )
      .toBe(1);
    await page.goto("/library");
    await song.getByRole("button", { name: "Aggiungi a playlist" }).click();
    await dialog
      .getByRole("button", { name: new RegExp(playlistName, "u") })
      .click();
    await expect
      .poll(
        async () =>
          (
            await db
              .from("playlist_items")
              .select("version_id")
              .eq("playlist_id", playlist.id)
          ).data?.length,
      )
      .toBe(0);
    await dialog.getByRole("button", { name: "Chiudi" }).click();

    await song.getByRole("button", { name: `Riproduci: ${title}` }).click();
    await expect
      .poll(() =>
        page
          .locator("audio")
          .evaluate((element: HTMLAudioElement) => element.duration),
      )
      .toBeGreaterThan(0);
    await page.getByRole("button", { name: "Testo" }).click();
    const lyrics = page.getByRole("dialog");
    await expect(
      lyrics.getByRole("button", { name: "La luna splende" }),
    ).toHaveAttribute("aria-current", "true");
    await lyrics.getByRole("button", { name: "Cammino nella notte" }).click();
    await expect(
      lyrics.getByRole("button", { name: "Cammino nella notte" }),
    ).toHaveAttribute("aria-current", "true");
    await expect(page.getByText(/Tolta da "Ascolti/u)).toHaveCount(0);
    await mkdir("E:/mellodifai/codex-streams/e2e-coverage/shots", {
      recursive: true,
    });
    for (const [width, height] of [
      [1440, 900],
      [1360, 600],
    ] as const) {
      await page.setViewportSize({ width, height });
      await expect(lyrics).toBeVisible();
      expect(
        await page.evaluate(() => document.documentElement.scrollWidth),
      ).toBeLessThanOrEqual(width);
      await page.screenshot({
        path: `E:/mellodifai/codex-streams/e2e-coverage/shots/library-karaoke-${width}x${height}.png`,
        animations: "disabled",
      });
    }
    await lyrics.getByRole("button", { name: "Chiudi il testo" }).click();

    await song.getByRole("button", { name: "Altre opzioni" }).click();
    await page.getByRole("menuitem", { name: "Modifica audio" }).click();
    await expect(page).toHaveURL(/\/editor\/[0-9a-f-]+/u);
    await page.getByRole("textbox", { name: "Inizio" }).fill("0:02");
    await page.getByRole("textbox", { name: "Inizio" }).press("Enter");
    await page.getByRole("textbox", { name: "Fine" }).fill("0:08");
    await page.getByRole("textbox", { name: "Fine" }).press("Enter");
    const download = page.waitForEvent("download");
    await page.getByRole("button", { name: "Scarica WAV" }).click();
    const file = await download;
    const bytes = await readFile(await file.path());
    expect(bytes.toString("ascii", 0, 4)).toBe("RIFF");
    expect(bytes.length).toBe(
      44 +
        6 *
          bytes.readUInt32LE(24) *
          bytes.readUInt16LE(22) *
          (bytes.readUInt16LE(34) / 8),
    );
    expect(
      (
        await db
          .from("versions")
          .select("chosen_take_id")
          .eq("id", version.data.id)
          .single()
      ).data?.chosen_take_id,
    ).toBe(take.data.id);
    expect((await db.storage.from("previews").download(path)).error).toBeNull();

    await page.goto("/library");
    await song.getByRole("button", { name: "Altre opzioni" }).click();
    await page.getByRole("menuitem", { name: "Sposta nel cestino" }).click();
    await expect(song).toHaveCount(0);
    await expect
      .poll(
        async () =>
          (
            await db
              .from("versions")
              .select("trashed_at")
              .eq("id", version.data.id)
              .single()
          ).data?.trashed_at,
      )
      .not.toBeNull();
    await page.goto("/library?tab=trash");
    await page
      .getByRole("article", { name: title })
      .getByRole("button", { name: "Ripristina" })
      .click();
    await expect(page.getByRole("article", { name: title })).toHaveCount(0);
    await expect
      .poll(
        async () =>
          (
            await db
              .from("versions")
              .select("trashed_at")
              .eq("id", version.data.id)
              .single()
          ).data?.trashed_at,
      )
      .toBeNull();
  } finally {
    await db.storage.from("previews").remove([path]);
    await db.from("projects").delete().eq("id", project.data.id);
  }
});
