import { type ChildProcess, execFile, spawn } from "node:child_process";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { expect, type Page } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";
import { localSupabaseUrl } from "./local-env";

export const E2E_ADMIN_EMAIL =
  process.env.E2E_ADMIN_EMAIL ?? "e2e-admin@mellodifai.test";
const workerId = process.env.E2E_WORKER_ID ?? "e2e-worker";
// The e2e stack's Mailpit (supabase_inbucket_mellodifai_e2e); the live one is on 54324.
const MAILPIT_URL = process.env.MAILPIT_URL ?? "http://127.0.0.1:45624";
const workerRoot = fileURLToPath(new URL("../../worker/", import.meta.url));
const workerRequire = createRequire(
  new URL("../../worker/package.json", import.meta.url),
);

type MailpitMessage = {
  ID: string;
  To?: { Address?: string }[];
  HTML?: string;
  Text?: string;
};

function required(name: string) {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required for E2E tests`);
  return value;
}

export function serviceClient() {
  return createClient(
    localSupabaseUrl(),
    required("SUPABASE_SERVICE_ROLE_KEY"),
  );
}

async function messages(): Promise<MailpitMessage[]> {
  const response = await fetch(`${MAILPIT_URL}/api/v1/messages`);
  if (!response.ok) throw new Error("Mailpit messages request failed");
  const body = (await response.json()) as { messages?: MailpitMessage[] };
  return body.messages ?? [];
}

async function messageIdsFor(email: string) {
  return new Set(
    (await messages())
      .filter((message) =>
        message.To?.some(
          (recipient) =>
            recipient.Address?.toLowerCase() === email.toLowerCase(),
        ),
      )
      .map((message) => message.ID),
  );
}

async function magicLink(email: string, previous: Set<string>) {
  await expect
    .poll(
      async () => {
        const found = (await messages()).find(
          (message) =>
            !previous.has(message.ID) &&
            message.To?.some(
              (recipient) =>
                recipient.Address?.toLowerCase() === email.toLowerCase(),
            ),
        );
        return found?.ID;
      },
      { timeout: 30_000 },
    )
    .not.toBeUndefined();
  const latest = (await messages()).find(
    (message) =>
      !previous.has(message.ID) &&
      message.To?.some(
        (recipient) => recipient.Address?.toLowerCase() === email.toLowerCase(),
      ),
  );
  if (!latest) throw new Error("Magic link email was not found");
  const response = await fetch(`${MAILPIT_URL}/api/v1/message/${latest.ID}`);
  if (!response.ok) throw new Error("Mailpit message request failed");
  const detail = (await response.json()) as MailpitMessage;
  const body = `${detail.HTML ?? ""}\n${detail.Text ?? ""}`.replaceAll(
    "&amp;",
    "&",
  );
  const link = /https?:\/\/[^\s"'<>]+/u.exec(body)?.[0];
  if (!link) throw new Error("Magic link was not found in the email");
  return link.replace(/&quot;$/u, "");
}

export async function signIn(page: Page, email = E2E_ADMIN_EMAIL) {
  localSupabaseUrl();
  const previous = await messageIdsFor(email);
  await page.goto("/login");
  await page.getByLabel("Indirizzo email").fill(email);
  await page.getByRole("button", { name: "Invia link di accesso" }).click();
  await expect(page.getByRole("status")).toHaveText(
    "Se l'indirizzo è abilitato riceverai un link.",
  );
  await page.goto(await magicLink(email, previous));
  await expect(page).toHaveURL(/\/create$/u);
}

export async function createFrenchProject(page: Page, topic: string) {
  localSupabaseUrl();
  await page.goto("/create");
  await page.getByRole("radio", { name: "Avanzato" }).click();
  await page.getByRole("textbox", { name: "Stili" }).fill("Pop luminoso");
  await page.getByPlaceholder("Titolo della canzone (facoltativo)").fill(topic);
  await page.getByRole("button", { name: /^Lingue:/u }).click();
  const italian = page.getByRole("menuitemcheckbox", { name: /Italiano/u });
  const french = page.getByRole("menuitemcheckbox", { name: /Francese/u });
  await expect(italian).toHaveAttribute("aria-checked", "true");
  await italian.click();
  await expect(italian).toHaveAttribute("aria-checked", "false");
  await french.click();
  await expect(french).toHaveAttribute("aria-checked", "true");
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: "Crea canzone" }).click();
  await page.getByRole("link", { name: topic }).first().click();
  await expect(page).toHaveURL(/\/projects\/[0-9a-f-]+\?lang=fr/u);
}

export async function getAdminId() {
  const db = serviceClient();
  const { data, error } = await db
    .from("profiles")
    .select("id")
    .eq("email", E2E_ADMIN_EMAIL)
    .single();
  if (error || !data)
    throw error ?? new Error("E2E admin profile was not found");
  return data.id as string;
}

export async function removeE2EWorker() {
  const { error } = await serviceClient()
    .from("workers")
    .delete()
    .eq("id", workerId);
  if (error) throw error;
}

export async function startFakeWorker() {
  const supabaseUrl = localSupabaseUrl();
  const child = spawn(
    process.execPath,
    [
      workerRequire.resolve("tsx/cli"),
      fileURLToPath(new URL("../../worker/src/main.ts", import.meta.url)),
    ],
    {
      cwd: workerRoot,
      windowsHide: true,
      detached: process.platform !== "win32",
      env: {
        ...process.env,
        WORKER_FAKE: "1",
        SUPABASE_URL: supabaseUrl,
        SUPABASE_SERVICE_ROLE_KEY: required("SUPABASE_SERVICE_ROLE_KEY"),
        WORKER_ID: workerId,
        WORKER_OWNER_ID: await getAdminId(),
      },
      stdio: "ignore",
    },
  );
  await expect
    .poll(
      async () => {
        const { data } = await serviceClient()
          .from("workers")
          .select("id")
          .eq("id", workerId)
          .maybeSingle();
        return data?.id;
      },
      { timeout: 30_000 },
    )
    .toBe(workerId);
  return child;
}

export async function stopWorker(child: ChildProcess) {
  if (!child.pid) return;
  if (process.platform === "win32") {
    await new Promise<void>((resolve) => {
      const killer = execFile(
        "taskkill.exe",
        ["/PID", String(child.pid), "/T", "/F"],
        { windowsHide: true },
      );
      killer.once("close", () => resolve());
      killer.once("error", () => resolve());
    });
    return;
  }
  try {
    process.kill(-child.pid, "SIGTERM");
  } catch {
    child.kill("SIGTERM");
  }
}
