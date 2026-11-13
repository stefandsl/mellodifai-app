import { expect, test } from "@playwright/test";

import { serviceClient } from "./support";

test("sign in with the 6-digit code from the mail catcher", async ({
  page,
  request,
}) => {
  const email = `e2e-code-${Date.now()}@mellodifai.test`;
  const db = serviceClient();
  let userId: string | undefined;
  try {
    const { error: allowError } = await db
      .from("admin_allowlist")
      .insert({ email, role: "customer" });
    if (allowError) throw new Error("Could not allowlist OTP test user");
    const { data, error } = await db.auth.admin.createUser({
      email,
      email_confirm: true,
    });
    userId = data.user?.id;
    if (error || !userId) throw new Error("Could not create OTP test user");
    await page.goto("/login?next=%2Flibrary");
    // Fail before requesting mail if the code UI is missing.
    await expect(page.getByLabel("Codice a 6 cifre")).toBeVisible({
      timeout: 5000,
    });
    await page.getByLabel("Indirizzo email").fill(email);
    await page.getByRole("button", { name: "Invia link di accesso" }).click();
    const mailpit = process.env.MAILPIT_URL;
    if (!mailpit)
      throw new Error("MAILPIT_URL from stack.ts env-file is required");
    let messageId = "";
    await expect
      .poll(async () => {
        const response = await request.get(`${mailpit}/api/v1/messages`);
        const inbox = await response.json();
        messageId =
          inbox.messages.find(
            (message: { ID: string; To: { Address: string }[] }) =>
              message.To.some((to) => to.Address === email),
          )?.ID ?? "";
        return Boolean(messageId);
      })
      .toBe(true);
    const message = await (
      await request.get(`${mailpit}/api/v1/message/${messageId}`)
    ).json();
    const code = /\b\d{6}\b/u.exec(message.Text ?? "")?.[0];
    if (!code) throw new Error("Email did not contain a six-digit code");
    if (
      !message.HTML.includes("/auth/confirm?next=%2Flibrary") ||
      !message.HTML.includes("token_hash=")
    )
      throw new Error("Email did not contain the confirmation link");
    await page.getByLabel("Codice a 6 cifre").fill(code);
    await page.getByRole("button", { name: "Accedi con il codice" }).click();
    await expect(page).toHaveURL(/\/library$/u);
    await page.reload();
    await expect(page).toHaveURL(/\/library$/u);
  } finally {
    try {
      if (userId) {
        const { error } = await db.auth.admin.deleteUser(userId);
        expect.soft(error, "Could not delete OTP test user").toBeNull();
      }
    } finally {
      const { error } = await db
        .from("admin_allowlist")
        .delete()
        .eq("email", email);
      expect
        .soft(error, "Could not delete OTP test allowlist entry")
        .toBeNull();
    }
  }
});

test("non-allowlisted addresses receive the neutral login response without a session", async ({
  page,
}) => {
  const email = `not-allowed-${Date.now()}@mellodifai.test`;
  await page.goto("/login");
  await page.getByLabel("Indirizzo email").fill(email);
  await page.getByRole("button", { name: "Invia link di accesso" }).click();
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
