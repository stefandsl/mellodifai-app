import { expect, test } from "@playwright/test";
import { localSupabaseUrl } from "./local-env";
import { E2E_ADMIN_EMAIL, signIn } from "./support";

test("saved appearance bootstraps without a browser script error", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.addInitScript(() => {
    localStorage.setItem("mellodifai-theme", "light");
    localStorage.setItem("mellodifai-glass", "on");
  });
  await page.goto("/login");
  await expect(page.getByLabel("Indirizzo email")).toBeVisible();
  await expect(page.locator("html")).toHaveClass(/light/);
  await expect(page.locator("html")).toHaveClass(/glass/);
  expect(errors).toEqual([]);
});

test("exact REST counts expose Content-Range to the browser through the gateway", async ({
  page,
}) => {
  await signIn(page);
  const result = await page.evaluate(
    async ({ api, key, email }) => {
      const response = await fetch(
        `${api}rest/v1/profiles?select=id&email=eq.${encodeURIComponent(email)}`,
        {
          method: "HEAD",
          headers: {
            apikey: key,
            Authorization: `Bearer ${key}`,
            Prefer: "count=exact",
          },
        },
      );
      return {
        status: response.status,
        range: response.headers.get("content-range"),
      };
    },
    {
      api: localSupabaseUrl(),
      key: process.env.SUPABASE_SERVICE_ROLE_KEY as string,
      email: E2E_ADMIN_EMAIL,
    },
  );
  expect(result.status).toBe(200);
  expect(result.range).toBe("0-0/1");
});
