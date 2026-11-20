import type { ChildProcess } from "node:child_process";
import { join } from "node:path";
import { expect, test } from "@playwright/test";
import { createServerClient } from "@supabase/ssr";
import { localSupabaseUrl } from "./local-env";
import {
  createFrenchProject,
  screenshotDir,
  serviceClient,
  startFakeWorker,
  stopWorker,
} from "./support";
import { oauthSql } from "./support/oauth-client";

// Cover candidates (PIANO-UNIFICATO M2b) end to end on the e2e stack: the fake worker renders the
// song and makes three covers from the video's own frames; the owner picks one in "Pubblica" at
// phone size and the saved plan shows that pick.

let worker: ChildProcess | undefined;
let email: string;

test.beforeAll(async () => {
  email = `e2e-covers-${Date.now()}@mellodifai.test`;
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
  worker = await startFakeWorker(data.user.id, `e2e-covers-${Date.now()}`);
});

test.afterAll(async () => {
  if (worker) await stopWorker(worker);
});

async function reached(projectId: string, status: string) {
  await expect
    .poll(
      async () => {
        const { data } = await serviceClient()
          .from("versions")
          .select("status")
          .eq("project_id", projectId)
          .eq("lang", "fr")
          .single();
        return data?.status;
      },
      { timeout: 180_000, intervals: [1_000] },
    )
    .toBe(status);
}

test("render, pick a cover at phone size, the plan shows it", async ({
  page,
}) => {
  test.setTimeout(240_000);
  const title = `Copertina ${Date.now()}`;
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
  await page.goto("/create");
  await createFrenchProject(page, title);
  const projectId = /\/projects\/([^?]+)/u.exec(page.url())?.[1];
  if (!projectId) throw new Error("Project id missing");
  await reached(projectId, "lyrics_review");
  await page.reload();
  await expect(page.getByText("FR Revisione testi")).toBeVisible();
  await page.getByLabel("Titolo").fill(title);
  await page
    .getByRole("button", {
      name: "Approva e genera la canzone: 12 crediti kie",
    })
    .click();
  await page
    .getByRole("alertdialog")
    .getByRole("button", { name: "Conferma" })
    .click();
  // The native stack has no Realtime: wait for the worker in the database, then reload.
  await reached(projectId, "takes_review");
  await page.reload();
  await expect(page.getByText("FR Revisione take")).toBeVisible();
  await page.getByRole("button", { name: "Scegli" }).first().click();
  await reached(projectId, "video_review");
  await page.reload();
  await expect(page.getByText("FR Revisione video")).toBeVisible();
  await page.getByRole("button", { name: "Approva video" }).click();
  await reached(projectId, "approved");
  await page.reload();
  await expect(page.getByText("FR Approvato")).toBeVisible();

  // The art stage stored three candidates with provenance in this render attempt's folder.
  const { data: version } = await db
    .from("versions")
    .select("id,render_attempt")
    .eq("project_id", projectId)
    .eq("lang", "fr")
    .single();
  if (!version) throw new Error("Version missing");
  const { data: master } = await db
    .from("renders")
    .select("qa_results")
    .eq("version_id", version.id)
    .eq("kind", "master")
    .eq("render_attempt", version.render_attempt)
    .single();
  const candidates = (
    master?.qa_results as {
      assets?: {
        cover_candidates?: {
          id: string;
          path: string;
          source: { kind: string; render_attempt: number };
          phone: { min_line_px: number };
        }[];
      };
    }
  )?.assets?.cover_candidates;
  expect(candidates?.map((cover) => cover.id)).toEqual([
    "cover-1",
    "cover-2",
    "cover-3",
  ]);
  for (const cover of candidates ?? []) {
    expect(cover.path).toMatch(
      new RegExp(`/${version.id}/${version.render_attempt}/${cover.id}\\.png$`),
    );
    expect(cover.source).toMatchObject({
      kind: "render_frame",
      render_attempt: version.render_attempt,
    });
    expect(cover.phone.min_line_px).toBeGreaterThanOrEqual(8);
  }

  // Console errors and page errors on "Pubblica" (hydration mismatches included).
  const errors: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error" && /\/publish/u.test(page.url()))
      errors.push(message.text());
  });
  page.on("pageerror", (error) => {
    if (/\/publish/u.test(page.url())) errors.push(error.message);
  });
  await page.goto(`/projects/${projectId}/publish?lang=fr`);
  await page.getByRole("button", { name: "Prepara la pubblicazione" }).click();
  const picker = page.getByTestId("cover-picker");
  await expect(picker.getByRole("radio")).toHaveCount(4);
  // Each candidate is shown at YouTube's phone size and its image really loads.
  const second = picker.locator('[data-cover="cover-2"]');
  expect(await second.boundingBox()).toMatchObject({ width: 168, height: 94 });
  await expect
    .poll(() =>
      second
        .locator("img")
        .evaluate((img: HTMLImageElement) => img.naturalWidth),
    )
    .toBe(1280);
  await second.click();
  await expect(
    picker.getByRole("radio", { name: /^Copertina 2,/u }),
  ).toBeChecked();
  const coverSrc = await second.locator("img").getAttribute("src");
  await expect(page.getByTestId("preview-image")).toHaveAttribute(
    "src",
    coverSrc ?? "",
  );
  await page.getByRole("button", { name: "Salva bozza" }).click();
  await expect(page.getByText("Bozza salvata")).toBeVisible();

  // The saved plan (what the approval hash covers) holds the pick, also after a reload.
  const sql = oauthSql();
  try {
    await expect
      .poll(async () => {
        const [row] =
          await sql`select d.draft->>'cover' as cover from public.publish_destinations d
            join public.publish_schedules s on s.id=d.schedule_id where s.version_id=${version.id}`;
        return row?.cover as string | undefined;
      })
      .toBe("cover-2");
  } finally {
    await sql.end();
  }
  await page.reload();
  await expect(
    page
      .getByTestId("cover-picker")
      .getByRole("radio", { name: /^Copertina 2,/u }),
  ).toBeChecked();
  await expect(page.getByTestId("preview-image")).toHaveAttribute(
    "src",
    coverSrc ?? "",
  );
  expect(errors).toEqual([]);
  await page.setViewportSize({ width: 390, height: 844 });
  await picker.scrollIntoViewIfNeeded();
  expect(
    await page.evaluate(
      () =>
        document.documentElement.scrollWidth -
        document.documentElement.clientWidth,
    ),
  ).toBeLessThanOrEqual(0);
  await page.screenshot({
    path: join(screenshotDir(), "covers-pick-390x844.png"),
  });
  await page.setViewportSize({ width: 1440, height: 900 });
  await picker.scrollIntoViewIfNeeded();
  await page.screenshot({
    path: join(screenshotDir(), "covers-pick-1440x900.png"),
  });
});
