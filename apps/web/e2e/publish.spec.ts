import type { ChildProcess } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import {
  type APIRequestContext,
  expect,
  type Page,
  test,
} from "@playwright/test";
import {
  getAdminId,
  screenshotDir,
  serviceClient,
  signIn,
  startFakeWorker,
  stopWorker,
} from "./support";
import { oauthSql } from "./support/oauth-client";

// A 1x1 PNG: the master's base thumbnail, as the render stage leaves it in Storage and next to
// the video on the worker PC (thumbnail text needs it).
const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=",
  "base64",
);
const MASTER = join(
  process.env.MELLODIFAI_ROOT ?? "E:/mellodifai/native-lab",
  "e2e-publish",
  "master.mp4",
);

// "Pubblica" end to end on the e2e stack: the owner schedules and vetoes, an agent asks and the
// owner approves in the app, the fake worker flips the private upload public at the slot, and a
// standing rule from the settings page approves by itself. YouTube is the fake client.

test.describe.configure({ mode: "serial" });

const PACK = {
  title: "Luce di prova",
  lyrics: "Una riga di prova\nUn'altra riga\nAncora una\nFine",
  style: "pop",
  exclude: "",
  settings: { model: "V5" },
  displayMap: {},
  l10n: {},
};

async function approvedVideo(title: string) {
  const owner = await getAdminId();
  const db = serviceClient();
  const project = await db
    .from("projects")
    .insert({ owner_id: owner, topic: title })
    .select("id")
    .single();
  if (project.error) throw project.error;
  const version = await db
    .from("versions")
    .insert({
      owner_id: owner,
      project_id: project.data.id,
      lang: "it",
      status: "approved",
      display_title: title,
      lyric_pack: { ...PACK, title },
    })
    .select("id,render_attempt")
    .single();
  if (version.error) throw version.error;
  const render = await db
    .from("renders")
    .insert({
      owner_id: owner,
      version_id: version.data.id,
      kind: "master",
      render_attempt: version.data.render_attempt,
      path: MASTER,
      approved_at: new Date().toISOString(),
    })
    .select("id")
    .single();
  if (render.error) throw render.error;
  const folder = `${owner}/${render.data.id}`;
  const base = await db.storage
    .from("previews")
    .upload(`${folder}/thumbnail.png`, PNG, { contentType: "image/png" });
  if (base.error) throw base.error;
  const preview = await db
    .from("renders")
    .update({ preview_path: `${folder}/master.mp4` })
    .eq("id", render.data.id);
  if (preview.error) throw preview.error;
  await mkdir(dirname(MASTER), { recursive: true });
  await writeFile(join(dirname(MASTER), "thumbnail.png"), PNG);
  return {
    project: project.data.id as string,
    version: version.data.id as string,
  };
}

// A PAT of the e2e admin, written like admin_token_create does (hash only).
async function agentToken() {
  const token = `mdf_pat_${randomBytes(32).toString("hex").slice(0, 43)}`;
  const sql = oauthSql();
  try {
    const [row] =
      await sql`insert into public.agent_tokens (owner_id, kind, name, token_hash, token_hint, scopes, remote, test_mode)
      values (${await getAdminId()}, 'pat', 'E2E publish agent', ${createHash("sha256").update(token).digest("hex")},
        ${`mdf_pat_...${token.slice(-4)}`}, ${["read", "create", "spend"]}, false, false) returning id`;
    // A spend token needs its daily cap, as admin_token_create writes it.
    await sql`insert into public.spend_caps (scope, key, period, "limit") values ('token', ${row.id}, 'day', 1)`;
  } finally {
    await sql.end();
  }
  return token;
}

async function api(
  request: APIRequestContext,
  token: string,
  method: "GET" | "POST",
  path: string,
  data?: unknown,
) {
  const response = await request.fetch(`/api/v1${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      ...(method === "POST" ? { "Idempotency-Key": crypto.randomUUID() } : {}),
    },
    ...(data === undefined ? {} : { data }),
  });
  expect(response.status(), path).toBe(200);
  return (await response.json()).data;
}

const inHours = (hours: number) =>
  new Date(Date.now() + hours * 3_600_000).toISOString();
// datetime-local in Rome time, like the dashboard reads it.
function romeLocal(iso: string) {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-GB", {
      timeZone: "Europe/Rome",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    })
      .formatToParts(new Date(iso))
      .map((part) => [part.type, part.value]),
  );
  return `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}`;
}

async function schedule(id: string) {
  const sql = oauthSql();
  try {
    const [row] =
      await sql`select state from public.publish_schedules where id=${id}`;
    return row?.state as string | undefined;
  } finally {
    await sql.end();
  }
}

// Console errors and page errors on the publishing pages (hydration mismatches included).
function watchErrors(page: Page) {
  const errors: string[] = [];
  const onPublishing = () =>
    /\/publish|\/settings\/publishing/u.test(page.url());
  page.on("console", (message) => {
    if (message.type() === "error" && onPublishing())
      errors.push(message.text());
  });
  page.on("pageerror", (error) => {
    if (onPublishing()) errors.push(error.message);
  });
  return errors;
}

async function noOverflow(page: Page, name: string) {
  for (const [width, height] of [
    [1440, 900],
    [1360, 600],
  ] as const) {
    await page.setViewportSize({ width, height });
    expect(
      await page.evaluate(
        () =>
          document.documentElement.scrollWidth -
          document.documentElement.clientWidth,
      ),
    ).toBeLessThanOrEqual(0);
    await page.screenshot({
      path: join(screenshotDir(), `publish-${name}-${width}x${height}.png`),
      fullPage: true,
      // The default hidden caret restyles inputs; on a page still hydrating
      // that reads as a hydration mismatch.
      caret: "initial",
    });
  }
}

test("the owner plans, schedules with a veto window and vetoes: the video stays private", async ({
  page,
}) => {
  test.setTimeout(120_000);
  const title = `E2E pubblica ${Date.now()}`;
  const { project } = await approvedVideo(title);
  const errors = watchErrors(page);
  await signIn(page);
  await page.goto(`/projects/${project}?lang=it`);
  await page.getByRole("link", { name: "Pubblica" }).click();
  await expect(page).toHaveURL(new RegExp(`/projects/${project}/publish`));
  await expect(
    page.getByRole("heading", { name: "Pubblica", level: 1 }),
  ).toBeVisible();
  const platforms = page.getByRole("region", { name: "Piattaforme" });
  await expect(platforms.getByText("YouTube")).toBeVisible();
  await expect(platforms.getByText("TikTok")).toBeVisible();
  await expect(platforms.getByText("Presto")).toHaveCount(8);

  await page.getByRole("button", { name: "Prepara la pubblicazione" }).click();
  const titleBox = page.getByLabel("Titolo", { exact: true });
  await expect(titleBox).toHaveValue(new RegExp(title));
  // The pairing lint: a thumbnail text that repeats the title is a warning, never a block.
  await page.getByLabel("Testo della miniatura").fill("Pubblica adesso");
  await expect(page.getByTestId("lint-warnings")).toContainText(
    "ripete parole del titolo",
  );
  await titleBox.fill("x".repeat(101));
  await expect(page.getByTestId("lint-errors")).toContainText(
    "Titolo: al massimo 100 caratteri",
  );
  await expect(page.getByRole("button", { name: "Programma" })).toBeDisabled();
  await titleBox.fill(title);
  await page
    .getByLabel("Slot di pubblicazione (ora di Roma)")
    .fill(romeLocal(inHours(3)));
  await page.getByRole("button", { name: "Programma" }).click();
  await expect(page.getByTestId("publish-state")).toHaveText(
    "Programmato, veto aperto",
  );
  await expect(page.getByTestId("veto-deadline")).toContainText(
    "Finestra di veto fino a",
  );
  await noOverflow(page, "scheduled");

  await page.getByRole("button", { name: "Veto" }).click();
  await page
    .getByRole("alertdialog")
    .getByRole("button", { name: "Conferma" })
    .click();
  await expect(page.getByTestId("publish-state")).toHaveText("Veto");
  await expect(page.getByRole("button", { name: "Nuovo piano" })).toBeVisible();
  const sql = oauthSql();
  try {
    const rows = await sql`select s.state, d.state as destination, d.handoff_at
      from public.publish_schedules s join public.publish_destinations d on d.schedule_id=s.id
      join public.projects p on p.id=(select project_id from public.versions where id=s.version_id)
      where p.id=${project}`;
    expect(rows).toEqual([
      { state: "vetoed", destination: "vetoed", handoff_at: null },
    ]);
  } finally {
    await sql.end();
  }
  expect(errors).toEqual([]);
});

test("an agent asks, the owner approves in the app, the slot publishes through the fake YouTube", async ({
  page,
  request,
}) => {
  test.setTimeout(180_000);
  const title = `E2E agente ${Date.now()}`;
  const { project, version } = await approvedVideo(title);
  const token = await agentToken();
  const planned = await api(request, token, "POST", "/publish/plans", {
    version_id: version,
    draft: { tags: ["pop"], thumbnail_text: "Nuovo singolo" },
  });
  const id = planned.schedule_id as string;
  await api(request, token, "POST", `/publish/${id}/schedule`, {
    slot_at: inHours(2),
  });
  const asked = await api(
    request,
    token,
    "POST",
    `/publish/${id}/request-approval`,
  );
  expect(asked.state).toBe("awaiting_approval");
  expect(asked.approval.state).toBe("pending");
  // No agent route can approve.
  const forbidden = await request.post(`/api/v1/publish/${id}/approve`, {
    headers: {
      Authorization: `Bearer ${token}`,
      "Idempotency-Key": crypto.randomUUID(),
    },
  });
  expect(forbidden.status()).toBe(404);

  const errors = watchErrors(page);
  await signIn(page);
  await page.goto("/settings/publishing");
  const card = page.getByRole("region", { name: "Schede in attesa" });
  await expect(card).toContainText(title);
  await card.getByRole("link", { name: "Apri il piano" }).first().click();
  const approval = page.getByRole("region", {
    name: "Richiesta di approvazione",
  });
  await expect(approval).toContainText("Costo: 0.00 EUR");
  await noOverflow(page, "approval");
  await approval.getByRole("button", { name: "Approva" }).click();
  await expect(page.getByTestId("publish-state")).toHaveText(
    "Programmato, veto aperto",
  );

  // The fake worker uploads privately, then the slot comes and it flips public.
  process.env.PUBLISH_DISPATCH_INTERVAL_MS = "2000";
  let worker: ChildProcess | undefined;
  try {
    worker = await startFakeWorker();
    const sql = oauthSql();
    try {
      await expect
        .poll(
          async () =>
            (
              await sql`select p.upload_state, p.privacy from public.publications p
                join public.publish_schedules s on s.render_id=p.render_id where s.id=${id}`
            )[0]?.privacy,
          { timeout: 60_000 },
        )
        .toBe("private");
      await sql`update public.publish_schedules set slot_at=now()-interval '1 second' where id=${id}`;
      await sql`update public.approval_requests set payload_hash=ops._publish_hash(schedule_id) where schedule_id=${id} and state='approved'`;
    } finally {
      await sql.end();
    }
    await expect
      .poll(() => schedule(id), { timeout: 60_000 })
      .toBe("published");
  } finally {
    if (worker) await stopWorker(worker);
  }
  const status = await api(request, token, "GET", `/songs/${version}/publish`);
  expect(status.schedules[0]).toMatchObject({
    state: "published",
    media: { privacy: "public" },
    destinations: [
      { state: "published", external_url: "https://youtu.be/fake-video" },
    ],
  });
  await page.reload();
  await expect(page.getByTestId("publish-state")).toHaveText("Pubblicato");
  await expect(
    page.getByRole("link", { name: "Apri su YouTube" }).first(),
  ).toHaveAttribute("href", "https://youtu.be/fake-video");
  await page.goto(`/projects/${project}/publish?lang=it`);
  await expect(page.getByText("Video su YouTube: pubblico")).toBeVisible();
  await noOverflow(page, "published");
  expect(errors).toEqual([]);
});

test("a standing rule from the settings approves an agent's request with a long enough veto window", async ({
  page,
  request,
}) => {
  test.setTimeout(120_000);
  await signIn(page);
  await page.goto("/settings/publishing");
  const rules = page.getByRole("region", { name: "Regole permanenti" });
  await rules.getByLabel("Finestra di veto minima (ore)").fill("24");
  await rules.getByRole("button", { name: "Aggiungi regola" }).click();
  await expect(
    rules.getByRole("button", { name: "Elimina regola" }),
  ).toHaveCount(1);
  try {
    const token = await agentToken();
    const near = await approvedVideo(`E2E regola vicina ${Date.now()}`);
    const far = await approvedVideo(`E2E regola lontana ${Date.now()}`);
    const ask = async (version: string, hours: number) => {
      const plan = await api(request, token, "POST", "/publish/plans", {
        version_id: version,
      });
      await api(
        request,
        token,
        "POST",
        `/publish/${plan.schedule_id}/schedule`,
        {
          slot_at: inHours(hours),
        },
      );
      return api(
        request,
        token,
        "POST",
        `/publish/${plan.schedule_id}/request-approval`,
      );
    };
    const waiting = await ask(near.version, 3);
    expect(waiting.state).toBe("awaiting_approval");
    // Leave no waiting card behind for later journeys.
    await api(request, token, "POST", `/publish/${waiting.schedule_id}/cancel`);
    const ruled = await ask(far.version, 30);
    expect(ruled).toMatchObject({
      state: "scheduled",
      approval: { decided_via: "rule" },
    });
    // The veto stays the owner's: the agent stops its own plan.
    expect(
      (await api(request, token, "POST", `/publish/${ruled.schedule_id}/veto`))
        .state,
    ).toBe("vetoed");
  } finally {
    await rules.getByRole("button", { name: "Elimina regola" }).click();
    await expect(rules.getByText("Nessuna regola")).toBeVisible();
  }
});
