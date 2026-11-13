import { mkdir, writeFile } from "node:fs/promises";
import { expect, test } from "@playwright/test";
import { createServerClient } from "@supabase/ssr";
import { screenshotDir, serviceClient } from "./support";

const shots = screenshotDir();
const sizes = [
  [1440, 900],
  [1360, 600],
  [390, 844],
] as const;
test.use({ trace: "off" });

function wav() {
  const samples = 12 * 8000;
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

test("glass setting changes the shell and karaoke themes without layout overflow", async ({
  page,
  baseURL,
}) => {
  test.setTimeout(180_000);
  if (!baseURL) throw new Error("E2E base URL required");
  const db = serviceClient();
  const email = `glass-e2e-${Date.now()}@mellodifai.test`;
  const title = `Colori in prova ${Date.now()}`;
  const nextTitle = `Altri colori ${Date.now()}`;
  const password = `glass-${Date.now()}-test-password`;
  let owner: string | undefined;
  const paths: string[] = [];
  await mkdir(shots, { recursive: true });
  try {
    const allowlist = await db.from("admin_allowlist").insert({ email });
    if (allowlist.error) throw allowlist.error;
    const created = await db.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
    });
    if (created.error || !created.data.user)
      throw created.error ?? new Error("User missing");
    owner = created.data.user.id;
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
    await page
      .context()
      .addCookies(
        cookies.map(({ name, value }) => ({ name, value, url: baseURL })),
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
            "[Strofa]\nUn colore sopra il mare\nUna luce nella notte\n[Ritornello]\nResta qui con me",
        },
      })
      .select("id")
      .single();
    if (version.error) throw version.error;
    const prefix = `previews/${owner}/${project.data.id}/it`;
    const audioPath = `${prefix}/glass-e2e.wav`;
    const coverPath = `${prefix}/glass-e2e.svg`;
    paths.push(audioPath, coverPath);
    const cover = Buffer.from(
      '<svg xmlns="http://www.w3.org/2000/svg" width="360" height="360"><rect width="120" height="360" fill="#c62768"/><rect x="120" width="120" height="360" fill="#285cbe"/><rect x="240" width="120" height="360" fill="#e6a139"/></svg>',
    );
    for (const [path, body, contentType] of [
      [audioPath, wav(), "audio/wav"],
      [coverPath, cover, "image/svg+xml"],
    ] as const) {
      const uploaded = await db.storage
        .from("previews")
        .upload(path, body, { contentType });
      if (uploaded.error) throw uploaded.error;
    }
    const take = await db.from("takes").insert({
      owner_id: owner,
      version_id: version.data.id,
      generation: 1,
      take_number: 1,
      audio_preview_path: audioPath,
      cover_path: coverPath,
    });
    if (take.error) throw take.error;
    const nextVersion = await db
      .from("versions")
      .insert({
        owner_id: owner,
        project_id: project.data.id,
        lang: "en",
        status: "audio_ready",
        display_title: nextTitle,
      })
      .select("id")
      .single();
    if (nextVersion.error) throw nextVersion.error;
    const nextCoverPath = `${prefix}/glass-e2e-alt.svg`;
    paths.push(nextCoverPath);
    const nextCover = Buffer.from(
      '<svg xmlns="http://www.w3.org/2000/svg" width="360" height="360"><rect width="120" height="360" fill="#14be5a"/><rect x="120" width="120" height="360" fill="#dc4614"/><rect x="240" width="120" height="360" fill="#961ed2"/></svg>',
    );
    const nextUpload = await db.storage
      .from("previews")
      .upload(nextCoverPath, nextCover, { contentType: "image/svg+xml" });
    if (nextUpload.error) throw nextUpload.error;
    const nextTake = await db.from("takes").insert({
      owner_id: owner,
      version_id: nextVersion.data.id,
      generation: 1,
      take_number: 1,
      audio_preview_path: audioPath,
      cover_path: nextCoverPath,
    });
    if (nextTake.error) throw nextTake.error;

    await page.goto("/library");
    await page.getByRole("button", { name: `Riproduci: ${title}` }).click();
    await expect(page.locator("audio")).toHaveAttribute("src", /glass-e2e/u);
    expect(
      await page
        .locator("html")
        .evaluate((el) => el.classList.contains("glass")),
    ).toBe(false);
    for (const [width, height] of sizes) {
      await page.setViewportSize({ width, height });
      await page.screenshot({ path: `${shots}/before-${width}x${height}.png` });
    }
    await page.getByRole("button", { name: "Testo" }).click();
    await expect(
      page.getByRole("group", { name: "Tema del testo" }),
    ).toHaveCount(0);
    for (const [width, height] of sizes) {
      await page.setViewportSize({ width, height });
      await page.screenshot({
        path: `${shots}/karaoke-before-${width}x${height}.png`,
      });
    }
    await page.getByRole("button", { name: "Chiudi il testo" }).click();
    await page.goto("/settings");
    await page
      .getByRole("radiogroup", { name: "Aspetto" })
      .getByRole("radio", { name: "Vetro" })
      .click();
    await expect(page.locator("html")).toHaveClass(/glass/u);
    expect(
      await page.evaluate(() => localStorage.getItem("mellodifai-glass")),
    ).toBe("on");
    await page.goto("/library");
    await expect(page.locator("html")).toHaveClass(/glass/u);
    await page.getByRole("button", { name: `Riproduci: ${title}` }).click();
    await expect(page.locator(".ambient-backdrop")).toBeVisible();
    const palette = async () =>
      page
        .locator("html")
        .evaluate((el) =>
          [1, 2, 3].map((index) =>
            el.style.getPropertyValue(`--ambient-${index}`),
          ),
        );
    await expect
      .poll(palette)
      .toEqual(["rgb(89 25 52)", "rgb(28 54 104)", "rgb(69 52 28)"]);
    await expect(page.locator(".studio-player .cover-enter")).toHaveAttribute(
      "style",
      /glass-e2e\.svg/u,
    );
    let releaseCover: (() => void) | undefined;
    const coverReady = new Promise<void>((resolve) => {
      releaseCover = resolve;
    });
    let coverBlocked = false;
    await page.route(/glass-e2e-alt\.svg/u, async (route) => {
      coverBlocked = true;
      await coverReady;
      await route.continue();
    });
    const oldLayer = await page.locator(".ambient-enter").elementHandle();
    await page.getByRole("button", { name: `Riproduci: ${nextTitle}` }).click();
    try {
      await expect.poll(() => coverBlocked).toBe(true);
      await page.waitForTimeout(150);
      expect(await oldLayer?.evaluate((element) => element.isConnected)).toBe(
        true,
      );
      await expect(page.locator(".ambient-backdrop > div")).toHaveCount(1);
      expect(await palette()).toEqual([
        "rgb(89 25 52)",
        "rgb(28 54 104)",
        "rgb(69 52 28)",
      ]);
      await expect(page.locator(".studio-player .cover-enter")).toHaveAttribute(
        "style",
        /glass-e2e\.svg/u,
      );
    } finally {
      releaseCover?.();
    }
    await expect(page.locator(".studio-player .cover-enter")).toHaveAttribute(
      "style",
      /glass-e2e-alt\.svg/u,
    );
    await expect(page.locator(".studio-player .cover-enter")).toHaveCSS(
      "animation-name",
      "ambient-cover-in",
    );
    await expect
      .poll(palette)
      .toEqual(["rgb(17 59 36)", "rgb(87 35 19)", "rgb(76 22 104)"]);
    await page.getByRole("button", { name: `Riproduci: ${title}` }).click();
    await expect
      .poll(palette)
      .toEqual(["rgb(89 25 52)", "rgb(28 54 104)", "rgb(69 52 28)"]);
    for (const [width, height] of sizes) {
      await page.setViewportSize({ width, height });
      expect(
        await page.evaluate(() => document.documentElement.scrollWidth),
      ).toBeLessThanOrEqual(width);
      await page.screenshot({ path: `${shots}/after-${width}x${height}.png` });
    }
    await page.getByRole("button", { name: "Testo" }).click();
    const dialog = page.getByRole("dialog");
    await page.setViewportSize({ width: 1440, height: 900 });
    const sampleFps = async () => {
      await page.waitForTimeout(600);
      const frames = await page.evaluate(async () => {
        const times: number[] = [];
        await new Promise<void>((resolve) => {
          const end = performance.now() + 2500;
          const tick = (now: number) => {
            times.push(now);
            if (now < end) requestAnimationFrame(tick);
            else resolve();
          };
          requestAnimationFrame(tick);
        });
        return times;
      });
      const intervals = frames
        .slice(1)
        .map((time, index) => time - frames[index]);
      return {
        fps: Math.round(
          1000 /
            (intervals.reduce((sum, interval) => sum + interval, 0) /
              intervals.length),
        ),
        frames: frames.length,
        maxIntervalMs: Math.round(Math.max(...intervals)),
      };
    };
    const classicPerf = await sampleFps();
    await dialog.getByRole("button", { name: "Vetro" }).click();
    await expect(dialog).toHaveClass(/karaoke-theme-glass/u);
    const glassPerf = await sampleFps();
    await writeFile(
      `${shots}/karaoke-perf.json`,
      JSON.stringify({ classic: classicPerf, glass: glassPerf }),
    );
    expect(glassPerf.fps).toBeGreaterThanOrEqual(classicPerf.fps - 5);
    await page.emulateMedia({ reducedMotion: "reduce" });
    expect(
      await dialog.evaluate(
        (element) => getComputedStyle(element, "::before").animationName,
      ),
    ).toBe("none");
    await page.emulateMedia({ reducedMotion: "no-preference" });
    await page.evaluate(() => {
      Object.defineProperty(document, "hidden", {
        configurable: true,
        get: () => true,
      });
      document.dispatchEvent(new Event("visibilitychange"));
    });
    await expect(page.locator("html")).toHaveAttribute(
      "data-page-hidden",
      "true",
    );
    for (const selector of [
      ".studio-sidebar",
      ".studio-player",
      ".karaoke-theme-glass header",
      ".karaoke-theme-glass footer",
    ]) {
      await expect(page.locator(selector)).toHaveCSS("backdrop-filter", "none");
    }
    await expect(page.locator(".studio-player .cover-enter")).toHaveCSS(
      "animation-name",
      "none",
    );
    await expect(page.locator(".ambient-enter")).toHaveCSS(
      "animation-name",
      "none",
    );
    expect(
      await dialog.evaluate(
        (el) => getComputedStyle(el, "::before").animationName,
      ),
    ).toBe("none");
    await page.evaluate(() => {
      Object.defineProperty(document, "hidden", {
        configurable: true,
        get: () => false,
      });
      document.dispatchEvent(new Event("visibilitychange"));
    });
    for (const [width, height] of sizes) {
      await page.setViewportSize({ width, height });
      expect(
        await page.evaluate(() => document.documentElement.scrollWidth),
      ).toBeLessThanOrEqual(width);
      await page.screenshot({
        path: `${shots}/karaoke-glass-${width}x${height}.png`,
      });
    }
    await dialog.getByRole("button", { name: "Neon" }).click();
    await expect(dialog).toHaveClass(/karaoke-theme-neon/u);
    await page.screenshot({ path: `${shots}/karaoke-neon-390x844.png` });
    await dialog.getByRole("button", { name: "Chiudi il testo" }).click();
    await page.goto("/settings");
    await page
      .getByRole("radiogroup", { name: "Tema" })
      .getByRole("radio", { name: "Tema chiaro" })
      .click();
    await page.goto("/library");
    await page.getByRole("button", { name: `Riproduci: ${title}` }).click();
    await expect(page.locator("html")).toHaveClass(/light/u);
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.screenshot({ path: `${shots}/light-glass-1440x900.png` });
    await page.goto("/settings");
    await page
      .getByRole("radiogroup", { name: "Tema" })
      .getByRole("radio", { name: "Tema scuro" })
      .click();
    await page
      .getByRole("radiogroup", { name: "Aspetto" })
      .getByRole("radio", { name: "Classico" })
      .click();
    await expect(page.locator("html")).not.toHaveClass(/glass/u);
    await page.goto("/library");
    await page.getByRole("button", { name: `Riproduci: ${title}` }).click();
    await page.getByRole("button", { name: "Testo" }).click();
    await expect(page.getByRole("dialog")).toHaveClass(
      /karaoke-theme-classic/u,
    );
    await expect(
      page.getByRole("group", { name: "Tema del testo" }),
    ).toHaveCount(0);
  } finally {
    if (paths.length) await db.storage.from("previews").remove(paths);
    if (owner) await db.auth.admin.deleteUser(owner);
    await db.from("admin_allowlist").delete().eq("email", email);
  }
});
