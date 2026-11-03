import type { ChildProcess } from "node:child_process";
import { mkdir } from "node:fs/promises";
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
  email = `e2e-rerender-${Date.now()}@mellodifai.test`;
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
  worker = await startFakeWorker(data.user.id, `e2e-rerender-${Date.now()}`);
});

test.afterAll(async () => {
  if (worker) await stopWorker(worker);
});

test("published song starts a new render and keeps its original publication", async ({
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
      url: `http://127.0.0.1:${process.env.E2E_PORT ?? 3210}`,
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

  const title = `Nuovo render ${Date.now()}`;
  await createFrenchProject(page, title);
  const projectId = /\/projects\/([^?]+)/u.exec(page.url())?.[1];
  if (!projectId) throw new Error("Project id missing");
  await expect(page.getByText("FR Revisione testi")).toBeVisible();
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
  await page.getByRole("button", { name: "Approva video" }).click();
  await expect(
    page.getByRole("button", { name: "Nuovo render" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Carica come privato" }).click();
  await expect(
    page.getByRole("button", { name: "Rendi pubblico" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Rendi pubblico" }).click();
  await page
    .getByRole("alertdialog")
    .getByRole("button", { name: "Conferma" })
    .click();
  await expect(page.getByText("FR Pubblicato")).toBeVisible();

  const { data: version } = await db
    .from("versions")
    .select("id,render_attempt,storyboard_path")
    .eq("project_id", projectId)
    .eq("lang", "fr")
    .single();
  if (!version) throw new Error("Version missing");
  const { data: original } = await db
    .from("renders")
    .select("id,path,preview_path,qa_results")
    .eq("version_id", version.id)
    .eq("kind", "master")
    .eq("render_attempt", version.render_attempt)
    .single();
  if (!original?.preview_path) throw new Error("Original render missing");
  const { data: publication } = await db
    .from("publications")
    .select("id,render_id,metadata,privacy,youtube_video_id")
    .eq("render_id", original.id)
    .single();
  if (!publication) throw new Error("Publication missing");

  await page.getByRole("button", { name: "Nuovo render" }).click();
  await expect(page.getByText("FR Revisione video")).toBeVisible({
    timeout: 60_000,
  });
  const { data: newVersion } = await db
    .from("versions")
    .select("render_attempt,storyboard_path")
    .eq("id", version.id)
    .single();
  expect(newVersion?.render_attempt).toBe(version.render_attempt + 1);
  const { data: fresh } = await db
    .from("renders")
    .select("id,path,preview_path,qa_results")
    .eq("version_id", version.id)
    .eq("kind", "master")
    .eq("render_attempt", newVersion?.render_attempt)
    .single();
  if (!fresh?.preview_path) throw new Error("New render missing");
  expect(fresh.id).not.toBe(original.id);
  expect(fresh.path).not.toBe(original.path);
  expect(fresh.preview_path).not.toBe(original.preview_path);
  expect(fresh.qa_results).toMatchObject({
    assets: {
      storyboard_path: newVersion?.storyboard_path,
      lyric_pack: (original.qa_results as { assets: { lyric_pack: unknown } })
        .assets.lyric_pack,
    },
  });
  await expect(page.locator("video").first()).toHaveAttribute(
    "src",
    /\/media\/previews\//u,
  );
  await page.getByRole("button", { name: "Approva video" }).click();
  await expect(
    page.getByRole("button", { name: "Nuovo render" }),
  ).toBeVisible();
  for (const [width, height] of [
    [1440, 900],
    [1360, 600],
  ] as const) {
    await page.setViewportSize({ width, height });
    await page.reload();
    await expect(
      page.getByRole("button", { name: "Nuovo render" }),
    ).toBeVisible();
    const shots = "E:/mellodifai/codex-streams/rerender/shots";
    await mkdir(shots, { recursive: true });
    await page.screenshot({
      path: join(shots, `rerender-${width}x${height}.png`),
      animations: "disabled",
    });
  }
  const { data: oldAfter } = await db
    .from("renders")
    .select("id,path,preview_path,qa_results")
    .eq("id", original.id)
    .single();
  expect(oldAfter).toMatchObject(original);
  const { data: publicationAfter } = await db
    .from("publications")
    .select("id,render_id,metadata,privacy,youtube_video_id")
    .eq("id", publication.id)
    .single();
  expect(publicationAfter).toMatchObject(publication);
  expect(
    (await db.storage.from("previews").download(original.preview_path)).error,
  ).toBeNull();
  const oldThumbnail = (
    original.qa_results as { assets?: { thumbnail_path?: string } }
  ).assets?.thumbnail_path;
  if (!oldThumbnail) throw new Error("Original thumbnail missing");
  expect(
    (await db.storage.from("previews").download(oldThumbnail)).error,
  ).toBeNull();
});
