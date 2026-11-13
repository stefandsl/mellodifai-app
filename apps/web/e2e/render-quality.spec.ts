import { mkdir } from "node:fs/promises";
import { expect, test } from "@playwright/test";
import { createServerClient } from "@supabase/ssr";
import { E2E_ADMIN_EMAIL, screenshotDir, serviceClient } from "./support";

test("Video Studio keeps its 4K choice usable at desktop heights", async ({
  page,
}) => {
  const { data, error } = await serviceClient().auth.admin.generateLink({
    type: "magiclink",
    email: E2E_ADMIN_EMAIL,
  });
  if (error || !data.properties?.action_link)
    throw error ?? new Error("E2E sign-in link was not created");
  const { data: verified, error: verifyError } =
    await serviceClient().auth.verifyOtp({
      token_hash: data.properties.hashed_token,
      type: "magiclink",
    });
  if (verifyError || !verified.session)
    throw verifyError ?? new Error("E2E session was not created");
  const cookies: { name: string; value: string }[] = [];
  const auth = createServerClient(
    process.env.SUPABASE_URL ?? "",
    process.env.SUPABASE_ANON_KEY ?? "",
    {
      cookies: {
        getAll: () => cookies,
        setAll: (entries) => {
          cookies.splice(0, cookies.length, ...entries);
        },
      },
    },
  );
  const { error: sessionError } = await auth.auth.setSession({
    access_token: verified.session.access_token,
    refresh_token: verified.session.refresh_token,
  });
  if (sessionError) throw sessionError;
  await page.context().addCookies(
    cookies.map((cookie) => ({
      ...cookie,
      url: `http://127.0.0.1:${process.env.E2E_PORT ?? 3210}`,
    })),
  );
  await page.goto("/create");
  await page.getByRole("radio", { name: "Avanzato" }).click();
  await page.getByRole("radio", { name: "Visualizer" }).click();
  await page.getByRole("button", { name: "Apri Video Studio" }).click();
  const studio = page.getByTestId("video-studio");
  await expect(studio.getByRole("radio", { name: "1080p" })).toHaveAttribute(
    "aria-checked",
    "true",
  );
  await studio.getByRole("radio", { name: "4K" }).click();
  await expect(studio.getByRole("radio", { name: "4K" })).toHaveAttribute(
    "aria-checked",
    "true",
  );
  const shots = process.env.E2E_SCREENSHOT_DIR ?? screenshotDir();
  await mkdir(shots, { recursive: true });
  for (const viewport of [
    { width: 1440, height: 900 },
    { width: 1360, height: 600 },
  ]) {
    await page.setViewportSize(viewport);
    await expect(studio.getByRole("radio", { name: "4K" })).toHaveAttribute(
      "aria-checked",
      "true",
    );
    await expect(studio.getByTestId("visualizer-preview")).toBeVisible();
    await expect(
      studio.getByRole("button", { name: "Usa questo look" }),
    ).toBeVisible();
    expect(
      await studio.evaluate((el) => el.scrollWidth <= el.clientWidth),
    ).toBe(true);
    await page.screenshot({
      path: `${shots}/studio-${viewport.width}x${viewport.height}.png`,
    });
  }
});
