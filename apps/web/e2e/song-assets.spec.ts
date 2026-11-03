import type { ChildProcess } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { expect, test } from "@playwright/test";
import { createServerClient } from "@supabase/ssr";
import { localSupabaseUrl } from "./local-env";
import {
  createFrenchProject,
  serviceClient,
  startFakeWorker,
  stopWorker,
} from "./support";

let worker: ChildProcess | undefined;
let email: string;

test.beforeAll(async () => {
  email = `e2e-song-assets-${Date.now()}@mellodifai.test`;
  const db = serviceClient();
  const { data, error } = await db.auth.admin.createUser({
    email,
    email_confirm: true,
  });
  if (error || !data.user) throw error ?? new Error("Test user missing");
  const { error: profileError } = await db
    .from("profiles")
    .insert({ id: data.user.id, email, role: "admin" });
  if (profileError) throw profileError;
  worker = await startFakeWorker(data.user.id, `e2e-song-assets-${Date.now()}`);
});

test.afterAll(async () => {
  if (worker) await stopWorker(worker);
});

test("two songs keep their own storyboard, thumbnail and publish kit", async ({
  page,
}) => {
  test.setTimeout(240_000);
  const db = serviceClient();
  const { data: link, error: linkError } = await db.auth.admin.generateLink({
    type: "magiclink",
    email,
  });
  if (linkError || !link.properties?.hashed_token)
    throw linkError ?? new Error("Login token missing");
  const { data: verified, error: verifyError } = await db.auth.verifyOtp({
    token_hash: link.properties.hashed_token,
    type: "magiclink",
  });
  if (verifyError || !verified.session)
    throw verifyError ?? new Error("Login session missing");
  const cookies: {
    name: string;
    value: string;
    options: {
      path?: string;
      maxAge?: number;
      httpOnly?: boolean;
      sameSite?: boolean | "lax" | "strict" | "none";
      secure?: boolean;
    };
  }[] = [];
  const browserSession = createServerClient(
    localSupabaseUrl(),
    process.env.SUPABASE_ANON_KEY ?? "",
    {
      cookies: {
        getAll: () => [],
        setAll: (items) => {
          cookies.push(...items);
        },
      },
    },
  );
  const { error: sessionError } = await browserSession.auth.setSession(
    verified.session,
  );
  if (sessionError) throw sessionError;
  await page.context().addCookies(
    cookies.map((cookie) => ({
      name: cookie.name,
      value: cookie.value,
      url: "http://127.0.0.1:3223",
      httpOnly: cookie.options.httpOnly ?? false,
      sameSite:
        cookie.options.sameSite === "strict"
          ? "Strict"
          : cookie.options.sameSite === "none"
            ? "None"
            : "Lax",
      secure: cookie.options.secure ?? false,
    })),
  );
  await page.goto("/create");
  const songs = ["Luce sul porto", "Pioggia di novembre"];
  const assets: {
    title: string;
    storyboard: string;
    thumbnail: string;
    metadata: string;
  }[] = [];

  for (const title of songs) {
    await createFrenchProject(page, title);
    const projectId = /\/projects\/([^?]+)/u.exec(page.url())?.[1];
    if (!projectId) throw new Error("Project id missing");
    await expect(page.getByText("FR Revisione testi")).toBeVisible();
    await page.getByLabel("Titolo").fill(title);
    const lyricField = page.locator("#lyric-lyrics");
    const originalLyrics = await lyricField.inputValue();
    await lyricField.fill(
      originalLyrics
        .split(/\r?\n/u)
        .map((line, index) =>
          line.startsWith("[") ? line : `${title}, line ${index}`,
        )
        .join("\n"),
    );
    await page
      .getByRole("button", {
        name: "Approva e genera la canzone: 12 crediti kie",
      })
      .click();
    await page
      .getByRole("alertdialog")
      .getByRole("button", { name: "Conferma" })
      .click();
    await expect(page.getByText("FR Revisione take")).toBeVisible();
    await page.getByRole("button", { name: "Scegli" }).first().click();
    await expect(page.getByText("FR Revisione video")).toBeVisible();
    if (title === songs[0]) {
      const { data: before } = await db
        .from("versions")
        .select("storyboard_path,render_attempt")
        .eq("project_id", projectId)
        .eq("lang", "fr")
        .single();
      if (!before?.storyboard_path) throw new Error("First storyboard missing");
      await page.getByRole("button", { name: "Rigenera video" }).click();
      await expect
        .poll(async () => {
          const { data } = await db
            .from("versions")
            .select("render_attempt")
            .eq("project_id", projectId)
            .eq("lang", "fr")
            .single();
          return data?.render_attempt;
        })
        .toBe(before.render_attempt + 1);
      await expect
        .poll(async () => {
          const { data } = await db
            .from("versions")
            .select("status")
            .eq("project_id", projectId)
            .eq("lang", "fr")
            .single();
          return data?.status;
        })
        .toBe("video_review");
      await page.reload();
      await expect(page.getByText("FR Revisione video")).toBeVisible();
      expect(await readFile(before.storyboard_path, "utf8")).toContain(title);
    }
    await page.getByRole("button", { name: "Approva video" }).click();
    await expect(page.getByText("FR Approvato")).toBeVisible();
    if (title === songs[0]) {
      const { data: previous } = await db
        .from("versions")
        .select("id,chosen_take_id,render_attempt,storyboard_path")
        .eq("project_id", projectId)
        .eq("lang", "fr")
        .single();
      if (!previous) throw new Error("Previous version missing");
      const { data: alternate } = await db
        .from("takes")
        .select("id")
        .eq("version_id", previous.id)
        .neq("id", previous.chosen_take_id)
        .limit(1)
        .single();
      if (!alternate) throw new Error("Alternate take missing");
      const switchedLyrics =
        "[Verse 1]\nLa mer chante une autre histoire\n[Chorus]\nLe vent nous ramène au port";
      expect(
        (
          await serviceClient()
            .from("takes")
            .update({ lyrics: switchedLyrics })
            .eq("id", alternate.id)
        ).error,
      ).toBeNull();
      expect(
        (
          await browserSession.rpc("choose_take", {
            p_version: previous.id,
            p_take: alternate.id,
          })
        ).error,
      ).toBeNull();
      await page.reload();
      await expect(page.getByLabel("Descrizione")).toHaveCount(0);
      await expect(page.getByText("FR Revisione video")).toBeVisible();
      await page.getByRole("button", { name: "Approva video" }).click();
      await expect(page.getByText("FR Approvato")).toBeVisible();
      expect(await page.getByLabel("Descrizione").inputValue()).toContain(
        "La mer chante une autre histoire",
      );
      const { data: current } = await db
        .from("versions")
        .select("render_attempt,storyboard_path")
        .eq("id", previous.id)
        .single();
      expect(current?.render_attempt).toBe(previous.render_attempt + 1);
      expect(current?.storyboard_path).not.toBe(previous.storyboard_path);
      expect(await readFile(previous.storyboard_path, "utf8")).toContain(title);
      expect(await readFile(current?.storyboard_path, "utf8")).not.toBe(
        await readFile(previous.storyboard_path, "utf8"),
      );
    }
    await expect(
      page.getByRole("img", { name: "Miniatura del video" }),
    ).toBeVisible();
    await expect(page.getByLabel("Titolo video")).toHaveValue(
      `${title} | Vidéo avec paroles`,
    );
    const description = await page.getByLabel("Descrizione").inputValue();
    expect(description).toContain(title);
    expect(description).toContain(
      "Créé avec des outils d’intelligence artificielle.",
    );
    expect(description).not.toContain("Creato con strumenti AI.");
    expect(description).not.toMatch(/AIMELODIA|STEFANDSL\.COM/iu);
    await page
      .locator("details")
      .filter({ hasText: "Storyboard" })
      .first()
      .locator("summary")
      .click();
    await expect(page.getByText("Verse 1", { exact: true })).toBeVisible();
    const shots = "E:/mellodifai/codex-streams/song-assets/shots";
    await mkdir(shots, { recursive: true });
    for (const [width, height] of [
      [1440, 900],
      [1360, 600],
    ] as const) {
      await page.setViewportSize({ width, height });
      await page
        .locator("details")
        .filter({ hasText: "Storyboard" })
        .first()
        .scrollIntoViewIfNeeded();
      await page.screenshot({
        path: join(
          shots,
          `${title === songs[0] ? "porto" : "novembre"}-top-${width}x${height}.png`,
        ),
        animations: "disabled",
      });
      await page.getByLabel("Descrizione").scrollIntoViewIfNeeded();
      await page.screenshot({
        path: join(
          shots,
          `${title === songs[0] ? "porto" : "novembre"}-publish-${width}x${height}.png`,
        ),
        animations: "disabled",
      });
    }

    const { data: version, error } = await db
      .from("versions")
      .select("id,lyric_pack,storyboard_path,chosen_take_id,render_attempt")
      .eq("project_id", projectId)
      .eq("lang", "fr")
      .single();
    if (error || !version) throw error ?? new Error("Version missing");
    const storyboard = await readFile(version.storyboard_path, "utf8");
    expect(storyboard).toContain(title);
    expect(storyboard).not.toMatch(/AIMELODIA|STEFANDSL\.COM/iu);
    const { data: render, error: renderError } = await db
      .from("renders")
      .select("id,preview_path,qa_results,render_attempt")
      .eq("version_id", version.id)
      .eq("kind", "master")
      .order("created_at", { ascending: false })
      .limit(1)
      .single();
    if (renderError || !render?.preview_path)
      throw renderError ?? new Error("Render missing");
    const thumbnailPath = `${render.preview_path.slice(0, render.preview_path.lastIndexOf("/"))}/thumbnail.png`;
    expect(render.render_attempt).toBe(version.render_attempt);
    expect(render.qa_results).toMatchObject({
      assets: {
        storyboard_path: version.storyboard_path,
        thumbnail_path: thumbnailPath,
        chosen_take_id: version.chosen_take_id,
        title,
        lang: "fr",
      },
    });
    const { data: thumbnail, error: storageError } = await db.storage
      .from("previews")
      .download(thumbnailPath);
    if (storageError || !thumbnail)
      throw storageError ?? new Error("Thumbnail missing");
    assets.push({
      title: (version.lyric_pack as { title: string }).title,
      storyboard,
      thumbnail: createHash("sha256")
        .update(Buffer.from(await thumbnail.arrayBuffer()))
        .digest("hex"),
      metadata: description,
    });
    await page.getByRole("button", { name: "Carica come privato" }).click();
    await expect(
      page.getByRole("button", { name: "Rendi pubblico" }),
    ).toBeVisible();
    const { data: publication, error: publicationError } = await db
      .from("publications")
      .select("metadata")
      .eq("render_id", render.id)
      .single();
    if (publicationError || !publication)
      throw publicationError ?? new Error("Publication missing");
    expect(publication.metadata).toMatchObject({
      title: `${title} | Vidéo avec paroles`,
      description,
      defaultLanguage: "fr",
      defaultAudioLanguage: "fr",
    });
  }
  expect(assets.map((asset) => asset.title)).toEqual(songs);
  expect(assets[0].storyboard).not.toBe(assets[1].storyboard);
  expect(assets[0].thumbnail).not.toBe(assets[1].thumbnail);
  expect(assets[0].metadata).not.toBe(assets[1].metadata);
});
