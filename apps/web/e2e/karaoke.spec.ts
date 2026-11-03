import { mkdir } from "node:fs/promises";
import { expect, test } from "@playwright/test";
import { createServerClient } from "@supabase/ssr";
import { serviceClient } from "./support";

const shots = "E:/mellodifai/codex-streams/karaoke/shots";
const title = `Karaoke E2E ${Date.now()}`;

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

test("timed lyrics follow playback, seek by line, and fit two desktop sizes", async ({
  page,
}) => {
  const db = serviceClient();
  const email = `karaoke-e2e-${Date.now()}@mellodifai.test`;
  const allowlist = await db.from("admin_allowlist").insert({ email });
  if (allowlist.error) throw allowlist.error;
  const password = `karaoke-${Date.now()}-test-password`;
  const user = await db.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
  });
  if (user.error || !user.data.user)
    throw user.error ?? new Error("E2E user missing");
  const owner = user.data.user.id;
  const profile = await db
    .from("profiles")
    .upsert({ id: owner, email, role: "admin" });
  if (profile.error) throw profile.error;
  let cookies: { name: string; value: string }[] = [];
  const auth = createServerClient(
    process.env.SUPABASE_URL ?? "",
    process.env.SUPABASE_ANON_KEY ?? "",
    {
      cookies: {
        getAll: () => cookies,
        setAll: (entries) => {
          cookies = entries.map(({ name, value }) => ({ name, value }));
        },
      },
    },
  );
  const signed = await auth.auth.signInWithPassword({ email, password });
  if (signed.error) throw signed.error;
  await page.context().addCookies(
    cookies.map(({ name, value }) => ({
      name,
      value,
      url: "http://127.0.0.1:3222",
    })),
  );
  const project = await db
    .from("projects")
    .insert({ owner_id: owner, topic: title })
    .select("id")
    .single();
  if (project.error) throw project.error;
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
        lyrics:
          "[Strofa]\nLa luna splende\nCammino nella notte\n[Ritornello]\nQuesta è una frase lunga che deve andare a capo senza uscire dalla finestra",
      },
    })
    .select("id")
    .single();
  if (version.error) throw version.error;
  const path = `previews/${owner}/${project.data.id}/it/karaoke-e2e.wav`;
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
            end: 3,
            words: [
              { word: "La", start: 0, end: 1 },
              { word: "luna", start: 1, end: 2 },
              { word: "splende", start: 2, end: 3 },
            ],
          },
          { text: "Cammino nella notte", start: 3, end: 6 },
          {
            text: "Questa è una frase lunga che deve andare a capo senza uscire dalla finestra",
            start: 6,
            end: 11,
          },
        ],
      },
    })
    .select("id")
    .single();
  if (take.error) throw take.error;
  const chosen = await db
    .from("versions")
    .update({ chosen_take_id: take.data.id })
    .eq("id", version.data.id);
  if (chosen.error) throw chosen.error;

  await page.goto("/library");
  await page.getByRole("button", { name: `Riproduci: ${title}` }).click();
  await expect
    .poll(() =>
      page
        .locator("audio")
        .evaluate((element: HTMLAudioElement) => element.duration),
    )
    .toBeGreaterThan(0);
  await page.getByRole("button", { name: "Testo" }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog.getByText("Ritornello")).toBeVisible();
  await expect(
    dialog.getByRole("button", { name: "La luna splende" }),
  ).toHaveAttribute("aria-current", "true");
  await dialog.getByRole("button", { name: "Pausa" }).click();
  await dialog.getByRole("button", { name: "Cammino nella notte" }).click();
  await expect(
    dialog.getByRole("button", { name: "Cammino nella notte" }),
  ).toHaveAttribute("aria-current", "true");
  await dialog
    .getByRole("button", { name: /Questa è una frase lunga/u })
    .click();
  await expect(
    dialog.getByRole("button", { name: /Questa è una frase lunga/u }),
  ).toHaveAttribute("aria-current", "true");
  await mkdir(shots, { recursive: true });
  for (const [width, height] of [
    [1440, 900],
    [1360, 600],
    [390, 844],
  ]) {
    await page.setViewportSize({ width, height });
    await expect(dialog).toBeVisible();
    await expect
      .poll(() =>
        dialog
          .getByRole("button", { name: /Questa è una frase lunga/u })
          .evaluate((element) => {
            const rect = element.getBoundingClientRect();
            return rect.top >= 70 && rect.bottom <= window.innerHeight - 65;
          }),
      )
      .toBe(true);
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth),
    ).toBeLessThanOrEqual(width);
    await page.screenshot({ path: `${shots}/karaoke-${width}x${height}.png` });
  }
  await dialog.getByRole("button", { name: "Chiudi il testo" }).click();
  await expect(dialog).not.toBeVisible();
  await db.storage.from("previews").remove([path]);
  await db.auth.admin.deleteUser(owner);
  await db.from("admin_allowlist").delete().eq("email", email);
});
