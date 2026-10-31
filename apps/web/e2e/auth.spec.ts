import { expect, test } from "@playwright/test";

import { serviceClient } from "./support";

test("non-allowlisted addresses receive the neutral login response without a session", async ({
  page,
}) => {
  const email = `not-allowed-${Date.now()}@mellodifai.test`;
  await page.goto("/login");
  await page.getByLabel("Indirizzo email").fill(email);
  await page.getByRole("button", { name: "Invia link di accesso" }).click();
  await expect(page.getByRole("status")).toHaveText(
    "Se l'indirizzo e' abilitato riceverai un link.",
  );
  await page.goto("/library");
  await expect(page).toHaveURL(/\/login$/u);
  const { data, error } = await serviceClient()
    .from("profiles")
    .select("id")
    .eq("email", email);
  if (error) throw error;
  expect(data).toHaveLength(0);
});
