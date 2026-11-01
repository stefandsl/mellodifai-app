import { expect, test } from "@playwright/test";

import { serviceClient } from "./support";

test("an admin can use a password and a wrong password creates no session", async ({
  page,
}) => {
  const password = "e2e-password-123";
  const admin = serviceClient();
  const { data } = await admin.auth.admin.listUsers({ page: 1, perPage: 1000 });
  const user = data.users.find(
    (candidate) => candidate.email === "e2e-admin@mellodifai.test",
  );
  if (!user) throw new Error("E2E admin user was not found");
  const { error } = await admin.auth.admin.updateUserById(user.id, {
    password,
  });
  if (error) throw error;
  await page.goto("/login");
  await page.getByLabel("Indirizzo email").fill("e2e-admin@mellodifai.test");
  await page.getByLabel("Password").fill("not-the-password");
  await page.getByRole("button", { name: "Accedi" }).click();
  await expect(page.getByRole("status")).toHaveText(
    "Email o password non validi",
  );
  await expect(page).toHaveURL(/\/login$/u);
  await page.getByLabel("Password").fill(password);
  await page.getByRole("button", { name: "Accedi" }).click();
  await expect(page).toHaveURL(/\/$|\/create$/u);
});

test("non-allowlisted addresses receive the neutral login response without a session", async ({
  page,
}) => {
  const email = `not-allowed-${Date.now()}@mellodifai.test`;
  await page.goto("/login");
  await page.getByLabel("Indirizzo email").fill(email);
  await page
    .getByRole("button", { name: "Ricevi un link via email", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Invia link di accesso", exact: true })
    .click();
  await expect(page.getByRole("status")).toHaveText(
    "Se l'indirizzo è abilitato riceverai un link.",
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
