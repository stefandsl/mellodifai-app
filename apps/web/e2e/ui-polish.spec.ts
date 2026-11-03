import { expect, test } from "@playwright/test";
import { createServerClient } from "@supabase/ssr";
import { createClient } from "@supabase/supabase-js";
import { localSupabaseUrl } from "./local-env";
import { serviceClient } from "./support";

const email = "e2e-ui-visual-20261103@mellodifai.test";

if (process.platform !== "win32")
  throw new Error("UI image baselines require the Windows visual test gate");

test.beforeEach(async ({ page, baseURL }) => {
  if (!baseURL) throw new Error("E2E base URL required");
  const db = serviceClient();
  const { error: allowError } = await db
    .from("admin_allowlist")
    .upsert({ email }, { onConflict: "email" });
  if (allowError) throw allowError;
  const { data: users, error: usersError } = await db.auth.admin.listUsers({
    perPage: 1000,
  });
  if (usersError) throw usersError;
  let user = users.users.find((entry) => entry.email === email);
  if (!user) {
    const { data, error } = await db.auth.admin.createUser({
      email,
      email_confirm: true,
    });
    if (error) throw error;
    user = data.user;
  }
  const { error: profileError } = await db
    .from("profiles")
    .upsert({ id: user.id, email, role: "admin" });
  if (profileError) throw profileError;

  // The shared Mailpit can hit its global OTP rate limit; the local admin link keeps
  // this visual check independent of other agents' sign-in traffic.
  const { data, error } = await db.auth.admin.generateLink({
    type: "magiclink",
    email,
  });
  if (error) throw error;
  const url = localSupabaseUrl();
  const anon = process.env.SUPABASE_ANON_KEY ?? "";
  const auth = createClient(url, anon, { auth: { persistSession: false } });
  const verified = await auth.auth.verifyOtp({
    type: "magiclink",
    token_hash: data.properties.hashed_token,
  });
  if (verified.error || !verified.data.session)
    throw new Error("Local visual test sign-in failed");
  const cookies: { name: string; value: string }[] = [];
  const server = createServerClient(url, anon, {
    cookies: {
      getAll: () => cookies,
      setAll: (items) => {
        cookies.push(...items);
      },
    },
  });
  const saved = await server.auth.setSession(verified.data.session);
  if (saved.error) throw new Error("Local visual test session save failed");
  await page
    .context()
    .addCookies(
      cookies.map(({ name, value }) => ({ name, value, url: baseURL })),
    );
});

test("mobile remake selectors and action fit", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/create");
  await page.getByRole("button", { name: "Crea" }).last().click();
  const country = page.getByRole("combobox", { name: "Paese" });
  const action = page.getByRole("button", { name: "Analizza" });
  const countryBox = await country.boundingBox();
  const actionBox = await action.boundingBox();
  if (!countryBox || !actionBox) throw new Error("Remake controls missing");
  expect(countryBox.width).toBeGreaterThan(130);
  expect(actionBox.y).toBeGreaterThan(countryBox.y + countryBox.height);
  await expect(
    page.locator('section[aria-labelledby="remake-title"]').last(),
  ).toHaveScreenshot("remake-mobile.png");
});

test("mobile library filters fit without a clipped strip", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/library");
  const filters = page.getByRole("button", { name: "Filtri" });
  await expect(filters).toBeVisible();
  await expect(page.getByRole("button", { name: "Da fare" })).toBeHidden();
  await expect(page.locator("main header").first()).toHaveScreenshot(
    "library-header-mobile.png",
  );
});

test.afterAll(async () => {
  const db = serviceClient();
  const { data, error } = await db.auth.admin.listUsers({ perPage: 1000 });
  if (error) throw error;
  const user = data.users.find((entry) => entry.email === email);
  if (user) {
    const deleted = await db.auth.admin.deleteUser(user.id);
    if (deleted.error) throw deleted.error;
  }
  const allow = await db.from("admin_allowlist").delete().eq("email", email);
  if (allow.error) throw allow.error;
});

test("mobile Video Studio header shows its full subtitle", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/create");
  await page.getByRole("button", { name: "Crea" }).last().click();
  await page.getByRole("radio", { name: "Avanzato" }).click();
  await page.getByRole("radio", { name: "Visualizer" }).last().click();
  await page.getByRole("button", { name: "Apri Video Studio" }).click();
  const studio = page.getByTestId("video-studio");
  const subtitle = studio.getByText(
    "Il look del video visualizer delle prossime canzoni",
  );
  await expect(subtitle).toBeVisible();
  expect(
    await subtitle.evaluate((element) => getComputedStyle(element).whiteSpace),
  ).not.toBe("nowrap");
  await expect(studio.locator("header")).toHaveScreenshot(
    "video-header-mobile.png",
  );
});

test("subtle text meets AA contrast in both themes", async ({ page }) => {
  await page.goto("/settings");
  for (const theme of ["dark", "light"] as const) {
    if (theme === "light")
      await page.getByRole("radio", { name: "Tema chiaro" }).click();
    const ratio = await page.evaluate(() => {
      const root = getComputedStyle(document.documentElement);
      const parts = (value: string) =>
        value.match(/[\d.]+/gu)?.map(Number) ?? [];
      const hex = root.getPropertyValue("--fg-subtle").trim();
      const [fr, fg, fb, alpha] = hex.startsWith("#")
        ? [1, 3, 5, 7]
            .map((at) => Number.parseInt(hex.slice(at, at + 2), 16))
            .map((value, index) => (index === 3 ? value / 255 : value))
        : parts(hex);
      const [br, bg, bb] = parts(
        getComputedStyle(document.body).backgroundColor,
      );
      const light = (n: number) => {
        const x = n / 255;
        return x <= 0.04045 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4;
      };
      const luminance = (rgb: number[]) =>
        rgb.reduce(
          (sum, value, index) =>
            sum + light(value) * [0.2126, 0.7152, 0.0722][index],
          0,
        );
      const back = [br, bg, bb];
      const front = [fr, fg, fb].map(
        (value, index) => value * alpha + back[index] * (1 - alpha),
      );
      const a = luminance(front);
      const b = luminance(back);
      return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
    });
    expect(ratio).toBeGreaterThanOrEqual(4.5);
  }
});
